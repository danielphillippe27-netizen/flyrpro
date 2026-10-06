import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ownedRecording, recordingError, RecordingAccessError } from '@/lib/field-recordings/access';

export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) throw new RecordingAccessError('Invalid recording ID', 400);
    const input = z.object({ chunkId: z.uuid() }).strict().safeParse(await request.json().catch(() => null));
    if (!input.success) throw new RecordingAccessError('Invalid chunk ID', 400);
    const { db, user } = await ownedRecording(request, id);
    const { data, error } = await db.rpc('enqueue_field_recording_chunk', { p_recording: id, p_user: user.id, p_chunk: input.data.chunkId });
    if (error) throw error;
    return NextResponse.json({ job: data }, { status: 202 });
  } catch (error) { return recordingError(error); }
}
