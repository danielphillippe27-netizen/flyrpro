import { createHash } from "node:crypto";
import { gmailMime } from "@/lib/outreach/gmail";

type Options = { cc?: string[]; bcc?: string[]; files?: { name: string; data: string }[]; messageId?: string };

export function contactGmailMime(from: string, to: string, subject: string, body: string, options: Options) {
  const base = Buffer.from(gmailMime(from, to, subject, body), "base64url").toString("utf8");
  const divider = base.indexOf("\r\n\r\n");
  const headers = [
    options.cc?.length ? `Cc: ${options.cc.join(", ")}` : "",
    options.bcc?.length ? `Bcc: ${options.bcc.join(", ")}` : "",
    options.messageId ? `In-Reply-To: ${options.messageId}\r\nReferences: ${options.messageId}` : "",
  ].filter(Boolean);
  if (!options.files?.length) return Buffer.from([...headers, base].join("\r\n")).toString("base64url");
  // Deterministic MIME keeps the existing idempotency hash stable on a retry.
  const boundary = "wolfgrid-" + createHash("sha256").update(base).update(JSON.stringify(options.files)).digest("hex").slice(0, 32);
  const prefix = base.slice(0, base.indexOf("\r\nContent-Type:"));
  const plain = base.slice(base.indexOf("Content-Type:"), divider) + "\r\n\r\n" + base.slice(divider + 4);
  const parts = options.files.map(({ name, data }) => {
    const safe = encodeURIComponent(name).replace(/[!'()*]/g, char => "%" + char.charCodeAt(0).toString(16));
    const wrapped = Buffer.from(data, "base64").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
    return [
      "Content-Type: application/octet-stream",
      `Content-Disposition: attachment; filename*=UTF-8''${safe}`,
      "Content-Transfer-Encoding: base64",
      "",
      wrapped,
    ].join("\r\n");
  });
  return Buffer.from([
    prefix, ...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
    ...[plain, ...parts].flatMap(part => [`--${boundary}`, part]),
    `--${boundary}--`, "",
  ].join("\r\n")).toString("base64url");
}
