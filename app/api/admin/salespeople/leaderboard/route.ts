import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import { isMissingSalespeopleSchemaError } from '@/app/lib/billing/salespeople';

export const dynamic = 'force-dynamic';

type PeriodKey = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'all';
type SortKey = 'score' | 'calls' | 'demosSent' | 'signups';

type SalespersonRow = {
  id: string;
  full_name: string;
  email: string;
  role: string | null;
  territory: string | null;
  referral_code: string | null;
  status: 'active' | 'paused' | 'inactive';
  workspace_id: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
};

type CallRow = {
  user_id: string;
};

type SmsRow = {
  user_id: string;
  body: string | null;
};

type ReferralRow = {
  salesperson_id: string;
};

type WorkspaceReferralRow = {
  referral_code_used: string | null;
};

const PERIOD_DAYS: Record<Exclude<PeriodKey, 'all'>, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  yearly: 365,
};

function parsePeriod(value: string | null): PeriodKey {
  if (value === 'daily' || value === 'weekly' || value === 'yearly' || value === 'all') {
    return value;
  }
  return 'monthly';
}

function parseSort(value: string | null): SortKey {
  if (value === 'calls' || value === 'demosSent' || value === 'signups') return value;
  return 'score';
}

function buildRange(period: PeriodKey) {
  const end = new Date();
  if (period === 'all') {
    return { startIso: null, endIso: end.toISOString() };
  }

  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - PERIOD_DAYS[period]);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function isMissingRelationError(error: { message?: string } | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? '';
  return (
    isMissingSalespeopleSchemaError(error?.message) ||
    message.includes('does not exist') ||
    message.includes('could not find the table') ||
    message.includes('schema cache')
  );
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeCode(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function increment(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function applyRange<T>(
  query: T,
  startIso: string | null,
  endIso: string,
  column = 'created_at'
): T {
  let next = query as T & {
    gte: (column: string, value: string) => typeof next;
    lt: (column: string, value: string) => typeof next;
  };
  if (startIso) next = next.gte(column, startIso);
  return next.lt(column, endIso) as T;
}

function includesDemoSignal(body: string | null | undefined): boolean {
  const text = (body ?? '').toLowerCase();
  return (
    text.includes('flyr.software/demo') ||
    text.includes('/demo-1') ||
    text.includes('90-second demo') ||
    text.includes('demo')
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireFounderApi();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const period = parsePeriod(request.nextUrl.searchParams.get('period'));
  const sort = parseSort(request.nextUrl.searchParams.get('sort'));
  const { startIso, endIso } = buildRange(period);

  try {
    const { data: salespeopleData, error: salespeopleError } = await auth.admin
      .from('salespeople')
      .select('id, full_name, email, role, territory, referral_code, status, workspace_id')
      .order('full_name', { ascending: true })
      .limit(500);

    if (salespeopleError) {
      if (isMissingRelationError(salespeopleError)) {
        return NextResponse.json({
          setupRequired: true,
          period,
          sort,
          range: { start: startIso, end: endIso },
          rows: [],
          totals: { calls: 0, demosSent: 0, signups: 0, score: 0 },
        });
      }
      throw new Error(salespeopleError.message);
    }

    const salespeople = (salespeopleData ?? []) as SalespersonRow[];
    const emails = Array.from(new Set(salespeople.map((row) => normalizeEmail(row.email)).filter(Boolean)));
    const referralCodes = Array.from(new Set(salespeople.map((row) => normalizeCode(row.referral_code)).filter(Boolean)));

    const profilesResult = emails.length
      ? await auth.admin.from('profiles').select('id, email').in('email', emails)
      : { data: [], error: null };

    if (profilesResult.error && !isMissingRelationError(profilesResult.error)) {
      throw new Error(profilesResult.error.message);
    }

    const userIdByEmail = new Map(
      ((profilesResult.data ?? []) as ProfileRow[])
        .map((profile) => [normalizeEmail(profile.email), profile.id] as const)
        .filter(([email, id]) => Boolean(email && id))
    );
    const userIds = Array.from(new Set(Array.from(userIdByEmail.values())));

    const [callsResult, smsResult, referralsResult, workspaceReferralResult] = await Promise.all([
      userIds.length
        ? applyRange(
            auth.admin.from('dialer_calls').select('user_id').in('user_id', userIds).limit(10000),
            startIso,
            endIso
          )
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? applyRange(
            auth.admin.from('dialer_sms_followups').select('user_id, body').in('user_id', userIds).limit(10000),
            startIso,
            endIso
          )
        : Promise.resolve({ data: [], error: null }),
      salespeople.length
        ? applyRange(
            auth.admin
              .from('salesperson_referrals')
              .select('salesperson_id')
              .in('salesperson_id', salespeople.map((row) => row.id))
              .limit(10000),
            startIso,
            endIso
          )
        : Promise.resolve({ data: [], error: null }),
      referralCodes.length
        ? applyRange(
            auth.admin
              .from('workspaces')
              .select('referral_code_used')
              .not('referral_code_used', 'is', null)
              .limit(10000),
            startIso,
            endIso
          )
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const result of [callsResult, smsResult, referralsResult, workspaceReferralResult]) {
      if (result.error && !isMissingRelationError(result.error)) {
        throw new Error(result.error.message);
      }
    }

    const callsByUserId = new Map<string, number>();
    for (const call of (callsResult.data ?? []) as CallRow[]) {
      increment(callsByUserId, call.user_id);
    }

    const demosByUserId = new Map<string, number>();
    for (const sms of (smsResult.data ?? []) as SmsRow[]) {
      if (includesDemoSignal(sms.body)) increment(demosByUserId, sms.user_id);
    }

    const signupsBySalespersonId = new Map<string, number>();
    for (const referral of (referralsResult.data ?? []) as ReferralRow[]) {
      increment(signupsBySalespersonId, referral.salesperson_id);
    }

    const salespersonIdByCode = new Map(
      salespeople
        .map((salesperson) => [normalizeCode(salesperson.referral_code), salesperson.id] as const)
        .filter(([code]) => Boolean(code))
    );
    const workspaceSignupsBySalespersonId = new Map<string, number>();
    for (const workspace of (workspaceReferralResult.data ?? []) as WorkspaceReferralRow[]) {
      const salespersonId = salespersonIdByCode.get(normalizeCode(workspace.referral_code_used));
      if (salespersonId) increment(workspaceSignupsBySalespersonId, salespersonId);
    }

    const rows = salespeople.map((salesperson) => {
      const userId = userIdByEmail.get(normalizeEmail(salesperson.email)) ?? null;
      const calls = userId ? callsByUserId.get(userId) ?? 0 : 0;
      const demosSent = userId ? demosByUserId.get(userId) ?? 0 : 0;
      const referralSignups = signupsBySalespersonId.get(salesperson.id) ?? 0;
      const workspaceSignups = workspaceSignupsBySalespersonId.get(salesperson.id) ?? 0;
      const signups = Math.max(referralSignups, workspaceSignups);
      const score = calls + demosSent * 3 + signups * 10;

      return {
        salespersonId: salesperson.id,
        userId,
        fullName: salesperson.full_name,
        email: salesperson.email,
        role: salesperson.role,
        territory: salesperson.territory,
        status: salesperson.status,
        referralCode: salesperson.referral_code,
        calls,
        demosSent,
        signups,
        score,
      };
    });

    rows.sort((left, right) => {
      const delta = right[sort] - left[sort];
      if (delta !== 0) return delta;
      if (right.signups !== left.signups) return right.signups - left.signups;
      if (right.demosSent !== left.demosSent) return right.demosSent - left.demosSent;
      if (right.calls !== left.calls) return right.calls - left.calls;
      return left.fullName.localeCompare(right.fullName);
    });

    const rankedRows = rows.map((row, index) => ({ ...row, rank: index + 1 }));
    const totals = rankedRows.reduce(
      (acc, row) => ({
        calls: acc.calls + row.calls,
        demosSent: acc.demosSent + row.demosSent,
        signups: acc.signups + row.signups,
        score: acc.score + row.score,
      }),
      { calls: 0, demosSent: 0, signups: 0, score: 0 }
    );

    return NextResponse.json({
      setupRequired: false,
      period,
      sort,
      range: { start: startIso, end: endIso },
      rows: rankedRows,
      totals,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load salesperson leaderboard';
    console.error('[admin/salespeople/leaderboard] failed', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
