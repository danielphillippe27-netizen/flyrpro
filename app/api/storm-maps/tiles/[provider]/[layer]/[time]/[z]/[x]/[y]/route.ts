import { NextRequest, NextResponse } from 'next/server';
import { isProviderAllowedForLayer, isStormRasterLayerId } from '@/lib/storm-maps/catalog';
import { getStormMapTile } from '@/lib/storm-maps/providers';
import { isApprovedStormTileTime, stormTileIntersectsCoverage } from '@/lib/storm-maps/tile-policy';
import { verifyStormMapsTileToken } from '@/lib/storm-maps/token';
import type { StormMapsProvider } from '@/lib/storm-maps/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isProvider(value: string): value is StormMapsProvider {
  return value === 'tomorrow' || value === 'iem' || value === 'eccc';
}

function parseTileCoordinate(value: string, stripPng = false) {
  const normalized = stripPng ? value.replace(/\.png$/i, '') : value;
  return Number.parseInt(normalized, 10);
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ provider: string; layer: string; time: string; z: string; x: string; y: string }>;
  },
) {
  const token = request.nextUrl.searchParams.get('token') || '';
  const tokenPayload = verifyStormMapsTileToken(token);
  if (!tokenPayload) {
    return NextResponse.json({ error: 'Invalid or expired Storm Maps token' }, { status: 401 });
  }

  const params = await context.params;
  if (!isProvider(params.provider) || !isStormRasterLayerId(params.layer)) {
    return NextResponse.json({ error: 'Unknown Storm Maps provider or layer' }, { status: 404 });
  }
  if (!isProviderAllowedForLayer(params.provider, params.layer)) {
    return NextResponse.json({ error: 'Provider is not allowed for this layer' }, { status: 400 });
  }

  const z = parseTileCoordinate(params.z);
  const x = parseTileCoordinate(params.x);
  const y = parseTileCoordinate(params.y, true);
  const tileCount = 2 ** z;
  if (
    !Number.isInteger(z) || z < 1 || z > 12 ||
    !Number.isInteger(x) || x < 0 || x >= tileCount ||
    !Number.isInteger(y) || y < 0 || y >= tileCount
  ) {
    return NextResponse.json({ error: 'Invalid tile coordinates' }, { status: 400 });
  }
  const time = decodeURIComponent(params.time);
  if (!stormTileIntersectsCoverage(params.provider, z, x, y)) {
    return NextResponse.json({ error: 'Tile is outside Storm Maps coverage' }, { status: 400 });
  }
  if (!isApprovedStormTileTime(params.provider, params.layer, time, tokenPayload.approvedTiles)) {
    return NextResponse.json({ error: 'Timestamp is not allowed for this layer' }, { status: 400 });
  }

  try {
    const tile = await getStormMapTile({
      provider: params.provider,
      layerId: params.layer,
      time,
      z,
      x,
      y,
    });
    const maxAge = params.provider === 'tomorrow' ? 900 : 300;
    return new NextResponse(Buffer.from(tile.value.base64, 'base64'), {
      headers: {
        'Content-Type': tile.value.contentType,
        'Cache-Control': `public, max-age=${maxAge}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=1800`,
        'Vercel-Cache-Tag': `storm-maps-${params.provider}-${params.layer}`,
        'X-Storm-Maps-Source': tile.value.provider,
        'X-Storm-Maps-Stale': tile.stale ? '1' : '0',
      },
    });
  } catch (error) {
    const message = error instanceof Error && error.message.includes('budget')
      ? 'Forecast tile budget reached'
      : 'Weather tile is temporarily unavailable';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
