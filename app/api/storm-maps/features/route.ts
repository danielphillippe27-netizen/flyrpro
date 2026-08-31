import { NextRequest, NextResponse } from 'next/server';
import { getStormFeatures } from '@/lib/storm-maps/providers';
import { verifyStormMapsTileToken } from '@/lib/storm-maps/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseBbox(value: string | null): [number, number, number, number] | null {
  if (!value) return null;
  const values = value.split(',').map((part) => Number.parseFloat(part));
  if (values.length !== 4 || values.some((number) => !Number.isFinite(number))) return null;
  const [west, south, east, north] = values;
  if (west >= east || south >= north || west < -180 || east > -50 || south < 18 || north > 85) return null;
  return [west, south, east, north];
}

export async function GET(request: NextRequest) {
  if (!verifyStormMapsTileToken(request.nextUrl.searchParams.get('token') || '')) {
    return NextResponse.json({ error: 'Invalid or expired Storm Maps token' }, { status: 401 });
  }
  const bbox = parseBbox(request.nextUrl.searchParams.get('bbox'));
  if (!bbox) return NextResponse.json({ error: 'A valid Canada/U.S. bbox is required' }, { status: 400 });
  const alerts = request.nextUrl.searchParams.get('alerts') !== 'false';
  const outlook = request.nextUrl.searchParams.get('outlook') !== 'false';
  const reports = request.nextUrl.searchParams.get('reports') === 'true';
  const payload = await getStormFeatures(bbox, { alerts, outlook, reports });
  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'public, max-age=30',
      'Vercel-CDN-Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300',
      'Vercel-Cache-Tag': 'storm-maps-features',
    },
  });
}
