import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  buildMondayAuthorizeUrl,
  createMondayOAuthState,
  getMondayOAuthRedirectUri,
} from '@/app/api/integrations/monday/_lib/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request, { allowQueryToken: true });
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const platform = request.nextUrl.searchParams.get('platform') === 'ios' ? 'ios' : 'web';
    const workspaceId = request.nextUrl.searchParams.get('workspaceId') ?? undefined;
    const origin = request.headers.get('origin') ?? undefined;
    const redirectUri = getMondayOAuthRedirectUri(origin);
    const state = createMondayOAuthState(requestUser.id, platform, workspaceId);
    const authorizeUrl = buildMondayAuthorizeUrl(state, redirectUri);

    console.log('[monday/oauth/start] generated authorize url', {
      userId: requestUser.id,
      platform,
      hasWorkspaceId: !!workspaceId,
    });

    return NextResponse.json({ authorizeUrl, redirectUri });
  } catch (error) {
    console.error('[monday/oauth/start]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start monday OAuth' },
      { status: 500 }
    );
  }
}
