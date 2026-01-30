import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { OvertureService } from '@/lib/services/OvertureService';

// FIX: Ensure Node.js runtime (MotherDuck/DuckDB requires Node, not Edge)
export const runtime = 'nodejs';

interface ProvisionRequest {
  campaign_id: string;
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
    
    if (!campaign_id) {
      return NextResponse.json(
        { error: 'Campaign ID required' },
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

    // SURGICAL PROVISIONING: Get campaign territory_boundary polygon
    console.log('[Provision] Surgical: Getting campaign territory boundary...');
    
    const { data: campaignData, error: campaignDataError } = await supabase
      .from('campaigns')
      .select('territory_boundary')
      .eq('id', campaign_id)
      .single();

    const polygon = campaignData?.territory_boundary;
    
    if (!polygon) {
      console.error('[Provision] No territory_boundary found for campaign');
      return NextResponse.json(
        { error: 'No territory boundary defined. Please draw a polygon on the map when creating the campaign.' },
        { status: 400 }
      );
    }
    
    console.log('[Provision] Surgical: Using polygon for precision filtering');

    // Update status to 'pending'
    await supabase
      .from('campaigns')
      .update({ provision_status: 'pending' })
      .eq('id', campaign_id);

    // Wrap provisioning in retry logic
    const result = await retryWithBackoff(async () => {
      // SURGICAL PROVISIONING: Fetch ONLY data inside the exact polygon
      // No Wide Net, no BBox corners grabbing neighbors
      console.log('[Provision] Surgical: Fetching addresses inside polygon from MotherDuck...');
      const addresses = await OvertureService.getAddressesInPolygon(polygon);
      console.log(`[Provision] Surgical: Fetched ${addresses.length} addresses`);

      console.log('[Provision] Surgical: Fetching buildings inside polygon from MotherDuck...');
      const buildings = await OvertureService.getBuildingsInPolygon(polygon);
      console.log(`[Provision] Surgical: Fetched ${buildings.length} buildings`);

      console.log('[Provision] Surgical: Fetching roads inside polygon from MotherDuck...');
      const roads = await OvertureService.getRoadsInPolygon(polygon);
      console.log(`[Provision] Surgical: Fetched ${roads.length} roads`);

      console.log('[Provision] Stable Linker: Preparing payloads for ingest...');
      
      // Helper: Validate GeoJSON has valid coordinates
      const isValidGeoJSON = (geojson: any): boolean => {
        if (!geojson || !geojson.type || !geojson.coordinates) return false;
        if (!Array.isArray(geojson.coordinates)) return false;
        
        // Check for empty coordinates
        if (geojson.coordinates.length === 0) return false;
        
        // For Point: coordinates should be [lng, lat]
        if (geojson.type === 'Point') {
          return geojson.coordinates.length >= 2 && 
                 typeof geojson.coordinates[0] === 'number' &&
                 typeof geojson.coordinates[1] === 'number' &&
                 !isNaN(geojson.coordinates[0]) &&
                 !isNaN(geojson.coordinates[1]);
        }
        
        // For LineString: need at least 2 points
        if (geojson.type === 'LineString') {
          return geojson.coordinates.length >= 2;
        }
        
        // For MultiLineString: need at least one line with 2+ points
        if (geojson.type === 'MultiLineString') {
          return geojson.coordinates.length >= 1 && 
                 geojson.coordinates[0].length >= 2;
        }
        
        // For Polygon/MultiPolygon: need at least one ring with points
        if (geojson.type === 'Polygon') {
          return geojson.coordinates.length > 0 && 
                 geojson.coordinates[0].length >= 4; // Ring needs 4+ points (closed)
        }
        
        if (geojson.type === 'MultiPolygon') {
          return geojson.coordinates.length > 0 &&
                 geojson.coordinates[0].length > 0 &&
                 geojson.coordinates[0][0].length >= 4;
        }
        
        return true; // Other types, assume valid
      };

      // Prepare addresses data for RPC (include formatted for ingest)
      const addressesForRPC = addresses
        .map(address => {
          let geojson = typeof address.geometry === 'string'
            ? JSON.parse(address.geometry)
            : address.geometry;

          if (!geojson || geojson.type !== 'Point') {
            geojson = { type: 'Point', coordinates: [0, 0] };
          }

          const formatted =
            (address.formatted ?? [address.house_number, address.street, address.postcode].filter(Boolean).join(' ').trim()) || '';

          return {
            gers_id: address.gers_id,
            geometry: geojson,
            house_number: address.house_number,
            street_name: address.street,
            postal_code: address.postcode,
            locality: address.locality,
            formatted,
          };
        })
        .filter(addr => addr.gers_id && isValidGeoJSON(addr.geometry));

      // Prepare buildings data for RPC (filter out invalid geometries)
      const buildingsForRPC = buildings
        .map(building => {
          let geojson = typeof building.geometry === 'string'
            ? JSON.parse(building.geometry)
            : building.geometry;

          // Convert Polygon to MultiPolygon for consistency
          if (geojson && geojson.type === 'Polygon' && geojson.coordinates) {
            geojson = { type: 'MultiPolygon', coordinates: [geojson.coordinates] };
          }

          return {
            gers_id: building.gers_id,
            geometry: geojson,
            height: building.height || 8,
          };
        })
        .filter(bld => bld.gers_id && bld.geometry && isValidGeoJSON(bld.geometry));

      // Prepare roads data for RPC (filter out invalid geometries)
      const roadsForRPC = roads
        .map(road => {
          const geometry = typeof road.geometry === 'string'
            ? JSON.parse(road.geometry) as GeoJSON.LineString
            : road.geometry;
          return {
            gers_id: road.gers_id,
            geometry: geometry,
          };
        })
        .filter(rd => rd.gers_id && rd.geometry && isValidGeoJSON(rd.geometry));

      // Log counts after filtering
      console.log(`[Provision] After validation: ${addressesForRPC.length} addresses, ${buildingsForRPC.length} buildings, ${roadsForRPC.length} roads`);
      if (addresses.length !== addressesForRPC.length) {
        console.warn(`[Provision] Filtered out ${addresses.length - addressesForRPC.length} invalid addresses`);
      }
      if (buildings.length !== buildingsForRPC.length) {
        console.warn(`[Provision] Filtered out ${buildings.length - buildingsForRPC.length} invalid buildings`);
      }
      if (roads.length !== roadsForRPC.length) {
        console.warn(`[Provision] Filtered out ${roads.length - roadsForRPC.length} invalid roads`);
      }

      // Stable Linker: Step 1 - Ingest raw addresses, buildings, and roads (no linking)
      console.log('[Provision] Stable Linker: Ingesting raw addresses, buildings, and roads...');
      const { data: ingestResult, error: ingestError } = await supabase.rpc('ingest_campaign_raw_data', {
        p_campaign_id: campaign_id,
        p_addresses: addressesForRPC,
        p_buildings: buildingsForRPC,
        p_roads: roadsForRPC,
      });

      if (ingestError) {
        console.error('[Provision] Ingest failed:', ingestError);
        throw new Error(`Ingest failed: ${ingestError.message}`);
      }

      const addressesSaved = ingestResult?.addresses_saved ?? 0;
      const buildingsSaved = ingestResult?.buildings_saved ?? 0;
      const roadsSaved = ingestResult?.roads_saved ?? 0;
      const buildingsDeleted = ingestResult?.buildings_deleted ?? 0;
      console.log(`[Provision] Ingest complete: ${addressesSaved} addresses, ${buildingsSaved} buildings, ${roadsSaved} roads (deleted ${buildingsDeleted} old buildings)`);

      // Verification: Confirm actual building count in DB matches expected
      const { count: actualBuildingCount } = await supabase
        .from('buildings')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaign_id);

      console.log(`[Provision] Verification: Actual buildings in DB for campaign: ${actualBuildingCount}`);
      
      if (actualBuildingCount !== buildingsSaved) {
        console.warn(`[Provision] WARNING: Building count mismatch! DB has ${actualBuildingCount}, expected ${buildingsSaved}`);
      }

      // Stable Linker: Step 2a - Run multi-pass spatial linker into building_address_links
      console.log('[Provision] Stable Linker: Linking addresses to buildings (COVERS → NEAREST 25m)...');
      const { data: linkResult, error: linkError } = await supabase.rpc('link_campaign_data', {
        p_campaign_id: campaign_id,
      });

      if (linkError) {
        console.error('[Provision] Link failed:', linkError);
        throw new Error(`Link failed: ${linkError.message}`);
      }

      let linksCreated = linkResult?.links_created ?? 0;
      const orphanCount = linkResult?.orphan_buildings ?? 0;
      console.log(`[Provision] Initial link complete: ${linksCreated} links created, ${orphanCount} orphan buildings`);

      // =============================================================================
      // DISCOVERY BRAIN: Reverse geocode orphan buildings to find missing addresses
      // =============================================================================
      let discoveredAddresses = 0;
      let cacheHits = 0;
      let apiCalls = 0;

      if (orphanCount > 0) {
        console.log(`[Provision] Discovery Brain: Finding addresses for ${orphanCount} orphan buildings...`);

        // Step 2b: Get linked building IDs first (fix for Supabase filter crash)
        const { data: linkedBuildings } = await supabase
          .from('building_address_links')
          .select('building_id')
          .eq('campaign_id', campaign_id);

        const linkedBuildingIds = (linkedBuildings || []).map(b => b.building_id);
        console.log(`[Provision] Discovery Brain: Found ${linkedBuildingIds.length} linked building IDs`);

        // Query orphan buildings (buildings NOT in the linked set)
        let orphanQuery = supabase
          .from('buildings')
          .select('id, gers_id, centroid')
          .eq('campaign_id', campaign_id);

        // Only apply the NOT IN filter if there are linked buildings
        if (linkedBuildingIds.length > 0) {
          orphanQuery = orphanQuery.not('id', 'in', `(${linkedBuildingIds.join(',')})`);
        }

        const { data: orphanBuildings, error: orphanError } = await orphanQuery;

        if (orphanError) {
          console.warn('[Provision] Discovery Brain: Error finding orphans:', orphanError.message);
        } else if (orphanBuildings && orphanBuildings.length > 0) {
          console.log(`[Provision] Discovery Brain: Processing ${orphanBuildings.length} orphan buildings...`);

          for (const building of orphanBuildings) {
            try {
              // Parse centroid - could be GeoJSON object or PostGIS format
              let centroidCoords: [number, number] | null = null;
              
              if (building.centroid) {
                if (typeof building.centroid === 'object' && building.centroid.coordinates) {
                  // GeoJSON format: { type: "Point", coordinates: [lon, lat] }
                  centroidCoords = building.centroid.coordinates as [number, number];
                } else if (typeof building.centroid === 'string') {
                  // Try parsing as GeoJSON string
                  try {
                    const parsed = JSON.parse(building.centroid);
                    if (parsed.coordinates) {
                      centroidCoords = parsed.coordinates as [number, number];
                    }
                  } catch {
                    // Might be WKT format, skip for now
                  }
                }
              }

              if (!centroidCoords || centroidCoords.length < 2) {
                console.warn(`[Provision] Discovery Brain: No valid centroid for building ${building.gers_id}`);
                continue;
              }

              const [lon, lat] = centroidCoords;

              // Step 1: Check global cache first
              const { data: cached } = await supabase
                .from('global_address_cache')
                .select('*')
                .eq('gers_id', building.gers_id)
                .maybeSingle();

              let addressData: {
                house_number: string;
                street_name: string;
                postal_code: string;
                formatted_address: string;
              } | null = null;

              if (cached) {
                // Cache hit!
                cacheHits++;
                addressData = {
                  house_number: cached.house_number || '',
                  street_name: cached.street_name || '',
                  postal_code: cached.postal_code || '',
                  formatted_address: cached.formatted_address || '',
                };
                console.log(`[Provision] Discovery Brain: Cache hit for ${building.gers_id}`);
              } else {
                // Cache miss - call Mapbox reverse geocode
                apiCalls++;
                addressData = await OvertureService.reverseGeocode(lat, lon);

                if (addressData) {
                  // Save to global cache for future use
                  await supabase.from('global_address_cache').upsert({
                    gers_id: building.gers_id,
                    house_number: addressData.house_number,
                    street_name: addressData.street_name,
                    postal_code: addressData.postal_code,
                    formatted_address: addressData.formatted_address,
                    centroid: { type: 'Point', coordinates: [lon, lat] },
                    source: 'mapbox',
                  });
                  console.log(`[Provision] Discovery Brain: Cached geocode for ${building.gers_id}`);
                }
              }

              // Step 2: Insert discovered address into campaign_addresses
              if (addressData && addressData.house_number && addressData.street_name) {
                // Generate a unique gers_id for the discovered address
                const discoveredGersId = `discovered-${building.gers_id}`;

                const { error: insertError } = await supabase
                  .from('campaign_addresses')
                  .insert({
                    campaign_id: campaign_id,
                    gers_id: discoveredGersId,
                    house_number: addressData.house_number,
                    street_name: addressData.street_name,
                    postal_code: addressData.postal_code,
                    formatted: addressData.formatted_address,
                    geom: { type: 'Point', coordinates: [lon, lat] },
                  });

                if (insertError) {
                  console.warn(`[Provision] Discovery Brain: Failed to insert address for ${building.gers_id}:`, insertError.message);
                } else {
                  discoveredAddresses++;
                }
              }
            } catch (err) {
              console.warn(`[Provision] Discovery Brain: Error processing building ${building.gers_id}:`, err);
            }
          }

          console.log(`[Provision] Discovery Brain: Discovered ${discoveredAddresses} addresses (${cacheHits} cache hits, ${apiCalls} API calls)`);

          // Step 2c: Final link to snap discovered addresses to orphan buildings
          if (discoveredAddresses > 0) {
            console.log('[Provision] Discovery Brain: Running final link to snap discovered addresses...');
            const { data: finalLinkResult, error: finalLinkError } = await supabase.rpc('link_campaign_data', {
              p_campaign_id: campaign_id,
            });

            if (finalLinkError) {
              console.warn('[Provision] Discovery Brain: Final link failed:', finalLinkError.message);
            } else {
              linksCreated = finalLinkResult?.links_created ?? linksCreated;
              console.log(`[Provision] Discovery Brain: Final link complete, now ${linksCreated} total links`);
            }
          }
        }
      }
      // =============================================================================
      // END DISCOVERY BRAIN
      // =============================================================================

      await supabase
        .from('campaigns')
        .update({ provision_status: 'ready' })
        .eq('id', campaign_id);

      return {
        success: true,
        addresses_saved: addressesSaved,
        buildings_saved: buildingsSaved,
        roads_saved: roadsSaved,
        links_created: linksCreated,
        discovered_addresses: discoveredAddresses,
        cache_hits: cacheHits,
        api_calls: apiCalls,
        orphan_buildings: orphanCount - discoveredAddresses,
        total_addresses: addressesSaved + discoveredAddresses,
        total_buildings: linksCreated,
        message: `Zero-Gap provisioning complete: ${addressesSaved} addresses, ${buildingsSaved} buildings, ${roadsSaved} roads ingested; ${linksCreated} links. Discovery Brain: ${discoveredAddresses} addresses discovered (${cacheHits} cached, ${apiCalls} API calls).`,
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

