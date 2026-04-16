import type { Farm, FarmTouchInterval } from '@/types/database';

export function formatDateInput(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function addInterval(date: Date, interval: FarmTouchInterval, amount: number): Date {
  const next = new Date(date);
  if (interval === 'year') {
    next.setFullYear(next.getFullYear() + amount);
    return next;
  }

  next.setMonth(next.getMonth() + amount);
  return next;
}

export function buildCadenceTouchPlan(
  farm: Pick<Farm, 'start_date' | 'touches_interval' | 'frequency'> | null,
  limit: number
): Array<{ sequenceNumber: number; cycleNumber: number; suggestedDate: string }> {
  if (!farm) return [];

  const startDate = new Date(`${formatDateInput(farm.start_date)}T12:00:00`);
  if (Number.isNaN(startDate.getTime())) return [];

  const today = new Date();
  const todayFloor = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const interval = farm.touches_interval === 'year' ? 'year' : 'month';
  const planned: Array<{ sequenceNumber: number; cycleNumber: number; suggestedDate: string }> = [];

  for (let cycleIndex = 0; planned.length < limit && cycleIndex < 500; cycleIndex += 1) {
    const cycleNumber = cycleIndex + 1;
    const touchDate = addInterval(startDate, interval, cycleIndex);

    if (touchDate < todayFloor) continue;

    planned.push({
      sequenceNumber: cycleNumber,
      cycleNumber,
      suggestedDate: formatDateInput(touchDate),
    });
  }

  return planned;
}
