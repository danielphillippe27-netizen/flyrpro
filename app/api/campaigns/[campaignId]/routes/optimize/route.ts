import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { buildRoute } from '@/lib/services/BlockRoutingService';

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
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
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

    const optimized = addresses && addresses.length > 0 && addresses.some(a => a.cluster_id !== null);
    if (!optimized) {
      return NextResponse.json({
        success: true,
        optimized: false,
        n_clusters: 0,
        clusters: []
      });
    }

    const clusterMap = new Map<number, typeof addresses>();
    for (const addr of addresses || []) {
      if (addr.cluster_id !== null) {
        if (!clusterMap.has(addr.cluster_id)) clusterMap.set(addr.cluster_id, []);
        clusterMap.get(addr.cluster_id)!.push(addr);
      }
    }

    const clusters = Array.from(clusterMap.entries()).map(([agent_id, clusterAddresses]) => {
      let totalTimeSec = 0;
      let totalDistanceM = 0;
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
 * Builds walking route using Street-Block-Sweep-Snake only (no CVRP/Lambda).
 * Splits ordered stops into n_agents contiguous clusters and persists to DB.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;

  console.log(`[API] POST /campaigns/${campaignId}/routes/optimize`);

  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
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

    const body = await request.json();
    const nAgents = Math.max(1, Number(body.n_agents) || 1);
    const depotFromBody = body.depot as { lat: number; lon: number } | undefined;
    const options = body.options || {};

    const { data: addresses, error: addrError } = await supabase
      .from('campaign_addresses')
      .select('id, formatted, house_number, street_name, geom')
      .eq('campaign_id', campaignId);

    if (addrError || !addresses || addresses.length < 2) {
      return NextResponse.json({ error: 'Need at least 2 addresses' }, { status: 400 });
    }

    const buildRouteAddresses = addresses.map(a => ({
      id: a.id,
      lat: a.geom.coordinates[1],
      lon: a.geom.coordinates[0],
      house_number: a.house_number ?? undefined,
      street_name: a.street_name ?? undefined,
      formatted: a.formatted ?? undefined
    }));

    let depot = depotFromBody;
    if (!depot || typeof depot.lat !== 'number' || typeof depot.lon !== 'number') {
      const sumLat = buildRouteAddresses.reduce((s, a) => s + a.lat, 0);
      const sumLon = buildRouteAddresses.reduce((s, a) => s + a.lon, 0);
      depot = { lat: sumLat / buildRouteAddresses.length, lon: sumLon / buildRouteAddresses.length };
    }

    const startTime = Date.now();
    const result = await buildRoute(buildRouteAddresses, depot, {
      include_geometry: false,
      threshold_meters: options.threshold_meters ?? 50,
      sweep_nn_threshold_m: options.sweep_nn_threshold_m ?? 500
    });
    const totalTime = Date.now() - startTime;

    const stops = result.stops;
    if (stops.length === 0) {
      return NextResponse.json({ error: 'No stops produced' }, { status: 400 });
    }

    // Multi-agent: split into n_agents contiguous segments by sequence_index
    const n = stops.length;
    const segmentSize = Math.ceil(n / nAgents);
    const clusters: Array<{ agent_id: number; addresses: typeof stops }> = [];
    for (let g = 0; g < nAgents; g++) {
      const start = g * segmentSize;
      const end = Math.min(start + segmentSize, n);
      if (start >= n) break;
      const segment = stops.filter(s => s.sequence_index >= start && s.sequence_index < end);
      if (segment.length > 0) {
        clusters.push({
          agent_id: g + 1,
          addresses: segment
        });
      }
    }

    await supabase.rpc('clear_campaign_routes', { p_campaign_id: campaignId });

    const updatePromises = clusters.flatMap(c =>
      c.addresses.map((addr, idx) =>
        supabase
          .from('campaign_addresses')
          .update({ cluster_id: c.agent_id, sequence: idx, walk_time_sec: null, distance_m: null })
          .eq('id', addr.id)
      )
    );
    await Promise.all(updatePromises);

    const transformedClusters = clusters.map(cluster => ({
      agent_id: cluster.agent_id,
      n_addresses: cluster.addresses.length,
      total_time_min: 0,
      total_distance_km: '0.00',
      addresses: cluster.addresses.map((addr, idx) => ({
        id: addr.id,
        sequence: idx,
        formatted: addr.formatted || '',
        house_number: addr.house_number || '',
        street_name: addr.street_name || ''
      }))
    }));

    return NextResponse.json({
      success: true,
      optimized: true,
      n_clusters: transformedClusters.length,
      clusters: transformedClusters,
      debug: {
        total_time_ms: totalTime,
        n_input_addresses: addresses.length,
        n_output_addresses: stops.length
      }
    });
  } catch (error) {
    console.error('[API] Route optimize error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Optimization failed' },
      { status: 500 }
    );
  }
}
