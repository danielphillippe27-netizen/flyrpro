import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { TileLambdaService } from '@/lib/services/TileLambdaService';
import { RoutingService } from '@/lib/services/RoutingService';
import { buildRoute } from '@/lib/services/BlockRoutingService';
import { StableLinkerService, DataIntegrityError } from '@/lib/services/StableLinkerService';
import { TownhouseSplitterService } from '@/lib/services/TownhouseSplitterService';
import { GoldAddressService } from '@/lib/services/GoldAddressService';
import { BuildingAdapter } from '@/lib/services/BuildingAdapter';
import { AddressAdapter } from '@/lib/services/AddressAdapter';

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
    // GOLD STANDARD: Hybrid Provisioning - Reuse snapshot when possible (avoid triple Lambda)
    // =============================================================================

    const result = await retryWithBackoff(async () => {
      let addressesToInsert: any[] = [];
      let goldBuildings: any[] | null = null;
      let snapshot: Awaited<ReturnType<typeof TileLambdaService.generateSnapshots>> | null = null;
      let addressSource: 'gold' | 'silver' | 'lambda' = 'lambda';
      let preFetchedBuildingsGeo: unknown = undefined;

      // Try to reuse existing snapshot from DB (from generate-address-list or previous provision)
      const { data: existingSnapshotRow } = await supabase
        .from('campaign_snapshots')
        .select('buildings_url, addresses_url, metadata_url, roads_url, overture_release, expires_at')
        .eq('campaign_id', campaign_id!)
        .single();

      const snapshotValid =
        existingSnapshotRow?.buildings_url &&
        existingSnapshotRow?.addresses_url &&
        existingSnapshotRow?.expires_at &&
        new Date(existingSnapshotRow.expires_at) > new Date();

      if (snapshotValid) {
        console.log('[Provision] Reusing snapshot from campaign_snapshots (skip Lambda)');
        addressSource = 'lambda';
        snapshot = {
          urls: {
            buildings: existingSnapshotRow!.buildings_url,
            addresses: existingSnapshotRow!.addresses_url,
            metadata: existingSnapshotRow!.metadata_url,
            roads: existingSnapshotRow!.roads_url ?? undefined,
          },
          metadata: { overture_release: existingSnapshotRow!.overture_release ?? undefined },
        } as Awaited<ReturnType<typeof TileLambdaService.generateSnapshots>>;
        // Parallel fetch: addresses + buildings from S3 (saves ~3–8s vs sequential)
        const [addressData, buildingsGeo] = await Promise.all([
          TileLambdaService.downloadAddresses(existingSnapshotRow!.addresses_url),
          fetch(existingSnapshotRow!.buildings_url).then((r) => {
            if (!r.ok) throw new Error(`Failed to fetch buildings: ${r.status}`);
            return r.json();
          }),
        ]);
        const lambdaAddresses = TileLambdaService.convertToCampaignAddresses(
          addressData.features,
          campaign_id!
        );
        addressesToInsert = AddressAdapter.normalizeArray(lambdaAddresses, campaign_id!);
        goldBuildings = [];
        // Pass pre-fetched buildings so BuildingAdapter skips a second download
        preFetchedBuildingsGeo = buildingsGeo;
      } else {
        // Step 1: Gold Standard first, Lambda fallback (returns snapshot when Lambda used)
        console.log('[Provision] Step 1: Querying Gold Standard addresses...');
        const goldResult = await GoldAddressService.getAddressesForPolygon(
          campaign_id!,
          polygon as GeoJSON.Polygon,
          regionCode
        );

        console.log(`[Provision] Gold: ${goldResult.counts.gold}, Lambda: ${goldResult.counts.lambda}, Total: ${goldResult.counts.total}`);
        console.log(`[Provision] Source: ${goldResult.source}`);
        addressSource = goldResult.source;

        addressesToInsert = AddressAdapter.normalizeArray(
          goldResult.addresses,
          campaign_id!
        );
        goldBuildings = goldResult.buildings;

        // Reuse Lambda snapshot from GoldAddressService when present (avoids duplicate Lambda call)
        if (goldResult.snapshot) {
          snapshot = goldResult.snapshot;
          console.log('[Provision] Using snapshot from address step for buildings (no extra Lambda call)');
        } else if (goldResult.counts.gold < 10) {
          console.log('[Provision] Gold coverage insufficient, getting Lambda snapshots for buildings...');
          snapshot = await TileLambdaService.generateSnapshots(
            polygon as GeoJSON.Polygon,
            regionCode,
            campaign_id!,
            {
              limitBuildings: 10000,
              limitAddresses: 10000,
              limitRoads: 5000,
              includeRoads: true,
            }
          );
        } else if (!goldBuildings || goldBuildings.length === 0) {
          console.log('[Provision] Gold has addresses but no buildings, getting Lambda snapshots for building footprints...');
          snapshot = await TileLambdaService.generateSnapshots(
            polygon as GeoJSON.Polygon,
            regionCode,
            campaign_id!,
            {
              limitBuildings: 10000,
              limitAddresses: 100,
              limitRoads: 5000,
              includeRoads: true,
            }
          );
        } else {
          console.log(`[Provision] Using ${goldBuildings.length} Gold Standard buildings`);
        }
      }

      // =============================================================================
      // ADAPTER PATTERN: Normalize buildings to standard GeoJSON format
      // This works for both Gold (DB) and Lambda (S3) sources
      // =============================================================================
      const { buildings: normalizedBuildingsGeoJSON, overtureRelease } =
        await BuildingAdapter.fetchAndNormalize(goldBuildings ?? null, snapshot, preFetchedBuildingsGeo);
      
      // Debug: Log first building structure
      if (normalizedBuildingsGeoJSON.features?.length > 0) {
        const first = normalizedBuildingsGeoJSON.features[0];
        console.log('[Provision] Sample building:', {
          id: first.properties?.gers_id || first.properties?.external_id,
          geomType: first.geometry?.type,
          coordCount: first.geometry?.coordinates?.[0]?.length,
          props: Object.keys(first.properties || {}),
          source: goldBuildings?.length > 0 ? 'gold' : 'lambda'
        });
      }

      // Step 2: Deduplicate addresses by house number + street + locality
      console.log('[Provision] Step 2: Deduplicating addresses...');
      
      // Debug: Log first few addresses to check format
      if (addressesToInsert.length > 0) {
        console.log('[Provision] Sample address format:', {
          first: addressesToInsert[0],
          keys: Object.keys(addressesToInsert[0])
        });
      }
      
      const deduplicated = Array.from(
        new Map(
          addressesToInsert.map((addr: any) => {
            const houseNum = (addr.house_number ?? '').toString().toLowerCase().trim();
            const street = (addr.street_name ?? '').toString().toLowerCase().trim();
            const locality = (addr.locality ?? '').toString().toLowerCase().trim();
            const key = `${houseNum}|${street}|${locality}`;
            return [key, addr] as const;
          })
        ).values()
      );
      
      if (deduplicated.length < addressesToInsert.length) {
        console.log(`[Provision] Deduplicated: ${addressesToInsert.length} -> ${deduplicated.length}`);
      } else {
        console.log(`[Provision] No deduplication needed: ${addressesToInsert.length} addresses`);
      }
      addressesToInsert = deduplicated;

      // Step 4: Check if addresses already exist (from generate-address-list)
      const { data: existingAddresses, error: countError } = await supabase
        .from('campaign_addresses')
        .select('id')
        .eq('campaign_id', campaign_id);
      
      let insertedCount = existingAddresses?.length || 0;
      
      if (countError) {
        console.warn('[Provision] Error checking existing addresses:', countError.message);
      }
      
      // Step 5: Only insert if addresses don't already exist
      if (insertedCount === 0 && addressesToInsert.length > 0) {
        console.log('[Provision] Step 5: Inserting', addressesToInsert.length, 'addresses...');
        const batchSize = 500;
        
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
      } else {
        console.log(`[Provision] Step 5: Skipping insert - ${insertedCount} addresses already exist`);
      }

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

      // Store detailed snapshot info in campaign_snapshots table (only when we have a full Lambda response)
      if (snapshot && 'bucket' in snapshot && snapshot.bucket) {
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
      } else {
        console.log('[Provision] Using Gold Standard data - no Lambda snapshot to store');
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
        console.log('[Provision] Stage 1: Building route for ALL addresses (Street-Block-Sweep-Snake)...');
        try {
          const { data: allAddresses } = await supabase
            .from('campaign_addresses')
            .select('id, geom, house_number, street_name, formatted')
            .eq('campaign_id', campaign_id);
          const addressesForRoute = allAddresses ?? [];
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

          // Store polyline geometry in campaign_snapshots
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

          // Persist per-address walking sequence (seq, sequence, cluster_id)
          // Single agent cluster — all addresses in one walking route
          console.log(`[Provision] Persisting walking sequence for ${routeResult.stops.length} addresses...`);

          const orderedStops = routeResult.stops;
          const updatePromises = orderedStops.map((stop, idx) =>
            supabase
              .from('campaign_addresses')
              .update({
                cluster_id: 1,
                sequence: idx,
                seq: idx,
              })
              .eq('id', stop.id)
          );
          await Promise.all(updatePromises);

          console.log(`[Provision] Walking sequence saved: ${orderedStops.length} addresses ordered`);
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
      // GOLD STANDARD SPATIAL LINKER: Fast PostGIS-based matching
      // =============================================================================
      console.log('[Provision] Gold Standard Spatial Linker: Running PostGIS spatial join...');
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
        if (goldBuildings && goldBuildings.length > 0) {
          // Use fast SQL-based linker for Gold data (O(log n) with spatial index)
          console.log('[Provision] Using SQL-based Gold linker with polygon filter...');
          // Pass polygon as raw object — the JSONB parameter needs a JSON object,
          // not a JSON.stringify'd string (which PostgREST would double-serialize)
          const { data: linkResult, error: linkError } = await supabase
            .rpc('link_campaign_addresses_gold', { 
              p_campaign_id: campaign_id,
              p_polygon_geojson: polygon
            });
          
          if (linkError) {
            console.error('[Provision] Gold linker failed:', linkError.message);
          } else {
            const exact = linkResult?.[0]?.exact_matches || 0;
            const proximity = linkResult?.[0]?.proximity_matches || 0;
            const total = linkResult?.[0]?.total_linked || 0;
            
            console.log(`[Provision] Gold linker complete: ${exact} exact, ${proximity} proximity, ${total} total`);
            
            spatialJoinSummary = {
              matched: Number(total),
              orphans: insertedCount - Number(total),
              suspect: 0,
              avgConfidence: total > 0 ? (exact * 1.0 + proximity * 0.8) / total : 0,
              coveragePercent: insertedCount > 0 ? (Number(total) / insertedCount) * 100 : 0,
              matchBreakdown: {
                containmentVerified: Number(exact),
                containmentSuspect: 0,
                pointOnSurface: 0,
                proximityVerified: Number(proximity),
                proximityFallback: 0,
              },
            };
          }
        } else {
          // Use JavaScript linker for Silver/Lambda data
          console.log('[Provision] Using JavaScript linker for Silver data...');
          const linkerService = new StableLinkerService(supabase);
          spatialJoinSummary = await linkerService.runSpatialJoin(
            campaign_id!,
            normalizedBuildingsGeoJSON,
            overtureRelease
          );
          console.log('[Provision] Spatial join complete:', spatialJoinSummary);
        }
      } catch (linkerError) {
        console.error('[Provision] Spatial linker FAILED:', linkerError);
      }
      // =============================================================================
      // END GOLD STANDARD SPATIAL LINKER
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
        // Run townhouse splitting using normalized buildings
        const splitterService = new TownhouseSplitterService(supabase);
        townhouseSummary = await splitterService.processCampaignTownhouses(
          campaign_id!,
          normalizedBuildingsGeoJSON,
          overtureRelease
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
        campaign_id: campaign_id,
        addresses_saved: insertedCount,
        buildings_saved: goldBuildings?.length || snapshot?.counts?.buildings || 0,
        roads_count: snapshot?.counts?.roads || 0,
        source: addressSource,
        links_created: spatialJoinSummary.matched,
        units_created: townhouseSummary.units_created,
        spatial_join: spatialJoinSummary,
        townhouse_split: townhouseSummary,
        map_layers: snapshot ? {
          buildings: snapshot.urls.buildings,
          roads: snapshot.urls.roads,
        } : {
          buildings: null,
          roads: null,
        },
        snapshot_metadata: snapshot ? {
          bucket: snapshot.bucket,
          prefix: snapshot.prefix,
          overture_release: snapshot.metadata?.overture_release,
          tile_metrics: snapshot.metadata?.tile_metrics,
        } : {
          bucket: null,
          prefix: null,
          source: 'gold_standard',
        },
        warning: snapshot?.warning || null,
        optimized_path: optimizedPathInfo ? {
          distance_km: optimizedPathInfo.totalDistanceKm,
          time_minutes: optimizedPathInfo.totalTimeMinutes,
          waypoint_count: optimizedPathInfo.waypointCount,
        } : null,
        message: snapshot
          ? `Gold Standard provisioning complete: ${insertedCount} leads ready.` +
            (snapshot?.counts ? ` Buildings (${snapshot.counts.buildings}) and roads (${snapshot.counts.roads ?? 0}) served from S3.` : ' S3 snapshot.')
            + (optimizedPathInfo ? ` Optimized walking loop: ${optimizedPathInfo.totalDistanceKm.toFixed(2)}km, ${optimizedPathInfo.totalTimeMinutes}min.` : '')
          : `Gold Standard provisioning complete: ${insertedCount} leads ready using municipal data.`,
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
