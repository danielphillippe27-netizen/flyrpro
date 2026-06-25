import type { PlacesLead } from '@/lib/scraper/googlePlacesLeadSearch';

export type ReiqLeadClassification =
  | 'individual_agent'
  | 'team'
  | 'agency'
  | 'property_management';

export type ReiqLead = PlacesLead & {
  email?: string;
  sourceUrl?: string;
  classification?: ReiqLeadClassification;
  mobilePhone?: string;
  workPhone?: string;
  agencyBusinessName?: string;
  memberSinceDate?: string;
  streetAddress?: string;
  suburbCity?: string;
  state?: string;
  postcode?: string;
};

export type ReiqLeadSearchResult = {
  startedAt: string;
  completedAt: string;
  queryCount: number;
  rawResultCount: number;
  uniqueResultCount: number;
  prospects: ReiqLead[];
  profileUrls: string[];
};

type ReiqScrapeOptions = {
  startUrl: string;
  location?: string;
  maxPages?: number;
  maxProfiles?: number;
  delayMs?: number;
  excludeSourceUrls?: string[];
};

const PROFILE_URL_RE = /(?:Agent-Profile\.aspx|map-profile)\?ContactKey=/i;
const REIQ_SEARCH_URL =
  'https://members.reiq.com/REIQ/Shared_Content/Smart-Suite/Smart-Maps/Public/Find-an-Agent-and-Agency.aspx';
const REIQ_API_ORIGIN = 'https://members.reiq.com';
const REIQ_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36';
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?61\s?)?(?:0)?(?:\d[\s().-]?){8,12}\d/g;
const POSTCODE_RE = /\b([A-Z]{2,3})\s+(\d{4})\b/;
const PERSON_NAME_RE = /^[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,4}$/;
const TEAM_RE = /\b(team|group|partners|collective)\b/i;
const PROPERTY_MANAGEMENT_RE = /\b(property management|rentals?|tenanc(?:y|ies)|landlord|management rights|PM\b)\b/i;
const REIQ_QUERY_PAGE_SIZE = 500;
const REIQ_FETCH_TIMEOUT_MS = 15_000;
const REIQ_PROFILE_BATCH_SIZE = 12;

const AUSTRALIA_LOCATION_BOUNDS: Record<string, { minLng: number; maxLng: number; minLat: number; maxLat: number }> = {
  qld: { minLng: 137, maxLng: 154.2, minLat: -29.3, maxLat: -9 },
  queensland: { minLng: 137, maxLng: 154.2, minLat: -29.3, maxLat: -9 },
  brisbane: { minLng: 152.7, maxLng: 153.3, minLat: -27.8, maxLat: -27.1 },
  'gold coast': { minLng: 153.1, maxLng: 153.7, minLat: -28.3, maxLat: -27.7 },
  'sunshine coast': { minLng: 152.7, maxLng: 153.4, minLat: -27.1, maxLat: -26.3 },
  toowoomba: { minLng: 151.75, maxLng: 152.15, minLat: -27.75, maxLat: -27.35 },
  cairns: { minLng: 145.5, maxLng: 146.1, minLat: -17.2, maxLat: -16.6 },
  townsville: { minLng: 146.55, maxLng: 147.1, minLat: -19.55, maxLat: -18.95 },
  mackay: { minLng: 148.9, maxLng: 149.35, minLat: -21.35, maxLat: -20.95 },
  rockhampton: { minLng: 150.3, maxLng: 150.75, minLat: -23.6, maxLat: -23.1 },
  bundaberg: { minLng: 152.1, maxLng: 152.55, minLat: -24.95, maxLat: -24.65 },
  ipswich: { minLng: 152.55, maxLng: 153.0, minLat: -27.85, maxLat: -27.45 },
  logan: { minLng: 152.85, maxLng: 153.25, minLat: -27.85, maxLat: -27.55 },
};

type ReiqMapItem = {
  ContactKey?: string;
  FullName?: string;
  Company?: string;
  JobTitle?: string;
  Phone?: string;
  Email?: string;
  Website?: string;
  FullAddress?: string;
  LongLatAddress?: string;
  Latitude?: number;
  Longitude?: number;
  IsCompany?: boolean;
  [key: string]: unknown;
};

