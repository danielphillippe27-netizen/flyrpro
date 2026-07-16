import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ensureCampaignAccess } from "@/app/api/campaigns/_utils/access";
import {
  addressIdentitiesMatch,
  normalizedAddressIdentity,
} from "../_utils/addressIdentity";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type RouteContext = { params: Promise<{ campaignId: string }> };

function getAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

type ResolvedBuilding = {
  rowId: string;
  publicId: string;
};

type ManualAddressRow = {
  id: string;
  address: string | null;
  formatted: string | null;
  house_number: string | null;
  street_name: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  building_gers_id: string | null;
  source: string | null;
};

async function resolveBuilding(
  supabase: SupabaseClient,
  buildingIdParam: string
): Promise<ResolvedBuilding | null> {
  const uuidMatch = buildingIdParam.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  const query = supabase.from("buildings").select("id, gers_id").limit(1);
  const builder = uuidMatch
    ? query.or(`id.eq.${buildingIdParam},gers_id.eq.${buildingIdParam}`)
    : query.eq("gers_id", buildingIdParam);
  const { data: row, error } = await builder.maybeSingle();
  if (error || !row) return null;
  const building = row as { id: string; gers_id: string | null };
  return {
    rowId: building.id,
    publicId: building.gers_id ?? building.id,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pointGeoJSON(longitude: number, latitude: number) {
  return { type: "Point", coordinates: [longitude, latitude] as [number, number] };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CampaignMutationResult = {
  applied?: boolean;
  replayed?: boolean;
  error_code?: string | null;
  canonical_state?: Record<string, unknown> | null;
  revision?: number | null;
  event_id?: string | null;
};

function mutationFailure(result: CampaignMutationResult): Response | null {
  if (result.applied) return null;
  const code = result.error_code ?? "CAMPAIGN_MUTATION_FAILED";
  const status = code === "CLIENT_UPGRADE_REQUIRED"
    ? 426
    : code === "CAMPAIGN_ADDRESS_ACCESS_DENIED" || code === "ACTIVE_ASSIGNMENT_REQUIRED"
      ? 403
      : code === "REVISION_CONFLICT" || code === "IDEMPOTENCY_KEY_REUSED" || code === "ADDRESS_ID_CONFLICT"
        ? 409
        : 400;
  return NextResponse.json({ error: code, ...result }, { status });
}

function clientBuild(request: Request, body: Record<string, unknown>): number | null {
  const value = body.client_build ?? request.headers.get("x-client-build");
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function invalidateCampaignMapBundle(
  supabase: SupabaseClient,
  campaignId: string
): Promise<void> {
  const { error } = await supabase
    .from("campaign_map_bundles")
    .delete()
    .eq("campaign_id", campaignId);
  if (error) {
    console.warn("[manual-address] map bundle invalidation skipped:", error.message);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;

    const { campaignId } = await context.params;
    const longitude = payload.longitude;
    const latitude = payload.latitude;
    const formatted = String(payload.formatted ?? "").trim();

    if (!isFiniteNumber(longitude) || !isFiniteNumber(latitude)) {
      return NextResponse.json(
        { error: "longitude and latitude are required numbers" },
        { status: 400 }
      );
    }
    if (!formatted) {
      return NextResponse.json({ error: "formatted is required" }, { status: 400 });
    }

    const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user },
      error: userError,
    } = await supabaseAnon.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const canAccess = await ensureCampaignAccess(supabase, campaignId, user.id);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const requestedBuildingId = String(
      payload.building_id ?? ""
    ).trim();
    const addressProvenance = String(
      payload.address_provenance ?? ""
    ).trim();
    const resolvedBuilding = requestedBuildingId
      ? await resolveBuilding(supabase, requestedBuildingId)
      : null;

    if (requestedBuildingId && !resolvedBuilding) {
      return NextResponse.json(
        { error: "Linked building not found" },
        { status: 404 }
      );
    }

    if (addressProvenance === "field_manual_pin") {
      const suppliedPinId = String(payload.id ?? payload.address_id ?? "").trim();
      if (suppliedPinId && !UUID_PATTERN.test(suppliedPinId)) {
        return NextResponse.json({ error: "id must be a UUID" }, { status: 400 });
      }

      // Older app builds did not send mutation metadata. The exact pin UUID still
      // gives them a stable transition key while newer builds send an explicit ID.
      const pinId = suppliedPinId || randomUUID();
      const mutationId = String(
        payload.client_mutation_id ??
          request.headers.get("x-client-mutation-id") ??
          `legacy-pin-create:${pinId}`
      ).trim();
      const explicitPlatform = String(
        payload.origin_platform ?? request.headers.get("x-client-platform") ?? ""
      ).trim().toLowerCase();
      const platform = explicitPlatform || "legacy";
      const version = String(
        payload.client_version ?? request.headers.get("x-client-version") ?? ""
      ).trim() || null;

      const { data: mutationData, error: mutationError } = await supabaseAnon.rpc(
        "v2_create_campaign_manual_pin",
        {
          p_campaign_id: campaignId,
          p_campaign_address_id: pinId,
          p_formatted: formatted,
          p_lat: latitude,
          p_lon: longitude,
          p_house_number: String(payload.house_number ?? "").trim() || null,
          p_street_name: String(payload.street_name ?? "").trim() || null,
          p_locality: String(payload.locality ?? "").trim() || null,
          p_region: String(payload.region ?? "").trim() || null,
          p_postal_code: String(payload.postal_code ?? "").trim() || null,
          p_assignment_id: String(payload.assignment_id ?? "").trim() || null,
          p_building_gers_id: resolvedBuilding?.publicId ?? null,
          p_client_mutation_id: mutationId,
          p_origin_platform: platform,
          p_client_version: version,
          p_client_build: clientBuild(request, payload),
        }
      );

      if (mutationError) {
        console.error("[manual-address] v2 pin create error:", mutationError);
        return NextResponse.json(
          { error: "Failed to create manual pin", details: mutationError.message },
          { status: 500 }
        );
      }

      const mutation = (mutationData ?? {}) as CampaignMutationResult;
      const failure = mutationFailure(mutation);
      if (failure) return failure;
      const addressRow = mutation.canonical_state;
      if (!addressRow) {
        return NextResponse.json({ error: "Manual pin RPC returned no state" }, { status: 500 });
      }

      if (resolvedBuilding) {
        const { error: linkError } = await supabase
          .from("building_address_links")
          .upsert(
            {
              campaign_id: campaignId,
              building_id: resolvedBuilding.rowId,
              address_id: pinId,
              match_type: "manual",
              confidence: 1,
              is_multi_unit: false,
              unit_count: 1,
            },
            { onConflict: "campaign_id,address_id" }
          );
        if (linkError) {
          console.error("[manual-address] v2 pin link error:", linkError);
          return NextResponse.json(
            { error: "Pin created but failed to link it to the building" },
            { status: 500 }
          );
        }
      }

      await invalidateCampaignMapBundle(supabase, campaignId);
      return NextResponse.json({
        address: addressRow,
        linked_building_id: resolvedBuilding?.publicId ?? null,
        replayed: mutation.replayed === true,
        revision: mutation.revision,
        event_id: mutation.event_id,
      });
    }

    const incomingIdentity = normalizedAddressIdentity({
      houseNumber: payload.house_number,
      streetName: payload.street_name,
      postalCode: payload.postal_code,
      formatted,
    });
    if (incomingIdentity) {
      const { data: existingRows, error: existingError } = await supabase
        .from("campaign_addresses")
        .select("id,address,formatted,house_number,street_name,locality,region,postal_code,building_gers_id,source")
        .eq("campaign_id", campaignId)
        .is("deleted_at", null);

      if (existingError) {
        console.error("[manual-address] existing address lookup error:", existingError);
        return NextResponse.json(
          { error: "Failed to check existing campaign addresses" },
          { status: 500 }
        );
      }

      const existingAddress = ((existingRows ?? []) as ManualAddressRow[]).find((row) =>
        addressIdentitiesMatch(
          incomingIdentity,
          normalizedAddressIdentity({
            houseNumber: row.house_number,
            streetName: row.street_name,
            postalCode: row.postal_code,
            formatted: row.formatted ?? row.address,
          })
        )
      );

      if (existingAddress) {
        if (resolvedBuilding) {
          const { error: linkError } = await supabase
            .from("building_address_links")
            .upsert(
              {
                campaign_id: campaignId,
                building_id: resolvedBuilding.rowId,
                address_id: existingAddress.id,
                match_type: "manual",
                confidence: 1,
                is_multi_unit: false,
                unit_count: 1,
              },
              { onConflict: "campaign_id,address_id" }
            );

          if (linkError) {
            console.error("[manual-address] existing link error:", linkError);
            return NextResponse.json(
              { error: "Existing address found but failed to link it to the building" },
              { status: 500 }
            );
          }
        }

        await invalidateCampaignMapBundle(supabase, campaignId);

        return NextResponse.json({
          address: existingAddress,
          linked_building_id: resolvedBuilding?.publicId ?? null,
          reused_existing: true,
        });
      }
    }

    // Build address insert matching WolfGrid Web schema
    // Use raw SQL to properly insert PostGIS geometry using ST_GeomFromGeoJSON
    const geoJsonPoint = pointGeoJSON(longitude, latitude);
    
    const { data: insertedAddress, error: insertError } = await supabase.rpc(
      'insert_manual_address',
      {
        p_campaign_id: campaignId,
        p_address: formatted,
        p_formatted: formatted,
        p_house_number: String(payload.house_number ?? "").trim() || null,
        p_street_name: String(payload.street_name ?? "").trim() || null,
        p_locality: String(payload.locality ?? "").trim() || null,
        p_region: String(payload.region ?? "").trim() || null,
        p_postal_code: String(payload.postal_code ?? "").trim() || null,
        p_source: "manual",
        p_building_gers_id: resolvedBuilding?.publicId ?? null,
        p_address_provenance: addressProvenance || null,
        p_geom_json: JSON.stringify(geoJsonPoint),
        p_coordinate: { lat: latitude, lon: longitude },
        p_visited: false,
      }
    );

    // RPC returns an array, extract the first row
    const addressRow = Array.isArray(insertedAddress) ? insertedAddress[0] : insertedAddress;
    
    if (insertError || !addressRow) {
      console.error("[manual-address] insert error:", JSON.stringify(insertError));
      return NextResponse.json(
        { error: "Failed to create manual address", details: insertError?.message, code: insertError?.code, hint: insertError?.hint },
        { status: 500 }
      );
    }

    if (resolvedBuilding) {
      const { error: linkError } = await supabase
        .from("building_address_links")
        .upsert(
          {
            campaign_id: campaignId,
            building_id: resolvedBuilding.rowId,
            address_id: addressRow.id,
            match_type: "manual",
            confidence: 1,
            is_multi_unit: false,
            unit_count: 1,
          },
          { onConflict: "campaign_id,address_id" }
        );

      if (linkError) {
        console.error("[manual-address] link error:", linkError);
        return NextResponse.json(
          { error: "Address created but failed to link it to the building" },
          { status: 500 }
        );
      }
    }

    await invalidateCampaignMapBundle(supabase, campaignId);

    return NextResponse.json({
      address: addressRow,
      linked_building_id: resolvedBuilding?.publicId ?? null,
    });
  } catch (error) {
    console.error("[manual-address] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
