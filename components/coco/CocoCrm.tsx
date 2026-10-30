"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Inbox,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  PanelLeft,
  Video,
  Plus,
  Search,
  Send,
  Settings2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace-context";
import { useCrmScope } from "@/components/crm-ai/useCrmScope";
import { openCrmAssistant } from "@/components/crm-ai/CrmAssistant";
import {
  hasMacBridge,
  macNative,
  macApi,
  type MacStatus,
} from "@/lib/mac-companion/client";
import { cocoApi, loadCoco } from "@/lib/coco/client";
import {
  contactLabels,
  stages,
  emptyData,
  type Client,
  type Task,
  type Message,
  type MessageAttachment,
  type Conversation,
  type ContactLabel,
} from "@/lib/coco/types";
import { ContactDetailsEditor } from "./ContactDetailsEditor";
import { EmailComposer } from "./EmailComposer";
import { GmailClientImport } from "./GmailClientImport";
import { AppleContactsReview } from "./AppleContactsReview";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import "./coco.css";
const replyTemplates = [
  { title: "Quick follow-up", body: "Hi {first_name}, just following up on our conversation. What would be a good next step for you?" },
  { title: "Schedule a call", body: "Hi {first_name}, when would be a good time for a quick call?" },
  { title: "Check in", body: "Hi {first_name}, how have things been going? Let me know if there’s anything I can help with." },
  { title: "Thank you", body: "Thanks, {first_name}! I appreciate your time. Let me know if you have any questions." },
];
type Area = "Inbox" | "Clients";
type GmailStatus = {
  connected: boolean;
  configured: boolean;
  can_send: boolean;
  can_read: boolean;
  email: string | null;
};
const displayName = (client?: Client) =>
  client ? `${client.first_name} ${client.last_name}`.trim() : "Unknown client";
const initials = (name: string) =>
  name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
const formatShort = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-CA", {
        month: "short",
        day: "numeric",
      }).format(new Date(value))
    : "—";
