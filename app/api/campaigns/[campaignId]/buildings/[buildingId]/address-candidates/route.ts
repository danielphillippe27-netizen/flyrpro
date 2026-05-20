import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseUrl } from "@/lib/supabase/env";
import {
  buildingIdentifierCandidates,
  isUuid as isBuildingUuid,
  normalizeBuildingRouteId,
} from "@/app/api/campaigns/_utils/resolve-campaign-building";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ campaignId: string; buildingId: string | string[] }> };
type Point = [number, number];

type BuildingGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

type ResolvedBuilding = {
  rowId: string | null;
  publicId: string;
  geometry: BuildingGeometry;
  streetName: string | null;
};

type AddressRow = {
  id: string;
  formatted: string | null;
  house_number: string | null;
  street_name: string | null;
  source: string | null;
  geom: unknown;
  building_id?: string | null;
  building_gers_id?: string | null;
};

type LinkRow = {
  address_id: string;
  building_id: string | null;
  confidence: number | null;
  match_type: string | null;
};

function getAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

function finiteQueryNumber(url: URL, name: string): number | null {
  const value = Number(url.searchParams.get(name));
  return Number.isFinite(value) ? value : null;
}

function parseGeometry(value: unknown): BuildingGeometry | null {
  try {
    const raw = typeof value === "string" ? JSON.parse(value) : value;
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as { type?: unknown; coordinates?: unknown };
    if ((candidate.type === "Polygon" || candidate.type === "MultiPolygon") && Array.isArray(candidate.coordinates)) {
      return candidate as BuildingGeometry;
    }
  } catch {
    return null;
  }
  return null;
}

function parsePoint(value: unknown): Point | null {
  if (!value) return null;
  if (typeof value === "object") {
    const geometry = value as { type?: unknown; coordinates?: unknown; geometry?: unknown };
    if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
      const lon = Number(geometry.coordinates[0]);
      const lat = Number(geometry.coordinates[1]);
      return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
    }
    return geometry.geometry ? parsePoint(geometry.geometry) : null;
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  try {
    return parsePoint(JSON.parse(trimmed));
  } catch {
    const match = trimmed.match(/(?:SRID=\d+;)?POINT\s*\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/i);
    if (!match) return null;
    const lon = Number(match[1]);
    const lat = Number(match[2]);
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
  }
}

