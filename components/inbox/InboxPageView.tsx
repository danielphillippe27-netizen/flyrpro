'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle, Archive, ArrowLeft, Check, ChevronDown, ChevronUp, Loader2, Mail,
  MessageSquare, PhoneMissed, RefreshCw, Search, SendHorizontal, SquareCheckBig, UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';
import type { InboxItemSource, InboxItemStatus } from '@/types/database';

type ApiInboxItem = {
  id: string;
  source: InboxItemSource;
  direction: 'inbound' | 'outbound' | null;
  title: string;
  preview: string | null;
  body: string | null;
  fromLabel: string | null;
  fromEmail: string | null;
  fromPhone: string | null;
  toLabel: string | null;
  toEmail: string | null;
  toPhone: string | null;
  status: InboxItemStatus;
  occurredAt: string;
  readAt: string | null;
  contactId: string | null;
  href: string | null;
};

type InboxPayload = { items?: ApiInboxItem[]; error?: string };

type InboxThread = {
  id: string;
  source: InboxItemSource;
  subject: string;
  participant: string;
  participantAddress: string | null;
  contactId: string | null;
  href: string | null;
  messages: ApiInboxItem[];
  latest: ApiInboxItem;
  unreadCount: number;
  openCount: number;
};

const sourceFilters: Array<{ value: 'all' | 'email' | 'sms' | 'call'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'email', label: 'Emails' },
  { value: 'sms', label: 'Texts' },
  { value: 'call', label: 'Missed calls' },
];
const statusFilters: Array<{ value: 'open' | 'all'; label: string }> = [
  { value: 'open', label: 'Inbox' },
  { value: 'all', label: 'All mail' },
];
const SUBJECT_PREFIX_PATTERN = /^\s*((re|fw|fwd)\s*:\s*)+/i;

function sourceIcon(source: InboxItemSource) {
  if (source === 'email') return Mail;
  if (source === 'sms') return MessageSquare;
  if (source === 'call') return PhoneMissed;
  return AlertCircle;
}

