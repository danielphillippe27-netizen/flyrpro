import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import { stripe } from '@/lib/stripe';

type ProfileLite = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type EntitlementRow = {
  user_id: string;
  source: 'stripe' | 'apple' | 'none';
  plan: 'free' | 'pro' | 'team';
  is_active: boolean;
  stripe_subscription_id: string | null;
  updated_at: string;
};

function isoStartOfUtcDay(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  return d.toISOString();
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

async function countRowsSince(
  admin: SupabaseClient,
  table: string,
  sinceIso: string,
  column: string
): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select('id', { head: true, count: 'exact' })
    .gte(column, sinceIso);
  if (error) return 0;
  return count ?? 0;
}

async function countDistinctUsersFromSessions(
  admin: SupabaseClient,
  sinceIso: string
): Promise<number> {
  const { data, error } = await admin
    .from('sessions')
    .select('user_id')
    .gte('start_time', sinceIso)
    .limit(10000);
  if (error || !data) return 0;
  const ids = new Set<string>();
  data.forEach((row) => {
    const userId = (row as { user_id?: string | null }).user_id;
    if (userId) ids.add(userId);
  });
  return ids.size;
}

async function countAuthUsersSince(admin: SupabaseClient, sinceIso: string): Promise<number> {
  const authSchemaClient = admin.schema('auth');
  const { count, error } = await authSchemaClient
    .from('users')
    .select('id', { head: true, count: 'exact' })
    .gte('created_at', sinceIso);
  if (!error) {
    return count ?? 0;
  }

  try {
    let page = 1;
    let total = 0;
    while (page <= 50) {
      const { data, error: listError } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (listError || !data?.users?.length) break;
      for (const row of data.users) {
        if (new Date(row.created_at).toISOString() >= sinceIso) total += 1;
      }
      if (data.users.length < 200) break;
      page += 1;
    }
    return total;
  } catch {
    return 0;
  }
}

async function loadProfilesById(admin: SupabaseClient, userIds: string[]): Promise<Map<string, ProfileLite>> {
  if (userIds.length === 0) return new Map();

  const { data, error } = await admin
    .from('profiles')
    .select('id, email, full_name')
    .in('id', userIds);

  if (error || !data) return new Map();
  return new Map((data as ProfileLite[]).map((profile) => [profile.id, profile]));
}

async function estimateStripeMonthlyRevenueFromEntitlements(
  entitlements: EntitlementRow[]
): Promise<{
  monthlyAmountCents: number | null;
  currency: string | null;
  stripeSubscriptionCount: number;
  stripeError: string | null;
}> {
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? '';
  if (!stripeKey || stripeKey.startsWith('sk_test_placeholder')) {
    return {
      monthlyAmountCents: null,
      currency: null,
      stripeSubscriptionCount: 0,
      stripeError: 'Stripe is not configured',
    };
  }

  const ids = Array.from(
    new Set(
      entitlements
        .filter(
          (row) =>
            row.is_active &&
            row.source === 'stripe' &&
            row.stripe_subscription_id &&
            row.plan !== 'free'
        )
        .map((row) => row.stripe_subscription_id as string)
    )
  );

  if (ids.length === 0) {
    return {
      monthlyAmountCents: 0,
      currency: 'usd',
      stripeSubscriptionCount: 0,
      stripeError: null,
    };
  }

  let totalMonthly = 0;
  let selectedCurrency = 'usd';

  try {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 10) {
      chunks.push(ids.slice(i, i + 10));
    }

    for (const chunk of chunks) {
      const subs = await Promise.all(
        chunk.map((id) =>
          stripe.subscriptions.retrieve(id, {
            expand: ['items.data.price'],
          })
        )
      );

      for (const subscription of subs) {
        if (subscription.status !== 'active' && subscription.status !== 'trialing') continue;
        for (const item of subscription.items.data) {
          const price = item.price;
          const unitAmount = price?.unit_amount ?? 0;
          const quantity = item.quantity ?? 1;
          const recurring = price?.recurring;
          if (!recurring || unitAmount <= 0) continue;

          const intervalCount = recurring.interval_count || 1;
          let monthly = unitAmount * quantity;

          if (recurring.interval === 'year') {
            monthly = monthly / (12 * intervalCount);
          } else if (recurring.interval === 'week') {
            monthly = (monthly * 52) / (12 * intervalCount);
          } else if (recurring.interval === 'day') {
            monthly = (monthly * 30) / intervalCount;
          } else {
            monthly = monthly / intervalCount;
          }

          if (price.currency) selectedCurrency = price.currency;
          totalMonthly += monthly;
        }
      }
    }

    return {
      monthlyAmountCents: Math.round(totalMonthly),
      currency: selectedCurrency,
      stripeSubscriptionCount: ids.length,
      stripeError: null,
    };
  } catch (error) {
    console.error('[api/admin/inbox/summary] stripe revenue estimate error:', error);
    return {
      monthlyAmountCents: null,
      currency: null,
      stripeSubscriptionCount: ids.length,
      stripeError: 'Failed to load Stripe subscriptions',
    };
  }
}

