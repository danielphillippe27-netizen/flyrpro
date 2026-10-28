export const WIND_PRODUCT = 'wind-gust-history-v1';
export const WIND_DATASET = 'conditions_GUST_10-HTGL';
export const WIND_ZOOM = 4;
export const WIND_TILE_SIZE = 512;
export const WIND_COUNTRIES = {
  CA: { name: 'Canada', bounds: [[-141, 41, -52, 84]] },
  US: { name: 'United States', bounds: [[-125, 24, -66, 50], [-161, 18, -154, 23]] },
  AU: { name: 'Australia', bounds: [[112, -44, 155, -10]] },
  NZ: { name: 'New Zealand', bounds: [[166, -48, 180, -33], [-180, -48, -175, -33]] },
} as const;
export type WindCountry = keyof typeof WIND_COUNTRIES;
export const WIND_ENCODING = { minimumMPS: 0, maximumMPS: 100, outputMin: 1, outputMax: 255, noData: 0, band: 0 } as const;
export type WindArchiveBundle = {
  version: 1; country: WindCountry; time: string; dataset: typeof WIND_DATASET;
  evidence: 'gridded-wind-estimate'; zoom: number; tileSize: number;
  encoding: typeof WIND_ENCODING; numericTiles: Record<string, string>; displayTiles: Record<string, string>;
};
export function windCountry(value: string | null): value is WindCountry { return !!value && Object.hasOwn(WIND_COUNTRIES, value); }
export function canonicalWindTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time % 3600000 !== 0) throw Error('Choose a valid archived hour.');
  return new Date(time).toISOString();
}
export function availableWindTimes(values: unknown, now: Date) {
  if (!Array.isArray(values) || !values.length) throw Error('Wind timeline unavailable.');
  const times = [...new Set(values.map(value => {
    if (typeof value !== 'string') throw Error('Invalid wind timeline.');
    return canonicalWindTime(value);
  }))].filter(time => Date.parse(time) <= +now && Date.parse(time) >= +now - 7 * 86400000).sort();
  if (!times.length || +now - Date.parse(times.at(-1)!) > 6 * 3600000) throw Error('Wind timeline is stale.');
  return times;
}
const tileX = (lon: number) => Math.max(0, Math.min(15, Math.floor((lon + 180) / 360 * 16)));
const tileY = (lat: number) => Math.max(0, Math.min(15, Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 16)));
export function windCountryTiles(country: WindCountry) {
  const keys = new Set<string>();
  for (const [west, south, east, north] of WIND_COUNTRIES[country].bounds) {
    for (let x = tileX(west); x <= tileX(east - 1e-8); x++) for (let y = tileY(north); y <= tileY(south); y++) keys.add(`${WIND_ZOOM}/${x}/${y}`);
  }
  return [...keys].sort();
}
/** The server can silently substitute an older frame. Never archive it under the requested hour. */
export function validateWindResponse(header: string | null, time: string | string[]) {
  let rows: Array<{ validTimes?: string[]; animDir?: string; b?: number; x?: number; y?: number; nd?: number; u?: string }>;
  try { rows = JSON.parse(header ?? ''); } catch { throw Error('Wind tile metadata missing.'); }
  const row = rows[0];
  const expected = (Array.isArray(time) ? time : [time]).map(canonicalWindTime);
  const actual = row?.validTimes?.map(canonicalWindTime) ?? [];
  if (rows.length !== 1 || !row || actual.length !== expected.length || new Set(actual).size !== actual.length || !expected.every(value => actual.includes(value)) || (actual.length > 1 && row.animDir !== 'H') || row.b !== 0 || row.x !== 0 || row.y !== 0 || row.nd !== 0 || row.u !== 'm/s') throw Error('Wind tile does not match the requested historical hour.');
  return actual;
}
export function windGustKPH(byte: number): number | null {
  if (byte === 0) return null;
  return (byte - WIND_ENCODING.outputMin) / (WIND_ENCODING.outputMax - WIND_ENCODING.outputMin) * WIND_ENCODING.maximumMPS * 3.6;
}
export function windPixelColor(byte: number): [number, number, number, number] {
  const kph = windGustKPH(byte);
  if (kph == null) return [0, 0, 0, 0];
  if (kph < 40) return [56, 189, 248, 95];
  if (kph < 60) return [34, 197, 94, 125];
  if (kph < 93.341952) return [250, 204, 21, 160];
  if (kph < 120) return [249, 115, 22, 185];
  if (kph < 160) return [239, 68, 68, 200];
  return [168, 85, 247, 215];
}
