import { NextRequest, NextResponse } from 'next/server';
// BuildingSyncService is dynamically imported to avoid DuckDB native module issues on Vercel
// import { BuildingSyncService, type BoundingBox } from '@/lib/services/BuildingSyncService';

// Ensure Node.js runtime (MotherDuck/DuckDB requires Node, not Edge)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { bbox, campaignId, region } = body;

    // Validate bbox
    if (!bbox || typeof bbox.west !== 'number' || typeof bbox.south !== 'number' || 
        typeof bbox.east !== 'number' || typeof bbox.north !== 'number') {
      return NextResponse.json(
        { error: 'Bounding box required with west, south, east, north (numbers)' },
        { status: 400 }
      );
    }

    // Validate bbox values
    const bboxObj: BoundingBox = {
      west: bbox.west,
      south: bbox.south,
      east: bbox.east,
      north: bbox.north,
    };

    if (
      bboxObj.west >= bboxObj.east ||
      bboxObj.south >= bboxObj.north ||
      bboxObj.west < -180 || bboxObj.west > 180 ||
      bboxObj.east < -180 || bboxObj.east > 180 ||
      bboxObj.south < -90 || bboxObj.south > 90 ||
      bboxObj.north < -90 || bboxObj.north > 90
    ) {
      return NextResponse.json(
        { error: 'Invalid bounding box: west < east, south < north, valid lat/lon ranges' },
        { status: 400 }
      );
    }

    // Check for MotherDuck token
    if (!process.env.MOTHERDUCK_TOKEN) {
      return NextResponse.json(
        { error: 'MOTHERDUCK_TOKEN environment variable not set' },
        { status: 500 }
      );
    }

    console.log(`[API] Starting building sync for bbox: [${bboxObj.west}, ${bboxObj.south}, ${bboxObj.east}, ${bboxObj.north}]`);
    if (campaignId) {
      console.log(`[API] Campaign ID: ${campaignId}`);
    }
    if (region) {
      console.log(`[API] Region: ${region}`);
    }

    // Dynamic import to avoid DuckDB native module issues on Vercel build
    const { BuildingSyncService } = await import('@/lib/services/BuildingSyncService');

    // Perform sync
    let result;
    if (region) {
      result = await BuildingSyncService.syncRegion(region, bboxObj);
    } else {
      result = await BuildingSyncService.syncBbox(bboxObj, campaignId);
    }

    console.log(`[API] Sync complete: ${result.created} created, ${result.updated} updated, ${result.errors} errors`);

    return NextResponse.json({
      success: true,
      result: {
        created: result.created,
        updated: result.updated,
        errors: result.errors,
        total: result.total,
      },
      message: `Synced ${result.total} buildings: ${result.created} created, ${result.updated} updated, ${result.errors} errors`,
    });
  } catch (error) {
    console.error('[API] Error syncing buildings:', error);
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Sync failed',
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
