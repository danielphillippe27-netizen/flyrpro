import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  ensureCachedCampaignAccess,
  getCachedCampaignSnapshot,
  resolveCachedTileUser,
} from '@/app/api/campaigns/_utils/tile-cache';
import {
  bboxFromPositions,
  fetchScopedPmtilesParcels,
  flattenPositions,
  normalizeParcelGeoJsonPolygon,
  parcelTilesFromSnapshot,
  parseParcelBbox,
  type ScopedParcelResult,
} from '@/app/api/campaigns/_utils/scoped-pmtiles-parcels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PARCEL_FAILURE_CACHE_TTL_MS = 5 * 60 * 1000;
const PARCEL_FINAL_RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000;
const PARCEL_FINAL_RESPONSE_CACHE_MAX_ENTRIES = 128;
const parcelFailureCache = new Map<string, number>();
const parcelFinalResponseCache = new Map<string, { expiresAt: number; body: string; featureCount: number }>();

type CampaignScopeRow = {
  bbox: unknown;
  territory_boundary: GeoJSON.Polygon | string | null;
};

function getParcelFailureCacheKey(campaignId: string, pmtilesKey: string) {
  return `${campaignId}:${pmtilesKey}`;
}

function hasCachedParcelFailure(cacheKey: string) {
  const expiresAt = parcelFailureCache.get(cacheKey);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    parcelFailureCache.delete(cacheKey);
    return false;
  }
  return true;
}

function cacheParcelFailure(cacheKey: string) {
  parcelFailureCache.set(cacheKey, Date.now() + PARCEL_FAILURE_CACHE_TTL_MS);
}

function elapsedMs(started: number) {
  return Math.round((performance.now() - started) * 100) / 100;
}

function parcelTimingHeader(
  routeTimings: Record<string, number>,
  scoped?: ScopedParcelResult,
  finalCacheStatus?: 'hit' | 'miss'
) {
  return [
    ...Object.entries(routeTimings).map(([key, value]) => `${key};dur=${value}`),
    ...(finalCacheStatus ? [`final_cache;desc="${finalCacheStatus}"`] : []),
    ...(scoped
      ? [
          `cache;desc="${scoped.cacheStatus}"`,
          `artifact;dur=${Math.round(scoped.timings.artifactMs)}`,
          `header;dur=${Math.round(scoped.timings.headerMs)}`,
          `tiles;dur=${Math.round(scoped.timings.tileMs)}`,
          `filter;dur=${Math.round(scoped.timings.filterMs)}`,
          `total;dur=${Math.round(scoped.timings.totalMs)}`,
        ]
      : []),
  ].join(', ');
}

function timingHeaders(value: string) {
  return {
    'Server-Timing': value,
    'X-WolfGrid-Server-Timing': value,
  };
}

function finalParcelResponseCacheKey(params: {
  campaignId: string;
  signature: string | null;
  pmtilesKey: string;
  snapshotCreatedAt: string | null;
  bbox: [number, number, number, number];
  boundary: GeoJSON.Polygon | null;
}) {
  return [
    params.campaignId,
    params.signature ?? 'no-signature',
    params.pmtilesKey,
    params.snapshotCreatedAt ?? '',
    JSON.stringify(params.bbox),
    JSON.stringify(params.boundary),
  ].join('|');
}

function getCachedFinalParcelResponse(cacheKey: string) {
  const entry = parcelFinalResponseCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    parcelFinalResponseCache.delete(cacheKey);
    return null;
  }
  return entry;
}

