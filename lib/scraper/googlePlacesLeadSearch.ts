export type PlacesDisplayText = {
  text?: string;
};

export type PlacesLocation = {
  latitude?: number;
  longitude?: number;
};

export type PlacesApiPlace = {
  id?: string;
  displayName?: PlacesDisplayText;
  formattedAddress?: string;
  location?: PlacesLocation;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
  primaryType?: string;
  primaryTypeDisplayName?: PlacesDisplayText;
  businessStatus?: string;
};

type PlacesApiResponse = {
  places?: PlacesApiPlace[];
};

type PlacesApiErrorPayload = {
  error?: { message?: string; status?: string; details?: Array<{ reason?: string }> };
};

type LegacyPlacesTextSearchPlace = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
  types?: string[];
};

type LegacyPlacesDetailsPlace = LegacyPlacesTextSearchPlace & {
  formatted_phone_number?: string;
  international_phone_number?: string;
  website?: string;
  url?: string;
};

type LegacyPlacesResponse<T> = {
  status?: string;
  results?: T[];
  result?: T;
  error_message?: string;
};

export type LeadSearchQuery = {
  city: string;
  industry: string;
  textQuery: string;
};

export type PlacesLead = {
  placeId: string;
  name: string;
  city: string;
  industry: string;
  query: string;
  formattedAddress: string;
  primaryType: string;
  phone: string;
  website: string;
  websiteDomain: string;
  googleMapsUrl: string;
  rating: number | null;
  userRatingCount: number | null;
  latitude: number | null;
  longitude: number | null;
  businessStatus: string | null;
  confidenceScore: number;
  leadCategory?: 'generic' | 'real_estate_team' | 'real_estate_individual_agent' | 'real_estate_brokerage';
  evidenceSummary?: string;
  leadSource?: 'places' | 'job_signals';
  jobSignals?: PlacesCompanyJobSignal[];
};

export type PlacesLeadSearchResult = {
  startedAt: string;
  completedAt: string;
  queryCount: number;
  rawResultCount: number;
  uniqueResultCount: number;
  prospects: PlacesLead[];
  queryPreview: LeadSearchQuery[];
};

export type PlacesLeadSearchOptions = {
  apiKey: string;
  city: string;
  industry: string;
  leadIntent?: 'generic' | 'real_estate_agents' | 'real_estate_individual_agents' | 'real_estate_teams' | 'real_estate_brokerages';
  countryCode?: string;
  region?: string;
  languageCode?: string;
  includedType?: string;
  pageSize?: number;
  relatedTerms?: string[];
};

export type PlacesCompanyJobSignal = {
  company: string;
  title: string;
  source: string;
  url: string;
  snippet: string;
  query: string;
  score: number;
};

type PlacesApiKeySource = 'GOOGLE_PLACES_API_KEY' | 'GOOGLE_API_KEY';

const MAX_AUTO_QUERY_TERMS = 14;

const REAL_ESTATE_TEAM_TERMS = [
  'real estate team',
  'realtor team',
  'realtor group',
  'real estate group',
  'real estate agents team',
  'residential real estate team',
  'homes team',
  'realty group',
] as const;

const REAL_ESTATE_AGENT_TERMS = [
  'real estate agent',
  'realtor',
  'residential realtor',
  'local realtor',
  'real estate salesperson',
  'real estate professional',
  'homes for sale realtor',
  'buyer agent',
  'listing agent',
] as const;

const REAL_ESTATE_INDIVIDUAL_AGENT_TERMS = [
  'realtor',
  'real estate agent',
  'real estate broker',
  'real estate salesperson',
  'residential realtor',
  'local realtor',
  'listing agent',
  'buyer agent',
  'solo realtor',
  'independent realtor',
] as const;

const REAL_ESTATE_BROKERAGE_TERMS = [
  'real estate brokerage',
  'real estate office',
  'realtor office',
  'realty brokerage',
  'realty office',
  'real estate agency',
  'brokerage office',
  'real estate broker office',
  'residential real estate brokerage',
] as const;

const PLACES_API_RESTRICTION_MESSAGE =
  'Google Places is blocked for the configured API key. Set GOOGLE_PLACES_API_KEY to a server key whose Google Cloud API restrictions include Places API (New). If you rely on the legacy fallback, also allow Places API. Avoid using a browser-only Google Maps key for this server route.';

export function getPlacesApiKey(): string {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || '';
}