const formatTime = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-CA", {
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "";
function Avatar({
  name,
  size = "normal",
}: {
  name: string;
  size?: "normal" | "large";
}) {
  return (
    <span
      className={`avatar ${size === "large" ? "avatar-large" : ""}`}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
function ContactContext({ client }: { client: Client }) {
  return (
    <section className="surface">
      <div className="surface-header">
        <h2>WolfGrid</h2>
      </div>
      {client.appointment_at && (
        <div className="mini-message">
          <strong>Appointment</strong>
          <p>{new Date(client.appointment_at).toLocaleString()}</p>
        </div>
      )}
      <div className="mini-message">
        <Link href={`/leads/${client.id}`} className="coco-record-link">
          Open full WolfGrid record <ArrowRight size={14} />
        </Link>
      </div>
    </section>
  );
}
function MessageAttachments({
  messageId,
  attachments,
  userId,
  workspaceId,
}: {
  messageId: string;
  attachments: MessageAttachment[];
  userId: string;
  workspaceId: string;
}) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  async function download(file: MessageAttachment) {
    setBusy(file.guid);
    setError("");
    try {
      const response = await fetch(
        `/api/coco/attachments?workspaceId=${workspaceId}&messageId=${messageId}&guid=${encodeURIComponent(file.guid)}`,
        { headers: { "x-wolfgrid-user-id": userId }, cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      const a = document.createElement("a");
      a.href = data.url;
      a.download = file.fileName;
      a.click();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div>
      {attachments.map((file) => (
        <div key={file.guid}>
          {file.status === "uploaded" ? (
            <button disabled={!!busy} onClick={() => void download(file)}>
              {busy === file.guid ? "Downloading…" : file.fileName}
            </button>
          ) : (
            <small>
              {file.fileName} ·{" "}
              {file.status === "unavailable"
                ? "Not downloaded on Mac"
                : file.status === "too_large"
                  ? "Over 50 MB"
                  : "Not imported"}
            </small>
          )}
        </div>
      ))}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
export default function CocoCrm({
  initialArea = "Inbox",
  initialContact,
  canUseInbox = false,
}: {
  canUseInbox?: boolean;
  initialArea?: Area;
  initialContact?: string;
}) {
  const scope = useCrmScope();
  return scope.userId ? (
    <CocoWorkspace
      key={scope.key}
      userId={scope.userId}
      initialArea={initialArea}
      initialContact={initialContact}
      canUseInbox={canUseInbox}
    />
  ) : (
    <div className="coco-crm">
      <div className="inbox-loading">
        <Loader2 className="animate-spin" size={18} /> Opening your CRM…
      </div>
    </div>
  );
}
function CocoWorkspace({
  userId,
  initialArea,
  initialContact,
  canUseInbox,
}: {
  canUseInbox: boolean;
  userId: string;
  initialArea: Area;
  initialContact?: string;
}) {
  const { currentWorkspaceId } = useWorkspace();
  const workspaceId = currentWorkspaceId ?? "";
  const [area, setArea] = useState<Area>(initialArea),
    [data, setData] = useState(emptyData),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const availableLabels = useMemo(() => Array.from(new Set<string>([...contactLabels, ...data.clients.flatMap(client => client.contact_labels ?? [])])), [data.clients]);
  const [search, setSearch] = useState(""),
    [selectedClient, setSelectedClient] = useState<string | null>(
      initialContact ?? null,
    ),
    [selectedConversation, setSelectedConversation] = useState<string | null>(
      null,
    ),
    [inboxContact, setInboxContact] = useState<Client | null>(null),
    [emailClient, setEmailClient] = useState<Client | null>(null);
  const [contactFilter, setContactFilter] = useState<
      ContactLabel | "All" | "Unlabeled"
    >("All"),
    [stageFilter, setStageFilter] = useState("All"),
    [contactOptions, setContactOptions] = useState<"filter" | "stage" | null>(
      null,
    ),
    [bulkStage, setBulkStage] = useState("Lead"),
    [bulkLabel, setBulkLabel] = useState<ContactLabel>("Client");
  const [contactSelectionMode, setContactSelectionMode] = useState(false),
    [selectedContacts, setSelectedContacts] = useState<string[]>([]),
    [savingLabels, setSavingLabels] = useState(false),
    [savingStage, setSavingStage] = useState(false),
    [applyingBulkLabel, setApplyingBulkLabel] = useState(false),
    [deletingContacts, setDeletingContacts] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false),
    [showAddTask, setShowAddTask] = useState(false),
    [savingNew, setSavingNew] = useState(false),
    [showGmailImport, setShowGmailImport] = useState(false),
    [showAppleImport, setShowAppleImport] = useState(false);
  const [draftSources, setDraftSources] = useState<
    { id: string; label: string; href: string; excerpt: string }[]
  >([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [composer, setComposer] = useState(""),
    [draft, setDraft] = useState(""),
    [aiBusy, setAiBusy] = useState(false),
    [attachmentNames, setAttachmentNames] = useState<string[]>([]),
    [deviceOnline, setDeviceOnline] = useState(false),
    [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null),
    [includeGmail, setIncludeGmail] = useState(false),
    [integrationBusy, setIntegrationBusy] = useState(false);
  const [history, setHistory] = useState<Message[]>([]),
    [detailMessages, setDetailMessages] = useState<Message[]>([]),
    [historyMore, setHistoryMore] = useState(false),
    [historyError, setHistoryError] = useState(""),
    [loadingHistory, setLoadingHistory] = useState(false),
    [sending, setSending] = useState(false);
  const messageScroll = useRef<HTMLDivElement>(null),
    scrollConversation = useRef<string | undefined>(undefined),
    stickToLatest = useRef(true),
    alive = useRef(true),
    refreshVersion = useRef(0);
  const commandLock = useRef(false);
  const sendAttempt = useRef<{ signature: string; id: string } | undefined>(
    undefined,
  );
  const abort = useRef(new AbortController());
  useEffect(() => {
    alive.current = true;
    abort.current = new AbortController();
    return () => {
      alive.current = false;
      abort.current.abort();
    };
  }, []);
  const loadData = useCallback(async () => {
    if (!workspaceId) return;
    const version = ++refreshVersion.current;
    const next = await loadCoco(userId, workspaceId, abort.current.signal);
    if (alive.current && version === refreshVersion.current) {
      setData(next);
      setLoaded(true);
    }
  }, [userId, workspaceId]);
  const loadConnections = useCallback(async () => {
    if (!workspaceId) return;
    const [state, gmail] = await Promise.all([
      macApi<MacStatus>(
        `?workspaceId=${workspaceId}`,
        undefined,
        abort.current.signal,
        userId,
      ),
      fetch(`/api/coco/gmail/status?workspaceId=${workspaceId}`, {
        headers: { "x-wolfgrid-user-id": userId },
        signal: abort.current.signal,
        cache: "no-store",
      }).then(async (r) => (r.ok ? await r.json() : null)),
    ]);
    if (!alive.current) return;
    setDeviceOnline(
      hasMacBridge() || state.devices.some(
        (d) =>
          ["connected", "syncing", "idle"].includes(d.status) &&
          Date.now() - Date.parse(d.last_seen_at) < 70000,
      ),
    );

    if (gmail) setGmailStatus(gmail);
  }, [userId, workspaceId]);
  useEffect(() => {
    void loadData().catch((e) => {
      if (alive.current && e.name !== "AbortError") setError(e.message);
    });
    void loadConnections().catch(() => {});
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadData().catch(() => {});
        void loadConnections().catch(() => {});
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [loadData, loadConnections]);
  useEffect(() => {
    if (!initialContact) return;
    setSelectedClient(initialContact);
    setArea("Clients");
  }, [initialContact]);
  const clientsById = useMemo(
    () => Object.fromEntries(data.clients.map((c) => [c.id, c])),
    [data.clients],
  );

  const clientDeals = data.deals;
  const viewData = {
    ...data,
    stages: stages.map((name, position) => ({ id: name, name, position })),
    items: data.clients.map((c) => ({ client_id: c.id, stage_id: c.stage })),
  };
  const clientStage = (id: string) => clientsById[id]?.stage ?? "Lead";
  const openClient = (id: string) => {
    setSelectedClient(id);
    setArea("Clients");
  };
  function openContactInbox(client: Client, channel: "text" | "email") {
    if (channel === "text" && !client.phone) {
      setNotice("Add a phone number first.");
      return;
    }
    if (channel === "email" && !client.email) {
      setNotice("Add an email address first.");
      return;
    }
    if (!canUseInbox) {
      window.location.href = channel === "text" ? `sms:${encodeURIComponent(client.phone!)}` : `mailto:${encodeURIComponent(client.email!)}`;
      return;
    }
    setInboxContact(client);
    setEmailClient(channel === "email" ? client : null);
    setSelectedConversation(client.id);
    setSearch("");
    setComposer("");
    setDraft("");
    void clearAttachments();
    setArea("Inbox");
  }
  const conversationName = (c: Conversation) =>
    displayName(clientsById[c.client_id]);
  const sortedConversations = useMemo<Conversation[]>(() => {
    const known = new Set(data.conversations.map((c) => c.client_id));
    const all = [
      ...data.conversations,
      ...data.clients
        .filter((c) => !known.has(c.id) && (c.phone || c.email))
        .map((c) => ({
          id: c.id,
          client_id: c.id,
          channel: c.phone ? "sms" : "email",
          last_message_at: null,
          last_read_at: null,
          preview: "Start a conversation",
          message_id: null,
        })),
    ];
    return all.sort(
      (a, b) =>
        Number(
          displayName(clientsById[b.client_id]).toLowerCase() ===
            "santana phillippe",
        ) -
          Number(
            displayName(clientsById[a.client_id]).toLowerCase() ===
              "santana phillippe",
          ) || (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""),
    );
  }, [data.conversations, data.clients, clientsById]);
  const activeConversation =
    sortedConversations.find((c) => c.id === selectedConversation) ??
    (inboxContact
      ? sortedConversations.find((c) => c.client_id === inboxContact.id)
      : sortedConversations[0]);
  const activeContactRef = useRef<string | undefined>(undefined);
  activeContactRef.current = activeConversation?.client_id;
  const latestByConversation = new Map(
    sortedConversations.map((c) => [c.id, { body: c.preview }]),
  );
  useEffect(() => {
    if (
      !selectedConversation &&
      sortedConversations.length &&
      window.matchMedia("(min-width: 761px)").matches
    )
      setSelectedConversation(sortedConversations[0].id);
  }, [selectedConversation, sortedConversations]);
  useEffect(() => {
    setComposer("");
    setDraft("");
    setDraftSources([]);
    setIncludeGmail(false);
    setAttachmentNames([]);
    sendAttempt.current = undefined;
    setShowTemplates(false);
  }, [activeConversation?.client_id]);
  const thread = history.filter(
    (m) => m.client_id === activeConversation?.client_id,
  );
  const filteredContacts = data.clients
    .filter(
      (c) =>
        (stageFilter === "All" || clientStage(c.id) === stageFilter) &&
        (contactFilter === "All" ||
          (contactFilter === "Unlabeled"
            ? !c.contact_labels.length
            : c.contact_labels.includes(contactFilter))) &&
        `${displayName(c)} ${c.phone ?? ""} ${c.email ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const historyPage = useCallback(
    async (id: string, before?: Message) => {
      const q = `?workspaceId=${workspaceId}&contactId=${id}${before?.sent_at ? `&before=${encodeURIComponent(before.sent_at)}&beforeId=${before.id}` : before ? `&beforeNull=true&beforeId=${before.id}` : ""}`;
      const result = await macApi<{
        messages: (Omit<
          Message,
          "client_id" | "conversation_id" | "attachments"
        > & { attachments?: MessageAttachment[]; has_attachments?: boolean })[];
        more: boolean;
      }>(q, undefined, abort.current.signal, userId);
      return {
        more: result.more,
        messages: result.messages
          .map((m) => ({
            ...m,
            client_id: id,
            conversation_id: id,
            created_at: m.created_at ?? m.sent_at ?? "",
            attachments:
              m.attachments ??
              (m.has_attachments
                ? [
                    {
                      guid: m.id,
                      fileName: "Attachment",
                      byteCount: 0,
                      status: "not_imported",
                    },
                  ]
                : []),
          }))
          .reverse(),
      };
    },
    [userId, workspaceId],
  );
  useEffect(() => {
    const id = activeConversation?.client_id;
    if (!id || area !== "Inbox") {
      setHistory([]);
      return;
    }
    let active = true;
    setHistory([]);
    setHistoryError("");
    setHistoryMore(false);
    const load = async () => {
      try {
        const result = await historyPage(id);
        if (active) {
          setHistory(result.messages);
          setHistoryMore(result.more);
          await cocoApi(
            userId,
            workspaceId,
            "read",
            { id },
            abort.current.signal,
          );
          if (active)
            setData((current) => ({
              ...current,
              conversations: current.conversations.map((c) =>
                c.client_id === id
                  ? { ...c, last_read_at: new Date().toISOString() }
                  : c,
              ),
            }));
        }
      } catch (e) {
        if (active) setHistoryError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void historyPage(id)
          .then((r) => {
            if (active)
              setHistory((current) => {
                const merged = new Map(current.map((m) => [m.id, m]));
                r.messages.forEach((m) => merged.set(m.id, m));
                return [...merged.values()].sort((a, b) =>
                  (a.sent_at ?? a.created_at).localeCompare(
                    b.sent_at ?? b.created_at,
                  ),
                );
              });
          })
          .catch(() => {});
    }, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [activeConversation?.client_id, area, userId, workspaceId, historyPage]); // History is paged independently from the contact list.
  useEffect(() => {
    if (!selectedClient) return;
    let active = true;
    void historyPage(selectedClient)
      .then((r) => {
        if (active) setDetailMessages(r.messages);
      })
      .catch(() => {
        if (active) setDetailMessages([]);
      });
    return () => {
      active = false;
    };
  }, [selectedClient, userId, workspaceId, historyPage]);
  useEffect(() => {
    const el = messageScroll.current;
    if (!el) return;
    const changed = scrollConversation.current !== activeConversation?.id;
    if (changed || stickToLatest.current) el.scrollTop = el.scrollHeight;
    if (changed) stickToLatest.current = true;
    scrollConversation.current = activeConversation?.id;
  }, [activeConversation?.id, thread.length, area]);
  async function loadOlder() {
    if (!activeConversation || loadingHistory) return;
    setLoadingHistory(true);
    try {
      const el = messageScroll.current,
        oldHeight = el?.scrollHeight ?? 0;
      const contactId = activeConversation.client_id;
      const result = await historyPage(contactId, history[0]);
      if (activeContactRef.current !== contactId) return;
      stickToLatest.current = false;
      setHistory((current) => [
        ...result.messages,
        ...current.filter((m) => !result.messages.some((r) => r.id === m.id)),
      ]);
      setHistoryMore(result.more);
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - oldHeight;
      });
    } catch (e) {
      setHistoryError((e as Error).message);
    } finally {
      setLoadingHistory(false);
    }
  }
  async function mutate(action: string, payload: Record<string, unknown>) {
    return cocoApi(userId, workspaceId, action, payload, abort.current.signal);
  }
  async function moveClient(id: string, stage: string) {
    setSavingStage(true);
    try {
      await mutate("stage", { id, stage });
      await loadData();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSavingStage(false);
    }
  }
  async function bulkCommand(
    action: "bulk-label" | "bulk-stage" | "delete",
    value?: string,
  ) {
    let changed = 0;
    for (let i = 0; i < selectedContacts.length; i += 500) {
      const ids = selectedContacts.slice(i, i + 500);
      await mutate(action, {
        ids,
        ...(action === "delete" ? { confirmation: "DELETE" } : { value }),
      });
      changed += ids.length;
    }
    return changed;
  }
  async function setSelectedContactStages() {
    if (savingStage) return;
    setSavingStage(true);
    try {
      await bulkCommand("bulk-stage", bulkStage);
      await loadData();
      setNotice("Stage updated for selected contacts.");
    } catch (e) {
      setError((e as Error).message);
      await loadData();
    } finally {
      setSavingStage(false);
    }
  }
  function toggleContactSelection(id: string) {
    setSelectedContacts((current) =>
      current.includes(id) ? current.filter((v) => v !== id) : [...current, id],
    );
  }
  async function addLabelToSelectedContacts() {
    if (applyingBulkLabel) return;
    setApplyingBulkLabel(true);
    try {
      await bulkCommand("bulk-label", bulkLabel);
      await loadData();
      setNotice(
        `${bulkLabel} label added. Use the ${bulkLabel} filter to see these contacts.`,
      );
    } catch (e) {
      setError((e as Error).message);
      await loadData();
    } finally {
      setApplyingBulkLabel(false);
    }
  }
  async function updateContactLabels(
    client: Client,
    label: ContactLabel,
    checked: boolean,
  ) {
    setSavingLabels(true);
    try {
      await mutate("labels", {
        id: client.id,
        labels: checked
          ? [...client.contact_labels, label]
          : client.contact_labels.filter((v) => v !== label),
      });
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingLabels(false);
    }
  }
  async function deleteSelectedContacts() {
    if (deletingContacts) return;
    setDeletingContacts(true);
    try {
      const count = await bulkCommand("delete");
      setNotice(`${count} contacts deleted.`);
      setSelectedContacts([]);
      setSelectedClient(null);
      setConfirmDelete(false);
      await loadData();
    } catch (e) {
      setError((e as Error).message);
      await loadData();
    } finally {
      setDeletingContacts(false);
    }
  }
  async function toggleTask(task: Task) {
    try {
      await mutate("task-toggle", {
        id: task.id,
        source: task.source ?? "crm",
        version: task.version ?? 1,
      });
      await loadData();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function addClient(form: FormData) {
    if (commandLock.current) return;
    commandLock.current = true;
    setSavingNew(true);
    try {
      const row = (await mutate("create", {
        first_name: String(form.get("first_name") ?? "").trim(),
        last_name: String(form.get("last_name") ?? "").trim(),
        phone: String(form.get("phone") || "") || null,
        email: String(form.get("email") || "") || null,
        contact_labels: form.getAll("contact_labels"),
      })) as { id: string };
      await loadData();
      setSelectedClient(row.id);
      setShowAddClient(false);
      setArea("Clients");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      commandLock.current = false;
      setSavingNew(false);
    }
  }
  async function addTask(form: FormData) {
    if (commandLock.current) return;
    commandLock.current = true;
    setSavingNew(true);
    try {
      const due = String(form.get("due_at") || "");
      await mutate("task-create", {
        title: String(form.get("title") ?? ""),
        client_id: String(form.get("client_id") || "") || null,
        due_at: due ? new Date(due).toISOString() : null,
      });
      await loadData();
      setShowAddTask(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      commandLock.current = false;
      setSavingNew(false);
    }
  }
  async function aiReply(instruction?: string) {
    if (!activeConversation || aiBusy) return;
    const contactId = activeConversation.client_id;
    setAiBusy(true);
    try {
      const response = await fetch("/api/crm-ai", {
        method: "POST",
        credentials: "include",
        signal: abort.current.signal,
        headers: {
          "Content-Type": "application/json",
          "x-wolfgrid-user-id": userId,
        },
        body: JSON.stringify({
          workspaceId,
          contactId: activeConversation.client_id,
          mode: "draft",
          question:
            instruction ??
            "Draft a natural reply matching this conversation. Do not invent prior conversation details.",
          draftText: draft || composer,
          includeGmail,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      if (activeContactRef.current === contactId) {
        setDraft(result.draft ?? result.answer);
        setDraftSources(result.sources ?? []);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }
  const completeGmail = useCallback(
    async (ticket: string) => {
      const response = await fetch("/api/coco/gmail/complete", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-wolfgrid-user-id": userId,
        },
        body: JSON.stringify({ workspaceId, ticket }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      await loadConnections();
      setNotice(`Gmail connected as ${result.email}.`);
    },
    [workspaceId, userId, loadConnections],
  );
  async function connectGmail(send = false) {
    setIntegrationBusy(true);
    try {
      const response = await fetch("/api/coco/gmail/connect", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-wolfgrid-user-id": userId,
        },
        body: JSON.stringify({
          workspaceId,
          send,
          read: !send,
          native: hasMacBridge(),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error);
      if (hasMacBridge()) {
        await macNative("gmail-auth", {
          userId,
          workspaceId,
          url: result.url,
          ticket: result.ticket,
        });
        await completeGmail(result.ticket);
      } else window.location.assign(result.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIntegrationBusy(false);
    }
  }
  useEffect(() => {
    if (!workspaceId) return;
    const query = new URLSearchParams(window.location.search);
    const ticket = query.get("gmail_ticket");
    if (!ticket) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (query.get("gmail") === "ready")
      void completeGmail(ticket).catch((e) => setError(e.message));
    else setError("Gmail connection was not completed. Try again.");
  }, [workspaceId, userId, completeGmail]);
  async function clearAttachments() {
    setAttachmentNames([]);
    if (hasMacBridge())
      await macNative("message-clear-attachments", {
        userId,
        workspaceId,
      }).catch(() => {});
  }
  async function chooseAttachments() {
    if (!hasMacBridge()) {
      setNotice(
        "Open WolfGrid for Mac to attach files through Apple Messages.",
      );
      return;
    }
    const contactId = activeConversation?.client_id;
    try {
      const result = await macNative<{ names: string[] }>(
        "message-attachments",
        { userId, workspaceId, contactId: activeConversation?.client_id },
      );
      if (activeContactRef.current === contactId)
        setAttachmentNames(result.names);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function sendMessage() {
    if (!activeConversation || sending) return;
    const client = clientsById[activeConversation.client_id];
    if (!client?.phone && !client?.email) {
      setNotice("Add a phone number first.");
      return;
    }
    if (!hasMacBridge()) {
      window.location.href = `sms:${encodeURIComponent(client.phone ?? client.email!)}?body=${encodeURIComponent(composer)}`;
      return;
    }
    const signature = JSON.stringify([client.id, composer, attachmentNames]);
    if (sendAttempt.current?.signature !== signature)
      sendAttempt.current = { signature, id: crypto.randomUUID() };
    setSending(true);
    try {
      const result = await macNative<{ accepted: boolean }>("message-send", {
        userId,
        workspaceId,
        contactId: client.id,
        body: composer,
        requestId: sendAttempt.current!.id,
      });
      if (result.accepted && activeContactRef.current === client.id) {
        setNotice(
          "Apple Messages accepted the request. Delivery is not confirmed.",
        );
        setComposer("");
        setAttachmentNames([]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function importAppleContacts() {
    if (!hasMacBridge()) {
      setNotice("Open WolfGrid for Mac to review Apple Contacts.");
      return;
    }
    setShowAppleImport(true);
  }
  if (!loaded)
    return (
      <div className="coco-crm">
        <div className="inbox-loading">
          {error ? (
            <p role="alert">{error}</p>
          ) : (
            <>
              <Loader2 className="animate-spin" size={18} /> Opening your CRM…
            </>
          )}
        </div>
      </div>
    );
  // The view model below intentionally retains KimiCoco's markup and class names.
  const renderedData = { ...viewData, messages: data.messages };
  return (
    <div className={`coco-crm ${canUseInbox ? "" : "contacts-only"}`}>
      <div className="main-content">
        {canUseInbox && <div className="mac-titlebar">
          <nav className="coco-area-tabs" aria-label="CRM pages">
            <button
              aria-current={area === "Inbox" ? "page" : undefined}
              onClick={() => {
                setArea("Inbox");
                setSearch("");
              }}
            >
              <Inbox size={17} /> Inbox
            </button>
            <button
              aria-current={area === "Clients" ? "page" : undefined}
              onClick={() => {
                setArea("Clients");
                setSearch("");
              }}
            >
              <Users size={17} /> Contacts
            </button>
          </nav>
          <div className="mac-titlebar-actions">
            <span
              className={`connection-pill ${deviceOnline ? "connected" : ""}`}
            >
              <span className="status-dot" />
              {deviceOnline ? "Mac connected" : "Mac offline"}
            </span>
            <button
              aria-label="Ask WolfGrid"
              onClick={() =>
                openCrmAssistant({
                  contactId:
                    area === "Clients"
                      ? (selectedClient ?? undefined)
                      : activeConversation?.client_id,
                })
              }
            >
              <Sparkles size={18} />
            </button>
            <Link
              href="/settings/integrations/apple"
              aria-label="Apple integrations"
            >
              <Settings2 size={18} />
            </Link>

          </div>
        </div>}
        {area === "Clients" && (
          <div className={`contacts-workspace ${contactOptions === "filter" ? "with-contact-lists" : ""}`}>
            <nav className="contacts-lists" aria-label="Contact lists" hidden={contactOptions !== "filter"}>
              <div className="contacts-lists-heading"><strong>Lists</strong><button aria-label="Hide contact filters" onClick={() => setContactOptions(null)}><PanelLeft size={18} /></button></div>
              <button className="all-contacts-list" onClick={() => { setContactFilter("All"); setStageFilter("All"); }}>All Contacts</button>
                  <div
                    id="contact-label-options"
                    hidden={contactOptions !== "filter"}
                    className="contact-filters"
                    role="group"
                    aria-label="Filter contacts by label"
                  >
                    <span>Labels</span>
                    {(["All", ...availableLabels, "Unlabeled"] as const).map(
                      (label) => (
                        <button
                          key={label}
                          aria-pressed={contactFilter === label}
                          onClick={() => setContactFilter(label)}
                        >
                          {label}
                        </button>
                      ),
                    )}
                  </div>
                  <div
                    id="contact-stage-options"
                    hidden={contactOptions !== "filter"}
                    className="contact-filters"
                    role="group"
                    aria-label="Filter contacts by pipeline stage"
                  >
                    <span>Stage</span>
                    {[
                      "All",
                      "Lead",
                      "Warm",
                      "Active Client",
                      "Past Client",
                    ].map((stage) => (
                      <button
                        key={stage}
                        aria-pressed={stageFilter === stage}
                        onClick={() => setStageFilter(stage)}
                      >
                        {stage}
                      </button>
                    ))}
                  </div>
            </nav>
            <aside className="contacts-browser" aria-label="Clients">
              <>
                <header className="page-header">
                  <div>
                    <span className="eyebrow">RELATIONSHIPS FIRST</span>
                    <h1>
                      Clients<span className="rose-dot">.</span>
                    </h1>
                    <p>Everyone you care for, in one calm place.</p>
                  </div>
                  <div className="client-header-actions">
                    <button
                      aria-label="Filter"
                      title="Show contact lists and filters"
                      aria-expanded={contactOptions === "filter"}
                      aria-controls="contact-label-options contact-stage-options"
                      onClick={() =>
                        setContactOptions((value) =>
                          value === "filter" ? null : "filter",
                        )
                      }
                    >
                      <PanelLeft size={19} />
                      {(contactFilter !== "All" || stageFilter !== "All") && <span className="filter-active-dot" />}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="contact-add-button" aria-label="Contact" title="Add a contact">
                          <Plus size={21} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem disabled={integrationBusy} onSelect={() => setShowGmailImport(true)}>Google (Gmail)</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void importAppleContacts()}>Apple</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </header>
                <div className="page-body contacts-list-body">
                  <div className="toolbar">
                    <label className="search-field">
                      <Search size={18} />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search contacts"
                      />
                    </label>
                    <span className="count-label">
                      {filteredContacts.length} of {data.clients.length}{" "}
                      contacts
                    </span>
                  </div>
                  <div className="bulk-contact-actions">
                    <button
                      disabled={
                        deletingContacts ||
                        applyingBulkLabel ||
                        !filteredContacts.length
                      }
                      onClick={() => {
                        setContactSelectionMode(true);
                        setSelectedContacts((current) => [
                          ...new Set([
                            ...current,
                            ...filteredContacts.map((client) => client.id),
                          ]),
                        ]);
                      }}
                    >
                      Select all
                    </button>
                    {contactSelectionMode && (
                      <>
                        <span>{selectedContacts.length} selected</span>
                        <button
                          disabled={deletingContacts || applyingBulkLabel}
                          onClick={() => {
                            setSelectedContacts([]);
                            setContactSelectionMode(false);
                          }}
                        >
                          Cancel selection
                        </button>
                        {selectedContacts.length > 0 && (
                          <>
                            <label className="bulk-label-picker">
                              Stage
                              <select
                                aria-label="Stage for selected contacts"
                                value={
                                  bulkStage ||
                                  [...renderedData.stages].sort(
                                    (a, b) => a.position - b.position,
                                  )[0]?.id ||
                                  ""
                                }
                                onChange={(event) =>
                                  setBulkStage(event.target.value)
                                }
                                disabled={savingStage}
                              >
                                {[...renderedData.stages]
                                  .sort((a, b) => a.position - b.position)
                                  .map((stage) => (
                                    <option key={stage.id} value={stage.id}>
                                      {stage.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <button
                              disabled={
                                savingStage ||
                                applyingBulkLabel ||
                                deletingContacts
                              }
                              onClick={() => void setSelectedContactStages()}
                            >
                              {savingStage ? "Saving stage…" : "Set stage"}
                            </button>
                            <label className="bulk-label-picker">
                              Label
                              <select
                                aria-label="Label for selected contacts"
                                value={bulkLabel}
                                disabled={applyingBulkLabel || deletingContacts}
                                onChange={(event) =>
                                  setBulkLabel(
                                    event.target.value as ContactLabel,
                                  )
                                }
                              >
                                {availableLabels.map((label) => (
                                  <option key={label} value={label}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              disabled={
                                applyingBulkLabel ||
                                deletingContacts ||
                                savingLabels
                              }
                              onClick={() => void addLabelToSelectedContacts()}
                            >
                              {applyingBulkLabel
                                ? "Adding label…"
                                : "Add label"}
                            </button>
                            <button
                              className="delete-contacts"
                              disabled={deletingContacts || applyingBulkLabel}
                              onClick={() => setConfirmDelete(true)}
                            >
                              Delete selected
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                  <div className="surface client-list">
                    <div className="list-head">
                      <span>CLIENT</span>
                      <span>STAGE</span>
                      <span>LAST CONTACT</span>
                      <span>FOLLOW-UP</span>
                    </div>
                    {filteredContacts.map((client, index) => (
                      <div className="contact-list-entry" key={client.id}>
                      {(index === 0 || displayName(client).charAt(0).toLocaleUpperCase() !== displayName(filteredContacts[index - 1]).charAt(0).toLocaleUpperCase()) && <div className="contact-letter">{displayName(client).charAt(0).toLocaleUpperCase()}</div>}
                      <div
                        className={`contact-list-row ${selectedClient === client.id ? "selected" : ""}`}
                        key={client.id}
                      >
                        {contactSelectionMode && (
                          <input
                            type="checkbox"
                            aria-label={`Select ${displayName(client)}`}
                            checked={selectedContacts.includes(client.id)}
                            disabled={deletingContacts || applyingBulkLabel}
                            onChange={() => toggleContactSelection(client.id)}
                          />
                        )}
                        <button
                          className="client-row"
                          aria-pressed={selectedClient === client.id}
                          onClick={() => openClient(client.id)}
                        >
                          <span className="client-name">
                            <Avatar name={displayName(client)} />
                            <span>
                              <strong>{displayName(client)}</strong>
                              <small>
                                {[
                                  clientStage(client.id),
                                  ...(client.contact_labels ?? []),
                                ].join(" · ")}
                              </small>
                            </span>
                          </span>

                        </button>
                      </div>
                      </div>
                    ))}
                    {filteredContacts.length === 0 && (
                      <div className="empty-inline">
                        {data.clients.length
                          ? "No contacts match these filters."
                          : "Add your first client to get started."}
                      </div>
                    )}
                  </div>
                </div>
              </>
            </aside>
            <section
              className="contact-detail-pane"
              aria-label="Contact details"
            >
              {selectedClient ? (
                (() => {
                  const client = clientsById[selectedClient];
                  if (!client) return null;
                  const clientTasks = data.tasks.filter(
                    (task) => task.client_id === client.id,
                  );
                  const clientMessages = detailMessages
                    .filter((m) => m.client_id === client.id)
                    .slice(-3);
                  return (
                    <>
                      <header className="page-header detail-header">
                        <button
                          className="back-button"
                          onClick={() => setSelectedClient(null)}
                        >
                          <ArrowLeft size={17} /> All clients
                        </button>
                        <div className="detail-title">
                          <Avatar name={displayName(client)} size="large" />
                          <div>
                            <h1>{displayName(client)}</h1>
                            <p>
                              {clientStage(client.id)} ·{" "}
                              {client.email ?? "No email"}
                            </p>
                          </div>
                        </div>
                        <div className="detail-actions contact-quick-actions">
                          <button aria-label="Message contact" title="Message" onClick={() => openContactInbox(client, "text")} disabled={!client.phone && !client.email}><MessageCircle size={20} /></button>
                          <a aria-label="Call contact" title="Call" aria-disabled={!client.phone} href={client.phone ? `tel:${encodeURIComponent(client.phone)}` : undefined}><Phone size={20} /></a>
                          <a aria-label="Video call contact" title="FaceTime" aria-disabled={!client.phone && !client.email} href={client.phone || client.email ? `facetime:${encodeURIComponent(client.phone || client.email!)}` : undefined}><Video size={21} /></a>
                          <button aria-label="Email contact" title="Email" disabled={!client.email} onClick={() => openContactInbox(client, "email")}><Mail size={20} /></button>
                        </div>
                      </header>
                      <div className="page-body detail-grid">
                        <section className="surface details-surface">
                          <span className="eyebrow">THE DETAILS</span>
                          <h2>About {client.first_name}</h2>
                          <ContactDetailsEditor
                            key={client.id}
                            client={client}
                            userId={userId}
                            onSaved={() => loadData()}
                          />
                          <dl>
                            <dt>Labels</dt>
                            <dd>
                              <div className="contact-labels">
                                {availableLabels.map((label) => (
                                  <label key={label}>
                                    <input
                                      type="checkbox"
                                      checked={
                                        client.contact_labels?.includes(
                                          label,
                                        ) ?? false
                                      }
                                      disabled={
                                        savingLabels || applyingBulkLabel
                                      }
                                      onChange={(event) =>
                                        void updateContactLabels(
                                          client,
                                          label,
                                          event.target.checked,
                                        )
                                      }
                                    />
                                    {label}
                                  </label>
                                ))}
                              </div>
                            </dd>
                            <dt>Pipeline</dt>
                            <dd>
                              <select
                                aria-label="Contact pipeline stage"
                                value={
                                  renderedData.items.find(
                                    (item) => item.client_id === client.id,
                                  )?.stage_id ??
                                  renderedData.stages.find(
                                    (stage) => stage.name === "Lead",
                                  )?.id ??
                                  ""
                                }
                                onChange={(event) =>
                                  void moveClient(client.id, event.target.value)
                                }
                              >
                                {[...renderedData.stages]
                                  .sort((a, b) => a.position - b.position)
                                  .map((stage) => (
                                    <option key={stage.id} value={stage.id}>
                                      {stage.name}
                                    </option>
                                  ))}
                              </select>
                            </dd>
                          </dl>
                          <div className="notes-block">
                            <span className="eyebrow">PAST DEALS</span>
                            {clientDeals
                              .filter((deal) => deal.client_id === client.id)
                              .map((deal) => (
                                <div className="client-deal" key={deal.id}>
                                  <strong>
                                    {deal.property_address ||
                                      "Property not identified"}
                                  </strong>
                                  <span>
                                    {[
                                      deal.side,
                                      deal.closing_date,
                                      deal.price
                                        ? new Intl.NumberFormat("en-CA", {
                                            style: "currency",
                                            currency: "CAD",
                                            maximumFractionDigits: 0,
                                          }).format(deal.price)
                                        : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </span>
                                  <small>
                                    From Gmail: {deal.evidence_subject}
                                  </small>
                                </div>
                              ))}
                            {!clientDeals.some(
                              (deal) => deal.client_id === client.id,
                            ) && <p>No past deals added yet.</p>}
                          </div>
                        </section>
                        <div className="detail-right">
                          <ContactContext client={client} />
                          <section className="surface">
                            <div className="surface-header">
                              <h2>Conversation</h2>
                            </div>
                            {clientMessages.length ? (
                              clientMessages.map((message) => (
                                <div className="mini-message" key={message.id}>
                                  <span>
                                    {message.direction === "incoming"
                                      ? client.first_name
                                      : "You"}
                                  </span>
                                  <p>{message.body ?? "Attachment"}</p>
                                  <small>{formatShort(message.sent_at)}</small>
                                </div>
                              ))
                            ) : (
                              <div className="empty-inline">
                                No messages yet.
                              </div>
                            )}
                          </section>
                          <section className="surface">
                            <div className="surface-header">
                              <h2>To-do</h2>
                              <button
                                className="text-button"
                                onClick={() => setShowAddTask(true)}
                              >
                                Add <Plus size={15} />
                              </button>
                            </div>
                            {clientTasks.length ? (
                              clientTasks.map((task) => (
                                <button
                                  className="task-row"
                                  key={task.id}
                                  onClick={() => void toggleTask(task)}
                                >
                                  {task.completed_at ? (
                                    <CheckCircle2 size={20} />
                                  ) : (
                                    <Circle size={20} />
                                  )}
                                  <span>{task.title}</span>
                                  <small>{formatShort(task.due_at)}</small>
                                </button>
                              ))
                            ) : (
                              <div className="empty-inline">
                                Nothing on the list yet.
                              </div>
                            )}
                          </section>
                        </div>
                      </div>
                    </>
                  );
                })()
              ) : (
                <div className="contact-detail-empty">
                  <MessageCircle size={36} />
                  <h2>Select a contact</h2>
                  <p>
                    Their details, conversations, and tasks will appear here.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
        {confirmDelete && (
          <div className="modal-backdrop">
            <div
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-contacts-title"
            >
              <h2 id="delete-contacts-title">
                Delete {selectedContacts.length} contact
                {selectedContacts.length === 1 ? "" : "s"}?
              </h2>
              <p>
                This permanently removes the selected contacts and their linked
                deals, pipeline entries, and message history. Their tasks are
                kept without a contact.
              </p>
              <div className="bulk-contact-actions">
                <button
                  disabled={deletingContacts}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
                <button
                  className="delete-contacts"
                  disabled={deletingContacts}
                  onClick={() => void deleteSelectedContacts()}
                >
                  {deletingContacts ? "Deleting…" : "Delete contacts"}
                </button>
              </div>
            </div>
          </div>
        )}
        {area === "Inbox" && (
          <>
            <div
              className={`inbox-shell ${selectedConversation ? "show-thread" : ""}`}
            >
              <div className="conversation-list">
                <label className="search-field">
                  <Search size={17} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search conversations"
                  />
                </label>
                <div className="conversation-scroll">
                  {sortedConversations
                    .filter((conversation) =>
                      conversationName(conversation)
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((conversation) => {
                      const last = latestByConversation.get(conversation.id);
                      const unread =
                        conversation.last_message_at &&
                        (!conversation.last_read_at ||
                          conversation.last_message_at >
                            conversation.last_read_at);
                      return (
                        <button
                          key={conversation.id}
                          className={`conversation-row ${activeConversation?.id === conversation.id ? "selected" : ""}`}
                          onClick={() => {
                            setInboxContact(null);
                            setEmailClient(
                              conversation.channel === "email"
                                ? (clientsById[conversation.client_id ?? ""] ??
                                    null)
                                : null,
                            );
                            setSelectedConversation(conversation.id);
                            setDraft("");
                            setComposer("");
                            void clearAttachments();
                            setIncludeGmail(false);
                          }}
                        >
                          <Avatar name={conversationName(conversation)} />
                          <span className="conversation-preview">
                            <span>
                              <strong>{conversationName(conversation)}</strong>
                              <time>
                                {formatShort(conversation.last_message_at)}
                              </time>
                            </span>
                            <small>
                              {last?.body ??
                                (conversation.id.startsWith("new:")
                                  ? "Start a conversation"
                                  : "Attachment")}
                            </small>
                          </span>
                          {unread && <span className="unread-dot" />}
                        </button>
                      );
                    })}
                  {sortedConversations.length === 0 && (
                    <div className="empty-inline">
                      Add a contact with a phone number or email to start a
                      conversation.
                    </div>
                  )}
                </div>
              </div>
              <div className="thread-panel">
                {emailClient ? (
                  <EmailComposer
                    key={emailClient.id}
                    inline
                    client={emailClient}
                    workspaceId={workspaceId}
                    from={gmailStatus?.email ?? null}
                    canSend={Boolean(gmailStatus?.can_send)}
                    onConnect={() => void connectGmail(true)}
                    onClose={() => {
                      setEmailClient(null);
                      setInboxContact(null);
                      setSelectedConversation(null);
                    }}
                  />
                ) : activeConversation ? (
                  <>
                    <div className="thread-header messages-contact-header">
                      <button
                        className="thread-back"
                        aria-label="Back to conversations"
                        onClick={() => {
                          setSelectedConversation(null);
                          setInboxContact(null);
                        }}
                      >
                        <ArrowLeft size={20} />
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="messages-contact-identity" aria-label={`Conversation details for ${conversationName(activeConversation)}`}>
                            <Avatar name={conversationName(activeConversation)} />
                            <span className="messages-contact-name">{conversationName(activeConversation)} <ArrowRight size={11} /></span>
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="center">
                          {activeConversation.client_id && <DropdownMenuItem onSelect={() => openClient(activeConversation.client_id!)}>View contact</DropdownMenuItem>}
                          {clientsById[activeConversation.client_id ?? ""]?.email && <DropdownMenuItem onSelect={() => openContactInbox(clientsById[activeConversation.client_id!], "email")}>Email contact</DropdownMenuItem>}
                          <div className="px-2 py-1.5 text-xs text-muted-foreground">{activeConversation.channel.toUpperCase()} · {deviceOnline ? "Mac connected" : "Mac offline"}</div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <a className="messages-video-call" aria-label="Video call conversation contact" title="FaceTime" aria-disabled={!clientsById[activeConversation.client_id ?? ""]?.phone && !clientsById[activeConversation.client_id ?? ""]?.email} href={(() => {
                        const person = clientsById[activeConversation.client_id ?? ""];
                        const recipient = person?.phone || person?.email;
                        return recipient ? `facetime:${encodeURIComponent(recipient)}` : undefined;
                      })()}><Video size={20} /></a>
                    </div>
                    <div
                      className="thread-messages"
                      ref={messageScroll}
                      onScroll={(event) => {
                        const el = event.currentTarget;
                        stickToLatest.current =
                          el.scrollHeight - el.scrollTop - el.clientHeight <
                          100;
                      }}
                    >
                      <div className="history-controls">
                        {historyMore && (
                          <button
                            disabled={loadingHistory}
                            onClick={() => void loadOlder()}
                          >
                            {loadingHistory
                              ? "Loading…"
                              : "Load older messages"}
                          </button>
                        )}
                        {historyError && (
                          <span role="status">{historyError}</span>
                        )}
                      </div>
                      <div className="thread-date">
                        {thread.length
                          ? "Recent conversation"
                          : "No messages yet. Write your first message below."}
                      </div>
                      {thread.map((message) => (
                        <div
                          key={message.id}
                          className={`bubble-wrap ${message.direction}`}
                        >
                          <div className="bubble">
                            {message.direction === "incoming" &&
                              (activeConversation.participants?.length ?? 0) >
                                1 && (
                                <small>
                                  {message.sender_identifier ||
                                    "Unknown sender"}
                                </small>
                              )}
                            {message.body || (
                              <em>
                                {message.body_status === "unsupported"
                                  ? "Message text could not be decoded"
                                  : "Attachment or message event"}
                              </em>
                            )}
                            <MessageAttachments
                              messageId={message.id}
                              attachments={message.attachments ?? []}
                              userId={userId}
                              workspaceId={workspaceId}
                            />
                          </div>
                          <small>{formatTime(message.sent_at)}</small>
                        </div>
                      ))}
                    </div>
                    <div className="composer-area">
                      {draft && (
                        <div className="draft-card">
                          <div>
                            <Sparkles size={17} />
                            <strong>Suggested reply</strong>
                            <button
                              onClick={() => setDraft("")}
                              aria-label="Discard draft"
                            >
                              <X size={15} />
                            </button>
                          </div>
                          <p className="composer-note">
                            Based on a bounded selection of your records and
                            consented messages.
                          </p>
                          {draftSources.map((source) => (
                            <details key={source.id}>
                              <summary>
                                <a href={source.href}>{source.label}</a>
                              </summary>
                              <p>{source.excerpt}</p>
                            </details>
                          ))}
                          <textarea
                            aria-label="Edit AI suggestion"
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                          />
                          <div className="draft-actions">
                            <button
                              onClick={() => void aiReply("Make it shorter")}
                            >
                              Shorter
                            </button>
                            <button
                              onClick={() => void aiReply("Make it warmer")}
                            >
                              Warmer
                            </button>
                            <button
                              onClick={() =>
                                void aiReply("Make it more professional")
                              }
                            >
                              Professional
                            </button>
                            <button onClick={() => void aiReply()}>
                              Try again
                            </button>
                            <button
                              className="draft-use"
                              onClick={() => {
                                setComposer(draft);
                                setDraft("");
                              }}
                            >
                              Use <Check size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                      {gmailStatus?.connected &&
                        clientsById[activeConversation.client_id ?? ""]
                          ?.email && (
                          <label className="gmail-context-toggle">
                            <input
                              type="checkbox"
                              checked={includeGmail}
                              onChange={(event) =>
                                setIncludeGmail(event.target.checked)
                              }
                            />{" "}
                            Send up to five recent emails for this client to the
                            AI provider for this draft
                          </label>
                        )}
                      {attachmentNames.length > 0 && (
                        <div className="pending-attachments">
                          <span>{attachmentNames.join(", ")}</span>
                          <button
                            className="clear-attachments"
                            aria-label="Remove attachments"
                            onClick={() => void clearAttachments()}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      )}
                      <div className="composer">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="attachment-button" aria-label="Add to message" title="Templates and attachments">
                              <Plus size={20} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" side="top">
                            <DropdownMenuItem onSelect={() => setShowTemplates(true)}>Templates</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void chooseAttachments()}>Attachments</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <textarea
                          aria-label="Message draft"
                          placeholder="Write a message…"
                          value={composer}
                          onChange={(e) => setComposer(e.target.value)}
                        />
                        <button
                          className="sparkle-button"
                          aria-label="Draft with AI"
                          title="Draft with AI"
                          disabled={aiBusy}
                          onClick={() => void aiReply()}
                        >
                          <Sparkles size={19} />
                          <span>{aiBusy ? "Drafting…" : "AI reply"}</span>
                        </button>
                        <button
                          className="send-button"
                          data-recipient={
                            clientsById[activeConversation.client_id ?? ""]
                              ?.phone ?? ""
                          }
                          aria-label="Send message"
                          disabled={sending || !composer.trim()}
                          title="Review and send with Apple Messages"
                          onClick={() => void sendMessage()}
                        >
                          <Send size={17} />
                        </button>
                      </div>
                      <p className="composer-note">
                        {deviceOnline
                          ? "Review every message before sending."
                          : "Your Mac is offline. Drafts stay in this session until you reconnect."}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="empty-thread">
                    <MessageCircle size={34} />
                    <h2>A lovely conversation starts here.</h2>
                    <p>Connect your Mac or open a conversation to begin.</p>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        <Dialog open={showTemplates} onOpenChange={setShowTemplates}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Message templates</DialogTitle>
              <DialogDescription>Choose a starting point, then edit your draft before sending.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              {replyTemplates.map(template => {
                const firstName = clientsById[activeConversation?.client_id ?? ""]?.first_name || "there";
                const body = template.body.replaceAll("{first_name}", firstName);
                return <button key={template.title} className="rounded-xl border p-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => {
                  setComposer(previous => previous.trim() ? `${previous}\n\n${body}` : body);
                  setShowTemplates(false);
                }}>
                  <span className="block text-sm font-semibold">{template.title}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{body}</span>
                </button>;
              })}
            </div>
          </DialogContent>
        </Dialog>
        {(showAddClient || showAddTask) && (
          <div
            className="modal-backdrop"
            onClick={() => {
              setShowAddClient(false);
              setShowAddTask(false);
            }}
          >
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <button
                className="modal-close"
                onClick={() => {
                  setShowAddClient(false);
                  setShowAddTask(false);
                }}
              >
                <X size={18} />
              </button>
              <span className="eyebrow">
                {showAddClient ? "A NEW CONNECTION" : "ONE THING AT A TIME"}
              </span>
              <h2>{showAddClient ? "Add a client" : "Add a task"}</h2>
              <form action={showAddClient ? addClient : addTask}>
                {showAddClient ? (
                  <>
                    <label>
                      First name
                      <input name="first_name" required autoFocus />
                    </label>
                    <label>
                      Last name
                      <input name="last_name" />
                    </label>
                    <label>
                      Phone
                      <input name="phone" type="tel" />
                    </label>
                    <label>
                      Email
                      <input name="email" type="email" />
                    </label>
                    <fieldset className="contact-labels">
                      <legend>Labels</legend>
                      {availableLabels.map((label) => (
                        <label key={label}>
                          <input
                            type="checkbox"
                            name="contact_labels"
                            value={label}
                          />
                          {label}
                        </label>
                      ))}
                    </fieldset>
                  </>
                ) : (
                  <>
                    <label>
                      What needs doing?
                      <input
                        name="title"
                        required
                        autoFocus
                        placeholder="Follow up with Sarah"
                      />
                    </label>
                    <label>
                      Client
                      <select
                        name="client_id"
                        defaultValue={selectedClient ?? ""}
                      >
                        <option value="">No client</option>
                        {data.clients.map((client) => (
                          <option key={client.id} value={client.id}>
                            {displayName(client)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Due
                      <input name="due_at" type="datetime-local" />
                    </label>
                  </>
                )}
                <button
                  className="primary wide"
                  type="submit"
                  disabled={savingNew}
                >
                  {showAddClient ? "Add client" : "Create task"}{" "}
                  <ArrowRight size={16} />
                </button>
              </form>
            </div>
          </div>
        )}
        {showGmailImport && (
          <GmailClientImport
            workspaceId={workspaceId}
            userId={userId}
            connected={Boolean(gmailStatus?.connected && gmailStatus.can_read)}
            configured={Boolean(gmailStatus?.configured)}
            onConnect={() => void connectGmail()}
            onClose={() => setShowGmailImport(false)}
            onImported={loadData}
          />
        )}
        {showAppleImport && (
          <AppleContactsReview
            userId={userId}
            workspaceId={workspaceId}
            clients={data.clients}
            onClose={() => setShowAppleImport(false)}
            onImported={loadData}
          />
        )}
        {(error || notice) && (
          <div className="toast" role={error ? "alert" : "status"}>
            {error || notice}
            <button
              aria-label="Dismiss notification"
              onClick={() => {
                setError("");
                setNotice("");
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
