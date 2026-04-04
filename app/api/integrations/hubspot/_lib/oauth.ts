import { createHmac, randomBytes } from 'crypto';
import { getOAuthStateSecret } from '@/app/api/integrations/_lib/env';

export type HubSpotOAuthPlatform = 'ios' | 'web';

type HubSpotOAuthStatePayload = {
  userId: string;
  workspaceId: string;
  platform: HubSpotOAuthPlatform;
  nonce: string;
  iat: number;
};

const HUBSPOT_OAUTH_CLIENT_ID = process.env.HUBSPOT_OAUTH_CLIENT_ID ?? '';
const HUBSPOT_OAUTH_CLIENT_SECRET = process.env.HUBSPOT_OAUTH_CLIENT_SECRET ?? '';
const HUBSPOT_OAUTH_SCOPE =
  process.env.HUBSPOT_OAUTH_SCOPE ??
  [
    'oauth',
    'crm.objects.contacts.read',
    'crm.objects.contacts.write',
    'crm.objects.appointments.read',
    'crm.objects.appointments.write',
    'crm.schemas.appointments.read',
    'crm.schemas.appointments.write',
  ].join(' ');
const HUBSPOT_OAUTH_AUTHORIZE_URL =
  process.env.HUBSPOT_OAUTH_AUTHORIZE_URL ?? 'https://app.hubspot.com/oauth/authorize';
const HUBSPOT_OAUTH_TOKEN_URL =
  process.env.HUBSPOT_OAUTH_TOKEN_URL ?? 'https://api.hubspot.com/oauth/v3/token';
const HUBSPOT_OAUTH_INTROSPECT_URL =
  process.env.HUBSPOT_OAUTH_INTROSPECT_URL ?? 'https://api.hubspot.com/oauth/v3/token/introspect';
const OAUTH_STATE_SECRET = getOAuthStateSecret();
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

export function getHubSpotOAuthRedirectUri(origin?: string): string {
  if (process.env.HUBSPOT_OAUTH_REDIRECT_URI) return process.env.HUBSPOT_OAUTH_REDIRECT_URI;
  const appOrigin = resolveAppOrigin(origin);
  return `${appOrigin}/api/integrations/hubspot/oauth/callback`;
}

export function getHubSpotWebSuccessUrl(origin?: string): string {
  if (process.env.HUBSPOT_OAUTH_WEB_SUCCESS_URL) return process.env.HUBSPOT_OAUTH_WEB_SUCCESS_URL;
  const appOrigin = resolveAppOrigin(origin);
  return `${appOrigin}/settings/integrations?hubspot=connected`;
}

export function getHubSpotWebErrorUrl(origin?: string): string {
  if (process.env.HUBSPOT_OAUTH_WEB_ERROR_URL) return process.env.HUBSPOT_OAUTH_WEB_ERROR_URL;
  const appOrigin = resolveAppOrigin(origin);
  return `${appOrigin}/settings/integrations?hubspot=error`;
}

export function buildHubSpotIosResultUrl(result: 'success' | 'error', message?: string): string {
  const params = new URLSearchParams({
    provider: 'hubspot',
    status: result,
  });
  if (message) params.set('message', message);
  return `flyr://oauth?${params.toString()}`;
}

export function ensureHubSpotOAuthConfig() {
  if (!HUBSPOT_OAUTH_CLIENT_ID || !HUBSPOT_OAUTH_CLIENT_SECRET) {
    throw new Error('HubSpot OAuth client credentials are not configured.');
  }
  if (!OAUTH_STATE_SECRET) {
    throw new Error('OAUTH_STATE_SECRET (or ENCRYPTION_KEY) is required.');
  }
}

export function createHubSpotOAuthState(
  userId: string,
  workspaceId: string,
  platform: HubSpotOAuthPlatform
): string {
  ensureHubSpotOAuthConfig();
  const payload: HubSpotOAuthStatePayload = {
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

export function verifyHubSpotOAuthState(rawState: string): HubSpotOAuthStatePayload | null {
  if (!rawState || !OAUTH_STATE_SECRET) return null;
  const [payloadEncoded, signature] = rawState.split('.');
  if (!payloadEncoded || !signature) return null;
  if (sign(payloadEncoded) !== signature) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadEncoded).toString('utf8')) as HubSpotOAuthStatePayload;
    if (!payload?.userId || !payload?.workspaceId || !payload?.platform || !payload?.iat) return null;
    const now = Math.floor(Date.now() / 1000);
    if (now - payload.iat > OAUTH_STATE_TTL_SECONDS) return null;
    if (payload.platform !== 'ios' && payload.platform !== 'web') return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildHubSpotAuthorizeUrl(state: string, redirectUri: string): string {
  ensureHubSpotOAuthConfig();
  const params = new URLSearchParams({
    client_id: HUBSPOT_OAUTH_CLIENT_ID,
    scope: HUBSPOT_OAUTH_SCOPE.trim(),
    redirect_uri: redirectUri,
    state,
  });
  return `${HUBSPOT_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeHubSpotOAuthCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  ensureHubSpotOAuthConfig();

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: HUBSPOT_OAUTH_CLIENT_ID,
    client_secret: HUBSPOT_OAUTH_CLIENT_SECRET,
  });

  const res = await fetch(HUBSPOT_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(raw || `Token exchange failed (${res.status})`);
  }
  return parseTokenResponse(raw, 'Token exchange');
}

export async function refreshHubSpotOAuthToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: number }> {
  ensureHubSpotOAuthConfig();
  if (!refreshToken.trim()) {
    throw new Error('Missing refresh token.');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: HUBSPOT_OAUTH_CLIENT_ID,
    client_secret: HUBSPOT_OAUTH_CLIENT_SECRET,
  });

  const res = await fetch(HUBSPOT_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(raw || `Refresh token exchange failed (${res.status})`);
  }
  return parseTokenResponse(raw, 'Refresh token exchange');
}

export async function introspectHubSpotAccessToken(accessToken: string): Promise<{
  hubId?: string | null;
  hubDomain?: string | null;
  userEmail?: string | null;
}> {
  ensureHubSpotOAuthConfig();
  const params = new URLSearchParams({
    client_id: HUBSPOT_OAUTH_CLIENT_ID,
    client_secret: HUBSPOT_OAUTH_CLIENT_SECRET,
    token: accessToken,
  });

  const res = await fetch(HUBSPOT_OAUTH_INTROSPECT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(raw || `Token introspection failed (${res.status})`);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('Token introspection returned invalid JSON.');
  }

  return {
    hubId: data.hub_id != null ? String(data.hub_id) : null,
    hubDomain: typeof data.hub_domain === 'string' ? data.hub_domain : null,
    userEmail: typeof data.user === 'string' ? data.user : null,
  };
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