export function getPlacesApiKeySource(): PlacesApiKeySource | null {
  if (process.env.GOOGLE_PLACES_API_KEY?.trim()) return 'GOOGLE_PLACES_API_KEY';
  if (process.env.GOOGLE_API_KEY?.trim()) return 'GOOGLE_API_KEY';
  return null;
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

class GooglePlacesRequestError extends Error {
  reason?: string;

  constructor(message: string, reason?: string) {
    super(message);
    this.name = 'GooglePlacesRequestError';
    this.reason = reason;
  }
}

function shouldFallbackToLegacyPlaces(error: unknown): boolean {
  return (
    error instanceof GooglePlacesRequestError &&
    (error.reason === 'API_KEY_SERVICE_BLOCKED' || error.message.includes('API_KEY_SERVICE_BLOCKED'))
  );
}

function isGooglePlacesApiRestrictionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const reason = error instanceof GooglePlacesRequestError ? error.reason : undefined;
  const message = error.message.toLowerCase();

  return (
    reason === 'API_KEY_SERVICE_BLOCKED' ||
    reason === 'REQUEST_DENIED' ||
    reason === 'PERMISSION_DENIED' ||
    message.includes('api_key_service_blocked') ||
    message.includes('not authorized to use this service or api')
  );
}

export function formatGooglePlacesSearchError(error: unknown): string {
  if (isGooglePlacesApiRestrictionError(error)) {
    const source = getPlacesApiKeySource();
    return source === 'GOOGLE_API_KEY'
      ? `${PLACES_API_RESTRICTION_MESSAGE} The server is currently falling back to GOOGLE_API_KEY; add a dedicated GOOGLE_PLACES_API_KEY for the scraper.`
      : PLACES_API_RESTRICTION_MESSAGE;
  }

  return error instanceof Error ? error.message : 'Google Places lead search failed.';
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function uniqueNormalizedTerms(terms: string[]): string[] {
  return Array.from(
    new Map(
      terms
        .map((term) => term.trim())
        .filter(Boolean)
        .map((term) => [normalizeText(term), term])
    ).values()
  );
}

function includesAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function inferRelatedIndustryTerms(industry: string): string[] {
  const normalized = normalizeText(industry);
  const terms: string[] = [];

  if (includesAny(normalized, ['roof', 'roofer'])) {
    terms.push(
      'roofing contractor',
      'roofing company',
      'roofing service',
      'commercial roofing contractor',
      'commercial roofing company',
      'roof repair',
      'roof replacement',
      'flat roof repair',
      'metal roofing',
      'shingle roofing',
      'industrial roofing',
      'siding and roofing'
    );
  } else if (includesAny(normalized, ['driveway', 'paving', 'asphalt', 'sealcoat', 'seal coating', 'sealcoating'])) {
    terms.push(
      'driveway sealing',
      'driveway paving',
      'asphalt paving',
      'asphalt sealing',
      'sealcoating',
      'paving contractor',
      'driveway repair',
      'new driveway',
      'parking lot sealing'
    );
  } else if (includesAny(normalized, ['plumb'])) {
    terms.push(
      'plumbing contractor',
      'plumbing company',
      'plumbing service',
      'plumber',
      'emergency plumber',
      'commercial plumber',
      'drain cleaning',
      'water heater repair',
      'sewer repair'
    );
  } else if (includesAny(normalized, ['hvac', 'heating', 'air conditioning'])) {
    terms.push(
      'HVAC contractor',
      'HVAC company',
      'heating contractor',
      'air conditioning contractor',
      'air conditioning repair',
      'furnace repair',
      'commercial HVAC',
      'heating and cooling'
    );
  } else if (includesAny(normalized, ['electric'])) {
    terms.push(
      'electrical contractor',
      'electrical company',
      'electrician',
      'commercial electrician',
      'residential electrician',
      'electrical repair',
      'emergency electrician'
    );
  } else if (includesAny(normalized, ['landscap', 'lawn'])) {
    terms.push(
      'landscaping company',
      'landscape contractor',
      'lawn care service',
      'property maintenance',
      'snow removal',
      'grounds maintenance',
      'garden maintenance'
    );
  } else if (includesAny(normalized, ['pest'])) {
    terms.push('pest control company', 'pest control service', 'exterminator', 'commercial pest control', 'wildlife control');
  } else if (includesAny(normalized, ['clean'])) {
    terms.push('cleaning company', 'cleaning service', 'commercial cleaning service', 'janitorial service', 'office cleaning');
  } else if (includesAny(normalized, ['paint', 'painter'])) {
    terms.push(
      'painting company',
      'house painter',
      'exterior painting',
      'interior painting',
      'residential painting',
      'commercial painting',
      'cabinet painting'
    );
  } else if (includesAny(normalized, ['real estate', 'realtor', 'brokerage'])) {
    terms.push(
      'real estate team',
      'realtor team',
      'real estate brokerage',
      'real estate group',
      'realtor group',
      'real estate agents',
      'residential real estate'
    );
  }

  if (terms.length === 0 && normalized) {
    terms.push(`${industry} company`, `${industry} service`, `${industry} contractor`);
  }

  return terms;
}

function domainFromUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function scoreLead(place: PlacesApiPlace, industry: string): number {
  const name = place.displayName?.text ?? '';
  const primaryType = place.primaryTypeDisplayName?.text ?? place.primaryType ?? '';
  const address = place.formattedAddress ?? '';
  const haystack = normalizeText(`${name} ${primaryType} ${address}`);
  const normalizedIndustry = normalizeText(industry);
  const industryTokens = normalizedIndustry.split(' ').filter((token) => token.length >= 4);
  let score = 35;

  if (normalizedIndustry && haystack.includes(normalizedIndustry)) score += 28;
  if (industryTokens.length > 0) {
    const matchedTokenCount = industryTokens.filter((token) => haystack.includes(token)).length;
    score += Math.min(18, matchedTokenCount * 6);
  }
  if (primaryType) score += 5;
  if (place.websiteUri) score += 10;
  if (place.nationalPhoneNumber || place.internationalPhoneNumber) score += 16;
  if (place.businessStatus === 'OPERATIONAL') score += 6;
  if ((place.userRatingCount ?? 0) >= 10) score += 4;
  if ((place.userRatingCount ?? 0) >= 100) score += 3;
  if ((place.rating ?? 0) >= 4.5) score += 3;
  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') score -= 25;
  if (!place.nationalPhoneNumber && !place.internationalPhoneNumber) score -= 15;

  return Math.max(0, Math.min(100, score));
}

function realEstateTeamEvidence(place: PlacesApiPlace, queryTerm: string): {
  score: number;
  isLikelyTeam: boolean;
  evidence: string[];
} {
  const name = place.displayName?.text ?? '';
  const primaryType = place.primaryTypeDisplayName?.text ?? place.primaryType ?? '';
  const websiteDomain = domainFromUrl(place.websiteUri ?? '');
  const haystack = normalizeText(`${name} ${primaryType} ${websiteDomain} ${queryTerm}`);
  const evidence: string[] = [];
  let score = 18;

  const strongTeamSignals = [
    'team',
    'group',
    'realtor group',
    'realty group',
  ];
  const brokerageOfficeSignals = [
    'brokerage',
    'realty inc',
    'realty ltd',
    'real estate inc',
    'real estate ltd',
    'office',
    'branch',
    'franchise',
  ];
  const soloAgentSignals = [
    'realtor',
    'real estate expert',
    'real estate professional',
    'local real estate expert',
  ];
  const irrelevantSignals = [
    'mortgage',
    'property management',
    'condo management',
    'apartment',
    'inspection',
    'lawyer',
    'notary',
    'appraisal',
  ];

  const matchedStrongSignals = strongTeamSignals.filter((signal) => haystack.includes(signal));
  if (matchedStrongSignals.length > 0) {
    score += Math.min(42, matchedStrongSignals.length * 14);
    evidence.push(`team signal: ${matchedStrongSignals.slice(0, 3).join(', ')}`);
  }

  if (haystack.includes('real estate team') || haystack.includes('realtor team')) {
    score += 24;
    evidence.push('explicit team phrase');
  }

  if (/\b(the\s+)?[a-z0-9]+\s+team\b/i.test(name)) {
    score += 18;
    evidence.push('team-branded business name');
  }

  if (place.websiteUri) {
    score += 8;
    evidence.push('website');
  }
  if (place.nationalPhoneNumber || place.internationalPhoneNumber) score += 6;
  if (place.businessStatus === 'OPERATIONAL') score += 5;
  if ((place.userRatingCount ?? 0) >= 10) score += 4;
  if ((place.rating ?? 0) >= 4.5) score += 2;

  const matchedBrokerageSignals = brokerageOfficeSignals.filter((signal) => haystack.includes(signal));
  if (matchedBrokerageSignals.length > 0) {
    score -= 42;
    evidence.push(`brokerage-office signal: ${matchedBrokerageSignals[0]}`);
  }

  const matchedIrrelevantSignals = irrelevantSignals.filter((signal) => haystack.includes(signal));
  if (matchedIrrelevantSignals.length > 0) {
    score -= 45;
    evidence.push(`excluded signal: ${matchedIrrelevantSignals[0]}`);
  }

  const looksLikeSoloAgent =
    matchedStrongSignals.length === 0 &&
    soloAgentSignals.some((signal) => haystack.includes(signal)) &&
    !haystack.includes(' and ') &&
    !haystack.includes('&');
  if (looksLikeSoloAgent) {
    score -= 30;
    evidence.push('solo-agent signal');
  }

  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') {
    score -= 25;
    evidence.push(`status: ${place.businessStatus}`);
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  return {
    score: normalizedScore,
    isLikelyTeam:
      normalizedScore >= 55 &&
      matchedStrongSignals.length > 0 &&
      matchedBrokerageSignals.length === 0 &&
      matchedIrrelevantSignals.length === 0,
    evidence,
  };
}

function realEstateBrokerageEvidence(place: PlacesApiPlace, queryTerm: string): {
  score: number;
  isLikelyBrokerage: boolean;
  evidence: string[];
} {
  const name = place.displayName?.text ?? '';
  const primaryType = place.primaryTypeDisplayName?.text ?? place.primaryType ?? '';
  const websiteDomain = domainFromUrl(place.websiteUri ?? '');
  const haystack = normalizeText(`${name} ${primaryType} ${websiteDomain} ${queryTerm}`);
  const evidence: string[] = [];
  let score = 24;

  const brokerageSignals = [
    'brokerage',
    'real estate office',
    'realtor office',
    'realty office',
    'real estate agency',
    'realty',
    're max',
    'remax',
    'keller williams',
    'royal lepage',
    'century 21',
    'coldwell banker',
    'sotheby',
    'sutton',
    'exp realty',
  ];
  const matchedBrokerageSignals = brokerageSignals.filter((signal) => haystack.includes(signal));
  if (matchedBrokerageSignals.length > 0) {
    score += Math.min(46, matchedBrokerageSignals.length * 14);
    evidence.push(`brokerage signal: ${matchedBrokerageSignals.slice(0, 2).join(', ')}`);
  }

  if (haystack.includes('real estate brokerage') || haystack.includes('brokerage office')) {
    score += 18;
    evidence.push('explicit brokerage phrase');
  }

  const teamSignals = ['team', 'group', 'collective', 'associates'];
  const matchedTeamSignals = teamSignals.filter((signal) => haystack.includes(signal));
  if (matchedTeamSignals.length > 0 && matchedBrokerageSignals.length === 0) {
    score -= 18;
    evidence.push(`team signal: ${matchedTeamSignals[0]}`);
  }

  const irrelevantSignals = [
    'mortgage',
    'property management',
    'condo management',
    'apartment',
    'inspection',
    'lawyer',
    'notary',
    'appraisal',
  ];
  const matchedIrrelevantSignals = irrelevantSignals.filter((signal) => haystack.includes(signal));
  if (matchedIrrelevantSignals.length > 0) {
    score -= 45;
    evidence.push(`excluded signal: ${matchedIrrelevantSignals[0]}`);
  }

  if (place.websiteUri) score += 8;
  if (place.nationalPhoneNumber || place.internationalPhoneNumber) score += 6;
  if (place.businessStatus === 'OPERATIONAL') score += 5;
  if ((place.userRatingCount ?? 0) >= 10) score += 4;
  if ((place.rating ?? 0) >= 4.5) score += 2;

  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') {
    score -= 25;
    evidence.push(`status: ${place.businessStatus}`);
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  return {
    score: normalizedScore,
    isLikelyBrokerage: normalizedScore >= 55 && matchedBrokerageSignals.length > 0 && matchedIrrelevantSignals.length === 0,
    evidence,
  };
}

function hasLikelyFirstLastName(value: string): boolean {
  const nameStopWords = new Set([
    'and',
    'agency',
    'at',
    'banker',
    'broker',
    'brokerage',
    'century',
    'coldwell',
    'estate',
    'exp',
    'group',
    'home',
    'homes',
    'inc',
    'keller',
    'llc',
    'ltd',
    'lepage',
    'max',
    'one',
    'premier',
    'properties',
    'property',
    'real',
    'realtor',
    'realty',
    'remax',
    'royal',
    'sales',
    'sotheby',
    'sothebys',
    'sutton',
    'team',
    'the',
    'williams',
  ]);
  const tokens = value
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, ''))
    .filter((token) => token.length >= 2);

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const pair = tokens.slice(index, index + 2);
    const normalizedPair = pair.map((token) => normalizeText(token));
    if (normalizedPair.some((token) => !token || nameStopWords.has(token))) continue;
    if (pair.every((token) => /^[A-Z][A-Za-z'-]+$/.test(token) || /^[A-Z]{2,}$/.test(token))) return true;
  }

  return false;
}

function realEstateIndividualAgentEvidence(place: PlacesApiPlace, queryTerm: string): {
  score: number;
  isLikelyIndividualAgent: boolean;
  evidence: string[];
} {
  const name = place.displayName?.text ?? '';
  const primaryType = place.primaryTypeDisplayName?.text ?? place.primaryType ?? '';
  const websiteDomain = domainFromUrl(place.websiteUri ?? '');
  const haystack = normalizeText(`${name} ${primaryType} ${websiteDomain} ${queryTerm}`);
  const evidence: string[] = [];
  let score = 16;

  const hasPersonName = hasLikelyFirstLastName(name);
  if (hasPersonName) {
    score += 46;
    evidence.push('first-last name in Google listing');
  } else {
    score -= 38;
    evidence.push('missing first-last name');
  }

  const agentSignals = [
    'realtor',
    'real estate agent',
    'real estate broker',
    'real estate salesperson',
    'listing agent',
    'buyer agent',
    'sales representative',
  ];
  const matchedAgentSignals = agentSignals.filter((signal) => haystack.includes(signal));
  if (matchedAgentSignals.length > 0) {
    score += Math.min(24, matchedAgentSignals.length * 8);
    evidence.push(`agent signal: ${matchedAgentSignals.slice(0, 2).join(', ')}`);
  }

  const teamOrOfficeSignals = [
    'team',
    'group',
    'collective',
    'associates',
    'partners',
    'brokerage',
    'office',
    'branch',
    'franchise',
    'property management',
  ];
  const matchedTeamOrOfficeSignals = teamOrOfficeSignals.filter((signal) => haystack.includes(signal));
  if (matchedTeamOrOfficeSignals.length > 0) {
    score -= hasPersonName ? 18 : 36;
    evidence.push(`team-office signal: ${matchedTeamOrOfficeSignals[0]}`);
  }

  const irrelevantSignals = [
    'mortgage',
    'condo management',
    'apartment',
    'inspection',
    'lawyer',
    'notary',
    'appraisal',
  ];
  const matchedIrrelevantSignals = irrelevantSignals.filter((signal) => haystack.includes(signal));
  if (matchedIrrelevantSignals.length > 0) {
    score -= 45;
    evidence.push(`excluded signal: ${matchedIrrelevantSignals[0]}`);
  }

  if (place.websiteUri) score += 6;
  if (place.nationalPhoneNumber || place.internationalPhoneNumber) score += 8;
  if (place.businessStatus === 'OPERATIONAL') score += 5;
  if ((place.userRatingCount ?? 0) >= 10) score += 4;
  if ((place.rating ?? 0) >= 4.5) score += 2;

  if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') {
    score -= 25;
    evidence.push(`status: ${place.businessStatus}`);
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  return {
    score: normalizedScore,
    isLikelyIndividualAgent: normalizedScore >= 55 && hasPersonName && matchedIrrelevantSignals.length === 0,
    evidence,
  };
}

function buildQueries(options: PlacesLeadSearchOptions): LeadSearchQuery[] {
  const city = options.city.trim();
  const industry = options.industry.trim();
  const region = options.region?.trim();
  const terms =
    options.leadIntent === 'real_estate_teams'
      ? uniqueNormalizedTerms([
          ...REAL_ESTATE_TEAM_TERMS,
          ...(options.relatedTerms ?? []),
        ]).slice(0, MAX_AUTO_QUERY_TERMS)
      : options.leadIntent === 'real_estate_agents'
        ? uniqueNormalizedTerms([
            ...REAL_ESTATE_AGENT_TERMS,
            ...(options.relatedTerms ?? []),
          ]).slice(0, MAX_AUTO_QUERY_TERMS)
        : options.leadIntent === 'real_estate_individual_agents'
          ? uniqueNormalizedTerms([
              ...REAL_ESTATE_INDIVIDUAL_AGENT_TERMS,
              ...(options.relatedTerms ?? []),
            ]).slice(0, MAX_AUTO_QUERY_TERMS)
          : options.leadIntent === 'real_estate_brokerages'
            ? uniqueNormalizedTerms([
                ...REAL_ESTATE_BROKERAGE_TERMS,
                ...(options.relatedTerms ?? []),
              ]).slice(0, MAX_AUTO_QUERY_TERMS)
        : uniqueNormalizedTerms([
            industry,
            ...inferRelatedIndustryTerms(industry),
            ...(options.relatedTerms ?? []),
          ]).slice(0, MAX_AUTO_QUERY_TERMS);

  return terms.map((term) => ({
    city,
    industry: term,
    textQuery: [term, city, region].filter(Boolean).join(' '),
  }));
}

function legacyTypeLabel(types: string[] | undefined): string {
  return types?.[0]?.replace(/_/g, ' ') ?? '';
}

function googleMapsUrlFromPlaceId(placeId: string): string {
  return placeId ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}` : '';
}

function serializeLegacyPlace(
  place: LegacyPlacesDetailsPlace,
  query: LeadSearchQuery
): PlacesApiPlace {
  const placeId = place.place_id ?? '';
  return {
    id: placeId,
    displayName: { text: place.name ?? '' },
    formattedAddress: place.formatted_address ?? '',
    location: {
      latitude: place.geometry?.location?.lat,
      longitude: place.geometry?.location?.lng,
    },
    rating: place.rating,
    userRatingCount: place.user_ratings_total,
    websiteUri: place.website,
    nationalPhoneNumber: place.formatted_phone_number,
    internationalPhoneNumber: place.international_phone_number,
    googleMapsUri: place.url ?? googleMapsUrlFromPlaceId(placeId),
    primaryType: place.types?.[0],
    primaryTypeDisplayName: { text: legacyTypeLabel(place.types) || query.industry },
    businessStatus: place.business_status,
  };
}

function buildLegacyUrl(pathname: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(`https://maps.googleapis.com/maps/api/place/${pathname}/json`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function assertLegacyPlacesOk<T>(payload: LegacyPlacesResponse<T>, fallbackMessage: string): void {
  const status = payload.status;
  if (!status || status === 'OK' || status === 'ZERO_RESULTS') return;
  throw new GooglePlacesRequestError(payload.error_message || fallbackMessage, status);
}

