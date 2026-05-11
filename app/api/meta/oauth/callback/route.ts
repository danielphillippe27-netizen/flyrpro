import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  debugMetaToken,
  encryptMetaAccessToken,
  exchangeForLongLivedMetaToken,
  exchangeMetaOAuthCode,
  fetchMetaUserId,
  getMetaRedirectUri,
  verifyMetaOAuthState,
} from '../../_lib/oauth';
import { listMetaAdAccounts, normalizeMetaAdAccountId } from '../../_lib/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function farmRedirect(origin: string, farmId: string | null, status: 'connected' | 'error', message?: string) {
  const url = new URL(farmId ? `/farms/${farmId}` : '/farms', origin);
  url.searchParams.set('tab', 'social-ads');
  url.searchParams.set('meta', status);
  if (message) url.searchParams.set('message', message);
  return url;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = url.origin;
  const errorParam = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = verifyMetaOAuthState(url.searchParams.get('state') || '');

  if (!state) {
    return NextResponse.redirect(farmRedirect(origin, null, 'error', 'Invalid or expired OAuth state.'));
  }
  if (errorParam) {
    return NextResponse.redirect(
      farmRedirect(origin, state.farmId, 'error', url.searchParams.get('error_description') || errorParam)
    );
  }
  if (!code) {
    return NextResponse.redirect(farmRedirect(origin, state.farmId, 'error', 'Missing authorization code.'));
  }

  try {
    const redirectUri = getMetaRedirectUri(origin);
    const shortLived = await exchangeMetaOAuthCode(code, redirectUri);
    const longLived = await exchangeForLongLivedMetaToken(shortLived.accessToken).catch(() => shortLived);
    const tokenDebug = await debugMetaToken(longLived.accessToken).catch(() => ({
      scopes: null,
      expiresAt: longLived.expiresAt,
    }));
    const metaUserId = await fetchMetaUserId(longLived.accessToken);
    const expiresAt = tokenDebug.expiresAt ?? longLived.expiresAt;
    const expiresAtIso = expiresAt ? new Date(expiresAt * 1000).toISOString() : null;

    const admin = createAdminClient();
    const payload = {
      user_id: state.userId,
      team_id: state.teamId,
      meta_user_id: metaUserId,
      access_token_encrypted: encryptMetaAccessToken(longLived.accessToken),
      token_expires_at: expiresAtIso,
      scopes: tokenDebug.scopes ?? ['ads_read'],
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: existing, error: existingError } = await admin
      .from('meta_connections')
      .select('id')
      .eq('user_id', state.userId)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    let connectionId = existing?.id as string | undefined;
    if (connectionId) {
      const { error: updateError } = await admin
        .from('meta_connections')
        .update(payload)
        .eq('id', connectionId);
      if (updateError) throw new Error(updateError.message);
    } else {
      const { data: inserted, error: insertError } = await admin
        .from('meta_connections')
        .insert(payload)
        .select('id')
        .single();
      if (insertError) throw new Error(insertError.message);
      connectionId = inserted.id;
    }

    try {
      const accounts = await listMetaAdAccounts(longLived.accessToken);
      const rows = accounts
        .map((account) => {
          const metaAdAccountId = normalizeMetaAdAccountId(account.id || account.account_id || '');
          if (!metaAdAccountId) return null;
          return {
            user_id: state.userId,
            team_id: state.teamId,
            meta_connection_id: connectionId,
            meta_ad_account_id: metaAdAccountId,
            name: account.name ?? null,
            currency: account.currency ?? null,
            account_status: account.account_status != null ? String(account.account_status) : null,
            updated_at: new Date().toISOString(),
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

      if (rows.length > 0) {
        const { error: accountUpsertError } = await admin
          .from('meta_ad_accounts')
          .upsert(rows, { onConflict: 'user_id,meta_ad_account_id' });
        if (accountUpsertError) throw new Error(accountUpsertError.message);
      }
    } catch (accountError) {
      console.warn('[meta/oauth/callback] ad account fetch skipped', accountError);
    }

    return NextResponse.redirect(farmRedirect(origin, state.farmId, 'connected'));
  } catch (error) {
    console.error('[meta/oauth/callback]', error);
    return NextResponse.redirect(
      farmRedirect(origin, state.farmId, 'error', error instanceof Error ? error.message : 'Meta connection failed.')
    );
  }
}
