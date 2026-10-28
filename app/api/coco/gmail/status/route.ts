import { NextRequest } from "next/server";
import {
  crmRequest,
  requireCrmWorkspace,
  privateJson,
  errorResponse,
  CrmRequestError,
} from "@/lib/mac-companion/server";
import { cocoGmailStatus } from "@/lib/coco/gmail";
import { z } from "zod";
export async function GET(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, "mac");
    const ws = request.nextUrl.searchParams.get("workspaceId");
    if (!z.string().uuid().safeParse(ws).success)
      throw new CrmRequestError("Select a workspace.");
    await requireCrmWorkspace(api, ws!);
    return privateJson(await cocoGmailStatus(user.id));
  } catch (e) {
    return errorResponse(e);
  }
}
