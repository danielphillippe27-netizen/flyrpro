/**
 * CVRP Routing Service - OR-Tools Capacitated Vehicle Routing Problem
 * 
 * Industry-standard territory optimization for canvassing apps.
 * Combines fair splitting (CVRP) with pedestrian-optimized routing (Valhalla).
 * 
 * Features:
 * - Single code path for 1 agent (TSP) or N agents (CVRP)
 * - Hard capacity constraints prevent unfair assignments (30 vs 140 houses)
 * - Street-side pre-sorting for contiguous walking
 * - Pedestrian distance matrix from Valhalla
 * - Block-based optimization for human-like routes
 * 
 * Environment Variables:
 * - CVRP_LAMBDA_URL: The CVRP Lambda function URL
 * - CVRP_LAMBDA_SECRET: Auth secret for Lambda
 * - STADIA_API_KEY: Fallback for direct Valhalla calls
 */

import type { BlockStop, BlockRouteOptions } from './BlockRoutingService';

export interface CVRPAddress {
  id: string;
  lat: number;
  lon: number;
  house_number?: string;
  street_name?: string;
  formatted?: string;
}

export interface CVRPOptions {
  max_houses_per_agent?: number;  // Auto-calculated if not provided
  walking_speed?: number;         // km/h, default 5.0
  street_side_bias?: boolean;     // Pre-sort by odd/even house numbers
  return_to_depot?: boolean;      // Round trip vs one-way
  balance_factor?: number;        // 0.0-2.0, higher = more equal splitting
  /** Block optimization options */
  block_optimize?: boolean;       // Enable block-based optimization (default: true)
  block_target_size?: number;     // Target number of block stops (default: 50)
  snap_to_walkway?: boolean;      // Snap block stops to walkways
}

export interface CVRPCluster {
  agent_id: number;
  addresses: Array<CVRPAddress & {
    sequence: number;
    walk_time_sec: number;
    distance_m: number;
  }>;
  n_addresses: number;
  total_time_sec: number;
  total_distance_m: number;
  estimated_walk_time_min: number;
  /** Block stops used for this cluster (if block optimization enabled) */
  block_stops?: BlockStop[];
  /** Block order indices */
  block_order?: number[];
  /** Encoded polyline for map display (path geometry from Valhalla) */
  route_polyline?: string;
}

export interface CVRPResult {
  success: boolean;
  clusters: CVRPCluster[];
  matrix_time_sec: number;
  summary: {
    n_addresses: number;
    n_agents: number;
    avg_houses_per_agent: number;
    max_houses_per_agent: number;
    total_walk_time_min: number;
    total_distance_km: number;
  };
  /** Block optimization metadata */
  block_optimization?: {
    enabled: boolean;
    n_block_stops: number;
    n_input_addresses: number;
    build_blocks_ms: number;
    order_within_blocks_ms: number;
  };
}

export class CVRPRoutingService {
  private static get LAMBDA_URL(): string {
    const url = process.env.CVRP_LAMBDA_URL;
    if (!url) {
      throw new Error('CVRP_LAMBDA_URL environment variable is required');
    }
    return url;
  }

  private static get LAMBDA_SECRET(): string {
    const secret = process.env.CVRP_LAMBDA_SECRET;
    if (!secret || secret.trim() === '') {
      throw new Error(
        'CVRP_LAMBDA_SECRET environment variable is required. Set it in .env.local to match the secret configured in your CVRP Lambda.'
      );
    }
    return secret.trim();
  }