type ReiqProfileSeed = {
  sourceUrl: string;
  mapItem?: ReiqMapItem;
};

type ReiqApiSession = {
  cookie: string;
  requestVerificationToken: string;
  contentKey: string;
  contentItemKey: string;
};

type ReiqMapSettings = {
  mapsDataIqa?: string;
};

function compactSpaces(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(url: string, baseUrl: string): string {
  const absolute = new URL(url, baseUrl);
  absolute.hash = '';
  return absolute.toString();
}

function reiqProfileUrl(contactKey: string): string {
  return `https://members.reiq.com/map-profile?ContactKey=${encodeURIComponent(contactKey)}`;
}

function normalizePhone(value: string | null | undefined): string {
  return compactSpaces(value).replace('(0)', '0');
}

function normalizeEmail(value: string | null | undefined): string {
  const match = String(value ?? '').match(EMAIL_RE);
  return match?.[0]?.toLowerCase() ?? '';
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

function htmlToText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '\n')
      .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, '\n')
  )
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function websiteDomain(value: string): string {
  if (!value) return '';
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? '';
  }
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

async function fetchWithTimeout(url: string | URL, init: RequestInit = {}, timeoutMs = REIQ_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`REIQ request timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveLocationBounds(location: string | null | undefined) {
  const normalized = normalizeText(location ?? '');
  if (!normalized) return AUSTRALIA_LOCATION_BOUNDS.queensland;

  const exact = AUSTRALIA_LOCATION_BOUNDS[normalized];
  if (exact) return exact;

  const matchingKey = Object.keys(AUSTRALIA_LOCATION_BOUNDS).find((key) => normalized.includes(key));
  return matchingKey ? AUSTRALIA_LOCATION_BOUNDS[matchingKey] : AUSTRALIA_LOCATION_BOUNDS.queensland;
}

async function fetchReiqSearchSession(startUrl: string): Promise<ReiqApiSession> {
  const response = await fetchWithTimeout(PROFILE_URL_RE.test(startUrl) ? REIQ_SEARCH_URL : startUrl, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent': REIQ_USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`REIQ search page request failed (${response.status}).`);

  const html = await response.text();
  const requestVerificationToken = extractInputValue(html, '__RequestVerificationToken');
  const contentKey = extractInputValue(html, 'x-contentKey');
  const contentItemKey = extractInputValue(html, 'x-contentItemKey');
  const cookie = cookieHeaderFromSetCookie(response.headers);

  if (!requestVerificationToken || !contentKey || !contentItemKey || !cookie) {
    throw new Error('REIQ search page did not return the map session details.');
  }

  return { cookie, requestVerificationToken, contentKey, contentItemKey };
}

async function fetchReiqJson<T>(path: string, session: ReiqApiSession, params: Record<string, string>): Promise<T> {
  const url = new URL(path, REIQ_API_ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }

  const response = await fetchWithTimeout(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      cookie: session.cookie,
      referer: REIQ_SEARCH_URL,
      requestverificationtoken: session.requestVerificationToken,
      'user-agent': REIQ_USER_AGENT,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`REIQ data request failed (${response.status})${text ? `: ${compactSpaces(text).slice(0, 180)}` : ''}`);
  }

  return response.json() as Promise<T>;
}

async function fetchReiqMapSettings(session: ReiqApiSession): Promise<ReiqMapSettings> {
  const payload = await fetchReiqJson<unknown>('/api/contentitem', session, {
    contentKey: session.contentKey,
    contentItemKey: session.contentItemKey,
  });
  const [contentItem] = jsonListValues<{ Data?: { Settings?: ReiqMapSettings } }>(payload);
  const settings = contentItem?.Data?.Settings;
  if (!settings?.mapsDataIqa) throw new Error('REIQ map settings did not include a lead query.');
  return settings;
}

async function fetchReiqMapItems(
  session: ReiqApiSession,
  queryName: string,
  bounds: ReturnType<typeof resolveLocationBounds>,
  options: ReiqScrapeOptions
): Promise<{ items: ReiqMapItem[]; queryCount: number }> {
  const maxPages = Math.max(1, options.maxPages ?? 1);
  const maxProfiles = Math.max(1, options.maxProfiles ?? REIQ_QUERY_PAGE_SIZE);
  const excludedSourceUrls = new Set((options.excludeSourceUrls ?? []).map(compactSpaces).filter(Boolean));
  const items: ReiqMapItem[] = [];
  let queryCount = 0;

  for (let pageIndex = 0; pageIndex < maxPages && items.length < maxProfiles; pageIndex += 1) {
    const limit = excludedSourceUrls.size > 0 ? REIQ_QUERY_PAGE_SIZE : Math.min(REIQ_QUERY_PAGE_SIZE, maxProfiles - items.length);
    const payload = await fetchReiqJson<unknown>('/api/query', session, {
      queryname: queryName,
      Longitude: `between:"${bounds.minLng}""${bounds.maxLng}"`,
      Latitude: `between:"${bounds.minLat}""${bounds.maxLat}"`,
      limit: String(limit),
      offset: String(pageIndex * REIQ_QUERY_PAGE_SIZE),
    });
    queryCount += 1;

    const pageItems = jsonListValues<ReiqMapItem>(payload);
    for (const item of pageItems) {
      const contactKey = compactSpaces(item.ContactKey);
      if (!contactKey) continue;
      if (excludedSourceUrls.has(reiqProfileUrl(contactKey))) continue;
      items.push(item);
      if (items.length >= maxProfiles) break;
    }

    const hasNext = Boolean((payload as { HasNext?: boolean } | null)?.HasNext);
    if (!hasNext || pageItems.length === 0) break;
  }

  return { items, queryCount };
}

async function collectProfileSeedsWithReiqApi(options: ReiqScrapeOptions): Promise<{
  seeds: ReiqProfileSeed[];
  queryCount: number;
}> {
  if (PROFILE_URL_RE.test(options.startUrl)) {
    return { seeds: [{ sourceUrl: normalizeUrl(options.startUrl, options.startUrl) }], queryCount: 1 };
  }

  const session = await fetchReiqSearchSession(options.startUrl);
  const settings = await fetchReiqMapSettings(session);
  const bounds = resolveLocationBounds(options.location);
  const { items, queryCount } = await fetchReiqMapItems(session, settings.mapsDataIqa ?? '', bounds, options);
  const excludedSourceUrls = new Set((options.excludeSourceUrls ?? []).map(compactSpaces).filter(Boolean));
  const seen = new Set<string>();
  const seeds = items
    .filter((item) => compactSpaces(item.ContactKey))
    .map((item) => ({
      sourceUrl: reiqProfileUrl(compactSpaces(item.ContactKey)),
      mapItem: item,
    }))
    .filter((seed) => {
      if (excludedSourceUrls.has(seed.sourceUrl)) return false;
      if (seen.has(seed.sourceUrl)) return false;
      seen.add(seed.sourceUrl);
      return true;
    });

  return { seeds, queryCount };
}

function splitNameAgency(title: string, subheading: string): { fullName: string; agencyBusinessName: string } {
  if (!title) return { fullName: '', agencyBusinessName: subheading };

  if (title.includes(' - ')) {
    const [left, right] = title.split(' - ', 2).map(compactSpaces);
    return { fullName: left, agencyBusinessName: right || subheading };
  }

  if (title.toLowerCase().startsWith('contact individual:')) {
    return { fullName: compactSpaces(title.split(':').slice(1).join(':')), agencyBusinessName: subheading };
  }

  if (subheading.toLowerCase().startsWith('contact individual:')) {
    return { fullName: compactSpaces(subheading.split(':').slice(1).join(':')), agencyBusinessName: title };
  }

  if (PERSON_NAME_RE.test(title)) return { fullName: title, agencyBusinessName: subheading };
  return { fullName: '', agencyBusinessName: title };
}

function splitAddress(address: string): {
  streetAddress: string;
  suburbCity: string;
  state: string;
  postcode: string;
} {
  const clean = compactSpaces(address);
  const match = clean.match(POSTCODE_RE);
  if (!match?.index) {
    return { streetAddress: clean, suburbCity: '', state: '', postcode: '' };
  }

  const state = match[1] ?? '';
  const postcode = match[2] ?? '';
  const beforeState = compactSpaces(clean.slice(0, match.index));
  const streetWords = beforeState.split(' ').filter(Boolean);
  const suburbWords: string[] = [];

  while (streetWords.length > 0) {
    const word = streetWords[streetWords.length - 1] ?? '';
    if (word === word.toUpperCase() || (word.length <= 3 && /^[A-Z]/.test(word))) {
      suburbWords.unshift(streetWords.pop() ?? '');
    } else {
      break;
    }
  }

  if (suburbWords.length === 0 && streetWords.length > 0) {
    suburbWords.unshift(streetWords.pop() ?? '');
  }

  return {
    streetAddress: compactSpaces(streetWords.join(' ')),
    suburbCity: compactSpaces(suburbWords.join(' ')),
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

function extractLabeledValue(text: string, label: string): string {
  const labels = [
    'Work Phone',
    'Mobile Phone',
    'Email',
    'Website',
    'Address',
    'Member Since',
    'Areas of Practice',
    'Areas of interest',
    'ABN',
    'Back to search',
  ];
  const boundary = labels
    .filter((item) => item !== label)
    .map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const pattern = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(.*?)(?=\\b(?:${boundary}):|$)`, 'i');
  const match = text.match(pattern);
  return compactSpaces(match?.[1]);
}

