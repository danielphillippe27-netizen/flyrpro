import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';

type RouteContext = {
  params: Promise<{
    campaignId: string;
    addressId: string;
  }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { campaignId, addressId } = await context.params;
    const admin = createAdminClient();
    const canAccess = await ensureCampaignAccess(admin, campaignId, user.id);
    if (!canAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: address, error: addressError } = await admin
      .from('campaign_addresses')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('id', addressId)
      .maybeSingle();

    if (addressError || !address) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 });
    }

    const { error: deleteError } = await admin
      .from('campaign_addresses')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('id', addressId);

    if (deleteError) {
      console.error('[DELETE /api/campaigns/[campaignId]/addresses/[addressId]] Delete error:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true, address_id: addressId });
  } catch (error) {
    console.error('[DELETE /api/campaigns/[campaignId]/addresses/[addressId]] Unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
