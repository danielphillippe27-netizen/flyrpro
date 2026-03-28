import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EARTH_RADIUS_M = 6371000;

function toLocalMeters(lng: number, lat: number, origin: { lng: number; lat: number }) {
  const x = (lng - origin.lng) * (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(origin.lat * Math.PI / 180);
  const y = (lat - origin.lat) * (Math.PI / 180) * EARTH_RADIUS_M;
  return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

function transformCoordinates(coords: unknown, origin: { lng: number; lat: number }): unknown {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === "number") {
    const { x, y } = toLocalMeters(coords[0] as number, coords[1] as number, origin);
    return [x, y];
  }
  return coords.map((c) => transformCoordinates(c, origin));
}

function transformGeometry(geometry: unknown, origin: { lng: number; lat: number }): unknown {
  if (!geometry || typeof geometry !== "object") return geometry;
  const g = geometry as Record<string, unknown>;
  return { ...g, coordinates: transformCoordinates(g.coordinates, origin) };
}

function defaultHeight(buildingType: string | null): number {
  switch (buildingType) {
    case "commercial":
      return 8;
    case "industrial":
      return 6;
    case "apartments":
    case "residential_multifamily":
      return 12;
    default:
      return 7;
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { campaign_id?: string; padding_meters?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const campaign_id = body.campaign_id;
  const padding_meters = body.padding_meters ?? 50;

  if (!campaign_id || typeof campaign_id !== "string") {
    return new Response(JSON.stringify({ error: "campaign_id required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: metaRows, error: metaErr } = await supabase.rpc("get_campaign_geometry_meta", {
    p_campaign_id: campaign_id,
  });
  if (metaErr) {
    return new Response(JSON.stringify({ error: metaErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const meta = Array.isArray(metaRows) ? metaRows[0] : null;
  if (!meta || meta.boundary_geojson == null) {
    return new Response(JSON.stringify({ error: "Campaign geometry not found" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const origin = { lng: meta.centroid_lng as number, lat: meta.centroid_lat as number };

  const { data: targetBuildings, error: tErr } = await supabase.rpc("get_blender_target_buildings", {
    p_campaign_id: campaign_id,
  });
  if (tErr) {
    return new Response(JSON.stringify({ error: tErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: contextBuildings, error: cErr } = await supabase.rpc("get_blender_context_buildings", {
    p_campaign_id: campaign_id,
    p_padding_meters: padding_meters,
    p_simplify_tolerance: 0.000005,
  });
  if (cErr) {
    return new Response(JSON.stringify({ error: cErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: roadsRows, error: rErr } = await supabase.rpc("get_blender_roads", {
    p_campaign_id: campaign_id,
  });
  if (rErr) {
    return new Response(JSON.stringify({ error: rErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: addressRows, error: aErr } = await supabase.rpc("get_blender_addresses", {
    p_campaign_id: campaign_id,
  });
  if (aErr) {
    return new Response(JSON.stringify({ error: aErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const targets = (targetBuildings ?? []) as Array<Record<string, unknown>>;
  const contexts = (contextBuildings ?? []) as Array<Record<string, unknown>>;
  const roads = (roadsRows ?? []) as Array<Record<string, unknown>>;
  const addresses = (addressRows ?? []) as Array<Record<string, unknown>>;

  const buildingFeatures: Array<{ type: "Feature"; geometry: object; properties: Record<string, unknown> }> = [];

  for (const b of targets) {
    const geom = transformGeometry(JSON.parse(b.geom_geojson as string), origin);
    const buildingType = (b.building_type as string | null) ?? null;
    const hm = b.height_m != null ? Number(b.height_m) : null;
    buildingFeatures.push({
      type: "Feature",
      geometry: geom as object,
      properties: {
        is_target: true,
        height_m: hm ?? defaultHeight(buildingType),
        address: b.address ?? null,
        lead_status: b.lead_status ?? null,
        visited: b.visited ?? false,
        external_id: b.external_id ?? null,
        building_type: buildingType,
        floors: b.floors ?? null,
      },
    });
  }

  for (const b of contexts) {
    const geom = transformGeometry(JSON.parse(b.geom_geojson as string), origin);
    const buildingType = (b.building_type as string | null) ?? null;
    const hm = b.height_m != null ? Number(b.height_m) : null;
    buildingFeatures.push({
      type: "Feature",
      geometry: geom as object,
      properties: {
        is_target: false,
        height_m: hm ?? defaultHeight(buildingType),
        external_id: b.external_id ?? null,
        building_type: buildingType,
        floors: b.floors ?? null,
      },
    });
  }

  const buildingsGeo = {
    type: "FeatureCollection" as const,
    features: buildingFeatures,
  };

  const roadFeatures: Array<{ type: "Feature"; geometry: object; properties: Record<string, unknown> }> = [];
  for (const row of roads) {
    const geom = transformGeometry(JSON.parse(row.geom_geojson as string), origin);
    roadFeatures.push({
      type: "Feature",
      geometry: geom as object,
      properties: {
        road_id: row.road_id,
        road_name: row.road_name,
        road_class: row.road_class,
      },
    });
  }
  const roadsGeo = {
    type: "FeatureCollection" as const,
    features: roadFeatures,
  };

  const addressFeatures: Array<{ type: "Feature"; geometry: object; properties: Record<string, unknown> }> = [];
  for (const a of addresses) {
    const geom = transformGeometry(JSON.parse(a.geom_geojson as string), origin);
    addressFeatures.push({
      type: "Feature",
      geometry: geom as object,
      properties: {
        id: a.id,
        formatted: a.formatted,
        street_name: a.street_name,
        house_number: a.house_number,
        lead_status: a.lead_status,
        visited: a.visited,
        building_id: a.building_id,
        seq: a.seq,
      },
    });
  }
  const addressesGeo = {
    type: "FeatureCollection" as const,
    features: addressFeatures,
  };

  const boundaryGeomRaw = JSON.parse(meta.boundary_geojson as string);
  const boundaryGeom = transformGeometry(boundaryGeomRaw, origin);
  const boundaryGeo = {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: boundaryGeom as object,
        properties: {
          campaign_id,
          origin_lng: origin.lng,
          origin_lat: origin.lat,
        },
      },
    ],
  };

  const manifest = {
    export_version: 1,
    campaign_id,
    created_at: new Date().toISOString(),
    origin: { lng: origin.lng, lat: origin.lat },
    coordinate_system: "local_meters_from_origin",
    padding_meters,
    simplification_tolerance: 0.000005,
    counts: {
      target_buildings: targets.length,
      context_buildings: contexts.length,
      roads: roads.length,
      addresses: addresses.length,
    },
    source: "ref_buildings_gold",
    storage: {
      bucket: "blender-exports",
      prefix: `${campaign_id}/v1`,
      files: {
        boundary: `${campaign_id}/v1/boundary.geojson`,
        buildings: `${campaign_id}/v1/buildings.geojson`,
        roads: `${campaign_id}/v1/roads.geojson`,
        addresses: `${campaign_id}/v1/addresses.geojson`,
        manifest: `${campaign_id}/v1/manifest.json`,
      },
    },
  };

  const prefix = `${campaign_id}/v1`;
  const keys = {
    boundary: `${prefix}/boundary.geojson`,
    buildings: `${prefix}/buildings.geojson`,
    roads: `${prefix}/roads.geojson`,
    addresses: `${prefix}/addresses.geojson`,
    manifest: `${prefix}/manifest.json`,
  };

  const enc = new TextEncoder();
  const upload = (key: string, data: unknown) => {
    return supabase.storage.from("blender-exports").upload(key, enc.encode(JSON.stringify(data, null, 2)), {
      upsert: true,
      contentType: "application/json",
    });
  };

  const uploadResults = await Promise.all([
    upload(keys.boundary, boundaryGeo),
    upload(keys.buildings, buildingsGeo),
    upload(keys.roads, roadsGeo),
    upload(keys.addresses, addressesGeo),
    upload(keys.manifest, manifest),
  ]);

  for (const u of uploadResults) {
    if (u.error) {
      return new Response(JSON.stringify({ error: u.error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const ttlSec = 60 * 60 * 24 * 30;
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();

  async function signedUrl(key: string): Promise<string | null> {
    const { data, error } = await supabase.storage.from("blender-exports").createSignedUrl(key, ttlSec);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }

  const [buildingsUrl, addressesUrl, roadsUrl, metadataUrl] = await Promise.all([
    signedUrl(keys.buildings),
    signedUrl(keys.addresses),
    signedUrl(keys.roads),
    signedUrl(keys.manifest),
  ]);

  const { error: snapErr } = await supabase.from("campaign_snapshots").upsert(
    {
      campaign_id,
      bucket: "blender-exports",
      prefix,
      buildings_key: keys.buildings,
      addresses_key: keys.addresses,
      roads_key: keys.roads,
      metadata_key: keys.manifest,
      buildings_url: buildingsUrl,
      addresses_url: addressesUrl,
      roads_url: roadsUrl,
      metadata_url: metadataUrl,
      buildings_count: targets.length + contexts.length,
      addresses_count: addresses.length,
      roads_count: roads.length,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    },
    { onConflict: "campaign_id" },
  );

  if (snapErr) {
    return new Response(JSON.stringify({ error: snapErr.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const fileKeys = [keys.boundary, keys.buildings, keys.roads, keys.addresses, keys.manifest];

  return new Response(
    JSON.stringify({
      success: true,
      campaign_id,
      manifest,
      files: fileKeys,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
