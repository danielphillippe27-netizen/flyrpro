'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Copy,
  Download,
  ExternalLink,
  FileImage,
  Globe2,
  ListChecks,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Search,
  Settings2,
  Star,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PlacesLead } from '@/lib/scraper/googlePlacesLeadSearch';
import {
  MapboxAutocompleteService,
  type CitySuggestion,
} from '@/lib/services/MapboxAutocompleteService';
import { useWorkspace } from '@/lib/workspace-context';

type PlacesLeadPayload = {
  ok?: boolean;
  startedAt?: string;
  completedAt?: string;
  queryCount?: number;
  rawResultCount?: number;
  uniqueResultCount?: number;
  jobSignalCount?: number;
  jobSignalRawCount?: number;
  jobSignalProvider?: string | null;
  leadSource?: 'places' | 'job_signals' | 'australia_reiq' | 'realtor_ca' | 'realtor_ca_browser_capture' | 'realtor_ca_screenshot';
  prospects?: LeadResult[];
  profileUrls?: string[];
  screenshotCount?: number;
  screenshotNames?: string[];
  savedList?: {
    listId: string | null;
    listName: string;
    contactIds: string[];
    contactCount: number;
    dialerLeadIds: string[];
    dialerImportedCount: number;
    dialerSkippedCount: number;
    masterAddedCount: number;
    masterSkippedCount: number;
    warning: string | null;
  } | null;
  error?: string;
};

type ScraperMode = 'google_places' | 'australia_reiq' | 'realtor_ca' | 'realtor_ca_screenshot';

type LeadResult = PlacesLead & {
  email?: string;
  sourceUrl?: string;
  classification?: string;
  mobilePhone?: string;
  workPhone?: string;
  agencyBusinessName?: string;
  memberSinceDate?: string;
  role?: string;
  office?: string;
  streetAddress?: string;
  suburbCity?: string;
  state?: string;
  postcode?: string;
};

type BrowserCaptureLead = {
  name?: unknown;
  role?: unknown;
  office?: unknown;
  brokerage?: unknown;
  phone?: unknown;
  mobilePhone?: unknown;
  workPhone?: unknown;
  address?: unknown;
  profileUrl?: unknown;
  sourceUrl?: unknown;
  pageUrl?: unknown;
  capturedAt?: unknown;
};

type BrowserCapturePayload = {
  source?: unknown;
  mode?: unknown;
  city?: unknown;
  provinceCode?: unknown;
  pageUrl?: unknown;
  capturedAt?: unknown;
  leads?: BrowserCaptureLead[];
};

type MetricCardProps = {
  label: string;
  value: string;
};

type ProspectMarket = {
  id: string;
  country_code: string;
  region: string;
  city: string;
  label: string;
  priority: number;
};

type ProspectIndustry = {
  id: string;
  name: string;
  slug: string;
  default_terms: string[];
  priority: number;
};

type ProspectSearchRun = {
  id: string;
  market_id: string | null;
  industry_id: string | null;
  city: string;
  region: string | null;
  country_code: string;
  industry: string;
  raw_count: number;
  unique_count: number;
  saved_count: number;
  dialer_count: number;
  status: string;
  completed_at: string | null;
  created_at: string;
};

type ProspectingOptionsPayload = {
  workspaceId?: string | null;
  markets?: ProspectMarket[];
  industries?: ProspectIndustry[];
  recentRuns?: ProspectSearchRun[];
  jobSignals?: {
    configured?: boolean;
    provider?: string | null;
  };
  error?: string;
};

type RealEstateTarget = 'agents' | 'individual_agents' | 'teams' | 'brokerages';
type LeadIntent =
  | 'generic'
  | 'real_estate_agents'
  | 'real_estate_individual_agents'
  | 'real_estate_teams'
  | 'real_estate_brokerages';

const countryOptions = [
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
  { value: 'NZ', label: 'New Zealand' },
];

const REIQ_DEFAULT_SEARCH_URL =
  'https://members.reiq.com/REIQ/Shared_Content/Smart-Suite/Smart-Maps/Public/Find-an-Agent-and-Agency.aspx';
const REIQ_PROFILE_URL_RE = /(?:Agent-Profile\.aspx|map-profile)\?ContactKey=/i;

const canadianProvinceOptions = [
  { value: 'on', label: 'Ontario' },
  { value: 'bc', label: 'British Columbia' },
  { value: 'ab', label: 'Alberta' },
  { value: 'mb', label: 'Manitoba' },
  { value: 'sk', label: 'Saskatchewan' },
  { value: 'qc', label: 'Quebec' },
  { value: 'nb', label: 'New Brunswick' },
  { value: 'ns', label: 'Nova Scotia' },
  { value: 'nl', label: 'Newfoundland and Labrador' },
  { value: 'pe', label: 'Prince Edward Island' },
];

function normalizeInput(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const canadianProvinceByRegion = new Map(
  canadianProvinceOptions.flatMap((option) => [
    [normalizeInput(option.label), option.value],
    [option.value, option.value],
  ])
);

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const PHONE_GLOBAL_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
const POSTCODE_RE = /\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/i;
const REALTOR_ROLE_ONLY_RE = /^(salesperson|sales representative|broker of record|associate broker|broker|representative|realtor)$/i;

function isRealEstateIndustry(value: string): boolean {
  const normalized = normalizeInput(value);
  return (
    normalized.includes('real estate') ||
    normalized.includes('realtor') ||
    normalized.includes('brokerage') ||
    normalized.includes('property agent')
  );
}

function uniqueTerms(terms: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const term of terms) {
    const clean = term.trim();
    const key = normalizeInput(clean);
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }

  return output;
}

function filterIndividualAgentTerms(terms: string[]): string[] {
  return terms.filter((term) => {
    const normalized = normalizeInput(term);
    return !['team', 'group', 'collective', 'associates', 'partners', 'brokerage', 'office'].some((signal) =>
      normalized.includes(signal)
    );
  });
}

