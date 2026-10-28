import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  formatApiError,
  resolveBackingCampaignId,
  selectFarmCampaignRow,
  userCanAccessFarm,
} from '@/app/api/farms/_utils/backingCampaign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CampaignAddressGeoRow = {
  id?: string;
  formatted?: string | null;
  gers_id?: string | null;
  house_number?: string | null;
  street_name?: string | null;
  locality?: string | null;
  region?: string | null;
  postal_code?: string | null;
  source?: string | null;
  coordinate?: { lat?: number; lon?: number } | null;
  geom?: GeoJSON.Geometry | string | null;
};

function fallbackFormattedAddress(row: CampaignAddressGeoRow): string {
  return [row.house_number, row.street_name, row.locality, row.region].filter(Boolean).join(' ') || 'Unknown address';
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ farmId: string }> }
) {
  try {
    const { farmId } = await context.params;

    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { farm, hasLinkedCampaignColumn } = await selectFarmCampaignRow(admin, farmId);
    if (!farm) {
      return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
    }

    const canAccess = await userCanAccessFarm(admin, requestUser.id, farm);
    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const linkedCampaignId = await resolveBackingCampaignId(admin, farm, hasLinkedCampaignColumn);
    if (!linkedCampaignId) {
      return NextResponse.json({ error: 'Farm has no linked campaign' }, { status: 400 });
    }

    const campaignAddresses = await fetchAllInPages(async (from, to) =>
      await admin
        .from('campaign_addresses')
        .select('id, formatted, gers_id, house_number, street_name, locality, region, postal_code, source, coordinate, geom')
        .eq('campaign_id', linkedCampaignId)
        .order('id', { ascending: true })
        .range(from, to)
    );

    const rows = (campaignAddresses as CampaignAddressGeoRow[]).map((row) => ({
      farm_id: farm.id,
      campaign_address_id: row.id ?? null,
      gers_id: row.gers_id ?? null,
      formatted: row.formatted || fallbackFormattedAddress(row),
      house_number: row.house_number ?? null,
      street_name: row.street_name ?? null,
      locality: row.locality ?? null,
      region: row.region ?? null,
      postal_code: row.postal_code ?? null,
      source: row.source || 'map',
      latitude: typeof row.coordinate?.lat === 'number' ? row.coordinate.lat : null,
      longitude: typeof row.coordinate?.lon === 'number' ? row.coordinate.lon : null,
      geom: row.geom ?? null,
      visited_count: 0,
    }));

    // Keep existing IDs and history, including homes imported outside campaign caps.
    const existing = await fetchAllInPages<{ campaign_address_id: string | null; gers_id: string | null; formatted: string }>(async (from, to) =>
      await admin.from('farm_addresses').select('campaign_address_id, gers_id, formatted')
        .eq('farm_id', farm.id).order('id').range(from, to));
    const campaignIds = new Set(existing.map(row => row.campaign_address_id).filter(Boolean));
    const externalIds = new Set(existing.map(row => row.gers_id).filter(Boolean));
    const formatted = new Set(existing.map(row => row.formatted.trim().toLowerCase()));
    const newRows = rows.filter(row =>
      !campaignIds.has(row.campaign_address_id) &&
      !(row.gers_id && externalIds.has(row.gers_id)) &&
      !formatted.has(row.formatted.trim().toLowerCase()));

    const batchSize = 500;
    for (let index = 0; index < newRows.length; index += batchSize) {
      const batch = newRows.slice(index, index + batchSize);
      if (batch.length === 0) continue;
      const { error: insertError } = await admin.from('farm_addresses').insert(batch);
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    await admin
      .from('farms')
      .update({
        address_count: existing.length + newRows.length,
        last_generated_at: new Date().toISOString(),
      })
      .eq('id', farm.id);

    return NextResponse.json({
      farm_id: farm.id,
      linked_campaign_id: linkedCampaignId,
      inserted_count: newRows.length,
    });
  } catch (error) {
    console.error('[farm sync] Failed to mirror campaign addresses into farm_addresses:', error);
    return NextResponse.json(
      { error: formatApiError(error) },
      { status: 500 }
    );
  }
}
