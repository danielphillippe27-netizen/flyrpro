import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
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

type ResolvedBuilding = {
  rowId: string;
  publicId: string;
};

async function resolveBuilding(
  supabase: any,
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

    const { campaignId } = await context.params;
    const longitude = (body as { longitude?: unknown }).longitude;
    const latitude = (body as { latitude?: unknown }).latitude;
    const formatted = String((body as { formatted?: unknown }).formatted ?? "").trim();

    if (!isFiniteNumber(longitude) || !isFiniteNumber(latitude)) {
      return NextResponse.json(
        { error: "longitude and latitude are required numbers" },
        { status: 400 }
      );
    }
    if (!formatted) {
      return NextResponse.json({ error: "formatted is required" }, { status: 400 });
    }

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

    const requestedBuildingId = String(
      (body as { building_id?: unknown }).building_id ?? ""
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

    // Build address insert matching FLYR-PRO schema
    // Use raw SQL to properly insert PostGIS geometry using ST_GeomFromGeoJSON
    const geoJsonPoint = pointGeoJSON(longitude, latitude);
    
    const { data: insertedAddress, error: insertError } = await supabase.rpc(
      'insert_manual_address',
      {
        p_campaign_id: campaignId,
        p_address: formatted,
        p_formatted: formatted,
        p_house_number: String((body as { house_number?: unknown }).house_number ?? "").trim() || null,
        p_street_name: String((body as { street_name?: unknown }).street_name ?? "").trim() || null,
        p_locality: String((body as { locality?: unknown }).locality ?? "").trim() || null,
        p_region: String((body as { region?: unknown }).region ?? "").trim() || null,
        p_postal_code: String((body as { postal_code?: unknown }).postal_code ?? "").trim() || null,
        p_source: "manual",
        p_building_gers_id: resolvedBuilding?.publicId ?? null,
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
          { onConflict: "building_id,address_id,campaign_id" }
        );

      if (linkError) {
        console.error("[manual-address] link error:", linkError);
        return NextResponse.json(
          { error: "Address created but failed to link it to the building" },
          { status: 500 }
        );
      }
    }

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
