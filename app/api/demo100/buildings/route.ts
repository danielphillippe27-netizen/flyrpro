import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';
import { fetchScopedPmtilesBuildingFeatures } from '@/app/api/campaigns/_utils/scoped-pmtiles-buildings';
import { resolveCampaignRegion } from '@/lib/geo/regionResolver';
import type { CampaignSnapshotRow } from '@/lib/diamond/geometry';
import {
  BedrockCountryService,
  BEDROCK_CANADA_CONFIG,
  BEDROCK_SOUTH_AFRICA_CONFIG,
  BEDROCK_UK_CONFIG,
  BEDROCK_US_CONFIG,
} from '@/lib/services/BedrockCountryService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BUILDINGS = 1000;
const MAX_BBOX_SPAN_DEGREES = 0.3;

function validPolygon(value: unknown): value is GeoJSON.Polygon {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GeoJSON.Polygon>;
  if (candidate.type !== 'Polygon' || !Array.isArray(candidate.coordinates)) return false;
  try {
    const bbox = turf.bbox(turf.feature(candidate as GeoJSON.Polygon));
    return bbox.length === 4
      && bbox.every(Number.isFinite)
      && bbox[2] > bbox[0]
      && bbox[3] > bbox[1]
      && bbox[2] - bbox[0] <= MAX_BBOX_SPAN_DEGREES
      && bbox[3] - bbox[1] <= MAX_BBOX_SPAN_DEGREES;
  } catch {
    return false;
  }
}

function serviceForRegion(regionCode: string) {
  const code = regionCode.toUpperCase();
  if (['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'].includes(code)) {
    return new BedrockCountryService(BEDROCK_CANADA_CONFIG);
  }
  if (['EC', 'FS', 'GP', 'KZN', 'LP', 'MP', 'NC', 'NW', 'WC', 'ZA'].includes(code)) {
    return new BedrockCountryService(BEDROCK_SOUTH_AFRICA_CONFIG);
  }
  if (code === 'GB') return new BedrockCountryService(BEDROCK_UK_CONFIG);
  return new BedrockCountryService(BEDROCK_US_CONFIG);
}

function snapshotRow(snapshot: Awaited<ReturnType<BedrockCountryService['staticSnapshotForCampaign']>>): CampaignSnapshotRow {
  return {
    bucket: snapshot.bucket,
    prefix: snapshot.prefix ?? null,
    buildings_key: snapshot.s3_keys?.buildings ?? null,
    addresses_key: snapshot.s3_keys?.addresses ?? null,
    buildings_url: snapshot.urls?.buildings ?? null,
    metadata_key: snapshot.s3_keys?.metadata ?? null,
    buildings_count: snapshot.counts?.buildings ?? null,
    created_at: null,
    tile_metrics: snapshot.metadata?.tile_metrics as Record<string, unknown> | null ?? null,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as { polygon?: unknown } | null;
    if (!validPolygon(body?.polygon)) {
      return NextResponse.json({ error: 'Choose a smaller valid territory.' }, { status: 400 });
    }

    const polygon = body.polygon;
    const bbox = turf.bbox(turf.feature(polygon)) as [number, number, number, number];
    const region = await resolveCampaignRegion({ polygon, bbox });
    const service = serviceForRegion(region.regionCode);
    const snapshot = await service.staticSnapshotForCampaign('demo100-preview', region.regionCode);
    const collection = await fetchScopedPmtilesBuildingFeatures(
      snapshotRow(snapshot),
      bbox,
      new Set(),
      polygon,
    );
    const features = collection?.features ?? [];

    if (features.length < 4) {
      return NextResponse.json({ error: 'Fewer than four complete homes were found in this territory.' }, { status: 422 });
    }
    if (features.length > MAX_BUILDINGS) {
      return NextResponse.json({ error: 'This territory contains more than 1,000 homes. Make it smaller.' }, { status: 422 });
    }

    return NextResponse.json({
      type: 'FeatureCollection',
      features,
      region: region.regionCode,
      source: 'scoped-pmtiles-geojson',
    });
  } catch (error) {
    console.error('[Demo100] Failed to create scoped building GeoJSON:', error);
    return NextResponse.json(
      { error: 'WolfGrid could not finish this 3D map. Try the territory again.' },
      { status: 500 },
    );
  }
}
