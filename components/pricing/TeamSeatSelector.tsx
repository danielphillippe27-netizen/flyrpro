'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

const BASE_PRICE_CAD = 79.99;
const EXTRA_SEAT_PRICE_CAD = 30;
const INCLUDED_SEATS = 2;
const MIN_SEATS = 2;
const MAX_SEATS = 50;

export function TeamSeatSelector() {
  const [seats, setSeats] = useState(INCLUDED_SEATS);
  const additional = Math.max(0, seats - INCLUDED_SEATS);
  const additionalCost = additional * EXTRA_SEAT_PRICE_CAD;
  const total = BASE_PRICE_CAD + additionalCost;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">Seats</span>
        <div className="flex items-center gap-1 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 p-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setSeats((s) => Math.max(MIN_SEATS, s - 1))}
            disabled={seats <= MIN_SEATS}
            aria-label="Decrease seats"
          >
            <Minus className="h-4 w-4" />
          </Button>
          <span className="min-w-[2.5rem] text-center text-sm font-semibold tabular-nums" aria-live="polite">
            {seats}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setSeats((s) => Math.min(MAX_SEATS, s + 1))}
            disabled={seats >= MAX_SEATS}
            aria-label="Increase seats"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 p-3 text-sm">
        <p className="text-zinc-600 dark:text-zinc-400">
          {INCLUDED_SEATS} seats included: CA${BASE_PRICE_CAD.toFixed(2)}
        </p>
        {additional > 0 && (
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            + {additional} additional seat{additional !== 1 ? 's' : ''}: CA${additionalCost.toFixed(2)} (CA${EXTRA_SEAT_PRICE_CAD} × {additional})
          </p>
        )}
        <p className="mt-2 font-semibold text-zinc-900 dark:text-white">
          Total: CA${total.toFixed(2)} / month
        </p>
      </div>
    </div>
  );
}
