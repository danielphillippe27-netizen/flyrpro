'use client';

/* eslint-disable @next/next/no-img-element */

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ImagePlus, Loader2, MessageCircle, RefreshCw, Send, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';

type MessengerMessage = {
  id: string;
  threadId: string;
  body: string | null;
  gifUrl: string | null;
  gifTitle: string | null;
  messageType: 'text' | 'gif' | 'mixed';
  createdAt: string;
  isMine: boolean;
  sender: {
    userId: string;
    salespersonId: string | null;
    name: string;
    avatarUrl: string | null;
  };
};

type MessengerPayload = {
  storageReady?: boolean;
  thread?: {
    id: string;
    title: string;
    last_message_preview: string | null;
  } | null;
  messages?: MessengerMessage[];
  error?: string;
};

const QUICK_GIFS = [
  {
    title: 'Let’s go',
    url: 'https://media.giphy.com/media/3o7aD2saalBwwftBIY/giphy.gif',
  },
  {
    title: 'Win',
    url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
  },
  {
    title: 'Fire',
    url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
  },
  {
    title: 'Nice',
    url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif',
  },
  {
    title: 'Boom',
    url: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif',
  },
  {
    title: 'Money',
    url: 'https://media.giphy.com/media/67ThRZlYBvibtdF9JH/giphy.gif',
  },
];

function formatMessageTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? 'S') + (parts[1]?.[0] ?? '');
}

function normalizeGifUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:') return null;
    if (!/\.(gif|webp)(\?|$)/i.test(url.pathname) && !url.hostname.includes('giphy')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sameDay(left: string, right: string): boolean {
  return new Date(left).toDateString() === new Date(right).toDateString();
}

function DateDivider({ value }: { value: string }) {
  return (
    <div className="flex items-center justify-center py-2">
      <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium text-muted-foreground">
        {new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value))}
      </span>
    </div>
  );
}

