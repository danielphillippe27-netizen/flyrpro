"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Inbox,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Video,
  Plus,
  Search,
  RefreshCw,
  Settings2,
  Sparkles,
  SquarePen,
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
import { macIdentifier } from "@/lib/mac-companion/identifiers";
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
import { OutreachTools, RelationshipPanel } from "./RelationshipTools";
import { ContactDetailsEditor } from "./ContactDetailsEditor";
import { EmailComposer } from "./EmailComposer";
import { GmailClientImport } from "./GmailClientImport";
import { AppleContactsReview } from "./AppleContactsReview";
import { ContactListImport } from "./ContactListImport";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import "./coco.css";
const replyTemplates = [
  { title: "Quick follow-up", body: "Hi {first_name}, just following up on our conversation. What would be a good next step for you?" },
  { title: "Schedule a call", body: "Hi {first_name}, when would be a good time for a quick call?" },
  { title: "Check in", body: "Hi {first_name}, how have things been going? Let me know if there’s anything I can help with." },
  { title: "Thank you", body: "Thanks, {first_name}! I appreciate your time. Let me know if you have any questions." },
];
type Area = "Inbox" | "Clients";
type SubmittedMessage = Message & { startedAt: number; attachmentNames: string[] };
type HistoryPermission = {
  history_range: "future" | "30d" | "90d" | "all";
  import_after: string | null;
  identifiers: string[];
};
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

