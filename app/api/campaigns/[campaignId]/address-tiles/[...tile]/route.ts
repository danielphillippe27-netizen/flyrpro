import { NextRequest, NextResponse } from 'next/server';
import { gzipSync } from 'node:zlib';
import { campaignAddressOverviewTile, isNetsymsUsAddressKey } from '@/app/api/campaigns/_utils/campaign-address-overview-tile';
import type { PMTiles } from 'pmtiles';
import { createAdminClient } from '@/lib/supabase/server';
import {
  ensureCachedCampaignAccess,
  getCachedCampaignSnapshot,
  getCachedPmtilesArchive,
  resolveCachedTileUser,
} from '@/app/api/campaigns/_utils/tile-cache';
import { type CampaignSnapshotRow, resolveArtifactUrl } from '@/lib/diamond/geometry';

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
  if (z<0 || z>24 || x<0 || y<0 || x>=2**z || y>=2**z) return null;
  return { z, x, y };
}

function stringMetric(metrics: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metrics?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function addressPmtilesKey(snapshot: CampaignSnapshotRow | null): string | null {
  return (
    stringMetric(snapshot?.tile_metrics, 'addresses_pmtiles_key') ??
    (snapshot?.addresses_key?.endsWith('.pmtiles') ? snapshot.addresses_key : null)
  );
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

  let snapshotRow: CampaignSnapshotRow | null;
  try {
    snapshotRow = await getCachedCampaignSnapshot(supabase, campaignId);
  } catch (snapshotError) {
    return NextResponse.json(
      {
        error: 'Failed to load campaign geometry snapshot',
        details: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
      },
      { status: 500 }
    );
  }

  const pmtilesKey = addressPmtilesKey(snapshotRow);
  if (!snapshotRow || !pmtilesKey) {
    return NextResponse.json({ error: 'No address PMTiles artifact exists for this campaign' }, { status: 404 });
  }

  let result: Awaited<ReturnType<PMTiles['getZxy']>>;
  try {
    if (isNetsymsUsAddressKey(pmtilesKey)) {
      const data=await campaignAddressOverviewTile(supabase,campaignId,parsedTile);
      if(!data.length)return new NextResponse(null,{status:204,headers:{'Cache-Control':'private, max-age=30'}});
      const compressed=gzipSync(data);
      return new NextResponse(compressed.buffer.slice(compressed.byteOffset,compressed.byteOffset+compressed.byteLength),{
        headers:{'Content-Type':'application/vnd.mapbox-vector-tile','Content-Encoding':'gzip','Cache-Control':'private, max-age=30'},
      });
    }
    const pmtilesUrl = await resolveArtifactUrl(snapshotRow, pmtilesKey);
    const archive = getCachedPmtilesArchive(pmtilesUrl);
    result = await archive.getZxy(parsedTile.z, parsedTile.x, parsedTile.y);
  } catch (error) {
    console.error('[AddressTiles] Failed to read PMTiles tile:', {
      campaignId,
      pmtilesKey,
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

  const compressed=gzipSync(new Uint8Array(result.data));
  return new NextResponse(compressed.buffer.slice(compressed.byteOffset,compressed.byteOffset+compressed.byteLength), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      'Content-Encoding': 'gzip',
      'Cache-Control': result.cacheControl || 'public, max-age=86400, stale-while-revalidate=604800',
      ...(result.etag ? { ETag: result.etag } : {}),
      ...(result.expires ? { Expires: result.expires } : {}),
    },
  });
}
