'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Mail,
  Phone,
  Save,
  Send,
  UserRound,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  PIPELINE_PRIORITIES,
  PIPELINE_STAGES,
  PIPELINE_TASK_TYPES,
  pipelineStageLabel,
  pipelineTaskTypeLabel,
  SALES_SEAT_MONTHLY_VALUE_CENTS,
} from '@/lib/sales-pipeline/constants';
import type {
  SalesPipelinePriority,
  SalesPipelineStage,
  SalesPipelineTaskType,
  SalespersonLeadActivity,
  SalespersonLeadAppMatch,
  SalespersonLeadMaster,
} from '@/types/database';

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
  activities?: SalespersonLeadActivity[];
  matches?: SalespersonLeadAppMatch[];
  error?: string;
};

type Draft = {
  pipeline_stage: SalesPipelineStage;
  pipeline_priority: SalesPipelinePriority;
  seat_count: string;
  next_task_title: string;
  next_task_type: SalesPipelineTaskType | '';
  next_follow_up_at: string;
  objection: string;
  trial_status: string;
  notes: string;
};

function toDateTimeInput(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeInput(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDateTime(value?: string | null): string {
  if (!value) return 'None';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'None';
  return date.toLocaleString();
}

function formatMoney(cents?: number | null): string {
  const value = Math.max(0, Number(cents ?? 0)) / 100;
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  });
}

function valueLabel(lead: SalesPipelineLead | null, draft: Draft): string {
  const seats = Math.max(1, Number(draft.seat_count || lead?.seat_count || 1));
  return `${seats} x ${formatMoney(SALES_SEAT_MONTHLY_VALUE_CENTS)}/mo = ${formatMoney(seats * SALES_SEAT_MONTHLY_VALUE_CENTS)}/mo`;
}

function draftFromLead(lead: SalesPipelineLead): Draft {
  return {
    pipeline_stage: (lead.pipeline_stage ?? 'new_lead') as SalesPipelineStage,
    pipeline_priority: (lead.pipeline_priority ?? 'normal') as SalesPipelinePriority,
    seat_count: String(lead.seat_count ?? 1),
    next_task_title: lead.next_task_title ?? '',
    next_task_type: (lead.next_task_type ?? '') as SalesPipelineTaskType | '',
    next_follow_up_at: toDateTimeInput(lead.next_follow_up_at),
    objection: lead.objection ?? '',
    trial_status: lead.trial_status ?? '',
    notes: lead.notes ?? '',
  };
}

function usageRows(lead: SalesPipelineLead | null): Array<[string, string]> {
  const usage = lead?.usage_summary ?? {};
  return [
    ['Campaigns', typeof usage.campaignsCount === 'number' ? String(usage.campaignsCount) : '0'],
    ['Team members', typeof usage.teamMembersCount === 'number' ? String(usage.teamMembersCount) : '0'],
    ['Leads', typeof usage.contactsCount === 'number' ? String(usage.contactsCount) : '0'],
    ['Last active', formatDateTime(lead?.last_product_active_at ?? usage.lastActivityAt ?? null)],
  ];
}

