import type { PlacesLead } from '@/lib/scraper/googlePlacesLeadSearch';

export type RealtorCaLead = PlacesLead & {
  sourceUrl?: string;
  role?: string;
  office?: string;
  agencyBusinessName?: string;
  streetAddress?: string;
  suburbCity?: string;
  state?: string;
  postcode?: string;
  pageNumber?: number;
  pageIndex?: number;
};

export type RealtorCaLeadSearchResult = {
  startedAt: string;
  completedAt: string;
  queryCount: number;
  rawResultCount: number;
  uniqueResultCount: number;
  prospects: RealtorCaLead[];
  profileUrls: string[];
  startUrl: string;
};

type RealtorCaScrapeOptions = {
  city: string;
  provinceCode?: string;
  startUrl?: string;
  maxPages?: number;
  maxProfiles?: number;
  delayMs?: number;
};

type RawAgentCard = {
  href: string;
  text: string;
};

type BrowserPage = Awaited<ReturnType<Awaited<ReturnType<typeof import('playwright').chromium.launch>>['newPage']>>;

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const POSTCODE_RE = /\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/i;
const ROLE_RE = /\b(salesperson|broker|broker of record|associate broker|representative)\b/i;
const PROVINCE_NAMES: Record<string, string> = {
  ab: 'Alberta',
  bc: 'British Columbia',
  mb: 'Manitoba',
  nb: 'New Brunswick',
  nl: 'Newfoundland and Labrador',
  ns: 'Nova Scotia',
  nt: 'Northwest Territories',
  nu: 'Nunavut',
  on: 'Ontario',
  pe: 'Prince Edward Island',
  qc: 'Quebec',
  sk: 'Saskatchewan',
  yt: 'Yukon',
};

function compactSpaces(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function slugifyLocation(value: string): string {
  return normalizeText(value).replace(/\s+/g, '-');
}

function normalizePhone(value: string): string {
  const match = value.match(PHONE_RE);
  return compactSpaces(match?.[0]);
}

function splitAddress(address: string): {
  streetAddress: string;
  suburbCity: string;
  state: string;
  postcode: string;
} {
  const clean = compactSpaces(address);
  const postcodeMatch = clean.match(POSTCODE_RE);
  const postcode = postcodeMatch ? `${postcodeMatch[1]?.toUpperCase()} ${postcodeMatch[2]?.toUpperCase()}` : '';
  const withoutPostcode = postcodeMatch?.index !== undefined
    ? compactSpaces(clean.slice(0, postcodeMatch.index))
    : clean;
  const parts = withoutPostcode.split(',').map(compactSpaces).filter(Boolean);
  const statePart = parts.at(-1) ?? '';
  const suburbPart = parts.length >= 2 ? parts.at(-2) ?? '' : '';
  const streetAddress = parts.length >= 3 ? parts.slice(0, -2).join(', ') : parts[0] ?? clean;

  return {
    streetAddress,
    suburbCity: suburbPart,
    state: statePart,
    postcode,
  };
}

function parseSlugFallback(url: string): { name: string; address: string } {
  const path = new URL(url).pathname;
  const slug = decodeURIComponent(path.split('/').filter(Boolean).at(-1) ?? '');
  const parts = slug.split('-').filter(Boolean);
  const provinceIndex = parts.findIndex((part) => Object.values(PROVINCE_NAMES).some((name) => normalizeText(name).split(' ')[0] === normalizeText(part)));
  const nameParts = provinceIndex > 2 ? parts.slice(0, Math.max(2, provinceIndex - 4)) : parts.slice(0, 2);
  return {
    name: nameParts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' '),
    address: parts.slice(nameParts.length).join(' '),
  };
}

function parseAgentCard(card: RawAgentCard, pageNumber: number, pageIndex: number, requestedCity: string): RealtorCaLead {
  const lines = card.text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(compactSpaces)
    .filter(Boolean)
    .filter((line) => !['Email', 'REALTOR® Website', 'Website'].includes(line));
  const fallback = parseSlugFallback(card.href);
  const phone = normalizePhone(card.text);
  const name = compactSpaces(lines[0]) || fallback.name || 'REALTOR.ca agent';
  const roleIndex = lines.findIndex((line) => ROLE_RE.test(line));
  const role = roleIndex >= 0 ? lines[roleIndex] ?? '' : '';
  const brokerageIndex = lines.findIndex((line) => /^brokerage$/i.test(line));
  const office = brokerageIndex > 0
    ? compactSpaces(lines.slice(roleIndex >= 0 ? roleIndex + 1 : 1, brokerageIndex).join(' '))
    : compactSpaces(lines[roleIndex >= 0 ? roleIndex + 1 : 1]);
  const addressLine = brokerageIndex >= 0
    ? compactSpaces(lines[brokerageIndex + 1])
    : lines.find((line) => POSTCODE_RE.test(line)) ?? fallback.address;
  const addressParts = splitAddress(addressLine);
  const city = addressParts.suburbCity || requestedCity;

  return {
    placeId: `realtor-ca:${card.href}`,
    name,
    city,
    industry: 'REALTOR.ca real estate agent',
    query: 'REALTOR.ca agent directory',
    formattedAddress: addressLine,
    primaryType: role || 'REALTOR.ca agent',
    phone,
    website: '',
    websiteDomain: '',
    googleMapsUrl: '',
    rating: null,
    userRatingCount: null,
    latitude: null,
    longitude: null,
    businessStatus: null,
    confidenceScore: phone ? 85 : 65,
    leadCategory: 'real_estate_individual_agent',
    evidenceSummary: [office ? `Office: ${office}` : '', role ? `Role: ${role}` : ''].filter(Boolean).join(' | '),
    leadSource: 'places',
    sourceUrl: card.href,
    role,
    office,
    agencyBusinessName: office,
    pageNumber,
    pageIndex,
    ...addressParts,
  };
}

