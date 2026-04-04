import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchMondayAccount } from '@/app/api/integrations/monday/_lib/client';
import {
  buildMondayIosResultUrl,
  exchangeMondayOAuthCode,
  getMondayOAuthRedirectUri,
  getMondayWebErrorUrl,
  getMondayWebSuccessUrl,
  verifyMondayOAuthState,
} from '@/app/api/integrations/monday/_lib/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectForError(origin: string | undefined, platform: 'ios' | 'web', message: string) {
  if (platform === 'ios') {
    return NextResponse.redirect(buildMondayIosResultUrl('error', message));
  }
  const url = new URL(getMondayWebErrorUrl(origin));
  url.searchParams.set('message', message);
  return NextResponse.redirect(url);
}

function redirectForSuccess(origin: string | undefined, platform: 'ios' | 'web', message?: string) {
  if (platform === 'ios') {
    return NextResponse.redirect(buildMondayIosResultUrl('success', message));
  }
  const url = new URL(getMondayWebSuccessUrl(origin));
  if (message) url.searchParams.set('message', message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get('origin') ?? request.nextUrl.origin;
  try {
    const code = request.nextUrl.searchParams.get('code');
    const state = request.nextUrl.searchParams.get('state');
    const error = request.nextUrl.searchParams.get('error');

    const statePayload = state ? verifyMondayOAuthState(state) : null;
    const platform = statePayload?.platform ?? 'web';
    if (!statePayload) {
      return redirectForError(origin, platform, 'Invalid or expired monday OAuth state.');
    }
    if (error) {
      return redirectForError(origin, platform, 'Monday authorization was denied.');
    }
    if (!code) {
      return redirectForError(origin, platform, 'Missing monday authorization code.');
    }

    const redirectUri = getMondayOAuthRedirectUri(origin);
    const { accessToken } = await exchangeMondayOAuthCode(code, redirectUri);
    let account: { accountId?: string; accountName?: string } = {};
    try {
      account = await fetchMondayAccount(accessToken);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('UNAUTHORIZED_FIELD_OR_TYPE')) {
        throw error;
      }
      console.warn('[monday/oauth/callback] account metadata unavailable for token', {
        userId: statePayload.userId,
        message,
      });
    }
    const supabase = createAdminClient();

    const { error: upsertError } = await supabase
      .from('user_integrations')
      .upsert(
        {
          user_id: statePayload.userId,
          provider: 'monday',
          access_token: accessToken,
          account_id: account.accountId ?? null,
          account_name: account.accountName ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' }
      );

    if (upsertError) {
      console.error('[monday/oauth/callback] upsert integration', upsertError);
      return redirectForError(origin, platform, 'Failed to save monday integration.');
    }

    console.log('[monday/oauth/callback] monday connected', {
      userId: statePayload.userId,
      accountId: account.accountId ?? null,
      accountName: account.accountName ?? null,
      hasWorkspaceId: !!statePayload.workspaceId,
    });

    return redirectForSuccess(origin, platform, 'Monday connected. Select a board to finish setup.');
  } catch (err) {
    console.error('[monday/oauth/callback]', err);
    return redirectForError(origin, 'web', err instanceof Error ? err.message : 'Monday OAuth failed.');
  }
}
