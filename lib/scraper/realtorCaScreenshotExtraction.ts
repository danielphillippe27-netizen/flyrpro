import type { PlacesLead } from '@/lib/scraper/googlePlacesLeadSearch';

export type RealtorCaScreenshotLead = PlacesLead & {
  sourceUrl?: string;
  classification?: string;
  role?: string;
  office?: string;
  agencyBusinessName?: string;
  streetAddress?: string;
  suburbCity?: string;
  state?: string;
  postcode?: string;
  screenshotName?: string;
};

export type RealtorCaScreenshotExtractionResult = {
  startedAt: string;
  completedAt: string;
  queryCount: number;
  rawResultCount: number;
  uniqueResultCount: number;
  prospects: RealtorCaScreenshotLead[];
};

type ScreenshotImageInput = {
  filename: string;
  mediaType: string;
  base64: string;
};

type ExtractScreenshotOptions = {
  city: string;
  provinceCode?: string;
  images: ScreenshotImageInput[];
};

type ExtractedVisionLead = {
  name?: unknown;
  role?: unknown;
  office?: unknown;
  brokerage?: unknown;
  phone?: unknown;
  address?: unknown;
  profileUrl?: unknown;
  sourceUrl?: unknown;
};

const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const POSTCODE_RE = /\b([A-Z]\d[A-Z])\s?(\d[A-Z]\d)\b/i;

function compactSpaces(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizePhone(value: unknown): string {
  const match = compactSpaces(value).match(PHONE_RE);
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

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced ?? trimmed;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  return JSON.parse(raw.slice(start, end + 1));
}

function toLead(params: {
  item: ExtractedVisionLead;
  city: string;
  filename: string;
  index: number;
}): RealtorCaScreenshotLead | null {
  const name = compactSpaces(params.item.name);
  const phone = normalizePhone(params.item.phone);
  const address = compactSpaces(params.item.address);
  const office = compactSpaces(params.item.office || params.item.brokerage);
  const role = compactSpaces(params.item.role);
  const sourceUrl = compactSpaces(params.item.sourceUrl || params.item.profileUrl);
  if (!name || (!phone && !office && !address)) return null;

  const addressParts = splitAddress(address);
  return {
    placeId: `realtor-ca-screenshot:${params.filename}:${params.index}:${normalizeText(name)}`,
    name,
    city: addressParts.suburbCity || params.city,
    industry: 'REALTOR.ca screenshot import',
    query: 'REALTOR.ca screenshot import',
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
    confidenceScore: phone && address ? 85 : phone || address ? 70 : 55,
    classification: 'individual_agent',
    leadCategory: 'real_estate_individual_agent',
    evidenceSummary: [office ? `Office: ${office}` : '', role ? `Role: ${role}` : '', `Screenshot: ${params.filename}`]
      .filter(Boolean)
      .join(' | '),
    leadSource: 'places',
    sourceUrl,
    role,
    office,
    agencyBusinessName: office,
    screenshotName: params.filename,
    ...addressParts,
  };
}

function dedupeLeads(leads: RealtorCaScreenshotLead[]): RealtorCaScreenshotLead[] {
  const seen = new Set<string>();
  const output: RealtorCaScreenshotLead[] = [];
  for (const lead of leads) {
    const key = lead.phone?.replace(/\D/g, '') || `${normalizeText(lead.name)}|${normalizeText(lead.office ?? '')}|${normalizeText(lead.formattedAddress)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(lead);
  }
  return output;
}

async function extractImageLeads(params: {
  apiKey: string;
  image: ScreenshotImageInput;
  city: string;
  provinceCode: string;
}): Promise<RealtorCaScreenshotLead[]> {
  const prompt = [
    'Extract visible REALTOR.ca agent result cards from this screenshot.',
    'Return ONLY valid JSON.',
    'Do not invent missing values. Use empty string for missing fields.',
    'Only include individual visible agents, not footer/navigation text.',
    `Expected market: ${params.city}, ${params.provinceCode.toUpperCase()}.`,
    'Schema: {"leads":[{"name":"","role":"","office":"","phone":"","address":"","sourceUrl":""}]}',
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${params.image.mediaType};base64,${params.image.base64}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Screenshot extraction failed: ${response.status} ${text.slice(0, 300)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return [];

  const parsed = parseJsonObject(content) as { leads?: ExtractedVisionLead[] } | null;
  const rows = Array.isArray(parsed?.leads) ? parsed.leads : [];
  return rows
    .map((item, index) => toLead({ item, city: params.city, filename: params.image.filename, index }))
    .filter((lead): lead is RealtorCaScreenshotLead => Boolean(lead));
}

export async function extractRealtorCaScreenshotLeads(
  options: ExtractScreenshotOptions
): Promise<RealtorCaScreenshotExtractionResult> {
  const startedAt = new Date().toISOString();
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  if (options.images.length === 0) throw new Error('Upload at least one REALTOR.ca screenshot.');

  const provinceCode = options.provinceCode || 'on';
  const batches = await Promise.all(
    options.images.map((image) =>
      extractImageLeads({
        apiKey,
        image,
        city: options.city,
        provinceCode,
      })
    )
  );
  const rawLeads = batches.flat();
  const prospects = dedupeLeads(rawLeads);

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    queryCount: options.images.length,
    rawResultCount: rawLeads.length,
    uniqueResultCount: prospects.length,
    prospects,
  };
}
