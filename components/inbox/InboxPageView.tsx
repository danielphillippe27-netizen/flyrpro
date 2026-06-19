'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Archive, Check, Clock, Loader2, Mail, MessageSquare, PhoneMissed, RefreshCw, SearchCheck, SquareCheckBig } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';
import type { InboxItemSource, InboxItemStatus } from '@/types/database';

type ApiInboxItem = {
  id: string;
  source: InboxItemSource;
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

type InboxPayload = {
  items?: ApiInboxItem[];
  counts?: Record<string, number>;
  error?: string;
};

const sourceFilters: Array<{ value: 'all' | InboxItemSource; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'email', label: 'Emails' },
  { value: 'sms', label: 'Texts' },
  { value: 'call', label: 'Missed calls' },
  { value: 'task', label: 'Tasks' },
  { value: 'system', label: 'System' },
];

const statusFilters: Array<{ value: 'open' | 'all'; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
];

function sourceIcon(source: InboxItemSource) {
  if (source === 'email') return Mail;
  if (source === 'sms') return MessageSquare;
  if (source === 'call') return PhoneMissed;
  if (source === 'task') return Clock;
  return AlertCircle;
}

function sourceLabel(source: InboxItemSource): string {
  if (source === 'email') return 'Email';
  if (source === 'sms') return 'Text';
  if (source === 'call') return 'Call';
  if (source === 'task') return 'Task';
  return 'System';
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function itemMatchesSearch(item: ApiInboxItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    item.title,
    item.preview,
    item.body,
    item.fromLabel,
    item.fromEmail,
    item.fromPhone,
    item.toLabel,
    item.toEmail,
    item.toPhone,
  ].some((value) => value?.toLowerCase().includes(normalized));
}

export function InboxPageView() {
  const { currentWorkspaceId, currentWorkspace, isLoading: workspaceLoading } = useWorkspace();
  const [items, setItems] = useState<ApiInboxItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sourceFilter, setSourceFilter] = useState<'all' | InboxItemSource>('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    if (!currentWorkspaceId) {
      setItems([]);
      setCounts({});
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        workspaceId: currentWorkspaceId,
        source: sourceFilter,
        status: statusFilter,
        limit: '100',
      });
      const response = await fetch(`/api/inbox?${params.toString()}`, { credentials: 'include' });
      const payload = (await response.json().catch(() => ({}))) as InboxPayload;
      if (!response.ok) throw new Error(payload.error || 'Could not load inbox.');
      setItems(payload.items ?? []);
      setCounts(payload.counts ?? {});
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load inbox.');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, sourceFilter, statusFilter]);

  useEffect(() => {
    if (!workspaceLoading) void loadInbox();
  }, [loadInbox, workspaceLoading]);

  const visibleItems = useMemo(
    () => items.filter((item) => itemMatchesSearch(item, query)),
    [items, query]
  );

  const updateItem = async (item: ApiInboxItem, patch: { read?: boolean; status?: 'done' | 'open' | 'archived' }) => {
    if (!currentWorkspaceId) return;
    setBusyItemId(item.id);
    setError(null);
    try {
      const response = await fetch('/api/inbox', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          id: item.id,
          ...patch,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Could not update inbox item.');
      await loadInbox();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update inbox item.');
    } finally {
      setBusyItemId(null);
    }
  };

  return (
    <div className="min-h-full bg-background px-4 py-5 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Inbox</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {currentWorkspace?.name ? `${currentWorkspace.name} action queue` : 'Email, text, call, and task follow-up queue'}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadInbox()} disabled={loading || !currentWorkspaceId}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>

        <div className="grid gap-3 rounded-lg border border-border bg-card p-3 md:grid-cols-[1fr_auto]">
          <div className="relative">
            <SearchCheck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search person, email, phone, or message"
              className="h-10 pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {statusFilters.map((filter) => (
              <Button
                key={filter.value}
                type="button"
                variant={statusFilter === filter.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {sourceFilters.map((filter) => {
            const active = sourceFilter === filter.value;
            const count = counts[filter.value] ?? 0;
            return (
              <Button
                key={filter.value}
                type="button"
                variant={active ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSourceFilter(filter.value)}
                className="shrink-0"
              >
                {filter.label}
                <Badge variant="secondary" className={cn('ml-1.5', active && 'bg-background text-foreground')}>
                  {count}
                </Badge>
              </Button>
            );
          })}
        </div>

        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading inbox
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center gap-2 px-4 text-center">
                <SquareCheckBig className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Nothing open here</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  New email replies, texts, missed calls, and follow-up tasks will land here.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {visibleItems.map((item) => {
                  const Icon = sourceIcon(item.source);
                  const unread = !item.readAt && item.status === 'open';
                  const isBusy = busyItemId === item.id;
                  const content = (
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="gap-1">
                          <Icon className="h-3.5 w-3.5" />
                          {sourceLabel(item.source)}
                        </Badge>
                        {unread ? <Badge>Unread</Badge> : null}
                        <span className="text-xs text-muted-foreground">{formatTimestamp(item.occurredAt)}</span>
                      </div>
                      <div className="mt-2 flex flex-col gap-1">
                        <p className="truncate text-sm font-semibold">{item.title}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {item.fromLabel || item.fromEmail || item.fromPhone || 'Unknown'}{item.preview ? `: ${item.preview}` : ''}
                        </p>
                      </div>
                    </div>
                  );

                  return (
                    <div key={item.id} className={cn('flex gap-3 px-4 py-4', unread && 'bg-muted/50')}>
                      {item.href ? (
                        <Link href={item.href} className="flex min-w-0 flex-1 gap-3">
                          <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                            <Icon className="h-4 w-4" />
                          </span>
                          {content}
                        </Link>
                      ) : (
                        <div className="flex min-w-0 flex-1 gap-3">
                          <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                            <Icon className="h-4 w-4" />
                          </span>
                          {content}
                        </div>
                      )}
                      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
                        {!item.readAt && item.source !== 'task' ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void updateItem(item, { read: true })}
                            disabled={isBusy}
                          >
                            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            Read
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void updateItem(item, { status: 'done', read: true })}
                          disabled={isBusy || item.status === 'done'}
                        >
                          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                          Done
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
