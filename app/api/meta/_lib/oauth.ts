import crypto from 'crypto';
import { getOAuthStateSecret, getCrmEncryptionKey } from '@/app/api/integrations/_lib/env';

export type MetaOAuthStatePayload = {
  userId: string;
  teamId: string | null;
  farmId: string | null;
  nonce: string;
  iat: number;
};

const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const DEFAULT_APP_ORIGIN = 'https://www.flyrpro.app';
const META_AUTHORIZE_HOST = 'https://www.facebook.com';
const META_GRAPH_HOST = 'https://graph.facebook.com';

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
  return base64UrlEncode(
    crypto.createHmac('sha256', getOAuthStateSecret()).update(payloadEncoded).digest()
  );
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

function getMetaAppId(): string {
  const value = process.env.META_APP_ID?.trim();
  if (!value) throw new Error('META_APP_ID is not configured.');
  return value;
}

function getMetaAppSecret(): string {
  const value = process.env.META_APP_SECRET?.trim();
  if (!value) throw new Error('META_APP_SECRET is not configured.');
  return value;
}

function getMetaLoginConfigurationId(): string | null {
  return process.env.META_LOGIN_CONFIG_ID?.trim() || null;
}

export function getMetaApiVersion(): string {
  const configured = process.env.META_API_VERSION?.trim();
  if (!configured) return 'v25.0';
  return configured.startsWith('v') ? configured : `v${configured}`;
}

export function getMetaRedirectUri(origin?: string): string {
  const resolvedOrigin = resolveAppOrigin(origin);
  const configured = process.env.META_REDIRECT_URI?.trim();

  try {
    const hostname = new URL(resolvedOrigin).hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return `${resolvedOrigin}/api/meta/oauth/callback`;
    }
  } catch {}

  if (configured) return configured;
  return `${resolvedOrigin}/api/meta/oauth/callback`;
}

export function createMetaOAuthState(
  userId: string,
  teamId: string | null,
  farmId: string | null
): string {
  const payload: MetaOAuthStatePayload = {
    userId,
    teamId,
    farmId,
    nonce: base64UrlEncode(crypto.randomBytes(12)),
    iat: Math.floor(Date.now() / 1000),
  };
  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  return `${payloadEncoded}.${sign(payloadEncoded)}`;
}

export function verifyMetaOAuthState(rawState: string): MetaOAuthStatePayload | null {
  if (!rawState) return null;
  const [payloadEncoded, signature] = rawState.split('.');
  if (!payloadEncoded || !signature || sign(payloadEncoded) !== signature) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadEncoded).toString('utf8')) as MetaOAuthStatePayload;
    if (!payload?.userId || !payload?.iat || !payload?.nonce) return null;
    const now = Math.floor(Date.now() / 1000);
    if (now - payload.iat > OAUTH_STATE_TTL_SECONDS) return null;
    return {
      userId: payload.userId,
      teamId: payload.teamId ?? null,
      farmId: payload.farmId ?? null,
      nonce: payload.nonce,
      iat: payload.iat,
    };
  } catch {
    return null;
  }
}

export function buildMetaAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: getMetaAppId(),
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
  });

  const configId = getMetaLoginConfigurationId();
  if (configId) {
    params.set('config_id', configId);
    params.set('override_default_response_type', 'true');
  } else {
    params.set('scope', 'ads_read');
  }

  return `${META_AUTHORIZE_HOST}/${getMetaApiVersion()}/dialog/oauth?${params.toString()}`;
}

async function readMetaJson<T>(res: Response, context: string): Promise<T> {
  const raw = await res.text();
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`${context} returned invalid JSON.`);
    }
  }

  if (!res.ok) {
    const error = (data as { error?: { message?: string; code?: number; type?: string } } | null)?.error;
    const detail = error?.message || raw || `HTTP ${res.status}`;
    throw new Error(`${context} failed: ${detail}`);
  }

  return data as T;
}

export async function exchangeMetaOAuthCode(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; expiresAt: number | null }> {
  const params = new URLSearchParams({
    client_id: getMetaAppId(),
    client_secret: getMetaAppSecret(),
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch(`${META_GRAPH_HOST}/${getMetaApiVersion()}/oauth/access_token?${params.toString()}`);
  const data = await readMetaJson<{ access_token?: string; expires_in?: number }>(res, 'Meta token exchange');
  if (!data.access_token) throw new Error('Meta token exchange missing access_token.');

  return {
    accessToken: data.access_token,
    expiresAt: typeof data.expires_in === 'number' ? Math.floor(Date.now() / 1000) + data.expires_in : null,
  };
}

export async function exchangeForLongLivedMetaToken(
  shortLivedToken: string
): Promise<{ accessToken: string; expiresAt: number | null }> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: getMetaAppId(),
    client_secret: getMetaAppSecret(),
    fb_exchange_token: shortLivedToken,
  });

  const res = await fetch(`${META_GRAPH_HOST}/${getMetaApiVersion()}/oauth/access_token?${params.toString()}`);
  const data = await readMetaJson<{ access_token?: string; expires_in?: number }>(res, 'Meta long-lived token exchange');
  if (!data.access_token) throw new Error('Meta long-lived token exchange missing access_token.');

  return {
    accessToken: data.access_token,
    expiresAt: typeof data.expires_in === 'number' ? Math.floor(Date.now() / 1000) + data.expires_in : null,
  };
}

export async function fetchMetaUserId(accessToken: string): Promise<string | null> {
  const params = new URLSearchParams({ fields: 'id', access_token: accessToken });
  const res = await fetch(`${META_GRAPH_HOST}/${getMetaApiVersion()}/me?${params.toString()}`);
  const data = await readMetaJson<{ id?: string }>(res, 'Meta user lookup');
  return data.id ?? null;
}

export async function debugMetaToken(accessToken: string): Promise<{ scopes: string[] | null; expiresAt: number | null }> {
  const appAccessToken = `${getMetaAppId()}|${getMetaAppSecret()}`;
  const params = new URLSearchParams({
    input_token: accessToken,
    access_token: appAccessToken,
  });
  const res = await fetch(`${META_GRAPH_HOST}/${getMetaApiVersion()}/debug_token?${params.toString()}`);
  const data = await readMetaJson<{
    data?: {
      scopes?: string[];
      expires_at?: number;
    };
  }>(res, 'Meta token debug');

  return {
    scopes: Array.isArray(data.data?.scopes) ? data.data.scopes : null,
    expiresAt: typeof data.data?.expires_at === 'number' && data.data.expires_at > 0 ? data.data.expires_at : null,
  };
}

function getEncryptionKey(): Buffer {
  const configured = process.env.META_TOKEN_ENCRYPTION_KEY || getCrmEncryptionKey();
  return crypto.createHash('sha256').update(configured).digest();
}

export function encryptMetaAccessToken(token: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

export function decryptMetaAccessToken(encryptedData: string): string {
  const parts = encryptedData.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted Meta token format.');
  const [ivRaw, authTagRaw, encryptedRaw] = parts;

  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(ivRaw, 'base64')
    );
    decipher.setAuthTag(Buffer.from(authTagRaw, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Saved Meta token could not be decrypted. Reconnect Meta Ads.');
  }
}