function normalizeStreetName(street: string): string {
  return street
    .toLowerCase()
    .replace(/\bst\b/g, "street")
    .replace(/\bave\.?\b/g, "avenue")
    .replace(/\bdr\b/g, "drive")
    .replace(/\bblvd\.?\b/g, "boulevard")
    .replace(/\bhwy\.?\b/g, "highway")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function streetMatchScore(addressStreet: string | null, buildingStreet: string | null): number {
  if (!addressStreet || !buildingStreet) return 0;
  const address = normalizeStreetName(addressStreet);
  const building = normalizeStreetName(buildingStreet);
  if (!address || !building) return 0;
  if (address === building) return 1;
  const addressWords = new Set(address.split(" "));
  const buildingWords = building.split(" ");
  const matches = buildingWords.filter((word) => addressWords.has(word)).length;
  return buildingWords.length > 0 ? matches / buildingWords.length : 0;
}

function projectLonLatMeters(point: Point, referenceLatitude: number): Point {
  const earthRadiusMeters = 6_378_137;
  const lonRadians = point[0] * Math.PI / 180;
  const latRadians = point[1] * Math.PI / 180;
  const referenceLatitudeRadians = referenceLatitude * Math.PI / 180;
  return [
    earthRadiusMeters * lonRadians * Math.cos(referenceLatitudeRadians),
    earthRadiusMeters * latRadians,
  ];
}

function pointToSegmentMeters(point: Point, a: Point, b: Point): number {
  const referenceLatitude = point[1];
  const p = projectLonLatMeters(point, referenceLatitude);
  const start = projectLonLatMeters(a, referenceLatitude);
  const end = projectLonLatMeters(b, referenceLatitude);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - start[0], p[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - start[0]) * dx + (p[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p[0] - (start[0] + t * dx), p[1] - (start[1] + t * dy));
}

function isPointInRing(point: Point, ring: Point[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function ringsForGeometry(geometry: BuildingGeometry): Point[][] {
  if (geometry.type === "Polygon") {
    return (geometry.coordinates as number[][][]).map((ring) => ring as Point[]);
  }
  return (geometry.coordinates as number[][][][]).flatMap((polygon) => polygon.map((ring) => ring as Point[]));
}

function distanceToBuildingMeters(point: Point, geometry: BuildingGeometry): number {
  const rings = ringsForGeometry(geometry).filter((ring) => ring.length >= 3);
  if (rings.some((ring) => isPointInRing(point, ring))) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i += 1) {
      best = Math.min(best, pointToSegmentMeters(point, ring[i - 1], ring[i]));
    }
  }
  return Number.isFinite(best) ? best : Number.POSITIVE_INFINITY;
}

function geometryCentroid(geometry: BuildingGeometry): Point | null {
  const points = ringsForGeometry(geometry)
    .flatMap((ring) => ring.slice(0, -1))
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (points.length === 0) return null;
  const sum = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]] as Point, [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

function assessTrust(distanceMeters: number, sameStreet: boolean) {
  if (distanceMeters <= 25) {
    return { confidenceLabel: "high", trusted: true, rejectedReason: null, requiresConfirmation: false };
  }
  if (distanceMeters <= 60) {
    return { confidenceLabel: "medium", trusted: true, rejectedReason: null, requiresConfirmation: false };
  }
  if (distanceMeters <= 120 && sameStreet) {
    return { confidenceLabel: "low", trusted: true, rejectedReason: null, requiresConfirmation: true };
  }
  return {
    confidenceLabel: "low",
    trusted: false,
    rejectedReason: "missing_same_street_validation",
    requiresConfirmation: true,
  };
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

async function ensureCampaignAccess(supabase: SupabaseClient, campaignId: string, userId: string): Promise<boolean> {
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("id, owner_id, workspace_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (error || !campaign) return false;
  if (campaign.owner_id === userId) return true;

  if (campaign.workspace_id) {
    const { data: member } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", campaign.workspace_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (member) return true;
  }

  const { data: campaignMember } = await supabase
    .from("campaign_members")
    .select("campaign_id")
    .eq("campaign_id", campaignId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(campaignMember);
}

async function resolveBuilding(supabase: SupabaseClient, campaignId: string, buildingIdParam: string): Promise<ResolvedBuilding | null> {
  const candidates = buildingIdentifierCandidates(buildingIdParam);

  for (const candidate of candidates) {
    const buildingQuery = supabase
      .from("buildings")
      .select("id, gers_id, geom, addr_street, house_name")
      .eq("campaign_id", campaignId)
      .limit(1);
    const builder = isBuildingUuid(candidate)
      ? buildingQuery.or(`id.eq.${candidate},gers_id.eq.${candidate}`)
      : buildingQuery.eq("gers_id", candidate);
    const { data: row } = await builder.maybeSingle();
    if (row) {
      const geometry = parseGeometry(row.geom);
      if (geometry) {
        return {
          rowId: row.id,
          publicId: row.gers_id ?? row.id,
          geometry,
          streetName: row.addr_street ?? row.house_name ?? null,
        };
      }
    }
  }

  for (const candidate of candidates) {
    if (!isBuildingUuid(candidate)) continue;
    const { data: goldRow } = await supabase
      .from("ref_buildings_gold")
      .select("id, geom, primary_street_name")
      .eq("id", candidate)
      .maybeSingle();
    const geometry = goldRow ? parseGeometry(goldRow.geom) : null;
    if (goldRow && geometry) {
      return {
        rowId: null,
        publicId: goldRow.id,
        geometry,
        streetName: goldRow.primary_street_name ?? null,
      };
    }
  }

  return null;
}

async function reverseCandidatePayload(point: { lat: number; lng: number }): Promise<Record<string, unknown> | null> {
  const token = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  const url = new URL(`https://api.mapbox.com/search/geocode/v6/reverse`);
  url.searchParams.set("longitude", String(point.lng));
  url.searchParams.set("latitude", String(point.lat));
  url.searchParams.set("types", "address");
  url.searchParams.set("access_token", token);

  const response = await fetch(url);
  if (!response.ok) return null;
  const json = await response.json();
  const feature = json?.features?.[0];
  if (!feature) return null;
  const props = feature.properties ?? {};
  const context = props.context ?? {};
  const coordinates = feature.geometry?.coordinates;

  return {
    id: crypto.randomUUID(),
    candidate_type: "reverse_geocode",
    is_synthetic: true,
    source: "mapbox_reverse",
    confidence_label: "estimated",
    candidate_reason: "fallback_reverse_geocode",
    reason: "Estimated address from map",
    requires_confirmation: true,
    formatted: props.full_address ?? props.name ?? feature.place_name ?? null,
    formatted_address: props.full_address ?? props.name ?? feature.place_name ?? null,
    house_number: props.address_number ?? null,
    street_name: props.street ?? null,
    street: props.street ?? null,
    locality: context.place?.name ?? context.locality?.name ?? null,
    region: context.region?.region_code ?? context.region?.name ?? null,
    postal_code: context.postcode?.name ?? null,
    country: context.country?.country_code ?? context.country?.name ?? null,
    coordinate: {
      longitude: Array.isArray(coordinates) ? coordinates[0] : point.lng,
      latitude: Array.isArray(coordinates) ? coordinates[1] : point.lat,
    },
    distance_meters: 0,
    score: 0.35,
  };
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { campaignId, buildingId: buildingIdParam } = await context.params;
    const buildingId = normalizeBuildingRouteId(buildingIdParam);
    const url = new URL(request.url);
    const radiusMeters = Math.min(Math.max(Number(url.searchParams.get("radius_m") ?? 60), 1), 120);
    const maxLimit = radiusMeters > 60 ? 20 : 15;
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? maxLimit), 1), maxLimit);
    const forceReverseGeocode = url.searchParams.get("force_reverse_geocode") === "true";
    const seedLat = finiteQueryNumber(url, "seed_lat");
    const seedLng = finiteQueryNumber(url, "seed_lng");
    const seedPoint = seedLat != null && seedLng != null ? { lat: seedLat, lng: seedLng } : null;

    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser(token);
    if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    if (!await ensureCampaignAccess(supabase, campaignId, user.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const building = await resolveBuilding(supabase, campaignId, buildingId);
    if (!building) {
      return NextResponse.json({ error: "Building not found" }, { status: 404 });
    }

    const [{ data: addressRows, error: addressError }, { data: linkRows, error: linkError }] = await Promise.all([
      supabase
        .from("campaign_addresses")
        .select("id, formatted, house_number, street_name, source, geom, building_id, building_gers_id")
        .eq("campaign_id", campaignId),
      supabase
        .from("building_address_links")
        .select("address_id, building_id, confidence, match_type")
        .eq("campaign_id", campaignId),
    ]);

    if (addressError || linkError) {
      console.error("[address-candidates] query error:", addressError ?? linkError);
      return NextResponse.json({ error: "Failed to fetch candidates" }, { status: 500 });
    }

    const linkedAddressIds = new Set(((linkRows ?? []) as LinkRow[]).map((row) => row.address_id));
    const candidates = ((addressRows ?? []) as AddressRow[])
      .filter((row) => !linkedAddressIds.has(row.id))
      .flatMap((row) => {
        const coordinate = parsePoint(row.geom);
        if (!coordinate) return [];
        const distanceMeters = distanceToBuildingMeters(coordinate, building.geometry);
        if (!Number.isFinite(distanceMeters) || distanceMeters > radiusMeters) return [];
        const streetScore = streetMatchScore(row.street_name, building.streetName);
        const sameStreet = streetScore > 0;
        const trust = assessTrust(distanceMeters, sameStreet);
        const distanceScore = Math.max(0, 1 - distanceMeters / Math.max(radiusMeters, 1));
        const score = Math.min(
          1,
          distanceScore * 0.70 +
            streetScore * 0.18 +
            (row.source?.toLowerCase() === "manual" ? 0.05 : 0) +
            (trust.confidenceLabel === "high" ? 0.2 : trust.confidenceLabel === "medium" ? 0.12 : trust.trusted ? 0.06 : 0)
        );

        return [{
          id: row.id,
          candidate_type: "official",
          is_synthetic: false,
          formatted: row.formatted,
          formatted_address: row.formatted,
          house_number: row.house_number,
          street_name: row.street_name,
          street: row.street_name,
          source: row.source,
          coordinate: { longitude: coordinate[0], latitude: coordinate[1] },
          distance_meters: round(distanceMeters),
          score: round(score, 3),
          reason: sameStreet ? "Nearby, same street" : "Nearby campaign address",
          candidate_reason: trust.trusted
            ? trust.confidenceLabel === "low" ? "nearby_same_street_confirm" : "trusted_nearby_official"
            : trust.rejectedReason,
          confidence_label: trust.confidenceLabel,
          requires_confirmation: trust.requiresConfirmation,
          trusted: trust.trusted,
          rejected_reason: trust.rejectedReason,
        }];
      })
      .sort((a, b) => {
        if (Number(b.trusted) !== Number(a.trusted)) return Number(b.trusted) - Number(a.trusted);
        if (b.score !== a.score) return b.score - a.score;
        if (a.distance_meters !== b.distance_meters) return a.distance_meters - b.distance_meters;
        return String(a.formatted ?? "").localeCompare(String(b.formatted ?? ""), undefined, { numeric: true });
      })
      .slice(0, limit);

    const nearestCandidate = candidates[0] ?? null;
    const trustedCandidate = candidates.find((candidate) => candidate.trusted) ?? null;
    const trustDecision: Record<string, unknown> = {
      used_reverse_geocode: false,
      reason: trustedCandidate
        ? `trusted_official_candidate_${trustedCandidate.confidence_label}`
        : nearestCandidate
          ? "no_trusted_official_candidate_within_120m"
          : "no_official_candidate_within_120m",
      nearest_candidate_distance_m: nearestCandidate?.distance_meters ?? null,
      nearest_candidate_rejected_reason: trustedCandidate ? null : nearestCandidate?.rejected_reason ?? null,
    };

    const outputCandidates = [...candidates] as Array<Record<string, unknown>>;
    if (forceReverseGeocode || !trustedCandidate) {
      const centroid = geometryCentroid(building.geometry);
      const reverseCandidate = centroid
        ? await reverseCandidatePayload({ lng: centroid[0], lat: centroid[1] })
        : seedPoint
          ? await reverseCandidatePayload(seedPoint)
          : null;
      if (reverseCandidate) {
        trustDecision.used_reverse_geocode = true;
        outputCandidates.push(reverseCandidate);
      }
    }

    return NextResponse.json({
      building_id: building.publicId,
      radius_meters: radiusMeters,
      trust_decision: trustDecision,
      candidates: outputCandidates,
    });
  } catch (error) {
    console.error("[address-candidates] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
