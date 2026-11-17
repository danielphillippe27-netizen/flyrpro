import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { loadMapboxRoads } from '@/lib/services/ReconciliationMapboxRoads';
import { isCampaignBoundary, previewRoadBoundary, snapRoadPoints, ROAD_SNAP_METERS } from '@/lib/territory/road-boundary';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!(await resolveUserFromRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const points: unknown = body?.points;
  if (Array.isArray(points) && points.length > 0 && points.length <= 500 &&
    points.every(point => Array.isArray(point) && point.length === 2 &&
      point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 85)) {
    try {
      const buffered = turf.buffer(turf.multiPoint(points), ROAD_SNAP_METERS + 2, { units: 'meters' });
      if (!buffered) return NextResponse.json({ points });
      const [west, south, east, north] = turf.bbox(buffered);
      const roads = await loadMapboxRoads([[west, south], [east, north]], {
        signal: AbortSignal.timeout(8_000), includeUnnamed: true,
      });
      return NextResponse.json({ points: snapRoadPoints(points, roads) });
    } catch {
      return NextResponse.json({ error: 'Road snapping is temporarily unavailable.' }, { status: 503 });
    }
  }
  const polygon: unknown = body?.polygon;
  if (!isCampaignBoundary(polygon)) {
    return NextResponse.json({ error: 'Draw a valid campaign boundary.' }, { status: 400 });
  }

  try {
    const buffered = turf.buffer(polygon, ROAD_SNAP_METERS + 2, { units: 'meters' });
    if (!buffered) return NextResponse.json({ polygon: null });
    const [west, south, east, north] = turf.bbox(buffered);
    const roads = await loadMapboxRoads([[west, south], [east, north]], {
      signal: AbortSignal.timeout(8_000),
      includeUnnamed: true,
    });
    return NextResponse.json({ polygon: previewRoadBoundary(polygon, roads) });
  } catch {
    return NextResponse.json({ error: 'Road preview is temporarily unavailable.' }, { status: 503 });
  }
}