function MessageBubble({ message }: { message: MessengerMessage }) {
  return (
    <div className={cn('flex gap-2', message.isMine ? 'justify-end' : 'justify-start')}>
      {!message.isMine ? (
        <div className="mt-auto flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground">
          {message.sender.avatarUrl ? (
            <img src={message.sender.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            initials(message.sender.name)
          )}
        </div>
      ) : null}

      <div className={cn('max-w-[78%] space-y-1', message.isMine ? 'items-end' : 'items-start')}>
        {!message.isMine ? (
          <p className="px-1 text-[11px] font-medium text-muted-foreground">{message.sender.name}</p>
        ) : null}
        <div
          className={cn(
            'overflow-hidden rounded-[22px] px-3 py-2 shadow-sm',
            message.isMine
              ? 'rounded-br-md bg-[#007aff] text-white'
              : 'rounded-bl-md bg-muted text-foreground'
          )}
        >
          {message.gifUrl ? (
            <div className={cn('overflow-hidden rounded-[16px]', message.body ? 'mb-2' : '')}>
              <img
                src={message.gifUrl}
                alt={message.gifTitle ?? 'GIF'}
                className="max-h-48 w-full min-w-44 object-cover"
                loading="lazy"
              />
            </div>
          ) : null}
          {message.body ? <p className="whitespace-pre-wrap break-words text-sm leading-5">{message.body}</p> : null}
        </div>
        <p className={cn('px-1 text-[10px] text-muted-foreground', message.isMine ? 'text-right' : '')}>
          {formatMessageTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

export function SalespersonMessenger() {
  const { currentWorkspaceId } = useWorkspace();
  const [messages, setMessages] = useState<MessengerMessage[]>([]);
  const [body, setBody] = useState('');
  const [selectedGif, setSelectedGif] = useState<{ url: string; title: string } | null>(null);
  const [gifTrayOpen, setGifTrayOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [storageReady, setStorageReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (currentWorkspaceId) params.set('workspaceId', currentWorkspaceId);
    return params.toString();
  }, [currentWorkspaceId]);

  const loadMessages = useCallback(
    async (showLoader = false) => {
      if (showLoader) setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/salesperson/messenger${queryString ? `?${queryString}` : ''}`, {
          credentials: 'include',
        });
        const data = (await response.json().catch(() => null)) as MessengerPayload | null;
        if (!response.ok) {
          throw new Error(data?.error ?? 'Messenger failed to load');
        }
        setStorageReady(data?.storageReady !== false);
        setMessages(Array.isArray(data?.messages) ? data.messages : []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Messenger failed to load');
      } finally {
        if (showLoader) setLoading(false);
        else setLoading(false);
      }
    },
    [queryString]
  );

  useEffect(() => {
    void loadMessages(true);
  }, [loadMessages]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadMessages(false);
    }, 7000);
    return () => window.clearInterval(interval);
  }, [loadMessages]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({
      top: scrollerRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages.length]);

  const sendMessage = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const gifFromBody = normalizeGifUrl(body);
      const textBody = gifFromBody && !selectedGif ? '' : body.trim();
      const gif = selectedGif ?? (gifFromBody ? { url: gifFromBody, title: 'GIF' } : null);
      if (!textBody && !gif) return;

      setSending(true);
      setError(null);
      try {
        const response = await fetch('/api/salesperson/messenger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            workspaceId: currentWorkspaceId,
            body: textBody,
            gifUrl: gif?.url,
            gifTitle: gif?.title,
          }),
        });
        const data = (await response.json().catch(() => null)) as { message?: MessengerMessage; error?: string } | null;
        if (!response.ok) {
          throw new Error(data?.error ?? 'Message failed to send');
        }
        const sentMessage = data?.message;
        if (sentMessage) {
          setMessages((prev) => [...prev.filter((message) => message.id !== sentMessage.id), sentMessage]);
        }
        setBody('');
        setSelectedGif(null);
        setGifTrayOpen(false);
      } catch (sendError) {
        setError(sendError instanceof Error ? sendError.message : 'Message failed to send');
      } finally {
        setSending(false);
      }
    },
    [body, currentWorkspaceId, selectedGif]
  );

  return (
    <Card className="gap-0 overflow-hidden rounded-[28px] border border-border bg-card py-0 shadow-sm">
      <CardHeader className="border-b border-border/70 bg-gradient-to-r from-card via-card to-muted/40 px-4 py-3 !pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#007aff] text-white shadow-sm">
              <MessageCircle className="h-4 w-4" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-base font-semibold text-foreground">Sales Floor</h2>
                <Sparkles className="h-3.5 w-3.5 text-[#007aff]" />
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {messages.length ? `${messages.length} messages` : 'Live thread'}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => void loadMessages(false)}
            aria-label="Refresh messenger"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div ref={scrollerRef} className="h-[420px] overflow-y-auto bg-background/60 px-4 py-4">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !storageReady ? (
            <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">
              Messenger storage is not ready.
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center">
              <div className="rounded-3xl border border-dashed border-border bg-card/70 px-6 py-5">
                <MessageCircle className="mx-auto h-6 w-6 text-[#007aff]" />
                <p className="mt-2 text-sm font-medium text-foreground">Start the thread</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message, index) => (
                <div key={message.id} className="space-y-3">
                  {index === 0 || !sameDay(messages[index - 1].createdAt, message.createdAt) ? (
                    <DateDivider value={message.createdAt} />
                  ) : null}
                  <MessageBubble message={message} />
                </div>
              ))}
            </div>
          )}
        </div>

        {error ? (
          <div className="border-t border-border bg-destructive/10 px-4 py-2 text-xs text-destructive">
            {error}
          </div>
        ) : null}

        {gifTrayOpen ? (
          <div className="border-t border-border bg-muted/40 p-3">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {QUICK_GIFS.map((gif) => (
                <button
                  key={gif.url}
                  type="button"
                  className={cn(
                    'group overflow-hidden rounded-2xl border bg-card text-left shadow-sm transition',
                    selectedGif?.url === gif.url ? 'border-[#007aff] ring-2 ring-[#007aff]/25' : 'border-border hover:border-[#007aff]/60'
                  )}
                  onClick={() => setSelectedGif(gif)}
                  aria-label={gif.title}
                >
                  <img src={gif.url} alt="" className="h-20 w-full object-cover transition group-hover:scale-105" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {selectedGif ? (
          <div className="flex items-center gap-3 border-t border-border bg-card px-4 py-3">
            <div className="h-16 w-24 overflow-hidden rounded-2xl border border-border">
              <img src={selectedGif.url} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{selectedGif.title}</p>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => setSelectedGif(null)} aria-label="Remove GIF">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        <form onSubmit={sendMessage} className="flex items-end gap-2 border-t border-border bg-card p-3">
          <Button
            type="button"
            variant={gifTrayOpen ? 'default' : 'outline'}
            size="icon"
            onClick={() => setGifTrayOpen((open) => !open)}
            aria-label="GIFs"
          >
            <ImagePlus className="h-4 w-4" />
          </Button>
          <Input
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Message the floor..."
            className="h-11 rounded-full border-border bg-background px-4"
            maxLength={1200}
            disabled={!storageReady}
          />
          <Button
            type="submit"
            size="icon"
            className="h-11 w-11 rounded-full bg-[#007aff] text-white hover:bg-[#006ee6]"
            disabled={sending || !storageReady || (!body.trim() && !selectedGif)}
            aria-label="Send message"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
