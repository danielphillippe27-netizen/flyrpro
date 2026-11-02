import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { validateMapEditChanges } from "@/lib/services/CampaignMapEdits";

type Context = { params: Promise<{ campaignId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function authorize(request: Request, campaignId: string) {
  if (!uuid.test(campaignId)) return { response: NextResponse.json({ error: "Invalid campaign" }, { status: 400 }) };
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = createClient(url, process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data: { user }, error } = await anon.auth.getUser(token);
  if (error || !user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: campaign, error: campaignError } = await db.from("campaigns").select("owner_id,workspace_id").eq("id", campaignId).maybeSingle();
  if (campaignError || !campaign) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  let allowed = campaign.owner_id === user.id;
  if (!allowed && campaign.workspace_id) {
    const [membership, workspace] = await Promise.all([
      db.from("workspace_members").select("user_id").eq("workspace_id", campaign.workspace_id).eq("user_id", user.id).maybeSingle(),
      db.from("workspaces").select("owner_id").eq("id", campaign.workspace_id).maybeSingle(),
    ]);
    allowed = Boolean(!membership.error && membership.data) || (!workspace.error && workspace.data?.owner_id === user.id);
  }
  return allowed ? { db, user } : { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
}

export async function GET(request: Request, context: Context) {
  try {
    const { campaignId } = await context.params;
    const auth = await authorize(request, campaignId);
    if (auth.response) return auth.response;
    const { data, error } = await auth.db!.from("campaign_map_edit_states").select("revision,features").eq("campaign_id", campaignId).maybeSingle();
    if (error) throw error;
    return NextResponse.json(data ?? { revision: 0, features: {} }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[map-edits] read failed", error);
    return NextResponse.json({ error: "Map edits could not be loaded." }, { status: 503 });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { campaignId } = await context.params;
    const auth = await authorize(request, campaignId);
    if (auth.response) return auth.response;
    const text = await request.text();
    if (text.length > 4_000_000) return NextResponse.json({ error: "Edit too large." }, { status: 413 });
    let body: any; let changes;
    try {
      body = JSON.parse(text);
      if (!uuid.test(body.clientMutationId) || !Number.isSafeInteger(body.baseRevision) || body.baseRevision < 0) throw new Error("Invalid edit revision.");
      changes = validateMapEditChanges(body.changes);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid edit." }, { status: 400 });
    }
    const { data, error } = await auth.db!.rpc("apply_campaign_map_edits", {
      p_campaign_id: campaignId, p_actor_id: auth.user!.id, p_mutation_id: body.clientMutationId,
      p_base_revision: body.baseRevision, p_changes: changes,
    });
    if (error) throw error;
    return NextResponse.json(data, { status: data.conflict ? 409 : 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[map-edits] write failed", error);
    return NextResponse.json({ error: "Map edits could not be saved. Your device will keep them for retry." }, { status: 503 });
  }
}
