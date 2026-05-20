import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { normalizeBuildingRouteId } from "@/app/api/campaigns/_utils/resolve-campaign-building";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type RouteContext = { params: Promise<{ campaignId: string; buildingId: string | string[] }> };

function getAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

async function ensureCampaignAccess(
  supabase: SupabaseClient,
  campaignId: string,
  userId: string
): Promise<boolean> {
  const { data: campaign, error: campError } = await supabase
    .from("campaigns")
    .select("id, owner_id, workspace_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (campError || !campaign) return false;

  const row = campaign as { owner_id: string; workspace_id: string | null };
  if (row.owner_id === userId) return true;

  if (row.workspace_id) {
    const { data: member } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", row.workspace_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (member) return true;

    const { data: workspace } = await supabase
      .from("workspaces")
      .select("owner_id")
      .eq("id", row.workspace_id)
      .maybeSingle();
    if (workspace && (workspace as { owner_id: string }).owner_id === userId) {
      return true;
    }
  }

  return false;
}

async function resolveManualBuildingRow(
  supabase: SupabaseClient,
  campaignId: string,
  buildingIdParam: string
) {
  const uuidMatch = buildingIdParam.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  const query = supabase
    .from("buildings")
    .select("id, gers_id, source")
    .eq("campaign_id", campaignId)
    .eq("source", "manual")
    .limit(1);
  const builder = uuidMatch
    ? query.or(`id.eq.${buildingIdParam},gers_id.eq.${buildingIdParam}`)
    : query.eq("gers_id", buildingIdParam);
  const { data, error } = await builder.maybeSingle();
  if (error || !data) return null;
  return data as { id: string; gers_id: string | null; source: string };
}

async function resolveAnyBuildingRow(
  supabase: SupabaseClient,
  campaignId: string,
  buildingIdParam: string
) {
  const uuidMatch = buildingIdParam.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  const query = supabase
    .from("buildings")
    .select("id, gers_id, source")
    .eq("campaign_id", campaignId)
    .limit(1);
  const builder = uuidMatch
    ? query.or(`id.eq.${buildingIdParam},gers_id.eq.${buildingIdParam}`)
    : query.eq("gers_id", buildingIdParam);
  const { data, error } = await builder.maybeSingle();
  if (error || !data) return null;
  return data as { id: string; gers_id: string | null; source: string | null };
}

async function addressContextForIdentifier(
  supabase: SupabaseClient,
  campaignId: string,
  buildingIdParam: string,
  row: { id: string; gers_id: string | null } | null
) {
  const identifiers = Array.from(
    new Set([row?.id, row?.gers_id, buildingIdParam].map((value) => String(value ?? "").trim()).filter(Boolean))
  );

  const linkedAddressIds = new Set<string>();

  if (identifiers.length > 0) {
    const { data: links, error: linksError } = await supabase
      .from("building_address_links")
      .select("address_id")
      .eq("campaign_id", campaignId)
      .in("building_id", identifiers);
    if (linksError) throw new Error(linksError.message);
    for (const link of links ?? []) {
      const id = (link as { address_id?: string | null }).address_id;
      if (id) linkedAddressIds.add(id);
    }

    const { data: directBuildingAddresses, error: directBuildingAddressesError } = await supabase
      .from("campaign_addresses")
      .select("id")
      .eq("campaign_id", campaignId)
      .in("building_id", identifiers);
    if (directBuildingAddressesError) throw new Error(directBuildingAddressesError.message);
    for (const address of directBuildingAddresses ?? []) {
      const id = (address as { id?: string | null }).id;
      if (id) linkedAddressIds.add(id);
    }
  }

  const publicBuildingId = row?.gers_id ?? row?.id ?? buildingIdParam;
  if (publicBuildingId) {
    const { data: gersAddresses, error: gersAddressesError } = await supabase
      .from("campaign_addresses")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("building_gers_id", publicBuildingId);
    if (gersAddressesError) throw new Error(gersAddressesError.message);
    for (const address of gersAddresses ?? []) {
      const id = (address as { id?: string | null }).id;
      if (id) linkedAddressIds.add(id);
    }
  }

  const { data: addressRow, error: addressError } = await supabase
    .from("campaign_addresses")
    .select("id, building_id, building_gers_id")
    .eq("campaign_id", campaignId)
    .eq("id", buildingIdParam)
    .maybeSingle();
  if (addressError) throw new Error(addressError.message);
  if (addressRow) {
    const address = addressRow as { id: string; building_id?: string | null; building_gers_id?: string | null };
    linkedAddressIds.add(address.id);
  }

  return {
    addressIds: Array.from(linkedAddressIds),
    publicBuildingId,
  };
}

function isValidPolygonGeometry(geometry: unknown): boolean {
  if (!geometry || typeof geometry !== "object") return false;
  const candidate = geometry as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== "Polygon" && candidate.type !== "MultiPolygon") {
    return false;
  }
  return Array.isArray(candidate.coordinates);
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { campaignId, buildingId: buildingIdParam } = await context.params;
    const buildingId = normalizeBuildingRouteId(buildingIdParam);
    const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

    const row = await resolveManualBuildingRow(supabase, campaignId, buildingId);
    if (!row) {
      return NextResponse.json({ error: "Manual building not found" }, { status: 404 });
    }

    const publicBuildingId = row.gers_id ?? row.id;

    const { error: unlinkError } = await supabase
      .from("building_address_links")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("building_id", row.id);

    if (unlinkError) {
      console.error("[manual-building] unlink error:", unlinkError);
      return NextResponse.json(
        { error: "Failed to remove building links" },
        { status: 500 }
      );
    }

    const { error: clearError } = await supabase
      .from("campaign_addresses")
      .update({ building_gers_id: null })
      .eq("campaign_id", campaignId)
      .eq("building_gers_id", publicBuildingId)
      .eq("source", "manual");

    if (clearError) {
      console.warn("[manual-building] address unlink warning:", clearError);
    }

    const { error: deleteError } = await supabase
      .from("buildings")
      .delete()
      .eq("campaign_id", campaignId)
      .eq("id", row.id)
      .eq("source", "manual");

    if (deleteError) {
      console.error("[manual-building] delete error:", deleteError);
      return NextResponse.json(
        { error: "Failed to delete manual building" },
        { status: 500 }
      );
    }

    return NextResponse.json({ deleted: true, building_id: publicBuildingId });
  } catch (error) {
    console.error("[manual-building] DELETE error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const geometry = (body as { geometry?: unknown }).geometry;
    if (!isValidPolygonGeometry(geometry)) {
      return NextResponse.json(
        { error: "geometry must be a GeoJSON Polygon or MultiPolygon" },
        { status: 400 }
      );
    }

    const { campaignId, buildingId: buildingIdParam } = await context.params;
    const buildingId = normalizeBuildingRouteId(buildingIdParam);
    const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

    const existingManualRow = await resolveManualBuildingRow(supabase, campaignId, buildingId);
    if (existingManualRow) {
      const { error: updateError } = await supabase
        .from("buildings")
        .update({
          geom: JSON.stringify(geometry),
          updated_at: new Date().toISOString(),
        })
        .eq("campaign_id", campaignId)
        .eq("id", existingManualRow.id)
        .eq("source", "manual");

      if (updateError) {
        console.error("[manual-building] PATCH update error:", updateError);
        return NextResponse.json({ error: "Failed to move manual building" }, { status: 500 });
      }

      return NextResponse.json({
        moved: true,
        building_id: existingManualRow.gers_id ?? existingManualRow.id,
        override_created: false,
      });
    }

    const sourceRow = await resolveAnyBuildingRow(supabase, campaignId, buildingId);
    const contextForMove = await addressContextForIdentifier(supabase, campaignId, buildingId, sourceRow);
    const sourcePublicBuildingId = contextForMove.publicBuildingId;

    if (sourcePublicBuildingId) {
      const { error: hiddenError } = await supabase
        .from("campaign_hidden_buildings")
        .upsert({
          campaign_id: campaignId,
          public_building_id: sourcePublicBuildingId,
        });
      if (hiddenError) {
        console.warn("[manual-building] hidden source upsert warning:", hiddenError);
      }
    }

    const heightMetersRaw = Number((body as { height_m?: unknown }).height_m ?? 10);
    const inserted = {
      campaign_id: campaignId,
      source: "manual",
      geom: JSON.stringify(geometry),
      height_m: Number.isFinite(heightMetersRaw) ? heightMetersRaw : 10,
      height: Number.isFinite(heightMetersRaw) ? heightMetersRaw : 10,
      levels: 1,
      units_count: Math.max(contextForMove.addressIds.length, 1),
      latest_status: "default",
    };

    const { data: insertedBuilding, error: insertError } = await supabase
      .from("buildings")
      .insert(inserted)
      .select("id, gers_id, source, height_m, units_count")
      .single();

    if (insertError || !insertedBuilding) {
      console.error("[manual-building] PATCH insert override error:", insertError);
      return NextResponse.json({ error: "Failed to create moved building override" }, { status: 500 });
    }

    const manualBuilding = insertedBuilding as {
      id: string;
      gers_id: string | null;
      source: string;
      height_m: number | null;
      units_count: number | null;
    };
    const manualPublicBuildingId = manualBuilding.gers_id ?? manualBuilding.id;

    if (contextForMove.addressIds.length > 0) {
      const links = contextForMove.addressIds.map((addressId) => ({
        campaign_id: campaignId,
        building_id: manualBuilding.id,
        address_id: addressId,
        match_type: "manual",
        confidence: 1,
        is_multi_unit: contextForMove.addressIds.length > 1,
        unit_count: Math.max(contextForMove.addressIds.length, 1),
      }));

      const { error: linkError } = await supabase
        .from("building_address_links")
        .upsert(links, { onConflict: "building_id,address_id,campaign_id" });
      if (linkError) {
        console.error("[manual-building] PATCH link override error:", linkError);
        return NextResponse.json({ error: "Moved building created but address linking failed" }, { status: 500 });
      }

      const { error: addressUpdateError } = await supabase
        .from("campaign_addresses")
        .update({ building_gers_id: manualPublicBuildingId })
        .eq("campaign_id", campaignId)
        .in("id", contextForMove.addressIds);
      if (addressUpdateError) {
        console.warn("[manual-building] PATCH address sync warning:", addressUpdateError);
      }
    }

    return NextResponse.json({
      moved: true,
      building_id: manualPublicBuildingId,
      hidden_building_id: sourcePublicBuildingId,
      linked_address_ids: contextForMove.addressIds,
      override_created: true,
    });
  } catch (error) {
    console.error("[manual-building] PATCH error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
