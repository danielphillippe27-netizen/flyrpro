import { NextRequest } from "next/server";
import { z } from "zod";
import { cocoGmailAccess } from "@/lib/coco/gmail";
import { createAdminClient } from "@/lib/supabase/server";
import { crmRequest, requireCrmWorkspace, readCrmBody, privateJson, errorResponse, CrmRequestError } from "@/lib/mac-companion/server";

const address = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const gmailId = /^[a-z0-9]{1,128}$/i;
const messageId = /^<[^<>\s\x00-\x1f\x7f]{1,250}>$/;
function mailbox(value: string) {
  const clean = value.trim();
  const email = (clean.match(/^[^,<>]*<([^<>]+)>$/)?.[1] ?? clean).toLowerCase();
  return address.test(email) ? email : null;
}
type GmailMessage = {
  id: string; threadId: string; labelIds?: string[]; internalDate: string; snippet?: string;
  payload?: { headers?: { name: string; value: string }[] };
};

export async function POST(request: NextRequest) {
  try {
    const input = z.object({ workspaceId: z.string().uuid(), contactId: z.string().uuid() }).strict()
      .parse(await readCrmBody(request, 4000));
    const { api, user } = await crmRequest(request, "mac", true);
    await requireCrmWorkspace(api, input.workspaceId);
    const { data: contact } = await api.from("contacts").select("email")
      .eq("id", input.contactId).eq("workspace_id", input.workspaceId).eq("user_id", user.id).maybeSingle();
    const email = typeof contact?.email === "string" ? mailbox(contact.email) : null;
    if (!email) throw new CrmRequestError("Add a valid email address to this contact.", 403);
    const same = await api.rpc("mac_owned_identifiers", { ws: input.workspaceId })
      .select("contact_id").eq("identifier", email).neq("contact_id", input.contactId).limit(1);
    if (same.error || !Array.isArray(same.data) || same.data.length)
      throw new CrmRequestError("Add an email address unique to this contact.", 409);
    const gmail = await cocoGmailAccess(user.id, "read").catch(() => null);
    const identity = gmail && mailbox(gmail.email);
    if (!gmail || !identity) throw new CrmRequestError("Reconnect Gmail with read access.", 403);
    const query = new URLSearchParams({ q: `newer_than:90d {from:${email} to:${email}} -in:drafts -in:spam -in:trash`, maxResults: "20" });
    const base = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
    const options = { headers: { Authorization: `Bearer ${gmail.token}` }, cache: "no-store" as const, signal: AbortSignal.timeout(12_000) };
    const listed = await fetch(`${base}?${query}`, options);
    if (!listed.ok) throw new CrmRequestError("Gmail could not load history. Check the connection in Settings.", 502);
    const { messages = [] } = await listed.json() as { messages?: { id: string }[] };
    const records = [];
    for (let offset = 0; offset < Math.min(messages.length, 20); offset += 5) {
      const batch = await Promise.all(messages.slice(offset, offset + 5).map(async entry => {
        if (!gmailId.test(entry.id)) return null;
        const params = new URLSearchParams([["format", "metadata"], ...["From", "To", "Subject", "Message-ID", "Cc", "Bcc"].map(name => ["metadataHeaders", name])]);
        const response = await fetch(`${base}/${entry.id}?${params}`, options);
        if (response.status === 404) return null;
        if (!response.ok) throw new CrmRequestError("Gmail could not load a message. Try again.", 502);
        const item = await response.json() as GmailMessage;
        const header = (name: string) => item.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value ?? "";
        const from = mailbox(header("from")), to = mailbox(header("to"));
        const outgoing = from === identity && to === email && item.labelIds?.includes("SENT");
        if (!outgoing && !(from === email && to === identity)) return null;
        if (header("cc") || header("bcc") || !gmailId.test(item.threadId) || item.id !== entry.id) return null;
        const date = Number(item.internalDate);
        if (!Number.isFinite(date) || date < Date.now() - 91 * 86400_000 || date > Date.now() + 5 * 60_000) return null;
        const original = header("message-id").trim();
        return {
          user_id: user.id, workspace_id: input.workspaceId, contact_id: input.contactId, mailbox: identity, recipient: email,
          provider_id: item.id, thread_id: item.threadId, message_id_header: messageId.test(original) ? original : null,
          direction: outgoing ? "outgoing" : "incoming", sent_at: new Date(date).toISOString(),
          subject: header("subject").replace(/[\r\n\x00]/g, " ").slice(0, 200), snippet: (item.snippet ?? "").slice(0, 2000),
        };
      }));
      for (const record of batch) if (record) records.push(record);
    }
    if (records.length) {
      const { error } = await createAdminClient().from("crm_contact_gmail_history")
        .upsert(records, { onConflict: "user_id,workspace_id,mailbox,provider_id", ignoreDuplicates: true });
      if (error) throw new CrmRequestError("Could not save Gmail history.", 503);
    }
    return privateJson({ matched: records.length });
  } catch (error) {
    return errorResponse(error instanceof z.ZodError ? new CrmRequestError("Choose a contact.") : error);
  }
}
