import { createHmac, randomBytes } from 'crypto';
import { getOAuthStateSecret } from '@/app/api/integrations/_lib/env';

export type MondayOAuthPlatform = 'ios' | 'web';

type MondayOAuthStatePayload = {
  userId: string;
  platform: MondayOAuthPlatform;
  workspaceId?: string;
  nonce: string;
  iat: number;
};

const MONDAY_CLIENT_ID = process.env.MONDAY_CLIENT_ID ?? '';
const MONDAY_CLIENT_SECRET = process.env.MONDAY_CLIENT_SECRET ?? '';
const MONDAY_SCOPE = process.env.MONDAY_OAUTH_SCOPE?.trim() ?? '';
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

export function getMondayOAuthRedirectUri(origin?: string): string {
  if (process.env.MONDAY_REDIRECT_URI) return process.env.MONDAY_REDIRECT_URI;
  const appOrigin = resolveAppOrigin(origin);
  return `${appOrigin}/api/integrations/monday/oauth/callback`;
}

export function getMondayWebSuccessUrl(origin?: string): string {
  const appOrigin = resolveAppOrigin(origin);
  return `${appOrigin}/settings/integrations?monday=connected`;
}

export function getMondayWebErrorUrl(origin?: string): string {
  const appOrigin = resolveAppOrigin(origin);
  return `${appOrigin}/settings/integrations?monday=error`;
}

export function buildMondayIosResultUrl(result: 'success' | 'error', message?: string): string {
  const params = new URLSearchParams({
    provider: 'monday',
    status: result,
  });
  if (message) params.set('message', message);
  return `flyr://oauth?${params.toString()}`;
}

export function ensureMondayOAuthConfig() {
  if (!MONDAY_CLIENT_ID || !MONDAY_CLIENT_SECRET) {
    throw new Error('MONDAY_CLIENT_ID and MONDAY_CLIENT_SECRET are required.');
  }
  if (!OAUTH_STATE_SECRET) {
    throw new Error('OAUTH_STATE_SECRET (or ENCRYPTION_KEY) is required.');
  }
}

export function createMondayOAuthState(
  userId: string,
  platform: MondayOAuthPlatform,
  workspaceId?: string
): string {
  ensureMondayOAuthConfig();
  const payload: MondayOAuthStatePayload = {
    userId,
    platform,
    workspaceId,
    nonce: base64UrlEncode(randomBytes(12)),
    iat: Math.floor(Date.now() / 1000),
  };
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
}

export function verifyMondayOAuthState(rawState: string): MondayOAuthStatePayload | null {
  if (!rawState || !OAUTH_STATE_SECRET) return null;
  const [payloadEncoded, signature] = rawState.split('.');
  if (!payloadEncoded || !signature) return null;
  if (sign(payloadEncoded) !== signature) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadEncoded).toString('utf8')) as MondayOAuthStatePayload;
    if (!payload?.userId || !payload?.platform || !payload?.iat) return null;
    if (payload.platform !== 'ios' && payload.platform !== 'web') return null;
    if (Math.floor(Date.now() / 1000) - payload.iat > OAUTH_STATE_TTL_SECONDS) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildMondayAuthorizeUrl(state: string, redirectUri: string) {
  ensureMondayOAuthConfig();
  const params = new URLSearchParams({
    client_id: MONDAY_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
  });
  if (MONDAY_SCOPE) {
    params.set('scope', MONDAY_SCOPE);
  }
  return `https://auth.monday.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeMondayOAuthCode(code: string, redirectUri: string): Promise<{ accessToken: string }> {
  ensureMondayOAuthConfig();
  const params = new URLSearchParams({
    code,
    client_id: MONDAY_CLIENT_ID,
    client_secret: MONDAY_CLIENT_SECRET,
    redirect_uri: redirectUri,
  });

  const response = await fetch('https://auth.monday.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(raw || `Monday OAuth exchange failed (${response.status})`);
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error('Monday OAuth exchange returned invalid JSON.');
  }

  const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
  if (!accessToken) {
    throw new Error('Monday OAuth exchange missing access_token.');
  }

  return { accessToken };
}
