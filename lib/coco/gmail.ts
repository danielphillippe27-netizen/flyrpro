import { createAdminClient } from "@/lib/supabase/server";
import {
  gmailAccess,
  gmailConfig,
  unseal,
  type GmailTokens,
} from "@/lib/outreach/gmail";
export const READ = "https://www.googleapis.com/auth/gmail.readonly",
  SEND = "https://www.googleapis.com/auth/gmail.send";
export async function cocoGmailStatus(userId: string) {
  let configured = true;
  try {
    gmailConfig();
  } catch {
    configured = false;
  }
  const { data, error } = await createAdminClient()
    .from("personal_gmail_connections")
    .select("email,tokens_encrypted")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw Error("Gmail connection storage is unavailable.");
  if (!data)
    return {
      configured,
      connected: false,
      email: null,
      can_read: false,
      can_send: false,
    };
  const tokens = unseal<GmailTokens & { scopes?: string[] }>(
    data.tokens_encrypted,
  );
  const scopes = tokens.scopes ?? [SEND];
  return {
    configured,
    connected: true,
    email: data.email,
    can_read: scopes.includes(READ),
    can_send: scopes.includes(SEND),
  };
}
export async function cocoGmailAccess(
  userId: string,
  purpose: "read" | "send",
) {
  const status = await cocoGmailStatus(userId);
  if (
    !status.connected ||
    !(purpose === "read" ? status.can_read : status.can_send)
  )
    throw Error(
      purpose === "read"
        ? "Connect Gmail read access first."
        : "Connect Gmail sending permission first.",
    );
  return gmailAccess(userId);
}
function text(part: {
  mimeType?: string;
  body?: { data?: string };
  parts?: unknown[];
}): string {
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .slice(0, 1500);
  return (part.parts ?? [])
    .map((p) => text(p as Parameters<typeof text>[0]))
    .join("\n")
    .slice(0, 1500);
}
export async function clientGmailContext(userId: string, email: string) {
  if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email)) return "";
  const { token } = await cocoGmailAccess(userId, "read");
  const url = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
  );
  url.searchParams.set("q", `from:${email} OR to:${email}`);
  url.searchParams.set("maxResults", "5");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw Error("Gmail could not read this contact. Reconnect Gmail.");
  const listing = (await response.json()) as { messages?: { id: string }[] };
  const excerpts = await Promise.all(
    (listing.messages ?? []).slice(0, 5).map(async (m) => {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(m.id)}?format=full`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!r.ok) throw Error("Gmail could not read a recent email.");
      const data = await r.json();
      return `SOURCE EMAIL ${m.id}: ${text(data.payload ?? {})}`;
    }),
  );
  return excerpts.join("\n").slice(0, 9000);
}
