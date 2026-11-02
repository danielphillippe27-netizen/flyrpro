import { isUuid } from '@/app/api/campaigns/_utils/resolve-campaign-building';
import { invalidateDeletedMap } from '@/app/api/campaigns/_utils/invalidate-deleted-map';
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

    const query = admin.from('campaign_parcels').select('id').eq('campaign_id', campaignId);
    const { data: parcel, error: parcelError } = await (isUuid(parcelId)
      ? query.or(`id.eq.${parcelId},external_id.eq.${parcelId}`)
      : query.eq('external_id', parcelId)).limit(1).maybeSingle();
    if (parcelError) {
      return NextResponse.json({ error: 'Failed to load parcel' }, { status: 500 });
    }
    if (!parcel) return NextResponse.json({ error: 'Parcel not found' }, { status: 404 });

    const { data: deleted, error: deleteError } = await admin.rpc('hide_and_delete_campaign_parcel', {
      p_campaign_id: campaignId, p_parcel_id: parcel.id,
    });
    if (deleteError || !deleted) {
      console.error('[campaign-parcel] Delete failed:', deleteError?.message);
      return NextResponse.json({ error: 'Failed to delete parcel' }, { status: 500 });
    }

    await invalidateDeletedMap(admin, campaignId);

    return NextResponse.json({ deleted: true, parcel_id: parcelId });
  } catch (error) {
    console.error('[DELETE /api/campaigns/[campaignId]/parcels/[parcelId]] Unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
