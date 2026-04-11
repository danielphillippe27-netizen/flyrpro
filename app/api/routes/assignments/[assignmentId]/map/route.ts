import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { asUuid, canManageRoutes, getWorkspaceRole } from '@/app/api/routes/_lib';

type JsonObject = Record<string, unknown>;

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function featureCollection(features: unknown[]): JsonObject {
  return {
    type: 'FeatureCollection',
    features,
  };
}

function parseFeatureCollection(raw: unknown): JsonObject {
  if (typeof raw === 'string') {
    try {
      return parseFeatureCollection(JSON.parse(raw));
    } catch {
      return featureCollection([]);
    }
  }

  if (Array.isArray(raw)) {
    return featureCollection(raw.filter(isObject));
  }

  if (isObject(raw)) {
    if (Array.isArray(raw.features)) return raw;
    const values = Object.values(raw);
    if (values.length === 1) return parseFeatureCollection(values[0]);
  }

  return featureCollection([]);
}

function featureId(feature: JsonObject): string | null {
  return normalizeIdentifier(feature.id);
}

function featureProperties(feature: JsonObject): JsonObject {
  return isObject(feature.properties) ? feature.properties : {};
}

function stopLatLng(stop: JsonObject): { lat: number; lng: number } | null {
  const lat = typeof stop.lat === 'number' ? stop.lat : null;
  const lng = typeof stop.lng === 'number' ? stop.lng : null;
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function buildStopsGeoJSON(stops: JsonObject[]): JsonObject {
  const features = stops.flatMap((stop) => {
    const coordinate = stopLatLng(stop);
    if (!coordinate) return [];

    return [{
      type: 'Feature',
      id: typeof stop.id === 'string' ? stop.id : undefined,
      geometry: {
        type: 'Point',
        coordinates: [coordinate.lng, coordinate.lat],
      },
      properties: {
        stop_order: stop.stop_order,
        address_id: stop.address_id,
        gers_id: stop.gers_id,
        building_id: stop.building_id,
        display_address: stop.display_address,
      },
    }];
  });

  return featureCollection(features);
}

function computeBBox(collections: JsonObject[]): [number, number, number, number] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return;

    if (
      node.length >= 2 &&
      typeof node[0] === 'number' &&
      typeof node[1] === 'number' &&
      Number.isFinite(node[0]) &&
      Number.isFinite(node[1])
    ) {
      const lng = node[0];
      const lat = node[1];
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
      return;
    }

    for (const child of node) visit(child);
  };

  for (const collection of collections) {
    const features = Array.isArray(collection.features) ? collection.features : [];
    for (const rawFeature of features) {
      if (!isObject(rawFeature)) continue;
      const geometry = isObject(rawFeature.geometry) ? rawFeature.geometry : null;
      visit(geometry?.coordinates);
    }
  }

  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function orderedStops(stops: JsonObject[]): JsonObject[] {
  return [...stops].sort((lhs, rhs) => {
    const left = typeof lhs.stop_order === 'number' ? lhs.stop_order : Number.MAX_SAFE_INTEGER;
    const right = typeof rhs.stop_order === 'number' ? rhs.stop_order : Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}

function filterBuildingsForStops(buildingsCollection: JsonObject, stops: JsonObject[]): JsonObject {
  const addressIds = new Set(
    stops.map((stop) => normalizeIdentifier(stop.address_id)).filter((value): value is string => Boolean(value))
  );
  const buildingIds = new Set(
    stops
      .flatMap((stop) => [stop.gers_id, stop.building_id])
      .map(normalizeIdentifier)
      .filter((value): value is string => Boolean(value))
  );

  const features = Array.isArray(buildingsCollection.features) ? buildingsCollection.features : [];
  const filtered = features.filter((rawFeature) => {
    if (!isObject(rawFeature)) return false;
    const props = featureProperties(rawFeature);

    const maybeAddressId = normalizeIdentifier(props.address_id);
    if (maybeAddressId && addressIds.has(maybeAddressId)) return true;

    const candidates = [
      props.building_id,
      props.gers_id,
      rawFeature.id,
      props.id,
    ]
      .map(normalizeIdentifier)
      .filter((value): value is string => Boolean(value));

    return candidates.some((value) => buildingIds.has(value));
  });

  return featureCollection(filtered);
}

function filterAddressesForStops(addressesCollection: JsonObject, stops: JsonObject[]): JsonObject {
  const addressIds = new Set(
    stops.map((stop) => normalizeIdentifier(stop.address_id)).filter((value): value is string => Boolean(value))
  );
  const buildingOnlyIds = new Set(
    stops
      .filter((stop) => !normalizeIdentifier(stop.address_id))
      .flatMap((stop) => [stop.gers_id, stop.building_id])
      .map(normalizeIdentifier)
      .filter((value): value is string => Boolean(value))
  );

  const features = Array.isArray(addressesCollection.features) ? addressesCollection.features : [];
  const filtered = features.filter((rawFeature) => {
    if (!isObject(rawFeature)) return false;
    const props = featureProperties(rawFeature);

    const maybeAddressId = normalizeIdentifier(props.id) ?? featureId(rawFeature);
    if (maybeAddressId && addressIds.has(maybeAddressId)) return true;

    const candidates = [props.building_gers_id, props.gers_id]
      .map(normalizeIdentifier)
      .filter((value): value is string => Boolean(value));

    return candidates.some((value) => buildingOnlyIds.has(value));
  });

  return featureCollection(filtered);
}

async function computeCampaignVersion(admin: ReturnType<typeof createAdminClient>, campaignId: string): Promise<string> {
  const [{ data: campaign }, { count: addressCount }, { count: roadCount }] = await Promise.all([
    admin
      .from('campaigns')
      .select('updated_at')
      .eq('id', campaignId)
      .maybeSingle(),
    admin
      .from('campaign_addresses')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId),
    admin
      .from('campaign_roads')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId),
  ]);

  return [
    typeof campaign?.updated_at === 'string' ? campaign.updated_at : 'campaign-none',
    `a${addressCount ?? 0}`,
    `r${roadCount ?? 0}`,
  ].join('|');
}

