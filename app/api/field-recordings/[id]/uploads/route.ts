import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ownedRecording, recordingError, RecordingAccessError } from '@/lib/field-recordings/access';

export const runtime = 'nodejs';
export const maxDuration = 60;
const manifestSchema = z.object({
  chunkId: z.uuid(), providerRecordingId: z.string().min(1).max(120),
  byteCount: z.number().int().min(1).max(536870912), checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  sessionOffsetMs: z.number().int().nonnegative(), durationMs: z.number().int().min(1).max(18000000),
}).strict();
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new RecordingAccessError('Invalid recording ID', 400);
    const input = manifestSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new RecordingAccessError('Invalid audio manifest', 400);
    const { db, user, recording } = await ownedRecording(request, id);
    const path = `${recording.workspace_id}/${user.id}/${id}/${input.data.chunkId}.mp3`;
    const { data: prior, error: lookupError } = await db.from('field_recording_chunks').select('*').eq('id', input.data.chunkId).maybeSingle();
    if (lookupError) throw lookupError;
    if (prior && (prior.recording_id !== id || prior.provider_recording_id !== input.data.providerRecordingId || prior.checksum_sha256 !== input.data.checksumSha256 || prior.byte_count !== input.data.byteCount || prior.session_offset_ms !== input.data.sessionOffsetMs || prior.duration_ms !== input.data.durationMs)) throw new RecordingAccessError('Audio identity conflict', 409);
    if (!prior) {
      const { error } = await db.from('field_recording_chunks').insert({ id: input.data.chunkId, recording_id: id, provider_recording_id: input.data.providerRecordingId, storage_path: path, checksum_sha256: input.data.checksumSha256, byte_count: input.data.byteCount, session_offset_ms: input.data.sessionOffsetMs, duration_ms: input.data.durationMs });
      if (error) throw error;
    }
    if (prior?.verified_at) return NextResponse.json({ chunkId: prior.id, alreadyUploaded: true });
    const { error: reservationError } = await db.rpc('reserve_field_recording_upload', { p_recording: id, p_user: user.id, p_chunk: input.data.chunkId });
    if (reservationError) throw new RecordingAccessError('Recording unavailable for upload', 409);
    const { data, error } = await db.storage.from('field-recordings').createSignedUploadUrl(path, { upsert: false });
    if (error) throw error;
    return NextResponse.json({ chunkId: input.data.chunkId, path, signedUrl: data.signedUrl, token: data.token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}
