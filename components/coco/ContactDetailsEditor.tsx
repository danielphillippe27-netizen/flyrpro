"use client";
import { useState } from "react";
import { cocoApi } from "@/lib/coco/client";
import type { Client } from "@/lib/coco/types";

function localDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function fields(client: Client) {
  return {
    first_name: client.first_name,
    last_name: client.last_name,
    phone: client.phone ?? "",
    email: client.email ?? "",
    address: client.address ?? "",
    notes: client.notes ?? "",
    last_contacted_at: localDate(client.last_contacted_at),
    next_follow_up_at: localDate(client.next_follow_up_at),
  };
}

export function ContactDetailsEditor({
  client,
  userId,
  onSaved,
}: {
  client: Client;
  userId: string;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => fields(client));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [baseline, setBaseline] = useState(() => fields(client));
  const [source, setSource] = useState(client);
  const [version, setVersion] = useState(client.updated_at);
  const dirty = Object.keys(draft).some(
    (key) =>
      draft[key as keyof typeof draft] !== baseline[key as keyof typeof draft],
  );
  const change = (key: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setMessage("");
    try {
      const empty = (value: string) => value.trim() || null;
      const date = (key: "last_contacted_at" | "next_follow_up_at") =>
        draft[key] === localDate(source[key])
          ? source[key]
          : draft[key]
            ? new Date(draft[key]).toISOString()
            : null;
      const payload = {
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        phone: empty(draft.phone),
        email: empty(draft.email),
        address: empty(draft.address),
        notes: draft.notes || null,
        last_contacted_at: date("last_contacted_at"),
        next_follow_up_at: date("next_follow_up_at"),
      };
      const data = await cocoApi<{ updated_at: string }>(
        userId,
        client.workspace_id,
        "update",
        { id: client.id, updated_at: version, ...payload },
      );
      const saved = {
        ...client,
        ...payload,
        updated_at: data.updated_at,
      } as Client;
      setDraft(fields(saved));
      setBaseline(fields(saved));
      setVersion(saved.updated_at);
      setSource(saved);
      await onSaved();
      setMessage("Saved");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save contact. Your edits are kept here.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      className="contact-details-editor"
      onSubmit={save}
      aria-label="Edit contact details"
    >
      <dl>
        <dt>
          <label htmlFor="contact-first-name">First name</label>
        </dt>
        <dd>
          <input
            id="contact-first-name"
            value={draft.first_name}
            onChange={(e) => change("first_name", e.target.value)}
            maxLength={100}
            required
            disabled={saving}
          />
        </dd>
        <dt>
          <label htmlFor="contact-last-name">Last name</label>
        </dt>
        <dd>
          <input
            id="contact-last-name"
            value={draft.last_name}
            onChange={(e) => change("last_name", e.target.value)}
            maxLength={100}
            disabled={saving}
          />
        </dd>
        <dt>
          <label htmlFor="contact-phone">Phone</label>
        </dt>
        <dd>
          <input
            id="contact-phone"
            type="tel"
            value={draft.phone}
            onChange={(e) => change("phone", e.target.value)}
            maxLength={80}
            placeholder="Add phone number"
            disabled={saving}
          />
        </dd>
        <dt>
          <label htmlFor="contact-email">Email</label>
        </dt>
        <dd>
          <input
            id="contact-email"
            type="email"
            value={draft.email}
            onChange={(e) => change("email", e.target.value)}
            maxLength={254}
            placeholder="Add email address"
            disabled={saving}
          />
        </dd>
        <dt>
          <label htmlFor="contact-address">Address</label>
        </dt>
        <dd>
          <input
            id="contact-address"
            value={draft.address}
            onChange={(e) => change("address", e.target.value)}
            maxLength={500}
            placeholder="Add address"
            disabled={saving}
          />
        </dd>
        <dt>
          <label htmlFor="contact-last-date">Last contact</label>
        </dt>
        <dd>
          <input
            id="contact-last-date"
            type="datetime-local"
            value={draft.last_contacted_at}
            onChange={(e) => change("last_contacted_at", e.target.value)}
            disabled={saving}
          />
        </dd>
        <dt>
          <label htmlFor="contact-followup">Next follow-up</label>
        </dt>
        <dd>
          <input
            id="contact-followup"
            type="datetime-local"
            value={draft.next_follow_up_at}
            onChange={(e) => change("next_follow_up_at", e.target.value)}
            disabled={saving}
          />
        </dd>
      </dl>
      <label htmlFor="contact-notes">Notes</label>
      <textarea
        id="contact-notes"
        value={draft.notes}
        onChange={(e) => change("notes", e.target.value)}
        maxLength={10000}
        rows={4}
        placeholder="Add notes"
        disabled={saving}
      />
      <div className="contact-editor-actions">
        <button
          className="primary"
          disabled={saving || !dirty || !draft.first_name.trim()}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setDraft(fields(client));
            setBaseline(fields(client));
            setVersion(client.updated_at);
            setSource(client);
            setMessage("");
          }}
        >
          Cancel
        </button>
        <span role="status">{message || (dirty ? "Unsaved changes" : "")}</span>
      </div>
    </form>
  );
}
