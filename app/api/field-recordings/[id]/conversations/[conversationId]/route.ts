import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ownedRecording, recordingError } from '@/lib/field-recordings/access';
import { conversationReviewSchema } from '@/lib/field-recordings/review';
import { transcriptSegmentSchema } from '@/lib/field-recordings/contracts';
import { validateWriting } from '@/lib/field-recordings/writing';

export const runtime = 'nodejs';
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; conversationId: string }> }) {
  try {
    const { id, conversationId } = await context.params;
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(conversationId).success) return NextResponse.json({ error: 'Invalid conversation ID' }, { status: 400 });
    const parsed = conversationReviewSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid review request' }, { status: 400 });
    const { db, user } = await ownedRecording(request, id);
    if (parsed.data.operation === 'confirm_assignment') {
      const { data, error } = await db.rpc('assign_field_conversation', {
        p_recording: id, p_conversation: conversationId, p_user: user.id, p_version: parsed.data.version,
        p_target: parsed.data.targetId, p_consent: parsed.data.consent, p_permission_confirmed: parsed.data.permissionConfirmed,
      });
      if (error?.code === '40001') return NextResponse.json({ error: 'Conversation changed. Refresh before saving.' }, { status: 409 });
      if (error?.code === '22023') return NextResponse.json({ error: 'Choose a target from this session and explicitly confirm recording permission.' }, { status: 400 });
      if (error?.code === '42501') return NextResponse.json({ error: 'Recording unavailable' }, { status: 403 });
      if (error) throw error;
      return NextResponse.json({ conversation: data }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const { data: conversation, error: readError } = await db.from('field_conversations').select('segments').eq('id', conversationId).eq('recording_id', id).maybeSingle();
    if (readError) throw readError;
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    if (parsed.data.writing) {
      try { validateWriting(parsed.data.writing, z.array(transcriptSegmentSchema).parse(conversation.segments)); }
      catch { return NextResponse.json({ error: 'Draft evidence must cite the conversation transcript' }, { status: 400 }); }
    }
    const { data, error } = await db.rpc('review_field_conversation_draft', {
      p_recording: id, p_conversation: conversationId, p_user: user.id,
      p_version: parsed.data.version, p_operation: parsed.data.operation, p_writing: parsed.data.writing ?? null,
    });
    if (error?.code === '40001') return NextResponse.json({ error: 'Conversation changed. Refresh before saving.' }, { status: 409 });
    if (error?.code === '42501') return NextResponse.json({ error: 'Recording unavailable' }, { status: 403 });
    if (error) throw error;
    return NextResponse.json({ conversation: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}
