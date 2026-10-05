import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveUserFromRequest } from "@/app/api/_utils/request-user";
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from "@/app/api/_utils/workspace";
import { POST as pushLead } from "../push-lead/route";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const admin = createAdminClient();
  const workspace = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    user.id,
    body.workspaceId ?? null,
  );
  if (!workspace.workspaceId)
    return NextResponse.json(
      { error: workspace.error },
      { status: workspace.status ?? 403 },
    );
  const { data: connection } = await admin
    .from("kimicoco_connections")
    .select("workspace_id")
    .eq("workspace_id", workspace.workspaceId)
    .maybeSingle();
  if (!connection)
    return NextResponse.json(
      { error: "Connect KimiCoco first" },
      { status: 400 },
    );
  const id = randomUUID();
  const { error } = await admin
    .from("contacts")
    .insert({
      id,
      workspace_id: workspace.workspaceId,
      user_id: user.id,
      first_name: "WolfGrid",
      last_name: "KimiCoco Test",
      full_name: "WolfGrid KimiCoco Test",
      email: `wolfgrid-test-${id}@example.test`,
      phone: null,
      address: "123 Test Street",
      notes: "Test contact sent from WolfGrid to verify KimiCoco.",
      source: "KimiCoco integration test",
      appointment_at: new Date(Date.now() + 86400000).toISOString(),
      appointment_title: "Test appointment",
      follow_up_at: new Date(Date.now() + 172800000).toISOString(),
      follow_up_title: "Test follow-up",
    });
  if (error)
    return NextResponse.json(
      { error: "Could not save the test contact" },
      { status: 503 },
    );
  return pushLead(
    new NextRequest(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ id, workspaceId: workspace.workspaceId }),
    }),
  );
}