  /**
   * Optimize walking routes using CVRP (Capacity-constrained VRP)
   * 
   * This is the main entry point - handles both:
   * - Single agent: Becomes TSP (optimal loop)
   * - Multiple agents: Becomes CVRP (fair splitting + optimal routes)
   * 
   * Block Optimization:
   * When enabled (default for >80 addresses), addresses are first grouped into
   * "block stops" (contiguous street segments), CVRP runs on blocks, then each
   * block is expanded into a human-like door order. This produces routes that
   * look like a person walking streets, not a solver creating weird connectors.
   * 
   * @param addresses - List of addresses to visit
   * @param nAgents - Number of canvassers/agents
   * @param depot - Starting location (optional, defaults to first address centroid)
   * @param options - CVRP options
   * @param supabaseClient - Supabase client for RPC calls (required for block optimization)
   * @returns Optimized clusters with sequences
   */
  static async optimizeRoutes(
    addresses: CVRPAddress[],
    nAgents: number,
    depot?: { lat: number; lon: number },
    options: CVRPOptions = {},
    supabaseClient?: any
  ): Promise<CVRPResult> {
    if (addresses.length < 2) {
      throw new Error('Need at least 2 addresses to optimize');
    }

    if (nAgents < 1) {
      throw new Error('Need at least 1 agent');
    }

    // Determine if we should use block optimization
    const blockOptimize = options.block_optimize !== false && addresses.length >= 80;
    const blockTargetSize = options.block_target_size ?? 50;

    console.log(`[CVRP] Optimizing ${addresses.length} addresses for ${nAgents} agent(s)`);
    if (blockOptimize) {
      console.log(`[CVRP] Block optimization enabled (target: ~${blockTargetSize} blocks)`);
    }

    // Auto-calculate depot if not provided (centroid of addresses)
    if (!depot) {
      depot = this.calculateCentroid(addresses);
      console.log(`[CVRP] Auto-calculated depot: ${depot.lat}, ${depot.lon}`);
    }

    let blockStops: BlockStop[] | undefined;
    let addressOrdersWithinBlocks = new Map<string, string[]>();
    let blockOptimizationMeta = {
      enabled: false,
      n_block_stops: 0,
      n_input_addresses: addresses.length,
      build_blocks_ms: 0,
      order_within_blocks_ms: 0
    };

    // BLOCK OPTIMIZATION: Build blocks and order within them
    if (blockOptimize && supabaseClient) {
      const blockStart = Date.now();
      
      // Dynamic import to avoid circular dependency
      const { buildBlockStops, orderAddressesWithinBlock } = await import('./BlockRoutingService');
      
      // Build block stops
      const buildStart = Date.now();
      blockStops = buildBlockStops(addresses, {
        targetBlockSize: blockTargetSize,
        maxRunGapM: 50,
        maxAddressesPerBlock: 30
      });
      blockOptimizationMeta.build_blocks_ms = Date.now() - buildStart;

      // Order addresses within each block
      const orderStart = Date.now();
      await Promise.all(
        blockStops.map(async (block) => {
          const blockAddresses = addresses.filter(a => block.addressIds.includes(a.id));
          const orderedIds = await orderAddressesWithinBlock(blockAddresses, { 
            useWalkwayProjection: options.snap_to_walkway !== false 
          });
          addressOrdersWithinBlocks.set(block.id, orderedIds);
        })
      );
      blockOptimizationMeta.order_within_blocks_ms = Date.now() - orderStart;
      blockOptimizationMeta.n_block_stops = blockStops.length;
      blockOptimizationMeta.enabled = true;

      console.log(`[CVRP] Built ${blockStops.length} blocks in ${blockOptimizationMeta.build_blocks_ms}ms`);
      console.log(`[CVRP] Ordered within blocks in ${blockOptimizationMeta.order_within_blocks_ms}ms`);
    }

    // Prepare request - use block stops if available, otherwise use all addresses
    const requestAddresses = blockStops 
      ? blockStops.map(b => ({ 
          id: b.id, 
          lat: b.lat, 
          lon: b.lon,
          house_number: undefined,
          street_name: b.metadata.street_name
        }))
      : addresses;

    const requestBody = {
      addresses: requestAddresses.map(a => ({
        id: a.id,
        lat: a.lat,
        lon: a.lon,
        house_number: a.house_number,
        street_name: a.street_name
      })),
      n_agents: nAgents,
      depot: depot,
      options: {
        max_houses_per_agent: options.max_houses_per_agent,
        walking_speed: options.walking_speed ?? 5.0,
        street_side_bias: options.street_side_bias ?? true,
        return_to_depot: options.return_to_depot ?? true,
        balance_factor: options.balance_factor ?? 1.0
      }
    };

    // Call CVRP Lambda
    const startTime = Date.now();
    
    const secret = this.LAMBDA_SECRET;
    const response = await fetch(this.LAMBDA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-flyr-secret': secret,
        'x-cvrp-secret': secret,
        'x-slice-secret': secret
      },
      body: JSON.stringify(requestBody)
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[CVRP] Lambda error:', response.status, errorText);
      const isUnauthorized =
        response.status === 401 ||
        (errorText && /"error"\s*:\s*"unauthorized"/i.test(errorText));
      if (isUnauthorized) {
        throw new Error(
          'CVRP Lambda rejected the request (unauthorized). Ensure CVRP_LAMBDA_SECRET in .env.local matches the secret configured in the CVRP Lambda.'
        );
      }
      throw new Error(`CVRP optimization failed: ${errorText}`);
    }

