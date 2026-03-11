import { createHmac, randomBytes } from 'crypto';

export type OAuthPlatform = 'ios' | 'web';

type OAuthStatePayload = {
  userId: string;
  workspaceId: string;
  platform: OAuthPlatform;
  nonce: string;
  iat: number;
};

const FUB_OAUTH_CLIENT_ID = process.env.FUB_OAUTH_CLIENT_ID ?? '';
const FUB_OAUTH_CLIENT_SECRET = process.env.FUB_OAUTH_CLIENT_SECRET ?? '';
const FUB_OAUTH_SCOPE = process.env.FUB_OAUTH_SCOPE ?? '';
const FUB_OAUTH_AUTHORIZE_URL =
  process.env.FUB_OAUTH_AUTHORIZE_URL ?? 'https://app.followupboss.com/oauth/authorize';
const FUB_OAUTH_TOKEN_URL =
  process.env.FUB_OAUTH_TOKEN_URL ?? 'https://app.followupboss.com/oauth/token';
const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY || '';
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const DEFAULT_APP_ORIGIN = 'https://www.flyrpro.app';

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad === 0 ? normalized : normalized + '='.repeat(4 - pad);
  return Buffer.from(padded, 'base64');
}

function sign(payloadEncoded: string): string {
  return base64UrlEncode(createHmac('sha256', OAUTH_STATE_SECRET).update(payloadEncoded).digest());
}

function resolveAppOrigin(origin?: string): string {
  const raw = origin || process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_ORIGIN;
  try {
    const parsed = new URL(raw);
    if (parsed.hostname.toLowerCase() === 'flyrpro.app') {
      parsed.hostname = 'www.flyrpro.app';
    }
    return parsed.origin;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

export function getFubOAuthRedirectUri(origin?: string): string {
  if (process.env.FUB_OAUTH_REDIRECT_URI) return process.env.FUB_OAUTH_REDIRECT_URI;
  const appOrigin = resolveAppOrigin(origin);
  return `${appOrigin}/api/integrations/fub/oauth/callback`;
}

export function getWebSuccessUrl(origin?: string): string {
  if (process.env.FUB_OAUTH_WEB_SUCCESS_URL) return process.env.FUB_OAUTH_WEB_SUCCESS_URL;
  const appOrigin = resolveAppOrigin(origin);
  return `${appOrigin}/settings/integrations?fub=connected`;
}

export function getWebErrorUrl(origin?: string): string {
  if (process.env.FUB_OAUTH_WEB_ERROR_URL) return process.env.FUB_OAUTH_WEB_ERROR_URL;
  const appOrigin = resolveAppOrigin(origin);
  return `${appOrigin}/settings/integrations?fub=error`;
}

export function buildIosResultUrl(result: 'success' | 'error', message?: string): string {
  const params = new URLSearchParams({
    provider: 'fub',
    status: result,
  });
  if (message) params.set('message', message);
  return `flyr://oauth?${params.toString()}`;
}

export function ensureOAuthConfig() {
  if (!FUB_OAUTH_CLIENT_ID || !FUB_OAUTH_CLIENT_SECRET) {
    throw new Error('FUB OAuth client credentials are not configured.');
  }
  if (!OAUTH_STATE_SECRET) {
    throw new Error('OAUTH_STATE_SECRET (or ENCRYPTION_KEY) is required.');
  }
}

export function createOAuthState(userId: string, workspaceId: string, platform: OAuthPlatform): string {
  ensureOAuthConfig();
  const payload: OAuthStatePayload = {
    userId,
    workspaceId,
    platform,
    nonce: base64UrlEncode(randomBytes(12)),
    iat: Math.floor(Date.now() / 1000),
  };
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
}

export function verifyOAuthState(rawState: string): OAuthStatePayload | null {
  if (!rawState || !OAUTH_STATE_SECRET) return null;
  const [payloadEncoded, signature] = rawState.split('.');
  if (!payloadEncoded || !signature) return null;
  if (sign(payloadEncoded) !== signature) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadEncoded).toString('utf8')) as OAuthStatePayload;
    if (!payload?.userId || !payload?.workspaceId || !payload?.platform || !payload?.iat) return null;
    const now = Math.floor(Date.now() / 1000);
    if (now - payload.iat > OAUTH_STATE_TTL_SECONDS) return null;
    if (payload.platform !== 'ios' && payload.platform !== 'web') return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  ensureOAuthConfig();
  const params = new URLSearchParams({
    response_type: 'auth_code',
    client_id: FUB_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    prompt: 'login',
  });
  if (FUB_OAUTH_SCOPE.trim()) {
    params.set('scope', FUB_OAUTH_SCOPE.trim());
  }
  return `${FUB_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeOAuthCode(
  code: string,
  redirectUri: string,
  state?: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  ensureOAuthConfig();

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: FUB_OAUTH_CLIENT_ID,
    client_secret: FUB_OAUTH_CLIENT_SECRET,
  });
  if (state?.trim()) {
    params.set('state', state);
  }

  const basic = Buffer.from(`${FUB_OAUTH_CLIENT_ID}:${FUB_OAUTH_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(FUB_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: params.toString(),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(raw || `Token exchange failed (${res.status})`);
  }
  return parseTokenResponse(raw, 'Token exchange');
}

export async function refreshOAuthToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  ensureOAuthConfig();
  if (!refreshToken.trim()) {
    throw new Error('Missing refresh token.');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: FUB_OAUTH_CLIENT_ID,
    client_secret: FUB_OAUTH_CLIENT_SECRET,
  });

  const basic = Buffer.from(`${FUB_OAUTH_CLIENT_ID}:${FUB_OAUTH_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(FUB_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: params.toString(),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(raw || `Refresh token exchange failed (${res.status})`);
  }
  return parseTokenResponse(raw, 'Refresh token exchange');
}

function parseTokenResponse(
  raw: string,
  context: string
): { accessToken: string; refreshToken?: string; expiresAt?: number } {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`${context} returned invalid JSON.`);
  }

  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  if (!accessToken) {
    throw new Error(`${context} missing access_token.`);
  }

  const nextRefreshToken =
    typeof data.refresh_token === 'string' && data.refresh_token.trim() ? data.refresh_token : undefined;
  const expiresIn =
    typeof data.expires_in === 'number'
      ? data.expires_in
      : typeof data.expires_in === 'string'
        ? Number.parseInt(data.expires_in, 10)
        : NaN;

  return {
    accessToken,
    refreshToken: nextRefreshToken,
    expiresAt: Number.isFinite(expiresIn) ? Math.floor(Date.now() / 1000) + Number(expiresIn) : undefined,
  };
}
