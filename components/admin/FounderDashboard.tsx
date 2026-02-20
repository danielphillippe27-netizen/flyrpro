'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, MessageCircle, AlertTriangle, Bug, DollarSign } from 'lucide-react';

type SupportThreadPreview = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  status: string;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  lastSenderType: string | null;
  needsReply: boolean;
  unreadForSupport: boolean;
};

type SupportInboundPreview = {
  id: string;
  threadId: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  body: string;
  createdAt: string;
};

type SupportInboxPayload = {
  kpis: {
    unread: number;
    needsReply: number;
    openThreads: number;
  };
  threads: SupportThreadPreview[];
  latestInboundMessages: SupportInboundPreview[];
};

type FeedbackThreadPreview = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  status: string;
  lastFeedbackAt: string;
  unreadForFounder: boolean;
  createdAt: string;
};

type FeedbackItemPreview = {
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

type FeedbackInboxPayload = {
  kpis: {
    newFeedback: number;
  };
  threads: FeedbackThreadPreview[];
  items: FeedbackItemPreview[];
};

type SummaryPayload = {
  productHealth: {
    signups: { today: number; sevenDays: number };
    activeUsers: { today: number; sevenDays: number };
    sessions: { today: number; sevenDays: number };
    campaignsCreated: { today: number; sevenDays: number };
    crashes: { today: number | null; sevenDays: number | null; available: boolean };
  };
  revenue: {
    activePaidUsers: number;
    activePaidUsersStripe: number;
    activePaidUsersApple: number;
    trialStartsSevenDays: number;
    trialToPaidRolling14Days: number;
    trialToPaidRolling14DaysRate: number | null;
    estimatedMonthlyRevenue: {
      monthlyAmountCents: number | null;
      currency: string | null;
      stripeOnly: boolean;
      stripeSubscriptionCount: number;
      note: string;
    };
  };
  redFlags: {
    paymentIssues: Array<{
      workspaceId: string;
      workspaceName: string;
      ownerId: string | null;
      ownerEmail: string | null;
      ownerName: string | null;
      updatedAt: string;
    }>;
    repeatedErrors: Array<unknown>;
    churnedLastSevenDays: Array<{
      userId: string;
      source: string;
      updatedAt: string;
      userEmail: string | null;
      userName: string | null;
    }>;
  };
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'include' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload && payload.error) || `Request failed: ${response.status}`);
  }
  return payload as T;
}

