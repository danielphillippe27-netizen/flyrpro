import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getEntitlementForUser } from '@/app/lib/billing/entitlements';
import type { EntitlementSnapshot } from '@/types/database';
import { STRIPE_PRICE_PRO_MONTHLY } from '@/app/lib/billing/stripe-products';

const DEFAULT_SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://kfnsnwqylsdsbgnwgxva.supabase.co';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function getCleanUrl(): string {
  return (DEFAULT_SUPABASE_URL || '').trim().replace(/\/$/, '') || DEFAULT_SUPABASE_URL;
}

/**
 * GET /api/billing/entitlement
 * Single "truth fetch" for iOS and web. Auth: cookies (web) or Authorization: Bearer (iOS).
 * Returns { plan, is_active, source, current_period_end }.
 */
export async function GET(request: NextRequest) {
  try {
    let userId: string | null = null;

    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      if (!SUPABASE_ANON_KEY) {
        return NextResponse.json(
          { error: 'Server misconfiguration' },
          { status: 500 }
        );
      }
      const supabase = createClient(getCleanUrl(), SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = user.id;
    } else {
      const cookieStore = await cookies();
      const { createServerClient } = await import('@supabase/ssr');
      if (!SUPABASE_ANON_KEY) {
        return NextResponse.json(
          { error: 'Server misconfiguration' },
          { status: 500 }
        );
      }
      const supabase = createServerClient(
        getCleanUrl(),
        SUPABASE_ANON_KEY,
        {
          cookies: {
            getAll() {
              return cookieStore.getAll();
            },
            setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            },
          },
        }
      );
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = user.id;
    }

    const entitlement = await getEntitlementForUser(userId!);

    const snapshot: EntitlementSnapshot & { upgrade_price_id?: string } = {
      plan: entitlement.plan,
      is_active: entitlement.is_active,
      source: entitlement.source,
      current_period_end: entitlement.current_period_end,
    };
    if (STRIPE_PRICE_PRO_MONTHLY) {
      snapshot.upgrade_price_id = STRIPE_PRICE_PRO_MONTHLY;
    }

    return NextResponse.json(snapshot);
  } catch (error) {
    console.error('Error fetching entitlement:', error);
    return NextResponse.json(
      { error: 'Failed to fetch entitlement' },
      { status: 500 }
    );
  }
}
