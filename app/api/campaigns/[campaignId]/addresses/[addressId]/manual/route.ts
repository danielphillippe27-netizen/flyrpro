import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { deleteCampaignAddressDeep } from "@/app/api/campaigns/_utils/location-delete";
import { ensureCampaignAddressMutationAccess } from "@/app/api/campaigns/_utils/access";
import { createAdminClient } from "@/lib/supabase/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type RouteContext = { params: Promise<{ campaignId: string; addressId: string }> };

type ManualAddressUpdateBody = {
  formatted?: unknown;
  house_number?: unknown;
  street_name?: unknown;
  locality?: unknown;
  region?: unknown;
  postal_code?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  base_revision?: unknown;
  client_mutation_id?: unknown;
  occurred_at?: unknown;
  origin_platform?: unknown;
  client_version?: unknown;
  client_build?: unknown;
};

function getAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
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
    : code === "CAMPAIGN_ADDRESS_ACCESS_DENIED"
      ? 403
      : code === "REVISION_CONFLICT" || code === "IDEMPOTENCY_KEY_REUSED"
        ? 409
        : 400;
  return NextResponse.json({ error: code, ...result }, { status });
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function legacyMutationId(operation: string, parts: unknown[]): string {
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `legacy-pin-${operation}:${hash}`;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => null)) as ManualAddressUpdateBody | null;
    const requestedFormatted = typeof body?.formatted === "string" ? body.formatted.trim() : "";

    const { campaignId, addressId } = await context.params;
    const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser(token);
    if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createAdminClient();
    if (!(await ensureCampaignAddressMutationAccess(supabase, campaignId, addressId, user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: existing } = await supabase
      .from("campaign_addresses")
      .select("id, source, match_source, revision, updated_at, formatted, address, house_number, street_name, locality, region, postal_code")
      .eq("campaign_id", campaignId)
      .eq("id", addressId)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Address not found" }, { status: 404 });
    const row = existing as {
      source?: string | null;
      match_source?: string | null;
      revision?: number | null;
      updated_at?: string | null;
      formatted?: string | null;
      address?: string | null;
      house_number?: string | null;
      street_name?: string | null;
      locality?: string | null;
      region?: string | null;
      postal_code?: string | null;
    };
    if (row.source !== "manual" && row.match_source !== "field_manual_pin") {
      return NextResponse.json({ error: "Only manual addresses can be edited" }, { status: 409 });
    }
    const formatted = requestedFormatted || row.formatted?.trim() || row.address?.trim() || "";
    if (!formatted) return NextResponse.json({ error: "formatted is required" }, { status: 400 });

    const cleanOptional = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
    const preservedText = (
      key: "house_number" | "street_name" | "locality" | "region" | "postal_code"
    ) => body && Object.prototype.hasOwnProperty.call(body, key)
      ? cleanOptional(body[key])
      : row[key] ?? null;
    const houseNumber = preservedText("house_number");
    const streetName = preservedText("street_name");
    const locality = preservedText("locality");
    const region = preservedText("region");
    const postalCode = preservedText("postal_code");
    if (row.match_source === "field_manual_pin") {
      const latitude = optionalNumber(body?.latitude);
      const longitude = optionalNumber(body?.longitude);
      if ((latitude === null) !== (longitude === null)) {
        return NextResponse.json(
          { error: "latitude and longitude must be supplied together" },
          { status: 400 }
        );
      }

      const suppliedBaseRevision = optionalNumber(body?.base_revision);
      const legacyBridge = suppliedBaseRevision === null;
      const occurredAt = typeof body?.occurred_at === "string" && body.occurred_at
        ? body.occurred_at
        : request.headers.get("x-occurred-at") ?? new Date().toISOString();
      const mutationId = String(
        body?.client_mutation_id ??
          request.headers.get("x-client-mutation-id") ??
          legacyMutationId("update", [
            user.id, campaignId, addressId, formatted,
            houseNumber, streetName, locality, region, postalCode, latitude, longitude,
          ])
      ).trim();
      const explicitPlatform = String(
        body?.origin_platform ?? request.headers.get("x-client-platform") ?? ""
      ).trim().toLowerCase();
      const clientBuild = optionalNumber(
        body?.client_build ?? request.headers.get("x-client-build")
      );

      const { data: mutationData, error: mutationError } = await supabaseAnon.rpc(
        "v2_update_campaign_manual_pin",
        {
          p_campaign_id: campaignId,
          p_campaign_address_id: addressId,
          p_base_revision: suppliedBaseRevision ?? row.revision ?? 0,
          p_formatted: formatted,
          p_lat: latitude,
          p_lon: longitude,
          p_house_number: houseNumber,
          p_street_name: streetName,
          p_locality: locality,
          p_region: region,
          p_postal_code: postalCode,
          p_client_mutation_id: mutationId,
          p_origin_platform: explicitPlatform || "legacy",
          p_client_version: String(
            body?.client_version ?? request.headers.get("x-client-version") ?? ""
          ).trim() || null,
          p_client_build: clientBuild === null ? null : Math.trunc(clientBuild),
          p_legacy_bridge: legacyBridge,
          p_occurred_at: occurredAt,
        }
      );

      if (mutationError) {
        return NextResponse.json(
          { error: "Failed to update manual pin", details: mutationError.message },
          { status: 500 }
        );
      }
      const mutation = (mutationData ?? {}) as CampaignMutationResult;
      const failure = mutationFailure(mutation);
      if (failure) return failure;

      await invalidateCampaignMapBundle(supabase, campaignId);
      return NextResponse.json({
        address: mutation.canonical_state,
        replayed: mutation.replayed === true,
        revision: mutation.revision,
        event_id: mutation.event_id,
      });
    }

    const { data: updated, error } = await supabase
      .from("campaign_addresses")
      .update({
        address: formatted,
        formatted,
        house_number: houseNumber,
        street_name: streetName,
        locality,
        region,
        postal_code: postalCode,
        updated_at: new Date().toISOString(),
      })
      .eq("campaign_id", campaignId)
      .eq("id", addressId)
      .select("id, address, formatted, house_number, street_name, locality, region, postal_code, match_source")
      .single();
    if (error) return NextResponse.json({ error: "Failed to update manual address", details: error.message }, { status: 500 });

    await invalidateCampaignMapBundle(supabase, campaignId);
    return NextResponse.json({ address: updated });
  } catch (error) {
    console.error("[manual-address] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { campaignId, addressId } = await context.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const url = new URL(request.url);
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

    const supabase = createAdminClient();
    const canAccess = await ensureCampaignAddressMutationAccess(
      supabase,
      campaignId,
      addressId,
      user.id
    );
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: row, error: lookupError } = await supabase
      .from("campaign_addresses")
      .select("id, source, match_source, revision, updated_at")
      .eq("campaign_id", campaignId)
      .eq("id", addressId)
      .maybeSingle();

    if (lookupError || !row) {
      return NextResponse.json({ error: "Address not found" }, { status: 404 });
    }
    const address = row as {
      source: string | null;
      match_source: string | null;
      revision: number | null;
      updated_at: string | null;
    };
    if (address.source !== "manual" && address.match_source !== "field_manual_pin") {
      return NextResponse.json(
        { error: "Only manual addresses can be deleted from tools" },
        { status: 409 }
      );
    }

    if (address.match_source === "field_manual_pin") {
      const suppliedBaseRevision = optionalNumber(
        body?.base_revision ?? url.searchParams.get("base_revision") ?? request.headers.get("x-base-revision")
      );
      const legacyBridge = suppliedBaseRevision === null;
      const occurredAt = String(
        body?.occurred_at ??
          url.searchParams.get("occurred_at") ??
          request.headers.get("x-occurred-at") ??
          new Date().toISOString()
      );
      const mutationId = String(
        body?.client_mutation_id ??
          url.searchParams.get("client_mutation_id") ??
          request.headers.get("x-client-mutation-id") ??
          legacyMutationId("delete", [user.id, campaignId, addressId])
      ).trim();
      const explicitPlatform = String(
        body?.origin_platform ??
          url.searchParams.get("origin_platform") ??
          request.headers.get("x-client-platform") ??
          ""
      ).trim().toLowerCase();
      const clientBuild = optionalNumber(
        body?.client_build ??
          url.searchParams.get("client_build") ??
          request.headers.get("x-client-build")
      );

      const { data: mutationData, error: mutationError } = await supabaseAnon.rpc(
        "v2_delete_campaign_manual_pin",
        {
          p_campaign_id: campaignId,
          p_campaign_address_id: addressId,
          p_base_revision: suppliedBaseRevision ?? address.revision ?? 0,
          p_client_mutation_id: mutationId,
          p_origin_platform: explicitPlatform || "legacy",
          p_client_version: String(
            body?.client_version ??
              url.searchParams.get("client_version") ??
              request.headers.get("x-client-version") ??
              ""
          ).trim() || null,
          p_client_build: clientBuild === null ? null : Math.trunc(clientBuild),
          p_legacy_bridge: legacyBridge,
          p_occurred_at: occurredAt,
        }
      );

      if (mutationError) {
        return NextResponse.json(
          { error: "Failed to delete manual pin", details: mutationError.message },
          { status: 500 }
        );
      }
      const mutation = (mutationData ?? {}) as CampaignMutationResult;
      const failure = mutationFailure(mutation);
      if (failure) return failure;

      await invalidateCampaignMapBundle(supabase, campaignId);
      return NextResponse.json({
        deleted: true,
        address_id: addressId,
        address: mutation.canonical_state,
        replayed: mutation.replayed === true,
        revision: mutation.revision,
        event_id: mutation.event_id,
      });
    }

    const result = await deleteCampaignAddressDeep(supabase, campaignId, addressId, {
      requireManualSource: true,
    });
    if (!result.found) {
      return NextResponse.json({ error: "Address not found" }, { status: 404 });
    }
    if (result.rejectedReason === "not_manual") {
      return NextResponse.json(
        { error: "Only manual addresses can be deleted from tools" },
        { status: 409 }
      );
    }

    await invalidateCampaignMapBundle(supabase, campaignId);

    return NextResponse.json({ deleted: true, address_id: addressId });
  } catch (error) {
    console.error("[manual-address] DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