async function loadRoadsGeoJSON(admin: ReturnType<typeof createAdminClient>, campaignId: string): Promise<JsonObject | null> {
  const { data, error } = await admin
    .from('campaign_roads')
    .select('gers_id, geom')
    .eq('campaign_id', campaignId);

  if (error || !Array.isArray(data)) {
    return null;
  }

  const features = data.flatMap((row) => {
    const geom = row?.geom;
    if (!geom || typeof geom !== 'object') return [];

    return [{
      type: 'Feature',
      id: typeof row.gers_id === 'string' ? row.gers_id : undefined,
      geometry: geom,
      properties: {
        id: typeof row.gers_id === 'string' ? row.gers_id : null,
        gers_id: typeof row.gers_id === 'string' ? row.gers_id : null,
      },
    }];
  });

  return featureCollection(features);
}

async function storeSnapshot(
  admin: ReturnType<typeof createAdminClient>,
  snapshot: {
    assignmentId: string;
    routePlanId: string;
    campaignId: string;
    workspaceId: string;
    campaignVersion: string;
    routeVersion: number;
    stopsGeoJSON: JsonObject;
    buildingsGeoJSON: JsonObject;
    addressesGeoJSON: JsonObject;
    roadsGeoJSON: JsonObject | null;
    bbox: [number, number, number, number] | null;
    featureCounts: JsonObject;
  }
) {
  const existing = await admin
    .from('route_map_snapshots')
    .select('id')
    .eq('assignment_id', snapshot.assignmentId)
    .maybeSingle();

  const payload = {
    assignment_id: snapshot.assignmentId,
    route_plan_id: snapshot.routePlanId,
    campaign_id: snapshot.campaignId,
    workspace_id: snapshot.workspaceId,
    snapshot_kind: 'assignment',
    status: 'ready',
    campaign_version: snapshot.campaignVersion,
    route_version: snapshot.routeVersion,
    stops_geojson: snapshot.stopsGeoJSON,
    buildings_geojson: snapshot.buildingsGeoJSON,
    addresses_geojson: snapshot.addressesGeoJSON,
    roads_geojson: snapshot.roadsGeoJSON,
    bbox: snapshot.bbox,
    feature_counts: snapshot.featureCounts,
    generated_at: new Date().toISOString(),
  };

  if (existing.data?.id) {
    await admin.from('route_map_snapshots').update(payload).eq('id', existing.data.id);
    return;
  }

  await admin.from('route_map_snapshots').insert(payload);
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ assignmentId: string }> }
) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { assignmentId: rawAssignmentId } = await context.params;
    const assignmentId = asUuid(rawAssignmentId);
    if (!assignmentId) {
      return NextResponse.json({ error: 'Invalid assignment id' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: assignment, error: assignmentError } = await admin
      .from('route_assignments')
      .select(
        'id, route_plan_id, workspace_id, assigned_to_user_id, assigned_by_user_id, status, priority, due_at, notes, accepted_at, started_at, completed_at, updated_at'
      )
      .eq('id', assignmentId)
      .maybeSingle();

    if (assignmentError || !assignment?.id) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const role = await getWorkspaceRole(assignment.workspace_id, user.id);
    if (!role) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!canManageRoutes(role) && assignment.assigned_to_user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [{ data: routePlan, error: routePlanError }, { data: stops, error: stopsError }] =
      await Promise.all([
        admin
          .from('route_plans')
          .select('id, workspace_id, campaign_id, name, total_stops, est_minutes, distance_meters, segments, route_version')
          .eq('id', assignment.route_plan_id)
          .maybeSingle(),
        admin
          .from('route_stops')
          .select('id, stop_order, address_id, gers_id, lat, lng, display_address, building_id')
          .eq('route_plan_id', assignment.route_plan_id)
          .order('stop_order', { ascending: true }),
      ]);

    if (routePlanError || !routePlan?.id) {
      return NextResponse.json({ error: 'Route plan not found' }, { status: 404 });
    }
    if (stopsError) {
      return NextResponse.json({ error: stopsError.message }, { status: 500 });
    }
    if (!routePlan.campaign_id) {
      return NextResponse.json({ error: 'Route plan is not linked to a campaign' }, { status: 409 });
    }

    const sortedStops = orderedStops((stops ?? []) as JsonObject[]);
    const routeVersion = typeof routePlan.route_version === 'number' ? routePlan.route_version : 1;
    const campaignVersion = await computeCampaignVersion(admin, routePlan.campaign_id);

    const { data: snapshot } = await admin
      .from('route_map_snapshots')
      .select(
        'campaign_version, route_version, buildings_geojson, addresses_geojson, roads_geojson, stops_geojson, bbox, feature_counts, generated_at'
      )
      .eq('assignment_id', assignmentId)
      .maybeSingle();

    if (
      snapshot &&
      snapshot.campaign_version === campaignVersion &&
      snapshot.route_version === routeVersion
    ) {
      return NextResponse.json({
        assignment,
        route_plan: routePlan,
        stops: sortedStops,
        role,
        snapshot: {
          generated_at: snapshot.generated_at,
          campaign_version: snapshot.campaign_version,
          route_version: snapshot.route_version,
          feature_counts: snapshot.feature_counts ?? {},
          bbox: snapshot.bbox ?? null,
        },
        buildings: snapshot.buildings_geojson ?? featureCollection([]),
        addresses: snapshot.addresses_geojson ?? featureCollection([]),
        roads: snapshot.roads_geojson ?? null,
        stops_geojson: snapshot.stops_geojson ?? buildStopsGeoJSON(sortedStops),
      });
    }

    const [rawBuildings, rawAddresses, roadsGeoJSON] = await Promise.all([
      admin.rpc('rpc_get_campaign_full_features', { p_campaign_id: routePlan.campaign_id }),
      admin.rpc('rpc_get_campaign_addresses', { p_campaign_id: routePlan.campaign_id }),
      loadRoadsGeoJSON(admin, routePlan.campaign_id),
    ]);

    if (rawBuildings.error) {
      return NextResponse.json({ error: rawBuildings.error.message }, { status: 500 });
    }
    if (rawAddresses.error) {
      return NextResponse.json({ error: rawAddresses.error.message }, { status: 500 });
    }

    const buildingsGeoJSON = filterBuildingsForStops(parseFeatureCollection(rawBuildings.data), sortedStops);
    const addressesGeoJSON = filterAddressesForStops(parseFeatureCollection(rawAddresses.data), sortedStops);
    const stopsGeoJSON = buildStopsGeoJSON(sortedStops);
    const bbox = computeBBox([buildingsGeoJSON, addressesGeoJSON, stopsGeoJSON]);
    const featureCounts = {
      stops: sortedStops.length,
      buildings: Array.isArray(buildingsGeoJSON.features) ? buildingsGeoJSON.features.length : 0,
      addresses: Array.isArray(addressesGeoJSON.features) ? addressesGeoJSON.features.length : 0,
      roads: Array.isArray(roadsGeoJSON?.features) ? roadsGeoJSON.features.length : 0,
    };

    await storeSnapshot(admin, {
      assignmentId,
      routePlanId: routePlan.id,
      campaignId: routePlan.campaign_id,
      workspaceId: routePlan.workspace_id,
      campaignVersion,
      routeVersion,
      stopsGeoJSON,
      buildingsGeoJSON,
      addressesGeoJSON,
      roadsGeoJSON,
      bbox,
      featureCounts,
    });

    return NextResponse.json({
      assignment,
      route_plan: routePlan,
      stops: sortedStops,
      role,
      snapshot: {
        generated_at: new Date().toISOString(),
        campaign_version: campaignVersion,
        route_version: routeVersion,
        feature_counts: featureCounts,
        bbox,
      },
      buildings: buildingsGeoJSON,
      addresses: addressesGeoJSON,
      roads: roadsGeoJSON,
      stops_geojson: stopsGeoJSON,
    });
  } catch (error) {
    console.error('[api/routes/assignments/[assignmentId]/map] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
