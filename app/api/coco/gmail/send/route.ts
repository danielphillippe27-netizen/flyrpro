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
import { cocoGmailAccess } from "@/lib/coco/gmail";
import { gmailMime } from "@/lib/outreach/gmail";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, "mac", true);
    const b = z
      .object({
        workspace_id: z.string().uuid(),
        client_id: z.string().uuid(),
        expected_email:z.string().email().max(254),
        request_id: z.string().uuid(),
        subject: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .refine((s) => !/[\r\n\0]/.test(s)),
        body: z
          .string()
          .trim()
          .min(1)
          .max(100000)
          .refine((s) => !s.includes("\0")),
      })
      .strict()
      .parse(await readCrmBody(request, 450000));
    await requireCrmWorkspace(api, b.workspace_id);
    const { data: c } = await api
      .from("contacts")
      .select("id,email")
      .eq("id", b.client_id)
      .eq("workspace_id", b.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!c?.email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(c.email))
      throw new CrmRequestError("Contact needs a valid email.", 403);
    if(c.email.trim().toLowerCase()!==b.expected_email.trim().toLowerCase())throw new CrmRequestError('The recipient changed. Reopen this contact before sending.',409);
    const gmail = await cocoGmailAccess(user.id, "send");
    const raw = gmailMime(gmail.email, c.email, b.subject, b.body),
      hash = createHash("sha256")
        .update(JSON.stringify([b.workspace_id, c.id, raw]))
        .digest("hex");
    const admin = createAdminClient();
    const { error: claim } = await admin
      .from("crm_email_send_requests")
      .insert({
        id: b.request_id,
        user_id: user.id,
        workspace_id: b.workspace_id,
        contact_id: c.id,
        payload_hash: hash,
      });
    if (claim) {
      if (claim.code !== "23505")
        throw new CrmRequestError(
          "Could not reserve this send. No email was sent.",
          503,
        );
      const { data: prior } = await admin
        .from("crm_email_send_requests")
        .select("status,payload_hash,gmail_message_id")
        .eq("user_id", user.id)
        .eq("id", b.request_id)
        .maybeSingle();
      if (prior?.payload_hash !== hash)
        throw new CrmRequestError(
          "This request belongs to another draft.",
          409,
        );
      if (prior.status === "sent")
        return privateJson({ sent: true, message_id: prior.gmail_message_id });
      return privateJson(
        {
          error:
            "This email was already attempted. Check Gmail Sent before composing another email.",
          attempted: true,
        },
        409,
      );
    }
    let status = "unknown",
      id: string | null = null;
    try {
      const response = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gmail.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw }),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (response.ok) {
        const result = await response.json();
        if (typeof result.id === "string") {
          id = result.id;
          status = "sent";
        }
      } else if (response.status < 500) status = "failed";
    } catch {
      /* An interrupted provider response may still mean acceptance. No automatic retry. */
    }
    const saved = await admin
      .from("crm_email_send_requests")
      .update({ status, gmail_message_id: id })
      .eq("user_id", user.id)
      .eq("id", b.request_id);
    if (status === "sent" && !saved.error)
      return privateJson({ sent: true, message_id: id });
    return privateJson(
      {
        error:
          "Gmail did not confirm this send. Check Gmail Sent before composing another email.",
        attempted: true,
      },
      502,
    );
  } catch (e) {
    return errorResponse(
      e instanceof z.ZodError
        ? new CrmRequestError("Check the email subject and message.")
        : e,
    );
  }
}
