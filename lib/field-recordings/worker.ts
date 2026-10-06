import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { captureEventSchema, transcriptSegmentSchema } from './contracts';
import { analyzeWithJev } from './jev';
import { completePlaudUpload, createPlaudUpload, getPlaudTranscription, issuePlaudUserToken, plaudUploadSchema, submitPlaudTranscription, validatePlaudStorageUrl } from './plaud';
import { doorIntervals, normalizePlaudTranscript, splitConversations } from './transcript';
import { alignAudioTimeline, type AudioTimelineMode } from './timeline';
import { writeConversation } from './writing';
import { fieldProcessingEnabled } from './rollout';
import { nextProviderLimitDelay, providerRequestLimit, transcriptionMinuteLimit, ProviderLimitWait, type PaidStage } from './provider-limits';

import { verifyAudio } from './audio-verification';
export { verifyAudio } from './audio-verification';

type Job = { id: string; recording_id: string; chunk_id: string; stage: string; attempts: number; lease_token: string };
type DB = ReturnType<typeof createAdminClient>;
class TranscriptionNotStarted extends Error {}
async function reserveProviderRequest(db: DB, job: Job) {
  let limit: number | null;
  let minutes: number | null;
  try { limit = providerRequestLimit(job.stage as PaidStage); minutes = job.stage === 'transcribe' ? transcriptionMinuteLimit() : null; }
  catch { throw new ProviderLimitWait('provider_limit_unavailable', 3600); }
  const { data, error } = await db.rpc('reserve_field_recording_provider_request', { p_job: job.id, p_lease: job.lease_token, p_limit: limit, p_minutes_limit: minutes });
  if (error || typeof data !== 'boolean') throw new ProviderLimitWait('provider_limit_unavailable', 300);
  if (!data) throw new ProviderLimitWait('daily_provider_limit', nextProviderLimitDelay());
}

async function commit(db: DB, job: Job, result: Record<string, unknown>) {
  const { data, error } = await db.rpc('commit_field_recording_job', { p_job: job.id, p_lease: job.lease_token, p_result: result });
  if (error) throw new Error('Job checkpoint unavailable');
  return data === true;
}

async function audioUrl(db: DB, path: string) {
  const { data, error } = await db.storage.from('field-recordings').createSignedUrl(path, 600);
  if (error || !data) throw new Error('Audio unavailable');
  return data.signedUrl;
}


