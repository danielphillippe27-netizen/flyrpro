import { normalizeText, type PlacesCompanyJobSignal } from '@/lib/scraper/googlePlacesLeadSearch';
import { JSDOM } from 'jsdom';

type SearchProviderName = 'indeed' | 'serper' | 'google_cse' | 'tavily';

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: 'LinkedIn' | 'Indeed' | 'Web';
  query: string;
};

export type D2DJobSignalSearchResult = {
  provider: SearchProviderName;
  queries: string[];
  rawResultCount: number;
  signals: PlacesCompanyJobSignal[];
};

export type D2DJobSignalSearchOptions = {
  city: string;
  region?: string;
  countryCode?: string;
  industry: string;
  limit?: number;
};

const DOOR_KNOCK_ROLE_TERMS = [
  'door to door sales',
  'canvasser',
  'field canvasser',
  'outside sales representative',
  'territory sales representative',
  'field sales representative',
  'direct sales representative',
];

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sourceFromUrl(url: string): SearchResult['source'] {
  const normalized = url.toLowerCase();
  if (normalized.includes('linkedin.com/jobs')) return 'LinkedIn';
  if (normalized.includes('indeed.')) return 'Indeed';
  return 'Web';
}

function industrySearchTerms(industry: string): string[] {
  const normalized = normalizeText(industry);
  if (normalized.includes('real estate')) return ['real estate', 'realtor'];
  if (normalized.includes('roof')) return ['roofing'];
  if (normalized.includes('solar')) return ['solar'];
  if (normalized.includes('security')) return ['security systems', 'alarm'];
  if (normalized.includes('pest')) return ['pest control'];
  if (normalized.includes('internet')) return ['internet', 'telecom'];
  if (normalized.includes('lawn')) return ['lawn care'];
  if (normalized.includes('landscap')) return ['landscaping'];
  if (normalized.includes('driveway') || normalized.includes('paving')) return ['driveway sealing', 'paving'];
  if (normalized.includes('window')) return ['windows doors'];
  if (normalized.includes('paint')) return ['painting'];
  if (normalized.includes('hvac')) return ['HVAC'];
  return [industry];
}

function indeedHost(countryCode: string | undefined): string {
  const country = countryCode?.trim().toUpperCase();
  if (country === 'CA') return 'ca.indeed.com';
  if (country === 'AU') return 'au.indeed.com';
  if (country === 'NZ') return 'nz.indeed.com';
  return 'www.indeed.com';
}

function buildIndeedSearchUrl(query: string, options: D2DJobSignalSearchOptions): string {
  const url = new URL(`https://${indeedHost(options.countryCode)}/jobs`);
  url.searchParams.set('q', query);
  url.searchParams.set('l', [options.city, options.region].filter(Boolean).join(', '));
  url.searchParams.set('fromage', '14');
  url.searchParams.set('sort', 'date');
  return url.toString();
}

function buildQueries(options: D2DJobSignalSearchOptions): string[] {
  const location = [options.city, options.region].filter(Boolean).join(' ');
  const industryTerms = industrySearchTerms(options.industry);
  const roleTerms = DOOR_KNOCK_ROLE_TERMS.slice(0, 5);
  const queries: string[] = [];

  for (const industryTerm of industryTerms.slice(0, 2)) {
    for (const roleTerm of roleTerms) {
      queries.push(`${industryTerm} ${roleTerm} ${location}`.trim());
    }
  }

  return queries.slice(0, 12);
}

export function getD2DJobSignalProvider(): SearchProviderName | null {
  return 'indeed';
}

function textFromElement(element: Element | null | undefined): string {
  return cleanText(element?.textContent ?? '');
}

function absoluteIndeedUrl(value: string, options: D2DJobSignalSearchOptions): string {
  if (!value) return '';
  try {
    return new URL(value, `https://${indeedHost(options.countryCode)}`).toString();
  } catch {
    return '';
  }
}