function classifyLead(lead: Partial<ReiqLead>, pageText: string): ReiqLeadClassification {
  const text = [
    lead.name,
    lead.agencyBusinessName,
    lead.phone,
    lead.email,
    pageText,
  ].filter(Boolean).join(' ');

  if (PROPERTY_MANAGEMENT_RE.test(text)) return 'property_management';
  if (TEAM_RE.test(lead.name ?? '') || TEAM_RE.test(lead.agencyBusinessName ?? '')) return 'team';
  if (lead.name && (lead.mobilePhone || lead.email)) return 'individual_agent';
  if (lead.agencyBusinessName && lead.workPhone && !lead.mobilePhone) return 'agency';
  return lead.agencyBusinessName && !lead.name ? 'agency' : 'individual_agent';
}

function extractHeadingFromProfileText(rawText: string, mapItem?: ReiqMapItem): { heading: string; subheading: string } {
  const lines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => compactSpaces(line))
    .filter(Boolean);
  const contactIndex = lines.findIndex((line) => /^Contact Details$/i.test(line));
  const beforeContact = (contactIndex >= 0 ? lines.slice(0, contactIndex) : lines).filter(
    (line) =>
      !/^Back to search$/i.test(line) &&
      !/^Skip to main content$/i.test(line) &&
      !/^REIQ$/i.test(line) &&
      !/^Cart$/i.test(line) &&
      !/^Search$/i.test(line) &&
      !/^Sign in$/i.test(line) &&
      !/^Toggle navigation$/i.test(line)
  );
  const heading = compactSpaces(mapItem?.FullName) || beforeContact[beforeContact.length - 2] || beforeContact[beforeContact.length - 1] || '';
  const subheading = compactSpaces(mapItem?.Company) || beforeContact[beforeContact.length - 1] || '';
  return { heading, subheading: subheading === heading ? '' : subheading };
}

