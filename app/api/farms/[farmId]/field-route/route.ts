import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';
import {
  formatApiError,
  resolveBackingCampaignId,
  selectFarmCampaignRow,
  userCanAccessFarm,
} from '@/app/api/farms/_utils/backingCampaign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FarmAddressRow = {
  id: string;
  campaign_address_id?: string | null;
  formatted?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  visited_count?: number | null;
  last_outcome_status?: string | null;
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ farmId: string }> }
) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { farmId } = await context.params;
    const admin = createAdminClient();
    const { farm, hasLinkedCampaignColumn } = await selectFarmCampaignRow(admin, farmId);
    if (!farm) {
      return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
    }

    const canAccess = await userCanAccessFarm(admin, requestUser.id, farm);
    if (!canAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const campaignId = await resolveBackingCampaignId(admin, farm, hasLinkedCampaignColumn);
    const { data, error } = await admin
      .from('farm_addresses')
      .select('id, campaign_address_id, formatted, latitude, longitude, visited_count, last_outcome_status')
      .eq('farm_id', farm.id)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .order('street_name', { ascending: true })
      .order('house_number', { ascending: true })
      .limit(1000);

    if (error) {
      return NextResponse.json({ error: formatApiError(error) }, { status: 500 });
    }

    const stops = ((data ?? []) as FarmAddressRow[]).flatMap((row) => {
      if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') return [];
      return [{
        id: row.id,
        addressId: row.campaign_address_id ?? row.id,
        addressIds: [row.campaign_address_id ?? row.id].filter(Boolean),
        buildingId: null,
        label: row.formatted || 'Farm address',
        latitude: row.latitude,
        longitude: row.longitude,
        visited: Number(row.visited_count ?? 0) > 0,
        status: row.last_outcome_status ?? null,
      }];
    });

    return NextResponse.json({
      farmId: farm.id,
      campaignId,
      title: farm.name || 'Farm',
      stopCount: stops.length,
      stops,
    });
  } catch (error) {
    console.error('[api/farms/[farmId]/field-route] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