    let result = await response.json() as CVRPResult & { ok?: boolean; received?: unknown; error?: string };

    if (!result.success) {
      console.error('[CVRP] Lambda returned non-success response:', JSON.stringify(result, null, 2).slice(0, 1000));
      const hint = result.ok === true && result.received
        ? ' Lambda returned { ok, received } instead of CVRP result — ensure the Lambda runs the CVRP solver and returns { success, clusters, summary }.'
        : result.error 
        ? ` Lambda error: ${result.error}`
        : '';
      throw new Error('CVRP optimization returned unsuccessful.' + hint);
    }

    console.log(`[CVRP] Optimization complete in ${elapsed}ms`);
    console.log(`[CVRP] Matrix computation: ${result.matrix_time_sec.toFixed(1)}s`);
    console.log(`[CVRP] Total walk time: ${result.summary.total_walk_time_min.toFixed(1)}min`);
    console.log(`[CVRP] Total distance: ${result.summary.total_distance_km.toFixed(2)}km`);

    // EXPAND BLOCKS: If we used block optimization, expand back to addresses
    if (blockOptimize && blockStops && result.clusters) {
      result = this.expandBlockResults(result, blockStops, addresses, addressOrdersWithinBlocks);
    }

    // Add block optimization metadata
    result.block_optimization = blockOptimizationMeta;

    // Post-process: Get actual turn-by-turn routes for each cluster
    if (nAgents <= 5) {
      // For small number of agents, get detailed routes
      console.log('[CVRP] Getting turn-by-turn routes...');
      result.clusters = await this.enrichWithRoutes(result.clusters);
    }

