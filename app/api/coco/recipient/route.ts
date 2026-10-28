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
    const { api } = await crmRequest(request, "mac");
    const ws = request.nextUrl.searchParams.get("workspaceId"),
      id = request.nextUrl.searchParams.get("contactId");
    if (![ws, id].every((v) => z.string().uuid().safeParse(v).success))
      throw new CrmRequestError("Select a CRM contact.");
    await requireCrmWorkspace(api, ws!);
    const r = await api.rpc("coco_crm_recipient", { ws: ws!, target: id! });
    if (r.error)
      throw new CrmRequestError(
        "This contact needs a unique phone number or email before sending.",
        403,
      );
    return privateJson(r.data);
  } catch (e) {
    return errorResponse(e);
  }
}
