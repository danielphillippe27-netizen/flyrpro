"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { createClient as supabase } from "@/lib/supabase/client";
import { emailTemplatesRequest, starterEmailTemplates, type EmailTemplate } from "@/lib/coco/email-templates";
import type { Client } from "@/lib/coco/types";

export function EmailComposer({
  client,
  workspaceId,
  from,
  canSend,
  configured = true,
  onConnect,
  onClose,
  onSent,
  onReconnectNeeded,
  advanced = false,
  templateUserId,
  reply,
  inline = false,
}: {
  inline?: boolean;
  client: Client;
  workspaceId: string;
  from: string | null;
  canSend: boolean;
  configured?: boolean;
  onConnect: () => void;
  onClose: () => void;
  onSent?: () => void;
  onReconnectNeeded?: () => void;
  advanced?: boolean;
  templateUserId?: string;
  reply?: { id: string; subject: string };
}) {
  const [subject, setSubject] = useState(reply ? `Re: ${reply.subject.replace(/^re:\s*/i, "")}` : "");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [savedTemplates, setSavedTemplates] = useState<EmailTemplate[]>();
  const [templatesError, setTemplatesError] = useState("");
  const id = useRef<string | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    if (!templatesOpen || !templateUserId) return;
    const controller = new AbortController();
    emailTemplatesRequest(templateUserId, undefined, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setSavedTemplates(result.templates ?? []);
      })
      .catch(error => {
        if (!controller.signal.aborted) setTemplatesError(error.message);
      });
    return () => controller.abort();
  }, [templatesOpen, templateUserId]);

  function applyTemplate(template: EmailTemplate) {
    const fillName = (text: string) => text.replaceAll("{first_name}", () => client.first_name);
    const message = [body.trimEnd(), fillName(template.body)].filter(Boolean).join("\n\n");
    if (message.length > 100000) {
      setError("This template would make the email too long.");
      return;
    }
    setError("");
    if (!reply && !subject.trim()) setSubject(fillName(template.subject).replace(/[\r\n\0]/g, " ").slice(0, 200));
    setBody(message);
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || attempted || !canSend) return;
    lock.current = true;
    setBusy(true);
    setError("");
    id.current ??= crypto.randomUUID();
    let submitted = false;
    try {
      const { data } = await supabase().auth.getSession();
      submitted = true;
      const response = await fetch("/api/coco/gmail/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wolfgrid-user-id": data.session?.user.id ?? "",
        },
        body: JSON.stringify({
          workspace_id: workspaceId,
          client_id: client.id,
          expected_email:client.email,
          request_id: id.current,
          subject,
          body,
          ...(advanced && reply ? { reply_to: reply.id } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        submitted = Boolean(result.attempted);
        if (result.reconnect) onReconnectNeeded?.();
        throw new Error(result.error ?? "Could not send email");
      }
      setSent(true);
      onSent?.();
      setAttempted(true);
    } catch (error) {
      setAttempted(submitted || !advanced);
      setError(
        error instanceof Error
          ? error.message
          : "Sending was interrupted. Check Gmail Sent before retrying.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const sendButton = <button className="primary" disabled={!canSend || busy || attempted || !subject.trim() || !body.trim()}>
    {busy ? "Sending…" : "Send email"}
  </button>;
  return (
    <div className={advanced ? "contact-email-composer" : inline ? "inbox-email-composer" : "modal-backdrop"}>
      <form
        className={inline ? "email-compose-form" : "modal"}
        onSubmit={send}
        role={inline ? undefined : "dialog"}
        aria-modal={inline ? undefined : true}
        aria-label="Compose email"
      >
        <h2>{sent ? "Email sent" : "Compose email"}</h2>
        {advanced ? <p className="contact-muted">To {client.email} · From {from ?? "Gmail"}</p> : <>
          <p>To: {client.email}</p>
          <p>From: {from ?? (configured ? "Connect Gmail" : "Gmail unavailable")}</p>
        </>}
        {sent ? (
          <p>
            Gmail accepted your email. It appears in Gmail Sent; delivery is not
            confirmed here.
          </p>
        ) : (
          <>
            {!canSend && (
              <>
                {configured ? (
                  <>
                    <p>Connect your Gmail account to send email. Google sign-in only signs you into WolfGrid.</p>
                    <button type="button" onClick={onConnect}>Connect Gmail sending</button>
                  </>
                ) : (
                  <p role="status">Gmail sending is not set up on WolfGrid yet. You can write a draft here, but sending will be available after WolfGrid enables Gmail connections.</p>
                )}
              </>
            )}
            <label>
              {!advanced && "Subject"}
              <input
                aria-label={advanced ? "Subject" : undefined}
                placeholder={advanced ? "Subject" : undefined}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                required
                disabled={busy || attempted || Boolean(reply)}
              />
            </label>
            <label>
              {!advanced && "Message"}
              <textarea
                aria-label={advanced ? "Message" : undefined}
                placeholder={advanced ? "Write an email…" : undefined}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={100000}
                rows={advanced ? 2 : 9}
                required
                disabled={busy || attempted}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            {advanced ? <div className="contact-compose-actions contact-email-actions">
              <DropdownMenu onOpenChange={open => {
                if (open) { setSavedTemplates(undefined); setTemplatesError(""); }
                setTemplatesOpen(open);
              }}>
                <DropdownMenuTrigger asChild>
                  <button type="button" disabled={busy || attempted}>Templates</button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {[...(savedTemplates ?? []), ...starterEmailTemplates].map(template => (
                    <DropdownMenuItem key={template.id} onSelect={() => applyTemplate(template)}>
                      <span className="truncate">{template.name}</span>
                    </DropdownMenuItem>
                  ))}
                  {templateUserId && !savedTemplates && <DropdownMenuItem disabled>{templatesError || "Loading your templates…"}</DropdownMenuItem>}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild><Link href="/settings/email-templates">Manage email templates</Link></DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {sendButton}
            </div> : sendButton}
          </>
        )}
        {(!advanced || sent) && <button type="button" disabled={busy} onClick={onClose}>
          {sent ? "Done" : "Close"}
        </button>}
      </form>
    </div>
  );
}
