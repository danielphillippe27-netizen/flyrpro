import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { OvertureService } from '@/lib/services/OvertureService';

// FIX: Ensure Node.js runtime (MotherDuck/DuckDB requires Node, not Edge)
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { bbox, campaignId } = await request.json();
    
    if (!campaignId) {
      return NextResponse.json(
        { error: 'Campaign ID required' },
        { status: 400 }
      );
    }

    if (!bbox || !bbox.west || !bbox.south || !bbox.east || !bbox.north) {
      return NextResponse.json(
        { error: 'Bounding box required (west, south, east, north)' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Step 1: Extract buildings from Overture
    console.log('Fetching 3D Shapes from Overture...');
    const buildings = await OvertureService.extractBuildings(bbox);
    console.log(`Extracted ${buildings.length} buildings`);

    // Step 2: Extract transportation segments
    console.log('Fetching Transportation Segments...');
    const transportation = await OvertureService.extractTransportation(bbox);
    console.log(`Extracted ${transportation.length} transportation segments`);

    // Step 3: Insert buildings into Supabase
    console.log('Calculating Street Facing...');
    let buildingCount = 0;
    for (const building of buildings) {
      try {
        const { error } = await supabase
          .from('buildings')
          .upsert({
            gers_id: building.gers_id,
            geom: JSON.stringify(building.geometry), // MultiPolygon
            centroid: JSON.stringify(building.centroid), // Point
            latest_status: 'default',
            is_hidden: false,
            // Overture metadata
            height: building.height,
            house_name: building.house_name,
            addr_housenumber: building.addr_housenumber,
            addr_street: building.addr_street,
            addr_unit: building.addr_unit,
          }, {
            onConflict: 'gers_id',
          });

        if (!error) {
          buildingCount++;
        } else {
          console.error(`Error inserting building ${building.gers_id}:`, error);
        }
      } catch (err) {
        console.error(`Error processing building ${building.gers_id}:`, err);
      }
    }

    // Step 4: Insert transportation segments
    console.log('Grounding Houses...');
    let transportCount = 0;
    for (const segment of transportation) {
      try {
        const { error } = await supabase
          .from('overture_transportation')
          .upsert({
            gers_id: segment.gers_id,
            geom: JSON.stringify(segment.geometry), // LineString
            class: segment.class,
          }, {
            onConflict: 'gers_id',
          });

        if (!error) {
          transportCount++;
        } else {
          console.error(`Error inserting transportation ${segment.gers_id}:`, error);
        }
      } catch (err) {
        console.error(`Error processing transportation ${segment.gers_id}:`, err);
      }
    }

    return NextResponse.json({ 
      success: true, 
      count: buildingCount,
      buildings: buildingCount,
      transportation: transportCount,
      message: `Synced ${buildingCount} buildings and ${transportCount} transportation segments`
    });
  } catch (error) {
    console.error('Error syncing neighborhood:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}