export function SalesPipelineDetailView({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [lead, setLead] = useState<SalesPipelineLead | null>(null);
  const [activities, setActivities] = useState<SalespersonLeadActivity[]>([]);
  const [matches, setMatches] = useState<SalespersonLeadAppMatch[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadLead = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/salesperson/pipeline?leadId=${encodeURIComponent(leadId)}`, {
        credentials: 'include',
      });
      const data = (await response.json().catch(() => ({}))) as PipelineResponse;
      if (!response.ok) throw new Error(data.error || 'Failed to load lead.');
      const nextLead = data.leads?.[0] ?? null;
      setLead(nextLead);
      setActivities(data.activities ?? []);
      setMatches(data.matches ?? []);
      setDraft(nextLead ? draftFromLead(nextLead) : null);
    } catch (error) {
      setLead(null);
      setMessage(error instanceof Error ? error.message : 'Failed to load lead.');
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void loadLead();
  }, [loadLead]);

  const saveChanges = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/salesperson/pipeline/${encodeURIComponent(leadId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          pipeline_stage: draft.pipeline_stage,
          pipeline_priority: draft.pipeline_priority,
          seat_count: Number(draft.seat_count || 1),
          next_task_title: draft.next_task_title,
          next_task_type: draft.next_task_type || null,
          next_follow_up_at: fromDateTimeInput(draft.next_follow_up_at),
          objection: draft.objection,
          trial_status: draft.trial_status,
          notes: draft.notes,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { lead?: SalesPipelineLead; error?: string };
      if (!response.ok) throw new Error(data.error || 'Failed to save lead.');
      if (data.lead) {
        setLead(data.lead);
        setDraft(draftFromLead(data.lead));
      }
      await loadLead();
      setMessage('Pipeline lead saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save lead.');
    } finally {
      setSaving(false);
    }
  }, [draft, leadId, loadLead]);

  const addNote = useCallback(async () => {
    const body = noteDraft.trim();
    if (!body) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/salesperson/pipeline/${encodeURIComponent(leadId)}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          activity_type: 'note',
          title: 'Note',
          body,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Failed to add note.');
      setNoteDraft('');
      await loadLead();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to add note.');
    } finally {
      setSaving(false);
    }
  }, [leadId, loadLead, noteDraft]);

  const suggestedSeatCount = useMemo(() => {
    const usage = lead?.usage_summary ?? {};
    return typeof usage.suggestedSeatCount === 'number' ? usage.suggestedSeatCount : null;
  }, [lead?.usage_summary]);

  if (loading && !lead) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading lead...
      </div>
    );
  }

  if (!lead || !draft) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">{message || 'Lead not found.'}</p>
        <Button asChild variant="outline">
          <Link href="/sales/pipeline">Back to Pipeline</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 dark:bg-background sm:p-6 lg:p-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <Button type="button" variant="ghost" className="mb-3 px-0" onClick={() => router.push('/sales/pipeline')}>
              <ArrowLeft className="h-4 w-4" />
              Pipeline
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-normal md:text-3xl">{lead.name}</h1>
              <Badge variant="outline">{pipelineStageLabel(draft.pipeline_stage)}</Badge>
              {lead.signed_up_user_id || lead.signed_up_workspace_id ? (
                <Badge>
                  <CheckCircle2 className="h-3 w-3" />
                  Signed up
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{lead.company || lead.email || lead.phone || 'No company'}</p>
          </div>
          <Button onClick={() => void saveChanges()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </header>

        {message ? <div className="rounded-md border bg-card p-3 text-sm">{message}</div> : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>Pipeline</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Stage</Label>
                  <Select value={draft.pipeline_stage} onValueChange={(value) => setDraft({ ...draft, pipeline_stage: value as SalesPipelineStage })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PIPELINE_STAGES.map((stage) => (
                        <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={draft.pipeline_priority} onValueChange={(value) => setDraft({ ...draft, pipeline_priority: value as SalesPipelinePriority })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PIPELINE_PRIORITIES.map((priority) => (
                        <SelectItem key={priority.value} value={priority.value}>{priority.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Seats</Label>
                  <Input
                    type="number"
                    min={1}
                    value={draft.seat_count}
                    onChange={(event) => setDraft({ ...draft, seat_count: event.target.value })}
                  />
                  {suggestedSeatCount && suggestedSeatCount > Number(draft.seat_count || 1) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="px-0 text-xs"
                      onClick={() => setDraft({ ...draft, seat_count: String(suggestedSeatCount) })}
                    >
                      Use {suggestedSeatCount} seats from usage
                    </Button>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label>Value</Label>
                  <div className="flex h-10 items-center rounded-md border bg-muted/30 px-3 text-sm">
                    {valueLabel(lead, draft)}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>Next Pipeline Step</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label>Pipeline step</Label>
                  <Input
                    value={draft.next_task_title}
                    onChange={(event) => setDraft({ ...draft, next_task_title: event.target.value })}
                    placeholder="Call tomorrow at 10 AM"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={draft.next_task_type || 'none'} onValueChange={(value) => setDraft({ ...draft, next_task_type: value === 'none' ? '' : value as SalesPipelineTaskType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {PIPELINE_TASK_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Due</Label>
                  <Input
                    type="datetime-local"
                    value={draft.next_follow_up_at}
                    onChange={(event) => setDraft({ ...draft, next_follow_up_at: event.target.value })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Objection</Label>
                  <Input
                    value={draft.objection}
                    onChange={(event) => setDraft({ ...draft, objection: event.target.value })}
                    placeholder="Price, timing, needs broker approval..."
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={draft.notes}
                  onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                  rows={5}
                  placeholder="CRM notes"
                />
                <div className="rounded-md border p-3">
                  <Label>Add timeline note</Label>
                  <Textarea
                    className="mt-2"
                    value={noteDraft}
                    onChange={(event) => setNoteDraft(event.target.value)}
                    rows={3}
                    placeholder="What happened?"
                  />
                  <div className="mt-3 flex justify-end">
                    <Button type="button" variant="outline" onClick={() => void addNote()} disabled={saving || !noteDraft.trim()}>
                      <Send className="h-4 w-4" />
                      Add note
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>Activity Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                {activities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No activity yet.</p>
                ) : (
                  <ol className="space-y-4">
                    {activities.map((activity) => (
                      <li key={activity.id} className="border-l-2 border-border pl-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">{activity.title}</p>
                          <Badge variant="outline">{activity.activity_type.replace(/_/g, ' ')}</Badge>
                        </div>
                        {activity.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{activity.body}</p> : null}
                        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(activity.created_at)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-5">
            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>Contact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-muted-foreground" />
                  <span>{lead.owner_name || lead.salesperson_name || 'Unassigned'}</span>
                </div>
                {lead.email ? (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span className="break-all">{lead.email}</span>
                  </div>
                ) : null}
                {lead.phone ? (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{lead.phone}</span>
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-muted-foreground" />
                  <span>Last touch: {formatDateTime(lead.last_touch_at)}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>Trial Usage</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {usageRows(lead).map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-medium">{value}</span>
                  </div>
                ))}
                <div className="pt-2">
                  <Badge variant={lead.match_confidence === 'strong' ? 'default' : 'outline'}>
                    Match: {lead.match_confidence || 'none'}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>Attribution</CardTitle>
              </CardHeader>
              <CardContent>
                {matches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No app matches yet.</p>
                ) : (
                  <div className="space-y-3">
                    {matches.map((match) => (
                      <div key={match.id} className="rounded-md border p-3 text-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={match.auto_applied ? 'default' : 'outline'}>
                            {match.match_confidence}
                          </Badge>
                          <span className="font-medium">{match.match_method.replace(/_/g, ' ')}</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {match.matched_email || match.matched_phone_e164 || match.matched_workspace_id || 'No identifier'}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(match.created_at)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-lg">
              <CardHeader>
                <CardTitle>Signals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Product usage creates pipeline follow-ups and seat suggestions, not automatic closing moves.
                </div>
                <div>Current pipeline type: {pipelineTaskTypeLabel(draft.next_task_type)}</div>
                <div>Trial status: {draft.trial_status || 'Unknown'}</div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </div>
  );
}
