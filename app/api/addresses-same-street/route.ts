import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type AddressCandidateRow = {
  id: string;
  street_number: string | null;
  street_name: string | null;
  unit: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  zip: string | null;
  geom: { type?: string; coordinates?: [number, number] } | null;
};

function normalizeStreet(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function formatAddress(row: AddressCandidateRow): string {
  const parts = [
    [row.street_number, row.street_name].filter(Boolean).join(' ').trim(),
    row.unit,
    row.city,
    row.province,
    row.zip,
    row.country,
  ]
    .map((v) => (v ?? '').trim())
    .filter(Boolean);
  return parts.join(', ');
}

/**
 * POST /api/addresses-same-street
 * Body: { lat: number, lon: number, street: string, locality?: string, limit?: number }
 */
export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const lat = Number(body?.lat);
    const lon = Number(body?.lon);
    const streetRaw = typeof body?.street === 'string' ? body.street.trim() : '';
    const locality = typeof body?.locality === 'string' ? body.locality.trim() : '';
    const limit = Math.max(1, Math.min(500, Number(body?.limit ?? 100) || 100));

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: 'lat and lon are required' }, { status: 400 });
    }
    if (!streetRaw) {
      return NextResponse.json({ error: 'street is required' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const normalizedStreet = normalizeStreet(streetRaw);

    let query = supabase
      .from('ref_addresses_gold')
      .select('id, street_number, street_name, unit, city, province, country, zip, geom')
      .eq('street_name_normalized', normalizedStreet)
      .limit(Math.max(limit * 4, 200));

    if (locality) {
      query = query.ilike('city', locality);
    }

    let { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      // Fallback for drift in normalized street naming.
      let fallbackQuery = supabase
        .from('ref_addresses_gold')
        .select('id, street_number, street_name, unit, city, province, country, zip, geom')
        .ilike('street_name', streetRaw)
        .limit(Math.max(limit * 4, 200));
      if (locality) {
        fallbackQuery = fallbackQuery.ilike('city', locality);
      }
      const fallback = await fallbackQuery;
      data = fallback.data ?? [];
      error = fallback.error ?? null;
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    const rows = (data ?? []) as AddressCandidateRow[];
    const mapped = rows
      .map((row) => {
        const coords = row.geom?.coordinates;
        if (!coords || coords.length < 2) return null;
        const [rowLon, rowLat] = coords;
        const distanceM = haversineMeters(lat, lon, rowLat, rowLon);
        return {
          gers_id: null,
          geometry_json: row.geom ? JSON.stringify(row.geom) : null,
          house_number: row.street_number,
          street_name: row.street_name,
          unit: row.unit,
          postal_code: row.zip,
          locality: row.city,
          region: row.province,
          country: row.country,
          id: row.id,
          lat: rowLat,
          lon: rowLon,
          distance_m: distanceM,
          full_address: formatAddress(row),
          street_no: row.street_number,
          address_id: row.id,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, limit);

    return NextResponse.json(mapped);
  } catch (error) {
    console.error('Error loading same-street addresses:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch addresses' },
      { status: 500 }
    );
  }
}
