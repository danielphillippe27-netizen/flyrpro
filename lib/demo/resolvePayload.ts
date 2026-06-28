import { DEFAULT_PAYLOAD } from './defaults';
import type { DemoPayload, DemoVertical } from './payload';
import { getVerticalCopyOverrides } from './verticals';
import { createAdminClient } from '@/lib/supabase/server';

type DemoLinkRow = {
  slug: string;
  company: string | null;
  contact_name: string | null;
  vertical: string | null;
  city: string | null;
  center_lng: number | null;
  center_lat: number | null;
  cta_variant: string | null;
  cta_url: string | null;
  navigation_mode: string | null;
};

const DEMO_VERTICALS: DemoVertical[] = ['roofing', 'lawncare', 'hvac', 'solar', 'political', 'real_estate', 'generic'];
const CTA_VARIANTS: DemoPayload['ctaVariant'][] = ['book', 'reply', 'territory'];
const NAVIGATION_MODES: DemoPayload['navigationMode'][] = ['scroll', 'click'];

function cloneDefaultPayload(slug: string): DemoPayload {
  return {
    ...DEFAULT_PAYLOAD,
    slug,
    copy: {
      ...DEFAULT_PAYLOAD.copy,
      b2Strikes: [...DEFAULT_PAYLOAD.copy.b2Strikes],
      b2Math: DEFAULT_PAYLOAD.copy.b2Math.map((item) => ({ ...item })),
      b5Pitch: [...DEFAULT_PAYLOAD.copy.b5Pitch],
      b5OutcomeButtons: { ...DEFAULT_PAYLOAD.copy.b5OutcomeButtons },
      b5LeadDetails: DEFAULT_PAYLOAD.copy.b5LeadDetails.map((item) => ({ ...item })),
    },
  };
}

function isDemoVertical(value: string | null): value is DemoVertical {
  return DEMO_VERTICALS.includes(value as DemoVertical);
}

function isCtaVariant(value: string | null): value is DemoPayload['ctaVariant'] {
  return CTA_VARIANTS.includes(value as DemoPayload['ctaVariant']);
}

function isNavigationMode(value: string | null): value is DemoPayload['navigationMode'] {
  return NAVIGATION_MODES.includes(value as DemoPayload['navigationMode']);
}

function withCityInBeat3Sub(text: string, city: string) {
  const marker = 'Draw or import a polygon';
  if (!text.includes(marker)) {
    return `${text} in ${city}`;
  }

  return text.replace(marker, `Draw or import a polygon in ${city}`);
}

export async function resolvePayloadForSlug(slug: string): Promise<DemoPayload> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('demo_links')
      .select('slug, company, contact_name, vertical, city, center_lng, center_lat, cta_variant, cta_url, navigation_mode')
      .eq('slug', slug)
      .maybeSingle<DemoLinkRow>();

    if (error) {
      console.error(`[demo] Failed to resolve demo payload for slug "${slug}":`, error);
      return cloneDefaultPayload(slug);
    }

    if (!data) {
      return cloneDefaultPayload(slug);
    }

    const payload = cloneDefaultPayload(data.slug || slug);
    const city = data.city?.trim() || undefined;
    const ctaUrl = data.cta_url?.trim() || payload.ctaUrl;

    payload.company = data.company?.trim() || undefined;
    payload.contactName = data.contact_name?.trim() || undefined;
    payload.vertical = isDemoVertical(data.vertical) ? data.vertical : payload.vertical;
    payload.city = city;
    payload.ctaVariant = isCtaVariant(data.cta_variant) ? data.cta_variant : payload.ctaVariant;
    payload.ctaUrl = ctaUrl;
    payload.navigationMode = isNavigationMode(data.navigation_mode) ? data.navigation_mode : payload.navigationMode;
    payload.center =
      typeof data.center_lng === 'number' && typeof data.center_lat === 'number'
        ? [data.center_lng, data.center_lat]
        : undefined;

    // Apply vertical-specific copy overrides on top of the default copy.
    const overrides = getVerticalCopyOverrides(payload.vertical);
    payload.copy = { ...payload.copy, ...overrides };

    if (city) {
      payload.copy.b3Sub = withCityInBeat3Sub(payload.copy.b3Sub, city);
    }

    return payload;
  } catch (error) {
    console.error(`[demo] Unexpected error resolving demo payload for slug "${slug}":`, error);
    return cloneDefaultPayload(slug);
  }
}
