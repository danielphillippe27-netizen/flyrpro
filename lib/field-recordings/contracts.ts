import { z } from 'zod';

export const captureStates = ['ready', 'start_requested', 'recording', 'paused', 'stop_requested', 'stopped', 'unknown', 'error'] as const;
export const captureEventSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['start_requested', 'start_confirmed', 'stop_requested', 'stop_confirmed', 'disconnected', 'reconnected', 'door_started', 'door_finished', 'paused', 'resumed', 'error']),
  occurredAt: z.iso.datetime({ offset: true }),
  deviceSerial: z.string().trim().min(1).max(120).optional(),
  providerRecordingId: z.string().trim().min(1).max(120).optional(),
  targetId: z.uuid().optional(),
  consent: z.enum(['granted', 'declined', 'unknown']).optional(),
  sequence: z.number().int().nonnegative(),
}).strict();
export type CaptureEvent = z.infer<typeof captureEventSchema>;

export const transcriptSegmentSchema = z.object({
  id: z.string().min(1).max(120),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(12000),
  speaker: z.string().max(120).nullable(),
}).strict().refine(s => s.endMs >= s.startMs, 'Segment end precedes start');
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const outcomes = ['conversation', 'declined_offer', 'follow_up_requested', 'information_requested', 'appointment_agreed', 'qualified_opportunity', 'do_not_contact', 'unclear'] as const;
export const objections = ['timing', 'existing_agent', 'trust', 'price_value', 'privacy', 'busy', 'not_interested', 'other'] as const;
export const createRecordingSchema = z.object({
  id: z.uuid(), sessionId: z.uuid(), workspaceId: z.uuid(),
  deviceSerial: z.string().trim().min(1).max(120),
  startedAt: z.iso.datetime({ offset: true }),
  timezone: z.string().min(1).max(80).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, 'Invalid timezone'),
}).strict();

/** Only hardware acknowledgements establish recording or stopped state. */
export function captureStateAfter(state: typeof captureStates[number], event: CaptureEvent): typeof captureStates[number] {
  switch (event.kind) {
    case 'start_requested': return 'start_requested';
    case 'start_confirmed': return 'recording';
    case 'paused': return 'paused';
    case 'resumed': return 'recording';
    case 'stop_requested': return 'stop_requested';
    case 'stop_confirmed': return 'stopped';
    case 'disconnected': return state === 'stopped' || state === 'ready' ? state : 'unknown';
    case 'error': return 'error';
    default: return state;
  }
}

/** Speech time is the union of intervals, so overlapping speakers cannot inflate it. */
export function conversationTiming(segments: TranscriptSegment[]) {
  if (!segments.length) return { spanMs: 0, speechMs: 0 };
  const ranges = segments.map(s => [s.startMs, s.endMs]).sort((a, b) => a[0] - b[0]);
  let speechMs = 0;
  let [start, end] = ranges[0];
  for (const [nextStart, nextEnd] of ranges.slice(1)) {
    if (nextStart <= end) end = Math.max(end, nextEnd);
    else { speechMs += end - start; start = nextStart; end = nextEnd; }
  }
  speechMs += end - start;
  return { spanMs: Math.max(...ranges.map(r => r[1])) - ranges[0][0], speechMs };
}

export type DoorInterval = { targetId: string; startMs: number; endMs: number; consent: 'granted' | 'declined' | 'unknown' };
/** An explicit, uniquely overlapping consented door is the only automatic match. */
export function matchDoor(segments: TranscriptSegment[], doors: DoorInterval[]): string | null {
  if (!segments.length) return null;
  const start = Math.min(...segments.map(s => s.startMs));
  const end = Math.max(...segments.map(s => s.endMs));
  // A second overlapping marker makes ownership ambiguous even when its
  // consent is declined or unknown. Do not silently assign its speech to
  // a different, consented resident.
  const overlaps = doors.filter(d => d.startMs < end && d.endMs > start);
  if (overlaps.length !== 1) return null;
  const door = overlaps[0];
  return door.consent === 'granted' && door.startMs <= start && door.endMs >= end ? door.targetId : null;
}
