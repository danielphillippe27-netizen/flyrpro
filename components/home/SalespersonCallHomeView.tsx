'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DollarSign, PhoneCall, RefreshCw, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspace } from '@/lib/workspace-context';
import type { DiallerLead } from '@/types/database';
import { HomeHeaderRow } from './HomeHeaderRow';
import { SalespersonMessenger } from './SalespersonMessenger';

type LeadsPayload = {
  leads?: DiallerLead[];
  error?: string;
};

type ProfilePayload = {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

type RevenueTotal = {
  currency: string;
  revenueCents: number;
};

type MonthlyPerformancePayload = {
  revenue?: {
    payingUsers?: number;
    revenueTotals?: RevenueTotal[];
  };
  error?: string;
};

function startOfWeekIso(): string {
  const date = new Date();
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString();
}

function isCalled(lead: DiallerLead): boolean {
  return Boolean(lead.called_at || lead.disposition);
}

function isConnected(lead: DiallerLead): boolean {
  return lead.disposition === 'interested' || lead.disposition === 'callback';
}

function isThisWeek(value: string | null | undefined, weekStartIso: string): boolean {
  if (!value) return false;
  return value >= weekStartIso;
}

function CallMetricCard({
  icon: Icon,
  label,
  value,
  caption,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  caption: string;
}) {
  return (
    <Card className="operator-surface rounded-xl border border-border/70 bg-card shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4 text-primary" />
          <span>{label}</span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold text-foreground tabular-nums">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{caption}</p>
      </CardContent>
    </Card>
  );
}

function buildDisplayName(profile: ProfilePayload | null): string {
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;
  return profile?.email ?? 'there';
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatRevenue(totals: RevenueTotal[] | undefined): string {
  if (!totals?.length) return '$0';

  return totals
    .map((total) =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: total.currency || 'USD',
        maximumFractionDigits: 0,
      }).format(total.revenueCents / 100)
    )
    .join(' / ');
}

export function SalespersonCallHomeView() {
  const { currentWorkspaceId } = useWorkspace();
  const [leads, setLeads] = useState<DiallerLead[]>([]);
  const [profile, setProfile] = useState<ProfilePayload | null>(null);
  const [monthlyPerformance, setMonthlyPerformance] = useState<MonthlyPerformancePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentWorkspaceId) return;

    setLoading(true);
    setError(null);
    try {
      const [leadsResponse, profileResponse, monthlyPerformanceResponse] = await Promise.all([
        fetch(`/api/dialer/leads?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
          credentials: 'include',
        }),
        fetch('/api/profile', { credentials: 'include' }),
        fetch(`/api/salesperson/performance?period=monthly&workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
          credentials: 'include',
        }),
      ]);

      const leadsPayload = (await leadsResponse.json().catch(() => ({}))) as LeadsPayload;
      if (!leadsResponse.ok) {
        throw new Error(leadsPayload.error ?? 'Failed to load call activity.');
      }

      setLeads(Array.isArray(leadsPayload.leads) ? leadsPayload.leads : []);
      if (profileResponse.ok) {
        setProfile((await profileResponse.json().catch(() => null)) as ProfilePayload | null);
      }
      if (monthlyPerformanceResponse.ok) {
        setMonthlyPerformance(
          (await monthlyPerformanceResponse.json().catch(() => null)) as MonthlyPerformancePayload | null
        );
      } else {
        setMonthlyPerformance(null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load call activity.');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const weekStartIso = startOfWeekIso();
    const calledLeads = leads.filter(isCalled);
    const callsThisWeek = calledLeads.filter((lead) => isThisWeek(lead.called_at, weekStartIso)).length;
    const connectedThisWeek = leads.filter(
      (lead) => isConnected(lead) && isThisWeek(lead.called_at ?? lead.updated_at, weekStartIso)
    ).length;

    return {
      callsThisWeek,
      connectedThisWeek,
    };
  }, [leads]);

  if (loading && leads.length === 0) {
    return (
      <div className="max-w-7xl mx-auto pl-0 pr-4 sm:pr-6 lg:pr-8 py-6 space-y-6">
        <Skeleton className="h-16 rounded-xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-44 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto pl-0 pr-4 sm:pr-6 lg:pr-8 py-6 space-y-6">
      <HomeHeaderRow
        firstName={buildDisplayName(profile)}
        doorsThisWeek={0}
        weeklyDoorGoal={0}
        dayStreak={0}
        lastSessionAt={null}
      />

      {error ? (
        <Card className="rounded-xl border border-destructive/30 bg-destructive/10 shadow-none">
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button type="button" variant="outline" size="sm" onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <CallMetricCard icon={PhoneCall} label="Calls" value={formatCount(stats.callsThisWeek)} caption="this week" />
        <CallMetricCard icon={Users} label="Connected" value={formatCount(stats.connectedThisWeek)} caption="this week" />
        <CallMetricCard
          icon={Users}
          label="Users"
          value={formatCount(monthlyPerformance?.revenue?.payingUsers ?? 0)}
          caption="paying this month"
        />
        <CallMetricCard
          icon={DollarSign}
          label="Monthly Revenue"
          value={formatRevenue(monthlyPerformance?.revenue?.revenueTotals)}
          caption="from referrals"
        />
      </div>

      <SalespersonMessenger />
    </div>
  );
}
