'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type FeedbackThread = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  status: string;
  lastFeedbackAt: string;
  unreadForFounder: boolean;
};

type FeedbackItem = {
  id: string;
  threadId: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  type: 'bug' | 'feature' | 'other';
  title: string | null;
  body: string;
  createdAt: string;
  appVersion: string | null;
  buildNumber: string | null;
  iosVersion: string | null;
  deviceModel: string | null;
  screenName: string | null;
  screenshotUrl: string | null;
};

type FeedbackPayload = {
  kpis: { newFeedback: number };
  threads: FeedbackThread[];
  items: FeedbackItem[];
};

function displayUserName(userName: string | null, userEmail: string | null, userId: string): string {
  if (userName && userName.trim()) return userName;
  if (userEmail && userEmail.trim()) return userEmail;
  return userId.slice(0, 8);
}

async function readJson(url: string): Promise<FeedbackPayload> {
  const response = await fetch(url, { credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload && payload.error) || 'Failed to load feedback');
  }
  return payload as FeedbackPayload;
}

export function FeedbackInbox() {
  const searchParams = useSearchParams();
  const threadFromQuery = useMemo(() => searchParams.get('thread'), [searchParams]);
  const [threads, setThreads] = useState<FeedbackThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const markThreadRead = useCallback(async (threadId: string) => {
    const supabase = createClient();
    await supabase.rpc('feedback_mark_read', { p_thread_id: threadId });
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === threadId ? { ...thread, unreadForFounder: false } : thread
      )
    );
  }, []);

  const loadFeedback = useCallback(
    async (threadId?: string | null) => {
      setError(null);
      const threadQuery = threadId ? `&thread=${encodeURIComponent(threadId)}` : '';
      const payload = await readJson(`/api/admin/inbox/feedback?threadLimit=100&itemLimit=100${threadQuery}`);
      setThreads(payload.threads);
      setItems(payload.items);
    },
    []
  );

  useEffect(() => {
    setLoading(true);
    const initialThread = threadFromQuery ?? null;
    setSelectedThreadId(initialThread);
    loadFeedback(initialThread)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load feedback');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [threadFromQuery, loadFeedback]);

  const openThread = useCallback(
    async (threadId: string) => {
      setSelectedThreadId(threadId);
      setLoading(true);
      try {
        await loadFeedback(threadId);
        await markThreadRead(threadId);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load feedback thread');
      } finally {
        setLoading(false);
      }
    },
    [loadFeedback, markThreadRead]
  );

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('feedback-inbox-live')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'feedback_items',
        },
        () => {
          void loadFeedback(selectedThreadId);
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedThreadId, loadFeedback]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50 dark:bg-background">
      <header className="shrink-0 border-b border-border bg-white dark:bg-card px-4 py-3">
        <h1 className="text-xl font-bold text-foreground">iOS Feedback Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Review feature requests and bug reports sent from iOS.
        </p>
      </header>

      {error ? (
        <div className="shrink-0 bg-destructive/10 text-destructive px-4 py-2 text-sm">
          {error}
        </div>
      ) : null}

      <div className="flex flex-1 min-h-0">
        <aside className="w-80 shrink-0 border-r border-border bg-white dark:bg-card flex flex-col overflow-hidden">
          {loading ? (
            <div className="p-4 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ul className="flex-1 overflow-y-auto p-2">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => void openThread(thread.id)}
                    className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
                      selectedThreadId === thread.id
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-muted/60 text-foreground'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium truncate">
                        {displayUserName(thread.userName, thread.userEmail, thread.userId)}
                      </div>
                      {thread.unreadForFounder ? <Badge variant="secondary">New</Badge> : null}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(thread.lastFeedbackAt).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
              {threads.length === 0 ? (
                <li className="px-3 py-4 text-sm text-muted-foreground">No feedback threads yet.</li>
              ) : null}
            </ul>
          )}
        </aside>

        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-4 space-y-3">
          {!selectedThreadId ? (
            <div className="text-muted-foreground">Select a feedback thread to inspect details.</div>
          ) : loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="rounded-lg border bg-card px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-sm">{item.title || item.body.slice(0, 80)}</div>
                  <Badge variant="outline">{item.type}</Badge>
                </div>
                <div className="text-sm mt-2 whitespace-pre-wrap">{item.body}</div>
                <div className="text-xs text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  <span>{displayUserName(item.userName, item.userEmail, item.userId)}</span>
                  {item.screenName ? <span>Screen: {item.screenName}</span> : null}
                  {item.appVersion ? <span>App: {item.appVersion}</span> : null}
                  {item.buildNumber ? <span>Build: {item.buildNumber}</span> : null}
                  {item.iosVersion ? <span>iOS: {item.iosVersion}</span> : null}
                  {item.deviceModel ? <span>Device: {item.deviceModel}</span> : null}
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                </div>
                {item.screenshotUrl ? (
                  <a
                    className="inline-block text-xs text-primary underline mt-2"
                    href={item.screenshotUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open screenshot
                  </a>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
