import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveReferralDiscount } from '@/app/lib/billing/stripe-referral';

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: ownerMembership } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', requestUser.id)
      .eq('role', 'owner')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!ownerMembership?.workspace_id) {
      return NextResponse.json({
        referralCode: null,
        hasDiscount: false,
      });
    }

    const { data: workspace } = await admin
      .from('workspaces')
      .select('referral_code_used')
      .eq('id', ownerMembership.workspace_id)
      .maybeSingle();

    const referralCode =
      typeof workspace?.referral_code_used === 'string' &&
      workspace.referral_code_used.trim().length > 0
        ? workspace.referral_code_used.trim()
        : null;

    if (!referralCode) {
      return NextResponse.json({
        referralCode: null,
        hasDiscount: false,
      });
    }

    const resolved = await resolveReferralDiscount(referralCode);

    return NextResponse.json({
      referralCode,
      hasDiscount: Boolean(resolved),
      discount: resolved
        ? {
            source: resolved.source,
            percentOff: resolved.percentOff,
            amountOff: resolved.amountOff,
            amountOffCurrency: resolved.amountOffCurrency,
            duration: resolved.duration,
          }
        : null,
    });
  } catch (error) {
    console.error('Error resolving Stripe referral discount:', error);
    return NextResponse.json(
      { error: 'Failed to resolve referral discount' },
      { status: 500 }
    );
  }
}