function parseIndeedCards(html: string, query: string, options: D2DJobSignalSearchOptions): SearchResult[] {
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const cards = Array.from(document.querySelectorAll('[data-jk], .job_seen_beacon, td.resultContent')) as Element[];
  const results = new Map<string, SearchResult>();

  for (const card of cards) {
    const titleElement =
      card.querySelector('[data-testid="jobTitle"]') ??
      card.querySelector('.jcs-JobTitle span[title]') ??
      card.querySelector('h2.jobTitle span') ??
      card.querySelector('a[aria-label]');
    const linkElement = card.querySelector('a[data-jk], a.jcs-JobTitle, a[href*="/viewjob"]') as HTMLAnchorElement | null;
    const companyElement =
      card.querySelector('[data-testid="company-name"]') ??
      card.querySelector('[data-testid="companyName"]') ??
      card.querySelector('.companyName') ??
      card.querySelector('[data-company-name]');
    const locationElement =
      card.querySelector('[data-testid="text-location"]') ??
      card.querySelector('.companyLocation');

    const title = textFromElement(titleElement) || cleanText(titleElement?.getAttribute('title') ?? '');
    const company = textFromElement(companyElement);
    const location = textFromElement(locationElement);
    const href = linkElement?.getAttribute('href') ?? '';
    const dataJk = card.getAttribute('data-jk') ?? linkElement?.getAttribute('data-jk') ?? '';
    const url = absoluteIndeedUrl(href || (dataJk ? `/viewjob?jk=${encodeURIComponent(dataJk)}` : ''), options);

    if (!title || !company || !url) continue;

    const key = url.split('?')[0] + (dataJk || title);
    results.set(key, {
      title,
      url,
      snippet: [company, location].filter(Boolean).join(' - '),
      source: 'Indeed',
      query,
    });
  }

  return Array.from(results.values());
}

async function callIndeed(query: string, options: D2DJobSignalSearchOptions): Promise<SearchResult[]> {
  const url = buildIndeedSearchUrl(query, options);
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const html = await response.text();
  const normalizedHtml = html.toLowerCase();

  if (response.status === 403 || normalizedHtml.includes('security check - indeed.com')) {
    throw new Error('Indeed blocked the scrape with a security check. Try again later or run from a browser-backed worker.');
  }

  if (!response.ok) {
    throw new Error(`Indeed scrape failed with ${response.status}.`);
  }

  return parseIndeedCards(html, query, options);
}

async function callSerper(query: string): Promise<SearchResult[]> {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': process.env.SERPER_API_KEY?.trim() ?? '',
    },
    body: JSON.stringify({ q: query, num: 10 }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    organic?: Array<{ title?: string; link?: string; snippet?: string }>;
    message?: string;
  };

  if (!response.ok) {
    throw new Error(payload.message || `Serper job search failed with ${response.status}.`);
  }

  return (payload.organic ?? []).flatMap((item) => {
    const url = item.link?.trim() ?? '';
    if (!url) return [];
    return [{
      title: cleanText(item.title ?? ''),
      url,
      snippet: cleanText(item.snippet ?? ''),
      source: sourceFromUrl(url),
      query,
    }];
  });
}

async function callGoogleCse(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || '';
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID?.trim() ?? '';
  const url = new URL('https://customsearch.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', searchEngineId);
  url.searchParams.set('q', query);
  url.searchParams.set('num', '10');

  const response = await fetch(url);
  const payload = (await response.json().catch(() => ({}))) as {
    items?: Array<{ title?: string; link?: string; snippet?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `Google job search failed with ${response.status}.`);
  }

  return (payload.items ?? []).flatMap((item) => {
    const url = item.link?.trim() ?? '';
    if (!url) return [];
    return [{
      title: cleanText(item.title ?? ''),
      url,
      snippet: cleanText(item.snippet ?? ''),
      source: sourceFromUrl(url),
      query,
    }];
  });
}

async function callTavily(query: string): Promise<SearchResult[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY?.trim(),
      query,
      search_depth: 'basic',
      max_results: 10,
      include_answer: false,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error || `Tavily job search failed with ${response.status}.`);
  }

  return (payload.results ?? []).flatMap((item) => {
    const url = item.url?.trim() ?? '';
    if (!url) return [];
    return [{
      title: cleanText(item.title ?? ''),
      url,
      snippet: cleanText(item.content ?? ''),
      source: sourceFromUrl(url),
      query,
    }];
  });
}

async function callProvider(provider: SearchProviderName, query: string): Promise<SearchResult[]> {
  if (provider === 'indeed') throw new Error('Indeed direct scrape requires search options.');
  if (provider === 'serper') return callSerper(query);
  if (provider === 'google_cse') return callGoogleCse(query);
  return callTavily(query);
}

function looksLikeJobPosting(result: SearchResult): boolean {
  const haystack = normalizeText(`${result.title} ${result.snippet} ${result.url}`);
  return (
    (result.source === 'LinkedIn' || result.source === 'Indeed') &&
    DOOR_KNOCK_ROLE_TERMS.some((term) => haystack.includes(normalizeText(term))) &&
    !haystack.includes('salary search') &&
    !haystack.includes('resume')
  );
}

