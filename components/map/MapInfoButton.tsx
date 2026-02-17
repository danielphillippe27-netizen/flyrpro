'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MapInfoSheet } from './MapInfoSheet';

interface MapInfoButtonProps {
  /** When false, button is not rendered (e.g. until map is loaded). Default true. */
  show?: boolean;
}

/**
 * Reusable map info control: red (i) button in top-left that opens legend + web map gestures.
 * Use inside a relative map container on every map view.
 */
export function MapInfoButton({ show = true }: MapInfoButtonProps) {
  const [open, setOpen] = useState(false);

  if (!show) return null;

  return (
    <>
      <div className="absolute top-3 left-3 z-10">
        <Button
          variant="secondary"
          className="h-9 rounded-full bg-red-600 hover:bg-red-700 shadow-md border-0 text-white px-4 text-xs font-semibold"
          onClick={() => setOpen(true)}
          aria-label="Map info and controls"
        >
          Read me
        </Button>
      </div>
      <MapInfoSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
