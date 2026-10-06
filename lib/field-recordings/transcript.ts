import { z } from 'zod';
import { transcriptSegmentSchema, type CaptureEvent, type TranscriptSegment, type DoorInterval, conversationTiming, matchDoor } from './contracts';

const resultSchema = z.object({ results: z.array(z.object({
  start: z.number().nonnegative(), end: z.number().nonnegative(), text: z.string(), speaker_id: z.string().nullish(),
})).max(100000) });

export function normalizePlaudTranscript(data: unknown, chunkId: string, offsetMs: number): TranscriptSegment[] {
  const parsed = resultSchema.parse(data);
  return parsed.results.filter(s => s.text.trim()).map((s, index) => transcriptSegmentSchema.parse({
    id: `${chunkId}:${index}`, startMs: offsetMs + Math.round(s.start * 1000), endMs: offsetMs + Math.round(s.end * 1000),
    text: s.text.trim(), speaker: s.speaker_id ?? null,
  }));
}

export function doorIntervals(events: CaptureEvent[], startedAt: string): DoorInterval[] {
  const origin = Date.parse(startedAt);
  const active = new Map<string, CaptureEvent>();
  const intervals: DoorInterval[] = [];
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (!event.targetId) continue;
    if (event.kind === 'door_started') active.set(event.targetId, event);
    if (event.kind === 'door_finished') {
      const start = active.get(event.targetId);
      active.delete(event.targetId);
      if (!start) continue;
      const startMs = Date.parse(start.occurredAt) - origin;
      const endMs = Date.parse(event.occurredAt) - origin;
      if (startMs >= 0 && endMs >= startMs) intervals.push({ targetId: event.targetId, startMs, endMs, consent: start.consent ?? 'unknown' });
    }
  }
  return intervals;
}

/** Door markers take precedence. Unknown audio stays available for review, never gets inferred consent. */
export function splitConversations(segments: TranscriptSegment[], doors: DoorInterval[]) {
  const groups: TranscriptSegment[][] = [];
  for (const segment of [...segments].sort((a, b) => a.startMs - b.startMs)) {
    const prior = groups.at(-1);
    const priorTarget = prior ? matchDoor(prior, doors) : null;
    const target = matchDoor([segment], doors);
    if (prior && segment.startMs - Math.max(...prior.map(s => s.endMs)) <= 20000 && target === priorTarget && prior.reduce((n, s) => n + s.text.length, 0) + segment.text.length <= 55000) prior.push(segment);
    else groups.push([segment]);
  }
  return groups.map(group => {
    const targetId = matchDoor(group, doors);
    return { segments: group, targetId, consent: targetId ? 'granted' as const : 'unknown' as const, timing: conversationTiming(group) };
  });
}
