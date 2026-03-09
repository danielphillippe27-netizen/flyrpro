import { NextRequest, NextResponse } from 'next/server';
import { getEntitlementForUser } from '@/app/lib/billing/entitlements';
import type { EntitlementSnapshot } from '@/types/database';
import { getDefaultUpgradePriceId } from '@/app/lib/billing/stripe-products';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

/**
 * GET /api/billing/entitlement
 * Single "truth fetch" for iOS and web. Auth: cookies (web) or Authorization: Bearer (iOS).
 * Returns { plan, is_active, source, current_period_end }.
 */
export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const entitlement = await getEntitlementForUser(requestUser.id);

    const snapshot: EntitlementSnapshot & { upgrade_price_id?: string } = {
      plan: entitlement.plan,
      is_active: entitlement.is_active,
      source: entitlement.source,
      current_period_end: entitlement.current_period_end,
    };
    const defaultPriceId = getDefaultUpgradePriceId();
    if (defaultPriceId) {
      snapshot.upgrade_price_id = defaultPriceId;
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
