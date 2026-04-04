import { refreshHubSpotOAuthToken } from './oauth';

const OAUTH_EXPIRY_SKEW_SECONDS = 90;

export type HubSpotAuth = {
  headers: Record<string, string>;
};

export async function getHubSpotAuthForUserWorkspace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string
): Promise<HubSpotAuth | null> {
  const { data: oauth } = await supabase
    .from('user_integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'hubspot')
    .maybeSingle();

  const oauthToken = oauth?.access_token ? String(oauth.access_token).trim() : '';
  const storedRefreshToken = oauth?.refresh_token ? String(oauth.refresh_token).trim() : '';
  const rawExpiresAt = oauth?.expires_at;
  const parsedExpiresAt =
    typeof rawExpiresAt === 'number'
      ? rawExpiresAt
      : typeof rawExpiresAt === 'string'
        ? Number.parseInt(rawExpiresAt, 10)
        : NaN;
  const expiresAt = Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : null;

  if (!oauthToken) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const shouldRefresh = expiresAt != null && now >= (expiresAt - OAUTH_EXPIRY_SKEW_SECONDS);

  if (shouldRefresh && storedRefreshToken) {
    try {
      const refreshed = await refreshHubSpotOAuthToken(storedRefreshToken);
      const nextAccessToken = refreshed.accessToken.trim();
      const nextRefreshToken = (refreshed.refreshToken || storedRefreshToken).trim();

      await supabase
        .from('user_integrations')
        .update({
          access_token: nextAccessToken,
          refresh_token: nextRefreshToken || null,
          expires_at: refreshed.expiresAt ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('provider', 'hubspot');

      return {
        headers: {
          Authorization: `Bearer ${nextAccessToken}`,
        },
      };
    } catch (err) {
      console.warn('[hubspot/auth] oauth refresh failed', err);
    }
  }

  const isExpired = expiresAt != null && now >= expiresAt;
  if (isExpired) {
    return null;
  }

  return {
    headers: {
      Authorization: `Bearer ${oauthToken}`,
    },
  };
}
