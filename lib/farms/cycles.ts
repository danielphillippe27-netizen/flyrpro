import type { FarmTouchAddress } from '@/types/database';

export interface FarmCycle {
  farm_id: string;
  cycle_number: number;
  started_on: string | null;
  ends_on: string | null;
  closed_at: string | null;
  updated_at: string;
}

export function cycleDateError(start: string | null, end: string): string | null {
  if (!end) return null;
  const date = new Date(`${end}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== end) {
    return 'Choose a valid end date.';
  }
  return start && end < start ? 'End date cannot be before the cycle start date.' : null;
}

// Do-not-knock remains visible when current-round coverage resets.
export function cycleMapStatus(
  current: FarmTouchAddress | undefined,
  latest: FarmTouchAddress | undefined,
  savedStatus: string | null | undefined,
): string {
  if (savedStatus === 'do_not_knock' || latest?.status === 'do_not_knock') return 'do_not_knock';
  return current?.status ?? 'none';
}
