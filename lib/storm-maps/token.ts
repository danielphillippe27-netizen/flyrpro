import { createHmac, timingSafeEqual } from 'node:crypto';

type TileTokenPayload = {
  workspaceId: string;
  issuedAt: number;
  expiresAt: number;
  approvedTiles: string[];
};

const TOKEN_TTL_SECONDS = 15 * 60;

function signingSecret(): string {
  return process.env.STORM_MAPS_SIGNING_SECRET || '';
}

function signature(encodedPayload: string): string {
  const secret = signingSecret();
  if (!secret) throw new Error('Storm Maps signing secret is not configured');
  return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

export function issueStormMapsTileToken(workspaceId: string, approvedTiles: string[] = [], now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + TOKEN_TTL_SECONDS;
  const payload: TileTokenPayload = {
    workspaceId,
    issuedAt,
    expiresAt,
    approvedTiles: [...new Set(approvedTiles)].sort(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return {
    token: `${encodedPayload}.${signature(encodedPayload)}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

export function verifyStormMapsTileToken(token: string, now = Date.now()): TileTokenPayload | null {
  const [encodedPayload, providedSignature, ...rest] = token.split('.');
  if (!encodedPayload || !providedSignature || rest.length > 0) return null;

  let expectedSignature: string;
  try {
    expectedSignature = signature(encodedPayload);
  } catch {
    return null;
  }

  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as TileTokenPayload;
    if (!payload.workspaceId || !Number.isFinite(payload.issuedAt) || !Number.isFinite(payload.expiresAt)) return null;
    if (payload.issuedAt > payload.expiresAt || payload.expiresAt - payload.issuedAt !== TOKEN_TTL_SECONDS) return null;
    if (!Array.isArray(payload.approvedTiles) || payload.approvedTiles.length > 128 || payload.approvedTiles.some((value) => typeof value !== 'string')) return null;
    if (payload.expiresAt * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}