function displayUserName(userName: string | null, userEmail: string | null, userId: string | null): string {
  if (userName && userName.trim().length > 0) return userName;
  if (userEmail && userEmail.trim().length > 0) return userEmail;
  return userId ? userId.slice(0, 8) : 'Unknown user';
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatMonthlyAmount(cents: number | null, currency: string | null): string {
  if (cents == null || !currency) return 'Not available';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function FounderDashboard() {
  const [support, setSupport] = useState<SupportInboxPayload | null>(null);
  const [feedback, setFeedback] = useState<FeedbackInboxPayload | null>(null);
  const [summary, setSummary] = useState<SummaryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSupport = useCallback(async () => {
    const payload = await readJson<SupportInboxPayload>('/api/admin/inbox/support');
    setSupport(payload);
  }, []);

  const loadFeedback = useCallback(async () => {
    const payload = await readJson<FeedbackInboxPayload>('/api/admin/inbox/feedback');
    setFeedback(payload);
  }, []);

  const loadSummary = useCallback(async () => {
    const payload = await readJson<SummaryPayload>('/api/admin/inbox/summary');
    setSummary(payload);
  }, []);

  const loadAll = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      await Promise.all([loadSupport(), loadFeedback(), loadSummary()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load founder dashboard');
    } finally {
      setLoading(false);
    }
  }, [loadFeedback, loadSummary, loadSupport]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('founder-dashboard-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
        },
        () => {
          void loadSupport();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'feedback_items',
        },
        () => {
          void loadFeedback();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadFeedback, loadSupport]);

  const revenueAmount = useMemo(
    () =>
      formatMonthlyAmount(
        summary?.revenue.estimatedMonthlyRevenue.monthlyAmountCents ?? null,
        summary?.revenue.estimatedMonthlyRevenue.currency ?? null
      ),
    [summary]
  );

  if (loading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading founder dashboard...
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Founder Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Who needs a reply now, and is the product healthy this week.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadAll()}>
          Refresh
        </Button>
      </header>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <section className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardHeader>
            <CardDescription>Unread</CardDescription>
            <CardTitle>{support?.kpis.unread ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Needs Reply</CardDescription>
            <CardTitle>{support?.kpis.needsReply ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Open Threads</CardDescription>
            <CardTitle>{support?.kpis.openThreads ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>New Feedback</CardDescription>
            <CardTitle>{feedback?.kpis.newFeedback ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Paying Users</CardDescription>
            <CardTitle>{summary?.revenue.activePaidUsers ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Monthly Revenue</CardDescription>
            <CardTitle>{revenueAmount}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              Support Inbox
            </CardTitle>
            <CardDescription>Latest threads and inbound user messages.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              {support?.threads.length ? (
                support.threads.map((thread) => (
                  <Link
                    key={thread.id}
                    href={`/admin/support?thread=${thread.id}`}
                    className="block rounded-md border p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-sm">
                        {displayUserName(thread.userName, thread.userEmail, thread.userId)}
                      </div>
                      <div className="flex gap-1">
                        {thread.unreadForSupport ? <Badge variant="secondary">Unread</Badge> : null}
                        {thread.needsReply ? <Badge>Needs reply</Badge> : null}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {thread.lastMessagePreview || 'No message preview'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDateTime(thread.lastMessageAt)}
                    </div>
                  </Link>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No support threads yet.</div>
              )}
            </div>

            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Latest inbound
              </div>
              {support?.latestInboundMessages.length ? (
                support.latestInboundMessages.map((message) => (
                  <Link
                    key={message.id}
                    href={`/admin/support?thread=${message.threadId}`}
                    className="block rounded-md border p-2 hover:bg-muted/50 transition-colors"
                  >
                    <div className="text-sm">
                      {displayUserName(message.userName, message.userEmail, message.userId)}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{message.body}</div>
                  </Link>
                ))
              ) : (
                <div className="text-sm text-muted-foreground">No inbound messages.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bug className="h-4 w-4" />
              iOS Feedback
            </CardTitle>
            <CardDescription>Recent bug reports and feature requests.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {feedback?.items.length ? (
              feedback.items.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/feedback?thread=${item.threadId}`}
                  className="block rounded-md border p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-sm truncate">
                      {item.title || item.body.slice(0, 70)}
                    </div>
                    <Badge variant="outline">{item.type}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.body}</div>
                  <div className="text-xs text-muted-foreground mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    <span>{displayUserName(item.userName, item.userEmail, item.userId)}</span>
                    {item.screenName ? <span>Screen: {item.screenName}</span> : null}
                    {item.appVersion ? <span>App: {item.appVersion}</span> : null}
                    {item.deviceModel ? <span>Device: {item.deviceModel}</span> : null}
                  </div>
                </Link>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No feedback items yet.</div>
            )}
            <div className="pt-2">
              <Link href="/admin/feedback">
                <Button variant="outline" size="sm">Open Feedback Inbox</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Product Health</CardTitle>
            <CardDescription>Today and rolling 7-day pulse.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">New signups</div>
              <div className="font-semibold">{summary?.productHealth.signups.today ?? 0} / {summary?.productHealth.signups.sevenDays ?? 0}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Active users</div>
              <div className="font-semibold">{summary?.productHealth.activeUsers.today ?? 0} / {summary?.productHealth.activeUsers.sevenDays ?? 0}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Sessions</div>
              <div className="font-semibold">{summary?.productHealth.sessions.today ?? 0} / {summary?.productHealth.sessions.sevenDays ?? 0}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Campaigns created</div>
              <div className="font-semibold">{summary?.productHealth.campaignsCreated.today ?? 0} / {summary?.productHealth.campaignsCreated.sevenDays ?? 0}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Revenue Snapshot
            </CardTitle>
            <CardDescription>Current paid users and monthly estimate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Active paid users</div>
              <div className="font-semibold">{summary?.revenue.activePaidUsers ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1">
                Stripe: {summary?.revenue.activePaidUsersStripe ?? 0} | Apple: {summary?.revenue.activePaidUsersApple ?? 0}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Trial starts (7d)</div>
              <div className="font-semibold">{summary?.revenue.trialStartsSevenDays ?? 0}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Trial → paid (14d rolling)</div>
              <div className="font-semibold">
                {summary?.revenue.trialToPaidRolling14Days ?? 0}
                {typeof summary?.revenue.trialToPaidRolling14DaysRate === 'number'
                  ? ` (${summary.revenue.trialToPaidRolling14DaysRate}%)`
                  : ''}
              </div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-muted-foreground">Monthly amount</div>
              <div className="font-semibold">{revenueAmount}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {summary?.revenue.estimatedMonthlyRevenue.note ?? 'No revenue note'}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Red Flags
            </CardTitle>
            <CardDescription>Potential issues to review quickly.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="font-medium mb-2">Payment issues</div>
              {summary?.redFlags.paymentIssues.length ? (
                <div className="space-y-2">
                  {summary.redFlags.paymentIssues.map((row) => (
                    <div key={row.workspaceId} className="rounded-md border p-2">
                      <div>{row.workspaceName}</div>
                      <div className="text-xs text-muted-foreground">
                        {displayUserName(row.ownerName, row.ownerEmail, row.ownerId)} • {formatDateTime(row.updatedAt)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground">No payment issues right now.</div>
              )}
            </div>
            <div>
              <div className="font-medium mb-2">Users churned in last 7 days</div>
              {summary?.redFlags.churnedLastSevenDays.length ? (
                <div className="space-y-2">
                  {summary.redFlags.churnedLastSevenDays.map((row) => (
                    <div key={`${row.userId}-${row.updatedAt}`} className="rounded-md border p-2">
                      <div>{displayUserName(row.userName, row.userEmail, row.userId)}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.source} • {formatDateTime(row.updatedAt)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-muted-foreground">No recent churn flagged.</div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
