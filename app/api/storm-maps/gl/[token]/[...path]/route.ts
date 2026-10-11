import { NextRequest, NextResponse } from 'next/server';
import { verifyStormMapsTileToken } from '@/lib/storm-maps/token';
import { resolveGLRequest, allowedVectorProducts } from '@/lib/storm-maps/gl-proxy-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ORIGIN = 'https://prod.v1.mapsgl.api.xweather.com';

type Context = { params: Promise<{ token: string; path: string[] }> };

async function proxy(request: NextRequest, context: Context) {
  const { token, path } = await context.params;
  const sessionWorkspace = token.startsWith('session-') ? token.slice(8) : null;
  const capability = verifyStormMapsTileToken(sessionWorkspace ? request.cookies.get(`storm-gl-${sessionWorkspace}`)?.value || '' : token);
  if (sessionWorkspace && capability?.workspaceId !== sessionWorkspace) return NextResponse.json({ error: 'Weather workspace session expired' }, { status: 401 });
  if (!capability || !capability.approvedTiles.some((tile) => tile.startsWith('xweather:'))) {
    return NextResponse.json({ error: 'Storm Maps session expired' }, { status: 401 });
  }
  const destination = resolveGLRequest(path, request.method);
  if (!destination || (destination.kind === 'vectorMetadata' && !allowedVectorProducts(request.nextUrl.searchParams.getAll('products')))) {
    return NextResponse.json({ error: 'Unsupported weather request' }, { status: 404 });
  }
  const isAuth = destination.kind === 'auth';
  const isImage = destination.kind === 'image';
  const isMaps = destination.kind === 'maps';
  const isApi = destination.kind === 'api';
  const headers: Record<string, string> = {};
  if (isAuth) {
    const id = process.env.XWEATHER_CLIENT_ID;
    const secret = process.env.XWEATHER_CLIENT_SECRET;
    if (!id || !secret) return NextResponse.json({ error: 'MapsGL credentials are not configured' }, { status: 503 });
    headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (!isMaps && !isApi) {
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return NextResponse.json({ error: 'Weather session required' }, { status: 401 });
    headers.Authorization = authorization;
    if (isImage) headers['Content-Type'] = 'application/json';
  }
  try {
    const mapsKey = `${process.env.XWEATHER_CLIENT_ID}_${process.env.XWEATHER_CLIENT_SECRET}`;
    if ((isMaps || isApi) && (!process.env.XWEATHER_CLIENT_ID || !process.env.XWEATHER_CLIENT_SECRET)) return NextResponse.json({ error: 'Weather credentials are not configured' }, { status: 503 });
    const url = isMaps
      ? new URL(`/${mapsKey}/${destination.upstream}`, 'https://maps.aerisapi.com')
      : new URL(`/${destination.upstream}`, isApi ? 'https://data.api.xweather.com' : ORIGIN);
    url.search = request.nextUrl.search;
    if (isApi) {
      url.search = '';
      url.searchParams.set('client_id', process.env.XWEATHER_CLIENT_ID!);
      url.searchParams.set('client_secret', process.env.XWEATHER_CLIENT_SECRET!);
      url.searchParams.set('filter', 'active,dateline');
      url.searchParams.set('limit', '1000');
      for (const key of ['from', 'to']) {
        const value = request.nextUrl.searchParams.get(key);
        if (value && /^[\dT:Z.+-]+$/.test(value)) url.searchParams.set(key, value);
      }
    }
    const upstream = await fetch(url, {
      method: request.method, headers,
      body: isAuth ? 'grant_type=client_credentials' : isImage ? await request.text() : undefined,
      signal: AbortSignal.timeout(20_000), cache: 'no-store',
    });
    if (!upstream.ok) return NextResponse.json({ error: 'Weather data is temporarily unavailable' }, { status: upstream.status });
    return new NextResponse(await upstream.arrayBuffer(), { headers: {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'private, no-store',
      ...(upstream.headers.get('x-aeris-valid-date') ? { 'x-aeris-valid-date': upstream.headers.get('x-aeris-valid-date')! } : {}),
      ...(upstream.headers.get('x-data-set-locs') ? { 'x-data-set-locs': upstream.headers.get('x-data-set-locs')! } : {}),
    } });
  } catch {
    return NextResponse.json({ error: 'Weather service timed out' }, { status: 502 });
  }
}
export const GET = proxy;
export const POST = proxy;
