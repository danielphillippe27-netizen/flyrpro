import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import {
  buildContractorAuthorizeUrl,
  createContractorOAuthState,
  getContractorOAuthRedirectUri,
  getContractorProvider,
  providerSupportsOAuth,
} from '@/app/api/integrations/_lib/contractor-providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: rawProvider } = await params;
  const provider = getContractorProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: 'Unsupported integration provider' }, { status: 404 });
  }
  if (!providerSupportsOAuth(provider.id)) {
    return NextResponse.json({ error: `${provider.displayName} does not support OAuth.` }, { status: 400 });
  }

  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const workspaceResolution = await resolveWorkspaceIdForUser(
    supabase as unknown as MinimalSupabaseClient,
    requestUser.id,
    request.nextUrl.searchParams.get('workspaceId')
  );
  if (!workspaceResolution.workspaceId) {
    return NextResponse.json(
      { error: workspaceResolution.error ?? 'Workspace not found' },
      { status: workspaceResolution.status ?? 400 }
    );
  }

  try {
    const platform = request.nextUrl.searchParams.get('platform') === 'ios' ? 'ios' : 'web';
    const origin = request.headers.get('origin') ?? undefined;
    const redirectUri = getContractorOAuthRedirectUri(provider.id, origin);
    const state = createContractorOAuthState(
      provider.id,
      requestUser.id,
      workspaceResolution.workspaceId,
      platform
    );
    return NextResponse.json({
      authorizeUrl: buildContractorAuthorizeUrl(provider.id, state, redirectUri),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start OAuth flow' },
      { status: 500 }
    );
  }
}