async function extractProfile(seed: ReiqProfileSeed): Promise<ReiqLead> {
  const sourceUrl = seed.sourceUrl;
  const response = await fetchWithTimeout(sourceUrl, {
    headers: {
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
    },
  });
  if (!response.ok) throw new Error(`REIQ profile request failed (${response.status}) for ${sourceUrl}`);

  const rawText = htmlToText(await response.text());
  const pageText = compactSpaces(rawText);
  const labelMap: Record<string, string> = {};
  const { heading, subheading } = extractHeadingFromProfileText(rawText, seed.mapItem);

  const { fullName, agencyBusinessName } = splitNameAgency(heading, subheading);
  const email = normalizeEmail(compactSpaces(seed.mapItem?.Email) || extractLabeledValue(pageText, 'Email') || pageText);
  const website = compactSpaces(seed.mapItem?.Website) || compactSpaces(labelMap.Website || extractLabeledValue(pageText, 'Website'));
  let workPhone = normalizePhone(seed.mapItem?.Phone as string | undefined) || normalizePhone(labelMap['Work Phone'] || extractLabeledValue(pageText, 'Work Phone'));
  let mobilePhone = normalizePhone(labelMap['Mobile Phone'] || extractLabeledValue(pageText, 'Mobile Phone'));

  const phones = Array.from(pageText.matchAll(PHONE_RE)).map((match) => normalizePhone(match[0]));
  if (!mobilePhone) mobilePhone = phones.find((phone) => phone.startsWith('04')) ?? '';
  if (!workPhone) workPhone = phones.find((phone) => !phone.startsWith('04')) ?? '';

  const address =
    extractSectionValue(rawText, 'Address', ['Other Information', 'ABN', 'Back to search', 'Need help', 'Contact']) ||
    extractLabeledValue(pageText, 'Address') ||
    compactSpaces(seed.mapItem?.FullAddress) ||
    compactSpaces(seed.mapItem?.LongLatAddress);
  const addressParts = splitAddress(address);
  const phone = mobilePhone || workPhone;
  const name = fullName || agencyBusinessName || 'REIQ lead';
  const classification = classifyLead(
    { name, agencyBusinessName, phone, email, mobilePhone, workPhone },
    pageText
  );

  return {
    placeId: `reiq:${sourceUrl}`,
    name,
    city: addressParts.suburbCity,
    industry: 'REIQ real estate',
    query: 'REIQ member search',
    formattedAddress: compactSpaces(
      [addressParts.streetAddress, addressParts.suburbCity, addressParts.state, addressParts.postcode]
        .filter(Boolean)
        .join(' ')
    ),
    primaryType: classification,
    phone,
    website,
    websiteDomain: websiteDomain(website),
    googleMapsUrl: sourceUrl,
    rating: null,
    userRatingCount: null,
    longitude: typeof seed.mapItem?.Longitude === 'number' ? seed.mapItem.Longitude : null,
    latitude: typeof seed.mapItem?.Latitude === 'number' ? seed.mapItem.Latitude : null,
    businessStatus: null,
    confidenceScore: email || mobilePhone ? 90 : phone ? 75 : 60,
    leadCategory:
      classification === 'team'
        ? 'real_estate_team'
        : classification === 'agency'
          ? 'real_estate_brokerage'
          : 'real_estate_individual_agent',
    evidenceSummary: [
      agencyBusinessName ? `Agency: ${agencyBusinessName}` : '',
      email ? `Email: ${email}` : '',
      mobilePhone ? `Mobile: ${mobilePhone}` : '',
      workPhone ? `Work: ${workPhone}` : '',
    ].filter(Boolean).join(' | '),
    leadSource: 'places',
    email,
    sourceUrl,
    classification,
    mobilePhone,
    workPhone,
    agencyBusinessName,
    memberSinceDate: compactSpaces(labelMap['Member Since'] || extractLabeledValue(pageText, 'Member Since')),
    ...addressParts,
  };
}

