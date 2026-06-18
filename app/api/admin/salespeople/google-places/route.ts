import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import {
  formatGooglePlacesSearchError,
  getPlacesApiKey,
} from '@/lib/scraper/googlePlacesLeadSearch';

type PlacesDisplayText = {
  text?: string;
};

type PlacesLocation = {
  latitude?: number;
  longitude?: number;
};

type PlacesApiPlace = {
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

type SearchQuery = {
  city: string;
  term: string;
  textQuery: string;
};

type ProspectKind = 'agent_or_team' | 'brokerage_or_office' | 'maybe_irrelevant';

const ALBERTA_CITY_PRESETS = {
  major: [
    'Calgary',
    'Edmonton',
    'Red Deer',
    'Lethbridge',
    'Medicine Hat',
    'Grande Prairie',
    'Fort McMurray',
    'Airdrie',
    'Cochrane',
    'Okotoks',
    'St. Albert',
    'Sherwood Park',
    'Spruce Grove',
    'Leduc',
    'Lloydminster',
  ],
  all: [
    'Calgary',
    'Edmonton',
    'Red Deer',
    'Lethbridge',
    'Medicine Hat',
    'Grande Prairie',
    'Fort McMurray',
    'Lloydminster',
    'Airdrie',
    'Cochrane',
    'Okotoks',
    'Chestermere',
    'St. Albert',
    'Sherwood Park',
    'Spruce Grove',
    'Leduc',
    'Beaumont',
    'Camrose',
    'Sylvan Lake',
    'Lacombe',
    'Brooks',
    'Canmore',
    'Banff',
    'High River',
    'Strathmore',
    'Fort Saskatchewan',
    'Wetaskiwin',
    'Hinton',
    'Edson',
    'Whitecourt',
    'Cold Lake',
    'Bonnyville',
    'Taber',
    'Drumheller',
    'Olds',
    'Didsbury',
    'Innisfail',
    'Rocky Mountain House',
  ],
} as const;

const DEFAULT_TERMS = [
  'real estate agent',
  'realtor',
  'real estate salesperson',
  'residential real estate agent',
] as const;

const requestSchema = z.object({
  cityPreset: z.enum(['major', 'all']).default('major'),
  cities: z.array(z.string().trim().min(2).max(80)).max(80).optional(),
  terms: z.array(z.string().trim().min(2).max(120)).max(8).optional(),
  maxQueries: z.number().int().min(1).max(200).default(40),
  pageSize: z.number().int().min(1).max(20).default(20),
});

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function domainFromUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function inferProspectKind(name: string, website: string, primaryType: string): ProspectKind {
  const haystack = normalizeText(`${name} ${website} ${primaryType}`);
  const irrelevantTerms = [
    'mortgage',
    'lending',
    'loan',
    'property management',
    'condo management',
    'inspection',
    'insurance',
    'lawyer',
    'notary',
    'appraisal',
  ];
  if (irrelevantTerms.some((term) => haystack.includes(term))) return 'maybe_irrelevant';

  const brokerageTerms = [
    'brokerage',
    'realty',
    're max',
    'royal lepage',
    'century 21',
    'exp realty',
    'maxwell',
    'cir realty',
    'coldwell banker',
    'sotheby',
  ];
  const agentTerms = [
    'realtor',
    'real estate agent',
    'real estate team',
    'real estate group',
    'homes',
    'yyc',
    'yeg',
  ];

  if (agentTerms.some((term) => haystack.includes(term))) return 'agent_or_team';
  if (brokerageTerms.some((term) => haystack.includes(term))) return 'brokerage_or_office';
  return 'agent_or_team';
}

function scoreProspect(place: PlacesApiPlace, kind: ProspectKind): number {
  let score = kind === 'agent_or_team' ? 70 : kind === 'brokerage_or_office' ? 52 : 25;
  if (place.websiteUri) score += 10;
  if (place.nationalPhoneNumber || place.internationalPhoneNumber) score += 8;
  if ((place.userRatingCount ?? 0) >= 10) score += 6;
  if ((place.rating ?? 0) >= 4.5) score += 4;
  if (place.businessStatus === 'OPERATIONAL') score += 4;
  return Math.max(0, Math.min(100, score));
}

function buildQueries(cities: string[], terms: string[], maxQueries: number): SearchQuery[] {
  const queries: SearchQuery[] = [];
  const seen = new Set<string>();

  for (const city of cities) {
    for (const term of terms) {
      const textQuery = `${term} ${city} Alberta`;
      const key = normalizeText(textQuery);
      if (seen.has(key)) continue;
      seen.add(key);
      queries.push({ city, term, textQuery });
      if (queries.length >= maxQueries) return queries;
    }
  }

  return queries;
}

async function callPlacesSearch(
  apiKey: string,
  query: SearchQuery,
  pageSize: number
): Promise<PlacesApiPlace[]> {
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
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
    body: JSON.stringify({
      textQuery: query.textQuery,
      regionCode: 'CA',
      languageCode: 'en',
      includedType: 'real_estate_agency',
      pageSize,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as PlacesApiResponse & {
    error?: { message?: string; status?: string; details?: Array<{ reason?: string }> };
  };

  if (!response.ok) {
    const reason = payload.error?.details?.find((detail) => detail.reason)?.reason;
    const suffix = reason ? ` (${reason})` : '';
    throw new Error(payload.error?.message ? `${payload.error.message}${suffix}` : `Google Places request failed with ${response.status}.`);
  }

  return payload.places ?? [];
}

function serializeProspect(place: PlacesApiPlace, query: SearchQuery) {
  const name = place.displayName?.text?.trim() ?? '';
  const primaryType = place.primaryTypeDisplayName?.text ?? place.primaryType ?? '';
  const phone = place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? '';
  const website = place.websiteUri ?? '';
  const kind = inferProspectKind(name, website, primaryType);

  return {
    placeId: place.id ?? '',
    name,
    city: query.city,
    query: query.textQuery,
    queryTerm: query.term,
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
    prospectKind: kind,
    confidenceScore: scoreProspect(place, kind),
  };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const apiKey = getPlacesApiKey();
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'Google Places is not configured. Set GOOGLE_PLACES_API_KEY on the server, or GOOGLE_API_KEY as a fallback.',
        },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message ?? 'Invalid Google Places scrape settings.' },
        { status: 400 }
      );
    }

    const cities =
      parsed.data.cities?.length
        ? parsed.data.cities
        : [...ALBERTA_CITY_PRESETS[parsed.data.cityPreset]];
    const terms = parsed.data.terms?.length ? parsed.data.terms : [...DEFAULT_TERMS];
    const queries = buildQueries(cities, terms, parsed.data.maxQueries);
    const startedAt = new Date().toISOString();
    const placesByKey = new Map<string, ReturnType<typeof serializeProspect>>();
    let rawResultCount = 0;

    for (const query of queries) {
      const places = await callPlacesSearch(apiKey, query, parsed.data.pageSize);
      rawResultCount += places.length;

      for (const place of places) {
        const prospect = serializeProspect(place, query);
        if (!prospect.name) continue;

        const dedupeKey =
          prospect.placeId ||
          [
            normalizeText(prospect.name),
            normalizePhone(prospect.phone),
            prospect.websiteDomain,
            normalizeText(prospect.formattedAddress),
          ]
            .filter(Boolean)
            .join(':');

        const existing = placesByKey.get(dedupeKey);
        if (!existing || prospect.confidenceScore > existing.confidenceScore) {
          placesByKey.set(dedupeKey, prospect);
        }
      }
    }

    const prospects = Array.from(placesByKey.values()).sort((a, b) => {
      if (b.confidenceScore !== a.confidenceScore) return b.confidenceScore - a.confidenceScore;
      return (b.userRatingCount ?? 0) - (a.userRatingCount ?? 0);
    });

    return NextResponse.json({
      ok: true,
      startedAt,
      completedAt: new Date().toISOString(),
      queryCount: queries.length,
      rawResultCount,
      uniqueResultCount: prospects.length,
      prospects,
      queryPreview: queries.slice(0, 12),
    });
  } catch (error) {
    console.error('[api/admin/salespeople/google-places] POST error:', error);
    const message = formatGooglePlacesSearchError(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
