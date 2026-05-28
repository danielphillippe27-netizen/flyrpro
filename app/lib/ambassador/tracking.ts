import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { sanitizeTrackingParam } from '@/app/lib/ambassador/portal';

function firstForwardedIp(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first || null;
}

export function hashRequestIp(request: NextRequest): string | null {
  const ip =
    firstForwardedIp(request.headers.get('x-forwarded-for')) ||
    request.headers.get('x-real-ip')?.trim() ||
    null;
  if (!ip) return null;

  const salt =
    process.env.AMBASSADOR_TRACKING_IP_SALT ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'flyr-ambassador-tracking';

  return createHash('sha256').update(`${salt}:${ip}`).digest('hex');
}

export function getTrackingMetadata(request: NextRequest) {
  return {
    source: sanitizeTrackingParam(request.nextUrl.searchParams.get('source')),
    campaign: sanitizeTrackingParam(request.nextUrl.searchParams.get('campaign')),
    ipHash: hashRequestIp(request),
    userAgent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
    referer: request.headers.get('referer')?.slice(0, 500) ?? null,
  };
}