async function callLegacyPlaceDetails(
  options: PlacesLeadSearchOptions,
  query: LeadSearchQuery,
  place: LegacyPlacesTextSearchPlace
): Promise<LegacyPlacesDetailsPlace> {
  const placeId = place.place_id;
  if (!placeId) return place;

  const response = await fetch(
    buildLegacyUrl('details', {
      key: options.apiKey,
      place_id: placeId,
      language: options.languageCode ?? 'en',
      fields: [
        'place_id',
        'name',
        'formatted_address',
        'geometry/location',
        'rating',
        'user_ratings_total',
        'website',
        'formatted_phone_number',
        'international_phone_number',
        'url',
        'type',
        'business_status',
      ].join(','),
    })
  );
  const payload = (await response.json().catch(() => ({}))) as LegacyPlacesResponse<LegacyPlacesDetailsPlace>;

  if (!response.ok) {
    throw new GooglePlacesRequestError(
      payload.error_message || `Google Places details request failed with ${response.status}.`,
      payload.status
    );
  }

  assertLegacyPlacesOk(payload, 'Google Places details request failed.');
  return { ...place, ...(payload.result ?? {}) };
}

async function callLegacyPlacesSearch(
  options: PlacesLeadSearchOptions,
  query: LeadSearchQuery
): Promise<PlacesApiPlace[]> {
  const countryCode = options.countryCode?.trim().toLowerCase();
  const response = await fetch(
    buildLegacyUrl('textsearch', {
      key: options.apiKey,
      query: query.textQuery,
      language: options.languageCode ?? 'en',
      region: countryCode,
      type: options.includedType?.trim(),
    })
  );
  const payload = (await response.json().catch(() => ({}))) as LegacyPlacesResponse<LegacyPlacesTextSearchPlace>;

  if (!response.ok) {
    throw new GooglePlacesRequestError(
      payload.error_message || `Google Places text search request failed with ${response.status}.`,
      payload.status
    );
  }

  assertLegacyPlacesOk(payload, 'Google Places text search request failed.');

  const pageSize = Math.max(1, Math.min(20, options.pageSize ?? 12));
  const results = (payload.results ?? []).slice(0, pageSize);
  const withDetails = await Promise.all(
    results.map((place) => callLegacyPlaceDetails(options, query, place))
  );

  return withDetails.map((place) => serializeLegacyPlace(place, query));
}

