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
  maxPages?: number;
  maxProfiles?: number;
  delayMs?: number;
};

type BrowserPage = Awaited<ReturnType<Awaited<ReturnType<typeof import('playwright').chromium.launch>>['newPage']>>;

const PROFILE_URL_RE = /Agent-Profile\.aspx\?ContactKey=/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?61\s?)?(?:0)?(?:\d[\s().-]?){8,12}\d/g;
const POSTCODE_RE = /\b([A-Z]{2,3})\s+(\d{4})\b/;
const PERSON_NAME_RE = /^[A-Z][a-zA-Z'’.-]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,4}$/;
const TEAM_RE = /\b(team|group|partners|collective)\b/i;
const PROPERTY_MANAGEMENT_RE = /\b(property management|rentals?|tenanc(?:y|ies)|landlord|management rights|PM\b)\b/i;

function compactSpaces(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(url: string, baseUrl: string): string {
  const absolute = new URL(url, baseUrl);
  absolute.hash = '';
  return absolute.toString();
}

function normalizePhone(value: string | null | undefined): string {
  return compactSpaces(value).replace('(0)', '0');
}

function normalizeEmail(value: string | null | undefined): string {
  const match = String(value ?? '').match(EMAIL_RE);
  return match?.[0]?.toLowerCase() ?? '';
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

async function waitForPageSettle(page: BrowserPage): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
  } catch {
    // Some ASP.NET pages keep background requests open; a short settle wait is enough.
  }
  await page.waitForTimeout(750);
}

async function collectProfileLinks(page: BrowserPage, baseUrl: string): Promise<string[]> {
  const hrefs = await page.locator('a[href]').evaluateAll((links) =>
    links
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => /Agent-Profile\.aspx\?ContactKey=/i.test(href))
  );

  return Array.from(new Set(hrefs.map((href) => normalizeUrl(href, baseUrl)))).sort();
}

async function findNextHref(page: BrowserPage): Promise<string> {
  return page.evaluate(`
    (() => {
    const norm = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim().toLowerCase();
    for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
      const text = norm(anchor.textContent);
      const aria = norm(anchor.getAttribute('aria-label'));
      const title = norm(anchor.getAttribute('title'));
      const rel = norm(anchor.getAttribute('rel'));
      const href = anchor.getAttribute('href') ?? '';
      const isNext =
        rel.includes('next') ||
        text === 'next' ||
        text === '>' ||
        text === '›' ||
        aria.includes('next') ||
        title.includes('next');
      if (isNext && href && !href.startsWith('#') && !href.toLowerCase().startsWith('javascript:')) return href;
    }
    return '';
    })()
  `);
}

async function collectAllProfileUrls(page: BrowserPage, options: ReiqScrapeOptions): Promise<string[]> {
  if (PROFILE_URL_RE.test(options.startUrl)) return [normalizeUrl(options.startUrl, options.startUrl)];

  await page.goto(options.startUrl, { waitUntil: 'domcontentloaded' });
  await waitForPageSettle(page);

  const urls: string[] = [];
  const seenPages = new Set<string>();
  let pageIndex = 0;

  while (true) {
    pageIndex += 1;
    const currentUrl = page.url();
    if (seenPages.has(currentUrl)) break;
    seenPages.add(currentUrl);

    const links = await collectProfileLinks(page, currentUrl);
    for (const link of links) {
      if (!urls.includes(link)) urls.push(link);
    }

    if (options.maxPages && pageIndex >= options.maxPages) break;
    const nextHref = await findNextHref(page);
    if (!nextHref) break;

    await page.waitForTimeout(options.delayMs ?? 1000);
    await page.goto(normalizeUrl(nextHref, currentUrl), { waitUntil: 'domcontentloaded' });
    await waitForPageSettle(page);
  }

  return urls;
}

async function extractLabelMap(page: BrowserPage): Promise<Record<string, string>> {
  return page.evaluate(`
    (() => {
    const norm = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
    const labels = ['Work Phone', 'Mobile Phone', 'Email', 'Website', 'Member Since'];
    const output = {};

    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const text = norm(element.textContent);
      const cleanLabel = text.replace(/:$/, '');
      if (!labels.includes(cleanLabel) || output[cleanLabel]) continue;
      let sibling = element.nextElementSibling;
      while (sibling && !norm(sibling.textContent)) sibling = sibling.nextElementSibling;
      if (sibling) output[cleanLabel] = norm(sibling.textContent);
    }

    return output;
    })()
  `);
}

async function extractProfile(page: BrowserPage, sourceUrl: string): Promise<ReiqLead> {
  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
  await waitForPageSettle(page);

  const rawText = await page.locator('body').innerText({ timeout: 10_000 });
  const pageText = compactSpaces(rawText);
  const labelMap = await extractLabelMap(page);
  const heading = compactSpaces(await page.locator('h1').first().innerText({ timeout: 5000 }).catch(() => ''));

  let subheading = '';
  for (const selector of ['h5', '.panel-title', 'h2', 'h3']) {
    const locator = page.locator(selector);
    if ((await locator.count()) === 0) continue;
    const candidate = compactSpaces(await locator.first().innerText({ timeout: 3000 }).catch(() => ''));
    if (candidate) {
      subheading = candidate;
      break;
    }
  }

  const { fullName, agencyBusinessName } = splitNameAgency(heading, subheading);
  const email = normalizeEmail(labelMap.Email || extractLabeledValue(pageText, 'Email') || pageText);
  const website = compactSpaces(labelMap.Website || extractLabeledValue(pageText, 'Website'));
  let workPhone = normalizePhone(labelMap['Work Phone'] || extractLabeledValue(pageText, 'Work Phone'));
  let mobilePhone = normalizePhone(labelMap['Mobile Phone'] || extractLabeledValue(pageText, 'Mobile Phone'));

  const phones = Array.from(pageText.matchAll(PHONE_RE)).map((match) => normalizePhone(match[0]));
  if (!mobilePhone) mobilePhone = phones.find((phone) => phone.startsWith('04')) ?? '';
  if (!workPhone) workPhone = phones.find((phone) => !phone.startsWith('04')) ?? '';

  const address =
    extractSectionValue(rawText, 'Address', ['Other Information', 'ABN', 'Back to search', 'Need help', 'Contact']) ||
    extractLabeledValue(pageText, 'Address');
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
    latitude: null,
    longitude: null,
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
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
      viewport: { width: 1440, height: 1100 },
    });

    const profileUrls = await collectAllProfileUrls(page, options);
    const limitedUrls = options.maxProfiles ? profileUrls.slice(0, options.maxProfiles) : profileUrls;
    const leads: ReiqLead[] = [];

    for (const profileUrl of limitedUrls) {
      leads.push(await extractProfile(page, profileUrl));
      await page.waitForTimeout(options.delayMs ?? 1000);
    }

    const prospects = dedupeLeads(leads);
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      queryCount: Math.max(1, options.maxPages ?? 1),
      rawResultCount: leads.length,
      uniqueResultCount: prospects.length,
      prospects,
      profileUrls,
    };
  } finally {
    await browser.close();
  }
}
