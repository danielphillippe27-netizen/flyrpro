import { aggregationHoursForLayer, mapGradientForLayer, STORM_RASTER_CATALOG, tomorrowFieldForLayer } from './catalog';
import { getCachedStormValue, getStaleStormValue, setCachedStormValue } from './cache';
import type { StormFeatureProperties, StormMapsProvider, StormRasterLayerId } from './types';

const TILE_SIZE = 256;
const WEB_MERCATOR_EXTENT = 20037508.342789244;
const NOAA_ALERTS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert';
const ECCC_ALERTS_URL = 'https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=1000';
const ECCC_RADAR_CAPABILITIES_URL = 'https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetCapabilities&layer=RADAR_1KM_RRAI';
const ECCC_OUTLOOK_LAYERS = [
  { id: 'Thunderstorm-Outlook_Atlantic', bounds: [-70, 40, -50, 61] },
  { id: 'Thunderstorm-Outlook_BC-YT', bounds: [-141, 47, -114, 70] },
  { id: 'Thunderstorm-Outlook_NWT', bounds: [-141, 58, -102, 79] },
  { id: 'Thunderstorm-Outlook_ON', bounds: [-96, 41, -73, 57] },
  { id: 'Thunderstorm-Outlook_Prairies', bounds: [-120, 48, -88, 61] },
  { id: 'Thunderstorm-Outlook_QC', bounds: [-82, 44, -57, 63] },
] as const;

type EcccOutlookLayerId = (typeof ECCC_OUTLOOK_LAYERS)[number]['id'];

type CachedTile = {
  base64: string;
  contentType: string;
  provider: StormMapsProvider;
};

type UpstreamTileRequest = {
  provider: StormMapsProvider;
  layerId: StormRasterLayerId;
  time: string;
  z: number;
  x: number;
  y: number;
};

export type StormFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, StormFeatureProperties> & {
  metadata: {
    generatedAt: string;
    dataAsOf: string | null;
    stale: boolean;
    sources: string[];
  };
};

