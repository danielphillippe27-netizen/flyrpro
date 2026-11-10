"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { emailTemplatesRequest, type EmailTemplate } from "@/lib/coco/email-templates";

export function EmailTemplatesSettings({ userId }: { userId: string }) {
  const [templates, setTemplates] = useState<EmailTemplate[]>();
  const [draft, setDraft] = useState<EmailTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    emailTemplatesRequest(userId, undefined, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setTemplates(result.templates ?? []);
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [userId, loadVersion]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    const template = { id: draft.id, name: draft.name.trim(), subject: draft.subject.trim(), body: draft.body.trim() };
    setBusy(true);
    setError("");
    try {
      await emailTemplatesRequest(userId, { action: "save", template });
      setTemplates(current => [...(current ?? []).filter(item => item.id !== template.id), template]
        .sort((a, b) => a.name.localeCompare(b.name)));
      setDraft(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the template.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(template: EmailTemplate) {
    setBusy(true);
    setError("");
    try {
      await emailTemplatesRequest(userId, { action: "delete", id: template.id });
      setTemplates(current => current?.filter(item => item.id !== template.id));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not remove the template.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal email templates</CardTitle>
        <CardDescription>Use saved drafts from the Templates button when emailing a contact.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {templates === undefined ? (
          error ? <Button variant="outline" onClick={() => { setError(""); setLoadVersion(value => value + 1); }}>Retry</Button>
            : <p role="status" className="text-sm text-muted-foreground">Loading templates…</p>
        ) : (
          <>
            {templates.length ? (
              <ul className="divide-y divide-border">
                {templates.map(template => (
                  <li key={template.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0 break-words">
                      <p className="font-medium">{template.name}</p>
                      <p className="text-sm text-muted-foreground">{template.subject}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={busy || draft !== null}
                        onClick={() => { setError(""); setDraft(template); }} aria-label={`Edit ${template.name}`}>Edit</Button>
                      <Button size="sm" variant="ghost" disabled={busy || draft !== null}
                        onClick={() => void remove(template)} aria-label={`Remove ${template.name}`}>Remove</Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No personal templates yet.</p>}

            {draft ? (
              <form className="space-y-3" onSubmit={save}>
                <label className="block space-y-1 text-sm">
                  <span>Template name</span>
                  <Input required maxLength={100} value={draft.name} disabled={busy}
                    onChange={event => setDraft({ ...draft, name: event.target.value })} />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Subject</span>
                  <Input required maxLength={200} value={draft.subject} disabled={busy}
                    onChange={event => setDraft({ ...draft, subject: event.target.value })} />
                </label>
                <div className="space-y-1 text-sm">
                  <label htmlFor="email-template-body">Message</label>
                  <Textarea id="email-template-body" required rows={6} maxLength={10000} value={draft.body} disabled={busy}
                    onChange={event => setDraft({ ...draft, body: event.target.value })} />
                </div>
                <p className="text-xs text-muted-foreground">Use <code>{"{first_name}"}</code> to insert the contact’s first name.</p>
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy || !draft.name.trim() || !draft.subject.trim() || !draft.body.trim()}>
                    {busy ? "Saving…" : "Save template"}
                  </Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>Cancel</Button>
                </div>
              </form>
            ) : (
              <Button disabled={busy} onClick={() => {
                setError("");
                setDraft({ id: crypto.randomUUID(), name: "", subject: "", body: "" });
              }}>New template</Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
