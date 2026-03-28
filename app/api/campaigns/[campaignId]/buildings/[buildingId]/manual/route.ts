import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type RouteContext = { params: Promise<{ campaignId: string; buildingId: string }> };

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

async function resolveManualBuildingRow(
  supabase: any,
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

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { campaignId, buildingId } = await context.params;
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
