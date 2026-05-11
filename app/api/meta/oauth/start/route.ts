import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import {
  buildMetaAuthorizeUrl,
  createMetaOAuthState,
  getMetaRedirectUri,
} from '../../_lib/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const farmId = request.nextUrl.searchParams.get('farmId');
    const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId');
    const admin = createAdminClient();
    let teamId: string | null = null;

    if (farmId) {
      const { data: farm } = await admin
        .from('farms')
        .select('id, owner_id, workspace_id')
        .eq('id', farmId)
        .maybeSingle();
      if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });

      const isOwner = farm.owner_id === user.id;
      let isMember = false;
      if (farm.workspace_id) {
        const { data: membership } = await admin
          .from('workspace_members')
          .select('workspace_id')
          .eq('workspace_id', farm.workspace_id)
          .eq('user_id', user.id)
          .maybeSingle();
        isMember = Boolean(membership?.workspace_id);
      }
      if (!isOwner && !isMember) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      teamId = farm.workspace_id ?? null;
    } else {
      const workspaceResolution = await resolveWorkspaceIdForUser(
        admin as unknown as MinimalSupabaseClient,
        user.id,
        requestedWorkspaceId
      );
      teamId = workspaceResolution.workspaceId;
    }

    const redirectUri = getMetaRedirectUri(request.nextUrl.origin);
    const state = createMetaOAuthState(user.id, teamId, farmId);
    return NextResponse.redirect(buildMetaAuthorizeUrl(state, redirectUri));
  } catch (error) {
    console.error('[meta/oauth/start]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to start Meta OAuth.' },
      { status: 500 }
    );
  }
}
