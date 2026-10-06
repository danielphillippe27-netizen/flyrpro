import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ownedRecording, recordingError } from '@/lib/field-recordings/access';
import { applicationSchema } from '@/lib/field-recordings/review';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string; conversationId: string }> }) {
  try {
    const { id, conversationId } = await context.params;
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(conversationId).success) return NextResponse.json({ error: 'Invalid conversation ID' }, { status: 400 });
    const parsed = applicationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Select a linked contact, household and dated actions before applying.' }, { status: 400 });
    const { db, user } = await ownedRecording(request, id);
    const { data, error } = await db.rpc('apply_field_conversation', { p_recording: id, p_conversation: conversationId, p_user: user.id, p_payload: parsed.data });
    if (error?.code === '40001') return NextResponse.json({ error: 'Conversation changed or was already applied. Refresh before updating.' }, { status: 409 });
    if (error?.code === '42501') return NextResponse.json({ error: 'Recording or contact unavailable' }, { status: 403 });
    if (error?.code === '22023') return NextResponse.json({ error: error.message }, { status: 400 });
    if (error) throw error;
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; conversationId: string }> }) {
  try {
    const { id, conversationId } = await context.params;
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(conversationId).success) return NextResponse.json({ error: 'Invalid conversation ID' }, { status: 400 });
    const { db, user } = await ownedRecording(request, id);
    const { data, error } = await db.rpc('field_conversation_application_options', { p_recording: id, p_conversation: conversationId, p_user: user.id });
    if (error?.code === '42501') return NextResponse.json({ error: 'Recording unavailable' }, { status: 403 });
    if (error?.code === '22023') return NextResponse.json({ error: 'Confirm door assignment and recording permission first.' }, { status: 400 });
    if (error) throw error;
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}
