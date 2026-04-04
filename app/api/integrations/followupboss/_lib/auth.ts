import crypto from 'crypto';
import { refreshOAuthToken } from './oauth';
import { getCrmEncryptionKey } from './env';
import { FUB_CONNECTION_PROVIDERS } from './provider';

const FUB_SYSTEM_NAME = process.env.FUB_SYSTEM_NAME || 'FLYR';
const FUB_SYSTEM_KEY = process.env.FUB_SYSTEM_KEY;
const OAUTH_EXPIRY_SKEW_SECONDS = 90;

function getSystemHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'X-System': FUB_SYSTEM_NAME };
  if (FUB_SYSTEM_KEY) {
    headers['X-System-Key'] = FUB_SYSTEM_KEY;
  }
  return headers;
}

export function decryptApiKey(encryptedData: string): string {
  const keyString = getCrmEncryptionKey();
  const key = Buffer.from(keyString.slice(0, 32));
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export type FubAuth = {
  mode: 'oauth' | 'api_key';
  headers: Record<string, string>;
};

export async function getFubAuthForUserWorkspace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  workspaceId: string
): Promise<FubAuth | null> {
  const { data: oauth } = await supabase
    .from('user_integrations')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'fub')
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

  if (oauthToken) {
    const now = Math.floor(Date.now() / 1000);
    const shouldRefresh = expiresAt != null && now >= (expiresAt - OAUTH_EXPIRY_SKEW_SECONDS);

    if (shouldRefresh && storedRefreshToken) {
      try {
        const refreshed = await refreshOAuthToken(storedRefreshToken);
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
          .eq('provider', 'fub');

        return {
          mode: 'oauth',
          headers: {
            ...getSystemHeaders(),
            Authorization: `Bearer ${nextAccessToken}`,
          },
        };
      } catch (err) {
        console.warn('[followupboss/auth] oauth refresh failed', err);
      }
    }

    const isExpired = expiresAt != null && now >= expiresAt;
    if (!isExpired) {
      return {
        mode: 'oauth',
        headers: {
          ...getSystemHeaders(),
          Authorization: `Bearer ${oauthToken}`,
        },
      };
    }
  }

  const { data: connection } = await supabase
    .from('crm_connections')
    .select('api_key_encrypted')
    .eq('workspace_id', workspaceId)
    .in('provider', [...FUB_CONNECTION_PROVIDERS])
    .maybeSingle();

  if (!connection?.api_key_encrypted) {
    return null;
  }

  const apiKey = decryptApiKey(connection.api_key_encrypted);
  return {
    mode: 'api_key',
    headers: {
      ...getSystemHeaders(),
      Authorization: `Basic ${Buffer.from(apiKey + ':').toString('base64')}`,
    },
  };
}
