import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import {
  crmRequest,
  requireCrmWorkspace,
  readCrmBody,
  privateJson,
  errorResponse,
  CrmRequestError,
} from "@/lib/mac-companion/server";
const bucket = "crm-private-message-attachments";
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("preference"),
      workspaceId: z.string().uuid(),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.enum(["prepare", "complete"]),
      workspaceId: z.string().uuid(),
      contactId: z.string().uuid(),
      messageGuid: z.string().min(1).max(256),
      guid: z.string().min(1).max(256),
      participant: z.string().max(256),
      fileName: z.string().min(1).max(512),
      mimeType: z.string().max(150).nullable(),
      byteCount: z
        .number()
        .int()
        .min(0)
        .max(50 * 1024 * 1024),
    })
    .strict(),
]);
export async function GET(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, "mac");
    const ws = z
        .string()
        .uuid()
        .parse(request.nextUrl.searchParams.get("workspaceId")),
      messageId = z
        .string()
        .uuid()
        .parse(request.nextUrl.searchParams.get("messageId")),
      guid = z
        .string()
        .max(256)
        .parse(request.nextUrl.searchParams.get("guid"));
    await requireCrmWorkspace(api, ws);
    const message = await api
      .from("mac_contact_messages")
      .select("contact_id,external_id")
      .eq("id", messageId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!message.data)
      throw new CrmRequestError("Attachment unavailable.", 404);
    const file = await api
      .from("crm_message_attachments")
      .select("object_key,status")
      .eq("user_id", user.id)
      .eq("workspace_id", ws)
      .eq("contact_id", message.data.contact_id)
      .eq("message_guid", message.data.external_id)
      .eq("guid", guid)
      .maybeSingle();
    if (file.data?.status !== "uploaded")
      throw new CrmRequestError("Attachment is not imported.", 404);
    const signed = await createAdminClient()
      .storage.from(bucket)
      .createSignedUrl(file.data.object_key, 60, { download: true });
    if (signed.error) throw new CrmRequestError("Attachment unavailable.", 503);
    return privateJson({ url: signed.data.signedUrl });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, "mac", true);
    const body = input.parse(await readCrmBody(request, 4000));
    await requireCrmWorkspace(api, body.workspaceId);
    if (body.action === "preference") {
      const r = await api.rpc("coco_attachment_preference", {
        ws: body.workspaceId,
        enabled: body.enabled,
      });
      if (r.error)
        throw new CrmRequestError(
          "Enable contact sync before changing attachment settings.",
        );
      return privateJson(r.data);
    }
    const prefs = await api
      .from("mac_crm_preferences")
      .select("sync_enabled,attachment_sync_enabled")
      .eq("user_id", user.id)
      .eq("workspace_id", body.workspaceId)
      .maybeSingle();
    if (!prefs.data?.sync_enabled || !prefs.data.attachment_sync_enabled)
      throw new CrmRequestError("Attachment sync is paused.", 403);
    const manifest = await api.rpc("mac_owned_identifiers", {
      ws: body.workspaceId,
    });
    if (manifest.error)
      throw new CrmRequestError("Contact matching unavailable.", 503);
    const matches = (
      manifest.data as { contact_id: string; identifier: string }[]
    ).filter((i) => i.identifier === body.participant);
    if (
      new Set(matches.map((i) => i.contact_id)).size !== 1 ||
      matches[0]?.contact_id !== body.contactId
    )
      throw new CrmRequestError(
        "The participant no longer uniquely matches this contact.",
        403,
      );
    const admin = createAdminClient(),
      hash = createHash("sha256")
        .update(
          JSON.stringify([
            body.workspaceId,
            body.contactId,
            body.messageGuid,
            body.guid,
          ]),
        )
        .digest("hex"),
      objectKey = `${user.id}/${body.workspaceId}/${hash}`;
    const identity = {
      user_id: user.id,
      workspace_id: body.workspaceId,
      contact_id: body.contactId,
      message_guid: body.messageGuid,
      guid: body.guid,
    };
    if (body.action === "prepare") {
      const existing = await admin
        .from("crm_message_attachments")
        .select("status")
        .match(identity)
        .maybeSingle();
      if (existing.error)
        throw new CrmRequestError("Attachment storage unavailable.", 503);
      if (existing.data?.status === "uploaded")
        return privateJson({ uploaded: true });
      const saved = await admin
        .from("crm_message_attachments")
        .upsert(
          {
            ...identity,
            file_name: body.fileName,
            mime_type: body.mimeType,
            byte_count: body.byteCount,
            object_key: objectKey,
          },
          {
            onConflict: "user_id,workspace_id,contact_id,message_guid,guid",
            ignoreDuplicates: true,
          },
        );
      if (saved.error)
        throw new CrmRequestError("Could not prepare attachment.", 503);
      const upload = await admin.storage
        .from(bucket)
        .createSignedUploadUrl(objectKey);
      if (upload.error)
        throw new CrmRequestError("Could not prepare private upload.", 503);
      return privateJson({ url: upload.data.signedUrl, uploaded: false });
    }
    const objects = await admin.storage
      .from(bucket)
      .list(`${user.id}/${body.workspaceId}`, { search: hash, limit: 2 });
    const object = objects.data?.find((o) => o.name === hash);
    if (
      objects.error ||
      !object ||
      Number(object.metadata?.size) !== body.byteCount
    )
      throw new CrmRequestError(
        "Attachment upload was not confirmed. Recheck history to retry.",
        409,
      );
    const saved = await admin
      .from("crm_message_attachments")
      .update({ status: "uploaded" })
      .match(identity);
    if (saved.error)
      throw new CrmRequestError("Could not acknowledge attachment.", 503);
    return privateJson({ uploaded: true });
  } catch (e) {
    return errorResponse(
      e instanceof z.ZodError
        ? new CrmRequestError("Invalid attachment request.")
        : e,
    );
  }
}
