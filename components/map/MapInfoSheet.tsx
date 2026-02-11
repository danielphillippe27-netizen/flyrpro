'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { MAP_STATUS_CONFIG, MAP_STATUS_PRIORITY } from '@/lib/constants/mapStatus';
import {
  Move,
  ZoomIn,
  RotateCw,
  Mountain,
  MousePointer2,
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
}

/**
 * Info sheet shown from the map (i) button: legend + web map gestures.
 * Matches iOS app: Map Gestures + Homes legend.
 */
export function MapInfoSheet({ open, onOpenChange }: MapInfoSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[min(320px,50vh)] overflow-y-auto p-4">
        <SheetHeader className="text-left pb-1.5 border-b border-border/60">
          <SheetTitle className="text-sm font-semibold">Map info</SheetTitle>
        </SheetHeader>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-3">
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
      </SheetContent>
    </Sheet>
  );
}
