import { buildKimiCocoPayload } from "./kimicoco-payload";
import { createAdminClient } from "@/lib/supabase/server";
import {
  encryptZapierWebhookUrl,
  decryptZapierWebhookUrl,
} from "@/app/api/integrations/zapier/_lib/auth";
export const encryptKimiCocoKey = encryptZapierWebhookUrl;
export const decryptKimiCocoKey = decryptZapierWebhookUrl;
// Fixed server destination prevents credentials being sent to a user-supplied URL.
export function kimiCocoBaseUrl() {
  const raw = process.env.KIMICOCO_API_URL || "https://kimicoco.vercel.app";
  const url = new URL(raw);
  if (
    url.protocol !== "https:" &&
    !(
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error("KimiCoco requires HTTPS");
  return url.origin;
}
export class KimiCocoError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function kimiCocoRequest(
  path: string,
  key: string,
  body: unknown,
) {
  const response = await fetch(
    `${kimiCocoBaseUrl()}/api/integrations/wolfgrid/${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
      redirect: "error",
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new KimiCocoError(
      typeof result.error === "string"
        ? result.error
        : "KimiCoco could not receive this request",
      response.status,
    );
  return result;
}

type Job = {
  id: string;
  workspace_id: string;
  contact_id: string;
  payload: Record<string, unknown>;
  version: number;
  lease_id: string;
  attempts: number;
};
export async function dispatchKimiCoco(workspaceId?: string) {
  const admin = createAdminClient();
  const { data: jobs, error } = await admin.rpc("claim_kimicoco_jobs", {
    p_workspace: workspaceId ?? null,
  });
  if (error)
    throw new Error("KimiCoco queue is unavailable. Apply its migration.");
  let synced = 0,
    failed = 0;
  async function deliver(job: Job) {
    const { data: connection } = await admin
      .from("kimicoco_connections")
      .select("encrypted_key,generation,user_id")
      .eq("workspace_id", job.workspace_id)
      .maybeSingle();
    if (!connection) return;
    const { data: member } = await admin
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", job.workspace_id)
      .eq("user_id", connection.user_id)
      .maybeSingle();
    if (!member || !["owner", "admin"].includes(member.role)) {
      await admin
        .from("kimicoco_sync_jobs")
        .update({
          status: "needs_attention",
          last_error:
            "Connection owner no longer has workspace access. Reconnect as an owner or admin.",
          lease_id: null,
          lease_until: null,
        })
        .eq("id", job.id)
        .eq("version", job.version)
        .eq("lease_id", job.lease_id);
      return;
    }
    try {
      const result = await kimiCocoRequest(
        "contacts",
        decryptKimiCocoKey(connection.encrypted_key),
        buildKimiCocoPayload(job.payload, job.workspace_id, job.version),
      );
      if (typeof result.clientId !== "string")
        throw new Error("KimiCoco returned an invalid contact receipt");
      const { error: saveError } = await admin
        .from("kimicoco_sync_jobs")
        .update({
          status: "synced",
          remote_client_id: result.clientId,
          last_error: null,
          lease_until: null,
          lease_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("version", job.version)
        .eq("lease_id", job.lease_id);
      if (saveError) throw saveError;
      await admin
        .from("kimicoco_connections")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("workspace_id", job.workspace_id)
        .eq("generation", connection.generation);
      synced++;
    } catch (error) {
      const terminal =
        error instanceof KimiCocoError &&
        [400, 401, 403, 409, 413].includes(error.status);
      const message =
        error instanceof KimiCocoError
          ? error.message
          : "Transfer interrupted; it will retry automatically.";
      await admin
        .from("kimicoco_sync_jobs")
        .update({
          status:
            terminal || job.attempts >= 10 ? "needs_attention" : "pending",
          last_error: message,
          lease_id: null,
          lease_until: null,
          next_attempt_at: new Date(
            Date.now() +
              Math.min(3600000, 30000 * 2 ** Math.min(job.attempts, 7)),
          ).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("version", job.version)
        .eq("lease_id", job.lease_id);
      failed++;
    } finally {
      // A newer snapshot may have arrived while this lease was running.
      await admin
        .from("kimicoco_sync_jobs")
        .update({ lease_id: null, lease_until: null })
        .eq("id", job.id)
        .eq("lease_id", job.lease_id);
    }
  }
  const list = (jobs ?? []) as Job[];
  for (let offset = 0; offset < list.length; offset += 4)
    await Promise.all(list.slice(offset, offset + 4).map(deliver));
  return { synced, failed, processed: list.length };
}
