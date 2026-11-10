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
import { contactGmailMime } from "@/lib/coco/gmail-mime";
export const runtime = "nodejs";
const extraRecipients = z.array(z.string().email().max(254)).max(10).optional();
const file = z.object({
  name: z.string().trim().min(1).max(150).refine(value => !/[\x00-\x1f\x7f]/.test(value)),
  data: z.string().min(1).max(2_800_000).regex(/^[a-zA-Z0-9+/]+={0,2}$/),
}).strict();
export async function POST(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, "mac", true);
    const b = z
      .object({
        workspace_id: z.string().uuid(),
        client_id: z.string().uuid(),
        expected_email:z.string().email().max(254),
        request_id: z.string().uuid(),
        reply_to: z.string().uuid().optional(),
        cc: extraRecipients,
        bcc: extraRecipients,
        files: z.array(file).max(5).optional(),
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
      .parse(await readCrmBody(request, 3_300_000));
    await requireCrmWorkspace(api, b.workspace_id);
    const { data: c } = await api
      .from("contacts")
      .select("id,email,do_not_contact")
      .eq("id", b.client_id)
      .eq("workspace_id", b.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!c?.email || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(c.email))
      throw new CrmRequestError("Contact needs a valid email.", 403);
    if (c.do_not_contact) throw new CrmRequestError("This contact is marked do not contact.", 403);
    if(c.email.trim().toLowerCase()!==b.expected_email.trim().toLowerCase())throw new CrmRequestError('The recipient changed. Reopen this contact before sending.',409);
    const gmail = await cocoGmailAccess(user.id, "send").catch(() => null);
    if (!gmail) return privateJson({ error: "Reconnect Gmail before sending.", reconnect: true }, 403);
    const admin = createAdminClient();
    let reply: { threadId: string; messageId: string; subject: string } | undefined;
    if (b.reply_to) {
      const { data: original } = await admin.from("crm_contact_gmail_history").select("thread_id,message_id_header,subject")
        .eq("id", b.reply_to).eq("user_id", user.id).eq("workspace_id", b.workspace_id)
        .eq("contact_id", b.client_id).eq("mailbox", gmail.email.toLowerCase()).eq("recipient", c.email.toLowerCase()).maybeSingle();
      if (!original?.message_id_header || !/^<[^<>\s\x00-\x1f\x7f]{1,250}>$/.test(original.message_id_header))
        throw new CrmRequestError("This email cannot be replied to in WolfGrid.", 403);
      reply = { threadId: original.thread_id, messageId: original.message_id_header, subject: original.subject };
    }
    if ((b.files ?? []).reduce((sum, f) => sum + Buffer.from(f.data, "base64").length, 0) > 2_000_000)
      throw new CrmRequestError("Attachments must be under 2 MB combined.");
    const subject = reply ? `Re: ${reply.subject.replace(/^re:\s*/i, "")}` : b.subject;
    const extended = Boolean(reply || b.cc?.length || b.bcc?.length || b.files?.length);
    const raw = extended ? contactGmailMime(gmail.email, c.email, subject, b.body, { ...b, messageId: reply?.messageId })
      : gmailMime(gmail.email, c.email, subject, b.body);
    const hash = createHash("sha256")
      .update(JSON.stringify(extended ? [b.workspace_id, c.id, raw, reply?.threadId] : [b.workspace_id, c.id, raw])).digest("hex");
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
      id: string | null = null, threadId: string | null = null, reconnect = false;
    try {
      const response = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gmail.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ raw, ...(reply ? { threadId: reply.threadId } : {}) }),
          signal: AbortSignal.timeout(30000),
        },
      );
      if (response.ok) {
        const result = await response.json();
        if (typeof result.id === "string") {
          id = result.id;
          threadId = typeof result.threadId === "string" ? result.threadId : null;
          status = "sent";
        }
      } else if (response.status < 500) {
        status = "failed";
        reconnect = response.status === 401 || response.status === 403;
      }
    } catch {
      /* An interrupted provider response may still mean acceptance. No automatic retry. */
    }
    const saved = await admin
      .from("crm_email_send_requests")
      .update({ status, gmail_message_id: id })
      .eq("user_id", user.id)
      .eq("id", b.request_id);
    if (status === "sent" && !saved.error) {
      await admin.from("crm_email_send_requests").update({ gmail_thread_id: threadId, subject })
        .eq("user_id", user.id).eq("id", b.request_id);
      return privateJson({ sent: true, message_id: id });
    }
    if (reconnect) return privateJson({ error: "Reconnect Gmail before sending.", reconnect: true, attempted: true }, 403);
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