async function waitForPageSettle(page: BrowserPage): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
  } catch {
    // REALTOR.ca can keep analytics requests open; card DOM is still usable after timeout.
  }
  await page.waitForTimeout(1500);
}

async function dismissCookies(page: BrowserPage): Promise<void> {
  const dismiss = page.getByRole('button', { name: /^dismiss$/i });
  if ((await dismiss.count()) === 0) return;
  await dismiss.first().click({ timeout: 3000 }).catch(() => undefined);
}

async function assertNotBlocked(page: BrowserPage): Promise<void> {
  const content = await page.content().catch(() => '');
  if (/Incapsula|Request unsuccessful|_Incapsula_Resource/i.test(content)) {
    throw new Error(
      'REALTOR.ca blocked the browser session with its anti-bot protection. Try again later, reduce page/profile limits, or run from a logged-in/normal browser session.'
    );
  }
}

async function waitForAgentCards(page: BrowserPage): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await assertNotBlocked(page);
    const count = await page.locator('a[href*="/agent/"]').count().catch(() => 0);
    if (count > 0) return;
    await page.waitForTimeout(1000);
  }
}

async function extractAgentCards(page: BrowserPage): Promise<RawAgentCard[]> {
  return page.evaluate(`
    (() => {
      const compact = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const agentLinks = Array.from(document.querySelectorAll('a[href*="/agent/"]'));
      const byHref = new Map();
      for (const link of agentLinks) {
        const href = link.href;
        if (!/\\/agent\\/\\d+\\//i.test(href)) continue;
        let bestText = compact(link.innerText || link.textContent);
        let element = link;
        for (let depth = 0; depth < 8 && element; depth += 1) {
          const text = compact(element.innerText || element.textContent);
          const hasPhone = /(?:\\+?1[\\s.-]?)?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}/.test(text);
          const hasRole = /\\b(salesperson|broker|representative)\\b/i.test(text);
          if (hasPhone && hasRole && text.length < 1500) {
            bestText = text;
            break;
          }
          element = element.parentElement;
        }
        const current = byHref.get(href);
        if (!current || bestText.length > current.text.length) byHref.set(href, { href, text: bestText });
      }
      return Array.from(byHref.values());
    })()
  `);
}

async function goToNextPage(page: BrowserPage, delayMs: number): Promise<boolean> {
  const beforeText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
  const next = page.locator('[aria-label="Go to the next page"]').first();
  if ((await next.count()) === 0) return false;

  await page.waitForTimeout(delayMs);
  await next.click({ timeout: 5000 }).catch(async () => {
    await page.evaluate(() => {
      const nextLink = document.querySelector('[aria-label="Go to the next page"]') as HTMLElement | null;
      nextLink?.click();
    });
  });
  await waitForPageSettle(page);
  const afterText = await page.locator('body').innerText({ timeout: 10_000 }).catch(() => '');
  return compactSpaces(beforeText) !== compactSpaces(afterText);
}

function dedupeLeads(leads: RealtorCaLead[]): RealtorCaLead[] {
  const seen = new Set<string>();
  const output: RealtorCaLead[] = [];

  for (const lead of leads) {
    const key = lead.phone?.replace(/\D/g, '') || `${normalizeText(lead.name)}|${normalizeText(lead.office ?? '')}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(lead);
  }

  return output;
}

export function buildRealtorCaUrl(city: string, provinceCode = 'on'): string {
  return `https://www.realtor.ca/realtors/${provinceCode.toLowerCase()}/${slugifyLocation(city)}`;
}

export async function scrapeRealtorCaLeads(options: RealtorCaScrapeOptions): Promise<RealtorCaLeadSearchResult> {
  const startedAt = new Date().toISOString();
  const provinceCode = (options.provinceCode || 'on').toLowerCase();
  const startUrl = options.startUrl || buildRealtorCaUrl(options.city, provinceCode);
  const maxPages = options.maxPages ?? 1;
  const maxProfiles = options.maxProfiles ?? 100;
  const delayMs = options.delayMs ?? 1500;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
      viewport: { width: 1440, height: 1100 },
    });

    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await waitForPageSettle(page);
    await dismissCookies(page);
    await waitForAgentCards(page);

    const leads: RealtorCaLead[] = [];
    let pageNumber = 1;

    while (pageNumber <= maxPages && leads.length < maxProfiles) {
      const cards = await extractAgentCards(page);
      cards.forEach((card, index) => {
        if (leads.length < maxProfiles) {
          leads.push(parseAgentCard(card, pageNumber, index + 1, options.city));
        }
      });

      if (pageNumber >= maxPages || leads.length >= maxProfiles) break;
      const moved = await goToNextPage(page, delayMs);
      if (!moved) break;
      await waitForAgentCards(page);
      pageNumber += 1;
    }

    const prospects = dedupeLeads(leads).slice(0, maxProfiles);
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      queryCount: pageNumber,
      rawResultCount: leads.length,
      uniqueResultCount: prospects.length,
      prospects,
      profileUrls: prospects.map((lead) => lead.sourceUrl).filter(Boolean) as string[],
      startUrl,
    };
  } finally {
    await browser.close();
  }
}