async function callPlacesSearch(
  options: PlacesLeadSearchOptions,
  query: LeadSearchQuery
): Promise<PlacesApiPlace[]> {
  const body: Record<string, unknown> = {
    textQuery: query.textQuery,
    languageCode: options.languageCode ?? 'en',
    pageSize: Math.max(1, Math.min(20, options.pageSize ?? 12)),
  };

  const countryCode = options.countryCode?.trim().toUpperCase();
  if (countryCode) body.regionCode = countryCode;

  const includedType = options.includedType?.trim();
  if (includedType) body.includedType = includedType;

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': options.apiKey,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.websiteUri',
        'places.nationalPhoneNumber',
        'places.internationalPhoneNumber',
        'places.googleMapsUri',
        'places.primaryType',
        'places.primaryTypeDisplayName',
        'places.businessStatus',
      ].join(','),
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => ({}))) as PlacesApiResponse & {
    error?: { message?: string; status?: string; details?: Array<{ reason?: string }> };
  } & PlacesApiErrorPayload;

  if (!response.ok) {
    const reason = payload.error?.details?.find((detail) => detail.reason)?.reason;
    const suffix = reason ? ` (${reason})` : '';
    throw new GooglePlacesRequestError(
      payload.error?.message
        ? `${payload.error.message}${suffix}`
        : `Google Places request failed with ${response.status}.`,
      reason ?? payload.error?.status
    );
  }

  return payload.places ?? [];
}

