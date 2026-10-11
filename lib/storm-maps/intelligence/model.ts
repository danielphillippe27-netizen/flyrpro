import { z } from 'zod';

export const hazardSchema = z.enum(['hail', 'wind', 'tornado', 'hurricane']);
export type StormHazard = z.infer<typeof hazardSchema>;
export const eventReferenceSchema = z.object({
  key: z.string().min(1).max(160), title: z.string().min(1).max(160),
  hazard: hazardSchema, source: z.enum(['iem', 'xweather']),
  start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }),
  sourceId: z.string().max(100),
}).strict().refine(v => Date.parse(v.start) <= Date.parse(v.end), 'Invalid event dates');
export type StormReference = z.infer<typeof eventReferenceSchema>;
export const campaignStormSchema = z.object({
  version: z.union([z.literal(1),z.literal(2)]), event: eventReferenceSchema,
  territoryId: z.uuid().optional(),
  territoryRevision: z.number().int().positive().optional(),
  sampling: z.object({cellMeters:z.number().positive(),clickedMM:z.number().min(0).max(200),method:z.literal('numerical-map-contour')}).strict().optional(),
  zoneId: z.uuid().optional(), includeOutsideZone: z.boolean().optional(),
  selectedAt: z.iso.datetime({ offset: true }),
  minimumHailMM: z.number().min(0).max(150).nullable(),
  maximumHailMM: z.number().min(0).max(150).nullable().optional(),
  selection: z.enum(['user-drawn', 'intensity-zone']), evidenceKind: z.enum(['reports', 'track', 'hail-size', 'hail-sampled']),
}).strict().refine(value => value.maximumHailMM == null || (value.minimumHailMM != null && value.maximumHailMM > value.minimumHailMM), 'Invalid hail intensity band');
export type StormCampaignContext = z.infer<typeof campaignStormSchema>;
export type StormMapFeature = GeoJSON.Feature<GeoJSON.Geometry, {
  id: string; label: string; time: string; kind: 'report' | 'track' | 'position' | 'forecast';
  hailMM?: number | null; windKPH?: number | null; category?: string; description?: string;
}>;
export type StormEvent = StormReference & {
  features: StormMapFeature[]; reportCount: number; maxHailMM: number | null;
  maxWindKPH: number | null; category: string | null; active: boolean;
  footprintStatus: 'unavailable';
};
export const boundsSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-85).max(85), z.number().min(-180).max(180), z.number().min(-85).max(85)])
  .refine(b => b[0] < b[2] && b[1] < b[3], 'Choose a region that does not cross the date line');
export function dateWindow(from: string, to: string, maxDays = 31) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from) || !day.test(to)) throw new Error('Choose valid start and end dates');
  const start = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start.toISOString().slice(0,10) !== from || end.toISOString().slice(0,10) !== to) throw new Error('Choose valid calendar dates');
  end.setUTCDate(end.getUTCDate()+1);
  if (+end <= +start || +end - +start > maxDays * 86400000) throw new Error(`Choose a range of at most ${maxDays} days`);
  if (+start > Date.now()) throw new Error('History cannot start in the future');
  return { start: start.toISOString(), end: new Date(Math.min(+end, Date.now())).toISOString() };
}
export function referenceOf(event: StormEvent): StormReference {
  const { key, title, hazard, source, start, end, sourceId } = event;
  return { key, title, hazard, source, start, end, sourceId };
}
export function eventBounds(event: StormEvent): [number,number,number,number] | null {
  const points = event.features.flatMap(f => f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.type === 'LineString' ? f.geometry.coordinates : []);
  if (!points.length) return null;
  const xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);
  return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}
export function visibleEventFeatures(event: StormEvent, minimumHailMM: number) {
  return event.features.filter(f => event.hazard !== 'hail' || minimumHailMM === 0 || (f.properties.hailMM != null && f.properties.hailMM >= minimumHailMM));
}
