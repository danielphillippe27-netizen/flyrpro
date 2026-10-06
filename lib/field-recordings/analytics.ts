import type { CaptureEvent, DoorInterval } from './contracts';

export type CampaignTiming = {
  doors: (DoorInterval & { durationMs: number; gapBeforeMs: number | null })[];
  markedDoorMs: number;
  betweenDoorsMs: number | null;
  averageDoorMs: number | null;
  incompleteMarkers: number;
  ambiguousMarkers: number;
  includesPauses: boolean;
};

/** Measures explicit wall-clock door markers, independently of compressed audio timestamps. */
export function campaignTiming(events: CaptureEvent[], startedAt: string): CampaignTiming {
  const origin = Date.parse(startedAt);
  if (!Number.isFinite(origin)) throw new Error('Invalid campaign start');
  const active = new Map<string, CaptureEvent>();
  const pairs: DoorInterval[] = [];
  let incompleteMarkers = 0;
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.kind !== 'door_started' && event.kind !== 'door_finished') continue;
    if (!event.targetId) { incompleteMarkers++; continue; }
    if (event.kind === 'door_started') {
      if (active.has(event.targetId)) incompleteMarkers++;
      active.set(event.targetId, event);
    } else {
      const start = active.get(event.targetId);
      active.delete(event.targetId);
      if (!start) { incompleteMarkers++; continue; }
      const startMs = Date.parse(start.occurredAt) - origin;
      const endMs = Date.parse(event.occurredAt) - origin;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs < startMs) { incompleteMarkers++; continue; }
      pairs.push({ targetId: event.targetId, startMs, endMs, consent: start.consent ?? 'unknown' });
    }
  }
  incompleteMarkers += active.size;
  const ambiguous = new Set(pairs.filter(a => pairs.some(b => a !== b && a.startMs < b.endMs && b.startMs < a.endMs)));
  const valid = pairs.filter(pair => !ambiguous.has(pair)).sort((a, b) => a.startMs - b.startMs);
  // Missing or overlapping markers prevent claiming exact between-door totals.
  const reliableGaps = incompleteMarkers === 0 && ambiguous.size === 0;
  const doors = valid.map((door, index) => ({ ...door, durationMs: door.endMs - door.startMs,
    gapBeforeMs: reliableGaps && index > 0 ? door.startMs - valid[index - 1].endMs : null }));
  const markedDoorMs = doors.reduce((n, door) => n + door.durationMs, 0);
  return { doors, markedDoorMs, betweenDoorsMs: reliableGaps && doors.length > 1 ? doors.reduce((n, door) => n + (door.gapBeforeMs ?? 0), 0) : null,
    averageDoorMs: doors.length ? Math.round(markedDoorMs / doors.length) : null,
    incompleteMarkers, ambiguousMarkers: ambiguous.size, includesPauses: events.some(event => event.kind === 'paused') };
}