function serializeLead(
  place: PlacesApiPlace,
  query: LeadSearchQuery,
  options?: Pick<PlacesLeadSearchOptions, 'leadIntent'>
): PlacesLead {
  const name = place.displayName?.text?.trim() ?? '';
  const primaryType = place.primaryTypeDisplayName?.text ?? place.primaryType ?? '';
  const phone = place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? '';
  const website = place.websiteUri ?? '';
  const teamEvidence = options?.leadIntent === 'real_estate_teams'
    ? realEstateTeamEvidence(place, query.industry)
    : null;
  const individualAgentEvidence = options?.leadIntent === 'real_estate_individual_agents'
    ? realEstateIndividualAgentEvidence(place, query.industry)
    : null;
  const brokerageEvidence = options?.leadIntent === 'real_estate_brokerages'
    ? realEstateBrokerageEvidence(place, query.industry)
    : null;

  return {
    placeId: place.id ?? '',
    name,
    city: query.city,
    industry: query.industry,
    query: query.textQuery,
    formattedAddress: place.formattedAddress ?? '',
    primaryType,
    phone,
    website,
    websiteDomain: domainFromUrl(website),
    googleMapsUrl: place.googleMapsUri ?? '',
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? null,
    latitude: place.location?.latitude ?? null,
    longitude: place.location?.longitude ?? null,
    businessStatus: place.businessStatus ?? null,
    confidenceScore: teamEvidence?.score ?? individualAgentEvidence?.score ?? brokerageEvidence?.score ?? scoreLead(place, query.industry),
    leadCategory: teamEvidence
      ? 'real_estate_team'
      : individualAgentEvidence
        ? 'real_estate_individual_agent'
        : brokerageEvidence
          ? 'real_estate_brokerage'
          : 'generic',
    evidenceSummary: teamEvidence?.evidence.join('; ') || individualAgentEvidence?.evidence.join('; ') || brokerageEvidence?.evidence.join('; ') || undefined,
  };
}

