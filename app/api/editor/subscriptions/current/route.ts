import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getEntitlementForUser } from '@/app/lib/billing/entitlements';

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const entitlement = await getEntitlementForUser(requestUser.id);
    return NextResponse.json({
      data: {
        active: entitlement.is_active,
        plan: entitlement.plan,
        source: entitlement.source,
        currentPeriodEnd: entitlement.current_period_end,
        customerId: entitlement.stripe_customer_id ?? null,
        status: entitlement.is_active ? 'active' : 'inactive',
      },
    });
  } catch (error) {
    console.error('Error fetching editor subscription:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
