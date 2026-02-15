import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { TileLambdaService } from '@/lib/services/TileLambdaService';
import { RoutingService } from '@/lib/services/RoutingService';
import { buildRoute } from '@/lib/services/BlockRoutingService';
import { StableLinkerService, DataIntegrityError } from '@/lib/services/StableLinkerService';
import { TownhouseSplitterService } from '@/lib/services/TownhouseSplitterService';

// FIX: Ensure Node.js runtime
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      
      const isConnectionError = 
        lastError.message.includes('closed') ||
        lastError.message.includes('Connection Error') ||
        lastError.message.includes('established') ||
        lastError.message.includes('timeout');
      
      if (!isConnectionError || attempt === maxAttempts) {
        throw lastError;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.warn(`[Provision] Retry attempt ${attempt}/${maxAttempts} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

export async function POST(request: NextRequest) {
  console.log('[Provision] Starting GOLD STANDARD hybrid provisioning...');
  console.log('[Provision] Lambda URL exists?', !!process.env.SLICE_LAMBDA_URL);
  console.log('[Provision] Secret exists?', !!process.env.SLICE_SHARED_SECRET);
  
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

    // Validate Lambda configuration
    if (!process.env.SLICE_LAMBDA_URL || !process.env.SLICE_SHARED_SECRET) {
      return NextResponse.json(
        { error: 'Lambda not configured. Set SLICE_LAMBDA_URL and SLICE_SHARED_SECRET.' },
        { status: 500 }
      );
    }

    const supabase = createAdminClient();

    // Get campaign with territory boundary
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('owner_id, territory_boundary, region')
      .eq('id', campaign_id)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    const polygon = campaign.territory_boundary;
    
    if (!polygon) {
      return NextResponse.json(
        { error: 'No territory boundary defined. Please draw a polygon on the map when creating the campaign.' },
        { status: 400 }
      );
    }

    // Determine region code (ON for Ontario, etc.)
    const regionCode = (campaign.region || 'ON').toUpperCase();
    
    console.log('[Provision] Campaign:', campaign_id);
    console.log('[Provision] Region:', regionCode);

    // Update status to 'pending'
    await supabase
      .from('campaigns')
      .update({ provision_status: 'pending' })
      .eq('id', campaign_id);

    // =============================================================================
    // GOLD STANDARD: Hybrid Provisioning with Lambda + S3
    // =============================================================================
    
    const result = await retryWithBackoff(async () => {
      // Step 1: Call Lambda to generate snapshots from flyr-data-lake
      console.log('[Provision] Step 1: Calling Tile Lambda...');
      const snapshot = await TileLambdaService.generateSnapshots(
        polygon as GeoJSON.Polygon,
        regionCode,
        campaign_id!,
        {
          limitBuildings: 10000,   // Generous limits for full coverage
          limitAddresses: 10000,
          limitRoads: 5000,
          includeRoads: true,
        }
      );

      // Step 2: Download addresses from S3 (the only thing we ingest)
      console.log('[Provision] Step 2: Downloading addresses from S3...');
      const addressData = await TileLambdaService.downloadAddresses(snapshot.urls.addresses);

      // Step 3: Convert to lean campaign_addresses format
      console.log('[Provision] Step 3: Converting to lean format...');
      const converted = TileLambdaService.convertToCampaignAddresses(
        addressData.features,
        campaign_id!
      );

      // Deduplicate by logical address (same formatted + postal_code = one row)
      // Source data can return the same address with different gers_ids (e.g. tile boundaries)
      const addressesToInsert = Array.from(
        new Map(
          converted.map((addr) => {
            const key = `${(addr.formatted ?? '').toLowerCase().trim()}|${(addr.postal_code ?? '').toLowerCase().trim()}`;
            return [key, addr] as const;
          })
        ).values()
      );
      if (addressesToInsert.length < converted.length) {
        console.log(`[Provision] Deduplicated addresses: ${converted.length} -> ${addressesToInsert.length}`);
      }

      // Step 4: Clear existing addresses for this campaign (clean slate)
      console.log('[Provision] Step 4: Clearing existing addresses...');
      const { error: deleteError } = await supabase
        .from('campaign_addresses')
        .delete()
        .eq('campaign_id', campaign_id);

      if (deleteError) {
        console.warn('[Provision] Error clearing addresses:', deleteError.message);
      }

      // Step 5: Insert addresses in batches
      console.log('[Provision] Step 5: Inserting', addressesToInsert.length, 'addresses...');
      const batchSize = 500;
      let insertedCount = 0;
      
      for (let i = 0; i < addressesToInsert.length; i += batchSize) {
        const batch = addressesToInsert.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from('campaign_addresses')
          .insert(batch);
        
        if (insertError) {
          console.error(`[Provision] Error inserting batch ${i / batchSize + 1}:`, insertError.message);
        } else {
          insertedCount += batch.length;
        }
      }

      console.log('[Provision] Successfully inserted', insertedCount, 'addresses');

      // Step 6: Store S3 snapshot URLs
      // Buildings and Roads stay in S3 - app renders directly from there
      console.log('[Provision] Step 6: Storing S3 URLs...');
      
      // Update campaigns table (may fail if columns don't exist yet, that's ok)
      const { error: updateError } = await supabase
        .from('campaigns')
        .update({
          provision_status: 'ready',
          provisioned_at: new Date().toISOString(),
        })
        .eq('id', campaign_id);

      if (updateError) {
        console.warn('[Provision] Error updating campaign status:', updateError.message);
      }

      // Store detailed snapshot info in campaign_snapshots table
      const { error: snapshotError } = await supabase
        .from('campaign_snapshots')
        .upsert({
          campaign_id: campaign_id!,
          bucket: snapshot.bucket,
          prefix: snapshot.prefix,
          buildings_key: snapshot.s3_keys.buildings,
          addresses_key: snapshot.s3_keys.addresses,
          roads_key: snapshot.s3_keys.roads || null,
          metadata_key: snapshot.s3_keys.metadata,
          buildings_url: snapshot.urls.buildings,
          addresses_url: snapshot.urls.addresses,
          roads_url: snapshot.urls.roads || null,
          metadata_url: snapshot.urls.metadata,
          buildings_count: snapshot.counts.buildings,
          addresses_count: snapshot.counts.addresses,
          roads_count: snapshot.counts.roads,
          overture_release: snapshot.metadata?.overture_release,
          tile_metrics: snapshot.metadata?.tile_metrics || null,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        }, {
          onConflict: 'campaign_id',
        });

      if (snapshotError) {
        console.warn('[Provision] Error storing snapshot metadata:', snapshotError.message);
        // Don't fail - the addresses are already ingested
      }

      // =============================================================================
      // STAGE 1: PEDESTRIAN ROUTING - Street-Block-Sweep-Snake + optional geometry
      // =============================================================================
      let optimizedPathGeometry: GeoJSON.LineString | null = null;
      let optimizedPathInfo: {
        totalDistanceKm: number;
        totalTimeMinutes: number;
        waypointCount: number;
      } | null = null;

      if (insertedCount >= 2) {
        console.log('[Provision] Stage 1: Building route (Street-Block-Sweep-Snake)...');
        try {
          const { data: firstAddresses } = await supabase
            .from('campaign_addresses')
            .select('id, geom, house_number, street_name, formatted')
            .eq('campaign_id', campaign_id)
            .limit(20);
          const addressesForRoute = firstAddresses ?? [];
          if (addressesForRoute.length < 2) {
            console.log('[Provision] Skipping route: fewer than 2 addresses in DB');
          } else {
          const buildRouteAddresses = addressesForRoute.map((addr) => ({
            id: addr.id,
            lat: addr.geom.coordinates[1],
            lon: addr.geom.coordinates[0],
            house_number: addr.house_number ?? undefined,
            street_name: addr.street_name ?? undefined,
            formatted: addr.formatted ?? undefined,
          }));

          const sumLat = buildRouteAddresses.reduce((s, a) => s + a.lat, 0);
          const sumLon = buildRouteAddresses.reduce((s, a) => s + a.lon, 0);
          const depot = { lat: sumLat / buildRouteAddresses.length, lon: sumLon / buildRouteAddresses.length };

          const routeResult = await buildRoute(buildRouteAddresses, depot, {
            include_geometry: !!process.env.STADIA_API_KEY,
            threshold_meters: 50,
            sweep_nn_threshold_m: 500,
          });

          optimizedPathInfo = {
            totalDistanceKm: 0,
            totalTimeMinutes: 0,
            waypointCount: routeResult.stops.length,
          };

          if (routeResult.geometry) {
            optimizedPathGeometry = RoutingService.toGeoJSONLineString(routeResult.geometry.polyline);
            optimizedPathInfo.totalDistanceKm = routeResult.geometry.distance_m / 1000;
            optimizedPathInfo.totalTimeMinutes = Math.round(routeResult.geometry.time_sec / 60);
          }

          console.log(`[Provision] Route: ${optimizedPathInfo.waypointCount} stops${routeResult.geometry ? `, ${optimizedPathInfo.totalDistanceKm.toFixed(2)}km, ${optimizedPathInfo.totalTimeMinutes}min` : ' (no geometry)'}`);

          const { error: pathError } = await supabase
            .from('campaign_snapshots')
            .update({
              optimized_path_geometry: optimizedPathGeometry,
              optimized_path_distance_km: optimizedPathInfo.totalDistanceKm,
              optimized_path_time_minutes: optimizedPathInfo.totalTimeMinutes,
            })
            .eq('campaign_id', campaign_id);

          if (pathError) {
            console.warn('[Provision] Error storing optimized path:', pathError.message);
          }
          }
        } catch (routingError) {
          console.warn('[Provision] Routing calculation failed:', routingError);
        }
      } else {
        console.log('[Provision] Skipping routing: insufficient addresses');
      }
      // =============================================================================
      // END PEDESTRIAN ROUTING
      // =============================================================================

      // =============================================================================
      // GOLD STANDARD STABLE LINKER: 4-Tier Spatial Matching
      // =============================================================================
      console.log('[Provision] Gold Standard Stable Linker: Running 4-tier spatial matching...');
      let spatialJoinSummary = {
        matched: 0,
        orphans: 0,
        suspect: 0,
        avgConfidence: 0,
        coveragePercent: 0,
        matchBreakdown: {
          containmentVerified: 0,
          containmentSuspect: 0,
          pointOnSurface: 0,
          proximityVerified: 0,
          proximityFallback: 0,
        },
      };
      
      try {
        // Download buildings from S3
        console.log(`[Provision] Fetching buildings from: ${snapshot.urls.buildings}`);
        const buildingsResponse = await fetch(snapshot.urls.buildings);
        if (!buildingsResponse.ok) {
          throw new Error(`Failed to fetch buildings: ${buildingsResponse.status}`);
        }
        
        const buildingsGeoJSON = await buildingsResponse.json();
        console.log(`[Provision] Downloaded ${buildingsGeoJSON.features?.length || 0} buildings from S3`);
        
        // Debug: Log first building structure
        if (buildingsGeoJSON.features?.length > 0) {
          const first = buildingsGeoJSON.features[0];
          console.log('[Provision] Sample building:', {
            id: first.properties?.gers_id,
            geomType: first.geometry?.type,
            coordCount: first.geometry?.coordinates?.[0]?.length,
            props: Object.keys(first.properties || {})
          });
        }
        
        // Run Gold Standard Spatial Join
        console.log('[Provision] Starting Stable Linker...');
        const linkerService = new StableLinkerService(supabase);
        spatialJoinSummary = await linkerService.runSpatialJoin(
          campaign_id!,
          buildingsGeoJSON,
          snapshot.metadata?.overture_release || '2026-01-21.0'
        );

        console.log('[Provision] Spatial join complete:', spatialJoinSummary);
        if (spatialJoinSummary?.processing_metadata) {
          console.log('[Provision] Processing metadata:', spatialJoinSummary.processing_metadata);
        }
      } catch (linkerError) {
        if (linkerError instanceof DataIntegrityError) {
          console.warn('[Provision] DataIntegrityError (address sent to orphans):', linkerError.message, 'building_ids:', linkerError.buildingIds);
        } else {
          console.error('[Provision] Gold Standard Stable Linker FAILED:', linkerError);
          console.error('[Provision] Error stack:', (linkerError as Error).stack);
        }
        // Don't fail provisioning if linking fails
      }
      // =============================================================================
      // END GOLD STANDARD STABLE LINKER
      // =============================================================================

      // =============================================================================
      // GOLD STANDARD TOWNHOUSE SPLITTING: Geometric Unit Division
      // =============================================================================
      console.log('[Provision] Gold Standard Townhouse Splitter: Processing multi-unit buildings...');
      let townhouseSummary = {
        total_buildings: 0,
        townhouses_detected: 0,
        apartments_skipped: 0,
        units_created: 0,
        errors_logged: 0,
        avg_units_per_townhouse: 0,
      };
      
      try {
        // Download buildings from S3 for geometric processing
        const buildingsResponse = await fetch(snapshot.urls.buildings);
        if (!buildingsResponse.ok) {
          throw new Error(`Failed to fetch buildings: ${buildingsResponse.status}`);
        }
        
        const buildingsGeoJSON = await buildingsResponse.json();
        
        // Run townhouse splitting
        const splitterService = new TownhouseSplitterService(supabase);
        townhouseSummary = await splitterService.processCampaignTownhouses(
          campaign_id!,
          buildingsGeoJSON,
          snapshot.metadata?.overture_release || '2026-01-21.0'
        );
        
        console.log('[Provision] Townhouse splitting complete:', townhouseSummary);
        
      } catch (splitterError) {
        console.warn('[Provision] Townhouse splitting failed:', splitterError);
        // Don't fail provisioning if splitting fails
      }
      // =============================================================================
      // END GOLD STANDARD TOWNHOUSE SPLITTING
      // =============================================================================

      // =============================================================================
      // END GOLD STANDARD WORKFLOW
      // =============================================================================
      
      return {
        success: true,
        campaign_id: snapshot.campaign_id,
        addresses_saved: insertedCount,
        buildings_saved: snapshot.counts.buildings,
        roads_count: snapshot.counts.roads,
        links_created: spatialJoinSummary.matched,
        units_created: townhouseSummary.units_created,
        spatial_join: spatialJoinSummary,
        townhouse_split: townhouseSummary,
        map_layers: {
          buildings: snapshot.urls.buildings,  // iOS renders directly from S3
          roads: snapshot.urls.roads,          // iOS renders directly from S3
        },
        snapshot_metadata: {
          bucket: snapshot.bucket,
          prefix: snapshot.prefix,
          overture_release: snapshot.metadata?.overture_release,
          tile_metrics: snapshot.metadata?.tile_metrics,
        },
        warning: snapshot.warning,
        optimized_path: optimizedPathInfo ? {
          distance_km: optimizedPathInfo.totalDistanceKm,
          time_minutes: optimizedPathInfo.totalTimeMinutes,
          waypoint_count: optimizedPathInfo.waypointCount,
        } : null,
        message: `Gold Standard provisioning complete: ${insertedCount} leads ready. Buildings (${snapshot.counts.buildings}) and roads (${snapshot.counts.roads}) served from S3.` +
          (optimizedPathInfo ? ` Optimized walking loop: ${optimizedPathInfo.totalDistanceKm.toFixed(2)}km, ${optimizedPathInfo.totalTimeMinutes}min.` : ''),
      };
    });

    return NextResponse.json(result);
    
  } catch (error) {
    console.error('[Provision] Error:', error);
    
    // Update status to 'failed'
    if (campaign_id) {
      try {
        const supabase = createAdminClient();
        await supabase
          .from('campaigns')
          .update({ provision_status: 'failed' })
          .eq('id', campaign_id);
      } catch (updateError) {
        console.error('[Provision] Failed to update provision_status:', updateError);
      }
    }
    
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Provisioning failed' },
      { status: 500 }
    );
  }
}
