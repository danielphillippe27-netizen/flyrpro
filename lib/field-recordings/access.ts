import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';

export class RecordingAccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function recordingAccess(request: NextRequest, workspaceId?: string) {
  const user = await resolveUserFromRequest(request);
  if (!user) throw new RecordingAccessError('Sign in to access recordings', 401);
  const db = createAdminClient();
  const membership = await resolveWorkspaceIdForUser(db as unknown as MinimalSupabaseClient, user.id, workspaceId);
  if (!membership.workspaceId) throw new RecordingAccessError('Workspace access required', 403);
  return { user, db, workspaceId: membership.workspaceId };
}

export async function ownedRecording(request: NextRequest, id: string, options: { includeDeleted?: boolean } = {}) {
  const user = await resolveUserFromRequest(request);
  if (!user) throw new RecordingAccessError('Sign in to access recordings', 401);
  const db = createAdminClient();
  let query = db.from('field_recordings').select('*').eq('id', id).eq('user_id', user.id);
  if (!options.includeDeleted) query = query.is('deleted_at', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new RecordingAccessError('Recording storage unavailable', 503);
  if (!data) throw new RecordingAccessError('Recording not found', 404);
  const membership = await resolveWorkspaceIdForUser(db as unknown as MinimalSupabaseClient, user.id, data.workspace_id);
  if (!membership.workspaceId || membership.workspaceId !== data.workspace_id) throw new RecordingAccessError('Workspace access required', 403);
  return { user, db, recording: data };
}

export function recordingError(error: unknown) {
  if (error instanceof RecordingAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
  // Unknown errors may contain tokens, URLs, or transcripts. Do not expose or log them.
  return NextResponse.json({ error: 'Recording operation unavailable. Try again.' }, { status: 503 });
}
