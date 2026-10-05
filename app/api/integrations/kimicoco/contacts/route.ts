import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveUserFromRequest } from "@/app/api/_utils/request-user";
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from "@/app/api/_utils/workspace";
export async function GET(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const id = request.nextUrl.searchParams.get("workspaceId");
  if (!id)
    return NextResponse.json({ error: "Select a workspace" }, { status: 400 });
  const workspace = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    user.id,
    id,
  );
  if (!workspace.workspaceId)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const offset = Math.max(
    0,
    Number(request.nextUrl.searchParams.get("offset")) || 0,
  );
  const { data, error } = await admin
    .from("contacts")
    .select("id,full_name,email,phone")
    .eq("workspace_id", workspace.workspaceId)
    .order("id")
    .range(offset, offset + 99);
  return error
    ? NextResponse.json({ error: "Could not load contacts" }, { status: 503 })
    : NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
