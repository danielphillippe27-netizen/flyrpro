'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart3, CheckCircle2, ChevronDown, ChevronUp, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DismissibleCampaignBanner } from './DismissibleCampaignBanner';

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
  review_needed?: number;
  street_row_suggestions?: number;
  road_segments_available?: number;
  reverse_lookup_available?: number;
};

type OptimizationResponse = {
  status: OptimizationStatus;
  run_id?: string;
  report?: OptimizationReport;
  current_map?: { addresses?: number; buildings?: number; parcels?: number; links?: number; unresolved_addresses?: number } | null;
  shadow_run?: { status: string; completed_at?: string | null; report?: OptimizationReport };
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
  const [preview, setPreview] = useState<{ total: number; pendingTargets: number; before: number; projected: number; review: number; streetSuggestions: number; roads: number; lookups: number; elapsedMs: number; streetExamples?: Array<{ address: string; evidence: string[] }> } | null>(null);
  const [previewRunning, setPreviewRunning] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const runPreview = async () => {
    setPreviewRunning(true); setPreviewError('');
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/reconciliation/preview`, { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('Preview could not complete.');
      setPreview(await response.json()); setReportOpen(true);
    } catch { setPreviewError('Preview could not complete.'); }
    finally { setPreviewRunning(false); }
  };

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

  if (!data) return null;

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
  const matched = value(report.reverse_geocodes_matched);
  const resolved = reused + created;
  const checked = report.unlinked_buildings_examined ?? report.building_orphans_before;
  const remaining = value(report.unresolved_buildings ?? report.building_orphans_after);
  const before = report.coverage_before;
  const after = report.coverage_after;
  const hasRunReport = Number.isFinite(checked) || Number.isFinite(before) || Number.isFinite(after);
  const currentMap = data.current_map;
  const shadowReport = data.shadow_run?.report;

  return (
    <DismissibleCampaignBanner
      storageKey={`wolfgrid:campaign:${campaignId}:optimization-dismissed`}
      noticeId={JSON.stringify([data.run_id, data.status, data.report])}
      label="Dismiss map optimization notice"
      className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-900 dark:bg-emerald-950/30"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {resolved > 0 ? 'Map optimized' : value(report.review_needed) > 0 ? 'Map checked — some homes need review' : hasRunReport ? 'Map checked' : 'Map data report'}
            </p>
            <p className="text-xs text-muted-foreground">
              {resolved > 0
                ? `${resolved} unlinked building${resolved === 1 ? '' : 's'} received an address.`
                : Number.isFinite(checked) ? `${checked} building${checked === 1 ? '' : 's'} checked${remaining > 0 ? `; ${remaining} still unlinked` : ''}.` : 'Current map data and optimizer status.'}
            </p>
          </div>
        </div>
        {process.env.NODE_ENV === 'development' ? <Button type="button" size="sm" variant="outline" disabled={previewRunning} onClick={runPreview}>{previewRunning ? 'Testing…' : 'Test optimizer'}</Button> : null}
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

      {previewError ? <p className="mt-2 text-xs text-red-600">{previewError}</p> : null}
      {preview ? <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950" aria-live="polite">
        <p className="font-semibold">Read-only optimizer test</p>
        <p>Address coverage: {preview.before} / {preview.total} ({preview.total ? (100 * preview.before / preview.total).toFixed(1) : '0'}%) → projected {preview.projected} / {preview.total} ({preview.total ? (100 * preview.projected / preview.total).toFixed(1) : '0'}%)</p>
        <p>{preview.pendingTargets} building targets have no resolved house number and are excluded from address coverage.</p>
        <p>{preview.review} possible changes need review · {preview.streetSuggestions} street-pattern suggestions · {preview.roads} road segments · {preview.lookups} temporary lookups</p>
        {preview.streetExamples?.map(example => <p key={example.address}>Street-pattern candidate: {example.address} — same road side, between linked numbers; needs review.</p>)}
        <p>No campaign changes were saved. Coverage is not an accuracy score.</p>
      </div> : null}
      {reportOpen ? (
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-emerald-200 pt-3 text-sm dark:border-emerald-900 sm:grid-cols-5">
          <p className="col-span-full text-xs font-semibold">Current map</p>
          {[
            ['Map stops (including pending)', currentMap?.addresses], ['Buildings', currentMap?.buildings],
            ['Parcels', currentMap?.parcels], ['Address-to-building links', currentMap?.links],
            ['Unresolved address targets', currentMap?.unresolved_addresses],
          ].map(([label, count]) => (
            <div key={String(label)} className="rounded-lg bg-background/70 p-2">
              <p className="text-lg font-semibold text-foreground">{typeof count === 'number' && Number.isFinite(count) ? count : '—'}</p>
              <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
            </div>
          ))}
          {data.shadow_run ? <div className="col-span-full space-y-1 text-xs text-muted-foreground">
            <p>Background test: {data.shadow_run.status}. Results are a simulation and were not applied.</p>
            {Number.isFinite(shadowReport?.coverage_before) && Number.isFinite(shadowReport?.coverage_after) ? <p>Estimated building coverage: {Number(shadowReport?.coverage_before).toFixed(1)}% → {Number(shadowReport?.coverage_after).toFixed(1)}%. Coverage is not an accuracy score.</p> : null}
            {Number.isFinite(shadowReport?.road_segments_available) ? <p>{shadowReport?.road_segments_available} road segments checked · {value(shadowReport?.street_row_suggestions)} street-pattern suggestions · {value(shadowReport?.review_needed)} decisions need review.</p> : null}
          </div> : null}
          {hasRunReport ? <>
          <p className="col-span-full text-xs font-semibold">Previous applied run</p>
          {[
            ['Building coverage before', Number.isFinite(before) ? `${Number(before).toFixed(1)}%` : '—'],
            ['Building coverage after', Number.isFinite(after) ? `${Number(after).toFixed(1)}%` : '—'],
            ['Street matches for review', value(report.street_row_suggestions)],
            ['Needs review', value(report.review_needed)],
            ['Buildings checked', checked ?? '—'],
            ['Existing addresses matched', reused],
            ['Provisional addresses added', created],
            ['Reverse-geocode matches', matched],
            ['Still unlinked', remaining],
          ].map(([label, count]) => (
            <div key={String(label)} className="rounded-lg bg-background/70 p-2">
              <p className="text-lg font-semibold text-foreground">{count}</p>
              <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
            </div>
          ))}
          <p className="col-span-full text-[11px] text-muted-foreground">Coverage measures buildings linked to an address; it is not a verified accuracy score.</p>
          {report.road_segments_available === 0 ? <p className="col-span-full text-[11px] text-muted-foreground">Street geometry was unavailable for this run.</p> : null}
          {report.reverse_lookup_available === 0 ? <p className="col-span-full text-[11px] text-muted-foreground">Temporary address lookup was unavailable for this run.</p> : null}
          </> : <p className="col-span-full text-xs text-muted-foreground">No completed optimizer report is available yet.</p>}
        </div>
      ) : null}
    </DismissibleCampaignBanner>
  );
}
