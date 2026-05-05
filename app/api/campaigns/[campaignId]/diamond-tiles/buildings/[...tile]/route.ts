import { NextRequest, NextResponse } from 'next/server';
import { PMTiles } from 'pmtiles';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import {
  type CampaignSnapshotRow,
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; tile: string[] }> }
) {
  const { campaignId, tile } = await params;
  const parsedTile = parseTile(tile);
  const startedAt = Date.now();
  const timings: Record<string, number> = {};
  const mark = (key: string, start: number) => {
    timings[key] = Date.now() - start;
  };
  const logTiming = (status: number, extra: Record<string, unknown> = {}) => {
    console.info('[DiamondTiles] Timing', {
      campaignId,
      tile: parsedTile,
      status,
      ...timings,
      totalMs: Date.now() - startedAt,
      ...extra,
    });
  };

  if (!parsedTile) {
    return NextResponse.json({ error: 'Invalid tile path' }, { status: 400 });
  }

  const authStartedAt = Date.now();
  const requestUser = await resolveUserFromRequest(request, {
    allowQueryToken: true,
    queryTokenParamNames: ['access_token', 'token'],
  });
  mark('authMs', authStartedAt);
  if (!requestUser) {
    logTiming(401);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const accessStartedAt = Date.now();
  const allowed = await ensureCampaignAccess(supabase, campaignId, requestUser.id);
  mark('accessMs', accessStartedAt);
  if (!allowed) {
    logTiming(404, { reason: 'access_denied' });
    return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }

  const snapshotStartedAt = Date.now();
  const { data: snapshot, error: snapshotError } = await supabase
    .from('campaign_snapshots')
    .select('bucket, prefix, buildings_key, buildings_url, metadata_key, buildings_count, created_at, tile_metrics')
    .eq('campaign_id', campaignId)
    .maybeSingle();
  mark('snapshotLookupMs', snapshotStartedAt);

  if (snapshotError) {
    logTiming(500, { reason: 'snapshot_error' });
    return NextResponse.json(
      { error: 'Failed to load campaign geometry snapshot', details: snapshotError.message },
      { status: 500 }
    );
  }

  if (!snapshot) {
    logTiming(404, { reason: 'snapshot_missing' });
    return NextResponse.json({ error: 'No geometry artifact snapshot exists for this campaign' }, { status: 404 });
  }

  const snapshotRow = snapshot as CampaignSnapshotRow;
  const pmtilesKey = resolvePmtilesKey(snapshotRow);
  if (!pmtilesKey) {
    logTiming(404, { reason: 'pmtiles_key_missing' });
    return NextResponse.json({ error: 'No PMTiles artifact key found for this campaign' }, { status: 404 });
  }

  const artifactUrlStartedAt = Date.now();
  const pmtilesUrl = await resolveArtifactUrl(snapshotRow, pmtilesKey);
  mark('artifactUrlMs', artifactUrlStartedAt);
  let result: Awaited<ReturnType<PMTiles['getZxy']>>;
  try {
    const getZxyStartedAt = Date.now();
    const archive = new PMTiles(pmtilesUrl);
    result = await archive.getZxy(parsedTile.z, parsedTile.x, parsedTile.y);
    mark('pmtilesGetZxyMs', getZxyStartedAt);
  } catch (error) {
    console.error('[DiamondTiles] Failed to read PMTiles tile:', {
      campaignId,
      pmtilesKey,
      tile: parsedTile,
      error: error instanceof Error ? error.message : String(error),
    });
    logTiming(204, { reason: 'pmtiles_read_error' });
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }

  if (!result) {
    logTiming(204, { reason: 'tile_missing' });
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  }

  logTiming(200, {
    bytes: result.data.byteLength,
    cacheControl: result.cacheControl ?? null,
  });
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
