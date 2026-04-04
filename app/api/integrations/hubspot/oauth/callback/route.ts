import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  buildHubSpotIosResultUrl,
  exchangeHubSpotOAuthCode,
  getHubSpotOAuthRedirectUri,
  getHubSpotWebErrorUrl,
  getHubSpotWebSuccessUrl,
  introspectHubSpotAccessToken,
  verifyHubSpotOAuthState,
} from '../../_lib/oauth';

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
    return NextResponse.redirect(buildHubSpotIosResultUrl('error', message));
  }
  return NextResponse.redirect(withMessage(getHubSpotWebErrorUrl(origin), message));
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = url.origin;
  const errorParam = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const rawState = url.searchParams.get('state') || '';

  const state = verifyHubSpotOAuthState(rawState);
  const platform: 'ios' | 'web' = state?.platform === 'ios' ? 'ios' : 'web';

  if (!state?.userId || !state.workspaceId) {
    return redirectForError(origin, platform, 'Invalid or expired OAuth state.');
  }
  if (errorParam) {
    const desc = url.searchParams.get('error_description') || errorParam;
    return redirectForError(origin, platform, desc);
  }
  if (!code) {
    return redirectForError(origin, platform, 'Missing authorization code.');
  }

  try {
    const redirectUri = getHubSpotOAuthRedirectUri(origin);
    const tokenData = await exchangeHubSpotOAuthCode(code, redirectUri);
    const metadata = await introspectHubSpotAccessToken(tokenData.accessToken);
    const supabase = createAdminClient();

    const { error: upsertIntegrationError } = await supabase
      .from('user_integrations')
      .upsert(
        {
          user_id: state.userId,
          provider: 'hubspot',
          access_token: tokenData.accessToken,
          refresh_token: tokenData.refreshToken ?? null,
          expires_at: tokenData.expiresAt ?? null,
          api_key: null,
          account_id: metadata.hubId ?? null,
          account_name: metadata.hubDomain ?? metadata.userEmail ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' }
      );

    if (upsertIntegrationError) {
      console.error('[hubspot/oauth/callback] upsert integration', upsertIntegrationError);
      return redirectForError(origin, platform, 'Failed to save OAuth tokens.');
    }

    const { data: existingConnection, error: fetchConnectionError } = await supabase
      .from('crm_connections')
      .select('id')
      .eq('workspace_id', state.workspaceId)
      .eq('provider', 'hubspot')
      .maybeSingle();

    if (fetchConnectionError) {
      console.error('[hubspot/oauth/callback] fetch connection', fetchConnectionError);
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
        console.error('[hubspot/oauth/callback] update connection', updateError);
        return redirectForError(origin, platform, 'Failed to update CRM connection.');
      }
    } else {
      const { error: insertError } = await supabase.from('crm_connections').insert({
        user_id: state.userId,
        workspace_id: state.workspaceId,
        provider: 'hubspot',
        status: 'connected',
        api_key_encrypted: '',
        last_error: null,
        last_tested_at: new Date().toISOString(),
      });

      if (insertError) {
        console.error('[hubspot/oauth/callback] insert connection', insertError);
        return redirectForError(origin, platform, 'Failed to create CRM connection.');
      }
    }

    if (platform === 'ios') {
      return NextResponse.redirect(buildHubSpotIosResultUrl('success'));
    }
    return NextResponse.redirect(getHubSpotWebSuccessUrl(origin));
  } catch (err) {
    console.error('[hubspot/oauth/callback]', err);
    const message = err instanceof Error ? err.message : 'OAuth callback failed.';
    return redirectForError(origin, platform, message);
  }
}