    return result;
  }

  /**
   * Optimize a single walking loop (TSP for 1 agent)
   * Convenience method when you just need the optimal route for one person
   */
  static async optimizeSingleLoop(
    addresses: CVRPAddress[],
    depot?: { lat: number; lon: number },
    options?: CVRPOptions
  ): Promise<CVRPCluster> {
    const result = await this.optimizeRoutes(addresses, 1, depot, options);
    return result.clusters[0];
  }

  /**
   * Split territory fairly among multiple agents
   * Convenience method when you need balanced clusters
   */
  static async splitTerritory(
    addresses: CVRPAddress[],
    nAgents: number,
    depot?: { lat: number; lon: number }
  ): Promise<CVRPResult> {
    return this.optimizeRoutes(addresses, nAgents, depot, {
      street_side_bias: true,
      return_to_depot: true
    });
  }

  /**
   * Expand block optimization results back to individual addresses
   * 
   * The CVRP was run on block stops. Now we need to:
   * 1. Replace each block stop in the cluster with its addresses (in pre-computed order)
   * 2. Update sequences to reflect the expanded order
   * 3. Preserve timing/distance estimates
   */
  private static expandBlockResults(
    result: CVRPResult,
    blockStops: BlockStop[],
    allAddresses: CVRPAddress[],
    addressOrdersWithinBlocks: Map<string, string[]>
  ): CVRPResult {
    console.log(`[CVRP] Expanding ${blockStops.length} blocks to ${allAddresses.length} addresses`);
    
    // Create lookup maps
    const addressMap = new Map(allAddresses.map(a => [a.id, a]));
    const blockStopMap = new Map(blockStops.map(b => [b.id, b]));
    
    // Build expanded clusters
    const expandedClusters: CVRPCluster[] = result.clusters.map(cluster => {
      const expandedAddresses: Array<CVRPAddress & { sequence: number; walk_time_sec: number; distance_m: number }> = [];
      const clusterBlockStops: BlockStop[] = [];
      const clusterBlockOrder: number[] = [];
      
      // Process each address in the cluster (which represents a block stop)
      let globalSequence = 0;
      for (const blockAddr of cluster.addresses) {
        const blockStop = blockStopMap.get(blockAddr.id);
        if (!blockStop) {
          console.warn(`[CVRP] Block stop not found: ${blockAddr.id}`);
          continue;
        }
        
        clusterBlockStops.push(blockStop);
        clusterBlockOrder.push(clusterBlockStops.length - 1);
        
        // Get the pre-computed order for addresses within this block
        const orderedIds = addressOrdersWithinBlocks.get(blockStop.id) || blockStop.addressIds;
        
        // Add addresses in order
        for (const addrId of orderedIds) {
          const addr = addressMap.get(addrId);
          if (!addr) continue;
          
          expandedAddresses.push({
            ...addr,
            sequence: globalSequence++,
            walk_time_sec: 60, // Approximate - will be refined by Valhalla
            distance_m: 100
          });
        }
      }
      
      return {
        ...cluster,
        addresses: expandedAddresses,
        n_addresses: expandedAddresses.length,
        block_stops: clusterBlockStops,
        block_order: clusterBlockOrder
      };
    });
    
    // Update summary
    const totalAddresses = expandedClusters.reduce((sum, c) => sum + c.n_addresses, 0);
    
    return {
      ...result,
      clusters: expandedClusters,
      summary: {
        ...result.summary,
        n_addresses: totalAddresses,
        avg_houses_per_agent: totalAddresses / result.clusters.length
      }
    };
  }

  /** Stadia/Valhalla route API limit (exceeding returns 400) */
  private static readonly MAX_VALHALLA_LOCATIONS = 25;

  /**
   * Enrich clusters with path geometry from Valhalla (fixed sweep order).
   * Chunks waypoints at 25; merges polylines and sums time/distance.
   */
  private static async enrichWithRoutes(clusters: CVRPCluster[]): Promise<CVRPCluster[]> {
    const STADIA_API_KEY = process.env.STADIA_API_KEY;
    if (!STADIA_API_KEY) {
      console.warn('[CVRP] STADIA_API_KEY not set, skipping route enrichment');
      return clusters;
    }

    const enrichedClusters: CVRPCluster[] = [];

    for (const cluster of clusters) {
      if (cluster.addresses.length < 2) {
        enrichedClusters.push(cluster);
        continue;
      }

      const orderedCoords = cluster.addresses
        .sort((a, b) => a.sequence - b.sequence)
        .map(a => ({ lat: a.lat, lon: a.lon }));

      try {
        let polyline: string;
        let totalTimeSec = 0;
        let totalLengthKm = 0;

        if (orderedCoords.length <= this.MAX_VALHALLA_LOCATIONS) {
          const route = await this.getValhallaRoute(orderedCoords);
          polyline = route.polyline;
          totalTimeSec = route.summary.time;
          totalLengthKm = route.summary.length;
        } else {
          const chunks: Array<{ lat: number; lon: number }>[] = [];
          const step = this.MAX_VALHALLA_LOCATIONS - 1;
          for (let i = 0; i < orderedCoords.length; i += step) {
            const chunk = orderedCoords.slice(i, i + this.MAX_VALHALLA_LOCATIONS);
            if (chunk.length >= 2) chunks.push(chunk);
          }
          const decodedArrays: Array<[number, number]>[] = [];
          for (const chunk of chunks) {
            const route = await this.getValhallaRoute(chunk);
            totalTimeSec += route.summary.time;
            totalLengthKm += route.summary.length;
            const pts = this.decodePolyline(route.polyline);
            if (pts.length > 0) decodedArrays.push(pts);
          }
          const merged = this.mergePolylines(decodedArrays);
          polyline = merged.length >= 2 ? this.encodePolyline(merged) : '';
        }

        const totalDistanceM = totalLengthKm * 1000;
        enrichedClusters.push({
          ...cluster,
          total_time_sec: totalTimeSec,
          total_distance_m: totalDistanceM,
          estimated_walk_time_min: Math.round(totalTimeSec / 60),
          route_polyline: polyline || undefined
        });
      } catch (error) {
        console.warn(`[CVRP] Route enrichment failed for cluster ${cluster.agent_id}:`, error);
        enrichedClusters.push(cluster);
      }
    }

    return enrichedClusters;
  }

  /** Decode Valhalla/Google encoded polyline to [lat, lon] in degrees */
  private static decodePolyline(encoded: string): Array<[number, number]> {
    const points: Array<[number, number]> = [];
    let i = 0;
    let lat = 0;
    let lng = 0;
    while (i < encoded.length) {
      let shift = 0;
      let result = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(i++) - 63;
        result |= (byte & 31) << shift;
        shift += 5;
      } while (byte >= 32);
      lat += (result & 1) ? ~(result >> 1) : result >> 1;
      shift = 0;
      result = 0;
      do {
        byte = encoded.charCodeAt(i++) - 63;
        result |= (byte & 31) << shift;
        shift += 5;
      } while (byte >= 32);
      lng += (result & 1) ? ~(result >> 1) : result >> 1;
      points.push([lat * 1e-6, lng * 1e-6]);
    }
    return points;
  }

  /** Merge chunk polylines (drop first point of each segment after the first to avoid duplicates) */
  private static mergePolylines(decodedArrays: Array<[number, number][]>): Array<[number, number]> {
    if (decodedArrays.length === 0) return [];
    const out = [...decodedArrays[0]];
    for (let i = 1; i < decodedArrays.length; i++) {
      const seg = decodedArrays[i];
      for (let j = 1; j < seg.length; j++) out.push(seg[j]);
    }
    return out;
  }

  /** Encode [lat, lon] in degrees to Valhalla/Google polyline */
  private static encodePolyline(points: Array<[number, number]>): string {
    let encoded = '';
    let prevLat = 0;
    let prevLng = 0;
    for (const [lat, lng] of points) {
      const latInt = Math.round(lat * 1e6);
      const lngInt = Math.round(lng * 1e6);
      encoded += this.encodeSignedInt(latInt - prevLat);
      encoded += this.encodeSignedInt(lngInt - prevLng);
      prevLat = latInt;
      prevLng = lngInt;
    }
    return encoded;
  }

  private static encodeSignedInt(value: number): string {
    let s = value < 0 ? ~(value << 1) : value << 1;
    let result = '';
    while (s >= 32) {
      result += String.fromCharCode((32 | (s & 31)) + 63);
      s >>= 5;
    }
    result += String.fromCharCode(s + 63);
    return result;
  }

  /**
   * Get pedestrian path from Valhalla (Stadia route/v1) in fixed waypoint order.
   * Uses door-knocking costing: fewer turns, avoid alleys, gentle on hills.
   */
  private static async getValhallaRoute(
    coords: Array<{ lat: number; lon: number }>
  ): Promise<{ polyline: string; summary: { length: number; time: number } }> {
    const STADIA_API_KEY = process.env.STADIA_API_KEY;
    const locations = coords
      .map(c => ({ lat: Number(c.lat), lon: Number(c.lon) }))
      .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180);
    if (locations.length < 2) {
      throw new Error('Valhalla requires at least 2 valid coordinates');
    }

    const response = await fetch(
      `https://api.stadiamaps.com/route/v1?api_key=${STADIA_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locations,
          costing: 'pedestrian',
          costing_options: {
            pedestrian: {
              walking_speed: 5.1,
              step_penalty: 30,
              use_hills: 0.3,
              shortest: false,
              alley_factor: 0.5
            }
          }
        })
      }
    );

    const bodyText = await response.text();
    if (!response.ok) {
      let detail = bodyText;
      try {
        const err = JSON.parse(bodyText);
        detail = err.error?.message ?? err.message ?? bodyText;
      } catch {
        // use bodyText as-is
      }
      throw new Error(`Valhalla error: ${response.status} — ${detail}`);
    }

    const data = JSON.parse(bodyText);
    const leg = data.trip?.legs?.[0];
    const summary = data.trip?.summary ?? { length: 0, time: 0 };
    return {
      polyline: leg?.shape ?? '',
      summary: { length: summary.length ?? 0, time: summary.time ?? 0 }
    };
  }

  /**
   * Calculate centroid of addresses for default depot
   */
  private static calculateCentroid(
    addresses: CVRPAddress[]
  ): { lat: number; lon: number } {
    let sumLat = 0;
    let sumLon = 0;
    
    for (const addr of addresses) {
      sumLat += addr.lat;
      sumLon += addr.lon;
    }
    
    return {
      lat: sumLat / addresses.length,
      lon: sumLon / addresses.length
    };
  }

  /**
   * Format walk time for display
   */
  static formatWalkTime(seconds: number): string {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return `${hours}h ${remaining}m`;
  }

  /**
   * Format distance for display
   */
  static formatDistance(meters: number): string {
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
  }
}
