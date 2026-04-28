import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import {
  deleteAddressIfExists,
  deleteBuildingDeep,
  deleteParcelIfExists,
} from '@/app/api/campaigns/_utils/location-delete';

type RouteContext = {
  params: Promise<{
    campaignId: string;
  }>;
};

type DeleteLocationPayload = {
  buildingId?: string | null;
  addressId?: string | null;
  parcelId?: string | null;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { campaignId } = await context.params;
    const admin = createAdminClient();
    const canAccess = await ensureCampaignAccess(admin, campaignId, user.id);
    if (!canAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const payload = (await request.json().catch(() => null)) as DeleteLocationPayload | null;
    const buildingId = payload?.buildingId?.trim() || null;
    const addressId = payload?.addressId?.trim() || null;
    const parcelId = payload?.parcelId?.trim() || null;

    if (!buildingId && !addressId && !parcelId) {
      return NextResponse.json({ error: 'Nothing to delete' }, { status: 400 });
    }

    let deletedAddressIds: string[] = [];
    let deletedBuildingId: string | null = null;
    let deletedBuildingRow = false;
    let deletedParcelId: string | null = null;

    if (buildingId) {
      const result = await deleteBuildingDeep(admin, campaignId, buildingId);
      if (result.found) {
        deletedAddressIds = result.deletedAddressIds;
        deletedBuildingId = result.buildingId;
        deletedBuildingRow = result.deletedBuildingRow;
      }
    } else if (addressId) {
      const result = await deleteAddressIfExists(admin, campaignId, addressId);
      if (result.found) {
        deletedAddressIds = [result.addressId];
      }
    }

    if (parcelId) {
      const result = await deleteParcelIfExists(admin, campaignId, parcelId);
      if (result.found) {
        deletedParcelId = result.parcelId;
      }
    }

    const foundAnything = deletedAddressIds.length > 0 || Boolean(deletedBuildingId) || Boolean(deletedParcelId);
    if (!foundAnything) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    return NextResponse.json({
      deleted: true,
      building_id: deletedBuildingId,
      deleted_address_ids: deletedAddressIds,
      deleted_building_row: deletedBuildingRow,
      parcel_id: deletedParcelId,
    });
  } catch (error) {
    console.error('[DELETE /api/campaigns/[campaignId]/location] Unhandled error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500 });
  }
}
