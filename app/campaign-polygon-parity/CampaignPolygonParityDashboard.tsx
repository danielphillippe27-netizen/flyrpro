'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Monitor,
  Play,
  RefreshCw,
  Smartphone,
  SquareTerminal,
  TabletSmartphone,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Surface = 'flyr_pro' | 'ios_wire' | 'android_wire';
type JobStatus = 'idle' | 'running' | 'passed' | 'failed';

type SurfaceProgress = {
  status: JobStatus;
  campaignId: string | null;
  runLabel: string | null;
  lastMessage: string | null;
};

type ReportResult = {
  surface: Surface;
  ordinal: number;
  campaignId?: string;
  timings: Record<string, number>;
  counts?: {
    addressesTable: number | null;
    snapshotAddresses: number | null;
    snapshotBuildings: number | null;
    mapBundleAddresses: number;
    mapBundleBuildings: number;
    mapBundleRoads: number;
    mapBundleParcels: number;
    addressesEndpoint: number;
    buildingsEndpoint: number;
    parcelsEndpoint: number;
  };
  warnings: string[];
  errors: string[];
};

type Report = {
  runId: string;
  createdAt: string;
  fixture: {
    name: string;
    baselineCampaignId: string;
    polygon: {
      type: 'Polygon';
      coordinates: number[][][];
    };
    bbox: number[];
    expected: {
      region: string;
      addresses: number;
      snapshotBuildings: number;
      roads: number;
      parcels: number;
    };
  };
  validationErrors: string[];
  stats: Record<string, Record<string, { min: number; p50: number; max: number }>>;
  results: ReportResult[];
};

export type ApiPayload = {
  job: {
    id: string;
    status: JobStatus;
    startedAt: string | null;
    finishedAt: string | null;
    command: string[];
    exitCode: number | null;
    reportDir: string | null;
    reportPath: string | null;
    logs: string[];
    surfaces: Record<Surface, SurfaceProgress>;
  };
  latestReport: Report | null;
};

const SURFACES: Array<{
  id: Surface;
  label: string;
  icon: typeof Monitor;
}> = [
  { id: 'flyr_pro', label: 'FLYR-PRO Web', icon: Monitor },
  { id: 'ios_wire', label: 'FLYR iOS', icon: Smartphone },
  { id: 'android_wire', label: 'FLYR Android', icon: TabletSmartphone },
];

const FALLBACK_POLYGON = {
  type: 'Polygon' as const,
  coordinates: [[
    [-78.7842254687073, 43.92552044236356],
    [-78.77887337137338, 43.926841389352035],
    [-78.77749783233911, 43.92380917196115],
    [-78.78284159307286, 43.92254219970988],
    [-78.7842254687073, 43.92552044236356],
  ]],
};

const TIMING_STEPS = [
  'createShell',
  'boundaryWrite',
  'detailsWrite',
  'provisionRequest',
  'waitUntilReady',
  'mapBundle',
  'addresses',
  'buildingsCold',
  'buildingsBypass',
  'parcels',
  'detailLoad',
];

