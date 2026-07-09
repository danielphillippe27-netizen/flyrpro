'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Loader2,
  RefreshCw,
  UserRound,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ACTIVE_PIPELINE_STAGES,
  PIPELINE_FILTERS,
  PIPELINE_STAGES,
  pipelinePriorityLabel,
  pipelineTaskTypeLabel,
  SALES_SEAT_MONTHLY_VALUE_CENTS,
  type SalesPipelineFilter,
} from '@/lib/sales-pipeline/constants';
import { cn } from '@/lib/utils';
import type { SalesPipelineStage, SalespersonLeadMaster } from '@/types/database';

type PipelineUsageSummary = {
  campaignsCount?: number;
  teamMembersCount?: number;
  contactsCount?: number;
  lastActivityAt?: string | null;
  suggestedSeatCount?: number;
};

type SalesPipelineLead = SalespersonLeadMaster & {
  owner_name?: string | null;
  salesperson_name?: string | null;
  usage_summary?: PipelineUsageSummary | null;
};

type PipelineResponse = {
  leads?: SalesPipelineLead[];
  workspaceId?: string | null;
  error?: string;
};

const priorityClass: Record<string, string> = {
  low: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-border dark:bg-muted/30 dark:text-muted-foreground',
  normal: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-200',
  high: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200',
  hot: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200',
};

function startOfLocalDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function isDueToday(value?: string | null): boolean {
  if (!value) return false;
  return startOfLocalDay(new Date(value)).getTime() === startOfLocalDay(new Date()).getTime();
}

function isOverdue(value?: string | null): boolean {
  if (!value) return false;
  return startOfLocalDay(new Date(value)).getTime() < startOfLocalDay(new Date()).getTime();
}

function isNoNextStep(lead: SalesPipelineLead): boolean {
  const stage = (lead.pipeline_stage ?? 'new_lead') as SalesPipelineStage;
  return ACTIVE_PIPELINE_STAGES.has(stage) && (!lead.next_task_title || !lead.next_follow_up_at);
}

function matchesFilter(lead: SalesPipelineLead, filter: SalesPipelineFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'due_today') return isDueToday(lead.next_follow_up_at);
  if (filter === 'overdue') return isOverdue(lead.next_follow_up_at);
  if (filter === 'no_next_step') return isNoNextStep(lead);
  if (filter === 'trial_follow_up') {
    return lead.pipeline_stage === 'trial_active' || lead.next_task_type === 'trial_check_in';
  }
  if (filter === 'closing') return lead.pipeline_stage === 'closing' || lead.next_task_type === 'close_ask';
  return true;
}

function formatMoney(cents?: number | null): string {
  const dollars = Math.max(0, Number(cents ?? 0)) / 100;
  return dollars.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: dollars % 1 === 0 ? 0 : 2,
  });
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: date.getMinutes() ? '2-digit' : undefined,
  });
}

function formatRelative(value?: string | null): string {
  if (!value) return 'No activity';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No activity';
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 14) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function valueLabel(lead: SalesPipelineLead): string {
  const seats = Math.max(1, Number(lead.seat_count ?? 1));
  const value = lead.estimated_monthly_value_cents ?? seats * SALES_SEAT_MONTHLY_VALUE_CENTS;
  return seats === 1
    ? `${formatMoney(value)}/mo`
    : `${seats} x ${formatMoney(SALES_SEAT_MONTHLY_VALUE_CENTS)}/mo = ${formatMoney(value)}/mo`;
}

function usageHighlights(lead: SalesPipelineLead): string[] {
  const usage = lead.usage_summary ?? {};
  return [
    typeof usage.campaignsCount === 'number' ? `${usage.campaignsCount} campaigns` : null,
    typeof usage.teamMembersCount === 'number' ? `${usage.teamMembersCount} members` : null,
    typeof usage.contactsCount === 'number' ? `${usage.contactsCount} leads` : null,
  ].filter((item): item is string => Boolean(item));
}

