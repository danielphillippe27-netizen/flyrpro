import { bbox } from '@turf/turf';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { stormContext, stormError } from '@/lib/storm-maps/intelligence/access';
import { stormTerritorySchema } from '@/lib/storm-maps/intelligence/storm-territories';
import { partitionStormCampaigns } from '@/lib/storm-maps/intelligence/campaign-partitions';
import { resolveCampaignRegion, resolveAmbiguousRegionCountry } from '@/lib/geo/regionResolver';
import { BEDROCK_CANADA_CONFIG, BEDROCK_US_CONFIG, BedrockCountryService } from '@/lib/services/BedrockCountryService';
import regions from '@/scripts/regions.json';
export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(request: NextRequest) {
  const c = await stormContext(request); if ('response' in c) return c.response;
  const body = await request.json().catch(() => null);
  if (!z.uuid().safeParse(body?.territoryId).success) return NextResponse.json({ error: 'Choose a saved territory.' }, { status: 400 });
  const { data, error } = await c.admin.from('storm_territories').select('name,boundary,context').eq('workspace_id', c.workspaceId).eq('id', body.territoryId).maybeSingle();
  if (error) return stormError(new Error('Could not load the territory.'));
  const parsed = stormTerritorySchema.safeParse(data);
  if (!parsed.success) return NextResponse.json({ error: 'Saved territory unavailable.' }, { status: 404 });
  try {
    const { boundary } = parsed.data;
    const resolution = await resolveCampaignRegion({ polygon: boundary });
    if (resolution.source === 'default') throw new Error('Address coverage could not be determined.');
    const country = resolveAmbiguousRegionCountry(resolution.regionCode, boundary) ?? regions.find(row => row.code === resolution.regionCode)?.country;
    if (country !== 'US' && country !== 'CA') throw new Error('Automatic storm campaigns currently support U.S. and Canadian addresses.');
    const bounds = bbox(boundary);
    const targets = country === 'CA' ? [resolution.regionCode] : regions.filter(row => row.country === 'US' && row.bbox[0] <= bounds[2] && row.bbox[2] >= bounds[0] && row.bbox[1] <= bounds[3] && row.bbox[3] >= bounds[1]).map(row => row.code);
    if (!targets.length || targets.length > 6) throw new Error('Choose a smaller territory to scan its addresses.');
    const service = new BedrockCountryService(country === 'US' ? BEDROCK_US_CONFIG : BEDROCK_CANADA_CONFIG);
    // All regions must succeed: a partial count must never become a campaign plan.
    const scans = await Promise.all(targets.map(region => service.countStormTerritoryPins(boundary, region, true)));
    const pins = scans.flatMap(scan => scan.addresses.map((address, index) => ({ id: scan.ids[index], lon: Number(address.lon), lat: Number(address.lat) })));
    if (pins.some(pin => !Number.isFinite(pin.lon) || !Number.isFinite(pin.lat))) throw new Error('Some addresses have invalid coordinates.');
    const parts = partitionStormCampaigns(boundary, pins);
    return NextResponse.json({ parts, name: parsed.data.name, context: { ...parsed.data.context, territoryId: body.territoryId, selectedAt: new Date().toISOString() } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return stormError(error); }
}
