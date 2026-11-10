import { NextRequest } from "next/server";
import { z } from "zod";
import {
  crmRequest,
  requireCrmWorkspace,
  privateJson,
  errorResponse,
  CrmRequestError,
} from "@/lib/mac-companion/server";
export async function GET(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, "mac");
    const ws = request.nextUrl.searchParams.get("workspaceId"),
      id = request.nextUrl.searchParams.get("contactId");
    if (![ws, id].every((v) => z.string().uuid().safeParse(v).success))
      throw new CrmRequestError("Select a CRM contact.");
    await requireCrmWorkspace(api, ws!);
    const view = request.nextUrl.searchParams.get("view");
    if (view === "call-identifiers") {
      const result = await api.rpc("coco_contact_call_identifiers", { ws: ws!, target: id! });
      if (result.error) throw new CrmRequestError("Contact matching is unavailable.", result.error.code === "42501" ? 403 : 503);
      return privateJson(result.data);
    }
    const r = await api.rpc("coco_crm_recipient", { ws: ws!, target: id! });
    if (r.error)
      throw new CrmRequestError(
        "This contact needs a unique phone number or email before sending.",
        403,
      );
    if (view === "contact-text" || view === "contact-call") {
      const contact = await api.from("contacts").select("do_not_contact")
        .eq("id", id!).eq("workspace_id", ws!).eq("user_id", user.id).maybeSingle();
      if (!contact.data || contact.data.do_not_contact)
        throw new CrmRequestError("This contact is unavailable for outreach.", 403);
      if (view === "contact-text") {
        const [prefs, approval] = await Promise.all([
          api.from("mac_crm_preferences").select("sync_enabled").eq("workspace_id", ws!).eq("user_id", user.id).maybeSingle(),
          api.from("mac_message_permissions").select("enabled,identifiers").eq("workspace_id", ws!).eq("user_id", user.id).eq("contact_id", id!).maybeSingle(),
        ]);
        if (!prefs.data?.sync_enabled || !approval.data?.enabled || !approval.data.identifiers.includes(r.data?.identifier))
          throw new CrmRequestError("Connect Apple Messages and approve this contact before sending.", 403);
      } else if (typeof r.data?.identifier !== "string" || !r.data.identifier.startsWith("+")) {
        throw new CrmRequestError("Add a unique phone number for this contact.", 403);
      }
    }
    return privateJson(r.data);
  } catch (e) {
    return errorResponse(e);
  }
}