function formatThreadDay(date: Date, today: Date, yesterday: Date, recent: Date) {
  const day = date.toDateString();
  if (day === today.toDateString()) return "Today";
  if (day === yesterday.toDateString()) return "Yesterday";
  if (date >= recent && date < today) {
    return new Intl.DateTimeFormat("en-CA", { weekday: "long" }).format(date);
  }
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
}
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
function ConversationContactCard({
  client,
  connection,
  onOpenClient,
  onEmail,
}: {
  client: Client;
  connection: string;
  onOpenClient: () => void;
  onEmail: () => void;
}) {
  const name = displayName(client);
  const primaryIdentifiers = new Set([macIdentifier(client.phone), macIdentifier(client.email)]);
  const otherIdentifiers = client.identifiers?.filter((identifier) => !primaryIdentifiers.has(identifier));
  const details = [
    ["Phone", client.phone && <a className="underline underline-offset-2" href={`tel:${encodeURIComponent(client.phone)}`}>{client.phone}</a>],
    ["Email", client.email && (
      <DialogClose asChild>
        <button type="button" className="text-left underline underline-offset-2" onClick={onEmail}>{client.email}</button>
      </DialogClose>
    )],
    ["Other phone numbers or emails", otherIdentifiers?.join("\n")],
    ["Address", client.address?.trim() || "No address saved"],
    ["Notes", client.notes],
    ["Lists", [...new Set([client.stage || "Lead", ...(client.contact_labels ?? [])])].join(" · ")],
    ["Last contacted", client.last_contacted_at && new Date(client.last_contacted_at).toLocaleString()],
    ["Next follow-up", client.next_follow_up_at && new Date(client.next_follow_up_at).toLocaleString()],
    ["Appointment", client.appointment_at && new Date(client.appointment_at).toLocaleString()],
  ] as const;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="messages-contact-identity" aria-label={`Contact card for ${name}`}>
          <Avatar name={name} />
          <span className="messages-contact-name">{name} <ArrowRight size={11} /></span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>{connection}</DialogDescription>
        </DialogHeader>
        <dl className="divide-y rounded-lg border">
          {details.map(([label, value]) => value && (
            <div key={label} className="px-4 py-2.5">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm">{value}</dd>
            </div>
          ))}
        </dl>
        <DialogClose asChild>
          <button type="button" className="justify-self-start rounded-md border px-3 py-2 text-sm hover:bg-accent" onClick={onOpenClient}>
            Open full contact
          </button>
        </DialogClose>
      </DialogContent>
    </Dialog>
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
function MessageBody({ body, showPreview = true }: { body: string; showPreview?: boolean }) {
  const parts = [];
  let offset = 0;
  let preview: URL | undefined;
  const target = hasMacBridge() ? undefined : "_blank";

  for (const match of body.matchAll(/https?:\/\/[^\s<>"“”]+/gi)) {
    let link = match[0].replace(/[.,!?;:'’]+$/, "");
    // Preserve balanced parentheses in URLs and leave enclosing punctuation in the message.
    while (link.endsWith(")") && link.split(")").length > link.split("(").length) {
      link = link.slice(0, -1);
    }
    const url = URL.canParse(link) ? new URL(link) : null;
    if (!url || url.username || url.password) continue;
    parts.push(body.slice(offset, match.index));
    parts.push(
      <a key={match.index} href={url.href} target={target} rel="noopener noreferrer">
        {link}
      </a>,
    );
    preview ??= url;
    offset = match.index + link.length;
  }
  parts.push(body.slice(offset));

  const isBusinessCard = preview?.hostname === "wolfgrid.app" && preview.pathname.startsWith("/c/");
  return (
    <>
      <span className="message-body">{parts}</span>
      {showPreview && preview && (
        <a className="message-link-preview" href={preview.href} target={target} rel="noopener noreferrer">
          <Link2 size={18} aria-hidden="true" />
          <span>
            <strong>{isBusinessCard ? "WolfGrid business card" : preview.hostname}</strong>
            <span>{isBusinessCard ? preview.hostname : "Open link"}</span>
          </span>
        </a>
      )}
    </>
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
      {attachments.filter((file) => !/\.pluginPayloadAttachment$/i.test(file.fileName)).map((file) => (
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
  const availableLists = useMemo(() => {
    const lists = new Map<string, string>();
    for (const name of [...contactLabels, ...stages, ...data.clients.flatMap(client => [...(client.contact_labels ?? []), client.stage ?? "Lead"])]) {
      const label = name.trim();
      const key = label.toLowerCase();
      if (label && !["all", "unlabeled"].includes(key) && !lists.has(key)) lists.set(key, label);
    }
    return [...lists.values()];
  }, [data.clients]);
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
    [contactsCollapsed, setContactsCollapsed] = useState(false),
    [bulkStage, setBulkStage] = useState("Lead"),
    [bulkLabel, setBulkLabel] = useState<ContactLabel>("Client");
  const [editingContact, setEditingContact] = useState<string | null>(null);
  useEffect(() => { setEditingContact(null); }, [selectedClient]);
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
    [showAppleImport, setShowAppleImport] = useState(false),
    [showListImport, setShowListImport] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [composer, setComposer] = useState(""),
    [attachmentNames, setAttachmentNames] = useState<string[]>([]),
    [deviceOnline, setDeviceOnline] = useState(false),
    [syncEnabled, setSyncEnabled] = useState<boolean | null>(null),
    [lastMacCheck, setLastMacCheck] = useState<string | null>(null),
    [refreshingInbox, setRefreshingInbox] = useState(false),
    [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null),
    [integrationBusy, setIntegrationBusy] = useState(false);
  const [history, setHistory] = useState<Message[]>([]),
    [detailMessages, setDetailMessages] = useState<Message[]>([]),
    [historyMore, setHistoryMore] = useState(false),
    [historyError, setHistoryError] = useState(""),
    [loadingHistory, setLoadingHistory] = useState(false),
    [sending, setSending] = useState(false);
  const [submittedMessages, setSubmittedMessages] = useState<SubmittedMessage[]>([]);
  const [historyPermission, setHistoryPermission] = useState<{ id: string; value: HistoryPermission } | null>(null);
  const [historyReview, setHistoryReview] = useState<{ id: string; name: string; permission: HistoryPermission } | null>(null);
  const [savingHistoryRange, setSavingHistoryRange] = useState(false);
  const [historyReviewError, setHistoryReviewError] = useState("");
  const refreshOpenThread = useRef<(() => Promise<void>) | null>(null);
  const [readReceipts, setReadReceipts] = useState<Record<string, string>>({});
  const hasPagedHistory = useRef(false);
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
    setSyncEnabled(state.preferences?.sync_enabled ?? false);
    const latestCheck = state.devices.find((device) => device.status === "connected")?.last_seen_at;
    if (latestCheck) setLastMacCheck(latestCheck);
    setDeviceOnline(
      hasMacBridge() || state.devices.some(
        (d) =>
          ["connected", "syncing", "idle"].includes(d.status) &&
          Date.now() - Date.parse(d.last_seen_at) < 70000,
      ),
    );

    if (gmail) setGmailStatus(gmail);
    return state.preferences?.sync_enabled ?? false;
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
          last_incoming_at: null,
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
  const conversationContact = activeConversation && clientsById[activeConversation.client_id];
  const readAtFor = (conversation: Conversation | undefined) =>
    Math.max(
      Date.parse(conversation?.last_read_at ?? "") || 0,
      Date.parse(readReceipts[conversation?.id ?? ""] ?? "") || 0,
    );
  const activeReadAt = useRef(0);
  activeReadAt.current = readAtFor(activeConversation);
  const activeContactRef = useRef<string | undefined>(undefined);
  activeContactRef.current = activeConversation?.client_id;
  const latestSubmittedByContact = new Map(submittedMessages.map((message) => [message.client_id, message]));
  function selectConversation(conversation: Conversation) {
    setInboxContact(null);
    setEmailClient(conversation.channel === "email" ? clientsById[conversation.client_id] ?? null : null);
    setSelectedConversation(conversation.id);
    if (activeConversation?.id !== conversation.id) {
      setComposer("");
      void clearAttachments();
    }
  }
  const recipientQuery = recipientSearch.trim().toLowerCase();
  const recipientDigits = recipientQuery.replace(/\D/g, "");
  const matchingRecipients = showContactPicker
    ? data.clients.filter((client) => (client.phone || client.email) &&
        (`${displayName(client)} ${client.email ?? ""}`.toLowerCase().includes(recipientQuery) ||
          (/^[\d\s+().-]+$/.test(recipientQuery) && recipientDigits &&
            client.phone?.replace(/\D/g, "").includes(recipientDigits))))
        .sort((a, b) => displayName(a).localeCompare(displayName(b)))
    : [];
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
    setAttachmentNames([]);
    sendAttempt.current = undefined;
    setShowTemplates(false);
  }, [activeConversation?.client_id]);
  const thread: (Message | SubmittedMessage)[] = history.filter(
    (m) => m.client_id === activeConversation?.client_id,
  );
  const syncedOutgoing = thread.filter((m) => m.direction === "outgoing");
  for (const submitted of submittedMessages) {
    if (submitted.client_id !== activeConversation?.client_id) continue;
    const match = syncedOutgoing.findIndex((m) => {
      const timestamp = Date.parse(m.sent_at ?? "");
      return m.body === submitted.body && timestamp >= submitted.startedAt - 2000 &&
        timestamp <= Date.parse(submitted.created_at) + 120_000;
    });
    if (match >= 0) syncedOutgoing.splice(match, 1);
    else thread.push(submitted);
  }
  thread.sort((a, b) => (a.sent_at ?? a.created_at).localeCompare(b.sent_at ?? b.created_at));
  const activeHistoryPermission =
    historyPermission?.id === activeConversation?.client_id ? historyPermission?.value : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const recentDay = new Date(today);
  recentDay.setDate(today.getDate() - 6);
  const filteredContacts = data.clients
    .filter(
      (c) =>
        (contactFilter === "All" ||
          (contactFilter === "Unlabeled"
            ? !c.contact_labels.length
            : clientStage(c.id).trim().toLowerCase() === contactFilter.toLowerCase() ||
              c.contact_labels.some(label => label.trim().toLowerCase() === contactFilter.toLowerCase()))) &&
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
        permission?: HistoryPermission | null;
      }>(q, undefined, abort.current.signal, userId);
      return {
        more: result.more,
        permission: result.permission ?? null,
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
    const id = selectedConversation ? activeConversation?.client_id : undefined;
    if (!id || area !== "Inbox" || emailClient) {
      setHistory([]);
      return;
    }
    let active = true;
    let markingRead = false;
    let acknowledgedAt = 0;
    setHistory([]);
    setHistoryError("");
    setHistoryMore(false);
    setHistoryPermission(null);
    hasPagedHistory.current = false;
    const refresh = async () => {
      const result = await historyPage(id);
      if (!active) return;
      setHistoryPermission(result.permission ? { id, value: result.permission } : null);
      setHistoryError("");
      if (!hasPagedHistory.current) setHistoryMore(result.more);
      setHistory((current) => {
        const merged = new Map(current.map((message) => [message.id, message]));
        result.messages.forEach((message) => merged.set(message.id, message));
        return [...merged.values()].sort((a, b) =>
          (a.sent_at ?? a.created_at).localeCompare(b.sent_at ?? b.created_at),
        );
      });
      if (document.visibilityState !== "visible" || !stickToLatest.current || markingRead) return;
      let latestIncoming: Message | undefined;
      let latestIncomingAt = Math.max(activeReadAt.current, acknowledgedAt);
      for (const message of result.messages) {
        const timestamp = Date.parse(message.sent_at ?? message.imported_at ?? "");
        if (message.direction === "incoming" && timestamp > latestIncomingAt) {
          latestIncoming = message;
          latestIncomingAt = timestamp;
        }
      }
      if (!latestIncoming) return;
      markingRead = true;
      try {
        const receipt = await cocoApi<{ last_read_at: string }>(
          userId, workspaceId, "read", { id, messageId: latestIncoming.id }, abort.current.signal,
        );
        const receiptAt = Date.parse(receipt.last_read_at);
        acknowledgedAt = receiptAt;
        if (alive.current) {
          setReadReceipts((current) => Date.parse(current[id] ?? "") >= receiptAt
            ? current
            : { ...current, [id]: receipt.last_read_at });
        }
      } catch {
        // Keep the unread dot until a later refresh can save the receipt.
      } finally {
        markingRead = false;
      }
    };
    refreshOpenThread.current = refresh;
    void refresh().catch((e) => {
      if (active) setHistoryError((e as Error).message);
    });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        void refresh().catch(() => {});
    }, 10000);
    return () => {
      active = false;
      refreshOpenThread.current = null;
      clearInterval(timer);
    };
  }, [activeConversation?.client_id, selectedConversation, area, emailClient, userId, workspaceId, historyPage]); // History is paged independently from the contact list.
  async function refreshInbox() {
    if (refreshingInbox) return;
    setRefreshingInbox(true);
    setError("");
    setNotice("");
    try {
      const connections = loadConnections();
      const sync = connections.then(async (enabled) => {
        if (!hasMacBridge() || !enabled) return false;
        await macNative("sync-now");
        return true;
      });
      const results = await Promise.allSettled([
        sync,
        loadData(),
        refreshOpenThread.current?.(),
      ]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      setNotice(results[0].status === "fulfilled" && results[0].value
        ? "Mac sync requested. New messages will appear as they sync."
        : "Conversations refreshed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshingInbox(false);
    }
  }
  async function approveRecentHistory() {
    if (!historyReview || savingHistoryRange) return;
    setSavingHistoryRange(true);
    setHistoryReviewError("");
    try {
      await macApi("", {
        action: "contact-permission", workspaceId, contactId: historyReview.id,
        enabled: true, identifiers: historyReview.permission.identifiers, history: "30d",
      }, abort.current.signal, userId);
      setHistoryReview(null);
      if (hasMacBridge() && syncEnabled) await refreshInbox();
      else setNotice("History permission saved. Open WolfGrid on your Mac with Messages sync enabled to import it.");
    } catch (e) {
      setHistoryReviewError((e as Error).message);
    } finally {
      setSavingHistoryRange(false);
    }
  }
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
      hasPagedHistory.current = true;
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
      setContactFilter("All");
      setSearch("");
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
    if (!activeConversation || sending || !composer.trim()) return;
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
    const requestId = sendAttempt.current.id;
    const startedAt = Date.now();
    setError("");
    setNotice("");
    setSending(true);
    try {
      const result = await macNative<{ accepted: boolean }>("message-send", {
        userId,
        workspaceId,
        contactId: client.id,
        body: composer,
        requestId,
      });
      if (result.accepted) {
        const timestamp = new Date().toISOString();
        setSubmittedMessages((current) => [...current, {
          id: `submitted:${requestId}`, client_id: client.id, conversation_id: activeConversation.id,
          direction: "outgoing", body: composer, body_status: "plain", sent_at: timestamp,
          created_at: timestamp, attachments: [], attachmentNames, startedAt,
        }]);
        if (activeContactRef.current === client.id) {
          stickToLatest.current = true;
          setComposer("");
          setAttachmentNames([]);
          sendAttempt.current = undefined;
        }
        if (syncEnabled) void macNative("sync-now").catch(() => {});
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
          <div className={`contacts-workspace ${contactsCollapsed ? "contacts-collapsed" : ""}`}>
            <aside className="contacts-browser" aria-label="Leads">
              <button
                className="contacts-collapse-button"
                aria-label={contactsCollapsed ? "Show contact list" : "Hide contact list"}
                title={contactsCollapsed ? "Show contact list" : "Hide contact list"}
                onClick={() => setContactsCollapsed(value => !value)}
              >
                {contactsCollapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
              </button>
              <div className="contacts-browser-content" hidden={contactsCollapsed}>
                <header className="contacts-search-header">
                  <label className="contacts-search-input">
                    <Search size={14} aria-hidden="true" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label="Search contacts"
                      placeholder="Search contacts..."
                    />
                  </label>
                  <button className="contacts-create-button" aria-label="Add contact" title="Add contact" onClick={() => setShowAddClient(true)}>
                    <Plus size={16} />
                  </button>
                </header>
                <div className="contacts-filter-tabs" role="group" aria-label="Contact filters">
                  <button aria-pressed={contactFilter === "All"} onClick={() => setContactFilter("All")}>
                    All ({data.clients.length})
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className={contactFilter !== "All" ? "is-active" : ""} aria-label={contactFilter === "All" ? "Filter contacts" : `Filter contacts: ${contactFilter}`}>
                        <span>{contactFilter === "All" ? "Filter" : contactFilter}</span><ChevronDown size={14} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuRadioGroup value={contactFilter} onValueChange={setContactFilter}>
                        <DropdownMenuRadioItem value="All">All</DropdownMenuRadioItem>
                        {[...availableLists, "Unlabeled"].map(list => (
                          <DropdownMenuRadioItem key={list} value={list}>{list}</DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="page-body contacts-list-body">
                  <div className="contacts-list-summary">
                    <span className="count-label" aria-live="polite">{filteredContacts.length} contacts</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild><button className="contacts-import-button">Import <ChevronDown size={12} /></button></DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setShowListImport(true)}>Import a list (CSV)</DropdownMenuItem>
                        <DropdownMenuItem disabled={integrationBusy} onSelect={() => setShowGmailImport(true)}>Google (Gmail)</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void importAppleContacts()}>Apple</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                            <OutreachTools clients={data.clients.filter(client => selectedContacts.includes(client.id))} userId={userId} workspaceId={workspaceId} onSaved={loadData} />
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
              </div>
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
                        <div className="contact-profile-toolbar">
                          <button className="back-button" onClick={() => { setSelectedClient(null); setEditingContact(null); }}><ArrowLeft size={17} /> All contacts</button>
                          <button className="contact-edit-button" aria-label="Edit contact" disabled={editingContact === client.id} onClick={() => setEditingContact(client.id)}>{editingContact === client.id ? "Editing" : "Edit"}</button>
                        </div>
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
                          {editingContact === client.id ? <>
                          <span className="eyebrow">THE DETAILS</span>
                          <h2>About {client.first_name}</h2>
                          <ContactDetailsEditor
                            key={client.id}
                            client={client}
                            userId={userId}
                            onSaved={async () => { await loadData(); setEditingContact(null); }}
                            onCancel={() => setEditingContact(null)}
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
                          </> : <>
                          <div className="contact-read-fields">
                            {client.phone && <a className="contact-info-row" href={`tel:${encodeURIComponent(client.phone)}`}><span><small>mobile</small><strong>{client.phone}</strong></span><Phone size={17} /></a>}
                            {client.email && <button className="contact-info-row" onClick={() => openContactInbox(client, "email")}><span><small>email</small><strong>{client.email}</strong></span><Mail size={17} /></button>}
                            {client.address && <div className="contact-info-row"><span><small>address</small><strong>{client.address}</strong></span></div>}
                            <button className="contact-info-row contact-note-row" onClick={() => setEditingContact(client.id)}><span><small>Notes</small><span className={client.notes ? "contact-note-text" : "contact-note-placeholder"}>{client.notes || "Add a note"}</span></span></button>
                            <div className="contact-info-row"><span><small>Lists</small><span>{[...new Set([clientStage(client.id), ...client.contact_labels])].join(" · ")}</span></span></div>
                            {client.next_follow_up_at && <div className="contact-info-row"><span><small>Next follow-up</small><span>{new Date(client.next_follow_up_at).toLocaleString()}</span></span></div>}
                          </div>
                          </>}
                          {clientDeals.some(deal => deal.client_id === client.id) && <div className="notes-block">
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
                          </div>}
                        </section>
                        <RelationshipPanel key={`${userId}:${workspaceId}:${client.id}`} client={client} userId={userId} tasks={clientTasks} messages={detailMessages.filter(message => message.client_id === client.id)} onSaved={loadData} />
                        <details className="contact-crm-extras"><summary>Conversations & tasks</summary>
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
                                  <p>{message.body ? <MessageBody body={message.body} showPreview={false} /> : "Attachment"}</p>
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
                        </details>
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
                <div className="conversation-toolbar">
                  <div className="conversation-search-row">
                    <label className="search-field">
                      <Search size={17} />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search conversations"
                      />
                    </label>
                    <Dialog open={showContactPicker} onOpenChange={(open) => {
                      if (open) setRecipientSearch("");
                      setShowContactPicker(open);
                    }}>
                      <DialogTrigger asChild>
                        <button type="button" className="new-conversation-button" aria-label="New conversation" title="New conversation">
                          <SquarePen size={19} aria-hidden="true" />
                        </button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>New conversation</DialogTitle>
                          <DialogDescription>Choose a contact to open their conversation.</DialogDescription>
                        </DialogHeader>
                        <input
                          className="rounded-lg border bg-background px-3 py-2 text-base"
                          aria-label="Find a recipient"
                          placeholder="Search by name, phone or email"
                          value={recipientSearch}
                          onChange={(e) => setRecipientSearch(e.target.value)}
                        />
                        <ul className="max-h-[min(45dvh,24rem)] overflow-y-auto">
                          {matchingRecipients.map((client) => (
                            <li key={client.id}>
                              <button type="button" className="grid w-full gap-1 rounded-lg px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent"
                                onClick={() => {
                                  const conversation = sortedConversations.find((c) => c.client_id === client.id);
                                  if (!conversation) return;
                                  selectConversation(conversation);
                                  setSearch("");
                                  setShowContactPicker(false);
                                }}>
                                <span className="font-medium">{displayName(client)}</span>
                                <span className="truncate text-sm text-muted-foreground">{client.phone || client.email}</span>
                              </button>
                            </li>
                          ))}
                          {matchingRecipients.length === 0 && (
                            <li className="px-3 py-2 text-sm text-muted-foreground">
                              {recipientQuery ? "No matching contacts." : "Add a phone number or email to a contact first."}
                            </li>
                          )}
                        </ul>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <div className="conversation-sync">
                    <span>
                      {syncEnabled && lastMacCheck && Date.now() - Date.parse(lastMacCheck) < 70_000 && (
                        <span className="conversation-recent-dot" role="img" aria-label="Mac checked recently" />
                      )}
                      Last updated {lastMacCheck ? (
                        <time dateTime={lastMacCheck} title={new Date(lastMacCheck).toLocaleString()}>
                          {new Date(lastMacCheck).toDateString() === new Date().toDateString()
                            ? formatTime(lastMacCheck)
                            : formatShort(lastMacCheck)}
                        </time>
                      ) : "—"}
                      {syncEnabled === false && " · Sync paused"}
                    </span>
                  </div>
                </div>
                <div className="conversation-scroll">
                  {sortedConversations
                    .filter((conversation) =>
                      conversationName(conversation)
                        .toLowerCase()
                        .includes(search.toLowerCase()),
                    )
                    .map((conversation) => {
                      const submitted = latestSubmittedByContact.get(conversation.client_id);
                      const showSubmitted = submitted && (!conversation.last_message_at ||
                        Date.parse(submitted.created_at) > Date.parse(conversation.last_message_at) + 2000);
                      const lastAt = showSubmitted ? submitted.sent_at : conversation.last_message_at;
                      const recent = lastAt && Date.now() - Date.parse(lastAt) < 86_400_000;
                      const unread = Date.parse(conversation.last_incoming_at ?? "") > readAtFor(conversation);
                      return (
                        <button
                          key={conversation.id}
                          className={`conversation-row ${activeConversation?.id === conversation.id ? "selected" : ""}`}
                          onClick={() => selectConversation(conversation)}
                        >
                          {unread && <span className="unread-dot" role="img" aria-label="Unread messages" />}
                          <Avatar name={conversationName(conversation)} />
                          <span className="conversation-preview">
                            <span>
                              <strong>{conversationName(conversation)}</strong>
                              <time dateTime={lastAt ?? undefined}>
                                {recent && <span className="conversation-recent-dot" role="img" aria-label="Active in the last 24 hours" />}
                                {recent ? formatTime(lastAt) : formatShort(lastAt)}
                              </time>
                            </span>
                            <small>
                              {(showSubmitted ? submitted.body : conversation.preview) ?? "Attachment"}
                            </small>
                          </span>
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
                {!emailClient && (
                  <div className="thread-header messages-contact-header">
                    <div className="thread-actions">
                      {activeConversation && (
                        <button
                          type="button"
                          className="thread-back"
                          aria-label="Back to conversations"
                          onClick={() => {
                            setSelectedConversation(null);
                            setInboxContact(null);
                          }}
                        >
                          <ArrowLeft size={20} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="thread-refresh"
                        aria-label="Refresh conversations"
                        title="Refresh conversations"
                        disabled={refreshingInbox}
                        onClick={() => void refreshInbox()}
                      >
                        {refreshingInbox
                          ? <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                          : <RefreshCw size={15} aria-hidden="true" />}
                      </button>
                    </div>
                    {activeConversation && conversationContact && (
                      <ConversationContactCard
                        key={conversationContact.id}
                        client={conversationContact}
                        connection={`${activeConversation.channel.toUpperCase()} · ${deviceOnline ? "Mac connected" : "Mac offline"}`}
                        onOpenClient={() => openClient(conversationContact.id)}
                        onEmail={() => openContactInbox(conversationContact, "email")}
                      />
                    )}
                    {activeConversation && (
                      <a className="messages-phone-call" aria-label="Call conversation contact" title="Call" aria-disabled={!conversationContact?.phone} href={conversationContact?.phone ? `tel:${encodeURIComponent(conversationContact.phone)}` : undefined}><Phone size={19} /></a>
                    )}
                  </div>
                )}
                {emailClient ? (
                  <EmailComposer
                    key={emailClient.id}
                    inline
                    client={emailClient}
                    workspaceId={workspaceId}
                    from={gmailStatus?.email ?? null}
                    canSend={Boolean(gmailStatus?.can_send)}
                    configured={gmailStatus?.configured !== false}
                    onConnect={() => void connectGmail(true)}
                    onClose={() => {
                      setEmailClient(null);
                      setInboxContact(null);
                      setSelectedConversation(null);
                    }}
                  />
                ) : activeConversation ? (
                  <>
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
                      {!thread.length && <div className="thread-date">
                        {activeHistoryPermission?.history_range === "future"
                            ? <>
                                <p>Only new messages are synced{activeHistoryPermission.import_after
                                  ? ` since ${new Date(activeHistoryPermission.import_after).toLocaleString()}`
                                  : ""}.</p>
                                <button type="button" className="conversation-history-button"
                                  onClick={() => {
                                    setHistoryReviewError("");
                                    setHistoryReview({ id: activeConversation.client_id, name: conversationName(activeConversation), permission: activeHistoryPermission });
                                  }}>
                                  Import recent history
                                </button>
                              </>
                            : "No synced messages yet."}
                      </div>}
                      {thread.map((message, index) => {
                        const date = new Date(message.sent_at ?? "");
                        const previousDate = new Date(thread[index - 1]?.sent_at ?? "");
                        const startsDay = Number.isFinite(date.getTime()) &&
                          date.toDateString() !== previousDate.toDateString();
                        return (
                          <Fragment key={message.id}>
                            {startsDay && (
                              <time className="thread-date thread-day" dateTime={date.toISOString()}>
                                {formatThreadDay(date, today, yesterday, recentDay)} {formatTime(message.sent_at)}
                              </time>
                            )}
                            <div className={`bubble-wrap ${message.direction}`}>
                              <div className="bubble">
                                {message.direction === "incoming" &&
                                  (activeConversation.participants?.length ?? 0) >
                                    1 && (
                                    <small>
                                      {message.sender_identifier ||
                                        "Unknown sender"}
                                    </small>
                                  )}
                                {message.body ? <MessageBody body={message.body} /> : (
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
                                {"attachmentNames" in message && message.attachmentNames.map((name, index) => (
                                  <small className="submitted-attachment" key={index}>{name}</small>
                                ))}
                              </div>
                              <small>
                                {formatTime(message.sent_at)}
                                {"startedAt" in message && " · Submitted to Messages"}
                              </small>
                            </div>
                          </Fragment>
                        );
                      })}
                    </div>
                    <div className="composer-area">
                      {attachmentNames.length > 0 && (
                        <div className="pending-attachments">
                          <span>{attachmentNames.join(", ")}</span>
                          <button
                            className="clear-attachments"
                            aria-label="Remove attachments"
                            disabled={sending}
                            onClick={() => void clearAttachments()}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      )}
                      <div className="composer-row">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button className="attachment-button" aria-label="Add to message" title="Templates and attachments" disabled={sending}>
                              <Plus size={20} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" side="top">
                            <DropdownMenuItem onSelect={() => setShowTemplates(true)}>Templates</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void chooseAttachments()}>Attachments</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <div className="composer" data-draft={composer}>
                          <textarea
                            aria-label="Message draft"
                            aria-description="Press Enter to send or Shift+Enter for a new line."
                            placeholder="Write a message…"
                            rows={1}
                            enterKeyHint="send"
                            value={composer}
                            readOnly={sending}
                            onChange={(e) => setComposer(e.target.value)}
                            onKeyDown={(event) => {
                              if (
                                event.key !== "Enter" || event.shiftKey || event.altKey ||
                                event.ctrlKey || event.metaKey || event.nativeEvent.isComposing ||
                                event.keyCode === 229
                              ) return;
                              event.preventDefault();
                              if (!event.repeat) void sendMessage();
                            }}
                          />
                        </div>
                      </div>
                      {!deviceOnline && (
                        <p className="composer-note">Your Mac is offline. Drafts stay in this session until you reconnect.</p>
                      )}
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
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="contact-task-title" onClick={(event) => event.stopPropagation()}>
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
              <h2 id="contact-task-title">{showAddClient ? "Add Contact" : "Add a task"}</h2>
              {showAddClient && (
                <div className="contact-import-options">
                  <button type="button" className="secondary" onClick={() => { setShowAddClient(false); setShowListImport(true); }}>Import a list (CSV)</button>
                  <button type="button" className="secondary" onClick={() => { setShowAddClient(false); void importAppleContacts(); }}>Choose from Apple Contacts</button>
                  <p className="muted">In WolfGrid for Mac, search and review Apple Contacts, skip or select people, add labels, then save your selection.</p>
                  <p className="muted">Or enter a contact below.</p>
                </div>
              )}
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
                  {showAddClient ? "Add Contact" : "Create task"}{" "}
                  <ArrowRight size={16} />
                </button>
              </form>
            </div>
          </div>
        )}
        {showListImport && (
          <ContactListImport
            userId={userId}
            workspaceId={workspaceId}
            onClose={() => setShowListImport(false)}
            onImported={loadData}
          />
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
        {historyReview && (
          <Dialog open onOpenChange={(open) => { if (!open && !savingHistoryRange) setHistoryReview(null); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import recent messages with {historyReview.name}?</DialogTitle>
                <DialogDescription>
                  WolfGrid will sync available one-to-one messages from the last 30 days and new messages going forward. This only changes history access for {historyReview.name}.
                </DialogDescription>
              </DialogHeader>
              {historyReviewError && <p role="alert">{historyReviewError}</p>}
              <button type="button" className="conversation-history-button" disabled={savingHistoryRange} onClick={() => void approveRecentHistory()}>
                {savingHistoryRange ? "Saving…" : "Import last 30 days"}
              </button>
            </DialogContent>
          </Dialog>
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
