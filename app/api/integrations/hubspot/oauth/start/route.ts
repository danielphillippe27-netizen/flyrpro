import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import {
  buildHubSpotAuthorizeUrl,
  createHubSpotOAuthState,
  getHubSpotOAuthRedirectUri,
  type HubSpotOAuthPlatform,
} from '../../_lib/oauth';

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request, {
      allowQueryToken: true,
      queryTokenParamNames: ['token', 'access_token'],
    });
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawPlatform = (request.nextUrl.searchParams.get('platform') || 'web').toLowerCase();
    const platform: HubSpotOAuthPlatform = rawPlatform === 'ios' ? 'ios' : 'web';
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

    const redirectUri = getHubSpotOAuthRedirectUri(request.nextUrl.origin);
    const state = createHubSpotOAuthState(requestUser.id, workspaceResolution.workspaceId, platform);
    const authorizeUrl = buildHubSpotAuthorizeUrl(state, redirectUri);

    return NextResponse.json({
      success: true,
      authorizeUrl,
      platform,
    });
  } catch (err) {
    console.error('[hubspot/oauth/start]', err);
    return NextResponse.json({ error: 'Unable to start OAuth flow.' }, { status: 500 });
  }
}
