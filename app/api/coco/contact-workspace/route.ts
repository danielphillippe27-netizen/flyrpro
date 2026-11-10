import { NextRequest } from "next/server";
import { z } from "zod";
import { crmRequest, requireCrmWorkspace, readCrmBody, privateJson, errorResponse, CrmRequestError } from "@/lib/mac-companion/server";

const uuid = z.string().uuid();
const date = z.string().datetime({ offset: true });
const context = { workspaceId: uuid, contactId: uuid };
const body = z.string().trim().max(10_000);
const mutation = z.discriminatedUnion("action", [
  z.object({ ...context, action: z.literal("note"), requestId: uuid, body: body.min(1), addressId: uuid.nullable().optional() }).strict(),
  z.object({ ...context, action: z.literal("profile"), source: z.string().max(120), company: z.string().max(160), jobTitle: z.string().max(120), contactType: z.string().max(80), assignedRepId: uuid.nullable().optional() }).strict(),
  z.object({ ...context, action: z.literal("add-identifier"), identifier: z.string().trim().min(3).max(254) }).strict(),
  z.object({ ...context, action: z.literal("remove-identifier"), identifier: z.string().trim().min(3).max(254) }).strict(),
  z.object({ ...context, action: z.literal("call-sync"), enabled: z.boolean() }).strict(),
  z.object({ ...context, action: z.literal("import-calls"), calls: z.array(z.object({
    providerId: z.string().regex(/^[a-f0-9]{64}$/), direction: z.enum(["incoming", "outgoing"]),
    kind: z.enum(["Phone", "FaceTime audio", "FaceTime video"]), durationSeconds: z.number().int().min(0).max(604_800),
    startedAt: date,
  }).strict()).max(10) }).strict(),
  z.object({ ...context, action: z.literal("edit-note"), eventId: uuid, previous: z.string().max(10_000), body: body.min(1) }).strict(),
  z.object({ ...context, action: z.literal("call"), requestId: uuid, outcome: z.enum(["Reached", "Left voicemail", "No answer", "Wrong number", "Other"]), body }).strict(),
  z.object({ ...context, action: z.literal("link-property"), addressId: uuid }).strict(),
  z.object({ ...context, action: z.literal("unlink-property"), addressId: uuid }).strict(),
  z.object({ ...context, action: z.literal("link-contact"), relatedId: uuid, label: z.string().trim().min(1).max(80) }).strict(),
  z.object({ ...context, action: z.literal("unlink-contact"), relatedId: uuid }).strict(),
  z.object({ ...context, action: z.literal("appointment"), at: date.nullable(), title: z.string().trim().max(200), location: z.string().trim().max(500) }).strict(),
]);
const query = z.object({
  ...context,
  category: z.enum(["all", "communications", "messages", "emails", "calls", "notes", "field"]).default("all"),
  beforeAt: date.optional(),
  beforeKey: z.string().regex(/^[a-z-]+:[0-9a-f-]{36}$/).optional(),
  propertyQuery: z.string().trim().min(3).max(100).optional(),
}).refine(input => Boolean(input.beforeAt) === Boolean(input.beforeKey));
function failure(error: unknown) {
  return errorResponse(error instanceof z.ZodError ? new CrmRequestError("Check the contact and the entered values.") : error);
}
export async function GET(request: NextRequest) {
  try {
    const input = query.parse(Object.fromEntries(request.nextUrl.searchParams));
    const { api } = await crmRequest(request, "crm");
    await requireCrmWorkspace(api, input.workspaceId);
    const result = input.propertyQuery
      ? await api.rpc("coco_search_contact_properties", { ws: input.workspaceId, query: input.propertyQuery })
      : await api.rpc("coco_contact_workspace", {
        ws: input.workspaceId, target: input.contactId, category: input.category,
        before_at: input.beforeAt ?? null, before_key: input.beforeKey ?? null,
      });
    if (result.error) throw new CrmRequestError(result.error.code === "42501" ? "Contact unavailable in this workspace." : "Contact activity is unavailable.", result.error.code === "42501" ? 403 : 503);
    return privateJson(result.data);
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const { api } = await crmRequest(request, "crm", true);
    const { workspaceId, contactId, action, ...payload } = mutation.parse(await readCrmBody(request, 100_000));
    await requireCrmWorkspace(api, workspaceId);
    const { error } = await api.rpc("coco_contact_workspace_command", { ws: workspaceId, target: contactId, command: action, payload });
    if (error?.code === "42501") throw new CrmRequestError("This record is unavailable in your workspace.", 403);
    if (error?.code === "40001") throw new CrmRequestError("This note changed elsewhere. Refresh before editing again.", 409);
    if (error) throw new CrmRequestError("Could not save the change. Try again.", 503);
    return privateJson({ saved: true });
  } catch (error) { return failure(error); }
}
