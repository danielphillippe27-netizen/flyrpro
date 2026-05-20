import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import { deleteBuildingDeep } from '@/app/api/campaigns/_utils/location-delete';
import { normalizeBuildingRouteId } from '@/app/api/campaigns/_utils/resolve-campaign-building';

type RouteContext = {
  params: Promise<{
    campaignId: string;
    buildingId: string | string[];
  }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { campaignId, buildingId: buildingIdParam } = await context.params;
    const buildingId = normalizeBuildingRouteId(buildingIdParam);
    const admin = createAdminClient();
    const canAccess = await ensureCampaignAccess(admin, campaignId, user.id);
    if (!canAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await deleteBuildingDeep(admin, campaignId, buildingId);
    if (!result.found) {
      return NextResponse.json({ error: 'Building not found' }, { status: 404 });
    }

    return NextResponse.json({
      deleted: true,
      building_id: result.buildingId,
      deleted_address_ids: result.deletedAddressIds,
      deleted_building_row: result.deletedBuildingRow,
    });
  } catch (error) {
    console.error('[DELETE /api/campaigns/[campaignId]/buildings/[buildingId]] Unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
