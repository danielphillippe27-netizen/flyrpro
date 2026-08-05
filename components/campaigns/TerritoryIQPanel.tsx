'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { AlertCircle, BrainCircuit, Database, RefreshCw, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { getMapboxToken, removeMapboxMapWhenSafe } from '@/lib/mapbox';
import { useTheme } from '@/lib/theme-provider';
import type {
  TerritoryIQCellProperties,
  TerritoryIQFactor,
  TerritoryIQInsight,
  TerritoryIQResponse,
} from '@/lib/territory-iq/types';

function scoreColour(score: number | null): string {
  if (score === null) return '#94a3b8';
  if (score >= 80) return '#16a34a';
  if (score >= 65) return '#84cc16';
  if (score >= 50) return '#eab308';
  if (score >= 35) return '#f97316';
  return '#dc2626';
}

function formatRaw(factor: TerritoryIQFactor): string {
  if (factor.rawValue === null) return 'Not available';
  if (factor.rawUnit?.includes('CAD')) return `$${Math.round(factor.rawValue).toLocaleString()}`;
  if (factor.rawUnit?.startsWith('%')) {
    return `${Math.round(factor.rawValue)}%${factor.rawUnit.slice(1)}`;
  }
  const value = Number(factor.rawValue.toFixed(1)).toLocaleString();
  return `${value}${factor.rawUnit ? ` ${factor.rawUnit}` : ''}`;
}

function FactorRow({ factor }: { factor: TerritoryIQFactor }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{factor.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatRaw(factor)}
            {factor.areaEstimate ? ' · Area estimate' : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-foreground">
            {factor.score === null ? '—' : Math.round(factor.score)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {factor.effectiveWeight.toFixed(1)}% effective
          </p>
        </div>
      </div>
      <Progress value={factor.score ?? 0} className="mt-3 h-1.5" />
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{factor.source ?? 'Waiting for a supported source'}</span>
        <span>{Math.round(factor.confidence * 100)}% confidence</span>
      </div>
    </div>
  );
}

function formatInsight(insight: TerritoryIQInsight): string {
  if (insight.value === null) return `Score ${Math.round(insight.score)}`;
  const value = Number(insight.value.toFixed(1)).toLocaleString();
  return `${value}${insight.unit ? ` ${insight.unit}` : ''}`;
}

function InsightRow({ insight }: { insight: TerritoryIQInsight }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{insight.label}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatInsight(insight)}{insight.areaEstimate ? ' · Area estimate' : ''}
          </p>
        </div>
        <p className="text-sm font-semibold" style={{ color: scoreColour(insight.score) }}>
          {Math.round(insight.score)}
        </p>
      </div>
      <Progress value={insight.score} className="mt-3 h-1.5" />
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="truncate">{insight.source}</span>
        <span className="shrink-0">{Math.round(insight.confidence * 100)}% confidence</span>
      </div>
    </div>
  );
}

