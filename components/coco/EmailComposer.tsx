"use client";
import { useRef, useState } from "react";
import { createClient as supabase } from "@/lib/supabase/client";
import type { Client } from "@/lib/coco/types";

export function EmailComposer({
  client,
  workspaceId,
  from,
  canSend,
  onConnect,
  onClose,
  inline = false,
}: {
  inline?: boolean;
  client: Client;
  workspaceId: string;
  from: string | null;
  canSend: boolean;
  onConnect: () => void;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const id = useRef<string | null>(null);
  const lock = useRef(false);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || attempted || !canSend) return;
    lock.current = true;
    setBusy(true);
    setError("");
    id.current ??= crypto.randomUUID();
    try {
      const { data } = await supabase().auth.getSession();
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
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.attempted) setAttempted(true);
        throw new Error(result.error ?? "Could not send email");
      }
      setSent(true);
      setAttempted(true);
    } catch (error) {
      setAttempted(true);
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
  return (
    <div className={inline ? "inbox-email-composer" : "modal-backdrop"}>
      <form
        className={inline ? "email-compose-form" : "modal"}
        onSubmit={send}
        role={inline ? undefined : "dialog"}
        aria-modal={inline ? undefined : true}
        aria-label="Compose email"
      >
        <h2>{sent ? "Email sent" : "Compose email"}</h2>
        <p>To: {client.email}</p>
        <p>From: {from ?? "Connect Gmail"}</p>
        {sent ? (
          <p>
            Gmail accepted your email. It appears in Gmail Sent; delivery is not
            confirmed here.
          </p>
        ) : (
          <>
            {!canSend && (
              <>
                <p>Allow Gmail sending to send email from WolfGrid.</p>
                <button type="button" onClick={onConnect}>
                  Connect Gmail sending
                </button>
              </>
            )}
            <label>
              Subject
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={200}
                required
                disabled={busy || attempted}
              />
            </label>
            <label>
              Message
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={100000}
                rows={9}
                required
                disabled={busy || attempted}
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button
              className="primary"
              disabled={
                !canSend || busy || attempted || !subject.trim() || !body.trim()
              }
            >
              {busy ? "Sending…" : "Send email"}
            </button>
          </>
        )}
        <button type="button" disabled={busy} onClick={onClose}>
          {sent ? "Done" : "Close"}
        </button>
      </form>
    </div>
  );
}