function cleanCompanyCandidate(value: string): string {
  return cleanText(value)
    .replace(/\s*\|\s*(LinkedIn|Indeed).*$/i, '')
    .replace(/\s*-\s*(LinkedIn|Indeed).*$/i, '')
    .replace(/\s+careers?$/i, '')
    .replace(/^jobs?\s+at\s+/i, '')
    .replace(/\s+jobs?$/i, '')
    .trim();
}

function isBadCompanyCandidate(value: string): boolean {
  const normalized = normalizeText(value);
  if (value.length < 2 || value.length > 80) return true;
  return [
    'door to door',
    'outside sales',
    'field sales',
    'canvasser',
    'sales representative',
    'jobs',
    'employment',
    'hiring',
    'linkedin',
    'indeed',
  ].some((bad) => normalized === bad || normalized.includes(`${bad} in `));
}

function extractCompanyName(result: SearchResult): string {
  const title = cleanCompanyCandidate(result.title);
  const snippet = cleanCompanyCandidate(result.snippet);
  if (result.source === 'Indeed') {
    const companyFromSnippet = cleanCompanyCandidate(snippet.split(' - ')[0] ?? '');
    if (!isBadCompanyCandidate(companyFromSnippet)) return companyFromSnippet;
  }

  const linkedInHiring = title.match(/^(.+?)\s+hiring\s+.+?\s+in\s+/i);
  if (linkedInHiring?.[1] && !isBadCompanyCandidate(linkedInHiring[1])) return cleanCompanyCandidate(linkedInHiring[1]);

  const atMatch = title.match(/\bat\s+([^|-]+)/i);
  if (atMatch?.[1] && !isBadCompanyCandidate(atMatch[1])) return cleanCompanyCandidate(atMatch[1]);

  const segments = title
    .split(/\s[-|]\s/)
    .map(cleanCompanyCandidate)
    .filter((segment) => segment && !isBadCompanyCandidate(segment));
  if (segments.length > 0) return segments[segments.length - 1];

  const snippetAtMatch = snippet.match(/\bat\s+([^,.|-]+)/i);
  if (snippetAtMatch?.[1] && !isBadCompanyCandidate(snippetAtMatch[1])) return cleanCompanyCandidate(snippetAtMatch[1]);

  return '';
}

function scoreSignal(result: SearchResult, company: string, options: D2DJobSignalSearchOptions): number {
  const haystack = normalizeText(`${result.title} ${result.snippet}`);
  let score = 35;

  if (result.source === 'LinkedIn') score += 12;
  if (result.source === 'Indeed') score += 10;
  if (company) score += 20;
  if (DOOR_KNOCK_ROLE_TERMS.some((term) => haystack.includes(normalizeText(term)))) score += 25;
  if (industrySearchTerms(options.industry).some((term) => haystack.includes(normalizeText(term)))) score += 10;
  if (haystack.includes(normalizeText(options.city))) score += 8;
  if (options.region && haystack.includes(normalizeText(options.region))) score += 4;

  return Math.max(0, Math.min(100, score));
}

export async function searchD2DJobSignals(options: D2DJobSignalSearchOptions): Promise<D2DJobSignalSearchResult> {
  const provider = getD2DJobSignalProvider();
  if (!provider) {
    throw new Error('D2D job signal search is not configured.');
  }

  const queries = buildQueries(options);
  const resultByUrl = new Map<string, SearchResult>();

  for (const query of queries) {
    const results = provider === 'indeed'
      ? await callIndeed(query, options)
      : await callProvider(provider, query);
    for (const result of results) {
      const urlKey = result.url.split('?')[0].replace(/\/$/, '');
      if (!urlKey || resultByUrl.has(urlKey) || !looksLikeJobPosting(result)) continue;
      resultByUrl.set(urlKey, result);
    }
  }

  const signalByCompany = new Map<string, PlacesCompanyJobSignal>();
  for (const result of resultByUrl.values()) {
    const company = extractCompanyName(result);
    if (!company) continue;
    const score = scoreSignal(result, company, options);
    const key = normalizeText(company);
    const nextSignal: PlacesCompanyJobSignal = {
      company,
      title: result.title,
      source: result.source,
      url: result.url,
      snippet: result.snippet,
      query: result.query,
      score,
    };
    const existing = signalByCompany.get(key);
    if (!existing || nextSignal.score > existing.score) signalByCompany.set(key, nextSignal);
  }

  const limit = Math.max(1, Math.min(20, options.limit ?? 12));
  return {
    provider,
    queries,
    rawResultCount: resultByUrl.size,
    signals: Array.from(signalByCompany.values()).sort((a, b) => b.score - a.score).slice(0, limit),
  };
}
