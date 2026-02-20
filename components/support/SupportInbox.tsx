'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export type SupportThreadRow = {
  id: string;
  user_id: string;
  status: string;
  last_message_at: string;
  created_at: string;
  last_message_preview?: string | null;
  needs_reply?: boolean | null;
  unread_for_support?: boolean | null;
  profiles?: { email: string | null; full_name: string | null } | null;
};

export type SupportMessageRow = {
  id: string;
  thread_id: string;
  sender_type: string;
  sender_user_id: string | null;
  body: string;
  created_at: string;
};

type SupportInboxProps = {
  title?: string;
  description?: string;
};

export function SupportInbox({
  title = 'Support Inbox',
  description = 'Reply to user messages from the app',
}: SupportInboxProps) {
  const searchParams = useSearchParams();
  const threadFromQuery = useMemo(() => searchParams.get('thread'), [searchParams]);

  const [threads, setThreads] = useState<SupportThreadRow[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SupportMessageRow[]>([]);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = useCallback(async (showLoader = false) => {
    if (showLoader) setLoadingThreads(true);
    const supabase = createClient();
    const { data, error: threadsError } = await supabase
      .from('support_threads')
      .select(`
        id,
        user_id,
        status,
        last_message_at,
        created_at,
        last_message_preview,
        needs_reply,
        unread_for_support,
        profiles!support_threads_user_id_fkey ( email, full_name )
      `)
      .order('last_message_at', { ascending: false });

    if (showLoader) setLoadingThreads(false);
    if (threadsError) {
      setError(threadsError.message);
      return;
    }
    setThreads((data as SupportThreadRow[]) ?? []);
  }, []);

  const markThreadReadForSupport = useCallback(async (threadId: string) => {
    const supabase = createClient();
    await supabase.rpc('support_mark_thread_read_for_support', { p_thread_id: threadId });
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === threadId
          ? { ...thread, unread_for_support: false }
          : thread
      )
    );
  }, []);

  const loadMessages = useCallback(
    async (threadId: string, opts?: { markRead?: boolean }) => {
      const shouldMarkRead = opts?.markRead ?? true;
      setLoadingMessages(true);
      setSelectedThreadId(threadId);
      const supabase = createClient();
      const { data, error: msgError } = await supabase
        .from('support_messages')
        .select('id, thread_id, sender_type, sender_user_id, body, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true });

      setLoadingMessages(false);
      if (msgError) {
        setError(msgError.message);
        setMessages([]);
        return;
      }
      setMessages((data as SupportMessageRow[]) ?? []);
      if (shouldMarkRead) {
        await markThreadReadForSupport(threadId);
      }
    },
    [markThreadReadForSupport]
  );

  useEffect(() => {
    void loadThreads(true);
  }, [loadThreads]);

  useEffect(() => {
    if (!threadFromQuery || threads.length === 0) return;
    if (selectedThreadId === threadFromQuery) return;
    if (!threads.some((thread) => thread.id === threadFromQuery)) return;
    void loadMessages(threadFromQuery);
  }, [threadFromQuery, threads, selectedThreadId, loadMessages]);

  const sendReply = useCallback(async () => {
    if (!selectedThreadId || !replyBody.trim()) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const body = replyBody.trim();
    setSending(true);
    const { error: insertError } = await supabase.from('support_messages').insert({
      thread_id: selectedThreadId,
      sender_type: 'support',
      sender_user_id: user.id,
      body,
    });
    setSending(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setReplyBody('');
    await Promise.all([
      loadMessages(selectedThreadId, { markRead: false }),
      loadThreads(),
    ]);
  }, [selectedThreadId, replyBody, loadMessages, loadThreads]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('support-messages-live')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
        },
        (payload) => {
          const newRow = payload.new as SupportMessageRow;
          void loadThreads();
          if (newRow.thread_id === selectedThreadId) {
            setMessages((prev) => {
              if (prev.some((msg) => msg.id === newRow.id)) return prev;
              return [...prev, newRow];
            });
            if (newRow.sender_type === 'user') {
              void markThreadReadForSupport(newRow.thread_id);
            }
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedThreadId, loadThreads, markThreadReadForSupport]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-gray-50 dark:bg-background">
      <header className="shrink-0 border-b border-border bg-white dark:bg-card px-4 py-3">
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>

      {error ? (
        <div className="shrink-0 bg-destructive/10 text-destructive px-4 py-2 text-sm">
          {error}
        </div>
      ) : null}

      <div className="flex flex-1 min-h-0">
        <aside className="w-80 shrink-0 border-r border-border bg-white dark:bg-card flex flex-col overflow-hidden">
          {loadingThreads ? (
            <div className="p-4 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ul className="flex-1 overflow-y-auto p-2">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => void loadMessages(thread.id)}
                    className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
                      selectedThreadId === thread.id
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-muted/60 text-foreground'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium truncate">
                        {thread.profiles?.full_name || thread.profiles?.email || thread.user_id.slice(0, 8)}
                      </div>
                      <div className="flex gap-1">
                        {thread.unread_for_support ? <Badge variant="secondary">Unread</Badge> : null}
                        {thread.needs_reply ? <Badge>Needs reply</Badge> : null}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {thread.last_message_preview || thread.profiles?.email || thread.user_id}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(thread.last_message_at).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
              {threads.length === 0 && !loadingThreads ? (
                <li className="px-3 py-4 text-sm text-muted-foreground">No threads yet.</li>
              ) : null}
            </ul>
          )}
        </aside>

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {!selectedThreadId ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              Select a thread to view messages and reply.
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingMessages ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.sender_type === 'support' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                          message.sender_type === 'support'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-foreground'
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{message.body}</p>
                        <p className="text-xs opacity-70 mt-1">
                          {new Date(message.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="shrink-0 border-t border-border bg-white dark:bg-card p-3 flex gap-2">
                <Input
                  placeholder="Type your reply..."
                  value={replyBody}
                  onChange={(event) => setReplyBody(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendReply();
                    }
                  }}
                  className="flex-1"
                  disabled={sending}
                />
                <Button onClick={() => void sendReply()} disabled={sending || !replyBody.trim()}>
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
