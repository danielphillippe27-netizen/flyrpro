import { z } from 'zod';
import { conversationTiming, transcriptSegmentSchema, type TranscriptSegment } from './contracts';

export const restructureRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('split'), conversationId: z.uuid(), version: z.number().int().positive(), beforeSegmentId: z.string().min(1).max(120) }).strict(),
  z.object({ operation: z.literal('merge'), conversations: z.array(z.object({ id: z.uuid(), version: z.number().int().positive() }).strict()).min(2).max(20) }).strict()
    .refine(value => new Set(value.conversations.map(item => item.id)).size === value.conversations.length, 'Choose distinct conversations'),
]);
export type RestructureSource = {
  id: string; version: number; recording_id: string; chunk_id: string | null; review_state: string;
  segments: TranscriptSegment[]; timing?: { clock?: string } | null;
};
export type RestructureDraft = {
  chunkId: string; segments: TranscriptSegment[]; sourceConversationIds: string[];
  targetId: null; targetConfirmed: false; consent: 'unknown';
  summary: null; note: null; evidence: []; actionProposals: []; analysis: null;
  timing: { spanMs: number; speechMs: null; clock: 'campaign' | 'audio_unaligned' };
};
function checked(source: RestructureSource) {
  z.uuid().parse(source.id); z.uuid().parse(source.recording_id); z.uuid().parse(source.chunk_id);
  if (source.review_state !== 'pending' || !Number.isInteger(source.version) || source.version < 1) throw new Error('Only pending conversation versions can be restructured');
  const segments = z.array(transcriptSegmentSchema).min(1).max(10000).parse(source.segments);
  if (new Set(segments.map(segment => segment.id)).size !== segments.length) throw new Error('Duplicate source segments');
  if (segments.some((segment, index) => segment.text !== source.segments[index].text || (index > 0 && segment.startMs < segments[index - 1].startMs))) throw new Error('Source ordering or content needs reconciliation');
  return segments;
}
function draft(sources: RestructureSource[], segments: TranscriptSegment[]): RestructureDraft {
  if (segments.reduce((total, segment) => total + segment.text.length, 0) > 55000) throw new Error('Conversation is too large for analysis; split it first');
  return { chunkId: sources[0].chunk_id!, segments, sourceConversationIds: sources.map(source => source.id), targetId: null, targetConfirmed: false,
    consent: 'unknown', summary: null, note: null, evidence: [], actionProposals: [], analysis: null,
    timing: { spanMs: conversationTiming(segments).spanMs, speechMs: null, clock: sources.every(source => source.timing?.clock === 'campaign') ? 'campaign' : 'audio_unaligned' } };
}
/** Split only between immutable transcript segments. Permission/assignment must be reviewed again. */
export function previewConversationSplit(source: RestructureSource, beforeSegmentId: string): [RestructureDraft, RestructureDraft] {
  const segments = checked(source);
  const boundary = segments.findIndex(segment => segment.id === beforeSegmentId);
  if (boundary < 1) throw new Error('Choose a boundary after the first transcript segment');
  return [draft([source], segments.slice(0, boundary)), draft([source], segments.slice(boundary))];
}
/** Same-file merge preview. Cross-file merge requires multi-chunk playback lineage support. */
export function previewConversationMerge(sources: RestructureSource[]): RestructureDraft {
  if (sources.length < 2 || sources.length > 20 || new Set(sources.map(source => source.id)).size !== sources.length) throw new Error('Choose distinct conversations');
  if (sources.some(source => source.recording_id !== sources[0].recording_id || source.chunk_id !== sources[0].chunk_id)) throw new Error('Conversations must belong to the same recording file');
  const segments = sources.flatMap(checked).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a.id.localeCompare(b.id));
  if (new Set(segments.map(segment => segment.id)).size !== segments.length) throw new Error('Overlapping source lineage needs reconciliation');
  return draft(sources, segments);
}
