'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, CheckCircle2, ChevronDown, ChevronUp, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type OptimizationStatus =
  | 'not_started'
  | 'queued'
  | 'matching'
  | 'geocoding'
  | 'applying'
  | 'review_needed'
  | 'completed'
  | 'failed';

type OptimizationReport = {
  unlinked_buildings_examined?: number;
  reverse_geocodes_matched?: number;
  orphan_addresses_reused?: number;
  provisional_addresses_created?: number;
  unresolved_buildings?: number;
  building_orphans_before?: number;
  building_orphans_after?: number;
  coverage_before?: number;
  coverage_after?: number;
};

type OptimizationResponse = {
  status: OptimizationStatus;
  run_id?: string;
  report?: OptimizationReport;
};

const runningStatuses = new Set<OptimizationStatus>([
  'queued',
  'matching',
  'geocoding',
  'applying',
]);

function value(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

export function MapOptimizationStatus({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<OptimizationResponse | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/reconciliation`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) return;
      setData(await response.json() as OptimizationResponse);
    } catch {
      // The current map remains usable when status polling is unavailable.
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data || !runningStatuses.has(data.status)) return;
    const interval = window.setInterval(() => void load(), 5_000);
    return () => window.clearInterval(interval);
  }, [data, load]);

  if (!data || data.status === 'not_started') return null;

  if (runningStatuses.has(data.status)) {
    return (
      <div className="flex w-fit items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        Optimizing addresses • Current map ready
      </div>
    );
  }

  if (data.status === 'failed') {
    return (
      <div className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
        Address optimization will retry • Current map ready
      </div>
    );
  }

  const report = data.report ?? {};
  const reused = value(report.orphan_addresses_reused);
  const created = value(report.provisional_addresses_created);
  const matched = value(report.reverse_geocodes_matched) || reused + created;
  const checked = value(report.unlinked_buildings_examined) ||
    value(report.building_orphans_before);
  const remaining = value(report.unresolved_buildings) ||
    value(report.building_orphans_after);

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {matched > 0 ? 'Map optimized' : 'Map checked — no changes needed'}
            </p>
            <p className="text-xs text-muted-foreground">
              {matched > 0
                ? `${matched} unlinked building${matched === 1 ? '' : 's'} received an address.`
                : `${checked} unlinked building${checked === 1 ? '' : 's'} checked.`}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5"
          onClick={() => setReportOpen((open) => !open)}
        >
          <BarChart3 className="h-4 w-4" />
          Data report
          {reportOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {reportOpen ? (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-emerald-200 pt-3 text-sm dark:border-emerald-900 sm:grid-cols-5">
          {[
            ['Buildings checked', checked],
            ['Existing addresses matched', reused],
            ['Provisional addresses added', created],
            ['Buildings resolved', matched],
            ['Still unlinked', remaining],
          ].map(([label, count]) => (
            <div key={String(label)} className="rounded-lg bg-background/70 p-2">
              <p className="text-lg font-semibold text-foreground">{count}</p>
              <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
