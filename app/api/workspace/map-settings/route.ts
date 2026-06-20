import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceMembershipForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';

type MapSettingsPayload = {
  workspaceId?: string;
  movieMapControlsEnabled?: unknown;
};

function isMissingMovieControlsColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: string; message?: string };
  return (
    maybeError.code === '42703' ||
    maybeError.code === 'PGRST204' ||
    maybeError.message?.includes('movie_map_controls_enabled') === true
  );
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId');
  if (!requestedWorkspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    requestedWorkspaceId
  );

  if (!membership.workspaceId) {
    return NextResponse.json(
      { error: membership.error ?? 'Workspace not found' },
      { status: membership.status ?? 400 }
    );
  }

  const { data, error } = await admin
    .from('workspaces')
    .select('movie_map_controls_enabled')
    .eq('id', membership.workspaceId)
    .maybeSingle();

  if (error) {
    if (isMissingMovieControlsColumnError(error)) {
      return NextResponse.json({ movieMapControlsEnabled: false });
    }
    return NextResponse.json({ error: 'Could not load map settings' }, { status: 500 });
  }

  return NextResponse.json({
    movieMapControlsEnabled: data?.movie_map_controls_enabled === true,
  });
}

export async function PATCH(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as MapSettingsPayload | null;
  if (!payload?.workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
  }
  if (typeof payload.movieMapControlsEnabled !== 'boolean') {
    return NextResponse.json(
      { error: 'movieMapControlsEnabled must be a boolean' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    payload.workspaceId
  );

  if (!membership.workspaceId) {
    return NextResponse.json(
      { error: membership.error ?? 'Workspace not found' },
      { status: membership.status ?? 400 }
    );
  }
  if (membership.role !== 'owner' && membership.role !== 'admin') {
    return NextResponse.json(
      { error: 'Only workspace owners and admins can update map settings' },
      { status: 403 }
    );
  }

  const { error } = await admin
    .from('workspaces')
    .update({
      movie_map_controls_enabled: payload.movieMapControlsEnabled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', membership.workspaceId);

  if (error) {
    const message = isMissingMovieControlsColumnError(error)
      ? 'Map settings migration has not been applied yet'
      : 'Could not save map settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({
    movieMapControlsEnabled: payload.movieMapControlsEnabled,
  });
}
