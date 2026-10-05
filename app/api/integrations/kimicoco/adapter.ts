import { NextRequest, NextResponse } from "next/server";
import { resolveUserFromRequest } from "@/app/api/_utils/request-user";
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from "@/app/api/_utils/workspace";
import { createAdminClient } from "@/lib/supabase/server";
import { GET, POST, DELETE } from "./route";
export async function adaptKimiCoco(
  request: NextRequest,
  action: "connect" | "disconnect" | "status" | "test",
) {
  const user = await resolveUserFromRequest(request);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body =
    request.method === "GET" ? {} : await request.json().catch(() => ({}));
  const workspace = await resolveWorkspaceIdForUser(
    createAdminClient() as unknown as MinimalSupabaseClient,
    user.id,
    body.workspaceId ?? request.nextUrl.searchParams.get("workspaceId"),
  );
  if (!workspace.workspaceId)
    return NextResponse.json(
      { error: workspace.error },
      { status: workspace.status ?? 403 },
    );
  const method =
    action === "status" || action === "test"
      ? "GET"
      : action === "disconnect"
        ? "DELETE"
        : "POST";
  const url = new URL(request.url);
  url.searchParams.set("workspaceId", workspace.workspaceId);
  const forwarded = new NextRequest(url, {
    method,
    headers: request.headers,
    ...(method !== "GET"
      ? {
          body: JSON.stringify({
            workspaceId: workspace.workspaceId,
            action,
            key: body.apiKey ?? body.key,
          }),
        }
      : {}),
  });
  const response = await (
    method === "GET" ? GET : method === "DELETE" ? DELETE : POST
  )(forwarded);
  if (action === "test" && response.ok) {
    const status = await response.json();
    if (!status.connected)
      return NextResponse.json(
        {
          error: "KimiCoco is not connected",
          connected: false,
          success: false,
        },
        { status: 404 },
      );
    const { data: conn } = await createAdminClient()
      .from("kimicoco_connections")
      .select("encrypted_key")
      .eq("workspace_id", workspace.workspaceId)
      .single();
    if (!conn)
      return NextResponse.json(
        { success: false, error: "KimiCoco is not connected" },
        { status: 404 },
      );
    const { decryptKimiCocoKey, kimiCocoRequest } =
      await import("@/lib/integrations/kimicoco");
    try {
      await kimiCocoRequest("verify", decryptKimiCocoKey(conn.encrypted_key), {
        sourceWorkspaceId: workspace.workspaceId,
      });
      return NextResponse.json({
        success: true,
        connected: true,
        message: "KimiCoco connection verified",
      });
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Reconnect KimiCoco to restore the connection",
        },
        { status: 502 },
      );
    }
  }
  return response;
}
