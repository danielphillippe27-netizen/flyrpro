"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, Clock3, Mail, MapPin, MessageCircle, Phone, Plus, StickyNote } from "lucide-react";
import type { Client, Task } from "@/lib/coco/types";
import { macIdentifier } from "@/lib/mac-companion/identifiers";
import { hasMacBridge, macNative } from "@/lib/mac-companion/client";
import { CommunicationStats, type CommunicationTotals } from "./CommunicationStats";
import { EmailComposer } from "./EmailComposer";
import { latestMacCall, useMacCallHistory } from "./MacCallHistory";
import "./contact-workspace.css";

type Category = "all" | "messages" | "emails" | "calls" | "notes" | "field";
type Event = { property_id?: string; id: string; kind: Category; at: string; title: string; body?: string; actor_id?: string; edit_id?: string; provider_ref?: string; reply_id?: string; subject?: string; thread_ref?: string; thread_key?: string; thread_count?: number };
type Workspace = {
  events: Event[];
  communication_stats?: CommunicationTotals;
  properties: { id: string; address: string }[];
  assignees?: { id: string; name: string }[];
  relationships: { id: string; name: string; label: string }[];
  profile: { source?: string; company?: string; job_title?: string; contact_type?: string; assigned_rep_id?: string; tags?: string; do_not_contact?: boolean; call_sync_enabled?: boolean; appointment_at?: string; appointment_title?: string; appointment_location?: string };
};
type Composer = "note" | "text" | "email" | "call";
const composerLabel = { text: "Message", call: "Call", email: "Email", note: "Notes" };
const eventIcon = { all: Clock3, messages: MessageCircle, emails: Mail, calls: Phone, notes: StickyNote, field: MapPin };
const formatDate = (raw?: string | null) => raw ? new Date(raw).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
const localInput = (raw?: string) => {
  if (!raw) return "";
  const date = new Date(raw);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const errorText = (error: unknown) => error instanceof Error ? error.message : "Try again.";

export function ContactWorkspace({
  client, contacts, userId, tasks, identity, profile, customFields, email, syncEnabled, onAddTask, onToggleTask, noteDrafts, onSaved, onOpenMessages,
}: {
  client: Client;
  contacts: Client[];
  userId: string;
  tasks: Task[];
  noteDrafts: Map<string, string>;
  identity: ReactNode;
  profile: ReactNode;
  customFields: ReactNode;
  email: { enabled: boolean; from: string | null };
  syncEnabled: boolean;
  onAddTask: () => void;
  onSaved: () => Promise<void>;
  onOpenMessages?: () => void;
  onToggleTask: (task: Task) => Promise<void>;
}) {
  const workspaceId = client.workspace_id;
  const contactId = client.id;
  const [data, setData] = useState<Workspace | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState("");
  const [composer, setComposer] = useState<Composer | null>(() => noteDrafts.has(contactId) ? "note" : null);
  const [note, setNote] = useState(() => noteDrafts.get(contactId) ?? "");
  const [noteProperty, setNoteProperty] = useState("");
  const updateNote = (value: string) => {
    if (value) noteDrafts.set(contactId, value);
    else noteDrafts.delete(contactId);
    setNote(value);
  };
  const [editing, setEditing] = useState<Event | null>(null);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<{ id: string; subject: string }>();
  const [emailRevision, setEmailRevision] = useState(0);
  const [emailRevoked, setEmailRevoked] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [outcome, setOutcome] = useState("Reached");
  const [callNote, setCallNote] = useState("");
  const [native, setNative] = useState<{ messagesAllowed?: boolean; phoneHandoff?: boolean } | null>(null);
  const [recipient, setRecipient] = useState("");
  const [dialerEnabled, setDialerEnabled] = useState(false);
  const [messageAllowed, setMessageAllowed] = useState(false);
  const [related, setRelated] = useState("");
  const [relationshipLabel, setRelationshipLabel] = useState("");
  const [appointmentEdit, setAppointmentEdit] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [extraIdentifier, setExtraIdentifier] = useState("");
  const additional = client.identifiers?.filter(value => value !== macIdentifier(client.phone) && value !== macIdentifier(client.email)) ?? [];
  const lock = useRef(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const revision = useRef(0);
  const earlierLoaded = useRef(false);
  const olderCursor = useRef<Event | undefined>(undefined);
  const importedCalls = useRef("");
  const calls = useMacCallHistory(userId, workspaceId, contactId);

  const canText = Boolean(data && native?.messagesAllowed && syncEnabled && messageAllowed && recipient && !data.profile.do_not_contact);
  const canEmail = Boolean(data && email.enabled && !emailRevoked && client.email && !data.profile.do_not_contact);
  const canCallOnMac = Boolean(native?.phoneHandoff && recipient.startsWith("+"));
  const canCall = Boolean(data && (canCallOnMac || dialerEnabled) && !data.profile.do_not_contact);
  const enabled = { note: true, text: canText, email: canEmail, call: canCall };
  const active = composer;
  const appointmentAt = data ? data.profile.appointment_at : client.appointment_at;

  const request = useCallback(async <T,>(params: Record<string, string> = {}, payload?: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
    const query = new URLSearchParams({ workspaceId, contactId, ...params });
    const response = await fetch(`/api/coco/contact-workspace?${query}`, {
      signal, cache: "no-store",
      headers: { "x-wolfgrid-user-id": userId, ...(payload ? { "content-type": "application/json" } : {}) },
      ...(payload ? { method: "POST", body: JSON.stringify({ workspaceId, contactId, ...payload }) } : {}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Contact activity is unavailable.");
    return result;
  }, [userId, workspaceId, contactId]);

  const load = useCallback(async (cursor?: Event, signal?: AbortSignal, refresh = false) => {
    const token = ++revision.current;
    try {
      const page = await request<Workspace>({ category: "communications", ...(cursor ? { beforeAt: cursor.at, beforeKey: cursor.id } : {}) }, undefined, signal);
      if (signal?.aborted || token !== revision.current) return;
      setData(page);
      setLoadError("");
      if (cursor) earlierLoaded.current = true;
      if (!refresh || !earlierLoaded.current) setMore(page.events.length > 30);
      const slice = page.events.slice(0, 30);
      if (!refresh || !earlierLoaded.current) olderCursor.current = slice.at(-1);
      setEvents(current => cursor || refresh && earlierLoaded.current ? [...new Map([...current, ...slice].map(event => [event.id, event])).values()] : slice);
    } catch (error) {
      if (!signal?.aborted && token === revision.current) setLoadError(errorText(error));
    }
  }, [request]);

  useEffect(() => {
    const controller = new AbortController();
    earlierLoaded.current = false;
    olderCursor.current = undefined;
    void load(undefined, controller.signal);
    const update = () => { if (!document.hidden && !lock.current) void load(undefined, controller.signal, true); };
    window.addEventListener("focus", update);
    const interval = window.setInterval(update, 20_000);
    return () => { controller.abort(); window.removeEventListener("focus", update); window.clearInterval(interval); };
  }, [load]);
  useEffect(() => {
    if (!hasMacBridge()) return;
    const controller = new AbortController();
    const headers = { "x-wolfgrid-user-id": userId };
    const scoped = new URLSearchParams({ workspaceId, contactId });
    const check = async () => {
      const [capabilities, target, messages] = await Promise.all([
        macNative<{ messagesAllowed?: boolean; phoneHandoff?: boolean }>("status").catch(() => null),
        fetch(`/api/coco/recipient?${scoped}`, { headers, signal: controller.signal, cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/mac-companion?${scoped}`, { headers, signal: controller.signal, cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (controller.signal.aborted) return;
      setNative(capabilities);
      setRecipient(typeof target?.identifier === "string" ? target.identifier : "");
      setMessageAllowed(Boolean(messages?.permission));
    };
    void check();
    window.addEventListener("focus", check);
    const interval = window.setInterval(() => { if (!document.hidden) void check(); }, 45_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      void macNative("message-clear-attachments", { userId, workspaceId }).catch(() => {});
    };
  }, [contactId, userId, workspaceId]);

  useEffect(() => {
    if (!client.phone) return;
    const controller = new AbortController();
    const check = () => fetch(`/api/dialer/settings?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then(state => {
        if (controller.signal.aborted) return;
        setDialerEnabled(Boolean(state?.role === "member" && state?.salesperson?.id && state?.featureEnabled && state?.addon?.isActive &&
          state?.settings?.defaultFromNumber && (state?.settings?.dedicatedFromNumber || state?.sharedDefaultDialingEnabled)));
      }).catch(() => { if (!controller.signal.aborted) setDialerEnabled(false); });
    void check();
    window.addEventListener("focus", check);
    return () => { controller.abort(); window.removeEventListener("focus", check); };
  }, [client.phone, workspaceId]);


  async function act(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setStatus("");
    try { await fn(); } catch (error) { setStatus(errorText(error)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function save(payload: Record<string, unknown>, success: string) {
    await request({}, payload);
    setStatus(success);
    await load();
  }
  function requestId(action: string, content: string) {
    const key = action + ":" + content;
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    return attempt.current.id;
  }
  const callSyncEnabled = data?.profile.call_sync_enabled === true;
  useEffect(() => {
    if (!callSyncEnabled) { importedCalls.current = ""; return; }
    const batch = (calls?.calls ?? []).flatMap(({ providerId, direction, kind, durationSeconds, startedAt }) =>
      providerId ? [{ providerId, direction, kind, durationSeconds, startedAt }] : []);
    const signature = batch.map(call => call.providerId).join(":");
    if (!signature || importedCalls.current === signature) return;
    const controller = new AbortController();
    request({}, { action: "import-calls", calls: batch }, controller.signal).then(() => {
      if (!controller.signal.aborted) { importedCalls.current = signature; void load(); }
    }).catch(error => { if (!controller.signal.aborted) setStatus(errorText(error)); });
    return () => controller.abort();
  }, [callSyncEnabled, calls, request, load]);

  const syncedCalls = new Set(events.filter(event => event.id.startsWith("apple-call:")).map(event => event.provider_ref));
  const localCalls: Event[] = (calls?.calls ?? []).filter(call => !call.providerId || !syncedCalls.has(call.providerId)).map((call, index) => ({
    id: `mac:${call.startedAt}:${index}`, kind: "calls", at: call.startedAt,
    title: `${call.direction === "incoming" ? "Incoming" : "Outgoing"} ${call.kind} · ${call.connected ? "Connected" : "No duration recorded"}`,
    body: call.durationSeconds > 0 ? `${Math.floor(call.durationSeconds / 60)}m ${Math.round(call.durationSeconds) % 60}s · Apple call history on this Mac` : "Apple call history on this Mac",
  }));
  const visible = [...events.filter(event => event.kind !== "field"), ...localCalls].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
  const recentCall = latestMacCall(calls);

  const threads = new Map<string, Event>();
  for (const event of visible) {
    // The server already returns one row per provider thread. This also handles older activity responses.
    const key = event.thread_key ?? (event.kind === "emails" && event.thread_ref ? `gmail:${event.thread_ref}`
      : event.id.startsWith("message:") ? "apple-messages"
      : event.id.startsWith("dialer-sms:") || event.id.startsWith("dialer-inbound:") ? "dialer-texts"
      : event.id);
    const saved = threads.get(key);
    if (!saved) threads.set(key, event);
    else if (!event.thread_count && !saved.thread_key) threads.set(key, {
      ...saved, thread_count: (saved.thread_count ?? 1) + 1, reply_id: saved.reply_id ?? event.reply_id,
    });
  }

  function renderActivity() {
    return <ol className="contact-timeline">
      {Array.from(threads, ([key, event]) => {
        const Icon = eventIcon[event.kind];
        const isThread = event.kind === "messages" || event.kind === "emails";
        const title = key === "apple-messages" ? `Texts with ${client.first_name}`
          : key === "dialer-texts" ? "WolfGrid Dialer texts"
          : event.kind === "emails" ? event.subject?.replace(/^re:\s*/i, "") || "Email thread" : event.title;
        const snippet = isThread && event.subject && event.body?.startsWith(event.subject)
          ? event.body.slice(event.subject.length).trim() : event.body;
        return <li key={key} className={isThread ? "contact-thread-preview" : undefined}>
          <Icon size={15} aria-hidden="true" />
          <div className="contact-activity-content">
            <strong>{title}</strong>
            {isThread && <small className="contact-muted"> · {event.thread_count ?? 1} {(event.thread_count ?? 1) === 1 ? "message" : "messages"}</small>}
            {snippet && <p>{isThread ? snippet.replace(/\s+/g, " ").trim().slice(0, 140) : snippet}</p>}
            {event.kind === "notes" && event.property_id && <p className="contact-muted">{data?.properties.find(property => property.id === event.property_id)?.address}</p>}
            {event.kind === "notes" && event.actor_id === userId && <span className="contact-muted">You</span>}
            {key === "apple-messages" && onOpenMessages && <button type="button" onClick={onOpenMessages}>Open in Messages</button>}
            {event.reply_id && canEmail && <button type="button" onClick={() => {
              setReply({ id: event.reply_id!, subject: event.subject ?? "" });
              setEmailRevision(n => n + 1); setComposer("email");
            }}>Reply</button>}
            {event.edit_id && <button type="button" onClick={() => {
              if (note.trim() && !editing) { setStatus("Save or clear your current note before editing another."); return; }
              setEditing(event); setNote(event.body ?? ""); setComposer("note");
            }}>Edit note</button>}
          </div>
          <time dateTime={event.at}>{formatDate(event.at)}</time>
        </li>;
      })}
    </ol>;
  }

  return <div className="contact-workbench">
    <aside className="contact-workbench-profile" aria-label="Contact profile">
      <div className="workbench-identity-header">{identity}</div>
    <div className="contact-workbench-context" aria-label="Follow-up and appointments">
      <section><div className="contact-workbench-heading"><h2>Follow-up</h2><button type="button" onClick={onAddTask}><Plus size={14} /> Add task</button></div>
        {client.next_follow_up_at && <p className="contact-muted">Next: {formatDate(client.next_follow_up_at)}</p>}
        {!tasks.length && <p className="contact-muted">No tasks yet.</p>}
        {[...tasks].sort((a, b) => Number(Boolean(a.completed_at)) - Number(Boolean(b.completed_at)) || (a.due_at ?? "z").localeCompare(b.due_at ?? "z")).map(task =>
          <button key={task.id} type="button" className="contact-task" onClick={() => void act(async () => { await onToggleTask(task); await load(); })} disabled={busy}>
            {task.completed_at ? <CheckCircle2 size={16} /> : <Circle size={16} />}<span>{task.title}<small>{task.completed_at ? "Completed" : task.due_at ? `${Date.parse(task.due_at) < Date.now() ? "Overdue · " : ""}${formatDate(task.due_at)}` : "No due date"}</small></span>
          </button>)}
      </section>
      <section>
        <div className="contact-workbench-heading">
          <h2>Appointments</h2>
          {data && !appointmentEdit && <button type="button" onClick={() => setAppointmentEdit(true)}>
            {appointmentAt ? "Edit appointment" : <><Plus size={14} /> Add appointment</>}
          </button>}
        </div>
        <p className="contact-muted">{formatDate(appointmentAt) || "No appointment scheduled"}</p>
        {data?.profile.appointment_title && <p>{data.profile.appointment_title}</p>}
        {data?.profile.appointment_location && <p>{data.profile.appointment_location}</p>}
        {appointmentEdit && <form onSubmit={event => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          void act(async () => {
            const raw = String(fields.get("at") || "");
            await save({ action: "appointment", at: raw ? new Date(raw).toISOString() : null, title: String(fields.get("title") || ""), location: String(fields.get("location") || "") }, "Appointment saved.");
            setAppointmentEdit(false);
          });
        }}>
          <label>Date and time<input name="at" type="datetime-local" defaultValue={localInput(data?.profile.appointment_at)} /></label>
          <label>Title<input name="title" maxLength={200} defaultValue={data?.profile.appointment_title} /></label>
          <label>Location<input name="location" maxLength={500} defaultValue={data?.profile.appointment_location} /></label>
          <button className="primary" disabled={busy}>Save appointment</button>
          <button type="button" onClick={() => setAppointmentEdit(false)}>Cancel</button>
        </form>}
      </section>
    </div>
      {profile}
      {data?.profile.source && <p className="contact-muted">Lead source: {data.profile.source}</p>}
      {data?.profile.contact_type && <p className="contact-muted">Contact type: {data.profile.contact_type}</p>}
      {data?.profile.company && <p className="contact-muted">{[data.profile.job_title, data.profile.company].filter(Boolean).join(" · ")}</p>}
      <p className="contact-muted">Contact owner: You</p>
      {data?.profile.assigned_rep_id && <p className="contact-muted">Assigned to: {data.assignees?.find(rep => rep.id === data.profile.assigned_rep_id)?.name ?? "Workspace representative"}</p>}
      {data && <details open={metadataOpen} onToggle={event => setMetadataOpen(event.currentTarget.open)}>
        <summary>Profile and additional numbers</summary>
        {metadataOpen && <form onSubmit={event => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          void act(async () => {
            await save({ action: "profile", source: fields.get("source"), company: fields.get("company"), jobTitle: fields.get("jobTitle"), contactType: fields.get("contactType"), assignedRepId: fields.get("assignedRepId") || null }, "Profile saved.");
            await onSaved();
          });
        }}>
          <label>Lead source<input name="source" maxLength={120} defaultValue={data.profile.source} /></label>
          <label>Contact type<input name="contactType" maxLength={80} defaultValue={data.profile.contact_type} /></label>
          <label>Company<input name="company" maxLength={160} defaultValue={data.profile.company} /></label>
          <label>Job title<input name="jobTitle" maxLength={120} defaultValue={data.profile.job_title} /></label>
          <label>Assigned representative<select name="assignedRepId" defaultValue={data.profile.assigned_rep_id ?? ""}>
            <option value="">Contact owner</option>
            {data.assignees?.map(rep => <option key={rep.id} value={rep.id}>{rep.name}</option>)}
          </select></label>
          <button className="primary" disabled={busy}>Save profile</button>
        </form>}
        {metadataOpen && <>
          {additional.map(value => <p key={value}>{value} <button type="button" disabled={busy} onClick={() => void act(async () => {
            await save({ action: "remove-identifier", identifier: value }, "Contact method removed.");
            await onSaved();
          })}>Remove</button></p>)}
          <form onSubmit={event => {
            event.preventDefault();
            void act(async () => {
              await save({ action: "add-identifier", identifier: extraIdentifier }, "Contact method added.");
              setExtraIdentifier(""); await onSaved();
            });
          }}>
            <label>Additional phone or email<input value={extraIdentifier} onChange={event => setExtraIdentifier(event.target.value)} maxLength={254} /></label>
            <button type="submit" disabled={busy || !macIdentifier(extraIdentifier)}>Add contact method</button>
          </form>
        </>}
      </details>}
      {data?.profile.tags && <p className="contact-muted">Tags: {data.profile.tags}</p>}
      {data?.profile.do_not_contact && <p role="status">Do not contact</p>}
    <div className="contact-workbench-context">      <details><summary>Relationships</summary>
        {data?.relationships.map(item => <p key={item.id}>{item.name} · {item.label} <button type="button" disabled={busy} onClick={() => void act(() => save({ action: "unlink-contact", relatedId: item.id }, "Relationship removed."))}>Remove</button></p>)}
        {data && <form onSubmit={event => {
          event.preventDefault();
          void act(async () => {
            await save({ action: "link-contact", relatedId: related, label: relationshipLabel }, "Relationship saved.");
            setRelated(""); setRelationshipLabel("");
          });
        }}>
          <label>Related contact<select value={related} onChange={e => setRelated(e.target.value)} required><option value="">Choose contact</option>{contacts.filter(item => item.id !== contactId).map(item => <option value={item.id} key={item.id}>{item.first_name} {item.last_name}</option>)}</select></label>
          <label>Relationship<input value={relationshipLabel} onChange={e => setRelationshipLabel(e.target.value)} maxLength={80} placeholder="e.g. Co-owner" required /></label>
          <button disabled={busy || !related || !relationshipLabel.trim()}>Save relationship</button>
        </form>}
      </details>
      <details><summary>Custom fields</summary>{customFields}</details>
    </div>
    </aside>
    <section className="contact-workbench-hub" aria-label="Contact communications and activity">
      <div className="contact-workbench-compose">
        <div className="contact-communications-header">
          <div>
            <h2>Communications</h2>
            <div className="contact-workbench-switcher" role="group" aria-label="Compose">
              {(Object.keys(composerLabel) as Composer[]).map(tab =>
                <button type="button" key={tab} aria-pressed={active === tab} onClick={() => setComposer(current => current === tab ? null : tab)}>{composerLabel[tab]}</button>)}
            </div>
          </div>
          <div className="contact-communications-summary">
            <CommunicationStats totals={data?.communication_stats} calls={calls?.calls ?? []} />
            {recentCall && <p className="contact-muted">{recentCall}</p>}
          </div>
        </div>
        {active === "note" && <form onSubmit={event => {
          event.preventDefault();
          void act(async () => {
            await save(editing ? { action: "edit-note", eventId: editing.edit_id, previous: editing.body, body: note } : { action: "note", requestId: requestId("note", JSON.stringify([note, noteProperty])), body: note, addressId: noteProperty || null }, editing ? "Note updated." : "Note saved.");
            updateNote(""); setNoteProperty(""); setEditing(null); attempt.current = null;
          });
        }}>
          <label>{editing ? "Edit timeline note" : "New note"}<textarea rows={3} value={note} maxLength={10_000} required onChange={e => { setComposer("note"); if (editing) setNote(e.target.value); else updateNote(e.target.value); }} placeholder="What should you remember about this contact?" /></label>
          {!editing && Boolean(data?.properties.length) && <label>About property<select value={noteProperty} onChange={e => setNoteProperty(e.target.value)}>
            <option value="">Contact only</option>
            {data?.properties.map(property => <option key={property.id} value={property.id}>{property.address}</option>)}
          </select></label>}
          <button className="primary" disabled={busy || !note.trim()}>Save note</button>
          {editing && <button type="button" onClick={() => { setNote(""); setEditing(null); }}>Cancel edit</button>}
        </form>}
        {active === "text" && canText && <form className="contact-quick-text" onSubmit={event => {
          event.preventDefault();
          if (!canText) return;
          void act(async () => {
            const result = await macNative<{ accepted: boolean }>("contact-message-send", {
              userId, workspaceId, contactId, body: text, requestId: requestId("text", JSON.stringify([text, files])),
            });
            if (result.accepted) {
              setText(""); setFiles([]); attempt.current = null;
              setStatus("Submitted to Apple Messages. It will appear here after sync.");
              void macNative("sync-now").then(() => window.setTimeout(() => void load(), 5_000)).catch(() => {});
            }
          });
        }}>
          <p className="contact-muted">To {recipient} · Apple Messages</p>
          <label><textarea aria-label="Text message" rows={2} placeholder="Write a text…" value={text} maxLength={10_000} onChange={e => setText(e.target.value)} /></label>
          <div className="contact-compose-actions">
            <button type="button" disabled={busy} onClick={() => void act(async () => {
              const result = await macNative<{ names: string[] }>("message-attachments", { userId, workspaceId, contactId });
              setFiles(result.names);
            })}>Attach</button>
            {files.length > 0 && <span className="contact-muted">{files.join(", ")}</span>}
            <button className="primary" disabled={busy || (!text.trim() && !files.length)}>{busy ? "Sending…" : "Send text"}</button>
          </div>
        </form>}
        {canEmail && <div hidden={active !== "email"}><EmailComposer key={emailRevision} inline advanced templateUserId={userId} reply={reply} client={client} workspaceId={workspaceId} from={email.from} canSend={canEmail}
          onConnect={() => {}} onReconnectNeeded={() => { setEmailRevoked(true); setStatus("Reconnect Gmail before sending."); }} onClose={() => { setReply(undefined); setEmailRevision(n => n + 1); setComposer(null); }} onSent={() => void load()} /></div>}
        {active === "call" && canCall && <form onSubmit={event => {
          event.preventDefault();
          void act(async () => {
            await save({ action: "call", requestId: requestId("call", JSON.stringify([outcome, callNote])), outcome, body: callNote }, "Call outcome saved.");
            setCallNote(""); attempt.current = null;
          });
        }}>
          {canCallOnMac && <><button type="button" disabled={busy} onClick={() => void act(async () => {
            await macNative("contact-phone-call", { userId, workspaceId, contactId, contactName: `${client.first_name} ${client.last_name}` });
          })}>Call {recipient}</button>
          <p className="contact-muted">Opens Apple calling. Your Mac must be set up to place the call.</p></>}
          {dialerEnabled && <Link href={`/dialer?${new URLSearchParams({ workspaceId, leadIds: contactId, listName: client.first_name })}`}>Open in WolfGrid Dialer</Link>}
          <details className="contact-call-outcome"><summary>Log an outcome</summary>
          <label>Call outcome<select value={outcome} onChange={e => setOutcome(e.target.value)}>{["Reached", "Left voicemail", "No answer", "Wrong number", "Other"].map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Call notes<textarea rows={2} value={callNote} maxLength={10_000} onChange={e => setCallNote(e.target.value)} /></label>
          <button className="primary" disabled={busy}>Log call outcome</button>
          </details>
        </form>}
        {active && !enabled[active] && <div className="contact-workbench-links">
          <p className="contact-muted">{data?.profile.do_not_contact ? "This person is marked Do not contact."
            : active === "text" ? "Connect Apple Messages on the Mac and allow texting for this contact."
            : active === "call" ? client.phone ? "Connect Apple calling on the Mac or set up WolfGrid Dialer." : "Add a phone number to call this contact."
            : emailRevoked ? "Reconnect Gmail to send email." : "Connect Gmail to send email from this contact."}</p>
          {!data?.profile.do_not_contact && <Link className="contact-muted" href={native && active !== "email" ? "/settings/integrations/apple" : "/settings/integrations"}>
            {active === "email" ? emailRevoked ? "Reconnect Gmail" : "Connect Gmail" : "Communication settings"}
          </Link>}
          {!native && active !== "email" && /^https:\/\//.test(process.env.NEXT_PUBLIC_WOLFGRID_MAC_DOWNLOAD_URL ?? "") &&
            <a className="contact-muted" href={process.env.NEXT_PUBLIC_WOLFGRID_MAC_DOWNLOAD_URL}>Get WolfGrid for Mac</a>}
        </div>}
        {active === "call" && calls && data && <details className="contact-call-settings">
          <summary>Apple call history</summary>
          {calls.status === "unavailable" && <p className="contact-muted">Check WolfGrid’s Full Disk Access and the Phone or FaceTime history on this Mac.</p>}
          {calls.status === "unmatched" && <p className="contact-muted">Add a phone number or email that belongs only to this contact.</p>}
          <label><input type="checkbox" checked={callSyncEnabled} disabled={busy} onChange={event => {
            const enabled = event.target.checked;
            void act(() => save({ action: "call-sync", enabled }, enabled ? "Call sync enabled for this contact." : "Call sync paused. Saved calls are kept."));
          }} /> Sync this contact’s Apple calls to my CRM</label>
          <p className="contact-muted">Shares call dates, direction and duration with your signed-in WolfGrid account. Records already saved remain in your activity when paused.</p>
        </details>}
        {status && <p className="contact-muted" role="status">{status}</p>}
      </div>
      <div className="contact-workbench-history">
        <h2>Recent threads</h2>
        {loadError ? <p role="alert">{loadError} <button type="button" onClick={() => void load()}>Retry</button></p>
          : !data ? <p role="status">Loading contact activity…</p>
          : !visible.length && <p className="contact-muted">No activity in this view yet.</p>}
        {renderActivity()}
        {more && <button type="button" disabled={busy} onClick={() => void act(async () => { await load(olderCursor.current); })}>Load earlier threads</button>}
      </div>
    </section>

  </div>;
}
