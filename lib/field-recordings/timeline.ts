import { conversationTiming, type CaptureEvent, type TranscriptSegment } from './contracts';
export type AudioTimelineMode = 'unknown' | 'continuous' | 'pause_compacted';

/** A compacted timeline may only be enabled after validating the pinned SDK/device export behavior. */
export function alignAudioTimeline(segments: TranscriptSegment[], events: CaptureEvent[], startedAt: string, offsetMs: number, providerRecordingId: string, mode: AudioTimelineMode) {
  const origin = Date.parse(startedAt);
  if (!Number.isFinite(origin)) throw new Error('Invalid recording start');
  const relevant = [...events].sort((a, b) => a.sequence - b.sequence).filter(event => event.providerRecordingId === providerRecordingId);
  const pauses: { startMs: number; endMs: number; audioBoundaryMs: number }[] = [];
  let pending: number | null = null;
  let pausedMs = 0;
  const stoppedAt = relevant.find(event => event.kind === 'stop_confirmed');
  const endMs = stoppedAt ? Date.parse(stoppedAt.occurredAt) - origin : Number.POSITIVE_INFINITY;
  let invalid = events.some(event => {
    const time = Date.parse(event.occurredAt) - origin;
    return time >= offsetMs && time <= endMs && (event.kind === 'disconnected' || (!event.providerRecordingId && (event.kind === 'paused' || event.kind === 'resumed')));
  });
  for (const event of relevant) {
    const time = Date.parse(event.occurredAt) - origin;
    if (!Number.isFinite(time)) { invalid = true; continue; }
    if (event.kind === 'paused') {
      if (pending !== null || time < offsetMs) invalid = true;
      pending = time;
    }
    if (event.kind === 'resumed' || event.kind === 'stop_confirmed') {
      if (pending === null) { if (event.kind === 'resumed') invalid = true; continue; }
      if (time < pending) { invalid = true; pending = null; continue; }
      pauses.push({ startMs: pending, endMs: time, audioBoundaryMs: pending - pausedMs });
      pausedMs += time - pending;
      pending = null;
    }
  }
  if (pending !== null) invalid = true;
  const hasPause = relevant.some(event => event.kind === 'paused');
  const aligned = !invalid && (!hasPause || mode !== 'unknown');
  const map = (time: number, endpoint: boolean) => time + pauses.reduce((sum, pause) => sum + ((endpoint ? time > pause.audioBoundaryMs : time >= pause.audioBoundaryMs) ? pause.endMs - pause.startMs : 0), 0);
  const mapped = aligned && mode === 'pause_compacted' ? segments.map(segment => ({ ...segment, startMs: map(segment.startMs, false), endMs: map(segment.endMs, segment.endMs !== segment.startMs) })) : segments;
  const originals = new Map(segments.map(segment => [segment.id, segment]));
  return {
    segments: mapped, aligned, pausedMs,
    // With unknown export behavior, the compacted end is the earlier possible cutoff.
    conservativeEndMs: (campaignEndMs: number) => aligned || !Number.isFinite(campaignEndMs) ? campaignEndMs : campaignEndMs - pausedMs - (pending === null ? 0 : Math.max(0, campaignEndMs - pending)),
    timing: (group: TranscriptSegment[]) => ({ ...conversationTiming(group),
      speechMs: conversationTiming(group.map(segment => originals.get(segment.id)!)).speechMs,
      clock: aligned ? 'campaign' : 'audio_unaligned', pauseMapping: hasPause ? (aligned ? mode : 'unknown') : 'no_pauses' }),
  };
}
