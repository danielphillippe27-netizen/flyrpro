import type { ReiqLead, ReiqLeadSearchResult } from '@/lib/scraper/reiqLeadSearch';

type ReinswScrapeOptions = {
  location: string;
  maxPages?: number;
  maxProfiles?: number;
  delayMs?: number;
};

type ReinswMapItem = {
  ContactKey?: string;
  ID?: string;
  Latitude?: number;
  Longitude?: number;
  LongLatAddress?: string;
  Company?: string;
  IsCompany?: boolean;
  Title?: string;
  FullName?: string;
  LastName?: string;
  FirstName?: string;
  [key: string]: unknown;
};

type ReinswApiSession = {
  cookie: string;
  requestVerificationToken: string;
  contentKey: string;
  contentItemKey: string;
};

type ReinswMapSettings = {
  mapsDataIqa?: string;
  profilePagePath?: string;
};

type ReinswProfileSeed = {
  sourceUrl: string;
  mapItem: ReinswMapItem;
};

const REINSW_SEARCH_URL =
  'https://www.reinsw.com.au/Web/Web/Find_an_Agent/find_a_reinsw_member-agent.aspx';
const REINSW_API_ORIGIN = 'https://www.reinsw.com.au';
const REINSW_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';
const REINSW_QUERY_PAGE_SIZE = 500;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?61\s?)?(?:0)?(?:\d[\s().-]?){8,12}\d/g;

const NSW_LOCATION_BOUNDS: Record<string, { minLng: number; maxLng: number; minLat: number; maxLat: number }> = {
  nsw: { minLng: 140.9, maxLng: 153.7, minLat: -37.6, maxLat: -28.0 },
  'new south wales': { minLng: 140.9, maxLng: 153.7, minLat: -37.6, maxLat: -28.0 },
  sydney: { minLng: 150.5, maxLng: 151.4, minLat: -34.2, maxLat: -33.4 },
  newcastle: { minLng: 151.45, maxLng: 151.95, minLat: -33.15, maxLat: -32.65 },
  wollongong: { minLng: 150.75, maxLng: 151.05, minLat: -34.65, maxLat: -34.25 },
  gosford: { minLng: 151.2, maxLng: 151.45, minLat: -33.55, maxLat: -33.25 },
  'central coast': { minLng: 151.15, maxLng: 151.65, minLat: -33.65, maxLat: -33.1 },
  coffs: { minLng: 152.85, maxLng: 153.25, minLat: -30.55, maxLat: -30.1 },
  'coffs harbour': { minLng: 152.85, maxLng: 153.25, minLat: -30.55, maxLat: -30.1 },
  tweed: { minLng: 153.35, maxLng: 153.65, minLat: -28.35, maxLat: -28.1 },
  'tweed heads': { minLng: 153.35, maxLng: 153.65, minLat: -28.35, maxLat: -28.1 },
  byron: { minLng: 153.45, maxLng: 153.75, minLat: -28.8, maxLat: -28.45 },
  'byron bay': { minLng: 153.45, maxLng: 153.75, minLat: -28.8, maxLat: -28.45 },
  lismore: { minLng: 153.1, maxLng: 153.45, minLat: -28.95, maxLat: -28.65 },
  port: { minLng: 152.75, maxLng: 153.1, minLat: -31.65, maxLat: -31.25 },
  'port macquarie': { minLng: 152.75, maxLng: 153.1, minLat: -31.65, maxLat: -31.25 },
  tamworth: { minLng: 150.75, maxLng: 151.25, minLat: -31.35, maxLat: -30.85 },
  armidale: { minLng: 151.45, maxLng: 152.0, minLat: -30.8, maxLat: -30.3 },
  dubbo: { minLng: 148.25, maxLng: 148.9, minLat: -32.55, maxLat: -31.9 },
  orange: { minLng: 148.75, maxLng: 149.25, minLat: -33.55, maxLat: -33.1 },
  bathurst: { minLng: 149.35, maxLng: 150.0, minLat: -33.65, maxLat: -33.2 },
  wagga: { minLng: 147.1, maxLng: 147.75, minLat: -35.35, maxLat: -34.9 },
  'wagga wagga': { minLng: 147.1, maxLng: 147.75, minLat: -35.35, maxLat: -34.9 },
  albury: { minLng: 146.65, maxLng: 147.1, minLat: -36.25, maxLat: -35.85 },
};

