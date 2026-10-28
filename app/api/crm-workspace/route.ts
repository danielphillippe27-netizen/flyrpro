import { NextRequest } from "next/server";
import { z } from "zod";
import {
  crmRequest,
  requireCrmWorkspace,
  readCrmBody,
  privateJson,
  errorResponse,
  CrmRequestError,
} from "@/lib/mac-companion/server";
export const dynamic = "force-dynamic";
const uuid = z.string().uuid(),
  text = z.string().max(100),
  nullable = z.string().max(10000).nullable(),
  date = z.string().datetime({ offset: true }).nullable();
const common = { workspaceId: uuid };
const labels = z
  .array(z.string().trim().min(1).max(60))
  .max(20);
const stage = z.enum(["Lead", "Warm", "Active Client", "Past Client"]);
const create = {
  first_name: text.trim().min(1),
  last_name: text,
  phone: z.string().max(80).nullable(),
  email: z.union([z.string().email().max(254), z.literal("")]).nullable(),
  contact_labels: labels,
};
const schema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("create"), ...create }).strict(),
  z
    .object({
      ...common,
      action: z.literal("update"),
      id: uuid,
      updated_at: z.string().datetime({ offset: true }),
      first_name: create.first_name,
      last_name: text,
      phone: create.phone,
      email: create.email,
      address: z.string().max(500).nullable(),
      notes: nullable,
      last_contacted_at: date,
      next_follow_up_at: date,
    })
    .strict(),
  z
    .object({ ...common, action: z.literal("labels"), id: uuid, labels })
    .strict(),
  z.object({ ...common, action: z.literal("stage"), id: uuid, stage }).strict(),
  z
    .object({
      ...common,
      action: z.literal("bulk-label"),
      ids: z.array(uuid).min(1).max(500),
      value: z.string().trim().min(1).max(60),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("bulk-stage"),
      ids: z.array(uuid).min(1).max(500),
      value: stage,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("delete"),
      ids: z.array(uuid).min(1).max(500),
      confirmation: z.literal("DELETE"),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("task-create"),
      title: z.string().trim().min(1).max(200),
      client_id: uuid.nullable(),
      due_at: date,
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("task-toggle"),
      id: uuid,
      source: z.enum(["field", "crm"]),
      version: z.number().int().positive(),
    })
    .strict(),
  z.object({ ...common, action: z.literal("read"), id: uuid }).strict(),
]);
export async function GET(request: NextRequest) {
  try {
    const { api } = await crmRequest(request, "mac");
    const ws = request.nextUrl.searchParams.get("workspaceId");
    const offset = Number(request.nextUrl.searchParams.get("offset") ?? 0);
    if (
      !uuid.safeParse(ws).success ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 1000000
    )
      throw new CrmRequestError("Invalid workspace or page.");
    await requireCrmWorkspace(api, ws!);
    const result = await api.rpc("coco_crm_snapshot", {
      ws: ws!,
      page_offset: offset,
    });
    if (result.error)
      throw new CrmRequestError(
        "Could not load the CRM. Check that its database update is installed.",
        503,
      );
    return privateJson(result.data);
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    const { api } = await crmRequest(request, "mac", true);
    const input = schema.safeParse(await readCrmBody(request, 80000));
    if (!input.success)
      throw new CrmRequestError("Check the contact details and try again.");
    const { action, workspaceId, ...payload } = input.data;
    await requireCrmWorkspace(api, workspaceId);
    const result = await api.rpc("coco_crm_command", {
      ws: workspaceId,
      command: action,
      payload,
    });
    if (result.error) {
      if (result.error.code === "42501")
        throw new CrmRequestError(
          "Contact unavailable in this account and workspace.",
          403,
        );
      if (result.error.code === "40001")
        throw new CrmRequestError(
          "This record changed elsewhere. Reload its latest details before saving.",
          409,
        );
      if (result.error.code === "23503")
        throw new CrmRequestError(
          "This contact has linked records. Reassign those records before deleting it.",
          409,
        );
      throw new CrmRequestError(
        "Could not save the change. Your edits are kept for retry.",
        503,
      );
    }
    return privateJson(result.data ?? {});
  } catch (e) {
    return errorResponse(e);
  }
}
