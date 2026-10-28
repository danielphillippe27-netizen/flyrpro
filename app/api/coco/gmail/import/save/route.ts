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
export async function POST(request: NextRequest) {
  try {
    const { api } = await crmRequest(request, "mac", true);
    const nullable = z.string().max(2000).nullable();
    const input = z
      .object({
        workspace_id: z.string().uuid(),
        candidate: z
          .object({
            messageId: z.string().min(1).max(200),
            name: z.string().trim().min(1).max(100),
            email: z.string().email().max(254),
            phone: nullable.optional(),
            propertyAddress: nullable,
            side: z.enum(["buyer", "seller"]).nullable(),
            price: z.number().min(0).max(1e13).nullable(),
            closingDate: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .nullable(),
            subject: z.string().max(200),
            evidenceExcerpt: z.string().min(1).max(4000),
            messageDate: z.string().max(80),
            confidence: z.string().max(30).optional(),
            warnings: z.array(z.string().max(1000)).max(30).optional(),
            status: z.string().max(30).optional(),
            sources: z.array(z.string().max(200)).max(100).optional(),
            notes: nullable.optional(),
          })
          .strict(),
      })
      .strict()
      .parse(await readCrmBody(request, 80000));
    await requireCrmWorkspace(api, input.workspace_id);
    const { data, error } = await api.rpc("coco_save_gmail_candidate", {
      ws: input.workspace_id,
      candidate: input.candidate,
    });
    if (error)
      throw new CrmRequestError(
        error.code === "40001"
          ? "Multiple contacts share this email. Review the duplicates in Contacts first."
          : "Could not save this candidate. Your selection is kept for retry.",
        error.code === "40001" ? 409 : 503,
      );
    return privateJson(data);
  } catch (e) {
    return errorResponse(
      e instanceof z.ZodError
        ? new CrmRequestError("Review the candidate details before saving.")
        : e,
    );
  }
}
