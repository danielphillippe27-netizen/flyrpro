import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';

type RouteContext = {
  params: Promise<{
    campaignId: string;
    parcelId: string;
  }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { campaignId, parcelId } = await context.params;
    const admin = createAdminClient();
    const canAccess = await ensureCampaignAccess(admin, campaignId, user.id);
    if (!canAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: parcel, error: parcelError } = await admin
      .from('campaign_parcels')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('id', parcelId)
      .maybeSingle();

    if (parcelError || !parcel) {
      return NextResponse.json({ error: 'Parcel not found' }, { status: 404 });
    }

    const { error: deleteError } = await admin
      .from('campaign_parcels')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('id', parcelId);

    if (deleteError) {
      console.error('[DELETE /api/campaigns/[campaignId]/parcels/[parcelId]] Delete error:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true, parcel_id: parcelId });
  } catch (error) {
    console.error('[DELETE /api/campaigns/[campaignId]/parcels/[parcelId]] Unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
