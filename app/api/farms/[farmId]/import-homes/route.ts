import { prepareFarmMap } from '@/lib/farms/prepareFarmMap';
import { createHash } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { bbox } from '@turf/turf';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import { selectFarmCampaignRow, userCanAccessFarm, formatApiError } from '@/app/api/farms/_utils/backingCampaign';
import { parseFarmBoundary } from '@/lib/farms/farm-boundary';
import { resolveCampaignRegion, resolveAmbiguousRegionCountry } from '@/lib/geo/regionResolver';
import { BEDROCK_CANADA_CONFIG, BEDROCK_US_CONFIG, BedrockCountryService } from '@/lib/services/BedrockCountryService';
import { matchDurhamFarmAddresses } from '@/lib/farms/durhamSnapshot';
import regions from '@/scripts/regions.json';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ farmId: string }> }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { farmId } = await context.params;
    const admin = createAdminClient();
    const { farm } = await selectFarmCampaignRow(admin, farmId);
    if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
    if (!await userCanAccessFarm(admin, user.id, farm)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    const filterCommercial = body.excludeCommercial === true;
    const boundary = parseFarmBoundary(farm.polygon);
    if (!boundary) return NextResponse.json({ error: 'Choose a closed farm boundary smaller than 5,000 km².' }, { status: 400 });
    const resolution = await resolveCampaignRegion({ polygon: boundary });
    if (resolution.source === 'default') throw new Error('Could not determine the farm region.');
    const country = resolveAmbiguousRegionCountry(resolution.regionCode, boundary) ?? regions.find(row => row.code === resolution.regionCode)?.country;
    if (country !== 'US' && country !== 'CA') return NextResponse.json({ error: 'Large farm address imports currently support Canada and the U.S.' }, { status: 422 });
    const bounds = bbox(boundary);
    const targets = country === 'CA' ? [resolution.regionCode] : regions.filter(row => row.country === 'US' && row.bbox[0] <= bounds[2] && row.bbox[2] >= bounds[0] && row.bbox[1] <= bounds[3] && row.bbox[3] >= bounds[1]).map(row => row.code);
    if (!targets.length || targets.length > 6) throw new Error('Choose a farm within fewer regions.');
    const service = new BedrockCountryService(country === 'CA' ? BEDROCK_CANADA_CONFIG : BEDROCK_US_CONFIG);
    // Fail the entire scan if any region fails; never present partial coverage as complete.
    const scans = await Promise.all(targets.map(region => service.countStormTerritoryPins(boundary, region, true)));
    const existing = await fetchAllInPages<{ id: string; gers_id: string | null; formatted: string }>(async (from, to) =>
      await admin.from('farm_addresses').select('id, gers_id, formatted').eq('farm_id', farm.id).order('id').range(from, to));
    const identity = (row: { gers_id?: string | null; formatted?: string | null }) => row.gers_id || row.formatted?.trim().toLowerCase() || '';
    const existingIds = new Map(existing.map(row => [identity(row), row.id]));
    const addresses = [...new Map(scans.flatMap(scan => scan.addresses).map(row => [identity(row), row])).values()];
    const rows = addresses.map(row => {
      const hash = createHash('sha256').update(`${farm.id}:${identity(row)}`).digest('hex');
      const id = existingIds.get(identity(row)) ?? `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      return { id, farm_id: farm.id, gers_id: row.gers_id ?? null, formatted: row.formatted,
        house_number: row.house_number ?? null, street_name: row.street_name ?? null,
        locality: row.locality ?? null, region: row.region ?? null, postal_code: row.postal_code ?? null,
        source: row.source, latitude: row.coordinate?.lat ?? row.lat ?? null, longitude: row.coordinate?.lon ?? row.lon ?? null };
    });
    const exclusions = await fetchAllInPages<{ address_id: string; restored_at: string | null }>(async (from, to) =>
      await admin.from('farm_commercial_exclusions').select('address_id,restored_at').eq('farm_id', farm.id).order('address_id').range(from, to));
    const previouslyExcluded = new Set(exclusions.filter(row => !row.restored_at).map(row => row.address_id));
    const knownExclusions = new Set(exclusions.map(row => row.address_id));
    let newExclusions = 0;
    if (filterCommercial) {
      const existingAddressIds = new Set(existing.map(row => row.id));
      const eligible = rows.filter(row => !existingAddressIds.has(row.id) && !knownExclusions.has(row.id));
      const review = await matchDurhamFarmAddresses(eligible);
      if (review.addressesInDurham === 0) throw new Error('This filter currently covers Durham Region only. No addresses in this farm could be checked.');
      const byId = new Map(eligible.map(row => [row.id, row]));
      const excluded = review.matches.map(match => ({ farm_id: farm.id, address_id: match.addressId, address_data: byId.get(match.addressId), places: match.places }));
      for (let offset = 0; offset < excluded.length; offset += 500) {
        const { error } = await admin.from('farm_commercial_exclusions').upsert(excluded.slice(offset, offset + 500), { onConflict: 'farm_id,address_id', ignoreDuplicates: true });
        if (error) throw error;
      }
      excluded.forEach(row => previouslyExcluded.add(row.address_id));
      newExclusions = excluded.length;
    }
    const included = rows.filter(row => !previouslyExcluded.has(row.id));
    // Upsert only address fields: retries retain IDs, contacts and all visit history.
    for (let offset = 0; offset < included.length; offset += 500) {
      const { error } = await admin.from('farm_addresses').upsert(included.slice(offset, offset + 500), { onConflict: 'id' });
      if (error) throw error;
    }
    const { count, error: countError } = await admin.from('farm_addresses').select('id', { count: 'exact', head: true }).eq('farm_id', farm.id);
    if (countError) throw countError;
    const { error } = await admin.from('farms').update({ address_count: count ?? 0, last_generated_at: new Date().toISOString() }).eq('id', farm.id);
    if (error) throw error;
    after(async () => {
      try { await prepareFarmMap(admin, farm.id, country, resolution.regionCode); }
      catch (error) { console.error('[farm map] Preparation failed:', farm.id, error); }
    });
    return NextResponse.json({ importedCount: included.length, totalCount: count ?? 0, excludedCount: newExclusions });
  } catch (error) { return NextResponse.json({ error: formatApiError(error) }, { status: 500 }); }
}