function sourceLabel(source: InboxItemSource): string {
  if (source === 'email') return 'Email';
  if (source === 'sms') return 'Text';
  if (source === 'call') return 'Call';
  return 'Message';
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFullTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function normalizeSubject(value: string): string {
  return value.replace(SUBJECT_PREFIX_PATTERN, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function displaySubject(value: string): string {
  return value.replace(SUBJECT_PREFIX_PATTERN, '').replace(/\s+/g, ' ').trim() || '(no subject)';
}

function counterpartyAddress(item: ApiInboxItem): string | null {
  if (item.source === 'email') {
    return item.direction === 'outbound' ? item.toEmail ?? item.fromEmail : item.fromEmail ?? item.toEmail;
  }
  return item.direction === 'outbound' ? item.toPhone ?? item.fromPhone : item.fromPhone ?? item.toPhone;
}

function counterpartyName(item: ApiInboxItem): string {
  if (item.direction === 'outbound') {
    return item.toLabel || item.toEmail || item.toPhone || 'Unknown recipient';
  }
  return item.fromLabel || item.fromEmail || item.fromPhone || item.title || 'Unknown sender';
}

function threadKey(item: ApiInboxItem): string {
  const personKey = item.contactId || counterpartyAddress(item)?.trim().toLowerCase() || item.id;
  if (item.source === 'email') return `email:${personKey}:${normalizeSubject(item.title) || 'no-subject'}`;
  if (item.source === 'sms') return `sms:${personKey}`;
  return `${item.source}:${item.id}`;
}

function buildThreads(items: ApiInboxItem[]): InboxThread[] {
  const groups = new Map<string, ApiInboxItem[]>();
  for (const item of items) {
    const key = threadKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return Array.from(groups.entries())
    .map(([id, groupedMessages]) => {
      const messages = groupedMessages.toSorted(
        (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
      );
      const latest = messages[messages.length - 1];
      const inbound = messages.toReversed().find((message) => message.direction !== 'outbound');
      const identityMessage = inbound ?? latest;
      return {
        id,
        source: latest.source,
        subject: latest.source === 'email' ? displaySubject(latest.title) : counterpartyName(identityMessage),
        participant: counterpartyName(identityMessage),
        participantAddress: counterpartyAddress(identityMessage),
        contactId: messages.find((message) => message.contactId)?.contactId ?? null,
        href: messages.find((message) => message.href)?.href ?? null,
        messages,
        latest,
        unreadCount: messages.filter((message) => !message.readAt && message.status === 'open').length,
        openCount: messages.filter((message) => message.status === 'open').length,
      } satisfies InboxThread;
    })
    .toSorted((a, b) => new Date(b.latest.occurredAt).getTime() - new Date(a.latest.occurredAt).getTime());
}

function threadMatchesSearch(thread: InboxThread, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return thread.messages.some((item) => [
    thread.subject, thread.participant, thread.participantAddress, item.preview, item.body,
    item.fromLabel, item.fromEmail, item.fromPhone, item.toLabel, item.toEmail, item.toPhone,
  ].some((value) => value?.toLowerCase().includes(normalized)));
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

function replySubject(subject: string): string {
  return /^\s*re\s*:/i.test(subject) ? subject : `Re: ${subject}`;
}

export function InboxPageView() {
  const { currentWorkspaceId, currentWorkspace, isLoading: workspaceLoading } = useWorkspace();
  const [items, setItems] = useState<ApiInboxItem[]>([]);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'email' | 'sms' | 'call'>('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');
  const [query, setQuery] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [mobileListOpen, setMobileListOpen] = useState(true);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() => new Set());
  const [replyBody, setReplyBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyThreadId, setBusyThreadId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageScrollerRef = useRef<HTMLDivElement>(null);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);

  const loadInbox = useCallback(async () => {
    if (!currentWorkspaceId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspaceId: currentWorkspaceId, source: 'all', status: 'all', limit: '150' });
      const response = await fetch(`/api/inbox?${params.toString()}`, { credentials: 'include' });
      const payload = (await response.json().catch(() => ({}))) as InboxPayload;
      if (!response.ok) throw new Error(payload.error || 'Could not load inbox.');
      setItems(payload.items ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load inbox.');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    if (!workspaceLoading) void loadInbox();
  }, [loadInbox, workspaceLoading]);

  const threads = useMemo(() => buildThreads(items), [items]);
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: threads.length };
    for (const thread of threads) counts[thread.source] = (counts[thread.source] ?? 0) + 1;
    return counts;
  }, [threads]);
  const visibleThreads = useMemo(() => threads.filter((thread) =>
    (sourceFilter === 'all' || thread.source === sourceFilter) &&
    (statusFilter === 'all' || thread.openCount > 0) &&
    threadMatchesSearch(thread, query)
  ), [query, sourceFilter, statusFilter, threads]);
  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads]
  );
  const selectedLatestMessageId = selectedThread?.latest.id ?? null;
  const selectedMessageCount = selectedThread?.messages.length ?? 0;
  const selectedSource = selectedThread?.source ?? null;

  useEffect(() => {
    if (visibleThreads.length === 0) {
      setSelectedThreadId(null);
      return;
    }
    if (!selectedThreadId || !visibleThreads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(visibleThreads[0].id);
    }
  }, [selectedThreadId, visibleThreads]);

  useEffect(() => {
    if (!selectedThreadId || !selectedLatestMessageId) {
      setExpandedMessageIds(new Set());
      return;
    }
    setExpandedMessageIds(new Set([selectedLatestMessageId]));
    setReplyBody('');
  }, [selectedLatestMessageId, selectedThreadId]);

  useLayoutEffect(() => {
    if (!selectedThreadId) return;
    const frame = window.requestAnimationFrame(() => {
      const scroller = messageScrollerRef.current;
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      if (selectedSource === 'email') replyInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedMessageCount, selectedSource, selectedThreadId]);

  const patchItems = useCallback(async (
    thread: InboxThread,
    patch: { read?: boolean; status?: 'done' | 'open' | 'archived' }
  ) => {
    if (!currentWorkspaceId) return;
    const targets = thread.messages.filter((item) =>
      (patch.read && !item.readAt) || (patch.status && item.status !== patch.status)
    );
    if (targets.length === 0) return;
    setBusyThreadId(thread.id);
    setError(null);
    try {
      const responses = await Promise.all(targets.map((item) => fetch('/api/inbox', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ workspaceId: currentWorkspaceId, id: item.id, ...patch }),
      })));
      const failedResponse = responses.find((response) => !response.ok);
      if (failedResponse) {
        const payload = (await failedResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || 'Could not update this conversation.');
      }
      await loadInbox();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update this conversation.');
    } finally {
      setBusyThreadId(null);
    }
  }, [currentWorkspaceId, loadInbox]);

  const openThread = (thread: InboxThread) => {
    setSelectedThreadId(thread.id);
    setMobileListOpen(false);
    if (thread.unreadCount > 0) void patchItems(thread, { read: true });
  };

  const sendReply = useCallback(async () => {
    if (!currentWorkspaceId || !selectedThread || selectedThread.source !== 'email' || !replyBody.trim()) return;
    const recipient = selectedThread.participantAddress;
    if (!recipient) {
      setError('This conversation does not have a reply email address.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          channel: 'email',
          contactId: selectedThread.contactId,
          email: recipient,
          subject: replySubject(selectedThread.subject),
          body: replyBody.trim(),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; warning?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not send this reply.');
      setReplyBody('');
      if (payload.warning) setError(payload.warning);
      await loadInbox();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send this reply.');
    } finally {
      setSending(false);
    }
  }, [currentWorkspaceId, loadInbox, replyBody, selectedThread]);

  const toggleMessage = (messageId: string) => {
    setExpandedMessageIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-background px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
            <p className="truncate text-sm text-muted-foreground">
              {currentWorkspace?.name ? `${currentWorkspace.name} conversations` : 'Email, text, and call conversations'}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2 lg:max-w-2xl">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mail"
                aria-label="Search inbox" className="h-10 rounded-full bg-muted/60 pl-10" />
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => void loadInbox()}
              disabled={loading || !currentWorkspaceId} aria-label="Refresh inbox" title="Refresh inbox">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5">
          {statusFilters.map((filter) => (
            <Button key={filter.value} type="button" variant={statusFilter === filter.value ? 'default' : 'ghost'}
              size="sm" onClick={() => setStatusFilter(filter.value)} className="shrink-0 rounded-full">
              {filter.label}
            </Button>
          ))}
          <span className="h-5 w-px shrink-0 bg-border" />
          {sourceFilters.map((filter) => (
            <Button key={filter.value} type="button" variant={sourceFilter === filter.value ? 'secondary' : 'ghost'}
              size="sm" onClick={() => setSourceFilter(filter.value)} className="shrink-0 rounded-full">
              {filter.label}<span className="ml-1 text-xs text-muted-foreground">{sourceCounts[filter.value] ?? 0}</span>
            </Button>
          ))}
        </div>
      </header>

      {error ? <div className="mx-4 mt-3 shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-6">{error}</div> : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className={cn('min-h-0 w-full shrink-0 overflow-y-auto border-r border-border bg-background md:block md:w-[22rem] lg:w-[25rem]', !mobileListOpen && 'hidden')}
          aria-label="Conversation list">
          {loading && items.length === 0 ? (
            <div className="flex h-full min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Loading inbox
            </div>
          ) : visibleThreads.length === 0 ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2 px-6 text-center">
              <SquareCheckBig className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Nothing here</p>
              <p className="text-sm text-muted-foreground">New replies and conversations will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visibleThreads.map((thread) => {
                const Icon = sourceIcon(thread.source);
                const selected = thread.id === selectedThreadId;
                return (
                  <button key={thread.id} type="button" onClick={() => openThread(thread)}
                    className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring', selected && 'bg-muted', thread.unreadCount > 0 && 'bg-primary/[0.045]')}
                    aria-current={selected ? 'true' : undefined}>
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {thread.source === 'email' ? initials(thread.participant) : <Icon className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={cn('min-w-0 flex-1 truncate text-sm', thread.unreadCount > 0 ? 'font-semibold' : 'font-medium')}>{thread.participant}</span>
                        <span className={cn('shrink-0 text-xs text-muted-foreground', thread.unreadCount > 0 && 'font-medium text-foreground')}>{formatTimestamp(thread.latest.occurredAt)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className={cn('truncate text-sm', thread.unreadCount > 0 ? 'font-semibold' : 'text-muted-foreground')}>{thread.subject}</span>
                        {thread.messages.length > 1 ? <span className="shrink-0 text-xs text-muted-foreground">{thread.messages.length}</span> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                        {thread.latest.direction === 'outbound' ? 'You: ' : ''}{thread.latest.preview || thread.latest.body || sourceLabel(thread.source)}
                      </span>
                    </span>
                    {thread.unreadCount > 0 ? <span className="mt-6 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label={`${thread.unreadCount} unread`} /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className={cn('min-h-0 min-w-0 flex-1 flex-col bg-muted/20 md:flex', selectedThread && !mobileListOpen ? 'flex' : 'hidden')}>
          {!selectedThread ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <Mail className="h-10 w-10" /><p className="text-sm">Choose a conversation to read it.</p>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2 sm:px-4">
                <Button type="button" variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileListOpen(true)} aria-label="Back to inbox">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-base font-semibold">{selectedThread.subject}</h2>
                    {selectedThread.messages.length > 1 ? <Badge variant="secondary" className="shrink-0">{selectedThread.messages.length}</Badge> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{selectedThread.participantAddress || selectedThread.participant}</p>
                </div>
                {selectedThread.href ? <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex"><Link href={selectedThread.href}><UserRound className="h-4 w-4" />Contact</Link></Button> : null}
                {selectedThread.unreadCount > 0 ? (
                  <Button type="button" variant="ghost" size="icon" onClick={() => void patchItems(selectedThread, { read: true })}
                    disabled={busyThreadId === selectedThread.id} aria-label="Mark conversation read" title="Mark read"><Check className="h-4 w-4" /></Button>
                ) : null}
                <Button type="button" variant="ghost" size="icon" onClick={() => void patchItems(selectedThread, { status: 'done', read: true })}
                  disabled={busyThreadId === selectedThread.id || selectedThread.openCount === 0} aria-label="Archive conversation" title="Archive">
                  {busyThreadId === selectedThread.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                </Button>
              </div>

              <div ref={messageScrollerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6">
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
                  {selectedThread.messages.map((message) => {
                    const expanded = expandedMessageIds.has(message.id) || selectedThread.messages.length === 1;
                    const sender = message.direction === 'outbound' ? message.fromLabel || message.fromEmail || 'You' : message.fromLabel || message.fromEmail || message.fromPhone || selectedThread.participant;
                    const recipient = message.direction === 'outbound' ? message.toEmail || message.toPhone : message.toEmail || message.toPhone || 'you';
                    return (
                      <article key={message.id} className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
                        <button type="button" onClick={() => toggleMessage(message.id)}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-expanded={expanded}>
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">{message.direction === 'outbound' ? 'You' : initials(sender)}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate text-sm font-semibold">{sender}</span><span className="shrink-0 text-xs text-muted-foreground">{formatFullTimestamp(message.occurredAt)}</span></span>
                            <span className="block truncate text-xs text-muted-foreground">to {recipient || 'you'}{!expanded && (message.preview || message.body) ? ` · ${message.preview || message.body}` : ''}</span>
                          </span>
                          {expanded ? <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />}
                        </button>
                        {expanded ? <div className="border-t border-border/60 px-4 py-5 sm:px-14"><p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body || message.preview || '(No message body)'}</p></div> : null}
                      </article>
                    );
                  })}
                </div>
              </div>

              {selectedThread.source === 'email' ? (
                <div className="shrink-0 border-t border-border bg-background px-3 py-3 sm:px-6">
                  <div className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/30">
                    <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">Reply to <span className="font-medium text-foreground">{selectedThread.participantAddress || selectedThread.participant}</span></div>
                    <Textarea ref={replyInputRef} value={replyBody} onChange={(event) => setReplyBody(event.target.value)}
                      onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void sendReply(); } }}
                      placeholder="Write a reply…" aria-label={`Reply to ${selectedThread.participant}`} className="min-h-20 resize-none border-0 shadow-none focus-visible:ring-0" />
                    <div className="flex items-center justify-between gap-3 px-3 pb-3">
                      <span className="text-xs text-muted-foreground">⌘ Enter to send</span>
                      <Button type="button" size="sm" onClick={() => void sendReply()} disabled={sending || !replyBody.trim()}>
                        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}Send
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="shrink-0 border-t border-border bg-background px-4 py-3 text-center text-sm text-muted-foreground">
                  Open the contact to continue this {sourceLabel(selectedThread.source).toLowerCase()} conversation.
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
