import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  type ContractorProviderId,
  exchangeContractorOAuthCode,
  getContractorDisplayName,
  getContractorOAuthRedirectUri,
  getContractorProvider,
  getContractorWebResultUrl,
  testContractorConnection,
  verifyContractorOAuthState,
} from '@/app/api/integrations/_lib/contractor-providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: rawProvider } = await params;
  const provider = getContractorProvider(rawProvider);
  const origin = request.headers.get('origin') ?? undefined;
  if (!provider) {
    return NextResponse.redirect(new URL('/settings/integrations?integration=error', request.url));
  }

  const code = request.nextUrl.searchParams.get('code') ?? '';
  const state = request.nextUrl.searchParams.get('state') ?? '';
  const error = request.nextUrl.searchParams.get('error') ?? '';
  const errorDescription = request.nextUrl.searchParams.get('error_description') ?? '';

  if (error) {
    return redirectForError(provider.id, origin, errorDescription || error);
  }
  if (!code || !state) {
    return redirectForError(provider.id, origin, 'Missing OAuth code or state.');
  }

  const verifiedState = verifyContractorOAuthState(state);
  if (!verifiedState || verifiedState.provider !== provider.id) {
    return redirectForError(provider.id, origin, 'OAuth state could not be verified.');
  }

  const supabase = createAdminClient();
  try {
    const redirectUri = getContractorOAuthRedirectUri(provider.id, origin);
    const exchanged = await exchangeContractorOAuthCode(provider.id, code, redirectUri);
    await testContractorConnection(provider.id, {
      mode: 'oauth',
      token: exchanged.accessToken,
    });

    const now = new Date().toISOString();
    await supabase.from('user_integrations').upsert(
      {
        user_id: verifiedState.userId,
        provider: provider.id,
        access_token: exchanged.accessToken,
        refresh_token: exchanged.refreshToken ?? null,
        expires_at: exchanged.expiresAt ?? null,
        provider_config: {
          oauthRaw: exchanged.raw,
        },
        updated_at: now,
      },
      { onConflict: 'user_id,provider' }
    );

    const { data: existing } = await supabase
      .from('crm_connections')
      .select('id')
      .eq('workspace_id', verifiedState.workspaceId)
      .eq('provider', provider.id)
      .maybeSingle();

    const payload = {
      user_id: verifiedState.userId,
      workspace_id: verifiedState.workspaceId,
      provider: provider.id,
      api_key_encrypted: null,
      status: 'connected',
      last_tested_at: now,
      last_error: null,
      updated_at: now,
      metadata: {
        authMode: 'oauth',
      },
    };

    const { error: connectionError } = existing?.id
      ? await supabase.from('crm_connections').update(payload).eq('id', existing.id)
      : await supabase.from('crm_connections').insert(payload);

    if (connectionError) {
      throw connectionError;
    }

    return NextResponse.redirect(getContractorWebResultUrl('connected', provider.id, origin));
  } catch (err) {
    return redirectForError(
      provider.id,
      origin,
      err instanceof Error ? err.message : `${getContractorDisplayName(provider.id)} OAuth failed.`
    );
  }
}

function redirectForError(provider: ContractorProviderId, origin: string | undefined, message: string) {
  const url = new URL(getContractorWebResultUrl('error', provider, origin));
  url.searchParams.set('message', message);
  return NextResponse.redirect(url);
}
