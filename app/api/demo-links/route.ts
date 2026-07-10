import { NextRequest, NextResponse } from 'next/server';
import type { DemoPayload, DemoVertical } from '@/lib/demo/payload';
import { DEFAULT_PAYLOAD } from '@/lib/demo/defaults';
import { createAdminClient } from '@/lib/supabase/server';
import { MapService } from '@/lib/services/MapService';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { hasFlyrDemoAdminAccess } from '@/lib/auth/flyrInternalWorkspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DemoLinkRequestBody = {
  company?: unknown;
  contactName?: unknown;
  vertical?: unknown;
  city?: unknown;
  ctaVariant?: unknown;
  ctaUrl?: unknown;
  slug?: unknown;
};

const DEMO_VERTICALS: DemoVertical[] = ['roofing', 'lawncare', 'hvac', 'solar', 'political', 'real_estate', 'generic'];
const CTA_VARIANTS: DemoPayload['ctaVariant'][] = ['a', 'b'];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isDemoVertical(value: string): value is DemoVertical {
  return DEMO_VERTICALS.includes(value as DemoVertical);
}

function isCtaVariant(value: string): value is DemoPayload['ctaVariant'] {
  return CTA_VARIANTS.includes(value as DemoPayload['ctaVariant']);
}

async function uniqueSlug(admin: ReturnType<typeof createAdminClient>, preferredSlug: string) {
  const base = preferredSlug || 'demo';
  let candidate = base;
  let suffix = 2;

  while (true) {
    const { data, error } = await admin.from('demo_links').select('slug').eq('slug', candidate).maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return candidate;
    }

    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const allowed = await hasFlyrDemoAdminAccess(admin, requestUser.id, requestUser.email);
  if (!allowed) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: DemoLinkRequestBody;

  try {
    body = (await request.json()) as DemoLinkRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const company = text(body.company);
  const contactName = text(body.contactName);
  const city = text(body.city);
  const rawVertical = text(body.vertical) || 'generic';
  const rawCtaVariant = text(body.ctaVariant) || 'a';
  const ctaUrl = text(body.ctaUrl) || DEFAULT_PAYLOAD.ctaUrl;
  const requestedSlug = slugify(text(body.slug));
  const generatedSlug = slugify(company);

  if (!company) {
    return NextResponse.json({ error: 'Company is required.' }, { status: 400 });
  }

  if (!city) {
    return NextResponse.json({ error: 'City is required.' }, { status: 400 });
  }

  if (!isDemoVertical(rawVertical)) {
    return NextResponse.json({ error: `Invalid vertical: ${rawVertical}` }, { status: 400 });
  }

  if (!isCtaVariant(rawCtaVariant)) {
    return NextResponse.json({ error: `Invalid CTA variant: ${rawCtaVariant}` }, { status: 400 });
  }

  try {
    const geocoded = await MapService.geocodeAddress(city);
    if (!geocoded) {
      return NextResponse.json({ error: `Geocoding returned no result for: ${city}` }, { status: 400 });
    }

    const slug = await uniqueSlug(admin, requestedSlug || generatedSlug);
    const center: [number, number] = [geocoded.lon, geocoded.lat];

    const { error } = await admin.from('demo_links').insert({
      slug,
      company,
      contact_name: contactName || null,
      vertical: rawVertical,
      city,
      center_lng: geocoded.lon,
      center_lat: geocoded.lat,
      cta_variant: rawCtaVariant,
      cta_url: ctaUrl,
      navigation_mode: 'scroll',
    });

    if (error) {
      console.error('[demo-links] Insert failed:', error);
      return NextResponse.json({ error: 'Failed to create demo link.' }, { status: 500 });
    }

    return NextResponse.json({
      slug,
      url: `https://flyr.software/demo/${slug}`,
      center,
    });
  } catch (error) {
    console.error('[demo-links] Create failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create demo link.' },
      { status: 500 }
    );
  }
}
