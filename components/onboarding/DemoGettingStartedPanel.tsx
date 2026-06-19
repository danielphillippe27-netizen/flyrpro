'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  CheckCircle2,
  Circle,
  Contact,
  MapPinned,
  Play,
  Route,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';

type DemoRolePath = 'team_owner' | 'solo_owner' | 'member';

type DemoState = {
  id: string;
  workspace_id: string;
  user_id: string;
  role_path: DemoRolePath;
  seeded_campaign_id: string | null;
  completed_items: Record<string, boolean>;
  dismissed_at: string | null;
  starter_contact_count?: number;
};

type DemoStateResponse = {
  state?: DemoState;
};

type ChecklistItem = {
  id: string;
  label: string;
  href: string;
  icon: typeof MapPinned;
};

const CONTEXT_NUDGE_DISMISS_PREFIX = 'flyr:onboarding-demo:nudge-dismissed';

function checklistForState(state: DemoState): ChecklistItem[] {
  const campaignHref = state.seeded_campaign_id
    ? `/campaigns/${state.seeded_campaign_id}`
    : '/campaigns/create';

  if (state.role_path === 'team_owner') {
    return [
      { id: 'open_campaign', label: 'Open Salt Lake City replay', href: campaignHref, icon: MapPinned },
      { id: 'assign_campaign', label: 'Assign replay work', href: state.seeded_campaign_id ? `${campaignHref}?tab=assignments` : '/campaigns', icon: Route },
      { id: 'invite_members', label: 'Invite members', href: '/home?tab=settings', icon: UserPlus },
      { id: 'review_reporting', label: 'Review fake report', href: '/home?tab=reporting&demoReport=slc', icon: BarChart3 },
    ];
  }

  if (state.role_path === 'solo_owner') {
    return [
      { id: 'open_campaign', label: 'Open Salt Lake City replay', href: campaignHref, icon: MapPinned },
      { id: 'review_leads', label: 'Review replay leads', href: '/leads', icon: Contact },
      { id: 'record_session', label: 'Play replay session', href: campaignHref, icon: Play },
      { id: 'create_real_campaign', label: 'Create real campaign', href: '/campaigns/create', icon: Route },
    ];
  }

  return [
    { id: 'open_assignment', label: 'Open replay work', href: '/home', icon: Route },
    { id: 'record_outcomes', label: 'Record door outcomes', href: '/campaigns', icon: CheckCircle2 },
    { id: 'review_leads', label: 'Review leads', href: '/leads', icon: Contact },
    { id: 'check_stats', label: 'Check stats', href: '/stats', icon: BarChart3 },
  ];
}

function headingForRole(rolePath: DemoRolePath): string {
  if (rolePath === 'team_owner') return 'Salt Lake City replay';
  if (rolePath === 'solo_owner') return 'Salt Lake City replay';
  return 'Field work';
}

