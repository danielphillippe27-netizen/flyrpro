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
const parcelFailureCache = new Map<string, number>();

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

function parcelTimingHeader(routeTimings: Record<string, number>, scoped?: ScopedParcelResult) {
  return [
    ...Object.entries(routeTimings).map(([key, value]) => `${key};dur=${value}`),
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
        'Server-Timing': parcelTimingHeader(routeTimings),
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
        'Server-Timing': parcelTimingHeader(routeTimings),
      },
    });
  }

  const parcelTiles = parcelTilesFromSnapshot(snapshot);
  if (!parcelTiles) {
    routeTimings.route = elapsedMs(routeStarted);
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'private, max-age=60',
        'Server-Timing': parcelTimingHeader(routeTimings),
      },
    });
  }

  const failureCacheKey = getParcelFailureCacheKey(campaignId, parcelTiles.pmtilesKey);
  if (hasCachedParcelFailure(failureCacheKey)) {
    routeTimings.route = elapsedMs(routeStarted);
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'private, max-age=60',
        'Server-Timing': parcelTimingHeader(routeTimings),
        'X-FLYR-Parcels-Suppressed': 'cached-failure',
      },
    });
  }

  try {
    const scoped = await fetchScopedPmtilesParcels(campaignId, snapshot, parcelTiles, bbox, boundary);
    routeTimings.route = elapsedMs(routeStarted);
    return NextResponse.json(scoped.parcels, {
      headers: {
        'Cache-Control': 'private, max-age=60',
        'Server-Timing': parcelTimingHeader(routeTimings, scoped),
        'X-FLYR-Parcels-Cache': scoped.cacheStatus,
        'X-FLYR-Parcels-Tiles': String(scoped.timings.tileCount),
        'X-FLYR-Parcels-Features': String(scoped.timings.featureCount),
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
          'Server-Timing': parcelTimingHeader(routeTimings),
          'X-FLYR-Parcels-Suppressed': 'access-denied',
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
