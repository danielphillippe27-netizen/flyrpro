import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { CVRPRoutingService } from '@/lib/services/CVRPRoutingService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/[campaignId]/routes/optimize
 * 
 * Fetches existing optimized routes from the database.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;

  console.log(`[API] GET /campaigns/${campaignId}/routes/optimize`);
  
  try {
    // Create Supabase client with user session from cookies for auth
    const authClient = await getSupabaseServerClient();
    
    // Check auth
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Use admin client for database operations
    const supabase = createAdminClient();
    
    // Verify campaign ownership
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('owner_id')
      .eq('id', campaignId)
      .single();
    
    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    
    if (campaign.owner_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    
    // Fetch addresses with cluster/sequence data
    const { data: addresses, error: addrError } = await supabase
      .from('campaign_addresses')
      .select('id, formatted, house_number, street_name, geom, cluster_id, sequence, walk_time_sec, distance_m')
      .eq('campaign_id', campaignId)
      .not('cluster_id', 'is', null)
      .order('cluster_id', { ascending: true })
      .order('sequence', { ascending: true });
    
    if (addrError) {
      console.error('[API] Error fetching addresses:', addrError);
      return NextResponse.json({ error: 'Failed to fetch routes' }, { status: 500 });
    }
    
    // Check if any addresses have been optimized
    const optimized = addresses && addresses.length > 0 && addresses.some(a => a.cluster_id !== null);
    
    if (!optimized) {
      return NextResponse.json({
        success: true,
        optimized: false,
        n_clusters: 0,
        clusters: []
      });
    }
    
    // Group addresses by cluster_id
    const clusterMap = new Map<number, typeof addresses>();
    for (const addr of addresses || []) {
      if (addr.cluster_id !== null) {
        if (!clusterMap.has(addr.cluster_id)) {
          clusterMap.set(addr.cluster_id, []);
        }
        clusterMap.get(addr.cluster_id)!.push(addr);
      }
    }
    
    // Build clusters array
    const clusters = Array.from(clusterMap.entries()).map(([agent_id, clusterAddresses]) => {
      // Calculate total time and distance for this cluster
      let totalTimeSec = 0;
      let totalDistanceM = 0;
      
      // Sum up individual segment times/distances
      for (const addr of clusterAddresses) {
        totalTimeSec += addr.walk_time_sec || 0;
        totalDistanceM += addr.distance_m || 0;
      }
      
      return {
        agent_id,
        n_addresses: clusterAddresses.length,
        total_time_min: Math.round((totalTimeSec / 60 + Number.EPSILON) * 10) / 10,
        total_distance_km: (totalDistanceM / 1000).toFixed(2),
        addresses: clusterAddresses.map(addr => ({
          id: addr.id,
          sequence: addr.sequence || 0,
          formatted: addr.formatted || '',
          house_number: addr.house_number || '',
          street_name: addr.street_name || ''
        }))
      };
    });
    
    return NextResponse.json({
      success: true,
      optimized: true,
      n_clusters: clusters.length,
      clusters
    });
    
  } catch (error) {
    console.error('[API] GET routes error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch routes' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/campaigns/[campaignId]/routes/optimize
 * 
 * Optimizes walking routes using CVRP (Capacitated Vehicle Routing Problem).
 * 
 * NEW: Block-based optimization for human-like routes
 * - Groups addresses into "block stops" (contiguous street segments)
 * - Runs CVRP on blocks (not individual addresses)
 * - Expands blocks into local door orders
 * 
 * This produces routes that look like a human walking streets,
 * not a solver creating weird long connectors and outer loops.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;

  console.log(`[API] POST /campaigns/${campaignId}/routes/optimize`);
  
  try {
    // Create Supabase client with user session from cookies for auth
    const authClient = await getSupabaseServerClient();
    
    // Check auth
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Use admin client for database operations
    const supabase = createAdminClient();
    
    // Verify campaign ownership
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('owner_id')
      .eq('id', campaignId)
      .single();
    
    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    
    if (campaign.owner_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    
    // Ensure CVRP Lambda is configured before proceeding
    if (!process.env.CVRP_LAMBDA_URL?.trim()) {
      return NextResponse.json(
        { error: 'CVRP Lambda not configured. Set CVRP_LAMBDA_URL in .env.local.' },
        { status: 503 }
      );
    }
    if (!process.env.CVRP_LAMBDA_SECRET?.trim()) {
      return NextResponse.json(
        { error: 'CVRP Lambda secret not set. Set CVRP_LAMBDA_SECRET in .env.local to match your CVRP Lambda.' },
        { status: 503 }
      );
    }

    // Parse request
    const body = await request.json();
    const nAgents = body.n_agents || 1;
    const depot = body.depot;
    const options = body.options || {};
    
    // Block optimization options (new)
    const blockOptions = {
      enabled: options.block_optimize !== false, // Default: true
      targetSize: options.block_target_size || 50,
      snapToWalkway: options.snap_to_walkway !== false
    };
    
    console.log(`[API] Block optimization: ${blockOptions.enabled ? 'enabled' : 'disabled'} (target: ~${blockOptions.targetSize} blocks)`);
    
    // Fetch addresses
    const { data: addresses, error: addrError } = await supabase
      .from('campaign_addresses')
      .select('id, formatted, house_number, street_name, geom')
      .eq('campaign_id', campaignId);
    
    if (addrError || !addresses || addresses.length < 2) {
      return NextResponse.json(
        { error: 'Need at least 2 addresses' },
        { status: 400 }
      );
    }

    // Convert to CVRP format
    const cvrpAddresses = addresses.map((a) => ({
      id: a.id,
      lat: a.geom.coordinates[1],
      lon: a.geom.coordinates[0],
      house_number: a.house_number,
      street_name: a.street_name,
      formatted: a.formatted
    }));
    
    // Block optimization: Snap block stops to walkways if enabled
    // Note: Block stops are snapped inside CVRPRoutingService.optimizeRoutes
    
    // Clear existing routes
    await supabase.rpc('clear_campaign_routes', {
      p_campaign_id: campaignId
    });
    
    // Run CVRP with block optimization
    const startTime = Date.now();
    const result = await CVRPRoutingService.optimizeRoutes(
      cvrpAddresses,
      nAgents,
      depot,
      {
        street_side_bias: options.street_side_bias ?? true,
        return_to_depot: options.return_to_depot ?? true,
        walking_speed: options.walking_speed ?? 5.0,
        balance_factor: options.balance_factor ?? 1.0,
        // Block optimization options
        block_optimize: blockOptions.enabled,
        block_target_size: blockOptions.targetSize,
        snap_to_walkway: blockOptions.snapToWalkway
      },
      supabase // Pass supabase client for RPC calls
    );
    const totalTime = Date.now() - startTime;
    
    console.log(`[API] Optimization complete in ${totalTime}ms`);
    if (result.block_optimization?.enabled) {
      console.log(`[API] Blocks: ${result.block_optimization.n_block_stops} built in ${result.block_optimization.build_blocks_ms}ms`);
      console.log(`[API] Within-block ordering: ${result.block_optimization.order_within_blocks_ms}ms`);
    }
    
    // Save results
    for (const cluster of result.clusters) {
      for (const addr of cluster.addresses) {
        await supabase
          .from('campaign_addresses')
          .update({
            cluster_id: cluster.agent_id,
            sequence: addr.sequence,
            walk_time_sec: addr.walk_time_sec,
            distance_m: addr.distance_m
          })
          .eq('id', addr.id);
      }
    }
    
    // Transform clusters to match the format expected by RouteLayer
    const transformedClusters = result.clusters.map(cluster => ({
      agent_id: cluster.agent_id,
      n_addresses: cluster.n_addresses,
      total_time_min: cluster.estimated_walk_time_min || Math.round((cluster.total_time_sec / 60 + Number.EPSILON) * 10) / 10,
      total_distance_km: (cluster.total_distance_m / 1000).toFixed(2),
      addresses: cluster.addresses.map(addr => ({
        id: addr.id,
        sequence: addr.sequence,
        formatted: addr.formatted || '',
        house_number: addr.house_number || '',
        street_name: addr.street_name || ''
      })),
      // Include block stop info for visualization (new)
      ...(cluster.block_stops && {
        block_stops: cluster.block_stops.map((b, idx) => ({
          id: b.id,
          lon: b.lon,
          lat: b.lat,
          address_count: b.metadata.count,
          street_name: b.metadata.street_name,
          sequence_in_cluster: idx
        }))
      })
    }));
    
    return NextResponse.json({
      success: true,
      optimized: true,
      n_clusters: result.clusters.length,
      clusters: transformedClusters,
      // Include debug info
      debug: {
        total_time_ms: totalTime,
        block_optimization: result.block_optimization || { enabled: false },
        n_input_addresses: addresses.length,
        n_output_addresses: result.summary.n_addresses
      }
    });
    
  } catch (error) {
    console.error('[API] CVRP error:', error);
    // Include stack trace for debugging
    if (error instanceof Error && error.stack) {
      console.error('[API] Stack:', error.stack);
    }
    // Log env vars (redacted)
    console.log('[API] CVRP_LAMBDA_URL:', process.env.CVRP_LAMBDA_URL ? 'Set' : 'Not set');
    console.log('[API] CVRP_LAMBDA_SECRET:', process.env.CVRP_LAMBDA_SECRET ? 'Set (length: ' + process.env.CVRP_LAMBDA_SECRET.length + ')' : 'Not set');
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Optimization failed' },
      { status: 500 }
    );
  }
}