async function patchDemoState(workspaceId: string, patch: Record<string, unknown>) {
  const response = await fetch(`/api/onboarding/demo/state?workspaceId=${encodeURIComponent(workspaceId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw new Error('Failed to update demo state');
  return (await response.json()) as DemoStateResponse;
}

export function DemoGettingStartedPanel({ className }: { className?: string }) {
  const { currentWorkspaceId } = useWorkspace();
  const [state, setState] = useState<DemoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (!currentWorkspaceId) {
      setState(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetch(`/api/onboarding/demo/state?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: DemoStateResponse | null) => {
        if (cancelled) return;
        setState(payload?.state ?? null);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId]);

  const items = useMemo(() => (state ? checklistForState(state) : []), [state]);
  const completedCount = state
    ? items.filter((item) => state.completed_items[item.id]).length
    : 0;

  const markComplete = useCallback(async (itemId: string) => {
    if (!currentWorkspaceId || !state) return;
    const nextCompleted = {
      ...state.completed_items,
      [itemId]: !state.completed_items[itemId],
    };
    setState({ ...state, completed_items: nextCompleted });
    try {
      const payload = await patchDemoState(currentWorkspaceId, {
        completedItems: { [itemId]: nextCompleted[itemId] },
      });
      if (payload.state) setState(payload.state);
    } catch {
      setState(state);
    }
  }, [currentWorkspaceId, state]);

  const dismiss = useCallback(async () => {
    if (!currentWorkspaceId || !state) return;
    const dismissedState = { ...state, dismissed_at: new Date().toISOString() };
    setState(dismissedState);
    try {
      const payload = await patchDemoState(currentWorkspaceId, { dismissed: true });
      if (payload.state) setState(payload.state);
    } catch {
      setState(state);
    }
  }, [currentWorkspaceId, state]);

  const seedStarterCampaign = useCallback(async () => {
    if (!currentWorkspaceId) return;
    setSeeding(true);
    try {
      await fetch(`/api/onboarding/demo/seed?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ workspaceId: currentWorkspaceId }),
      });
      const refreshed = await fetch(`/api/onboarding/demo/state?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = refreshed.ok ? ((await refreshed.json()) as DemoStateResponse) : null;
      setState(payload?.state ?? state);
    } finally {
      setSeeding(false);
    }
  }, [currentWorkspaceId, state]);

  if (loading || !state || state.dismissed_at) return null;

  return (
    <section className={cn('rounded-xl border border-border bg-card p-4 shadow-sm', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">{headingForRole(state.role_path)}</h2>
            <Badge variant="secondary">{completedCount}/{items.length}</Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!state.seeded_campaign_id && state.role_path !== 'member' ? (
            <Button type="button" size="sm" onClick={() => void seedStarterCampaign()} disabled={seeding}>
              {seeding ? 'Loading...' : 'Load replay'}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="icon" onClick={dismiss} aria-label="Dismiss getting started">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;
          const isComplete = Boolean(state.completed_items[item.id]);
          return (
            <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background p-2">
              <button
                type="button"
                className="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => void markComplete(item.id)}
                aria-label={isComplete ? `Mark ${item.label} incomplete` : `Mark ${item.label} complete`}
              >
                {isComplete ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5" />}
              </button>
              <Link
                href={item.href}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-sm font-medium text-foreground hover:bg-muted"
                onClick={() => {
                  if (!isComplete && item.id !== 'review_reporting') void markComplete(item.id);
                }}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{item.label}</span>
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function DemoContextNudge({
  context,
  campaignIsStarter = false,
  className,
}: {
  context: 'campaign' | 'leads' | 'team';
  campaignIsStarter?: boolean;
  className?: string;
}) {
  const { currentWorkspaceId } = useWorkspace();
  const [state, setState] = useState<DemoState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    const storageKey = `${CONTEXT_NUDGE_DISMISS_PREFIX}:${currentWorkspaceId}:${context}`;
    setDismissed(window.localStorage.getItem(storageKey) === '1');
    let cancelled = false;
    fetch(`/api/onboarding/demo/state?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: DemoStateResponse | null) => {
        if (!cancelled) setState(payload?.state ?? null);
      })
      .catch(() => {
        if (!cancelled) setState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [context, currentWorkspaceId]);

  const dismiss = () => {
    if (!currentWorkspaceId) return;
    window.localStorage.setItem(`${CONTEXT_NUDGE_DISMISS_PREFIX}:${currentWorkspaceId}:${context}`, '1');
    setDismissed(true);
  };

  if (!state || dismissed) return null;
  if (context === 'campaign' && !campaignIsStarter) return null;
  if (context === 'leads' && (state.starter_contact_count ?? 0) <= 0) return null;
  if (context === 'team' && state.role_path !== 'team_owner') return null;

  const copy =
    context === 'campaign'
      ? {
          title: 'Salt Lake City replay',
          body: 'Use this fixed campaign to try map status, leads, QR scans, and assignments.',
          href: '/leads',
          cta: 'View leads',
          icon: MapPinned,
        }
      : context === 'team'
        ? {
            title: 'Replay workflow',
            body: 'Assign the Salt Lake City replay, then open the fake report document.',
            href: state.seeded_campaign_id ? `/campaigns/${state.seeded_campaign_id}?tab=assignments` : '/campaigns',
            cta: 'Open assignments',
            icon: Users,
          }
        : {
            title: 'Replay leads',
            body: 'These leads are linked to the pre-recorded Salt Lake City campaign.',
            href: state.seeded_campaign_id ? `/campaigns/${state.seeded_campaign_id}` : '/campaigns',
            cta: 'Open campaign',
            icon: Contact,
          };
  const Icon = copy.icon;

  return (
    <div className={cn('rounded-xl border border-border bg-card px-4 py-3 shadow-sm', className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{copy.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{copy.body}</p>
            <Button asChild variant="link" size="sm" className="mt-1 h-auto p-0">
              <Link href={copy.href}>{copy.cta}</Link>
            </Button>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={dismiss} aria-label="Dismiss tip">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
