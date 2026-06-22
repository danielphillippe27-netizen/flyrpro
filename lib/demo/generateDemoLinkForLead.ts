import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_PAYLOAD } from '@/lib/demo/defaults';
import type { DemoPayload, DemoVertical } from '@/lib/demo/payload';
import { MapService } from '@/lib/services/MapService';
import { createAdminClient } from '@/lib/supabase/server';
import type { DiallerLead } from '@/types/database';

type AdminClient = ReturnType<typeof createAdminClient> | SupabaseClient;

type RequestUserLike = {
  id: string;
  email?: string | null;
};

type ProspectRunContext = {
  city: string | null;
  region: string | null;
  industry: string | null;
};

type DemoLinkFields = {
  company: string;
  contactName?: string | null;
  city?: string | null;
  industry?: string | null;
  vertical?: DemoVertical;
  ctaVariant?: DemoPayload['ctaVariant'];
  ctaUrl?: string | null;
};

export type GeneratedDemoLink = {
  slug: string;
  url: string;
  center?: [number, number];
  company: string;
  contactName?: string | null;
  city?: string | null;
  vertical: DemoVertical;
};

const DEMO_ORIGIN = 'https://flyr.software';

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function slugifyDemoLink(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function mapIndustryToDemoVertical(industry: string | null | undefined): DemoVertical {
  const normalized = cleanText(industry).toLowerCase();
  if (normalized.includes('roofing')) return 'roofing';
  if (normalized.includes('solar')) return 'solar';
  if (normalized.includes('lawn')) return 'lawncare';
  if (normalized.includes('hvac')) return 'hvac';
  return 'generic';
}

async function uniqueDemoSlug(admin: AdminClient, preferredSlug: string): Promise<string> {
  const base = preferredSlug || 'demo';
  let candidate = base;
  let suffix = 2;

  while (true) {
    const { data, error } = await admin
      .from('demo_links')
      .select('slug')
      .eq('slug', candidate)
      .maybeSingle();

    if (error) throw error;
    if (!data) return candidate;

    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

function cityLabel(run: ProspectRunContext | null): string | null {
  if (!run?.city) return null;
  return [run.city, run.region].map(cleanText).filter(Boolean).join(', ') || run.city;
}

async function loadProspectRunForLead(
  admin: AdminClient,
  lead: DiallerLead
): Promise<ProspectRunContext | null> {
  const workspaceId = cleanText(lead.workspace_id);
  if (!workspaceId) return null;

  const phone = cleanText(lead.phone);
  const company = cleanText(lead.company) || cleanText(lead.name);

  const resultSelect = 'run_id, prospect_search_runs(city, region, industry)';
  const readRun = (row: unknown): ProspectRunContext | null => {
    const nested = (row as { prospect_search_runs?: unknown } | null)?.prospect_search_runs;
    const run = Array.isArray(nested) ? nested[0] : nested;
    if (!run || typeof run !== 'object') return null;
    return {
      city: typeof (run as { city?: unknown }).city === 'string' ? (run as { city: string }).city : null,
      region: typeof (run as { region?: unknown }).region === 'string' ? (run as { region: string }).region : null,
      industry: typeof (run as { industry?: unknown }).industry === 'string' ? (run as { industry: string }).industry : null,
    };
  };

  if (phone) {
    const { data, error } = await admin
      .from('prospect_search_run_results')
      .select(resultSelect)
      .eq('workspace_id', workspaceId)
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return readRun(data);
    if (error && error.code !== 'PGRST116') {
      console.warn('[demo-link-generator] prospect result phone lookup failed', error);
    }
  }

  if (!company) return null;

  const { data, error } = await admin
    .from('prospect_search_run_results')
    .select(resultSelect)
    .eq('workspace_id', workspaceId)
    .ilike('business_name', company)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && data) return readRun(data);
  if (error && error.code !== 'PGRST116') {
    console.warn('[demo-link-generator] prospect result company lookup failed', error);
  }

  return null;
}

export async function createDemoLinkFromFields(params: {
  admin?: AdminClient;
  fields: DemoLinkFields;
}): Promise<GeneratedDemoLink> {
  const admin = params.admin ?? createAdminClient();
  const company = cleanText(params.fields.company);
  if (!company) throw new Error('Company is required.');

  const city = cleanText(params.fields.city) || null;
  const vertical = params.fields.vertical ?? mapIndustryToDemoVertical(params.fields.industry);
  const ctaVariant = params.fields.ctaVariant ?? DEFAULT_PAYLOAD.ctaVariant;
  const ctaUrl = cleanText(params.fields.ctaUrl) || DEFAULT_PAYLOAD.ctaUrl;
  const slug = await uniqueDemoSlug(admin, slugifyDemoLink(company));

  let center: [number, number] | undefined;
  if (city) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const geocoded = await Promise.race([
        MapService.geocodeAddress(city),
        new Promise<null>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new DOMException('Geocoding timed out', 'TimeoutError'));
          });
        }),
      ]);
      clearTimeout(timeoutId);
      if (geocoded) center = [geocoded.lon, geocoded.lat];
    } catch (error) {
      if ((error as DOMException).name === 'TimeoutError') {
        console.warn('[demo-link-generator] geocoding timed out after 5000ms; creating link without center');
      } else {
        console.warn('[demo-link-generator] geocoding failed; creating link without center', error);
      }
    }
  }

  const { error } = await admin.from('demo_links').insert({
    slug,
    company,
    contact_name: cleanText(params.fields.contactName) || null,
    vertical,
    city,
    center_lng: center?.[0] ?? null,
    center_lat: center?.[1] ?? null,
    cta_variant: ctaVariant,
    cta_url: ctaUrl,
    navigation_mode: 'scroll',
  });

  if (error) throw error;

  return {
    slug,
    url: `${DEMO_ORIGIN}/demo/${slug}`,
    center,
    company,
    contactName: cleanText(params.fields.contactName) || null,
    city,
    vertical,
  };
}

export async function generateDemoLinkForLead(params: {
  admin?: AdminClient;
  leadId: string;
  user: RequestUserLike;
}): Promise<GeneratedDemoLink> {
  const admin = params.admin ?? createAdminClient();
  const leadId = cleanText(params.leadId);
  if (!leadId) throw new Error('Lead id is required.');
  if (!params.user?.id) throw new Error('User is required.');

  const { data: leadRow, error } = await admin
    .from('dialler_leads')
    .select('*')
    .eq('id', leadId)
    .maybeSingle();

  if (error) throw error;
  if (!leadRow) throw new Error('Lead not found.');

  const lead = leadRow as DiallerLead;
  const run = await loadProspectRunForLead(admin, lead);
  const company = cleanText(lead.company) || cleanText(lead.name) || 'Lead';
  const contactName = cleanText(lead.name) && cleanText(lead.name) !== company ? cleanText(lead.name) : null;

  return createDemoLinkFromFields({
    admin,
    fields: {
      company,
      contactName,
      city: cityLabel(run),
      industry: run?.industry,
      vertical: mapIndustryToDemoVertical(run?.industry),
      ctaVariant: DEFAULT_PAYLOAD.ctaVariant,
      ctaUrl: DEFAULT_PAYLOAD.ctaUrl,
    },
  });
}
