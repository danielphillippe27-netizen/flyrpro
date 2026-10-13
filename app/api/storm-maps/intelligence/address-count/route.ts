import { createHash } from 'node:crypto';
import { bbox } from '@turf/turf';
import { NextRequest, NextResponse } from 'next/server';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
import { stormGeometrySchema } from '@/lib/storm-maps/intelligence/geometry';
import { resolveCampaignRegion, resolveAmbiguousRegionCountry } from '@/lib/geo/regionResolver';
import { BEDROCK_CANADA_CONFIG, BEDROCK_US_CONFIG, BedrockCountryService } from '@/lib/services/BedrockCountryService';
import { getCachedStormValue, setCachedStormValue } from '@/lib/storm-maps/cache';
import regions from '@/scripts/regions.json';
export const runtime = 'nodejs';
export const maxDuration = 180;
type Count = { count: number; zoom: 10; partial: boolean; regions: string[]; tiles: number; tileZooms: number[]; countedAt: string };
export async function POST(request: NextRequest) {
  const c = await stormContext(request); if ('response' in c) return c.response;
  const text = await request.text();
  if (text.length > 100_000) return NextResponse.json({ error: 'Boundary is too large.' }, { status: 413 });
  let raw: unknown; try { raw = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid boundary.' }, { status: 400 }); }
  const parsed = stormGeometrySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Choose a closed, non-crossing territory smaller than 5,000 km².' }, { status: 400 });
  const boundary = parsed.data;
  const key = `territory-address-count:z10:${c.workspaceId}:${createHash('sha256').update(JSON.stringify(boundary)).digest('hex')}`;
  const cached = await getCachedStormValue<Count>(key);
  if (cached) return NextResponse.json(cached.value, { headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const resolution = await resolveCampaignRegion({ polygon: boundary });
    if (resolution.source === 'default') throw new Error('Address region could not be determined.');
    const country = resolveAmbiguousRegionCountry(resolution.regionCode, boundary) ?? regions.find(row => row.code === resolution.regionCode)?.country;
    if (country !== 'US' && country !== 'CA') return NextResponse.json({ error: 'Zoom-10 address counts currently support U.S. and Canadian territories.' }, { status: 422 });
    const bounds = bbox(boundary);
    const targets = country === 'CA' ? [resolution.regionCode] : regions.filter(row => row.country === 'US' && row.bbox[0] <= bounds[2] && row.bbox[2] >= bounds[0] && row.bbox[1] <= bounds[3] && row.bbox[3] >= bounds[1]).map(row => row.code);
    if (!targets.length || targets.length > 6) throw new Error('Choose a smaller region to count address pins.');
    const service = new BedrockCountryService(country === 'US' ? BEDROCK_US_CONFIG : BEDROCK_CANADA_CONFIG);
    const parts=boundary.type==='Polygon'?[boundary]:boundary.coordinates.map(coordinates=>({type:'Polygon' as const,coordinates}));
    if(parts.length*targets.length>12) return NextResponse.json({error:'This territory requires indexed spatial counting. Select fewer neighbourhoods until the spatial migration is enabled.'},{status:422});
    const results = await Promise.allSettled(targets.flatMap(region=>parts.map(async part => ({ region, ...await service.countStormTerritoryPins(part, region) }))));
    const ids = new Set<string>(), covered: string[] = []; let tiles = 0;
    for (const result of results) if (result.status === 'fulfilled') { covered.push(result.value.region); tiles += result.value.tiles; for (const id of result.value.ids) ids.add(id); }
    if (!covered.length) throw new Error('Zoom-10 address data is unavailable here.');
    const data: Count = { count: ids.size, zoom: 10, tileZooms: [...new Set(results.flatMap(result => result.status === 'fulfilled' ? [result.value.tileZoom] : []))], partial: results.some(result=>result.status==='rejected'), regions: [...new Set(covered)], tiles, countedAt: new Date().toISOString() };
    await setCachedStormValue(key, data, 900, 900);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Address pin count unavailable. Retry or choose a smaller territory.' }, { status: 503 }); }
}
