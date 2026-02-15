/**
 * Apple App Store Server API: JWT signer and transaction lookup.
 * Use APPLE_ENVIRONMENT=Sandbox for TestFlight; Production for live.
 *
 * TODO (local testing): Use Apple Sandbox transaction IDs from TestFlight and set
 * APPLE_ENVIRONMENT=Sandbox in dev. If "not found" in Production, we retry once in Sandbox.
 */

import crypto from 'crypto';

const APPLE_ISSUER_ID = process.env.APPLE_APP_STORE_SERVER_ISSUER_ID ?? '';
const APPLE_KEY_ID = process.env.APPLE_APP_STORE_SERVER_KEY_ID ?? '';
const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID ?? '';
const APPLE_PRIVATE_KEY_PEM = process.env.APPLE_APP_STORE_SERVER_PRIVATE_KEY ?? '';
const APPLE_ENV = (process.env.APPLE_ENVIRONMENT ?? 'Sandbox').toLowerCase();

const PRODUCTION_BASE = 'https://api.storekit.itunes.apple.com';
const SANDBOX_BASE = 'https://api.storekit-sandbox.itunes.apple.com';

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createAppleJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: APPLE_KEY_ID };
  const payload = {
    iss: APPLE_ISSUER_ID,
    iat: now,
    exp: now + 3600,
    aud: 'appstoreconnect-v1',
    bid: APPLE_BUNDLE_ID,
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  let privateKey: crypto.KeyObject;
  try {
    const pem = APPLE_PRIVATE_KEY_PEM.replace(/\\n/g, '\n');
    privateKey = crypto.createPrivateKey(pem);
  } catch (e) {
    throw new Error('Invalid Apple private key');
  }

  const sig = crypto.sign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  const sigB64 = base64UrlEncode(Buffer.from(sig));
  return `${signingInput}.${sigB64}`;
}

export interface AppleTransactionResult {
  isActive: boolean;
  expiresAt: string | null;
  productId: string;
  originalTransactionId: string;
}

/**
 * Decode JWS payload (middle part) without full verification (server-to-server response from Apple).
 */
function decodeJwsPayload(jws: string): Record<string, unknown> {
  const parts = jws.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWS');
  const payloadB64 = parts[1];
  const padding = 4 - (payloadB64.length % 4);
  const b64 = padding === 4 ? payloadB64 : payloadB64 + '='.repeat(padding);
  const json = Buffer.from(b64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Look up transaction and return subscription status.
 * If not found in Production, retry once in Sandbox (common for TestFlight).
 */
export async function getAppleTransactionStatus(
  transactionId: string
): Promise<AppleTransactionResult | null> {
  const bases = APPLE_ENV === 'production' ? [PRODUCTION_BASE, SANDBOX_BASE] : [SANDBOX_BASE, PRODUCTION_BASE];
  let lastError: Error | null = null;

  for (const base of bases) {
    try {
      const token = createAppleJwt();
      const url = `${base}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (res.status === 404) {
        lastError = new Error('Transaction not found');
        continue;
      }
      if (!res.ok) {
        const text = await res.text();
        lastError = new Error(`Apple API ${res.status}: ${text.slice(0, 200)}`);
        continue;
      }

      const data = (await res.json()) as { signedTransactionInfo?: string };
      const signedTx = data.signedTransactionInfo;
      if (!signedTx || typeof signedTx !== 'string') {
        lastError = new Error('Missing signedTransactionInfo');
        continue;
      }

      const payload = decodeJwsPayload(signedTx);
      const expiresDateMs = payload.expiresDate as number | undefined;
      const revocationDateMs = payload.revocationDate as number | undefined;
      const productId = (payload.productId as string) ?? '';
      const originalTransactionId = (payload.originalTransactionId as string) ?? transactionId;

      const now = Date.now();
      const expired = typeof expiresDateMs === 'number' && expiresDateMs < now;
      const revoked = typeof revocationDateMs === 'number' && revocationDateMs > 0;
      const isActive = !expired && !revoked;

      return {
        isActive,
        expiresAt:
          typeof expiresDateMs === 'number'
            ? new Date(expiresDateMs).toISOString()
            : null,
        productId,
        originalTransactionId,
      };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
}

export function getAppleBundleId(): string {
  return APPLE_BUNDLE_ID;
}
