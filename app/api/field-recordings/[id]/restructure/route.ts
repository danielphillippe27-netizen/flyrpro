import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ownedRecording, recordingError } from '@/lib/field-recordings/access';
import { restructureRequestSchema } from '@/lib/field-recordings/restructure';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid recording ID' }, { status: 400 });
    const envelope = z.object({ requestId: z.uuid(), change: restructureRequestSchema }).strict().safeParse(await request.json().catch(() => null));
    if (!envelope.success) return NextResponse.json({ error: 'Invalid conversation restructuring request' }, { status: 400 });
    const { db, user } = await ownedRecording(request, id);
    const input = envelope.data.change;
    const { data, error } = input.operation === 'split' ? await db.rpc('split_field_conversation', {
      p_recording: id, p_user: user.id, p_request: envelope.data.requestId,
      p_conversation: input.conversationId, p_version: input.version, p_before_segment: input.beforeSegmentId,
    }) : await db.rpc('merge_field_conversations', { p_recording: id, p_user: user.id, p_request: envelope.data.requestId, p_sources: input.conversations });
    if (error?.code === '40001') return NextResponse.json({ error: 'Conversation or request changed. Refresh before restructuring.' }, { status: 409 });
    if (error?.code === '42501') return NextResponse.json({ error: 'Recording unavailable' }, { status: 403 });
    if (error?.code === 'P0002') return NextResponse.json({ error: 'Conversation unavailable' }, { status: 404 });
    if (error?.code === '22023') return NextResponse.json({ error: error.message }, { status: 400 });
    if (error) throw error;
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}