function TerritoryIQMap({
  data,
  selectedCellId,
  onSelect,
}: {
  data: TerritoryIQResponse;
  selectedCellId: string | null;
  onSelect: (cell: TerritoryIQCellProperties) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!containerRef.current || !data.cells.features.length) return;
    const token = getMapboxToken();
    if (!token) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: theme === 'dark' ? 'mapbox://styles/mapbox/dark-v11' : 'mapbox://styles/mapbox/light-v11',
      center: [-79.38, 43.65],
      zoom: 12,
      attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('territory-iq-cells', { type: 'geojson', data: data.cells });
      map.addLayer({
        id: 'territory-iq-fill',
        type: 'fill',
        source: 'territory-iq-cells',
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['coalesce', ['get', 'score'], 0],
            0, '#dc2626',
            35, '#f97316',
            50, '#eab308',
            65, '#84cc16',
            80, '#16a34a',
            100, '#15803d',
          ],
          'fill-opacity': [
            'case',
            ['==', ['get', 'cellId'], selectedCellId ?? ''],
            0.82,
            0.62,
          ],
        },
      });
      map.addLayer({
        id: 'territory-iq-outline',
        type: 'line',
        source: 'territory-iq-cells',
        paint: {
          'line-color': theme === 'dark' ? '#f8fafc' : '#0f172a',
          'line-width': [
            'case',
            ['==', ['get', 'cellId'], selectedCellId ?? ''],
            2.5,
            0.8,
          ],
          'line-opacity': 0.7,
        },
      });
      const bounds = new mapboxgl.LngLatBounds();
      const visit = (coordinates: unknown): void => {
        if (
          Array.isArray(coordinates) &&
          coordinates.length >= 2 &&
          typeof coordinates[0] === 'number' &&
          typeof coordinates[1] === 'number'
        ) {
          bounds.extend([coordinates[0], coordinates[1]]);
          return;
        }
        if (Array.isArray(coordinates)) coordinates.forEach(visit);
      };
      data.cells.features.forEach((feature) => visit((feature.geometry as { coordinates?: unknown }).coordinates));
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 38, duration: 0, maxZoom: 15 });
      map.on('click', 'territory-iq-fill', (event) => {
        const cellId = event.features?.[0]?.properties?.cellId;
        const cell = data.cells.features.find((feature) => feature.properties.cellId === cellId);
        if (cell) onSelect(cell.properties);
      });
      map.on('mouseenter', 'territory-iq-fill', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'territory-iq-fill', () => {
        map.getCanvas().style.cursor = '';
      });
    });
    return () => {
      mapRef.current = null;
      removeMapboxMapWhenSafe(map);
    };
  }, [data, onSelect, selectedCellId, theme]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-muted/30">
      <div ref={containerRef} className="h-[420px] w-full" aria-label="GRID SCORE opportunity map" />
      {!getMapboxToken() ? (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/90 p-6 text-center text-sm text-muted-foreground">
          Map preview is unavailable, but the ranked areas and score factors remain available.
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
        <p className="mb-1 text-[11px] font-medium text-foreground">Opportunity</p>
        <div className="flex items-center gap-1">
          {[
            ['Low', 20],
            ['', 42],
            ['', 58],
            ['', 72],
            ['High', 88],
          ].map(([label, score], index) => (
            <div key={index} className="flex items-center gap-1">
              <span className="h-2.5 w-5 rounded-sm" style={{ backgroundColor: scoreColour(Number(score)) }} />
              {label ? <span className="text-[10px] text-muted-foreground">{label}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TerritoryIQPanel({
  campaignId,
  canRefresh,
}: {
  campaignId: string;
  canRefresh: boolean;
}) {
  const [data, setData] = useState<TerritoryIQResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const response = await fetch(`/api/campaigns/${campaignId}/territory-iq`, {
      credentials: 'include',
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? 'Could not load Territory IQ');
    setData(payload as TerritoryIQResponse);
  }, [campaignId]);

  useEffect(() => {
    setLoading(true);
    void load()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load Territory IQ'))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (data?.status !== 'queued' && data?.status !== 'processing') return;
    const interval = window.setInterval(() => {
      void load().catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Could not load Territory IQ');
      });
    }, 3_000);
    return () => window.clearInterval(interval);
  }, [data?.status, load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/territory-iq/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? 'Could not refresh GRID SCORE');
      setData((current) => current ? {
        ...current,
        status: 'queued',
        retryMessage: payload?.retryMessage ?? 'GRID SCORE refresh queued.',
      } : current);
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not refresh GRID SCORE');
    } finally {
      setRefreshing(false);
    }
  }, [campaignId]);

  const ranked = useMemo(
    () =>
      [...(data?.cells.features ?? [])]
        .filter((cell) => cell.properties.score !== null)
        .sort((left, right) => Number(right.properties.score) - Number(left.properties.score))
        .slice(0, 5),
    [data]
  );
  const selectedCell = data?.cells.features.find(
    (cell) => cell.properties.cellId === selectedCellId
  )?.properties ?? null;
  const visibleFactors = selectedCell?.factors ?? data?.factors ?? [];

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8">
        <div className="mx-auto h-12 w-12 animate-pulse rounded-full bg-muted" />
        <div className="mx-auto mt-4 h-4 w-48 animate-pulse rounded bg-muted" />
        <p className="mt-3 text-center text-sm text-muted-foreground">Calculating Territory IQ…</p>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
        <p className="mt-3 text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <BrainCircuit className="h-4 w-4" />
                Territory IQ
                <Badge
                  variant="outline"
                  className="border-primary/30 bg-primary/10 px-1.5 py-0 text-[10px] font-bold tracking-widest text-primary"
                >
                  BETA
                </Badge>
              </div>
              <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground">GRID SCORE</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">{data.overall.explanation}</p>
            </div>
            {canRefresh ? (
              <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            ) : null}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-6">
            <div
              className="grid h-32 w-32 place-items-center rounded-full p-2"
              style={{
                background: `conic-gradient(${scoreColour(data.overall.score)} ${
                  data.overall.score ?? 0
                }%, var(--muted) 0)`,
              }}
            >
              <div className="grid h-full w-full place-items-center rounded-full bg-card text-center">
                <div>
                  <p className="text-4xl font-black text-foreground">{data.overall.score ?? '—'}</p>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">out of 100</p>
                </div>
              </div>
            </div>
            <div className="grid min-w-[220px] flex-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Confidence</p>
                <p className="mt-1 font-semibold capitalize text-foreground">
                  {data.overall.confidenceLabel.replace('_', ' ')} · {Math.round(data.overall.confidence * 100)}%
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Model</p>
                <p className="mt-1 font-semibold text-foreground">{data.model.displayName}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Local benchmark</p>
                <p className="mt-1 font-semibold text-foreground">{data.overall.benchmark}</p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Target homes</p>
                <p className="mt-1 font-semibold text-foreground">{data.overall.targetHomeCount.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Best areas to work</h3>
          </div>
          <div className="mt-4 space-y-2">
            {ranked.length ? ranked.map((cell, index) => (
              <button
                key={cell.properties.cellId}
                type="button"
                onClick={() => setSelectedCellId(cell.properties.cellId)}
                className="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition hover:bg-muted/50"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    Grid area {cell.properties.cellId.slice(-5).toUpperCase()}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {cell.properties.targetHomeCount} target homes
                  </span>
                </span>
                <span className="text-lg font-black" style={{ color: scoreColour(cell.properties.score) }}>
                  {cell.properties.score}
                </span>
              </button>
            )) : (
              <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
                Ranked areas will appear when at least two core signals are available.
              </p>
            )}
          </div>
        </div>
      </div>

      {data.cells.features.length ? (
        <TerritoryIQMap
          data={data}
          selectedCellId={selectedCellId}
          onSelect={(cell) => setSelectedCellId(cell.cellId)}
        />
      ) : null}

      {data.insights?.length ? (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Local opportunity signals</h3>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Municipal signals sharpen GRID SCORE at their published area or point resolution. They are
            context for prioritization, not facts about individual homes.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.insights.map((insight) => <InsightRow key={insight.key} insight={insight} />)}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {selectedCell ? `Grid area ${selectedCell.cellId.slice(-5).toUpperCase()}` : 'What drives this score'}
            </h3>
            {selectedCell ? (
              <Button variant="ghost" size="sm" onClick={() => setSelectedCellId(null)}>Show campaign</Button>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {visibleFactors.map((candidate) => <FactorRow key={candidate.key} factor={candidate} />)}
          </div>
        </div>
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Data sources</h3>
            </div>
            <div className="mt-3 space-y-3">
              {data.sources.length ? data.sources.map((source) => (
                <div key={source.key}>
                  <p className="text-sm font-medium text-foreground">{source.provider}</p>
                  <p className="text-xs text-muted-foreground">{source.dataset} · {source.version}</p>
                </div>
              )) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  No promoted Territory IQ datasets cover this campaign yet.
                </p>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground">Why this score?</h3>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Census values are neighbourhood-level estimates, not facts about individual households.
              Municipal permits, service requests, traffic, safety and incident layers retain their
              published resolution and are also never presented as household-level facts.{' '}
              GRID SCORE ranks opportunity relative to the local market and does not guarantee property
              condition, ownership, storm damage, or conversion.
            </p>
            {data.missingFactors.length ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Missing factors are excluded and their weight is redistributed across available signals:
                {' '}{data.missingFactors.map((key) => key.replaceAll('_', ' ')).join(', ')}.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
