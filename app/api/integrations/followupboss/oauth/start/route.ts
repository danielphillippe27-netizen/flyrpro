import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import {
  buildAuthorizeUrl,
  createOAuthState,
  getFubOAuthRedirectUri,
  type OAuthPlatform,
} from '../../_lib/oauth';

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawPlatform = (request.nextUrl.searchParams.get('platform') || 'web').toLowerCase();
    const platform: OAuthPlatform = rawPlatform === 'ios' ? 'ios' : 'web';
    const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId');

    const supabase = createAdminClient();
    const workspaceResolution = await resolveWorkspaceIdForUser(
      supabase as unknown as MinimalSupabaseClient,
      requestUser.id,
      requestedWorkspaceId
    );
    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }

    const redirectUri = getFubOAuthRedirectUri(request.nextUrl.origin);
    const state = createOAuthState(requestUser.id, workspaceResolution.workspaceId, platform);
    const authorizeUrl = buildAuthorizeUrl(state, redirectUri);

    return NextResponse.json({
      success: true,
      authorizeUrl,
      platform,
    });
  } catch (err) {
    console.error('[followupboss/oauth/start]', err);
    return NextResponse.json({ error: 'Unable to start OAuth flow.' }, { status: 500 });
  }
}