function PipelineCard({ lead, onClick }: { lead: SalesPipelineLead; onClick: () => void }) {
  const danger = isNoNextStep(lead);
  const signedUp = Boolean(lead.signed_up_user_id || lead.signed_up_workspace_id);
  const usage = usageHighlights(lead);

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onClick();
      }}
      className={cn(
        'gap-3 rounded-lg p-4 shadow-sm transition hover:border-primary/40 hover:shadow-md',
        danger && 'border-amber-300 bg-amber-50/70 dark:border-amber-400/40 dark:bg-amber-400/10'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{lead.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{lead.company || lead.email || lead.phone || 'No company'}</p>
        </div>
        <Badge variant="outline" className={cn('shrink-0', priorityClass[lead.pipeline_priority ?? 'normal'])}>
          {pipelinePriorityLabel(lead.pipeline_priority)}
        </Badge>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex items-start gap-2">
          {danger ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          ) : (
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <p className="font-medium text-foreground">{lead.next_task_title || 'No next step'}</p>
            <p className="text-muted-foreground">
              {pipelineTaskTypeLabel(lead.next_task_type)} · {formatDateTime(lead.next_follow_up_at)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-muted-foreground">
          <CircleDollarSign className="h-3.5 w-3.5" />
          <span className="truncate">{valueLabel(lead)}</span>
        </div>

        <div className="flex items-center gap-2 text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" />
          <span className="truncate">{lead.owner_name || lead.salesperson_name || 'Unassigned'}</span>
        </div>
      </div>

      <div className="space-y-2 border-t pt-3 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-muted-foreground">{lead.last_touch_summary || 'No last touch'}</span>
          <span className="shrink-0 text-muted-foreground">{formatRelative(lead.last_touch_at || lead.updated_at)}</span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Badge variant={signedUp ? 'default' : 'outline'} className="rounded-md">
            {signedUp ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : null}
            {signedUp ? 'Signed up' : 'No signup'}
          </Badge>
          {lead.last_product_active_at ? (
            <Badge variant="outline" className="rounded-md">Active {formatRelative(lead.last_product_active_at)}</Badge>
          ) : null}
          {usage.slice(0, 2).map((item) => (
            <Badge key={item} variant="outline" className="rounded-md">{item}</Badge>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function SalesPipelineBoard() {
  const router = useRouter();
  const [leads, setLeads] = useState<SalesPipelineLead[]>([]);
  const [filter, setFilter] = useState<SalesPipelineFilter>('due_today');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPipeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/salesperson/pipeline', { credentials: 'include' });
      const data = (await response.json().catch(() => ({}))) as PipelineResponse;
      if (!response.ok) throw new Error(data.error || 'Failed to load pipeline.');
      setLeads(data.leads ?? []);
    } catch (loadError) {
      setLeads([]);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load pipeline.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPipeline();
  }, [loadPipeline]);

  const filteredLeads = useMemo(
    () => leads.filter((lead) => matchesFilter(lead, filter)),
    [filter, leads]
  );

  const counts = useMemo(() => {
    return PIPELINE_FILTERS.reduce<Record<SalesPipelineFilter, number>>((acc, item) => {
      acc[item.value] = leads.filter((lead) => matchesFilter(lead, item.value)).length;
      return acc;
    }, {} as Record<SalesPipelineFilter, number>);
  }, [leads]);

  const grouped = useMemo(() => {
    return PIPELINE_STAGES.map((stage) => ({
      ...stage,
      leads: filteredLeads
        .filter((lead) => (lead.pipeline_stage ?? 'new_lead') === stage.value)
        .sort((left, right) => {
          const leftDue = left.next_follow_up_at ? new Date(left.next_follow_up_at).getTime() : Number.MAX_SAFE_INTEGER;
          const rightDue = right.next_follow_up_at ? new Date(right.next_follow_up_at).getTime() : Number.MAX_SAFE_INTEGER;
          return leftDue - rightDue;
        }),
    }));
  }, [filteredLeads]);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-foreground dark:bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Pipeline</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Internal sales worklist with next steps, trial signals, and app usage.
            </p>
          </div>
          <Button variant="outline" onClick={() => void loadPipeline()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </div>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {PIPELINE_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
              className={cn(
                'flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors',
                filter === item.value
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              )}
            >
              <span>{item.label}</span>
              <span className={cn('text-xs', filter === item.value ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                {counts[item.value] ?? 0}
              </span>
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <div className="mx-4 mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive sm:mx-6 lg:mx-8">
          {error}
        </div>
      ) : null}

      <main className="min-h-0 flex-1 overflow-x-auto p-4 sm:p-6 lg:p-8">
        {loading && leads.length === 0 ? (
          <div className="flex min-h-[420px] items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading pipeline...
          </div>
        ) : (
          <div className="grid min-w-[1280px] grid-cols-10 gap-3">
            {grouped.map((stage) => (
              <section key={stage.value} className="flex min-h-[480px] flex-col rounded-lg border bg-muted/30">
                <div className="flex h-12 items-center justify-between border-b bg-card px-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">{stage.label}</h2>
                  </div>
                  <Badge variant="outline" className="rounded-md">{stage.leads.length}</Badge>
                </div>
                <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
                  {stage.leads.length === 0 ? (
                    <div className="flex min-h-[120px] flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
                      <Users className="h-5 w-5" />
                      No leads
                    </div>
                  ) : (
                    stage.leads.map((lead) => (
                      <PipelineCard
                        key={lead.id}
                        lead={lead}
                        onClick={() => router.push(`/sales/pipeline/${lead.id}`)}
                      />
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
