'use client';

import { useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DEFAULT_STATUS_FILTERS,
  MAP_STATUS_CONFIG,
  MAP_STATUS_PRIORITY,
  type MapStatusKey,
  type StatusFilters,
} from '@/lib/constants/mapStatus';
import { useMapStyle } from '@/lib/map-style-provider';
import {
  MAP_STYLE_PRESET_META,
  type MapStylePreset,
} from '@/lib/map-styles';
import {
  Move,
  ZoomIn,
  RotateCw,
  Mountain,
  MousePointer2,
  Crosshair,
} from 'lucide-react';

const WEB_MAP_GESTURES = [
  {
    icon: Move,
    label: 'Pan',
    description: 'Click and drag with one finger (or mouse)',
  },
  {
    icon: ZoomIn,
    label: 'Zoom',
    description: 'Scroll wheel in/out, or double-click to zoom in',
  },
  {
    icon: Mountain,
    label: 'Pitch (tilt)',
    description: 'Ctrl + drag up/down, or Ctrl + scroll',
  },
  {
    icon: RotateCw,
    label: 'Rotate',
    description: 'Shift + drag, or right-click and drag',
  },
] as const;

interface MapInfoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statusFilters?: StatusFilters;
  onStatusFiltersChange?: (filters: StatusFilters) => void;
  portalContainer?: HTMLElement | null;
  extraContent?: ReactNode;
}

/**
 * Info dialog shown from the "Read me" button: drawing tip, legend + web map gestures.
 * Centered square card in the middle of the screen.
 */
const TOOL_FILTER_ITEMS: Array<{ key: MapStatusKey; label: string }> = [
  { key: 'QR_SCANNED', label: 'QR codes scanned' },
  { key: 'HOT_LEADS', label: 'Appointments / follow-up' },
  { key: 'LEADS', label: 'Leads' },
  { key: 'CONVERSATIONS', label: 'Conversations' },
  { key: 'TOUCHED', label: 'Attempted' },
  { key: 'NO_ONE_HOME', label: 'No answer' },
  { key: 'DO_NOT_KNOCK', label: 'Do not knock' },
  { key: 'UNTOUCHED', label: 'Unvisited' },
];

export function MapInfoSheet({
  open,
  onOpenChange,
  statusFilters,
  onStatusFiltersChange,
  portalContainer,
  extraContent,
}: MapInfoSheetProps) {
  const [showMapConfigurator, setShowMapConfigurator] = useState(false);
  const { preset, setPreset } = useMapStyle();
  const activeStatusFilters: StatusFilters = statusFilters ?? DEFAULT_STATUS_FILTERS;

  const handleStatusToggle = (key: MapStatusKey, checked: boolean) => {
    if (!statusFilters || !onStatusFiltersChange) return;
    onStatusFiltersChange({
      ...statusFilters,
      [key]: checked,
    });
  };

  const canToggleStatuses = Boolean(statusFilters && onStatusFiltersChange);
  const presetEntries = Object.entries(MAP_STYLE_PRESET_META) as Array<
    [MapStylePreset, (typeof MAP_STYLE_PRESET_META)[MapStylePreset]]
  >;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-3rem)] w-[min(94vw,860px)] overflow-y-auto rounded-2xl p-5 sm:max-w-[860px]"
        portalContainer={portalContainer}
      >
        <DialogHeader className="text-left pb-1.5 border-b border-border/60">
          <DialogTitle className="text-sm font-semibold">Tools</DialogTitle>
        </DialogHeader>

        <section className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold text-foreground">Map style</h3>
              <p className="text-[11px] text-muted-foreground">
                Change the basemap preset across FLYR map views.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              onClick={() => setShowMapConfigurator((current) => !current)}
            >
              {showMapConfigurator ? 'Hide styles' : 'Configure Maps'}
            </Button>
          </div>

          {showMapConfigurator ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {presetEntries.map(([presetKey, meta]) => {
                const selected = preset === presetKey;
                return (
                  <button
                    key={presetKey}
                    type="button"
                    onClick={() => setPreset(presetKey)}
                    title={meta.description}
                    className={`flex min-h-14 items-center justify-center rounded-xl border px-2 py-3 text-center transition-colors ${
                      selected
                        ? 'border-red-400/70 bg-red-500/10 text-foreground'
                        : 'border-border/70 bg-muted/20 text-muted-foreground hover:bg-muted/35 hover:text-foreground'
                    }`}
                    aria-pressed={selected}
                    aria-label={meta.label}
                  >
                    <span className="text-[11px] font-semibold leading-tight sm:text-xs">
                      {meta.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>

        {canToggleStatuses && (
          <section className="space-y-2 border-t border-border/60 pt-3">
            <div>
              <h3 className="text-xs font-semibold text-foreground">Map filters</h3>
              <p className="text-[11px] text-muted-foreground">
                Toggle which campaign activity is visible on the map.
              </p>
            </div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {TOOL_FILTER_ITEMS.map(({ key, label }) => {
                const config = MAP_STATUS_CONFIG[key];
                return (
                  <li
                    key={key}
                    className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: config.color }}
                        aria-hidden
                      />
                      <span className="text-xs text-foreground truncate">{label}</span>
                    </div>
                    <Switch
                      checked={Boolean(activeStatusFilters[key])}
                      onCheckedChange={(checked) => handleStatusToggle(key, checked)}
                      aria-label={`Toggle ${label}`}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {extraContent ? (
          <section className="space-y-2 border-t border-border/60 pt-3">
            <h3 className="text-xs font-semibold text-foreground">Selection</h3>
            {extraContent}
          </section>
        ) : null}

        <section className="space-y-2 border-t border-border/60 pt-3">
          <h3 className="text-xs font-semibold text-foreground">Read me</h3>
          <div className="grid gap-3 lg:grid-cols-[1.15fr_1.35fr_1fr]">
            {/* Drawing Tip */}
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <Crosshair className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
                <div>
                  <p className="text-xs font-semibold text-foreground">Drawing tip</p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    Keep campaign boundaries tight to road lines and intersections for cleaner routes.
                  </p>
                </div>
              </div>
            </div>

            {/* Map Gestures - web controls */}
            <section className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
              <h3 className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
                <MousePointer2 className="w-3.5 h-3.5" />
                Map gestures
              </h3>
              <ul className="grid gap-x-3 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-1">
                {WEB_MAP_GESTURES.map(({ icon: Icon, label, description }) => (
                  <li key={label} className="flex items-start gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted">
                      <Icon className="h-3 w-3 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground">{label}</p>
                      <p className="text-[11px] text-muted-foreground leading-tight">{description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Homes legend */}
            <section className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
              <h3 className="text-xs font-semibold text-foreground mb-1.5">Homes</h3>
              <ul className="space-y-1">
                {MAP_STATUS_PRIORITY.map((key) => {
                  const config = MAP_STATUS_CONFIG[key];
                  return (
                    <li key={key} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: config.color }}
                        aria-hidden
                      />
                      <span className="text-xs text-muted-foreground">{config.label}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
