import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  buildIosResultUrl,
  exchangeOAuthCode,
  getFubOAuthRedirectUri,
  getWebErrorUrl,
  getWebSuccessUrl,
  verifyOAuthState,
} from '../../_lib/oauth';
import { FUB_CONNECTION_PROVIDER, FUB_CONNECTION_PROVIDERS } from '../../_lib/provider';

function withMessage(url: string, message: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('message', message);
    return parsed.toString();
  } catch {
    const suffix = url.includes('?') ? '&' : '?';
    return `${url}${suffix}message=${encodeURIComponent(message)}`;
  }
}

function redirectForError(origin: string, platform: 'ios' | 'web', message: string) {
  if (platform === 'ios') {
    return NextResponse.redirect(buildIosResultUrl('error', message));
  }
  return NextResponse.redirect(withMessage(getWebErrorUrl(origin), message));
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = url.origin;
  const errorParam = url.searchParams.get('error');
  const responseParam = url.searchParams.get('response');
  const code = url.searchParams.get('code');
  const rawState = url.searchParams.get('state') || '';

  const state = verifyOAuthState(rawState);
  const platform: 'ios' | 'web' = state?.platform === 'ios' ? 'ios' : 'web';

  if (!state?.userId || !state.workspaceId) {
    return redirectForError(origin, platform, 'Invalid or expired OAuth state.');
  }
  if (errorParam) {
    const desc = url.searchParams.get('error_description') || errorParam;
    return redirectForError(origin, platform, desc);
  }
  if (responseParam === 'denied') {
    return redirectForError(origin, platform, 'Follow Up Boss authorization was denied.');
  }
  if (!code) {
    return redirectForError(origin, platform, 'Missing authorization code.');
  }

  try {
    const redirectUri = getFubOAuthRedirectUri(origin);
    const tokenData = await exchangeOAuthCode(code, redirectUri, rawState);
    const supabase = createAdminClient();

    // OAuth credentials for FUB are user-scoped.
    const { error: upsertIntegrationError } = await supabase
      .from('user_integrations')
      .upsert(
        {
          user_id: state.userId,
          provider: 'fub',
          access_token: tokenData.accessToken,
          refresh_token: tokenData.refreshToken ?? null,
          expires_at: tokenData.expiresAt ?? null,
          api_key: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' }
      );

    if (upsertIntegrationError) {
      console.error('[followupboss/oauth/callback] upsert integration', upsertIntegrationError);
      return redirectForError(origin, platform, 'Failed to save OAuth tokens.');
    }

    const { data: existingConnection, error: fetchConnectionError } = await supabase
      .from('crm_connections')
      .select('id')
      .eq('workspace_id', state.workspaceId)
      .in('provider', [...FUB_CONNECTION_PROVIDERS])
      .maybeSingle();

    if (fetchConnectionError) {
      console.error('[followupboss/oauth/callback] fetch connection', fetchConnectionError);
      return redirectForError(origin, platform, 'Failed to load CRM connection.');
    }

    if (existingConnection?.id) {
      const { error: updateError } = await supabase
        .from('crm_connections')
        .update({
          status: 'connected',
          api_key_encrypted: '',
          last_error: null,
          last_tested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingConnection.id);

      if (updateError) {
        console.error('[followupboss/oauth/callback] update connection', updateError);
        return redirectForError(origin, platform, 'Failed to update CRM connection.');
      }
    } else {
      const { error: insertError } = await supabase.from('crm_connections').insert({
        user_id: state.userId,
        workspace_id: state.workspaceId,
        provider: FUB_CONNECTION_PROVIDER,
        status: 'connected',
        api_key_encrypted: '',
        last_error: null,
        last_tested_at: new Date().toISOString(),
      });

      if (insertError) {
        console.error('[followupboss/oauth/callback] insert connection', insertError);
        return redirectForError(origin, platform, 'Failed to create CRM connection.');
      }
    }

    if (platform === 'ios') {
      return NextResponse.redirect(buildIosResultUrl('success'));
    }
    return NextResponse.redirect(getWebSuccessUrl(origin));
  } catch (err) {
    console.error('[followupboss/oauth/callback]', err);
    const message = err instanceof Error ? err.message : 'OAuth callback failed.';
    return redirectForError(origin, platform, message);
  }
}
