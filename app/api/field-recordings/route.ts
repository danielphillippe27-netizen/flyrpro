import { NextRequest, NextResponse } from 'next/server';
import { createRecordingSchema } from '@/lib/field-recordings/contracts';
import { recordingAccess, recordingError, RecordingAccessError } from '@/lib/field-recordings/access';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const { db, user, workspaceId } = await recordingAccess(request, request.nextUrl.searchParams.get('workspaceId') || undefined);
    const { data, error } = await db.from('field_recordings').select('*').eq('workspace_id', workspaceId).eq('user_id', user.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return NextResponse.json({ recordings: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}

export async function POST(request: NextRequest) {
  try {
    const input = createRecordingSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'Invalid recording request' }, { status: 400 });
    const { db, user, workspaceId } = await recordingAccess(request, input.data.workspaceId);
    const { data: session, error: sessionError } = await db.from('sessions').select('id,user_id,workspace_id').eq('id', input.data.sessionId).eq('user_id', user.id).eq('workspace_id', workspaceId).maybeSingle();
    if (sessionError) throw sessionError;
    if (!session) throw new RecordingAccessError('Sync your own session before registering its recording', 409);
    const { data: existing, error: readError } = await db.from('field_recordings').select('*').eq('id', input.data.id).maybeSingle();
    if (readError) throw readError;
    if (existing) {
      if (existing.user_id !== user.id || existing.workspace_id !== workspaceId || existing.session_id !== input.data.sessionId || existing.device_serial !== input.data.deviceSerial || existing.deleted_at) throw new RecordingAccessError('Recording identity unavailable', 409);
      return NextResponse.json({ recording: existing });
    }
    const { data, error } = await db.from('field_recordings').insert({ id: input.data.id, session_id: session.id, user_id: user.id, workspace_id: workspaceId, device_serial: input.data.deviceSerial, started_at: input.data.startedAt, timezone: input.data.timezone }).select('*').single();
    if (error) throw error;
    return NextResponse.json({ recording: data }, { status: 201 });
  } catch (error) { return recordingError(error); }
}
