'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import {
  MAP_STATUS_CONFIG,
  MAP_STATUS_PRIORITY,
  type MapStatusKey,
  type StatusFilters,
} from '@/lib/constants/mapStatus';
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
}

/**
 * Info dialog shown from the "Read me" button: drawing tip, legend + web map gestures.
 * Centered square card in the middle of the screen.
 */
const TOOL_FILTER_ITEMS: Array<{ key: MapStatusKey; label: string }> = [
  { key: 'QR_SCANNED', label: 'QR codes scanned' },
  { key: 'CONVERSATIONS', label: 'Conversations' },
  { key: 'TOUCHED', label: 'Visited homes' },
  { key: 'UNTOUCHED', label: 'Unvisited' },
];

export function MapInfoSheet({
  open,
  onOpenChange,
  statusFilters,
  onStatusFiltersChange,
}: MapInfoSheetProps) {
  const activeStatusFilters: StatusFilters = statusFilters ?? {
    QR_SCANNED: true,
    CONVERSATIONS: true,
    TOUCHED: true,
    UNTOUCHED: true,
  };

  const handleStatusToggle = (key: MapStatusKey, checked: boolean) => {
    if (!statusFilters || !onStatusFiltersChange) return;
    onStatusFiltersChange({
      ...statusFilters,
      [key]: checked,
    });
  };

  const canToggleStatuses = Boolean(statusFilters && onStatusFiltersChange);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] w-[460px] rounded-2xl p-5">
        <DialogHeader className="text-left pb-1.5 border-b border-border/60">
          <DialogTitle className="text-sm font-semibold">Tools</DialogTitle>
        </DialogHeader>

        {canToggleStatuses && (
          <section className="space-y-2">
            <div>
              <h3 className="text-xs font-semibold text-foreground">Map filters</h3>
              <p className="text-[11px] text-muted-foreground">
                Toggle which campaign activity is visible on the map.
              </p>
            </div>
            <ul className="space-y-1.5">
              {TOOL_FILTER_ITEMS.map(({ key, label }) => {
                const config = MAP_STATUS_CONFIG[key];
                return (
                  <li
                    key={key}
                    className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/30 px-2.5 py-2"
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

        <section className="space-y-2 border-t border-border/60 pt-3">
          <h3 className="text-xs font-semibold text-foreground">Read me</h3>
          {/* Drawing Tip */}
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <Crosshair className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-foreground">Drawing tip</p>
                <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                  When creating a campaign, be precise to the road lines and intersections so you have clean campaigns and optimized routes.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {/* Map Gestures - web controls */}
            <section>
              <h3 className="text-xs font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
                <MousePointer2 className="w-3.5 h-3.5" />
                Map gestures
              </h3>
              <ul className="space-y-1">
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
            <section>
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