function leadIntentLabel(leadIntent: LeadIntent): string {
  if (leadIntent === 'real_estate_teams') return 'team leads';
  if (leadIntent === 'real_estate_brokerages') return 'brokerage leads';
  if (leadIntent === 'real_estate_individual_agents') return 'individual agent leads';
  if (leadIntent === 'real_estate_agents') return 'agent leads';
  return 'leads';
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildPlacesCsv(prospects: LeadResult[]): string {
  const headers = [
    'place_id',
    'name',
    'email',
    'city',
    'industry',
    'phone',
    'mobile_phone',
    'work_phone',
    'website',
    'website_domain',
    'address',
    'street_address',
    'suburb_city',
    'state',
    'postcode',
    'google_maps_url',
    'source_url',
    'rating',
    'user_rating_count',
    'primary_type',
    'classification',
    'agency_business_name',
    'member_since_date',
    'business_status',
    'confidence_score',
    'lead_category',
    'evidence_summary',
    'source_query',
    'job_signal_count',
    'top_job_source',
    'top_job_title',
    'top_job_url',
  ];
  const rows = prospects.map((lead) => [
    lead.placeId,
    lead.name,
    lead.email ?? '',
    lead.city,
    lead.industry,
    lead.phone,
    lead.mobilePhone ?? '',
    lead.workPhone ?? '',
    lead.website,
    lead.websiteDomain,
    lead.formattedAddress,
    lead.streetAddress ?? '',
    lead.suburbCity ?? '',
    lead.state ?? '',
    lead.postcode ?? '',
    lead.googleMapsUrl,
    lead.sourceUrl ?? '',
    lead.rating,
    lead.userRatingCount,
    lead.primaryType,
    lead.classification ?? '',
    lead.agencyBusinessName ?? '',
    lead.memberSinceDate ?? '',
    lead.businessStatus,
    lead.confidenceScore,
    lead.leadCategory ?? '',
    lead.evidenceSummary ?? '',
    lead.query,
    lead.jobSignals?.length ?? 0,
    lead.jobSignals?.[0]?.source ?? '',
    lead.jobSignals?.[0]?.title ?? '',
    lead.jobSignals?.[0]?.url ?? '',
  ]);

  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

function buildCallSheet(prospects: LeadResult[]): string {
  return prospects
    .map((lead, index) => {
      const parts = [
        `${index + 1}. ${lead.name}`,
        lead.agencyBusinessName ? `Agency: ${lead.agencyBusinessName}` : '',
        lead.phone ? `Phone: ${lead.phone}` : '',
        lead.email ? `Email: ${lead.email}` : '',
        lead.website ? `Website: ${lead.website}` : '',
        lead.formattedAddress ? `Address: ${lead.formattedAddress}` : '',
        ...(lead.jobSignals ?? []).slice(0, 2).map((signal) => `Hiring signal: ${signal.source} - ${signal.title} (${signal.url})`),
        lead.googleMapsUrl && !lead.sourceUrl ? `Maps: ${lead.googleMapsUrl}` : '',
        lead.sourceUrl ? `Source: ${lead.sourceUrl}` : '',
        lead.placeId ? `Place ID: ${lead.placeId}` : '',
      ].filter(Boolean);
      return parts.join('\n');
    })
    .join('\n\n');
}

function slugifyFilenamePart(value: string, fallback: string): string {
  return value.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || fallback;
}

function slugifyLocation(value: string): string {
  return normalizeInput(value).replace(/\s+/g, '-');
}

function buildRealtorCaDirectoryUrl(city: string, provinceCode: string): string {
  return `https://www.realtor.ca/realtors/${provinceCode.toLowerCase()}/${slugifyLocation(city || 'toronto')}`;
}

function compactSpaces(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizePhoneDigits(value: unknown): string {
  const match = compactSpaces(value).match(PHONE_RE)?.[0] || '';
  let digits = match.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length === 10 ? digits : '';
}

function formatNorthAmericanPhone(digits: string): string {
  return digits ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : '';
}

function normalizeMobilePhone(value: unknown): string {
  return formatNorthAmericanPhone(normalizePhoneDigits(value));
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPlaceholderAgentName(value: unknown): boolean {
  const clean = compactSpaces(value).replace(/[®]/g, '');
  return /^(realtor\s*\.?\s*ca|\.ca)\s+agent$/i.test(clean) || /^agent$/i.test(clean);
}

function titleCaseAllCapsName(value: string): string {
  if (!value || !/[A-Z]/.test(value) || /[a-z]/.test(value)) return value;
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\bMc([a-z])/g, (_, letter: string) => `Mc${letter.toUpperCase()}`);
}

function cleanBrowserCaptureName(value: unknown): string {
  if (isPlaceholderAgentName(value)) return '';
  let clean = compactSpaces(value)
    .replace(PHONE_GLOBAL_RE, ' ')
    .replace(POSTCODE_RE, ' ')
    .replace(/\b(REALTOR(?:\.ca)?(?:®|\(R\))?|website|email)\b/gi, ' ')
    .trim();

  const boundary = clean.search(
    /\b(salesperson|sales representative|broker of record|associate broker|broker|representative|realtor|royal lepage|re\/max|keller williams|century 21|right at home|sutton|exp realty|realty|inc\.?|ltd\.?|brokerage|unit|suite|street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|boulevard|blvd\.?|ontario)\b|\d{1,6}\s+[A-Za-z]/i
  );
  if (boundary > 1) clean = compactSpaces(clean.slice(0, boundary));

  clean = clean.replace(/[^A-Za-z'. -]/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = clean.split(' ').filter(Boolean);
  if (parts.length > 5) clean = parts.slice(0, 5).join(' ');
  if (!clean || isPlaceholderAgentName(clean) || REALTOR_ROLE_ONLY_RE.test(clean) || clean.length < 3) return '';
  return titleCaseAllCapsName(clean);
}

function cleanBrowserCaptureOffice(value: unknown, name: string): string {
  let clean = compactSpaces(value)
    .replace(PHONE_GLOBAL_RE, ' ')
    .replace(POSTCODE_RE, ' ')
    .replace(/\b(email|website|realtor(?:®|\(R\))?)\b/gi, ' ')
    .trim();
  if (name) clean = compactSpaces(clean.replace(new RegExp(escapedRegExp(name), 'i'), ' '));
  const boundary = clean.search(/\b(unit|suite|street|st\.?|road|rd\.?|avenue|ave\.?|drive|dr\.?|boulevard|blvd\.?|ontario)\b|\d{1,6}\s+[A-Za-z]/i);
  if (boundary > 1) clean = compactSpaces(clean.slice(0, boundary));
  return clean;
}

function splitCanadianAddress(address: string): {
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
  const state = parts.at(-1) ?? '';
  const suburbCity = parts.length >= 2 ? parts.at(-2) ?? '' : '';
  const streetAddress = parts.length >= 3 ? parts.slice(0, -2).join(', ') : parts[0] ?? clean;

  return {
    streetAddress,
    suburbCity,
    state,
    postcode,
  };
}

function buildRealtorCaCaptureBookmarklet(): string {
  const script = `(async () => {
    const compact = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
    const phoneRe = /(?:\\+?1[\\s.-]?)?\\(?\\d{3}\\)?[\\s.-]?\\d{3}[\\s.-]?\\d{4}/;
    const postcodeRe = /\\b[A-Z]\\d[A-Z]\\s?\\d[A-Z]\\d\\b/i;
    const roleRe = /\\b(salesperson|broker|broker of record|associate broker|representative|realtor)\\b/i;
    const ignored = /^(email|website|realtor.? website|office website|brokerage|contact)$/i;
    const storageKey = 'flyr.realtor.ca.browser.capture.v1';
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const linesFrom = (text) => String(text ?? '')
      .replace(/\\r\\n/g, '\\n')
      .split('\\n')
      .map(compact)
      .filter(Boolean)
      .filter((line) => !ignored.test(line));
    const bestTextForLink = (link) => {
      let best = compact(link.innerText || link.textContent);
      let element = link;
      for (let depth = 0; depth < 9 && element; depth += 1) {
        const text = compact(element.innerText || element.textContent);
        if (text.length > best.length && text.length < 2600 && (phoneRe.test(text) || roleRe.test(text))) {
          best = text;
        }
        element = element.parentElement;
      }
      return best;
    };
    const leadFromLink = (link, index, pageNumber) => {
      const href = link.href || '';
      const text = bestTextForLink(link);
      const lines = linesFrom(text);
      const phone = compact(text.match(phoneRe)?.[0]);
      const roleIndex = lines.findIndex((line) => roleRe.test(line));
      const role = roleIndex >= 0 ? lines[roleIndex] : '';
      const name = lines.find((line) => !phoneRe.test(line) && !roleRe.test(line) && !postcodeRe.test(line)) || compact(link.textContent) || 'REALTOR.ca agent';
      const address = lines.find((line) => postcodeRe.test(line)) || '';
      const officeStart = roleIndex >= 0 ? roleIndex + 1 : 1;
      const office = lines.slice(officeStart)
        .find((line) => !phoneRe.test(line) && !postcodeRe.test(line) && line !== name && !roleRe.test(line)) || '';
      return {
        name,
        role,
        office,
        phone,
        address,
        profileUrl: href,
        sourceUrl: href,
        pageUrl: location.href,
        capturedAt: new Date().toISOString(),
        pageNumber,
        pageIndex: index + 1
      };
    };
    const captureCurrentPage = (pageNumber) => {
      const links = Array.from(document.querySelectorAll('a[href*="/agent/"]'))
        .filter((link) => /\\/agent\\/\\d+\\//i.test(link.href || ''));
      return links
        .map((link, index) => leadFromLink(link, index, pageNumber))
        .filter((lead) => lead.name && (lead.phone || lead.office || lead.address));
    };
    const findNextButton = () => {
      const selectors = [
        '[aria-label="Go to the next page"]',
        'a[rel="next"]',
        'button[aria-label*="next" i]',
        'a[aria-label*="next" i]'
      ];
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && !element.disabled && element.getAttribute('aria-disabled') !== 'true') return element;
      }
      return Array.from(document.querySelectorAll('a,button')).find((element) => {
        const label = compact(element.getAttribute('aria-label') || element.textContent);
        return /next|›|»/i.test(label) && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
      });
    };
    const waitForPageChange = async (beforeUrl, beforeText) => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await wait(500);
        const text = compact(document.body.innerText).slice(0, 4000);
        if (location.href !== beforeUrl || text !== beforeText) return true;
      }
      return false;
    };
    const existing = JSON.parse(localStorage.getItem(storageKey) || '{"leads":[]}');
    const capturedPages = [];
    let pageNumber = 1;
    while (true) {
      window.scrollTo(0, document.body.scrollHeight);
      await wait(700);
      window.scrollTo(0, 0);
      await wait(500);
      const pageLeads = captureCurrentPage(pageNumber);
      capturedPages.push({ pageUrl: location.href, count: pageLeads.length });
      if (pageLeads.length) {
        existing.leads = [...(Array.isArray(existing.leads) ? existing.leads : []), ...pageLeads];
      }
      const next = findNextButton();
      if (!next) break;
      const beforeUrl = location.href;
      const beforeText = compact(document.body.innerText).slice(0, 4000);
      next.click();
      const moved = await waitForPageChange(beforeUrl, beforeText);
      if (!moved) break;
      await wait(1200);
      pageNumber += 1;
    }
    const byKey = new Map();
    (Array.isArray(existing.leads) ? existing.leads : []).forEach((lead) => {
      const phoneKey = String(lead.phone || '').replace(/\\D/g, '');
      const textKey = [lead.name, lead.office, lead.address].map((value) => compact(value).toLowerCase()).join('|');
      const key = phoneKey || textKey;
      if (key && !byKey.has(key)) byKey.set(key, lead);
    });
    const leads = Array.from(byKey.values());
    const payload = {
      source: 'realtor.ca',
      mode: 'flyr_browser_capture_auto',
      pageUrl: location.href,
      capturedAt: new Date().toISOString(),
      allPages: true,
      capturedPages,
      leads
    };
    localStorage.setItem(storageKey, JSON.stringify(payload));
    const json = JSON.stringify(payload, null, 2);
    const done = () => alert('FLYR captured ' + payload.leads.length + ' total agents across ' + capturedPages.length + ' page(s). Paste the JSON into FLYR.');
    const fallback = () => {
      const box = document.createElement('textarea');
      box.value = json;
      Object.assign(box.style, { position: 'fixed', left: '12px', top: '12px', width: '460px', height: '320px', zIndex: '2147483647', background: 'white', color: 'black' });
      document.body.appendChild(box);
      box.focus();
      box.select();
      try { document.execCommand('copy'); } catch {}
      done();
    };
    if (navigator.clipboard) navigator.clipboard.writeText(json).then(done).catch(fallback);
    else fallback();
  })();`;

  return `javascript:${encodeURIComponent(script)}`;
}

function parseBrowserCaptureJson(value: string): BrowserCaptureLead[] {
  const clean = value.trim();
  if (/^https?:\/\/(www\.)?realtor\.ca\/realtors\//i.test(clean)) {
    throw new Error('That is the REALTOR.ca page URL. Click Helper, run the copied auto-capture helper on the REALTOR.ca page, then paste the JSON it copies here.');
  }
  if (/^javascript:/i.test(clean)) {
    throw new Error('That is the helper script. Run it from a bookmark on REALTOR.ca; it will auto-capture pages and copy JSON back here.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new Error('Paste the JSON copied by the FLYR capture helper. It should start with {"source":"realtor.ca","leads":[...]}');
  }
  if (Array.isArray(parsed)) return parsed as BrowserCaptureLead[];
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { leads?: unknown }).leads)) {
    return (parsed as { leads: BrowserCaptureLead[] }).leads;
  }
  throw new Error('Paste the JSON copied by the FLYR REALTOR.ca capture helper.');
}

function browserCaptureLeadToResult(lead: BrowserCaptureLead, city: string, provinceCode: string, index: number): LeadResult | null {
  const name =
    cleanBrowserCaptureName(lead.name) ||
    cleanBrowserCaptureName(lead.role) ||
    cleanBrowserCaptureName(lead.office || lead.brokerage) ||
    cleanBrowserCaptureName(lead.address);
  const phone = normalizeMobilePhone(lead.phone || lead.mobilePhone || lead.workPhone);
  const capturedMobilePhone = normalizeMobilePhone(lead.mobilePhone);
  const capturedWorkPhone = normalizeMobilePhone(lead.workPhone);
  const office = cleanBrowserCaptureOffice(lead.office || lead.brokerage, name);
  const role = compactSpaces(lead.role);
  const address = compactSpaces(lead.address);
  const sourceUrl = compactSpaces(lead.sourceUrl || lead.profileUrl || lead.pageUrl);
  if (!name || !phone) return null;

  const addressParts = splitCanadianAddress(address);
  const phoneKey = normalizePhoneDigits(phone);
  const key = phoneKey || sourceUrl || `${normalizeInput(name)}:${normalizeInput(office)}:${normalizeInput(address)}` || `${index}`;
  return {
    placeId: `realtor-ca-browser:${key || index}`,
    name,
    city: addressParts.suburbCity || city,
    industry: 'REALTOR.ca browser capture',
    query: `REALTOR.ca browser capture ${city}, ${provinceCode.toUpperCase()}`,
    formattedAddress: address,
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
    confidenceScore: address ? 92 : 85,
    leadCategory: 'real_estate_individual_agent',
    evidenceSummary: [office ? `Office: ${office}` : '', role ? `Role: ${role}` : 'Browser capture']
      .filter(Boolean)
      .join(' | '),
    leadSource: 'places',
    classification: 'individual_agent',
    sourceUrl,
    role,
    office,
    mobilePhone: capturedMobilePhone,
    workPhone: capturedWorkPhone || (capturedMobilePhone ? '' : phone),
    agencyBusinessName: office,
    ...addressParts,
  };
}

function dedupeLeadResults(leads: LeadResult[]): LeadResult[] {
  const seen = new Set<string>();
  const output: LeadResult[] = [];
  for (const lead of leads) {
    const phoneKey = normalizePhoneDigits(lead.mobilePhone || lead.phone);
    const key =
      (phoneKey ? `phone:${phoneKey}` : '') ||
      lead.sourceUrl ||
      lead.placeId ||
      `${normalizeInput(lead.name)}|${normalizeInput(lead.agencyBusinessName ?? '')}|${normalizeInput(lead.formattedAddress)}` ||
      '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(lead);
  }
  return output;
}

async function copyText(value: string): Promise<boolean> {
  if (!value || typeof window === 'undefined') return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function formatRating(lead: LeadResult): string {
  if (typeof lead.rating !== 'number') return '-';
  const count = typeof lead.userRatingCount === 'number' ? ` (${lead.userRatingCount})` : '';
  return `${lead.rating.toFixed(1)}${count}`;
}

function formatRunDate(value: string | null | undefined): string {
  if (!value) return 'never';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function modeLeadLabel(scraperMode: ScraperMode): string {
  if (scraperMode === 'australia_reiq') return 'Australia leads';
  if (scraperMode === 'realtor_ca') return 'Captured REALTOR.ca agents';
  if (scraperMode === 'realtor_ca_screenshot') return 'Screenshot agents';
  return 'Places leads';
}

function modeLoadingLabel(scraperMode: ScraperMode): string {
  if (scraperMode === 'australia_reiq') return 'Scraping REIQ profiles';
  if (scraperMode === 'realtor_ca') return 'Importing browser capture';
  if (scraperMode === 'realtor_ca_screenshot') return 'Extracting screenshot agents';
  return 'Searching Google Places';
}

function provinceCodeForRegion(region: string): string | null {
  return canadianProvinceByRegion.get(normalizeInput(region)) ?? null;
}

function useCityAutocomplete(query: string, open: boolean, countryCodes?: string[]) {
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const countryKey = countryCodes?.join(',') ?? '';
  const allowedCountrySet = useMemo(
    () => new Set(countryKey.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean)),
    [countryKey]
  );

  useEffect(() => {
    abortRef.current?.abort();
    const cleanQuery = query.trim();
    if (!open || cleanQuery.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      MapboxAutocompleteService.searchCities(cleanQuery, undefined, controller.signal)
        .then((results) => {
          if (controller.signal.aborted) return;
          const filtered = allowedCountrySet.size
            ? results.filter((result) => allowedCountrySet.has(result.countryCode.toUpperCase()))
            : results;
          setSuggestions(filtered);
        })
        .catch((searchError) => {
          if (searchError instanceof Error && searchError.name === 'AbortError') return;
          if (!controller.signal.aborted) setSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [allowedCountrySet, open, query]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return { suggestions, loading, setSuggestions };
}

export function SalespersonPlacesLeadFinder() {
  const router = useRouter();
  const { currentWorkspaceId } = useWorkspace();
  const [markets, setMarkets] = useState<ProspectMarket[]>([]);
  const [industries, setIndustries] = useState<ProspectIndustry[]>([]);
  const [recentRuns, setRecentRuns] = useState<ProspectSearchRun[]>([]);
  const [prospectingWorkspaceId, setProspectingWorkspaceId] = useState<string | null>(null);
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [selectedIndustryId, setSelectedIndustryId] = useState('');
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [cityAutocompleteOpen, setCityAutocompleteOpen] = useState(false);
  const [cityAutocompleteLoading, setCityAutocompleteLoading] = useState(false);
  const [city, setCity] = useState('');
  const [industry, setIndustry] = useState('');
  const [region, setRegion] = useState('');
  const [countryCode, setCountryCode] = useState('US');
  const [relatedTerms, setRelatedTerms] = useState('');
  const [realEstateTarget, setRealEstateTarget] = useState<RealEstateTarget>('agents');
  const [scraperMode, setScraperMode] = useState<ScraperMode>('google_places');
  const [reiqStartUrl, setReiqStartUrl] = useState(REIQ_DEFAULT_SEARCH_URL);
  const [reiqLocation, setReiqLocation] = useState('Brisbane');
  const [reiqMaxPages, setReiqMaxPages] = useState('3');
  const [reiqMaxProfiles, setReiqMaxProfiles] = useState('500');
  const [realtorCity, setRealtorCity] = useState('Toronto');
  const [realtorProvinceCode, setRealtorProvinceCode] = useState('on');
  const [realtorCaptureJson, setRealtorCaptureJson] = useState('');
  const [screenshotCity, setScreenshotCity] = useState('Toronto');
  const [screenshotProvinceCode, setScreenshotProvinceCode] = useState('on');
  const [screenshotFiles, setScreenshotFiles] = useState<File[]>([]);
  const [realtorCityAutocompleteOpen, setRealtorCityAutocompleteOpen] = useState(false);
  const [screenshotCityAutocompleteOpen, setScreenshotCityAutocompleteOpen] = useState(false);
  const [prospects, setProspects] = useState<LeadResult[]>([]);
  const [summary, setSummary] = useState<PlacesLeadPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const cityAbortRef = useRef<AbortController | null>(null);
  const cityBlurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtorCityBlurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenshotCityBlurRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const realEstateMode = isRealEstateIndustry(industry);
  const saveWorkspaceId = currentWorkspaceId ?? prospectingWorkspaceId;
  const canSubmit =
    scraperMode === 'australia_reiq'
      ? reiqStartUrl.trim().length >= 12 && (REIQ_PROFILE_URL_RE.test(reiqStartUrl) || reiqLocation.trim().length >= 2) && !loading
      : scraperMode === 'realtor_ca_screenshot'
        ? screenshotCity.trim().length >= 2 && screenshotFiles.length > 0 && !loading
      : scraperMode === 'realtor_ca'
        ? realtorCity.trim().length >= 2 && !loading
        : city.trim().length >= 2 && industry.trim().length >= 2 && !loading;
  const csv = useMemo(() => buildPlacesCsv(prospects), [prospects]);
  const realtorCityAutocomplete = useCityAutocomplete(
    realtorCity,
    scraperMode === 'realtor_ca' && realtorCityAutocompleteOpen,
    ['CA']
  );
  const screenshotCityAutocomplete = useCityAutocomplete(
    screenshotCity,
    scraperMode === 'realtor_ca_screenshot' && screenshotCityAutocompleteOpen,
    ['CA']
  );
  const cityMarketSuggestions = useMemo(() => {
    const query = normalizeInput(city);
    const matches = query
      ? markets.filter((market) =>
          normalizeInput([market.city, market.region, market.country_code, market.label].join(' ')).includes(query)
        )
      : markets;
    return matches.slice(0, 8);
  }, [city, markets]);
  const selectedRun = useMemo(() => {
    if (!selectedMarketId || !selectedIndustryId) return null;
    return recentRuns.find(
      (run) => run.market_id === selectedMarketId && run.industry_id === selectedIndustryId
    ) ?? null;
  }, [recentRuns, selectedIndustryId, selectedMarketId]);
  const realtorDirectoryUrl = useMemo(
    () => buildRealtorCaDirectoryUrl(realtorCity, realtorProvinceCode),
    [realtorCity, realtorProvinceCode]
  );

  const loadProspectingOptions = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (currentWorkspaceId) params.set('workspaceId', currentWorkspaceId);
      const query = params.toString();
      const response = await fetch(`/api/prospecting/options${query ? `?${query}` : ''}`, { credentials: 'include' });
      const payload = (await response.json().catch(() => ({}))) as ProspectingOptionsPayload;
      if (!response.ok) throw new Error(payload.error || 'Failed to load prospecting picks.');
      setProspectingWorkspaceId(payload.workspaceId ?? null);
      setMarkets(payload.markets ?? []);
      setIndustries(payload.industries ?? []);
      setRecentRuns(payload.recentRuns ?? []);
    } catch {
      setProspectingWorkspaceId(null);
      setMarkets([]);
      setIndustries([]);
      setRecentRuns([]);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    void loadProspectingOptions();
  }, [loadProspectingOptions]);

  useEffect(() => {
    if (!realEstateMode) setRealEstateTarget('agents');
  }, [realEstateMode]);

  useEffect(() => {
    return () => {
      cityAbortRef.current?.abort();
      if (cityBlurRef.current) clearTimeout(cityBlurRef.current);
      if (realtorCityBlurRef.current) clearTimeout(realtorCityBlurRef.current);
      if (screenshotCityBlurRef.current) clearTimeout(screenshotCityBlurRef.current);
    };
  }, []);

  useEffect(() => {
    cityAbortRef.current?.abort();
    const query = city.trim();
    if (!cityAutocompleteOpen || query.length < 3) {
      setCitySuggestions([]);
      setCityAutocompleteLoading(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      const controller = new AbortController();
      cityAbortRef.current = controller;
      setCityAutocompleteLoading(true);

      MapboxAutocompleteService.searchCities(query, undefined, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) setCitySuggestions(results);
        })
        .catch((searchError) => {
          if (searchError instanceof Error && searchError.name === 'AbortError') return;
          if (!controller.signal.aborted) setCitySuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setCityAutocompleteLoading(false);
        });
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [city, cityAutocompleteOpen]);

  function handleMarketSelect(market: ProspectMarket) {
    setSelectedMarketId(market.id);
    setCity(market.city);
    setRegion(market.region);
    setCountryCode(market.country_code);
    setCityAutocompleteOpen(false);
    setCitySuggestions([]);
  }

  function findMarketForCity(nextCity: string, nextCountryCode = countryCode): ProspectMarket | undefined {
    return markets.find((item) => {
      return normalizeInput(item.city) === normalizeInput(nextCity) && item.country_code === nextCountryCode;
    });
  }

  function handleIndustrySelect(value: string) {
    const prospectIndustry = industries.find((item) => item.id === value);
    if (!prospectIndustry) return;
    setSelectedIndustryId(value);
    setIndustry(prospectIndustry.name);
    setRelatedTerms(prospectIndustry.default_terms.join(', '));
  }

  function handleCountrySelect(value: string) {
    const market = findMarketForCity(city, value);
    setCountryCode(value);
    setSelectedMarketId(market?.id ?? '');
    setRegion(market?.region ?? '');
  }

  function handleCityChange(value: string) {
    const market = findMarketForCity(value);
    setCity(value);
    setSelectedMarketId(market?.id ?? '');
    setRegion(market?.region ?? '');
    setCityAutocompleteOpen(true);
  }

  function handleCitySuggestionSelect(suggestion: CitySuggestion) {
    const nextCountryCode = suggestion.countryCode ?? countryCode;
    const market = findMarketForCity(suggestion.city, nextCountryCode);
    setCity(suggestion.city);
    setRegion(market?.region ?? suggestion.region);
    if (suggestion.countryCode) setCountryCode(suggestion.countryCode);
    setSelectedMarketId(market?.id ?? '');
    setCityAutocompleteOpen(false);
    setCitySuggestions([]);
  }

  function handleRealtorCityChange(value: string) {
    setRealtorCity(value);
    setRealtorCityAutocompleteOpen(true);
  }

  function handleRealtorCitySuggestionSelect(suggestion: CitySuggestion) {
    setRealtorCity(suggestion.city);
    const nextProvinceCode = provinceCodeForRegion(suggestion.region);
    if (nextProvinceCode) setRealtorProvinceCode(nextProvinceCode);
    setRealtorCityAutocompleteOpen(false);
    realtorCityAutocomplete.setSuggestions([]);
  }

  function handleScreenshotCityChange(value: string) {
    setScreenshotCity(value);
    setScreenshotCityAutocompleteOpen(true);
  }

  function handleScreenshotCitySuggestionSelect(suggestion: CitySuggestion) {
    setScreenshotCity(suggestion.city);
    const nextProvinceCode = provinceCodeForRegion(suggestion.region);
    if (nextProvinceCode) setScreenshotProvinceCode(nextProvinceCode);
    setScreenshotCityAutocompleteOpen(false);
    screenshotCityAutocomplete.setSuggestions([]);
  }

  const importBrowserCaptureText = useCallback(
    async (captureText: string, options?: { city?: string; provinceCode?: string; source?: string }) => {
      const capturedRows = parseBrowserCaptureJson(captureText);
      const captureCity = compactSpaces(options?.city) || realtorCity.trim();
      const captureProvinceCode = compactSpaces(options?.provinceCode) || realtorProvinceCode;
      const nextProspects = dedupeLeadResults(
        capturedRows
          .map((lead, index) => browserCaptureLeadToResult(lead, captureCity, captureProvinceCode, index))
          .filter((lead): lead is LeadResult => Boolean(lead))
      );
      const now = new Date().toISOString();
      const payload: PlacesLeadPayload = {
        ok: true,
        startedAt: now,
        completedAt: now,
        queryCount: 1,
        rawResultCount: capturedRows.length,
        uniqueResultCount: nextProspects.length,
        leadSource: 'realtor_ca_browser_capture',
        prospects: nextProspects,
        profileUrls: nextProspects.map((lead) => lead.sourceUrl).filter(Boolean) as string[],
        savedList: null,
      };

      if (captureCity) setRealtorCity(captureCity);
      if (captureProvinceCode) setRealtorProvinceCode(captureProvinceCode.toLowerCase());
      setScraperMode('realtor_ca');
      setRealtorCaptureJson(captureText);
      setProspects(nextProspects);
      setSummary(payload);
      setError(null);
      setStatus(
        `${nextProspects.length.toLocaleString()} REALTOR.ca agents imported from ${options?.source ?? 'browser capture'} for ${captureCity}. Saving against the master list...`
      );

      try {
        const response = await fetch('/api/salesperson/realtor-ca-browser', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            workspaceId: saveWorkspaceId ?? undefined,
            city: captureCity,
            provinceCode: captureProvinceCode,
            leads: nextProspects,
          }),
        });
        const savePayload = (await response.json().catch(() => ({}))) as Pick<PlacesLeadPayload, 'savedList' | 'error'>;
        if (!response.ok) {
          throw new Error(savePayload.error || 'Could not save REALTOR.ca leads to the master list.');
        }

        const nextSummary = {
          ...payload,
          savedList: savePayload.savedList ?? null,
        };
        setSummary(nextSummary);
        const saved = savePayload.savedList;
        setStatus(
          saved
            ? `${nextProspects.length.toLocaleString()} REALTOR.ca agents imported. ${saved.masterSkippedCount.toLocaleString()} already in the master list, ${saved.dialerImportedCount.toLocaleString()} added to the dialer.`
            : `${nextProspects.length.toLocaleString()} REALTOR.ca agents imported. No workspace list was saved.`
        );
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : 'Could not save REALTOR.ca leads to the master list.');
      }
    },
    [realtorCity, realtorProvinceCode, saveWorkspaceId]
  );

  useEffect(() => {
    function handleExtensionMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as { type?: unknown; payload?: BrowserCapturePayload } | null;
      if (!data || data.type !== 'FLYR_REALTOR_CA_CAPTURE') return;
      const payload = data.payload;
      if (!payload || !Array.isArray(payload.leads)) return;

      try {
        void importBrowserCaptureText(JSON.stringify(payload, null, 2), {
          city: typeof payload.city === 'string' ? payload.city : undefined,
          provinceCode: typeof payload.provinceCode === 'string' ? payload.provinceCode : undefined,
          source: 'Chrome extension',
        }).catch((messageError) => {
          setError(messageError instanceof Error ? messageError.message : 'Chrome extension import failed.');
        });
      } catch (messageError) {
        setError(messageError instanceof Error ? messageError.message : 'Chrome extension import failed.');
      }
    }

    window.addEventListener('message', handleExtensionMessage);
    return () => window.removeEventListener('message', handleExtensionMessage);
  }, [importBrowserCaptureText]);

  async function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (scraperMode === 'realtor_ca_screenshot') {
      if (screenshotCity.trim().length < 2 || screenshotFiles.length === 0) return;

      setLoading(true);
      setError(null);
      setStatus(null);

      try {
        const formData = new FormData();
        formData.set('city', screenshotCity.trim());
        formData.set('provinceCode', screenshotProvinceCode);
        screenshotFiles.forEach((file) => formData.append('images', file));

        const response = await fetch('/api/salesperson/realtor-ca-screenshot', {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
        const payload = (await response.json().catch(() => ({}))) as PlacesLeadPayload;
        if (!response.ok) {
          throw new Error(payload.error || 'REALTOR.ca screenshot extraction failed.');
        }

        const nextProspects = payload.prospects ?? [];
        setProspects(nextProspects);
        setSummary(payload);
        setStatus(
          `${nextProspects.length.toLocaleString()} agents extracted from ${screenshotFiles.length.toLocaleString()} screenshot${screenshotFiles.length === 1 ? '' : 's'}.`
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : 'REALTOR.ca screenshot extraction failed.';
        setError(message);
        setStatus(null);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (scraperMode === 'realtor_ca') {
      if (realtorCity.trim().length < 2) return;

      setLoading(true);
      setError(null);
      setStatus(null);

      try {
        const clipboardText = realtorCaptureJson.trim()
          ? ''
          : await navigator.clipboard?.readText?.().catch(() => '');
        const captureText = realtorCaptureJson.trim() || clipboardText || '';
        if (!captureText.trim()) {
          await copyRealtorCaptureHelper();
          if (typeof window !== 'undefined') window.open(realtorDirectoryUrl, '_blank', 'noopener,noreferrer');
          setStatus('Scraper helper copied. Run it on REALTOR.ca; when it finishes, come back and click Scraper again.');
          return;
        }

        try {
          await importBrowserCaptureText(captureText, { source: 'browser capture' });
        } catch (parseError) {
          const message = parseError instanceof Error ? parseError.message : '';
          if (/page URL|helper script|Paste the JSON/i.test(message)) {
            await copyRealtorCaptureHelper();
            if (typeof window !== 'undefined') window.open(realtorDirectoryUrl, '_blank', 'noopener,noreferrer');
            setStatus('Scraper helper copied. Run it on REALTOR.ca; when it finishes, come back and click Scraper again.');
            return;
          }
          throw parseError;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'REALTOR.ca browser capture import failed.';
        setError(message);
        setStatus(null);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (scraperMode === 'australia_reiq') {
      if (reiqStartUrl.trim().length < 12) return;

      setLoading(true);
      setError(null);
      setStatus(null);

      try {
        const maxPages = Number.parseInt(reiqMaxPages, 10);
        const maxProfiles = Number.parseInt(reiqMaxProfiles, 10);
        const response = await fetch('/api/salesperson/reiq', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            startUrl: reiqStartUrl.trim(),
            location: REIQ_PROFILE_URL_RE.test(reiqStartUrl) ? undefined : reiqLocation.trim(),
            maxPages: Number.isFinite(maxPages) && maxPages > 0 ? maxPages : undefined,
            maxProfiles: Number.isFinite(maxProfiles) && maxProfiles > 0 ? maxProfiles : undefined,
            delayMs: 250,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as PlacesLeadPayload;
        if (!response.ok) {
          throw new Error(payload.error || 'Australia REIQ lead search failed.');
        }

        const nextProspects = payload.prospects ?? [];
        setProspects(nextProspects);
        setSummary(payload);
        setStatus(
          `${nextProspects.length.toLocaleString()} Australia REIQ leads found from ${(payload.profileUrls?.length ?? nextProspects.length).toLocaleString()} profile URLs.`
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Australia REIQ lead search failed.';
        setError(message);
        setStatus(null);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (city.trim().length < 2 || industry.trim().length < 2) return;

    setLoading(true);
    setError(null);
    setStatus(null);

    try {
      const typedRelatedTerms = relatedTerms
        .split(',')
        .map((term) => term.trim())
        .filter(Boolean);
      const safeRelatedTerms =
        realEstateMode && realEstateTarget === 'individual_agents'
          ? filterIndividualAgentTerms(typedRelatedTerms)
          : typedRelatedTerms;
      const teamTerms =
        realEstateMode && realEstateTarget === 'teams'
          ? ['real estate team', 'realtor team', 'real estate group', 'realtor group']
          : [];
      const brokerageTerms =
        realEstateMode && realEstateTarget === 'brokerages'
          ? ['real estate brokerage', 'real estate office', 'realtor office', 'realty brokerage']
          : [];
      const leadIntent: LeadIntent = realEstateMode
        ? realEstateTarget === 'teams'
          ? 'real_estate_teams'
          : realEstateTarget === 'individual_agents'
            ? 'real_estate_individual_agents'
            : realEstateTarget === 'brokerages'
              ? 'real_estate_brokerages'
              : 'real_estate_agents'
        : 'generic';

      const response = await fetch('/api/salesperson/google-places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          city,
          industry,
          countryCode,
          region: region.trim() || undefined,
          workspaceId: saveWorkspaceId ?? undefined,
          relatedTerms: uniqueTerms([...teamTerms, ...brokerageTerms, ...safeRelatedTerms]).slice(0, 12),
          pageSize: 20,
          marketId: selectedMarketId || undefined,
          industryId: selectedIndustryId || undefined,
          leadSource: 'places',
          leadIntent,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as PlacesLeadPayload;
      if (!response.ok) {
        throw new Error(payload.error || 'Google Places lead search failed.');
      }

      const nextProspects = payload.prospects ?? [];
      setProspects(nextProspects);
      setSummary(payload);
      const saved = payload.savedList;
      const foundLabel = leadIntentLabel(leadIntent);
      setStatus(
        saved
          ? `${nextProspects.length.toLocaleString()} ${foundLabel} found. Saved "${saved.listName}" with ${saved.contactCount.toLocaleString()} list rows and ${saved.dialerLeadIds.length.toLocaleString()} dialer rows.`
          : `${nextProspects.length.toLocaleString()} ${foundLabel} found.`
      );
      void loadProspectingOptions();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Google Places lead search failed.';
      setError(message);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    if (!prospects.length) {
      setStatus('Run a search first.');
      return;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const baseName =
      scraperMode === 'australia_reiq'
        ? 'australia-reiq-leads'
        : scraperMode === 'realtor_ca_screenshot'
          ? `realtor-ca-screenshots-${slugifyFilenamePart(screenshotCity, 'city')}`
        : scraperMode === 'realtor_ca'
          ? `realtor-ca-${slugifyFilenamePart(realtorCity, 'city')}`
        : `places-leads-${slugifyFilenamePart(city, 'city')}`;
    anchor.href = url;
    anchor.download = `${baseName}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setStatus('CSV exported.');
  }

  function exportJson() {
    if (!prospects.length) {
      setStatus('Run a search first.');
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      mode: scraperMode,
      summary,
      prospects,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const baseName =
      scraperMode === 'australia_reiq'
        ? 'australia-reiq-leads'
        : scraperMode === 'realtor_ca_screenshot'
          ? `realtor-ca-screenshots-${slugifyFilenamePart(screenshotCity, 'city')}`
        : scraperMode === 'realtor_ca'
          ? `realtor-ca-${slugifyFilenamePart(realtorCity, 'city')}`
        : `places-leads-${slugifyFilenamePart(city, 'city')}`;
    anchor.href = url;
    anchor.download = `${baseName}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setStatus('JSON exported.');
  }

  async function copyCallSheet() {
    if (!prospects.length) {
      setStatus('Run a search first.');
      return;
    }
    const copied = await copyText(buildCallSheet(prospects));
    setStatus(copied ? 'Call sheet copied.' : 'Copy failed.');
  }

  async function copyLead(lead: LeadResult) {
    const copied = await copyText(buildCallSheet([lead]));
    setStatus(copied ? `${lead.name} copied.` : 'Copy failed.');
  }

  async function copyRealtorCaptureHelper() {
    const copied = await copyText(buildRealtorCaCaptureBookmarklet());
    setStatus(copied ? 'REALTOR.ca auto-capture helper copied.' : 'Copy failed.');
  }

  function handleScreenshotFilesChange(files: FileList | null) {
    setScreenshotFiles(Array.from(files ?? []).slice(0, 8));
  }

  function openSavedListInDialer() {
    const saved = summary?.savedList;
    if (!saved?.dialerLeadIds?.length) {
      router.push('/dialer');
      return;
    }

    const params = new URLSearchParams();
    params.set('leadIds', saved.dialerLeadIds.join(','));
    params.set('listName', saved.listName);
    if (saveWorkspaceId) params.set('workspaceId', saveWorkspaceId);
    router.push(`/dialer?${params.toString()}`);
  }

  function openSavedListInLeads() {
    const saved = summary?.savedList;
    if (!saved?.listId) {
      router.push('/leads');
      return;
    }

    const params = new URLSearchParams();
    params.set('listId', saved.listId);
    params.set('listName', saved.listName);
    router.push(`/leads?${params.toString()}`);
  }

  function handleScraperModeChange(value: string) {
    if (
      value !== 'google_places' &&
      value !== 'australia_reiq' &&
      value !== 'realtor_ca' &&
      value !== 'realtor_ca_screenshot'
    ) return;
    setScraperMode(value);
    setProspects([]);
    setSummary(null);
    setError(null);
    setStatus(null);
    if (value !== 'realtor_ca') setRealtorCaptureJson('');
    if (value === 'australia_reiq') {
      setCountryCode('AU');
      setIndustry('Real estate');
      setSelectedIndustryId('');
      setRelatedTerms('');
    }
    if (value === 'realtor_ca') {
      setCountryCode('CA');
      setIndustry('Real estate');
      setSelectedIndustryId('');
      setRelatedTerms('');
    }
    if (value === 'realtor_ca_screenshot') {
      setCountryCode('CA');
      setIndustry('Real estate');
      setSelectedIndustryId('');
      setRelatedTerms('');
    }
  }

  return (
    <div className="space-y-5">
      <section id="lead-config" className="rounded-md border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold text-foreground">Configuration</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a lead source mode before running the search.
            </p>
          </div>
          <Tabs value={scraperMode} onValueChange={handleScraperModeChange}>
            <TabsList className="grid w-full grid-cols-4 lg:w-[680px]">
              <TabsTrigger value="google_places">Google Places</TabsTrigger>
              <TabsTrigger value="australia_reiq">Australia</TabsTrigger>
              <TabsTrigger value="realtor_ca">Browser Capture</TabsTrigger>
              <TabsTrigger value="realtor_ca_screenshot">Upload</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </section>

      <section className="rounded-md border border-border bg-card p-4 shadow-sm">
        <form
          className={
            scraperMode === 'australia_reiq'
              ? 'grid gap-3 lg:grid-cols-[minmax(280px,1fr)_220px_110px_130px_auto]'
              : scraperMode === 'realtor_ca_screenshot'
                ? 'grid gap-3 lg:grid-cols-[minmax(180px,1fr)_180px_minmax(280px,1.4fr)_auto]'
              : scraperMode === 'realtor_ca'
                ? 'grid gap-3 lg:grid-cols-[minmax(180px,1fr)_180px_auto]'
              : 'grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_180px_auto_auto]'
          }
          onSubmit={runSearch}
        >
          {scraperMode === 'google_places' && selectedRun ? (
            <div className="rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 lg:col-span-full">
              Last hit {formatRunDate(selectedRun.completed_at ?? selectedRun.created_at)}: {selectedRun.unique_count.toLocaleString()} unique, {selectedRun.dialer_count.toLocaleString()} dialer rows.
            </div>
          ) : scraperMode === 'google_places' && selectedMarketId && selectedIndustryId ? (
            <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200 lg:col-span-full">
              Not hit yet.
            </div>
          ) : null}
          {scraperMode === 'realtor_ca_screenshot' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="screenshot-city">City</Label>
                <div className="relative">
                  <Input
                    id="screenshot-city"
                    value={screenshotCity}
                    onChange={(event) => handleScreenshotCityChange(event.target.value)}
                    onFocus={() => setScreenshotCityAutocompleteOpen(true)}
                    onBlur={() => {
                      screenshotCityBlurRef.current = setTimeout(
                        () => setScreenshotCityAutocompleteOpen(false),
                        150
                      );
                    }}
                    placeholder="Start typing a Canadian city"
                    autoComplete="off"
                  />
                  {screenshotCityAutocomplete.loading ? (
                    <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  ) : null}
                  {screenshotCityAutocompleteOpen &&
                  (screenshotCityAutocomplete.suggestions.length > 0 || screenshotCityAutocomplete.loading) ? (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                      {screenshotCityAutocomplete.suggestions.map((suggestion) => (
                        <button
                          key={suggestion.id}
                          type="button"
                          className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleScreenshotCitySuggestionSelect(suggestion)}
                        >
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0">
                            <span className="block font-medium text-foreground">{suggestion.city}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[suggestion.region, suggestion.countryCode].filter(Boolean).join(', ')}
                            </span>
                          </span>
                        </button>
                      ))}
                      {screenshotCityAutocomplete.loading && screenshotCityAutocomplete.suggestions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">Searching cities...</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Province</Label>
                <Select value={screenshotProvinceCode} onValueChange={setScreenshotProvinceCode}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {canadianProvinceOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="realtor-screenshots">Screenshots</Label>
                <Input
                  id="realtor-screenshots"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(event) => handleScreenshotFilesChange(event.target.files)}
                />
                <div className="flex min-h-5 items-center gap-1 text-xs text-muted-foreground">
                  <FileImage className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {screenshotFiles.length > 0
                      ? `${screenshotFiles.length} selected: ${screenshotFiles.slice(0, 2).map((file) => file.name).join(', ')}${screenshotFiles.length > 2 ? '...' : ''}`
                      : 'Upload REALTOR.ca result screenshots.'}
                  </span>
                </div>
              </div>
            </>
          ) : scraperMode === 'realtor_ca' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="realtor-city">City</Label>
                <div className="relative">
                  <Input
                    id="realtor-city"
                    value={realtorCity}
                    onChange={(event) => handleRealtorCityChange(event.target.value)}
                    onFocus={() => setRealtorCityAutocompleteOpen(true)}
                    onBlur={() => {
                      realtorCityBlurRef.current = setTimeout(() => setRealtorCityAutocompleteOpen(false), 150);
                    }}
                    placeholder="Start typing a Canadian city"
                    autoComplete="off"
                  />
                  {realtorCityAutocomplete.loading ? (
                    <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  ) : null}
                  {realtorCityAutocompleteOpen &&
                  (realtorCityAutocomplete.suggestions.length > 0 || realtorCityAutocomplete.loading) ? (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                      {realtorCityAutocomplete.suggestions.map((suggestion) => (
                        <button
                          key={suggestion.id}
                          type="button"
                          className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleRealtorCitySuggestionSelect(suggestion)}
                        >
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0">
                            <span className="block font-medium text-foreground">{suggestion.city}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[suggestion.region, suggestion.countryCode].filter(Boolean).join(', ')}
                            </span>
                          </span>
                        </button>
                      ))}
                      {realtorCityAutocomplete.loading && realtorCityAutocomplete.suggestions.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">Searching cities...</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Province</Label>
                <Select value={realtorProvinceCode} onValueChange={setRealtorProvinceCode}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {canadianProvinceOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : scraperMode === 'australia_reiq' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="reiq-start-url">REIQ results or profile URL</Label>
                <Input
                  id="reiq-start-url"
                  value={reiqStartUrl}
                  onChange={(event) => setReiqStartUrl(event.target.value)}
                  placeholder="https://members.reiq.com/portal/..."
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reiq-location">Location</Label>
                <Input
                  id="reiq-location"
                  value={reiqLocation}
                  onChange={(event) => setReiqLocation(event.target.value)}
                  placeholder="Brisbane"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reiq-max-pages">Pages</Label>
                <Input
                  id="reiq-max-pages"
                  type="number"
                  min={1}
                  max={25}
                  value={reiqMaxPages}
                  onChange={(event) => setReiqMaxPages(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reiq-max-profiles">Profiles</Label>
                <Input
                  id="reiq-max-profiles"
                  type="number"
                  min={1}
                  max={500}
                  value={reiqMaxProfiles}
                  onChange={(event) => setReiqMaxProfiles(event.target.value)}
                />
              </div>
            </>
          ) : (
            <>
          <div className="space-y-2">
            <Label htmlFor="places-city">City</Label>
            <div className="relative">
              <Input
                id="places-city"
                value={city}
                onChange={(event) => handleCityChange(event.target.value)}
                onFocus={() => {
                  setCityAutocompleteOpen(true);
                }}
                onBlur={() => {
                  cityBlurRef.current = setTimeout(() => setCityAutocompleteOpen(false), 150);
                }}
                placeholder="Start typing a city"
                autoComplete="off"
              />
              {cityAutocompleteLoading ? (
                <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : null}
              {cityAutocompleteOpen && (cityMarketSuggestions.length > 0 || citySuggestions.length > 0 || cityAutocompleteLoading) ? (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
                  {cityMarketSuggestions.map((market) => (
                    <button
                      key={market.id}
                      type="button"
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleMarketSelect(market)}
                    >
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">{market.city}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[market.region, market.country_code].filter(Boolean).join(', ')}
                        </span>
                      </span>
                    </button>
                  ))}
                  {citySuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleCitySuggestionSelect(suggestion)}
                    >
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">{suggestion.city}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[suggestion.region, suggestion.countryCode].filter(Boolean).join(', ')}
                        </span>
                      </span>
                    </button>
                  ))}
                  {cityAutocompleteLoading && cityMarketSuggestions.length === 0 && citySuggestions.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">Searching cities...</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Industry</Label>
            <Select value={selectedIndustryId || undefined} onValueChange={handleIndustrySelect}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick an industry" />
              </SelectTrigger>
              <SelectContent>
                {industries.map((item, index) => (
                  <SelectItem key={item.id} value={item.id}>
                    {index + 1}. {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Country</Label>
            <Select value={countryCode} onValueChange={handleCountrySelect}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {countryOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {realEstateMode ? (
            <div className="space-y-2">
              <Label>Target</Label>
              <div className="grid min-h-9 grid-cols-4 rounded-md border border-input bg-background p-0.5">
                <button
                  type="button"
                  aria-pressed={realEstateTarget === 'agents'}
                  className={
                    realEstateTarget === 'agents'
                      ? 'rounded-sm bg-primary px-2 text-xs font-medium text-primary-foreground'
                      : 'rounded-sm px-2 text-xs font-medium text-muted-foreground hover:text-foreground'
                  }
                  onClick={() => setRealEstateTarget('agents')}
                >
                  Agents
                </button>
                <button
                  type="button"
                  aria-pressed={realEstateTarget === 'individual_agents'}
                  className={
                    realEstateTarget === 'individual_agents'
                      ? 'rounded-sm bg-primary px-2 text-xs font-medium text-primary-foreground'
                      : 'rounded-sm px-2 text-xs font-medium text-muted-foreground hover:text-foreground'
                  }
                  onClick={() => setRealEstateTarget('individual_agents')}
                >
                  Individual
                </button>
                <button
                  type="button"
                  aria-pressed={realEstateTarget === 'teams'}
                  className={
                    realEstateTarget === 'teams'
                      ? 'rounded-sm bg-primary px-2 text-xs font-medium text-primary-foreground'
                      : 'rounded-sm px-2 text-xs font-medium text-muted-foreground hover:text-foreground'
                  }
                  onClick={() => setRealEstateTarget('teams')}
                >
                  Teams
                </button>
                <button
                  type="button"
                  aria-pressed={realEstateTarget === 'brokerages'}
                  className={
                    realEstateTarget === 'brokerages'
                      ? 'rounded-sm bg-primary px-2 text-xs font-medium text-primary-foreground'
                      : 'rounded-sm px-2 text-xs font-medium text-muted-foreground hover:text-foreground'
                  }
                  onClick={() => setRealEstateTarget('brokerages')}
                >
                  Brokerages
                </button>
              </div>
            </div>
          ) : null}
            </>
          )}
          <div className={scraperMode === 'realtor_ca' ? 'flex items-end lg:col-start-3 lg:row-start-1' : 'flex items-end'}>
            <Button type="submit" disabled={!canSubmit} className="w-full">
              {loading ? <Loader2 className="animate-spin" /> : <Search />}
              {scraperMode === 'google_places' ? 'Search' : scraperMode === 'realtor_ca' ? 'Scraper' : 'Scrape'}
            </Button>
          </div>
          <div className="flex items-end gap-2 lg:col-span-full">
            <Button type="button" variant="outline" className="flex-1" onClick={copyCallSheet}>
              <Copy />
              Copy
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={exportCsv}>
              <Download />
              CSV
            </Button>
            <Button type="button" variant="outline" className="flex-1" onClick={exportJson}>
              <Download />
              JSON
            </Button>
          </div>
        </form>
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Unique" value={(summary?.uniqueResultCount ?? prospects.length).toLocaleString()} />
        <MetricCard
          label="Raw"
          value={(summary?.rawResultCount ?? 0).toLocaleString()}
        />
        <MetricCard label="Queries" value={(summary?.queryCount ?? 0).toLocaleString()} />
      </div>

      {(error || status) && (
        <div
          className={
            error
              ? 'rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'
              : 'rounded-md border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300'
          }
        >
          {error ?? status}
        </div>
      )}

      {summary?.savedList ? (
        <section className="rounded-md border border-emerald-500/25 bg-emerald-500/10 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                <p className="font-medium text-foreground">{summary.savedList.listName}</p>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {summary.savedList.contactCount.toLocaleString()} saved to this list.{' '}
                {summary.savedList.dialerImportedCount.toLocaleString()} added to the dialer
                {summary.savedList.dialerSkippedCount > 0
                  ? `, ${summary.savedList.dialerSkippedCount.toLocaleString()} already queued`
                  : ''}
                {summary.savedList.masterSkippedCount > 0
                  ? `, ${summary.savedList.masterSkippedCount.toLocaleString()} already assigned in the master list`
                  : ''}
                .
              </p>
              {summary.savedList.warning ? (
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{summary.savedList.warning}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={openSavedListInLeads}>
                <ListChecks />
                Open in Leads
              </Button>
              <Button type="button" onClick={openSavedListInDialer}>
                <Phone />
                Open in Dialer
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-md border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-base font-semibold text-foreground">{modeLeadLabel(scraperMode)}</h2>
          </div>
          <Badge variant="outline">{prospects.length.toLocaleString()} shown</Badge>
        </div>

        {loading ? (
          <div className="flex min-h-[260px] items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {modeLoadingLabel(scraperMode)}
          </div>
        ) : prospects.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[260px] px-4">Business</TableHead>
                <TableHead className="min-w-[180px]">Contact</TableHead>
                <TableHead className="min-w-[260px]">Address</TableHead>
                <TableHead className="min-w-[120px]">Rating</TableHead>
                <TableHead className="min-w-[120px]">Score</TableHead>
                <TableHead className="w-[160px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prospects.map((lead) => (
                <TableRow key={lead.placeId || `${lead.name}-${lead.formattedAddress}`}>
                  <TableCell className="px-4 whitespace-normal">
                    <div className="max-w-[340px]">
                      <p className="font-medium text-foreground">{lead.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {lead.agencyBusinessName || lead.primaryType || lead.industry}
                      </p>
                      {lead.websiteDomain ? (
                        <p className="mt-1 text-xs text-muted-foreground">{lead.websiteDomain}</p>
                      ) : null}
                      {lead.jobSignals?.[0] ? (
                        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                          {lead.jobSignals[0].source}: {lead.jobSignals[0].title}
                        </p>
                      ) : null}
                      {lead.evidenceSummary ? (
                        <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                          {lead.evidenceSummary}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {lead.phone ? (
                        <a
                          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          href={`tel:${lead.phone}`}
                        >
                          <Phone className="h-3.5 w-3.5" />
                          {lead.phone}
                        </a>
                      ) : (
                        <span className="text-sm text-muted-foreground">-</span>
                      )}
                      {lead.email ? (
                        <a
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          href={`mailto:${lead.email}`}
                        >
                          <Mail className="h-3.5 w-3.5" />
                          {lead.email}
                        </a>
                      ) : null}
                      {lead.website ? (
                        <a
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          href={lead.website}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <Globe2 className="h-3.5 w-3.5" />
                          Website
                        </a>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="max-w-[320px] text-sm text-muted-foreground">
                      {lead.formattedAddress || '-'}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-sm">
                      <Star className="h-3.5 w-3.5 text-amber-500" />
                      {formatRating(lead)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={lead.confidenceScore >= 75 ? 'default' : 'secondary'}
                      className={lead.confidenceScore >= 75 ? 'bg-emerald-600 text-white' : ''}
                    >
                      {lead.confidenceScore}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void copyLead(lead)}
                        title="Copy"
                        aria-label={`Copy ${lead.name}`}
                      >
                        <Copy />
                      </Button>
                      {lead.googleMapsUrl && scraperMode === 'google_places' ? (
                        <Button type="button" variant="ghost" size="icon-sm" asChild>
                          <a
                            href={lead.googleMapsUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Open map"
                            aria-label={`Open ${lead.name} in Google Maps`}
                          >
                            <MapPin />
                          </a>
                        </Button>
                      ) : null}
                      {lead.sourceUrl ? (
                        <Button type="button" variant="ghost" size="icon-sm" asChild>
                          <a
                            href={lead.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            title="Open source"
                            aria-label={`Open ${lead.name} source profile`}
                          >
                            <ExternalLink />
                          </a>
                        </Button>
                      ) : null}
                      {lead.website ? (
                        <Button type="button" variant="ghost" size="icon-sm" asChild>
                          <a
                            href={lead.website}
                            target="_blank"
                            rel="noreferrer"
                            title="Open website"
                            aria-label={`Open ${lead.name} website`}
                          >
                            <ExternalLink />
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex min-h-[260px] items-center justify-center px-4 text-center text-sm text-muted-foreground">
            No {modeLeadLabel(scraperMode)} yet.
          </div>
        )}
      </section>
    </div>
  );
}
