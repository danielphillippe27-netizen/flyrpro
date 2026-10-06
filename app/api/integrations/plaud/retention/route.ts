import { NextRequest, NextResponse } from 'next/server';
import { recordingAccess, recordingError, RecordingAccessError } from '@/lib/field-recordings/access';
import { checkedRetention, retentionEnabled } from '@/lib/field-recordings/retention';

export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const { db, user, workspaceId } = await recordingAccess(request, request.nextUrl.searchParams.get('workspaceId') || undefined);
    const { data, error } = await db.from('field_recording_retention_policies').select('retention_days,version').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
    if (error) throw new Error('Retention unavailable');
    const settings = checkedRetention(data ? { retentionDays: data.retention_days, version: data.version } : { retentionDays: null, version: 0 });
    return NextResponse.json(settings, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}
export async function PUT(request: NextRequest) {
  try {
    const { db, user, workspaceId } = await recordingAccess(request, request.nextUrl.searchParams.get('workspaceId') || undefined);
    let settings;
    try { settings = checkedRetention(await request.json()); }
    catch { throw new RecordingAccessError('Invalid retention settings', 400); }
    if (settings.retentionDays !== null && !retentionEnabled(process.env.FIELD_RECORDING_RETENTION_ENABLED, process.env.FIELD_RECORDING_DELETION_ENABLED)) throw new RecordingAccessError('Automatic retention is not enabled yet', 409);
    const { data, error } = await db.rpc('set_field_recording_retention', { p_workspace: workspaceId, p_user: user.id, p_days: settings.retentionDays, p_version: settings.version });
    if (error?.code === '40001') throw new RecordingAccessError('Retention settings changed. Refresh and try again.', 409);
    if (error) throw new Error('Retention update unavailable');
    return NextResponse.json(checkedRetention(data), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}
