import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveUserFromRequest } from "@/app/api/_utils/request-user";
import {
  resolveWorkspaceMembershipForUser,
  type MinimalSupabaseClient,
} from "@/app/api/_utils/workspace";
import {
  dispatchKimiCoco,
  encryptKimiCocoKey,
  kimiCocoBaseUrl,
  kimiCocoRequest,
  KimiCocoError,
} from "@/lib/integrations/kimicoco";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function handle(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return json({ error: "Unauthorized" }, 401);
    const body =
      request.method === "GET"
        ? { workspaceId: request.nextUrl.searchParams.get("workspaceId") }
        : await request.json().catch(() => null);
    if (
      !body ||
      typeof body.workspaceId !== "string" ||
      !uuid.test(body.workspaceId)
    )
      return json({ error: "Select a workspace" }, 400);
    const admin = createAdminClient();
    const workspace = await resolveWorkspaceMembershipForUser(
      admin as unknown as MinimalSupabaseClient,
      user.id,
      body.workspaceId,
    );
    if (!workspace.workspaceId)
      return json(
        { error: workspace.error ?? "Forbidden" },
        workspace.status ?? 403,
      );
    const id = workspace.workspaceId;
    const canManage = ["owner", "admin"].includes(workspace.role ?? "");
    if (request.method === "GET") {
      const { data: connection, error } = await admin
        .from("kimicoco_connections")
        .select(
          "destination_workspace_id,destination_workspace_name,auto_sync,last_sync_at",
        )
        .eq("workspace_id", id)
        .maybeSingle();
      if (error)
        return json(
          {
            error: "Apply the KimiCoco integration migration before connecting",
          },
          503,
        );
      const { data: jobs, error: jobsError } = await admin
        .from("kimicoco_sync_jobs")
        .select(
          "contact_id,status,last_error,remote_client_id,updated_at,payload",
        )
        .eq("workspace_id", id)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (jobsError) throw jobsError;
      return json({
        connected: Boolean(connection),
        connection,
        jobs: jobs?.map((job) => ({
          contact_id: job.contact_id,
          status: job.status,
          last_error: job.last_error,
          name: job.payload.full_name || job.payload.name,
          clientUrl: job.remote_client_id
            ? `${kimiCocoBaseUrl()}/?client=${job.remote_client_id}&workspace=${connection?.destination_workspace_id ?? ""}`
            : null,
        })),
        canManage,
      });
    }
    if (request.method === "DELETE") {
      if (!canManage)
        return json(
          { error: "A workspace owner or admin must disconnect" },
          403,
        );
      const { error } = await admin
        .from("kimicoco_connections")
        .delete()
        .eq("workspace_id", id);
      if (error) throw error;
      return json({ connected: false });
    }
    if (body.action === "connect") {
      if (!canManage)
        return json({ error: "A workspace owner or admin must connect" }, 403);
      if (
        typeof body.key !== "string" ||
        !/^kc_wg_[a-f0-9]{64}$/.test(body.key)
      )
        return json({ error: "Paste a KimiCoco WolfGrid connection key" }, 400);
      const encryptedKey = encryptKimiCocoKey(body.key);
      const verified = await kimiCocoRequest("verify", body.key, {
        sourceWorkspaceId: id,
      });
      if (
        typeof verified.workspaceId !== "string" ||
        !uuid.test(verified.workspaceId)
      )
        throw new Error("Invalid destination workspace");
      const { error } = await admin
        .from("kimicoco_connections")
        .upsert(
          {
            workspace_id: id,
            user_id: user.id,
            encrypted_key: encryptedKey,
            destination_workspace_id: verified.workspaceId,
            destination_workspace_name: verified.workspaceName || "KimiCoco",
            auto_sync: body.autoSync !== false,
            generation: randomUUID(),
          },
          { onConflict: "workspace_id" },
        );
      if (error) throw error;
      // Invalidate receipts from any worker still using the previous connection.
      const { error: resetError } = await admin.rpc("reset_kimicoco_jobs", {
        p_workspace: id,
      });
      if (resetError) throw resetError;
      return json({ connected: true });
    }
    const { data: connection, error: connectionError } = await admin
      .from("kimicoco_connections")
      .select("workspace_id")
      .eq("workspace_id", id)
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) return json({ error: "Connect KimiCoco first" }, 400);
    if (body.action === "settings") {
      if (!canManage || typeof body.autoSync !== "boolean")
        return json(
          { error: "Only an owner or admin can change automatic sync" },
          403,
        );
      const { error } = await admin
        .from("kimicoco_connections")
        .update({ auto_sync: body.autoSync })
        .eq("workspace_id", id);
      if (error) throw error;
      return json({ success: true });
    }
    if (body.action === "retry") {
      // Requeue current contact snapshots, including corrected duplicate matches.
      const { data: jobs, error } = await admin
        .from("kimicoco_sync_jobs")
        .select("contact_id")
        .eq("workspace_id", id)
        .eq("status", "needs_attention")
        .limit(100);
      if (error) throw error;
      for (const job of jobs ?? []) {
        const { error: queueError } = await admin.rpc(
          "enqueue_kimicoco_contact",
          { p_workspace: id, p_contact: job.contact_id },
        );
        if (queueError) throw queueError;
      }
      return json(await dispatchKimiCoco(id));
    }
    if (body.action === "sync") {
      if (
        !Array.isArray(body.contactIds) ||
        body.contactIds.length < 1 ||
        body.contactIds.length > 100 ||
        !body.contactIds.every(
          (v: unknown) => typeof v === "string" && uuid.test(v),
        )
      )
        return json({ error: "Select between 1 and 100 contacts" }, 400);
      const { data: contacts, error } = await admin
        .from("contacts")
        .select("id")
        .eq("workspace_id", id)
        .in("id", body.contactIds);
      if (error) throw error;
      if (contacts?.length !== new Set(body.contactIds).size)
        return json({ error: "Some contacts are outside this workspace" }, 403);
      for (const contact of contacts) {
        const { error: queueError } = await admin.rpc(
          "enqueue_kimicoco_contact",
          { p_workspace: id, p_contact: contact.id },
        );
        if (queueError) throw queueError;
      }
      const result = await dispatchKimiCoco(id);
      return json({ ...result, queued: contacts.length });
    }
    if (body.action === "process") return json(await dispatchKimiCoco(id));
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    if (error instanceof KimiCocoError)
      return json({ error: error.message }, error.status >= 500 ? 502 : 400);
    return json(
      {
        error:
          "KimiCoco integration is unavailable. Check migrations and server configuration.",
      },
      503,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
