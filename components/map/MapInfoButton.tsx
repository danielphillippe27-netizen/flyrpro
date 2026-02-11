'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
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
          size="icon"
          className="h-9 w-9 rounded-full bg-red-600 hover:bg-red-700 shadow-md border-0 text-white"
          onClick={() => setOpen(true)}
          aria-label="Map info and controls"
        >
          <Info className="h-5 w-5 text-white" strokeWidth={2.5} />
        </Button>
      </div>
      <MapInfoSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
