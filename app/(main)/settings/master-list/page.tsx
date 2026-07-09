'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkspace } from '@/lib/workspace-context';
import type { SalespersonLeadMaster, SalespersonLeadMasterState } from '@/types/database';

type MasterListMember = {
  id: string;
  salespersonId: string | null;
  userId: string | null;
  name: string;
  email: string | null;
  role: string | null;
  status: string | null;
};

type MasterListPayload = {
  leads: SalespersonLeadMaster[];
  members: MasterListMember[];
  workspaceId: string | null;
  total: number;
  error?: string;
};

function stateLabel(state: SalespersonLeadMasterState): string {
  switch (state) {
    case 'assigned': return 'Assigned';
    case 'queued': return 'Queued';
    case 'attempting': return 'Attempting';
    case 'contacted': return 'Contacted';
    case 'interested': return 'Interested';
    case 'callback': return 'Callback';
    case 'not_now': return 'Not now';
    case 'dnc': return 'DNC';
    default: return state;
  }
}

function stateClassName(state: SalespersonLeadMasterState): string {
  switch (state) {
    case 'interested': return 'border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300';
    case 'contacted': return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300';
    case 'attempting': return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300';
    case 'callback': return 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-300';
    case 'dnc': return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300';
    case 'not_now': return 'border-gray-200 bg-gray-100 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300';
    default: return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300';
  }
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function memberLabel(member?: MasterListMember | null): string {
  if (!member) return '-';
  return member.name || member.email || member.id.replace(/^(salesperson|user):/, '').slice(0, 8);
}

function leadMatchesSearch(
  lead: SalespersonLeadMaster,
  search: string,
  memberBySalespersonId: Map<string, MasterListMember>,
  memberByUserId: Map<string, MasterListMember>
): boolean {
  if (!search) return true;
  const assignedMember =
    (lead.assigned_salesperson_id ? memberBySalespersonId.get(lead.assigned_salesperson_id) : null) ??
    (lead.assigned_user_id ? memberByUserId.get(lead.assigned_user_id) : null);
  const values = [
    lead.company,
    lead.name,
    lead.phone,
    lead.phone_e164,
    lead.email,
    lead.city,
    lead.region,
    lead.source,
    lead.list_name,
    assignedMember?.name,
    assignedMember?.email,
  ];
  return values.some((value) => value?.toLowerCase().includes(search));
}

export default function SettingsMasterListPage() {
  const { currentWorkspaceId } = useWorkspace();
  const [payload, setPayload] = useState<MasterListPayload | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMasterList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '25000' });
      if (currentWorkspaceId) params.set('workspaceId', currentWorkspaceId);
      if (selectedMemberId !== 'all') params.set('memberId', selectedMemberId);

      const response = await fetch(`/api/settings/master-list?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => ({}))) as MasterListPayload;
      if (!response.ok) {
        throw new Error(data.error || 'Could not load the master list.');
      }
      setPayload(data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load the master list.');
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId, selectedMemberId]);

  useEffect(() => {
    void loadMasterList();
  }, [loadMasterList]);

  const memberBySalespersonId = useMemo(() => {
    const map = new Map<string, MasterListMember>();
    for (const member of payload?.members ?? []) {
      if (member.salespersonId) map.set(member.salespersonId, member);
    }
    return map;
  }, [payload?.members]);

  const memberByUserId = useMemo(() => {
    const map = new Map<string, MasterListMember>();
    for (const member of payload?.members ?? []) {
      if (member.userId) map.set(member.userId, member);
    }
    return map;
  }, [payload?.members]);

  const normalizedSearch = search.trim().toLowerCase();
  const visibleLeads = useMemo(() => {
    const leads = payload?.leads ?? [];
    return leads.filter((lead) =>
      leadMatchesSearch(lead, normalizedSearch, memberBySalespersonId, memberByUserId)
    );
  }, [memberBySalespersonId, memberByUserId, normalizedSearch, payload?.leads]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-white dark:bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <Button asChild variant="ghost" size="sm" className="-ml-3 mb-1">
              <Link href="/settings">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Settings
              </Link>
            </Button>
            <h1 className="truncate text-2xl font-bold dark:text-white">Master lead list</h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadMasterList()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <Card>
          <CardHeader className="space-y-4">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div>
                <div className="flex items-center gap-2">
                  <Layers className="h-5 w-5" />
                  <CardTitle>All master-list rows</CardTitle>
                </div>
                <CardDescription className="mt-2">
                  Filter the shared lead list by member, then search within the returned rows.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{(payload?.total ?? 0).toLocaleString()} total</Badge>
                <Badge variant="outline">{visibleLeads.length.toLocaleString()} shown</Badge>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(220px,280px)_minmax(260px,1fr)]">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Users className="h-4 w-4" />
                  Member
                </div>
                <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                  <SelectTrigger className="w-full bg-background">
                    <SelectValue placeholder="All members" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All members</SelectItem>
                    {(payload?.members ?? []).map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {memberLabel(member)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Search className="h-4 w-4" />
                  Search
                </div>
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Company, lead, phone, city, list, or member"
                  className="bg-background"
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            ) : null}
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center gap-2 px-6 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading master list...
              </div>
            ) : visibleLeads.length === 0 ? (
              <div className="px-6 py-10 text-sm text-muted-foreground">
                No master-list rows match the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="border-y bg-muted/40 text-left">
                    <tr>
                      <th className="px-4 py-3 font-medium">Lead</th>
                      <th className="px-4 py-3 font-medium">Phone</th>
                      <th className="px-4 py-3 font-medium">Email</th>
                      <th className="px-4 py-3 font-medium">City</th>
                      <th className="px-4 py-3 font-medium">State</th>
                      <th className="px-4 py-3 font-medium text-center">Attempts</th>
                      <th className="px-4 py-3 font-medium">Member</th>
                      <th className="px-4 py-3 font-medium">List</th>
                      <th className="px-4 py-3 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLeads.map((lead) => {
                      const assignedMember =
                        (lead.assigned_salesperson_id ? memberBySalespersonId.get(lead.assigned_salesperson_id) : null) ??
                        (lead.assigned_user_id ? memberByUserId.get(lead.assigned_user_id) : null);

                      return (
                        <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-foreground">{lead.company || lead.name}</div>
                            {lead.company && lead.name !== lead.company ? (
                              <div className="text-xs text-muted-foreground">{lead.name}</div>
                            ) : null}
                            {lead.website_domain ? (
                              <div className="text-xs text-muted-foreground">{lead.website_domain}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground">
                            {lead.phone_e164 ?? lead.phone ?? '-'}
                          </td>
                          <td className="px-4 py-3 align-top text-muted-foreground">
                            {lead.email ?? '-'}
                          </td>
                          <td className="px-4 py-3 align-top text-muted-foreground">
                            {[lead.city, lead.region].filter(Boolean).join(', ') || '-'}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-medium ${stateClassName(lead.lead_state)}`}>
                              {stateLabel(lead.lead_state)}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top text-center text-muted-foreground">
                            {lead.attempt_count}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-foreground">{memberLabel(assignedMember)}</div>
                            {assignedMember?.email ? (
                              <div className="text-xs text-muted-foreground">{assignedMember.email}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                            {lead.list_name ?? lead.source ?? '-'}
                          </td>
                          <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                            {formatDate(lead.updated_at)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
