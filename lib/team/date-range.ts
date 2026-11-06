export type RangePreset = 'today' | '7d' | '30d' | 'year' | 'custom';

export function getRangeForPreset(preset: RangePreset, now: Date = new Date()): { start: string; end: string } {
  const end = new Date(now);
  const start = new Date(now);
  if (preset === 'today') {
    // Calendar-day filters follow the viewer's timezone, not the UTC date.
    start.setHours(0, 0, 0, 0);
  } else if (preset === '7d') {
    start.setDate(start.getDate() - 6);
    start.setUTCHours(0, 0, 0, 0);
  } else if (preset === '30d') {
    start.setDate(start.getDate() - 29);
    start.setUTCHours(0, 0, 0, 0);
  } else if (preset === 'year') {
    start.setMonth(0, 1);
    start.setUTCHours(0, 0, 0, 0);
  } else {
    return { start: start.toISOString(), end: end.toISOString() };
  }
  return { start: start.toISOString(), end: end.toISOString() };
}