async function processJob(db: DB, job: Job) {
  const [{ data: recording, error: recordingError }, { data: chunk, error: chunkError }] = await Promise.all([
    db.from('field_recordings').select('*').eq('id', job.recording_id).is('deleted_at', null).maybeSingle(),
    db.from('field_recording_chunks').select('*').eq('id', job.chunk_id).eq('recording_id', job.recording_id).maybeSingle(),
  ]);
  if (recordingError || chunkError) throw new Error('Recording storage unavailable');
  if (!recording || !chunk) return commit(db, job, { status: 'cancelled' });
  const { data: member, error: membershipError } = await db.from('workspace_members').select('user_id').eq('workspace_id', recording.workspace_id).eq('user_id', recording.user_id).maybeSingle();
  if (membershipError) throw new Error('Membership unavailable');
  if (!member) return commit(db, job, { status: 'cancelled' });

  if (job.stage === 'verify') {
    const duration = await verifyAudio(await audioUrl(db, chunk.storage_path), Number(chunk.byte_count), chunk.checksum_sha256);
    const { error } = await db.rpc('checkpoint_field_recording_audio_duration', { p_job: job.id, p_lease: job.lease_token, p_duration: duration });
    if (error) throw new Error('Measured audio checkpoint unavailable');
    return commit(db, job, { nextStage: 'upload', chunk: { verified_at: new Date().toISOString(), transcription_state: 'verified' } });
  }
  if (job.stage === 'upload') {
    const token = await issuePlaudUserToken(`wolfgrid:${recording.workspace_id}:${recording.user_id}`);
    const upload = chunk.provider_upload ? plaudUploadSchema.parse(chunk.provider_upload) : await createPlaudUpload(token.access_token, Number(chunk.byte_count));
    if (!chunk.provider_upload) return commit(db, job, { nextStage: 'upload', chunk: { provider_upload: upload } });
    const parts = z.array(z.object({ PartNumber: z.number().int().positive(), ETag: z.string().min(1) })).parse(chunk.provider_parts);
    const ordered = [...upload.Parts].sort((a, b) => a.PartNumber - b.PartNumber);
    if (ordered.length !== Math.ceil(Number(chunk.byte_count) / upload.ChunkSize) || ordered.some((p, index) => p.PartNumber !== index + 1)) throw new Error('Provider upload manifest invalid');
    const part = ordered.find(part => !parts.some(done => done.PartNumber === part.PartNumber));
    if (part) {
      const start = (part.PartNumber - 1) * upload.ChunkSize;
      const end = Math.min(Number(chunk.byte_count), start + upload.ChunkSize) - 1;
      const source = await fetch(await audioUrl(db, chunk.storage_path), { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(30000), redirect: 'error', cache: 'no-store' });
      if (source.status !== 206 || source.headers.get('content-range') !== `bytes ${start}-${end}/${chunk.byte_count}`) throw new Error('Audio range download unavailable');
      const bytes = await source.arrayBuffer();
      if (bytes.byteLength !== end - start + 1) throw new Error('Audio range mismatch');
      const destination = await fetch(validatePlaudStorageUrl(part.PresignedUrl), { method: 'PUT', body: bytes, redirect: 'error', signal: AbortSignal.timeout(30000) });
      const etag = destination.headers.get('etag');
      if (!destination.ok || !etag) throw new Error('Provider part upload failed');
      return commit(db, job, { nextStage: 'upload', chunk: { provider_parts: [...parts, { PartNumber: part.PartNumber, ETag: etag }] } });
    }
    const completed = await completePlaudUpload(token.access_token, upload, [...parts].sort((a, b) => a.PartNumber - b.PartNumber));
    validatePlaudStorageUrl(completed.DownloadUrl);
    return commit(db, job, { nextStage: 'transcribe', processingState: 'transcription_pending', chunk: { provider_download_url: completed.DownloadUrl, transcription_state: 'uploaded' } });
  }
  if (job.stage === 'transcribe') {
    if (chunk.transcription_id) return commit(db, job, { nextStage: 'poll' });
    let downloadUrl: string;
    try { downloadUrl = validatePlaudStorageUrl(chunk.provider_download_url); }
    catch { throw new TranscriptionNotStarted('Provider audio unavailable'); }
    if (chunk.measured_audio_ms === null || chunk.measured_audio_ms === undefined) {
      let duration: number;
      try { duration = await verifyAudio(await audioUrl(db, chunk.storage_path), Number(chunk.byte_count), chunk.checksum_sha256); }
      catch { throw new TranscriptionNotStarted('Audio verification failed before submission'); }
      const { error } = await db.rpc('checkpoint_field_recording_audio_duration', { p_job: job.id, p_lease: job.lease_token, p_duration: duration });
      if (error) throw new ProviderLimitWait('provider_limit_unavailable', 300);
    }
    // An ambiguous submission is never automatically repeated (claim RPC quarantines expired submissions).
    await reserveProviderRequest(db, job);
    const submitted = await submitPlaudTranscription(downloadUrl);
    return commit(db, job, { nextStage: 'poll', delaySeconds: 20, chunk: { transcription_id: submitted.transcription_id, transcription_state: submitted.status } });
  }
  if (job.stage === 'poll') {
    if (!chunk.transcription_id) throw new Error('Transcription identity missing');
    const result = await getPlaudTranscription(chunk.transcription_id);
    if (result.status === 'FAILURE' || result.status === 'REVOKED') return commit(db, job, { status: 'error', errorCode: 'transcription_failed', processingState: 'error', chunk: { transcription_state: result.status } });
    if (result.status !== 'SUCCESS') return commit(db, job, { nextStage: 'poll', delaySeconds: 60, chunk: { transcription_state: result.status } });
    const segments = normalizePlaudTranscript(result.data, chunk.id, Number(chunk.session_offset_ms));
    const { data: rows, error } = await db.from('field_recording_events').select('payload').eq('recording_id', recording.id).order('sequence');
    if (error) throw new Error('Door events unavailable');
    const events = (rows || []).map(row => captureEventSchema.parse(row.payload));
    // Keep audio beyond the requested session stop out of AI analysis.
    const stopEvents = events.filter(e => e.kind === 'stop_requested');
    const endMs = stopEvents.length ? Math.min(...stopEvents.map(e => Date.parse(e.occurredAt) - Date.parse(recording.started_at))) : Number.POSITIVE_INFINITY;
    const configuredMode = process.env.PLAUD_AUDIO_TIMELINE_MODE;
    const mode: AudioTimelineMode = configuredMode === 'continuous' || configuredMode === 'pause_compacted' ? configuredMode : 'unknown';
    const timeline = alignAudioTimeline(segments, events, recording.started_at, Number(chunk.session_offset_ms), chunk.provider_recording_id, mode);
    const bounded = timeline.segments.filter(segment => segment.endMs <= timeline.conservativeEndMs(endMs));
    // Unverified pause mapping cannot establish door identity or inferred permission.
    const conversations = splitConversations(bounded, timeline.aligned ? doorIntervals(events, recording.started_at) : [])
      .map(conversation => ({ ...conversation, timing: timeline.timing(conversation.segments) }));
    return commit(db, job, { nextStage: 'analyze', processingState: 'transcribed', conversations, chunk: { transcript: bounded, transcription_state: 'SUCCESS' } });
  }
  if (job.stage === 'analyze') {
    const { data: conversations, error } = await db.from('field_conversations').select('*').eq('recording_id', recording.id).eq('chunk_id', chunk.id).eq('review_state', 'pending').eq('consent', 'granted').is('analysis', null).limit(1);
    if (error) throw new Error('Conversation queue unavailable');
    const conversation = conversations?.[0];
    if (!conversation) return commit(db, job, { nextStage: 'write' });
    const segments = z.array(transcriptSegmentSchema).parse(conversation.segments);
    await reserveProviderRequest(db, job);
    const analysis = await analyzeWithJev(segments, { timezone: recording.timezone, recordedAt: recording.started_at });
    return commit(db, job, { nextStage: 'analyze', processingState: 'analyzing', conversation: { id: conversation.id, expectedVersion: conversation.version, analysis } });
  }
  if (job.stage === 'write') {
    const { data: conversations, error } = await db.from('field_conversations').select('*').eq('recording_id', recording.id).eq('chunk_id', chunk.id).eq('review_state', 'pending').eq('consent', 'granted').not('analysis', 'is', null).is('summary', null).limit(1);
    if (error) throw new Error('Writing queue unavailable');
    const conversation = conversations?.[0];
    if (!conversation) return commit(db, job, { status: 'done', processingState: 'needs_review' });
    const segments = z.array(transcriptSegmentSchema).parse(conversation.segments);
    const recordedAt = new Date(Date.parse(recording.started_at) + Math.min(...segments.map(s => s.startMs))).toISOString();
    await reserveProviderRequest(db, job);
    const writing = await writeConversation(segments, conversation.analysis, recordedAt, recording.timezone);
    return commit(db, job, { nextStage: 'write', conversation: { id: conversation.id, expectedVersion: conversation.version, analysis: conversation.analysis, summary: writing.summary, note: writing.note, evidence: writing.evidence, action_proposals: writing.actions } });
  }
  throw new Error('Unknown processing stage');
}

