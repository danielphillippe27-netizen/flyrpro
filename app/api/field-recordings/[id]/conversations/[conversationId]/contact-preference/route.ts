import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { preferenceSchema } from '@/lib/field-recordings/contact-preference';
import { ownedRecording, recordingError } from '@/lib/field-recordings/access';
export const runtime = 'nodejs';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string; conversationId: string }> }) {
  try {
    const { id, conversationId } = await context.params;
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(conversationId).success) return NextResponse.json({ error: 'Invalid conversation ID' }, { status: 400 });
    const workspaceId = request.nextUrl.searchParams.get('workspaceId');
    if (!z.uuid().safeParse(workspaceId).success) return NextResponse.json({ error: 'Select a workspace' }, { status: 400 });
    const parsed = preferenceSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'Explicitly confirm a linked contact and evidence-backed preference.' }, { status: 400 });
    const { db, user, recording } = await ownedRecording(request, id);
    if (recording.workspace_id !== workspaceId) return NextResponse.json({ error: 'Recording workspace unavailable' }, { status: 403 });
    const { data, error } = await db.rpc('review_field_contact_preference', { p_recording: id, p_conversation: conversationId, p_user: user.id, p_payload: parsed.data });
    if (error?.code === '40001') return NextResponse.json({ error: 'Conversation or preference changed. Refresh before updating.' }, { status: 409 });
    if (error?.code === '42501') return NextResponse.json({ error: 'Recording or contact unavailable' }, { status: 403 });
    if (error?.code === '22023') return NextResponse.json({ error: 'Verify the transcript, assignment, permission and selected contact preference.' }, { status: 400 });
    if (error) throw new Error('Preference review unavailable');
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string; conversationId: string }> }) {
  try {
    const { id, conversationId } = await context.params;
    const requestId = request.nextUrl.searchParams.get('requestId');
    const workspaceId = request.nextUrl.searchParams.get('workspaceId');
    if (![id, conversationId, requestId, workspaceId].every(value => z.uuid().safeParse(value).success)) return NextResponse.json({ error: 'Invalid preference identity' }, { status: 400 });
    const { db, user, recording } = await ownedRecording(request, id, { includeDeleted: true });
    if (recording.workspace_id !== workspaceId) return NextResponse.json({ error: 'Recording workspace unavailable' }, { status: 403 });
    const { data: conversation, error: conversationError } = await db.from('field_conversations').select('id').eq('id', conversationId).eq('recording_id', id).maybeSingle();
    if (conversationError) throw new Error('Preference source unavailable');
    if (!conversation) return NextResponse.json({ error: 'Preference source unavailable' }, { status: 404 });
    const { data, error } = await db.from('field_conversation_contact_preferences').select('result').eq('conversation_id', conversationId).eq('request_id', requestId!).eq('user_id', user.id).eq('workspace_id', recording.workspace_id).maybeSingle();
    if (error) throw new Error('Preference receipt unavailable');
    if (!data) return NextResponse.json({ error: 'Preference not yet confirmed' }, { status: 404 });
    return NextResponse.json(data.result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}
