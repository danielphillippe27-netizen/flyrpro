import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
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

    const authClient = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const { farm, hasLinkedCampaignColumn } = await selectFarmCampaignRow(admin, farmId);
    if (!farm) {
      return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
    }

    const canAccess = await userCanAccessFarm(admin, user.id, farm);
    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const linkedCampaignId = await resolveBackingCampaignId(admin, farm, hasLinkedCampaignColumn);
    if (!linkedCampaignId) {
      return NextResponse.json({ error: 'Farm has no linked campaign' }, { status: 400 });
    }

    const campaignAddresses = await fetchAllInPages((from, to) =>
      admin
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

    const { error: deleteError } = await admin.from('farm_addresses').delete().eq('farm_id', farm.id);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    const batchSize = 500;
    for (let index = 0; index < rows.length; index += batchSize) {
      const batch = rows.slice(index, index + batchSize);
      if (batch.length === 0) continue;
      const { error: insertError } = await admin.from('farm_addresses').insert(batch);
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    await admin
      .from('farms')
      .update({
        address_count: rows.length,
        last_generated_at: new Date().toISOString(),
      })
      .eq('id', farm.id);

    return NextResponse.json({
      farm_id: farm.id,
      linked_campaign_id: linkedCampaignId,
      inserted_count: rows.length,
    });
  } catch (error) {
    console.error('[farm sync] Failed to mirror campaign addresses into farm_addresses:', error);
    return NextResponse.json(
      { error: formatApiError(error) },
      { status: 500 }
    );
  }
}