function setCachedFinalParcelResponse(cacheKey: string, body: string, featureCount: number) {
  parcelFinalResponseCache.set(cacheKey, {
    expiresAt: Date.now() + PARCEL_FINAL_RESPONSE_CACHE_TTL_MS,
    body,
    featureCount,
  });

  if (parcelFinalResponseCache.size > PARCEL_FINAL_RESPONSE_CACHE_MAX_ENTRIES) {
    const oldestKey = parcelFinalResponseCache.keys().next().value as string | undefined;
    if (oldestKey) parcelFinalResponseCache.delete(oldestKey);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const routeStarted = performance.now();
  const routeTimings: Record<string, number> = {};
  const { campaignId } = await params;
  const authStarted = performance.now();
  const requestUser = await resolveCachedTileUser(request);
  routeTimings.auth = elapsedMs(authStarted);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accessStarted = performance.now();
  const supabase = createAdminClient();
  const allowed = await ensureCachedCampaignAccess(supabase, campaignId, requestUser.id);
  routeTimings.access = elapsedMs(accessStarted);
  if (!allowed) {
    return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }

  const scopeStarted = performance.now();
  const [{ data: campaign, error: campaignError }, snapshot] = await Promise.all([
    supabase
      .from('campaigns')
      .select('bbox, territory_boundary')
      .eq('id', campaignId)
      .maybeSingle(),
    getCachedCampaignSnapshot(supabase, campaignId),
  ]);
  routeTimings.scope = elapsedMs(scopeStarted);

  if (campaignError || !campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  if (!snapshot) {
    routeTimings.route = elapsedMs(routeStarted);
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'private, max-age=60',
        ...timingHeaders(parcelTimingHeader(routeTimings)),
      },
    });
  }

  const campaignScope = campaign as CampaignScopeRow;
  const boundary = normalizeParcelGeoJsonPolygon(campaignScope.territory_boundary);
  const bbox = parseParcelBbox(campaignScope.bbox) ?? (boundary ? bboxFromPositions(flattenPositions(boundary)) : null);
  if (!bbox) {
    routeTimings.route = elapsedMs(routeStarted);
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'private, max-age=60',
        ...timingHeaders(parcelTimingHeader(routeTimings)),
      },
    });
  }

  const parcelTiles = parcelTilesFromSnapshot(snapshot);
  if (!parcelTiles) {
    routeTimings.route = elapsedMs(routeStarted);
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'private, max-age=60',
        ...timingHeaders(parcelTimingHeader(routeTimings)),
      },
    });
  }

  const signatureStarted = performance.now();
  const { data: bundleMeta } = await supabase
    .from('campaign_map_bundles')
    .select('asset_signature, source_version')
    .eq('campaign_id', campaignId)
    .eq('is_current', true)
    .maybeSingle();
  routeTimings.signature = elapsedMs(signatureStarted);

  const cacheKey = finalParcelResponseCacheKey({
    campaignId,
    signature:
      typeof bundleMeta?.asset_signature === 'string'
        ? bundleMeta.asset_signature
        : typeof bundleMeta?.source_version === 'string'
          ? bundleMeta.source_version
          : null,
    pmtilesKey: parcelTiles.pmtilesKey,
    snapshotCreatedAt: snapshot.created_at ?? null,
    bbox,
    boundary,
  });
  const cachedFinalResponse = getCachedFinalParcelResponse(cacheKey);
  if (cachedFinalResponse) {
    routeTimings.route = elapsedMs(routeStarted);
    return new Response(cachedFinalResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=60',
        ...timingHeaders(parcelTimingHeader(routeTimings, undefined, 'hit')),
        'X-WolfGrid-Parcels-Cache': 'final-hit',
        'X-WolfGrid-Parcels-Features': String(cachedFinalResponse.featureCount),
      },
    });
  }

  const failureCacheKey = getParcelFailureCacheKey(campaignId, parcelTiles.pmtilesKey);
  if (hasCachedParcelFailure(failureCacheKey)) {
    routeTimings.route = elapsedMs(routeStarted);
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'private, max-age=60',
        ...timingHeaders(parcelTimingHeader(routeTimings)),
        'X-WolfGrid-Parcels-Suppressed': 'cached-failure',
      },
    });
  }

  try {
    const scoped = await fetchScopedPmtilesParcels(campaignId, snapshot, parcelTiles, bbox, boundary);
    const body = JSON.stringify(scoped.parcels);
    setCachedFinalParcelResponse(cacheKey, body, scoped.parcels.length);
    routeTimings.route = elapsedMs(routeStarted);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'private, max-age=60',
        ...timingHeaders(parcelTimingHeader(routeTimings, scoped, 'miss')),
        'X-WolfGrid-Parcels-Cache': scoped.cacheStatus,
        'X-WolfGrid-Parcels-Tiles': String(scoped.timings.tileCount),
        'X-WolfGrid-Parcels-Features': String(scoped.timings.featureCount),
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('403')) {
      cacheParcelFailure(failureCacheKey);
      console.warn('[CampaignParcels] Parcel PMTiles access denied; suppressing retries temporarily:', {
        campaignId,
        error: errorMessage,
      });
      routeTimings.route = elapsedMs(routeStarted);
      return NextResponse.json([], {
        headers: {
          'Cache-Control': 'private, max-age=60',
          ...timingHeaders(parcelTimingHeader(routeTimings)),
          'X-WolfGrid-Parcels-Suppressed': 'access-denied',
        },
      });
    }

    console.error('[CampaignParcels] Failed to extract scoped parcels:', {
      campaignId,
      error: errorMessage,
    });
    routeTimings.route = elapsedMs(routeStarted);
    return NextResponse.json({ error: 'Failed to extract campaign parcels' }, { status: 500 });
  }
}