export async function dispatchFieldRecordings() {
  if (!fieldProcessingEnabled()) return { processed: 0, paused: true };
  const db = createAdminClient();
  let processed = 0;
  const deadline = Date.now() + 180000;
  while (processed < 3 && Date.now() < deadline) {
    if (!fieldProcessingEnabled()) break;
    const { data, error } = await db.rpc('claim_field_recording_job');
    if (error) throw new Error('Recording queue unavailable');
    if (!data) break;
    const job = data as Job;
    try { await processJob(db, job); }
    catch (failure) {
      if (failure instanceof TranscriptionNotStarted) {
        await commit(db, job, {
          status: job.attempts >= 8 ? 'error' : 'pending',
          delaySeconds: Math.min(3600, 30 * 2 ** Math.min(job.attempts, 6)),
          errorCode: 'audio_not_ready_for_submission',
          ...(job.attempts >= 8 ? { processingState: 'error' } : {}),
        });
        processed++; continue;
      }
      if (failure instanceof ProviderLimitWait) {
        await commit(db, job, { status: 'pending', delaySeconds: failure.delay, errorCode: failure.code });
        processed++; continue;
      }
      await commit(db, job, {
        status: job.stage === 'transcribe' || job.attempts >= 8 ? 'error' : 'pending',
        delaySeconds: Math.min(3600, 30 * 2 ** Math.min(job.attempts, 6)),
        errorCode: job.stage === 'transcribe' ? 'submission_outcome_unknown' : 'processing_failed',
        ...(job.attempts >= 8 || job.stage === 'transcribe' ? { processingState: 'error' } : {}),
      });
    }
    processed++;
  }
  return { processed };
}