function shouldKeepLead(prospect: PlacesLead, options: PlacesLeadSearchOptions): boolean {
  if (options.leadIntent === 'real_estate_individual_agents') {
    if (prospect.leadCategory !== 'real_estate_individual_agent') return false;
    if (prospect.confidenceScore < 55) return false;

    const evidence = normalizeText(prospect.evidenceSummary ?? '');
    return evidence.includes('first last name in google listing') && !evidence.includes('missing first last name');
  }

  if (options.leadIntent === 'real_estate_teams') {
    if (prospect.leadCategory !== 'real_estate_team') return false;
    if (prospect.confidenceScore < 55) return false;

    const evidence = normalizeText(prospect.evidenceSummary ?? '');
    if (evidence.includes('brokerage office signal') || evidence.includes('excluded signal')) return false;
    return evidence.includes('team signal') || evidence.includes('explicit team phrase') || evidence.includes('team branded business name');
  }

  if (options.leadIntent === 'real_estate_brokerages') {
    if (prospect.leadCategory !== 'real_estate_brokerage') return false;
    if (prospect.confidenceScore < 55) return false;

    const evidence = normalizeText(prospect.evidenceSummary ?? '');
    return (evidence.includes('brokerage signal') || evidence.includes('explicit brokerage phrase')) && !evidence.includes('excluded signal');
  }

  return true;
}

