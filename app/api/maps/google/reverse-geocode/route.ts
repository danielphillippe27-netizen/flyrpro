import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  normalizeGoogleReverseGeocode,
  type GoogleGeocodingResult,
} from '@/lib/google/reverseGeocode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type GoogleGeocodingResponse = {
  status?: string;
  error_message?: string;
  results?: GoogleGeocodingResult[];
};

function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { latitude?: unknown; longitude?: unknown } | null;
  if (!validCoordinate(body?.latitude, -90, 90) || !validCoordinate(body?.longitude, -180, 180)) {
    return NextResponse.json({ error: 'Valid latitude and longitude are required' }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: 'Google reverse geocoding is not configured' }, { status: 503 });
  }

  const query = new URLSearchParams({
    latlng: `${body.latitude},${body.longitude}`,
    key: apiKey,
  });

  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${query}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      return NextResponse.json({ error: 'Google reverse geocoding request failed' }, { status: 502 });
    }

    const payload = (await response.json()) as GoogleGeocodingResponse;
    if (payload.status === 'ZERO_RESULTS') {
      return NextResponse.json({ error: 'No address found for this coordinate' }, { status: 404 });
    }
    if (payload.status !== 'OK') {
      console.warn('[google-reverse-geocode] Upstream failure:', payload.status, payload.error_message);
      return NextResponse.json({ error: 'Google reverse geocoding request failed' }, { status: 502 });
    }

    const normalized = normalizeGoogleReverseGeocode(payload.results?.[0]);
    if (!normalized) {
      return NextResponse.json({ error: 'No address found for this coordinate' }, { status: 404 });
    }
    return NextResponse.json(normalized);
  } catch (error) {
    console.warn('[google-reverse-geocode] Request error:', error);
    return NextResponse.json({ error: 'Google reverse geocoding request failed' }, { status: 502 });
  }
}
