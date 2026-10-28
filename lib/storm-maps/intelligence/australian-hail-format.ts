import type { StormEvent } from './model';

export const AU_HAIL_PRODUCT = 'au-hail-threats';
export const AU_FRAME_PREFIX = 'au-hail-frame:';
const australianZones = new Set(['Indian/Christmas', 'Indian/Cocos', 'Pacific/Norfolk', 'Antarctica/Macquarie']);
const object = (value: unknown): Record<string, unknown> => {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Invalid hail feature properties.');
  return parsed as Record<string, unknown>;
};
export type AustralianHailFrame = { time: string; events: StormEvent[]; features: GeoJSON.Feature[] };

/** Tile coordinates are simplified display geometry, never a validated hail-impact boundary. */
export function australianHailFrame(features: GeoJSON.Feature[], time: string): AustralianHailFrame {
  const events = new Map<string, StormEvent>(), australian: GeoJSON.Feature[] = [];
  for (const feature of features) {
    const p = feature.properties ?? {}, profile = object(p.profile);
    const tz = String(profile.tz ?? '');
    if (!tz.startsWith('Australia/') && !australianZones.has(tz)) continue;
    const details = object(p.details), hail = object(details.hail);
    const id = String(details.stormId ?? p.id ?? '');
    const issued = Date.parse(String(details.issuedDateTimeISO));
    if (!id || id.length > 100 || !Number.isFinite(issued) || issued > Date.parse(time) + 120000) throw Error('Invalid Australian hail identity/time.');
    australian.push(feature);
    const key = `xweather:au:hail:${id}`;
    let event = events.get(key);
    const mm = typeof hail.maxSizeMM === 'number' && Number.isFinite(hail.maxSizeMM) && hail.maxSizeMM >= 0 ? hail.maxSizeMM : null;
    if (!event) {
      event = { key, sourceId: id, title: `Australian hail threat · ${new Date(issued).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
        hazard: 'hail', source: 'xweather', start: new Date(issued).toISOString(), end: new Date(issued + 3600000).toISOString(),
        features: [], reportCount: 0, maxHailMM: mm, maxWindKPH: null, category: 'Modeled hail threat', active: false, footprintStatus: 'unavailable' };
      events.set(key, event);
    }
    if (mm != null) event.maxHailMM = Math.max(event.maxHailMM ?? 0, mm);
    // Keep only the issued/current centroid in the browsable record. Future areas
    // remain in the raw snapshot, clearly identified by the provider's period.
    if (p.featureType !== 'centroid' || feature.geometry?.type !== 'Point') continue;
    const period = object(p.period), range = object(period.range);
    if (Number(range.minTimestamp) === Number(details.issuedTimestamp)) {
      const coordinates = feature.geometry.coordinates;
      if (coordinates.length < 2 || coordinates.some(value => !Number.isFinite(value))) throw Error('Invalid hail location.');
      event.features = [{ type: 'Feature', geometry: feature.geometry, properties: { id, label: `Estimated hail threat · ${tz}`, time: event.start,
        kind: 'position', hailMM: mm, description: 'Xweather modeled hail threat. Coarse map centroid; not a verified address or damage footprint.' } }];
    }
  }
  return { time, events: [...events.values()], features: australian };
}

export function australianFramesToCollect(validTimes: string[], completed: Set<string>, now: Date, limit = 90) {
  return [...new Set(validTimes)].filter(value => Number.isFinite(Date.parse(value)) && Date.parse(value) <= +now && Date.parse(value) >= +now - 7 * 86400000)
    .sort((a, b) => Date.parse(b) - Date.parse(a)).filter(value => !completed.has(new Date(value).toISOString())).slice(0, limit);
}

export function mergeAustralianEvent(previous: StormEvent | undefined, next: StormEvent): StormEvent {
  if (!previous) return next;
  return { ...next, start: previous.start < next.start ? previous.start : next.start, end: previous.end > next.end ? previous.end : next.end,
    maxHailMM: previous.maxHailMM == null ? next.maxHailMM : next.maxHailMM == null ? previous.maxHailMM : Math.max(previous.maxHailMM, next.maxHailMM),
    features: next.features.length ? next.features : previous.features };
}
