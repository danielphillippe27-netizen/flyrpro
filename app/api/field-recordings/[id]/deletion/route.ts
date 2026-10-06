import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ownedRecording, recordingError, RecordingAccessError } from '@/lib/field-recordings/access';
import { checkedDeletionReceipt, checkedDeletionStatus } from '@/lib/field-recordings/deletion-status';
export const runtime = 'nodejs';
async function access(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) throw new RecordingAccessError('Invalid recording ID', 400);
  return { id, ...await ownedRecording(request, id, { includeDeleted: true }) };
}
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id, db, recording } = await access(request, context);
    const { data, error } = await db.from('field_recording_deletions').select('request_id,storage_state,provider_state,storage_not_before,created_at,completed_at').eq('recording_id', id).maybeSingle();
    if (error) throw error;
    return NextResponse.json(checkedDeletionStatus({ recordingId: id, deletionEnabled: process.env.FIELD_RECORDING_DELETION_ENABLED === 'true', hidden: recording.deleted_at !== null, captureStopped: recording.capture_state === 'stopped', cleanup: data }, id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const input = z.object({ requestId: z.uuid() }).strict().safeParse(await request.json().catch(() => null));
    if (!input.success) throw new RecordingAccessError('Invalid deletion request', 400);
    const { id, db, user, recording } = await access(request, context);
    // Recovery remains available after rollout pauses; new requests require the flag.
    if (!recording.deleted_at && process.env.FIELD_RECORDING_DELETION_ENABLED !== 'true') throw new RecordingAccessError('Recording deletion is not enabled yet', 503);
    const { data, error } = await db.rpc('request_field_recording_deletion', { p_recording: id, p_user: user.id, p_request: input.data.requestId });
    if (error?.code === '40001') throw new RecordingAccessError('Deletion request changed. Refresh its status.', 409);
    if (error?.code === '42501') throw new RecordingAccessError('Recording unavailable', 403);
    if (error?.code === '22023') throw new RecordingAccessError('Stop recording before requesting deletion', 400);
    if (error) throw error;
    return NextResponse.json(checkedDeletionReceipt({ ...data, hidden: true, fullyDeleted: false }, id, input.data.requestId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}
