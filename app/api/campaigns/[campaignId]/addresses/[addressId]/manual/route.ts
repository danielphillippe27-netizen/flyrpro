import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { deleteCampaignAddressDeep } from "@/app/api/campaigns/_utils/location-delete";
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
};

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

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const token = getAuthToken(request);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json().catch(() => null)) as ManualAddressUpdateBody | null;
    const formatted = typeof body?.formatted === "string" ? body.formatted.trim() : "";
    if (!formatted) return NextResponse.json({ error: "formatted is required" }, { status: 400 });

    const { campaignId, addressId } = await context.params;
    const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: { user }, error: userError } = await supabaseAnon.auth.getUser(token);
    if (userError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createAdminClient();
    if (!(await ensureCampaignAccess(supabase, campaignId, user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: existing } = await supabase
      .from("campaign_addresses")
      .select("id, source, match_source")
      .eq("campaign_id", campaignId)
      .eq("id", addressId)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Address not found" }, { status: 404 });
    const row = existing as { source?: string | null; match_source?: string | null };
    if (row.source !== "manual" && row.match_source !== "field_manual_pin") {
      return NextResponse.json({ error: "Only manual addresses can be edited" }, { status: 409 });
    }

    const cleanOptional = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
    const { data: updated, error } = await supabase
      .from("campaign_addresses")
      .update({
        address: formatted,
        formatted,
        house_number: cleanOptional(body?.house_number),
        street_name: cleanOptional(body?.street_name),
        locality: cleanOptional(body?.locality),
        region: cleanOptional(body?.region),
        postal_code: cleanOptional(body?.postal_code),
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
    const supabaseAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const {
      data: { user },
      error: userError,
    } = await supabaseAnon.auth.getUser(token);
    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminClient();
    const canAccess = await ensureCampaignAccess(supabase, campaignId, user.id);
    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: row, error: lookupError } = await supabase
      .from("campaign_addresses")
      .select("id, source")
      .eq("campaign_id", campaignId)
      .eq("id", addressId)
      .maybeSingle();

    if (lookupError || !row) {
      return NextResponse.json({ error: "Address not found" }, { status: 404 });
    }
    if ((row as { source: string | null }).source !== "manual") {
      return NextResponse.json(
        { error: "Only manual addresses can be deleted from tools" },
        { status: 409 }
      );
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
