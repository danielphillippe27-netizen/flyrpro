import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type RouteContext = { params: Promise<{ campaignId: string }> };

function getAuthToken(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  return authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

async function ensureCampaignAccess(
  supabase: any,
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

function isValidPolygonGeometry(geometry: unknown): boolean {
  if (!geometry || typeof geometry !== "object") return false;
  const candidate = geometry as { type?: unknown; coordinates?: unknown };
  if (candidate.type !== "Polygon" && candidate.type !== "MultiPolygon") {
    return false;
  }
  return Array.isArray(candidate.coordinates);
}

function trimText(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
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

    const geometry = (body as { geometry?: unknown }).geometry;
    if (!isValidPolygonGeometry(geometry)) {
      return NextResponse.json(
        { error: "geometry must be a GeoJSON Polygon or MultiPolygon" },
        { status: 400 }
      );
    }

    const { campaignId } = await context.params;
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

    const heightMetersRaw = Number((body as { height_m?: unknown }).height_m ?? 10);
    const unitsCountRaw = Number((body as { units_count?: unknown }).units_count ?? 1);
    const levelsRaw = Number((body as { levels?: unknown }).levels ?? 1);
    const addressIds = Array.isArray((body as { address_ids?: unknown }).address_ids)
      ? ((body as { address_ids?: string[] }).address_ids ?? []).map(String)
      : [];

    const buildingInsert = {
      campaign_id: campaignId,
      source: "manual",
      geom: JSON.stringify(geometry),
      height_m: Number.isFinite(heightMetersRaw) ? heightMetersRaw : 10,
      height: Number.isFinite(heightMetersRaw) ? heightMetersRaw : 10,
      levels: Number.isFinite(levelsRaw) ? levelsRaw : 1,
      units_count: Number.isFinite(unitsCountRaw) ? Math.max(1, Math.round(unitsCountRaw)) : 1,
      latest_status: "default",
    };

    const { data: insertedBuilding, error: insertError } = await supabase
      .from("buildings")
      .insert(buildingInsert)
      .select("id, gers_id, source, height_m, units_count")
      .single();

    if (insertError || !insertedBuilding) {
      console.error("[manual-building] insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to create manual building" },
        { status: 500 }
      );
    }

    const building = insertedBuilding as {
      id: string;
      gers_id: string | null;
      source: string;
      height_m: number | null;
      units_count: number | null;
    };
    const buildingRowId = building.id;
    const publicBuildingId = building.gers_id ?? building.id;

    if (addressIds.length > 0) {
      const links = addressIds.map((addressId) => ({
        campaign_id: campaignId,
        building_id: buildingRowId,
        address_id: addressId,
        match_type: "manual",
        confidence: 1,
        is_multi_unit: addressIds.length > 1,
        unit_count: Math.max(addressIds.length, 1),
      }));

      const { error: linkError } = await supabase
        .from("building_address_links")
        .upsert(links, { onConflict: "building_id,address_id,campaign_id" });

      if (linkError) {
        console.error("[manual-building] link error:", linkError);
        return NextResponse.json(
          { error: "Building created but address linking failed" },
          { status: 500 }
        );
      }

      const { error: syncError } = await supabase
        .from("campaign_addresses")
        .update({ building_gers_id: publicBuildingId })
        .eq("campaign_id", campaignId)
        .in("id", addressIds);

      if (syncError) {
        console.warn("[manual-building] address sync warning:", syncError);
      }
    }

    return NextResponse.json({
      building: {
        id: publicBuildingId,
        row_id: building.id,
        source: building.source,
        height_m: building.height_m,
        units_count: building.units_count,
      },
      linked_address_ids: addressIds,
      label: trimText((body as { label?: unknown }).label),
    });
  } catch (error) {
    console.error("[manual-building] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