export async function GET() {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const todayStartIso = isoStartOfUtcDay();
    const sevenDaysIso = isoDaysAgo(7);
    const fourteenDaysIso = isoDaysAgo(14);

    const [
      signupsToday,
      signupsSevenDays,
      sessionsToday,
      sessionsSevenDays,
      campaignsToday,
      campaignsSevenDays,
      activeUsersToday,
      activeUsersSevenDays,
      entitlementsRes,
      trialsSevenRes,
      trialsFourteenRes,
      paymentIssuesRes,
      churnedRes,
    ] = await Promise.all([
      countAuthUsersSince(auth.admin, todayStartIso),
      countAuthUsersSince(auth.admin, sevenDaysIso),
      countRowsSince(auth.admin, 'sessions', todayStartIso, 'start_time'),
      countRowsSince(auth.admin, 'sessions', sevenDaysIso, 'start_time'),
      countRowsSince(auth.admin, 'campaigns', todayStartIso, 'created_at'),
      countRowsSince(auth.admin, 'campaigns', sevenDaysIso, 'created_at'),
      countDistinctUsersFromSessions(auth.admin, todayStartIso),
      countDistinctUsersFromSessions(auth.admin, sevenDaysIso),
      auth.admin
        .from('entitlements')
        .select('user_id, source, plan, is_active, stripe_subscription_id, updated_at'),
      auth.admin
        .from('workspaces')
        .select('id', { count: 'exact', head: true })
        .not('trial_ends_at', 'is', null)
        .gte('created_at', sevenDaysIso),
      auth.admin
        .from('workspaces')
        .select('id', { count: 'exact', head: true })
        .not('trial_ends_at', 'is', null)
        .gte('created_at', fourteenDaysIso),
      auth.admin
        .from('workspaces')
        .select('id, name, owner_id, updated_at')
        .eq('subscription_status', 'past_due')
        .order('updated_at', { ascending: false })
        .limit(20),
      auth.admin
        .from('entitlements')
        .select('user_id, source, updated_at')
        .in('source', ['stripe', 'apple'])
        .eq('is_active', false)
        .gte('updated_at', sevenDaysIso)
        .order('updated_at', { ascending: false })
        .limit(20),
    ]);

    const entitlements = (entitlementsRes.data ?? []) as EntitlementRow[];
    const activePaid = entitlements.filter(
      (row) => row.is_active && row.plan !== 'free' && (row.source === 'stripe' || row.source === 'apple')
    );
    const activePaidStripe = activePaid.filter((row) => row.source === 'stripe').length;
    const activePaidApple = activePaid.filter((row) => row.source === 'apple').length;

    const convertedToPaid14d = entitlements.filter(
      (row) =>
        row.is_active &&
        row.plan !== 'free' &&
        (row.source === 'stripe' || row.source === 'apple') &&
        row.updated_at >= fourteenDaysIso
    ).length;
    const trials14d = trialsFourteenRes.count ?? 0;
    const conversionRate =
      trials14d > 0 ? Number(((convertedToPaid14d / trials14d) * 100).toFixed(1)) : null;

    const stripeRevenue = await estimateStripeMonthlyRevenueFromEntitlements(entitlements);

    const paymentIssueRows = (
      paymentIssuesRes.error ? [] : paymentIssuesRes.data ?? []
    ) as Array<{ id: string; name: string; owner_id: string | null; updated_at: string }>;
    const churnedRows = (
      churnedRes.error ? [] : churnedRes.data ?? []
    ) as Array<{ user_id: string; source: string; updated_at: string }>;

    const profileIds = Array.from(
      new Set([
        ...paymentIssueRows.map((row) => row.owner_id).filter(Boolean),
        ...churnedRows.map((row) => row.user_id).filter(Boolean),
      ])
    ) as string[];
    const profileMap = await loadProfilesById(auth.admin, profileIds);

    return NextResponse.json({
      productHealth: {
        signups: {
          today: signupsToday,
          sevenDays: signupsSevenDays,
        },
        activeUsers: {
          today: activeUsersToday,
          sevenDays: activeUsersSevenDays,
        },
        sessions: {
          today: sessionsToday,
          sevenDays: sessionsSevenDays,
        },
        campaignsCreated: {
          today: campaignsToday,
          sevenDays: campaignsSevenDays,
        },
        crashes: {
          today: null,
          sevenDays: null,
          available: false,
        },
      },
      revenue: {
        activePaidUsers: activePaid.length,
        activePaidUsersStripe: activePaidStripe,
        activePaidUsersApple: activePaidApple,
        trialStartsSevenDays: trialsSevenRes.count ?? 0,
        trialToPaidRolling14Days: convertedToPaid14d,
        trialToPaidRolling14DaysRate: conversionRate,
        estimatedMonthlyRevenue: {
          monthlyAmountCents: stripeRevenue.monthlyAmountCents,
          currency: stripeRevenue.currency,
          stripeOnly: true,
          stripeSubscriptionCount: stripeRevenue.stripeSubscriptionCount,
          note: stripeRevenue.stripeError
            ? stripeRevenue.stripeError
            : 'Estimated from active Stripe subscriptions (annual plans normalized to monthly).',
        },
      },
      redFlags: {
        paymentIssues: paymentIssueRows.map((row) => {
          const profile = row.owner_id ? profileMap.get(row.owner_id) : null;
          return {
            workspaceId: row.id,
            workspaceName: row.name,
            ownerId: row.owner_id,
            ownerEmail: profile?.email ?? null,
            ownerName: profile?.full_name ?? null,
            updatedAt: row.updated_at,
          };
        }),
        repeatedErrors: [],
        churnedLastSevenDays: churnedRows.map((row) => {
          const profile = profileMap.get(row.user_id);
          return {
            userId: row.user_id,
            source: row.source,
            updatedAt: row.updated_at,
            userEmail: profile?.email ?? null,
            userName: profile?.full_name ?? null,
          };
        }),
      },
    });
  } catch (error) {
    console.error('[api/admin/inbox/summary] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
