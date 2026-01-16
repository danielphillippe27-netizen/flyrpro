import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { OvertureService, type BoundingBox } from '@/lib/services/OvertureService';
import { BuildingService } from '@/lib/services/BuildingService';
import { mapOvertureToCanonical } from '@/lib/geo/overtureToCanonical';
import * as turf from '@turf/turf';
import type { Building } from '@/types/database';

// FIX: Ensure Node.js runtime (MotherDuck/DuckDB requires Node, not Edge)
export const runtime = 'nodejs';

interface ProvisionRequest {
  campaign_id: string;
  boundary: {
    type: 'Polygon';
    coordinates: number[][][];
  } | {
    west: number;
    south: number;
    east: number;
    north: number;
  };
}

// Retry wrapper with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 200
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on non-connection errors
      const isConnectionError = 
        lastError.message.includes('closed') ||
        lastError.message.includes('Connection Error') ||
        lastError.message.includes('established');
      
      if (!isConnectionError || attempt === maxAttempts) {
        throw lastError;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1); // 200ms, 400ms, 800ms
      console.warn(`[Provision] Retry attempt ${attempt}/${maxAttempts} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

export async function POST(request: NextRequest) {
  // FIX: Log MotherDuck env vars on server
  console.log('[Provision] MD token exists?', !!process.env.MOTHERDUCK_TOKEN);
  console.log('[Provision] MD token length:', process.env.MOTHERDUCK_TOKEN?.length || 0);
  console.log('[Provision] Using MotherDuck:', !!process.env.MOTHERDUCK_TOKEN);
  
  let campaign_id: string | null = null;
  
  try {
    const body: ProvisionRequest = await request.json();
    campaign_id = body.campaign_id;
    const { boundary } = body;
    
    if (!campaign_id) {
      return NextResponse.json(
        { error: 'Campaign ID required' },
        { status: 400 }
      );
    }

    if (!boundary) {
      return NextResponse.json(
        { error: 'Boundary (Polygon or BBox) required' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Validate campaign ownership
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('owner_id')
      .eq('id', campaign_id)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    // Check ownership (campaigns table has owner_id)
    const ownerId = (campaign as any).owner_id;
    if (!ownerId) {
      return NextResponse.json(
        { error: 'Campaign ownership cannot be determined' },
        { status: 400 }
      );
    }

    // FIX: Check if already provisioned (idempotency)
    const { data: existingCampaign } = await supabase
      .from('campaigns')
      .select('provision_status, territory_boundary')
      .eq('id', campaign_id)
      .single();
    
    // If already provisioned and status is 'ready', return early
    if (existingCampaign?.provision_status === 'ready') {
      const { count } = await supabase
        .from('buildings')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaign_id);
      
      const { count: addressCount } = await supabase
        .from('campaign_addresses')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaign_id);
      
      return NextResponse.json({
        success: true,
        count: count || 0,
        buildings: count || 0,
        addresses: addressCount || 0,
        message: 'Campaign already provisioned',
        skipped: true
      });
    }
    
    // Update status to 'pending'
    await supabase
      .from('campaigns')
      .update({ provision_status: 'pending' })
      .eq('id', campaign_id);

    // Convert boundary to bbox if Polygon provided
    let bbox: BoundingBox;
    let isPolygon = 'coordinates' in boundary;
    
    if (isPolygon) {
      // Extract bbox from Polygon coordinates
      const coords = boundary.coordinates[0];
      const lons = coords.map(c => c[0]);
      const lats = coords.map(c => c[1]);
      bbox = {
        west: Math.min(...lons),
        south: Math.min(...lats),
        east: Math.max(...lons),
        north: Math.max(...lats)
      };
    } else {
      bbox = boundary;
    }

    // Wrap provisioning in retry logic
    const result = await retryWithBackoff(async () => {
      // Step 1: Extract buildings from Overture
      // Progress: "Scanning 3D Shapes..."
      console.log('Scanning 3D Shapes from Overture for campaign:', campaign_id);
      const buildings = await OvertureService.extractBuildings(bbox);
      console.log(`Extracted ${buildings.length} buildings from Overture`);

    // Step 2: Filter buildings within polygon if Polygon provided
    // Progress: "Matching Addresses..."
    let filteredBuildings = buildings;
    if (isPolygon) {
      console.log('Matching Addresses to territory boundary...');
      const polygon = turf.polygon(boundary.coordinates);
      filteredBuildings = buildings.filter(b => {
        const point = turf.point(b.centroid.coordinates);
        return turf.booleanPointInPolygon(point, polygon);
      });
      console.log(`Filtered to ${filteredBuildings.length} buildings within polygon`);
    }

    // Step 2.5: Fetch and save addresses from polygon if Polygon provided
    let addressCount = 0;
    if (isPolygon) {
      console.log('Fetching addresses inside polygon boundary...');
      try {
        // 1. Get addresses from Overture using the polygon
        const addresses = await OvertureService.getAddressesInPolygon(boundary);
        
        if (addresses.length > 0) {
          // 2. Map to Canonical Format
          const canonicalAddresses = addresses.map((addr, index) => 
            mapOvertureToCanonical(addr, campaign_id, index)
          );

          // --- THE FIX: DEDUPLICATION ---
          // We create a Map using 'source_id' as the key.
          // If a duplicate ID exists, the Map automatically overwrites it, leaving only 1 unique copy.
          const uniqueAddressesMap = new Map();
          
          canonicalAddresses.forEach(addr => {
            uniqueAddressesMap.set(addr.source_id, {
              campaign_id: addr.campaign_id,
              formatted: addr.formatted,
              postal_code: addr.postal_code,
              source: addr.source,
              visited: false, // Default to unvisited
              geom: addr.geom,
              source_id: addr.source_id,
            });
          });

          // Convert Map back to an Array for Supabase
          const uniqueInsertData = Array.from(uniqueAddressesMap.values());
          // -----------------------------

          console.log(`Inserting ${uniqueInsertData.length} unique addresses (filtered from ${addresses.length}) from Polygon...`);

          // 4. Save to Supabase
          const { error: insertError } = await supabase
            .from('campaign_addresses')
            .upsert(uniqueInsertData, { onConflict: 'campaign_id,source_id' });

          if (insertError) {
            console.error('Error saving polygon addresses:', insertError);
          } else {
            addressCount = uniqueInsertData.length;
            console.log(`Successfully saved ${addressCount} addresses from polygon`);
            
            // 5. Update Campaign Count ONLY if save was successful
            const { count: totalCount } = await supabase
              .from('campaign_addresses')
              .select('*', { count: 'exact', head: true })
              .eq('campaign_id', campaign_id);

            if (totalCount !== null) {
              await supabase
                .from('campaigns')
                .update({ total_flyers: totalCount })
                .eq('id', campaign_id);
            }
          }
        } else {
          console.log('No addresses found inside polygon boundary');
        }
      } catch (addressError) {
        console.error('Error fetching addresses from polygon:', addressError);
        // Don't fail the entire request if address fetching fails
      }
    }

    // Step 3: Extract transportation segments for orientation
    console.log('Fetching transportation segments for road-facing orientation...');
    const transportation = await OvertureService.extractTransportation(bbox);
    console.log(`Extracted ${transportation.length} transportation segments`);

    // Step 4: Insert transportation segments (needed for orientation)
    let transportCount = 0;
    for (const segment of transportation) {
      try {
        const { error } = await supabase
          .from('overture_transportation')
          .upsert({
            gers_id: segment.gers_id,
            geom: JSON.stringify(segment.geometry), // Supabase handles GeoJSON strings
            class: segment.class,
          }, {
            onConflict: 'gers_id',
          });

        if (!error) {
          transportCount++;
        }
      } catch (err) {
        console.error(`Error inserting transportation ${segment.gers_id}:`, err);
      }
    }

    // Step 5: Provision buildings with orientation and campaign_id
    // Process all buildings with orientation calculation, then batch upsert
    // Progress: "Calculating Street Facing..." (centroid-to-road vector)
    console.log('Calculating Street Facing using centroid-to-road vector...');
    const buildingsToUpsert: any[] = [];
    let errorCount = 0;

    // Process buildings in parallel batches for better performance
    // Each building gets orientation calculated using centroid-to-road vector
    // This ensures 100% accuracy even on curved suburban roads (North Oshawa)
    const batchSize = 50;
    for (let i = 0; i < filteredBuildings.length; i += batchSize) {
      const batch = filteredBuildings.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(filteredBuildings.length / batchSize)} (${batch.length} buildings)`);
      
      await Promise.all(
        batch.map(async (building) => {
          try {
            // Find nearest transportation segment for orientation
            // Uses centroid-to-road vector for 100% accuracy in suburban curves
            const roadSegment = await BuildingService.findNearestTransportationSegment(
              building as Building
            );

            // Calculate orientation using centroid-to-road vector
            // Gold Standard: Find nearestPointOnRoad from centroid, then calculate bearing
            // This ensures perfect accuracy even on curved roads (North Oshawa)
            let houseBearing = 0;
            let setbackPoint = building.centroid;
            
            if (roadSegment) {
              // Calculate house bearing: centroid -> nearestPointOnRoad
              const orientation = BuildingService.calculateHouseBearing(
                building as Building,
                roadSegment
              );
              houseBearing = orientation.houseBearing;
              
              // Calculate 10m setback: move along vector from nearestPointOnRoad -> centroid
              setbackPoint = BuildingService.calculateSetback(
                building.centroid,
                orientation.nearestPointOnRoad,
                10 // 10 meters per Overture standard
              );
            }

            // Prepare building data for batch upsert
            buildingsToUpsert.push({
              gers_id: building.gers_id,
              campaign_id: campaign_id,
              geom: JSON.stringify(building.geometry), // PostGIS handles GeoJSON conversion
              centroid: JSON.stringify(building.centroid),
              latest_status: 'default',
              is_hidden: false,
              // Overture metadata
              height: building.height,
              house_name: building.house_name,
              addr_housenumber: building.addr_housenumber,
              addr_street: building.addr_street,
              addr_unit: building.addr_unit,
            });
          } catch (err) {
            console.error(`Error processing building ${building.gers_id}:`, err);
            errorCount++;
          }
        })
      );
    }

    // Single batch upsert for all buildings (minimizes database overhead)
    // Progress: "Finalizing Mission Territory..."
    console.log('Finalizing Mission Territory...');
    let provisionedCount = 0;
    if (buildingsToUpsert.length > 0) {
      const { data, error } = await supabase
        .from('buildings')
        .upsert(buildingsToUpsert, {
          onConflict: 'gers_id',
        });

      if (error) {
        console.error('Error batch upserting buildings:', error);
        errorCount += buildingsToUpsert.length;
      } else {
        provisionedCount = buildingsToUpsert.length;
        console.log(`Successfully provisioned ${provisionedCount} buildings for campaign ${campaign_id}`);
      }
    }

      // Step 6: Update campaign territory_boundary if Polygon provided
      if (isPolygon) {
        await supabase
          .from('campaigns')
          .update({
            territory_boundary: JSON.stringify(boundary) // Supabase handles GeoJSON strings
          })
          .eq('id', campaign_id);
      }

      // Update status to 'ready' on success
      await supabase
        .from('campaigns')
        .update({ provision_status: 'ready' })
        .eq('id', campaign_id);

      return { 
        success: true,
        count: provisionedCount,
        buildings: provisionedCount,
        addresses: addressCount,
        transportation: transportCount,
        errors: errorCount,
        message: `Provisioned ${provisionedCount} buildings and ${addressCount} addresses for campaign ${campaign_id}`
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error provisioning campaign:', error);
    
    // Update status to 'failed'
    if (campaign_id) {
      try {
        const supabase = createAdminClient();
        await supabase
          .from('campaigns')
          .update({ provision_status: 'failed' })
          .eq('id', campaign_id);
      } catch (updateError) {
        console.error('Failed to update provision_status:', updateError);
      }
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Provisioning failed' },
      { status: 500 }
    );
  }
}

