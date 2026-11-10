import type { NextRequest } from "next/server";
import { z } from "zod";
import { CrmRequestError, crmRequest, errorResponse, privateJson, readCrmBody } from "@/lib/mac-companion/server";

const id = z.string().uuid();
const input = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    template: z.object({
      id,
      name: z.string().trim().min(1).max(100).refine(value => !value.includes("\0")),
      subject: z.string().trim().min(1).max(200).refine(value => !/[\r\n\0]/.test(value)),
      body: z.string().trim().min(1).max(10000).refine(value => !value.includes("\0")),
    }).strict(),
  }).strict(),
  z.object({ action: z.literal("delete"), id }).strict(),
]);

export async function GET(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, "crm");
    const { data, error } = await api.from("crm_email_templates").select("id,name,subject,body")
      .eq("user_id", user.id).order("name").order("id");
    if (error) throw new CrmRequestError("Could not load email templates.", 503);
    return privateJson({ templates: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, "crm", true);
    const parsed = input.safeParse(await readCrmBody(request, 65536));
    if (!parsed.success) throw new CrmRequestError("Enter a template name, subject and message.");

    const command = parsed.data;
    const table = api.from("crm_email_templates");
    const { error } = command.action === "save"
      ? await table.upsert({ ...command.template, user_id: user.id })
      : await table.delete().eq("id", command.id).eq("user_id", user.id);
    if (error) throw new CrmRequestError("Could not save the template change.", 503);
    return privateJson({ saved: true });
  } catch (error) {
    return errorResponse(error);
  }
}
