import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import { deleteAddressIfExists } from '@/app/api/campaigns/_utils/location-delete';

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

    const result = await deleteAddressIfExists(admin, campaignId, addressId);
    if (!result.found) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true, address_id: addressId });
  } catch (error) {
    console.error('[DELETE /api/campaigns/[campaignId]/addresses/[addressId]] Unhandled error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