export function radarTimesFromCapabilities(xml: string) {
  const dimensions = xml.match(/<Dimension\b[^>]*>[\s\S]*?<\/Dimension>/gi) || [];
  const timeDimension = dimensions.find((value) => /name=["']time["']/i.test(value));
  if (!timeDimension) return [];
  const defaultTime = timeDimension.match(/default=["']([^"']+)["']/i)?.[1];
  if (!defaultTime || !Number.isFinite(Date.parse(defaultTime))) return [];
  const latest = Date.parse(defaultTime);
  return Array.from({ length: 11 }, (_, index) => new Date(latest - (10 - index) * 6 * 60_000).toISOString());
}

export async function getEcccRadarFrameTimes() {
  const cacheKey = 'metadata:eccc:radar-times';
  const cached = await getCachedStormValue<string[]>(cacheKey);
  if (cached?.value.length) return cached.value;
  try {
    const response = await fetch(ECCC_RADAR_CAPABILITIES_URL, {
      headers: { Accept: 'application/xml,text/xml', 'User-Agent': providerUserAgent() },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`ECCC radar metadata returned ${response.status}`);
    const times = radarTimesFromCapabilities(await response.text());
    if (times.length === 0) throw new Error('ECCC radar metadata did not include a time dimension');
    await setCachedStormValue(cacheKey, times, 60, 10 * 60);
    return times;
  } catch {
    return (await getStaleStormValue<string[]>(cacheKey))?.value || [];
  }
}

function gradientForLayer(layerId: StormRasterLayerId) {
  if (layerId === 'precipitationType') return null;
  const customGradient = mapGradientForLayer(layerId);
  if (customGradient) return customGradient;
  return STORM_RASTER_CATALOG[layerId].legend
    .map((stop) => `${stop.value}:${stop.color.replace('#', '')}b8`)
    .join(',');
}

export function xyzToWebMercatorBbox(z: number, x: number, y: number): [number, number, number, number] {
  const tiles = 2 ** z;
  const tileSpan = (WEB_MERCATOR_EXTENT * 2) / tiles;
  const minX = -WEB_MERCATOR_EXTENT + x * tileSpan;
  const maxX = minX + tileSpan;
  const maxY = WEB_MERCATOR_EXTENT - y * tileSpan;
  const minY = maxY - tileSpan;
  return [minX, minY, maxX, maxY];
}

function tomorrowTimestamp(date: Date) {
  return date.toISOString().replace('.000Z', 'Z');
}

export function buildTomorrowUrl(request: UpstreamTileRequest, apiKey: string) {
  const field = tomorrowFieldForLayer(request.layerId);
  if (!field) throw new Error('Tomorrow.io field is not available for this layer');
  const isNow = request.time === 'now';
  const time = isNow ? new Date() : new Date(request.time);
  if (!isNow && Number.isNaN(time.getTime())) throw new Error('Invalid Tomorrow.io tile time');

  const aggregationHours = aggregationHoursForLayer(request.layerId);
  const path = aggregationHours
    ? `/v4/map/aggregate/tile/sum/${tomorrowTimestamp(time)}/${tomorrowTimestamp(
        new Date(time.getTime() + aggregationHours * 60 * 60 * 1000),
      )}/${request.z}/${request.x}/${request.y}/${field}.png`
    : `/v4/map/tile/${request.z}/${request.x}/${request.y}/${field}/${isNow ? 'now' : tomorrowTimestamp(time)}.png`;
  const url = new URL(path, 'https://api.tomorrow.io');
  url.searchParams.set('apikey', apiKey);
  const gradient = gradientForLayer(request.layerId);
  if (gradient) url.searchParams.set('gradient', gradient);
  return url.toString();
}

function buildIemUrl(request: UpstreamTileRequest) {
  const product = request.layerId === 'radar'
    ? request.time === 'now' ? 'nexrad-n0q' : `nexrad-n0q-${request.time}`
    : request.layerId === 'accumulation1h'
      ? 'q2-n1p'
      : request.layerId === 'accumulation24h'
        ? 'q2-p24h'
        : null;
  if (!product) throw new Error('IEM does not support this layer');
  return `https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/${product}/${request.z}/${request.x}/${request.y}.png`;
}

function buildEcccUrl(request: UpstreamTileRequest) {
  if (request.layerId !== 'radar') throw new Error('ECCC only supports the radar layer');
  const [minX, minY, maxX, maxY] = xyzToWebMercatorBbox(request.z, request.x, request.y);
  const url = new URL('https://geo.weather.gc.ca/geomet');
  url.searchParams.set('SERVICE', 'WMS');
  url.searchParams.set('VERSION', '1.1.1');
  url.searchParams.set('REQUEST', 'GetMap');
  url.searchParams.set('LAYERS', 'RADAR_1KM_RRAI');
  url.searchParams.set('STYLES', 'RADARURPPRECIPR14-LINEAR');
  url.searchParams.set('SRS', 'EPSG:3857');
  url.searchParams.set('BBOX', `${minX},${minY},${maxX},${maxY}`);
  url.searchParams.set('WIDTH', String(TILE_SIZE));
  url.searchParams.set('HEIGHT', String(TILE_SIZE));
  url.searchParams.set('FORMAT', 'image/png');
  url.searchParams.set('TRANSPARENT', 'TRUE');
  if (request.time !== 'now') url.searchParams.set('TIME', request.time);
  return url.toString();
}

async function consumeTomorrowBudget() {
  const limit = Number.parseInt(process.env.TOMORROW_IO_DAILY_TILE_BUDGET || '250000', 10);
  const now = new Date();
  const key = `tomorrow-budget:${now.toISOString().slice(0, 10)}`;
  const cached = await getCachedStormValue<number>(key);
  const used = cached?.value ?? 0;
  if (Number.isFinite(limit) && used >= limit) return false;
  const tomorrowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const ttl = Math.max(60, Math.ceil((tomorrowUtc - now.getTime()) / 1000));
  await setCachedStormValue(key, used + 1, ttl, ttl);
  return true;
}

export async function validateTomorrowFullSuiteAccess() {
  const validationCacheKey = 'provider-validation:tomorrow-full-suite-v2-hail';
  const cached = await getCachedStormValue<{ ok: boolean; checkedAt: string }>(validationCacheKey);
  if (cached) return cached.value;
  const apiKey = process.env.TOMORROW_IO_API_KEY;
  if (!apiKey) return { ok: false, checkedAt: new Date().toISOString() };

  const start = new Date();
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  const fields = [
    'precipitationType',
    'precipitationIntensity',
    'snowIntensity',
    'freezingRainIntensity',
    'temperature',
    'temperatureApparent',
    'windSpeed',
    'windGust',
    'cloudCover',
    'lightningFlashRateDensity',
    'hailBinary',
    'hailProbability',
    'hailSize',
  ];
  const urls = fields.map((field) => {
    const url = new URL(`/v4/map/tile/1/0/0/${field}/now.png`, 'https://api.tomorrow.io');
    url.searchParams.set('apikey', apiKey);
    return url.toString();
  });
  const aggregateUrl = new URL(
    `/v4/map/aggregate/tile/sum/${tomorrowTimestamp(start)}/${tomorrowTimestamp(end)}/1/0/0/precipitationIntensity.png`,
    'https://api.tomorrow.io',
  );
  aggregateUrl.searchParams.set('apikey', apiKey);
  urls.push(aggregateUrl.toString());

  let ok = true;
  for (let index = 0; index < urls.length; index += 1) {
    if (!(await consumeTomorrowBudget())) {
      ok = false;
      break;
    }
  }
  if (ok) {
    const checks = await Promise.all(urls.map(async (url) => {
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': providerUserAgent() },
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok || !(response.headers.get('content-type') || '').startsWith('image/')) return false;
        await response.arrayBuffer();
        return true;
      } catch {
        return false;
      }
    }));
    ok = checks.every(Boolean);
  }

  const result = { ok, checkedAt: new Date().toISOString() };
  await setCachedStormValue(validationCacheKey, result, ok ? 24 * 60 * 60 : 5 * 60);
  return result;
}

async function fetchTileFromProvider(request: UpstreamTileRequest): Promise<CachedTile> {
  let url: string;
  if (request.provider === 'tomorrow') {
    const apiKey = process.env.TOMORROW_IO_API_KEY;
    if (!apiKey) throw new Error('Tomorrow.io is not configured');
    if (!(await consumeTomorrowBudget())) throw new Error('Tomorrow.io daily tile budget reached');
    url = buildTomorrowUrl(request, apiKey);
  } else if (request.provider === 'iem') {
    url = buildIemUrl(request);
  } else {
    url = buildEcccUrl(request);
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': providerUserAgent() },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${request.provider} tile returned ${response.status}`);
  const contentType = response.headers.get('content-type') || 'image/png';
  if (!contentType.startsWith('image/')) throw new Error(`${request.provider} returned a non-image tile`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { base64: bytes.toString('base64'), contentType, provider: request.provider };
}

export async function getStormMapTile(request: UpstreamTileRequest) {
  const key = `tile:${request.provider}:${request.layerId}:${request.time}:${request.z}:${request.x}:${request.y}`;
  const cached = await getCachedStormValue<CachedTile>(key);
  if (cached) return { ...cached, stale: false };

  try {
    const tile = await fetchTileFromProvider(request);
    const ttl = request.provider === 'tomorrow' ? 15 * 60 : 5 * 60;
    const stored = await setCachedStormValue(key, tile, ttl, 30 * 60);
    return { ...stored, stale: false };
  } catch (error) {
    if (request.provider === 'iem' && request.layerId === 'radar') {
      try {
        const fallback = await fetchTileFromProvider({
          ...request,
          provider: 'eccc',
          time: 'now',
          y: 2 ** request.z - 1 - request.y,
        });
        const stored = await setCachedStormValue(key, fallback, 5 * 60, 30 * 60);
        return { ...stored, stale: false };
      } catch {
        // Continue to last-good cache below.
      }
    }
    const stale = await getStaleStormValue<CachedTile>(key);
    if (stale) return { ...stale, stale: true };
    throw error;
  }
}

function providerUserAgent() {
  const contact = process.env.WEATHER_PROVIDER_CONTACT_EMAIL || 'support@wolfgrid.app';
  return `WolfGrid Storm Maps Beta (https://wolfgrid.app, ${contact})`;
}

function geometryBbox(geometry: GeoJSON.Geometry | null): [number, number, number, number] | null {
  if (!geometry || geometry.type === 'GeometryCollection') return null;
  const values: number[][] = [];
  const collect = (coordinates: unknown) => {
    if (!Array.isArray(coordinates)) return;
    if (coordinates.length >= 2 && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
      values.push(coordinates as number[]);
      return;
    }
    coordinates.forEach(collect);
  };
  collect(geometry.coordinates);
  if (values.length === 0) return null;
  let west = 180;
  let south = 90;
  let east = -180;
  let north = -90;
  for (const [lon, lat] of values) {
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }
  return [west, south, east, north];
}

function intersectsBbox(geometry: GeoJSON.Geometry | null, bbox: [number, number, number, number]) {
  const candidate = geometryBbox(geometry);
  if (!candidate) return false;
  return candidate[0] <= bbox[2] && candidate[2] >= bbox[0] && candidate[1] <= bbox[3] && candidate[3] >= bbox[1];
}

function severity(value: unknown): StormFeatureProperties['severity'] {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'extreme' || normalized === 'severe' || normalized === 'moderate' || normalized === 'minor') {
    return normalized;
  }
  return 'unknown';
}

function category(event: string): StormFeatureProperties['category'] {
  const normalized = event.toLowerCase();
  if (normalized.includes('tornado')) return 'tornado';
  if (normalized.includes('hail')) return 'hail';
  if (normalized.includes('thunder')) return 'thunderstorm';
  if (normalized.includes('flood')) return 'flood';
  if (normalized.includes('snow') || normalized.includes('winter') || normalized.includes('ice') || normalized.includes('blizzard')) {
    return 'winter';
  }
  return 'other';
}

function numberProperty(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function overlapsBbox(
  first: readonly [number, number, number, number],
  second: readonly [number, number, number, number],
) {
  return first[0] <= second[2] && first[2] >= second[0] && first[1] <= second[3] && first[3] >= second[1];
}

export function ecccOutlookLayersForBbox(bbox: [number, number, number, number]): EcccOutlookLayerId[] {
  return ECCC_OUTLOOK_LAYERS
    .filter((layer) => overlapsBbox(layer.bounds, bbox))
    .map((layer) => layer.id);
}

function roundedOutlookBbox(bbox: [number, number, number, number]): [number, number, number, number] {
  const increment = 0.5;
  return [
    Math.floor(bbox[0] / increment) * increment,
    Math.floor(bbox[1] / increment) * increment,
    Math.ceil(bbox[2] / increment) * increment,
    Math.ceil(bbox[3] / increment) * increment,
  ];
}

function isCurrentOutlook(feature: GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>, now = Date.now()) {
  const expiration = feature.properties?.expiration_datetime;
  if (typeof expiration !== 'string') return true;
  const expiresAt = Date.parse(expiration);
  return !Number.isFinite(expiresAt) || expiresAt >= now;
}

function ecccOutlookUrl(layerId: EcccOutlookLayerId, bbox: [number, number, number, number]) {
  const url = new URL('https://geo.weather.gc.ca/geomet');
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('typeNames', layerId);
  url.searchParams.set('outputFormat', 'application/json');
  url.searchParams.set('srsName', 'EPSG:4326');
  url.searchParams.set('bbox', `${bbox.join(',')},urn:ogc:def:crs:OGC:1.3:CRS84`);
  url.searchParams.set('count', '250');
  return url.toString();
}

function outlookSeverity(riskLevel: number | null, impact: number | null): StormFeatureProperties['severity'] {
  const score = Math.max(riskLevel || 0, impact || 0);
  if (score >= 4) return 'extreme';
  if (score >= 3) return 'severe';
  if (score >= 2) return 'moderate';
  if (score >= 1) return 'minor';
  return 'unknown';
}

export function normalizeEcccOutlookFeature(
  feature: GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>,
  layerId: EcccOutlookLayerId = 'Thunderstorm-Outlook_ON',
) {
  const properties = feature.properties || {};
  const hailSizeCm = numberProperty(properties.metobject_hail_value);
  const gustKph = numberProperty(properties.metobject_gust_value);
  const riskLevel = numberProperty(properties.metobject_risk_swo_value);
  const confidence = numberProperty(properties.metobject_confidence_value);
  const impact = numberProperty(properties.metobject_impact_value);
  const stormMode = String(properties.metobject_thunderstorm_value || 'possible').toLowerCase();
  const hasHail = (hailSizeCm || 0) > 0;
  const region = layerId.replace('Thunderstorm-Outlook_', '').replace('-', ' / ');
  const event = hasHail ? 'Canadian hail outlook' : 'Canadian severe storm outlook';
  const details = [
    `${stormMode.charAt(0).toUpperCase()}${stormMode.slice(1)} thunderstorms`,
    hasHail ? `hail up to ${hailSizeCm} cm` : null,
    gustKph && gustKph > 0 ? `gusts up to ${gustKph} km/h` : null,
  ].filter(Boolean).join(' · ');
  return {
    ...feature,
    properties: {
      id: String(properties.id || feature.id || `${layerId}-${properties.validity_datetime || 'latest'}`),
      kind: 'outlook',
      provider: 'eccc',
      event,
      severity: outlookSeverity(riskLevel, impact),
      category: hasHail ? 'hail' : 'outlook',
      headline: hasHail ? `Hail potential · up to ${hailSizeCm} cm` : `${stormMode} thunderstorm potential`,
      description: `${details}. Experimental ECCC outlook for ${region}; confirm with current watches and warnings.`,
      sentAt: typeof properties.publication_datetime === 'string' ? properties.publication_datetime : null,
      endsAt: typeof properties.expiration_datetime === 'string' ? properties.expiration_datetime : null,
      url: null,
      magnitude: hasHail ? `${hailSizeCm} cm hail` : null,
      riskLevel,
      hailSizeCm,
      gustKph,
      confidence,
      impact,
      experimental: true,
    } satisfies StormFeatureProperties,
  } as GeoJSON.Feature<GeoJSON.Geometry, StormFeatureProperties>;
}

async function fetchJsonWithCache<T>(key: string, url: string, ttlSeconds: number): Promise<{ value: T; stale: boolean; asOf: string }> {
  const cached = await getCachedStormValue<T>(key);
  if (cached) return { value: cached.value, stale: false, asOf: cached.cachedAt };
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/geo+json, application/json', 'User-Agent': providerUserAgent() },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Weather feature provider returned ${response.status}`);
    const value = (await response.json()) as T;
    const stored = await setCachedStormValue(key, value, ttlSeconds, 5 * 60);
    return { value, stale: false, asOf: stored.cachedAt };
  } catch (error) {
    const stale = await getStaleStormValue<T>(key);
    if (stale) return { value: stale.value, stale: true, asOf: stale.cachedAt };
    throw error;
  }
}

export function normalizeNoaaFeature(feature: GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>) {
  const properties = feature.properties || {};
  const event = String(properties.event || 'Weather alert');
  return {
    ...feature,
    properties: {
      id: String(feature.id || properties.id || crypto.randomUUID()),
      kind: 'alert',
      provider: 'noaa',
      event,
      severity: severity(properties.severity),
      category: category(event),
      headline: String(properties.headline || event),
      description: typeof properties.description === 'string' ? properties.description : null,
      sentAt: typeof properties.sent === 'string' ? properties.sent : null,
      endsAt: typeof properties.ends === 'string' ? properties.ends : null,
      url: typeof properties['@id'] === 'string' ? properties['@id'] : null,
      magnitude: null,
    } satisfies StormFeatureProperties,
  } as GeoJSON.Feature<GeoJSON.Geometry, StormFeatureProperties>;
}

export function normalizeEcccFeature(feature: GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>) {
  const properties = feature.properties || {};
  const event = String(properties.alert_name_en || properties.alert_short_name_en || 'Weather alert');
  return {
    ...feature,
    properties: {
      id: String(properties.id || feature.id || crypto.randomUUID()),
      kind: 'alert',
      provider: 'eccc',
      event,
      severity: severity(properties.impact_en),
      category: category(event),
      headline: String(properties.alert_text_en || event),
      description: typeof properties.alert_text_en === 'string' ? properties.alert_text_en : null,
      sentAt: typeof properties.publication_datetime === 'string' ? properties.publication_datetime : null,
      endsAt: typeof properties.expiration_datetime === 'string' ? properties.expiration_datetime : null,
      url: null,
      magnitude: null,
    } satisfies StormFeatureProperties,
  } as GeoJSON.Feature<GeoJSON.Geometry, StormFeatureProperties>;
}

function toIemTimestamp(date: Date) {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 12);
}

export function normalizeIemReport(feature: GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>) {
  const properties = feature.properties || {};
  const event = String(properties.typetext || properties.type || 'Storm report');
  return {
    ...feature,
    properties: {
      id: String(feature.id || properties.id || crypto.randomUUID()),
      kind: 'report',
      provider: 'iem',
      event,
      severity: 'unknown',
      category: 'report',
      headline: event,
      description: typeof properties.remark === 'string' ? properties.remark : null,
      sentAt: typeof properties.valid === 'string' ? properties.valid : null,
      endsAt: null,
      url: null,
      magnitude: properties.magnitude == null ? null : String(properties.magnitude),
    } satisfies StormFeatureProperties,
  } as GeoJSON.Feature<GeoJSON.Geometry, StormFeatureProperties>;
}

export async function getStormFeatures(
  bbox: [number, number, number, number],
  options: { alerts: boolean; outlook: boolean; reports: boolean },
): Promise<StormFeatureCollection> {
  const tasks: Array<Promise<{ features: GeoJSON.Feature<GeoJSON.Geometry, StormFeatureProperties>[]; source: string; stale: boolean; asOf: string | null }>> = [];

  if (options.alerts) {
    tasks.push(
      fetchJsonWithCache<GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>>(
        'features:noaa:active',
        NOAA_ALERTS_URL,
        30,
      ).then(({ value, stale, asOf }) => ({
        features: (value.features || []).filter((feature) => intersectsBbox(feature.geometry, bbox)).map(normalizeNoaaFeature),
        source: 'NOAA/NWS',
        stale,
        asOf,
      })).catch(() => ({ features: [], source: 'NOAA/NWS unavailable', stale: true, asOf: null })),
      fetchJsonWithCache<GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>>(
        'features:eccc:active',
        ECCC_ALERTS_URL,
        30,
      ).then(({ value, stale, asOf }) => ({
        features: (value.features || []).filter((feature) => intersectsBbox(feature.geometry, bbox)).map(normalizeEcccFeature),
        source: 'ECCC/MSC',
        stale,
        asOf,
      })).catch(() => ({ features: [], source: 'ECCC/MSC unavailable', stale: true, asOf: null })),
    );
  }

  if (options.outlook) {
    const requestBbox = roundedOutlookBbox(bbox);
    const outlookLayers = ecccOutlookLayersForBbox(bbox);
    if (outlookLayers.length > 0) {
      tasks.push(
        Promise.all(outlookLayers.map((layerId) => (
          fetchJsonWithCache<GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>>(
            `features:eccc:outlook:${layerId}:${requestBbox.join(':')}`,
            ecccOutlookUrl(layerId, requestBbox),
            10 * 60,
          ).then(({ value, stale, asOf }) => ({
            features: (value.features || [])
              .filter((feature) => isCurrentOutlook(feature) && intersectsBbox(feature.geometry, bbox))
              .map((feature) => normalizeEcccOutlookFeature(feature, layerId)),
            stale,
            asOf,
          })).catch(() => ({
            features: [] as GeoJSON.Feature<GeoJSON.Geometry, StormFeatureProperties>[],
            stale: true,
            asOf: null,
          }))
        ))).then((results) => ({
          features: results.flatMap((result) => result.features),
          source: results.some((result) => result.stale)
            ? 'ECCC severe storm outlook (some regions unavailable)'
            : 'ECCC severe storm outlook (experimental)',
          stale: results.some((result) => result.stale),
          asOf: results.map((result) => result.asOf).filter((value): value is string => Boolean(value)).sort().at(-1) || null,
        })),
      );
    }
  }

  if (options.reports) {
    const end = new Date();
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const url = `https://mesonet.agron.iastate.edu/geojson/lsr.php?sts=${toIemTimestamp(start)}&ets=${toIemTimestamp(end)}`;
    tasks.push(
      fetchJsonWithCache<GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>>(
        `features:iem:reports:${toIemTimestamp(start).slice(0, 10)}`,
        url,
        5 * 60,
      ).then(({ value, stale, asOf }) => ({
        features: (value.features || []).filter((feature) => intersectsBbox(feature.geometry, bbox)).map(normalizeIemReport),
        source: 'Iowa Environmental Mesonet',
        stale,
        asOf,
      })).catch(() => ({ features: [], source: 'IEM reports unavailable', stale: true, asOf: null })),
    );
  }

  const results = await Promise.all(tasks);
  return {
    type: 'FeatureCollection',
    features: results.flatMap((result) => result.features),
    metadata: {
      generatedAt: new Date().toISOString(),
      dataAsOf: results.map((result) => result.asOf).filter((value): value is string => Boolean(value)).sort().at(-1) || null,
      stale: results.some((result) => result.stale),
      sources: results.map((result) => result.source),
    },
  };
}