function dedupeLeads(leads: ReiqLead[]): ReiqLead[] {
  const seen = new Set<string>();
  const output: ReiqLead[] = [];

  for (const lead of leads) {
    const key =
      lead.email?.toLowerCase() ||
      lead.mobilePhone?.replace(/\D/g, '') ||
      `${normalizeText(lead.name)}|${normalizeText(lead.agencyBusinessName ?? '')}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(lead);
  }

  return output;
}

export async function scrapeReiqLeads(options: ReiqScrapeOptions): Promise<ReiqLeadSearchResult> {
  const startedAt = new Date().toISOString();
  const { seeds, queryCount } = await collectProfileSeedsWithReiqApi(options);
  const limitedSeeds = options.maxProfiles ? seeds.slice(0, options.maxProfiles) : seeds;
  const leads: ReiqLead[] = [];
  const batchSize = REIQ_PROFILE_BATCH_SIZE;
  const delayMs = options.delayMs ?? 250;

  for (let index = 0; index < limitedSeeds.length; index += batchSize) {
    const batch = limitedSeeds.slice(index, index + batchSize);
    const batchResults = await Promise.allSettled(batch.map((seed) => extractProfile(seed)));
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        leads.push(result.value);
      } else {
        console.warn('[reiqLeadSearch] profile scrape failed', result.reason);
      }
    }
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