function placeDedupeKey(prospect: PlacesLead): string {
  return (
    prospect.placeId ||
    [
      normalizeText(prospect.name),
      normalizePhone(prospect.phone),
      prospect.websiteDomain,
      normalizeText(prospect.formattedAddress),
    ]
      .filter(Boolean)
      .join(':')
  );
}

function companyNameMatchScore(placeName: string, companyName: string): number {
  const placeTokens = new Set(normalizeText(placeName).split(' ').filter((token) => token.length >= 3));
  const companyTokens = normalizeText(companyName).split(' ').filter((token) => token.length >= 3);
  if (companyTokens.length === 0) return 0;

  const matchedTokens = companyTokens.filter((token) => placeTokens.has(token)).length;
  return Math.round((matchedTokens / companyTokens.length) * 100);
}

function mergeJobSignals(existing: PlacesCompanyJobSignal[] | undefined, next: PlacesCompanyJobSignal): PlacesCompanyJobSignal[] {
  const signals = new Map<string, PlacesCompanyJobSignal>();
  for (const signal of existing ?? []) signals.set(signal.url || `${signal.source}:${signal.title}`, signal);
  signals.set(next.url || `${next.source}:${next.title}`, next);
  return Array.from(signals.values()).sort((a, b) => b.score - a.score).slice(0, 5);
}

