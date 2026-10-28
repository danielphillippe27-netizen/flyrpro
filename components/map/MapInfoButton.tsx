'use client';

import { useState, type ReactNode } from 'react';
import { Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MapInfoSheet } from './MapInfoSheet';
import type { StatusFilters } from '@/lib/constants/mapStatus';

interface MapInfoButtonProps {
  /** When false, button is not rendered (e.g. until map is loaded). Default true. */
  show?: boolean;
  statusFilters?: StatusFilters;
  onStatusFiltersChange?: (filters: StatusFilters) => void;
  portalContainer?: HTMLElement | null;
  extraContent?: ReactNode;
  besideContent?: ReactNode;
}

/**
 * Reusable map info control: red (i) button in top-left that opens legend + web map gestures.
 * Use inside a relative map container on every map view.
 */
export function MapInfoButton({
  show = true,
  statusFilters,
  onStatusFiltersChange,
  portalContainer,
  extraContent,
  besideContent,
}: MapInfoButtonProps) {
  const [open, setOpen] = useState(false);

  if (!show) return null;

  return (
    <>
      <div className="pointer-events-none absolute top-3 left-3 z-20 flex max-w-[calc(100%-1.5rem)] items-start gap-2 sm:max-w-[calc(100%-22rem)]">
        <Button
          variant="secondary"
          className="pointer-events-auto h-9 rounded-full border border-red-300/30 bg-red-500/80 px-3 text-xs font-semibold text-white shadow-sm hover:bg-red-500/90"
          onClick={() => setOpen(true)}
          aria-label="Map tools"
        >
          <Wrench className="h-3 w-3" aria-hidden="true" />
          Tools
        </Button>
        <div className="pointer-events-auto min-w-0">{besideContent}</div>
      </div>
      <MapInfoSheet
        open={open}
        onOpenChange={setOpen}
        statusFilters={statusFilters}
        onStatusFiltersChange={onStatusFiltersChange}
        portalContainer={portalContainer}
        extraContent={extraContent}
      />
    </>
  );
}