function compactSpaces(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function websiteDomain(value: string): string {
  if (!value) return '';
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? '';
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#160;|&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function decodeCloudflareEmail(hex: string): string {
  const key = Number.parseInt(hex.slice(0, 2), 16);
  let output = '';
  for (let index = 2; index < hex.length; index += 2) {
    output += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16) ^ key);
  }
  return output;
}

function htmlToText(html: string): string {
  const withDecodedEmails = html.replace(/data-cfemail=["']([0-9a-f]+)["'][^>]*>\[email[^\]]*\]/gi, (_, hex) =>
    decodeCloudflareEmail(hex)
  );

  return decodeHtmlEntities(
    withDecodedEmails
      .replace(/<script[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '\n')
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '\n')
  )
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function extractInputValue(html: string, id: string): string {
  const idPattern = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`id=["']${idPattern}["'][^>]*value=["']([^"']*)["']`, 'i'));
  return decodeHtmlEntities(match?.[1] ?? '');
}

function getSetCookieHeaders(headers: Headers): string[] {
  const headerWithCookieApi = headers as Headers & { getSetCookie?: () => string[] };
  const values = headerWithCookieApi.getSetCookie?.();
  if (values?.length) return values;

  const combined = headers.get('set-cookie');
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g);
}

function cookieHeaderFromSetCookie(headers: Headers): string {
  return getSetCookieHeaders(headers)
    .map((value) => value.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

function jsonListValues<T = unknown>(value: unknown): T[] {
  const items = (value as { Items?: { $values?: T[] } } | null)?.Items?.$values;
  return Array.isArray(items) ? items : [];
}

function reinswProfileUrl(contactKey: string): string {
  return `${REINSW_API_ORIGIN}/Shared_Content/Smart-Suite/Smart-Maps/Public/Member-Profile?ContactKey=${encodeURIComponent(contactKey)}`;
}

function normalizePhone(value: string | null | undefined): string {
  return compactSpaces(value).replace('(0)', '0');
}

function normalizeEmail(value: string | null | undefined): string {
  const match = String(value ?? '').match(EMAIL_RE);
  return match?.[0]?.toLowerCase() ?? '';
}

function resolveLocationBounds(location: string | null | undefined) {
  const normalized = normalizeText(location ?? '');
  if (!normalized) return NSW_LOCATION_BOUNDS.nsw;

  const exact = NSW_LOCATION_BOUNDS[normalized];
  if (exact) return exact;

  const matchingKey = Object.keys(NSW_LOCATION_BOUNDS).find((key) => normalized.includes(key));
  return matchingKey ? NSW_LOCATION_BOUNDS[matchingKey] : NSW_LOCATION_BOUNDS.nsw;
}

function splitAustralianAddress(address: string): {
  streetAddress: string;
  suburbCity: string;
  state: string;
  postcode: string;
} {
  const lines = address
    .replace(/\r\n?/g, '\n')
    .replace(/\bAUSTRALIA\b/gi, '')
    .split('\n')
    .map(compactSpaces)
    .filter(Boolean);
  const joined = compactSpaces(lines.join(' '));
  const stateLine = lines.find((line) => /\b(NSW|QLD|VIC|SA|WA|TAS|ACT|NT)\s+\d{4}\b/i.test(line)) ?? joined;
  const match = stateLine.match(/^(.*?)(?:,\s*)?\b(NSW|QLD|VIC|SA|WA|TAS|ACT|NT)\s+(\d{4})\b/i);
  const state = match?.[2]?.toUpperCase() ?? '';
  const postcode = match?.[3] ?? '';
  const suburbCity = compactSpaces(match?.[1] ?? '').replace(/,$/, '');
  const stateLineIndex = lines.indexOf(stateLine);
  const streetLines = stateLineIndex > 0 ? lines.slice(0, stateLineIndex) : lines.filter((line) => line !== stateLine);

  return {
    streetAddress: compactSpaces(streetLines.join(' ')),
    suburbCity,
    state,
    postcode,
  };
}

function extractSectionValue(rawText: string, heading: string, stopHeadings: string[]): string {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim());
  const headingKey = heading.toLowerCase().replace(/:$/, '');
  const stop = new Set(stopHeadings.map((item) => item.toLowerCase().replace(/:$/, '')));

  for (let index = 0; index < lines.length; index += 1) {
    const lineKey = (lines[index] ?? '').toLowerCase().replace(/:$/, '');
    if (lineKey !== headingKey) continue;

    const values: string[] = [];
    for (const nextLine of lines.slice(index + 1)) {
      const nextKey = nextLine.toLowerCase().replace(/:$/, '');
      if (stop.has(nextKey)) break;
      if (nextLine) values.push(nextLine);
    }

    const value = compactSpaces(values.join(' '));
    if (value) return value;
  }

  return '';
}

async function fetchReinswSearchSession(): Promise<ReinswApiSession> {
  const response = await fetch(REINSW_SEARCH_URL, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': REINSW_USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`REINSW search page request failed (${response.status}).`);

  const html = await response.text();
  const requestVerificationToken = extractInputValue(html, '__RequestVerificationToken');
  const contentKey = extractInputValue(html, 'x-contentKey');
  const contentItemKey = extractInputValue(html, 'x-contentItemKey');
  const cookie = cookieHeaderFromSetCookie(response.headers);

  if (!requestVerificationToken || !contentKey || !contentItemKey || !cookie) {
    throw new Error('REINSW search page did not return the map session details.');
  }

  return { cookie, requestVerificationToken, contentKey, contentItemKey };
}

async function fetchReinswJson<T>(path: string, session: ReinswApiSession, params: Record<string, string>): Promise<T> {
  const url = new URL(path, REINSW_API_ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie: session.cookie,
      referer: REINSW_SEARCH_URL,
      requestverificationtoken: session.requestVerificationToken,
      'user-agent': REINSW_USER_AGENT,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`REINSW data request failed (${response.status})${text ? `: ${compactSpaces(text).slice(0, 180)}` : ''}`);
  }

  return response.json() as Promise<T>;
}

async function fetchReinswMapSettings(session: ReinswApiSession): Promise<ReinswMapSettings> {
  const payload = await fetchReinswJson<unknown>('/api/contentitem', session, {
    contentKey: session.contentKey,
    contentItemKey: session.contentItemKey,
  });
  const [contentItem] = jsonListValues<{ Data?: { Settings?: ReinswMapSettings } }>(payload);
  const settings = contentItem?.Data?.Settings;
  if (!settings?.mapsDataIqa) throw new Error('REINSW map settings did not include a lead query.');
  return settings;
}

async function fetchReinswMapItems(
  session: ReinswApiSession,
  queryName: string,
  bounds: ReturnType<typeof resolveLocationBounds>,
  options: ReinswScrapeOptions
): Promise<{ items: ReinswMapItem[]; queryCount: number }> {
  const maxPages = Math.max(1, options.maxPages ?? 10);
  const maxProfiles = Math.max(1, options.maxProfiles ?? 5000);
  const items: ReinswMapItem[] = [];
  let queryCount = 0;

  for (let pageIndex = 0; pageIndex < maxPages && items.length < maxProfiles; pageIndex += 1) {
    const limit = Math.min(REINSW_QUERY_PAGE_SIZE, maxProfiles - items.length);
    const payload = await fetchReinswJson<unknown>('/api/query', session, {
      queryname: queryName,
      Longitude: `between:"${bounds.minLng}""${bounds.maxLng}"`,
      Latitude: `between:"${bounds.minLat}""${bounds.maxLat}"`,
      limit: String(limit),
      offset: String(pageIndex * REINSW_QUERY_PAGE_SIZE),
    });
    queryCount += 1;

    const pageItems = jsonListValues<ReinswMapItem>(payload);
    items.push(...pageItems);

    const hasNext = Boolean((payload as { HasNext?: boolean } | null)?.HasNext);
    if (!hasNext || pageItems.length === 0) break;
  }

  return { items, queryCount };
}

async function collectProfileSeeds(options: ReinswScrapeOptions): Promise<{
  seeds: ReinswProfileSeed[];
  queryCount: number;
}> {
  const session = await fetchReinswSearchSession();
  const settings = await fetchReinswMapSettings(session);
  const bounds = resolveLocationBounds(options.location);
  const { items, queryCount } = await fetchReinswMapItems(session, settings.mapsDataIqa ?? '', bounds, options);
  const seen = new Set<string>();
  const seeds = items
    .filter((item) => compactSpaces(item.ContactKey))
    .map((item) => ({
      sourceUrl: reinswProfileUrl(compactSpaces(item.ContactKey)),
      mapItem: item,
    }))
    .filter((seed) => {
      if (seen.has(seed.sourceUrl)) return false;
      seen.add(seed.sourceUrl);
      return true;
    });

  return { seeds, queryCount };
}

async function extractProfile(seed: ReinswProfileSeed, searchLocation: string): Promise<ReiqLead> {
  const response = await fetch(seed.sourceUrl, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': REINSW_USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`REINSW profile request failed (${response.status}) for ${seed.sourceUrl}`);

  const rawText = htmlToText(await response.text());
  const pageText = compactSpaces(rawText);
  const mobilePhone = normalizePhone(extractSectionValue(rawText, 'Mobile', ['Phone', 'Email', 'Website', 'Realestate.com.au', 'Domain', 'Address']));
  const workPhone = normalizePhone(extractSectionValue(rawText, 'Phone', ['Mobile', 'Email', 'Website', 'Realestate.com.au', 'Domain', 'Address']));
  const email = normalizeEmail(extractSectionValue(rawText, 'Email', ['Website', 'Realestate.com.au', 'Domain', 'Address']) || pageText);
  const website = compactSpaces(extractSectionValue(rawText, 'Website', ['Realestate.com.au', 'Domain', 'Address']));
  const phones = Array.from(pageText.matchAll(PHONE_RE)).map((match) => normalizePhone(match[0]));
  const phone = mobilePhone || workPhone || phones.find(Boolean) || '';
  const address =
    String(seed.mapItem.LongLatAddress ?? '').trim() ||
    extractSectionValue(rawText, 'Address', ['Get Directions', 'Share this profile', 'Send an enquiry']);
  const addressParts = splitAustralianAddress(address);
  const name = compactSpaces(seed.mapItem.FullName) || 'REINSW lead';
  const agencyBusinessName = compactSpaces(seed.mapItem.Company);
  const role = compactSpaces(seed.mapItem.Title);

  return {
    placeId: `reinsw:${seed.sourceUrl}`,
    name,
    city: addressParts.suburbCity || searchLocation,
    industry: 'REINSW real estate',
    query: `REINSW member search ${searchLocation}`,
    formattedAddress: compactSpaces(
      [addressParts.streetAddress, addressParts.suburbCity, addressParts.state, addressParts.postcode]
        .filter(Boolean)
        .join(' ')
    ),
    primaryType: role || 'REINSW member agent',
    phone,
    website,
    websiteDomain: websiteDomain(website),
    googleMapsUrl: seed.sourceUrl,
    rating: null,
    userRatingCount: null,
    longitude: typeof seed.mapItem.Longitude === 'number' ? seed.mapItem.Longitude : null,
    latitude: typeof seed.mapItem.Latitude === 'number' ? seed.mapItem.Latitude : null,
    businessStatus: null,
    confidenceScore: email || phone ? 90 : 65,
    leadCategory: 'real_estate_individual_agent',
    evidenceSummary: [
      agencyBusinessName ? `Agency: ${agencyBusinessName}` : '',
      role ? `Role: ${role}` : '',
      email ? `Email: ${email}` : '',
      phone ? `Phone: ${phone}` : '',
    ].filter(Boolean).join(' | '),
    leadSource: 'places',
    email,
    sourceUrl: seed.sourceUrl,
    classification: 'individual_agent',
    mobilePhone,
    workPhone: workPhone || (mobilePhone ? '' : phone),
    agencyBusinessName,
    ...addressParts,
  };
}

function dedupeLeads(leads: ReiqLead[]): ReiqLead[] {
  const seen = new Set<string>();
  const output: ReiqLead[] = [];

  for (const lead of leads) {
    const key =
      lead.email?.toLowerCase() ||
      lead.phone?.replace(/\D/g, '') ||
      lead.sourceUrl ||
      `${normalizeText(lead.name)}|${normalizeText(lead.agencyBusinessName ?? '')}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(lead);
  }

  return output;
}

export async function scrapeReinswLeads(options: ReinswScrapeOptions): Promise<ReiqLeadSearchResult> {
  const startedAt = new Date().toISOString();
  const { seeds, queryCount } = await collectProfileSeeds(options);
  const limitedSeeds = options.maxProfiles ? seeds.slice(0, options.maxProfiles) : seeds;
  const leads: ReiqLead[] = [];
  const batchSize = 5;
  const delayMs = options.delayMs ?? 150;

  for (let index = 0; index < limitedSeeds.length; index += batchSize) {
    const batch = limitedSeeds.slice(index, index + batchSize);
    leads.push(...(await Promise.all(batch.map((seed) => extractProfile(seed, options.location)))));
    if (delayMs > 0 && index + batchSize < limitedSeeds.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  const prospects = dedupeLeads(leads);
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    queryCount,
    rawResultCount: leads.length,
    uniqueResultCount: prospects.length,
    prospects,
    profileUrls: seeds.map((seed) => seed.sourceUrl),
  };
}
