import { NextRequest, NextResponse } from 'next/server';
import type { PMTiles } from 'pmtiles';
import { createAdminClient } from '@/lib/supabase/server';
import {
  ensureCachedCampaignAccess,
  getCachedCampaignSnapshot,
  getCachedPmtilesArchive,
  resolveCachedTileUser,
} from '@/app/api/campaigns/_utils/tile-cache';
import {
  type CampaignSnapshotRow,
  type ParcelPmtilesResolution,
  resolveArtifactUrl,
  resolvePmtilesKey,
} from '@/lib/diamond/geometry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseTile(tile: string[]) {
  if (tile.length !== 3) return null;
  const [zRaw, xRaw, yRaw] = tile;
  const yClean = yRaw.replace(/\.mvt$/i, '');
  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yClean);
  if (![z, x, y].every(Number.isInteger)) return null;
  return { z, x, y };
}

function stringMetric(metrics: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metrics?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberMetric(metrics: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = metrics?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parcelTilesFromSnapshot(snapshot: CampaignSnapshotRow | null): ParcelPmtilesResolution | null {
  const pmtilesKey = stringMetric(snapshot?.tile_metrics, 'parcels_pmtiles_key');
  if (!snapshot) return null;

  if (!pmtilesKey) {
    const buildingPmtilesKey = resolvePmtilesKey(snapshot);
    const isBedrockNzSnapshot =
      snapshot.tile_metrics?.bedrock_mode === true &&
      stringMetric(snapshot.tile_metrics, 'bedrock_country_code') === 'NZ' &&
      buildingPmtilesKey?.endsWith('/buildings/buildings.pmtiles');

    if (!isBedrockNzSnapshot || !buildingPmtilesKey) return null;

    const derivedPmtilesKey = buildingPmtilesKey.replace(/\/buildings\/buildings\.pmtiles$/i, '/parcels/parcels.pmtiles');
    return {
      bucket: snapshot.bucket,
      pmtilesKey: derivedPmtilesKey,
      tilejsonKey: derivedPmtilesKey.replace(/\.pmtiles$/i, '.json'),
      datePart: 'snapshot',
      sourceLayer: 'parcels',
      promoteId: 'parcel_id',
      minzoom: numberMetric(snapshot.tile_metrics, 'parcel_minzoom') ?? 10,
      maxzoom: numberMetric(snapshot.tile_metrics, 'parcel_maxzoom') ?? 16,
    };
  }

  return {
    bucket: snapshot.bucket,
    pmtilesKey,
    tilejsonKey:
      stringMetric(snapshot.tile_metrics, 'parcels_tilejson_key') ??
      pmtilesKey.replace(/\.pmtiles$/i, '.json'),
    datePart: 'snapshot',
    sourceLayer: 'parcels',
    promoteId: 'parcel_id',
    minzoom: numberMetric(snapshot.tile_metrics, 'parcel_minzoom') ?? 10,
    maxzoom: numberMetric(snapshot.tile_metrics, 'parcel_maxzoom') ?? 16,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; tile: string[] }> }
) {
  const { campaignId, tile } = await params;
  const parsedTile = parseTile(tile);
  if (!parsedTile) {
    return NextResponse.json({ error: 'Invalid tile path' }, { status: 400 });
  }

  const requestUser = await resolveCachedTileUser(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const allowed = await ensureCachedCampaignAccess(supabase, campaignId, requestUser.id);
  if (!allowed) {
    return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }

  let snapshot: CampaignSnapshotRow | null;
  try {
    snapshot = await getCachedCampaignSnapshot(supabase, campaignId);
  } catch (snapshotError) {
    return NextResponse.json(
      {
        error: 'Failed to load campaign geometry snapshot',
        details: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
      },
      { status: 500 }
    );
  }

  const parcelTiles = parcelTilesFromSnapshot(snapshot);
  if (!parcelTiles) {
    return NextResponse.json({ error: 'No parcel PMTiles artifact exists for this campaign region' }, { status: 404 });
  }

  let result: Awaited<ReturnType<PMTiles['getZxy']>>;
  try {
    const pmtilesUrl = await resolveArtifactUrl(snapshot!, parcelTiles.pmtilesKey);
    const archive = getCachedPmtilesArchive(pmtilesUrl);
    result = await archive.getZxy(parsedTile.z, parsedTile.x, parsedTile.y);
  } catch (error) {
    console.error('[ParcelTiles] Failed to read PMTiles tile:', {
      campaignId,
      pmtilesKey: parcelTiles.pmtilesKey,
      tile: parsedTile,
      error: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }

  if (!result) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  }

  return new NextResponse(result.data, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      'Cache-Control': result.cacheControl || 'public, max-age=86400, stale-while-revalidate=604800',
      ...(result.etag ? { ETag: result.etag } : {}),
      ...(result.expires ? { Expires: result.expires } : {}),
    },
  });
}