export function CampaignPolygonParityDashboard({ initialPayload }: { initialPayload: ApiPayload | null }) {
  const [payload, setPayload] = useState<ApiPayload | null>(initialPayload);
  const [isLoading, setIsLoading] = useState(!initialPayload);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState(1);
  const [strictPerformance, setStrictPerformance] = useState(false);
  const [strictBaseline, setStrictBaseline] = useState(false);

  const load = async () => {
    try {
      const response = await fetch('/api/dev/campaign-polygon-parity', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
      setPayload(body);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 1500);
    return () => window.clearInterval(interval);
  }, []);

  const start = async () => {
    setIsStarting(true);
    try {
      const response = await fetch('/api/dev/campaign-polygon-parity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runs,
          captureScreenshot: false,
          strictBaseline,
          strictPerformance,
        }),
      });
      const body = await response.json();
      if (!response.ok && response.status !== 409) throw new Error(body.error ?? `HTTP ${response.status}`);
      setPayload(body);
      setError(null);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setIsStarting(false);
    }
  };

  const report = payload?.latestReport ?? null;
  const job = payload?.job ?? null;
  const polygon = report?.fixture?.polygon ?? FALLBACK_POLYGON;
  const runActive = job?.status === 'running';
  const latestBySurface = useMemo(() => latestResultsBySurface(report), [report]);
  const validationCount = report?.validationErrors?.length ?? 0;
  const warningCount = report?.results?.reduce((sum, result) => sum + result.warnings.length, 0) ?? 0;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-5 py-5 lg:px-8">
        <section className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="size-4 text-red-500" />
              Campaign polygon parity
            </div>
            <h1 className="text-2xl font-semibold tracking-normal">E2E Surface Dashboard</h1>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Runs the existing parity harness, watches live output, and renders the latest report from
              <span className="font-mono"> .tmp/campaign-polygon-parity/</span>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
              Runs
              <input
                className="h-6 w-14 rounded border border-border bg-background px-2 text-sm"
                min={1}
                max={9}
                type="number"
                value={runs}
                onChange={(event) => setRuns(Math.max(1, Number(event.target.value) || 1))}
              />
            </label>
            <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
              <input
                type="checkbox"
                checked={strictPerformance}
                onChange={(event) => setStrictPerformance(event.target.checked)}
              />
              Strict perf
            </label>
            <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
              <input
                type="checkbox"
                checked={strictBaseline}
                onChange={(event) => setStrictBaseline(event.target.checked)}
              />
              Strict baseline
            </label>
            <Button onClick={start} disabled={runActive || isStarting}>
              {runActive || isStarting ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
              Run E2E
            </Button>
          </div>
        </section>

        {error ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <div className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Canonical Polygon</h2>
                <p className="text-xs text-muted-foreground">{report?.fixture?.name ?? 'ontario-march-20-campaign-polygon'}</p>
              </div>
              <StatusBadge status={job?.status ?? 'idle'} />
            </div>
            <PolygonPreview polygon={polygon} />
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <Metric label="Expected addresses" value={report?.fixture?.expected?.addresses ?? 172} />
              <Metric label="Expected buildings" value={report?.fixture?.expected?.snapshotBuildings ?? 206} />
              <Metric label="Warnings" value={warningCount} />
              <Metric label="Failures" value={validationCount} tone={validationCount ? 'bad' : 'good'} />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            {SURFACES.map((surface) => (
              <SurfacePanel
                key={surface.id}
                label={surface.label}
                icon={surface.icon}
                progress={job?.surfaces?.[surface.id]}
                result={latestBySurface[surface.id]}
                isLoading={isLoading}
              />
            ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_420px]">
          <div className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Step Timings</h2>
                <p className="text-xs text-muted-foreground">Seconds, latest result per surface</p>
              </div>
              <Clock3 className="size-4 text-muted-foreground" />
            </div>
            <TimingTable results={latestBySurface} />
          </div>

          <div className="rounded-md border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Run Output</h2>
                <p className="text-xs text-muted-foreground">{job?.reportPath ?? 'No report loaded yet'}</p>
              </div>
              <SquareTerminal className="size-4 text-muted-foreground" />
            </div>
            <pre className="h-[340px] overflow-auto rounded-md bg-black p-3 text-xs leading-5 text-zinc-100">
              {(job?.logs ?? []).slice(-140).join('\n') || 'Waiting for a run...'}
            </pre>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Report Notes</h2>
              <p className="text-xs text-muted-foreground">{report?.runId ?? 'Latest report will appear after a run completes'}</p>
            </div>
            {validationCount ? <XCircle className="size-4 text-red-500" /> : <CheckCircle2 className="size-4 text-emerald-500" />}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <NoteList title="Validation" items={report?.validationErrors ?? []} empty="No validation errors." />
            <NoteList
              title="Warnings"
              items={(report?.results ?? []).flatMap((result) =>
                result.warnings.map((warning) => `${surfaceLabel(result.surface)} #${result.ordinal}: ${warning}`)
              )}
              empty="No warnings."
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function SurfacePanel({
  label,
  icon: Icon,
  progress,
  result,
  isLoading,
}: {
  label: string;
  icon: typeof Monitor;
  progress?: SurfaceProgress;
  result?: ReportResult;
  isLoading: boolean;
}) {
  const status = result ? (result.errors.length ? 'failed' : 'passed') : progress?.status ?? 'idle';
  const counts = result?.counts;

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-md bg-muted">
            <Icon className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">{label}</h2>
            <p className="font-mono text-xs text-muted-foreground">{result?.campaignId ?? progress?.campaignId ?? 'No campaign yet'}</p>
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="Addresses" value={counts?.addressesEndpoint ?? (isLoading ? '...' : '-')} />
        <Metric label="Buildings" value={counts?.buildingsEndpoint ?? (isLoading ? '...' : '-')} />
        <Metric label="Parcels" value={counts?.parcelsEndpoint ?? (isLoading ? '...' : '-')} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Bundle roads" value={counts?.mapBundleRoads ?? '-'} />
        <Metric label="Snapshot bldgs" value={counts?.snapshotBuildings ?? '-'} />
      </div>

      <div className="mt-4 text-xs text-muted-foreground">
        {progress?.lastMessage ?? (result ? `Run #${result.ordinal} complete` : 'Idle')}
      </div>
    </div>
  );
}

function TimingTable({ results }: { results: Partial<Record<Surface, ReportResult>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead className="border-b border-border text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-medium">Step</th>
            {SURFACES.map((surface) => (
              <th key={surface.id} className="py-2 pr-3 font-medium">{surface.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TIMING_STEPS.map((step) => (
            <tr key={step} className="border-b border-border/60 last:border-b-0">
              <td className="py-2 pr-3 font-mono text-muted-foreground">{step}</td>
              {SURFACES.map((surface) => {
                const value = results[surface.id]?.timings?.[step];
                return (
                  <td key={surface.id} className="py-2 pr-3 font-mono">
                    {Number.isFinite(value) ? `${value}s` : '-'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PolygonPreview({ polygon }: { polygon: { coordinates: number[][][] } }) {
  const ring = polygon.coordinates[0] ?? [];
  const points = useMemo(() => {
    if (ring.length === 0) return '';
    const lons = ring.map((point) => point[0]);
    const lats = ring.map((point) => point[1]);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const width = Math.max(maxLon - minLon, 0.000001);
    const height = Math.max(maxLat - minLat, 0.000001);
    return ring
      .map(([lon, lat]) => {
        const x = 24 + ((lon - minLon) / width) * 252;
        const y = 24 + (1 - (lat - minLat) / height) * 172;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [ring]);

  return (
    <div className="aspect-[3/2] w-full overflow-hidden rounded-md border border-border bg-zinc-950">
      <svg className="h-full w-full" viewBox="0 0 300 220" role="img" aria-label="Canonical campaign polygon">
        <defs>
          <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="300" height="220" fill="url(#grid)" />
        <polygon points={points} fill="rgba(239,68,68,0.34)" stroke="rgb(248,113,113)" strokeWidth="3" />
        {ring.slice(0, -1).map((_, index) => {
          const [x, y] = points.split(' ')[index]?.split(',').map(Number) ?? [0, 0];
          return <circle key={index} cx={x} cy={y} r="4" fill="rgb(250,204,21)" />;
        })}
      </svg>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={tone === 'bad' ? 'text-sm font-semibold text-red-500' : tone === 'good' ? 'text-sm font-semibold text-emerald-500' : 'text-sm font-semibold'}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  if (status === 'passed') {
    return (
      <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" variant="outline">
        <CheckCircle2 className="size-3" />
        Pass
      </Badge>
    );
  }
  if (status === 'failed') {
    return (
      <Badge className="border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300" variant="outline">
        <XCircle className="size-3" />
        Fail
      </Badge>
    );
  }
  if (status === 'running') {
    return (
      <Badge className="border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300" variant="outline">
        <RefreshCw className="size-3 animate-spin" />
        Running
      </Badge>
    );
  }
  return (
    <Badge className="border-zinc-500/20 bg-zinc-500/10 text-muted-foreground" variant="outline">
      <Clock3 className="size-3" />
      Idle
    </Badge>
  );
}

function NoteList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="size-4 text-amber-500" />
        {title}
      </div>
      {items.length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {items.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function latestResultsBySurface(report: Report | null): Partial<Record<Surface, ReportResult>> {
  const results: Partial<Record<Surface, ReportResult>> = {};
  for (const result of report?.results ?? []) {
    const current = results[result.surface];
    if (!current || result.ordinal >= current.ordinal) {
      results[result.surface] = result;
    }
  }
  return results;
}

function surfaceLabel(surface: Surface) {
  return SURFACES.find((candidate) => candidate.id === surface)?.label ?? surface;
}
