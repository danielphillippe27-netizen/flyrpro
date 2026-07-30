import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function coordinate(params: URLSearchParams, key: string) {
  const value = Number(params.get(key));
  return Number.isFinite(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const auth = await requireFounderApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  const west = coordinate(params, 'west');
  const south = coordinate(params, 'south');
  const east = coordinate(params, 'east');
  const north = coordinate(params, 'north');
  if ([west, south, east, north].some((value) => value === null)) {
    return NextResponse.json(
      { error: 'west, south, east and north are required numeric coordinates' },
      { status: 400 },
    );
  }
  if (west! >= east! || south! >= north! || west! < -180 || east! > 180 || south! < -90 || north! > 90) {
    return NextResponse.json({ error: 'Invalid bounding box' }, { status: 400 });
  }
  const { data, error } = await auth.admin.rpc('search_territory_iq_dataset_coverage', {
    p_west: west,
    p_south: south,
    p_east: east,
    p_north: north,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    bbox: [west, south, east, north],
    datasets: data ?? [],
  });
}