export async function searchGooglePlacesLeadsForJobSignals(
  options: PlacesLeadSearchOptions,
  signals: PlacesCompanyJobSignal[]
): Promise<PlacesLeadSearchResult> {
  const startedAt = new Date().toISOString();
  const placesByKey = new Map<string, PlacesLead>();
  const companySignals = new Map<string, PlacesCompanyJobSignal>();
  let rawResultCount = 0;
  let useLegacyPlaces = false;

  for (const signal of signals) {
    const companyKey = normalizeText(signal.company);
    if (!companyKey || companySignals.has(companyKey)) continue;
    companySignals.set(companyKey, signal);
  }

  const queries = Array.from(companySignals.values()).slice(0, Math.max(1, Math.min(20, options.pageSize ?? 12))).map((signal) => ({
    city: options.city.trim(),
    industry: signal.company,
    textQuery: [signal.company, options.city.trim(), options.region?.trim()].filter(Boolean).join(' '),
  }));

  for (const query of queries) {
    const signal = companySignals.get(normalizeText(query.industry));
    if (!signal) continue;

    let places: PlacesApiPlace[];
    try {
      places = useLegacyPlaces
        ? await callLegacyPlacesSearch({ ...options, pageSize: 3 }, query)
        : await callPlacesSearch({ ...options, pageSize: 3 }, query);
    } catch (error) {
      if (!useLegacyPlaces && shouldFallbackToLegacyPlaces(error)) {
        useLegacyPlaces = true;
        places = await callLegacyPlacesSearch({ ...options, pageSize: 3 }, query);
      } else {
        throw error;
      }
    }

    rawResultCount += places.length;
    const candidates = places
      .map((place) => {
        const prospect = serializeLead(place, {
          city: query.city,
          industry: options.industry,
          textQuery: signal.query,
        });
        const nameMatch = companyNameMatchScore(prospect.name, signal.company);
        return {
          prospect,
          matchScore: nameMatch + prospect.confidenceScore + signal.score,
        };
      })
      .filter(({ prospect }) => prospect.name);

    const best = candidates.sort((a, b) => b.matchScore - a.matchScore)[0]?.prospect;
    if (!best) continue;

    best.leadSource = 'job_signals';
    best.jobSignals = mergeJobSignals(best.jobSignals, signal);
    best.confidenceScore = Math.min(100, Math.max(best.confidenceScore, 70 + Math.round(signal.score / 6)));

    const dedupeKey = placeDedupeKey(best);
    const existing = placesByKey.get(dedupeKey);
    if (!existing) {
      placesByKey.set(dedupeKey, best);
      continue;
    }

    existing.jobSignals = mergeJobSignals(existing.jobSignals, signal);
    existing.confidenceScore = Math.max(existing.confidenceScore, best.confidenceScore);
  }

  const prospects = Array.from(placesByKey.values()).sort((a, b) => {
    const aSignalScore = a.jobSignals?.[0]?.score ?? 0;
    const bSignalScore = b.jobSignals?.[0]?.score ?? 0;
    if (bSignalScore !== aSignalScore) return bSignalScore - aSignalScore;
    const aDialable = Boolean(normalizePhone(a.phone));
    const bDialable = Boolean(normalizePhone(b.phone));
    if (aDialable !== bDialable) return bDialable ? 1 : -1;
    return b.confidenceScore - a.confidenceScore;
  });

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    queryCount: queries.length,
    rawResultCount,
    uniqueResultCount: prospects.length,
    prospects,
    queryPreview: queries.slice(0, 12),
  };
}

export async function searchGooglePlacesLeads(
  options: PlacesLeadSearchOptions
): Promise<PlacesLeadSearchResult> {
  const startedAt = new Date().toISOString();
  const queries = buildQueries(options);
  const placesByKey = new Map<string, PlacesLead>();
  let rawResultCount = 0;
  let useLegacyPlaces = false;

  for (const query of queries) {
    let places: PlacesApiPlace[];
    try {
      places = useLegacyPlaces
        ? await callLegacyPlacesSearch(options, query)
        : await callPlacesSearch(options, query);
    } catch (error) {
      if (!useLegacyPlaces && shouldFallbackToLegacyPlaces(error)) {
        useLegacyPlaces = true;
        places = await callLegacyPlacesSearch(options, query);
      } else {
        throw error;
      }
    }
    rawResultCount += places.length;

    for (const place of places) {
      const prospect = serializeLead(place, query, options);
      if (!prospect.name) continue;
      if (!shouldKeepLead(prospect, options)) continue;

      const dedupeKey = placeDedupeKey(prospect);

      const existing = placesByKey.get(dedupeKey);
      if (!existing || prospect.confidenceScore > existing.confidenceScore) {
        placesByKey.set(dedupeKey, prospect);
      }
    }
  }

  const prospects = Array.from(placesByKey.values()).sort((a, b) => {
    const aDialable = Boolean(normalizePhone(a.phone));
    const bDialable = Boolean(normalizePhone(b.phone));
    if (aDialable !== bDialable) return bDialable ? 1 : -1;
    if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
    if ((b.rating ?? 0) !== (a.rating ?? 0)) return (b.rating ?? 0) - (a.rating ?? 0);
    return (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0);
  });

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    queryCount: queries.length,
    rawResultCount,
    uniqueResultCount: prospects.length,
    prospects,
    queryPreview: queries.slice(0, 12),
  };
}
