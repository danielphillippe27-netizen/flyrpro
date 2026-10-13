import type { StormEvent, StormMapFeature } from './model';
import { getCachedStormValue, setCachedStormValue } from '../cache';

export const DAT_URL = 'https://services.dat.noaa.gov/arcgis/rest/services/nws_damageassessmenttoolkit/DamageViewer/MapServer';
export function efRating(value: unknown): string | null {
  const match = /^EF([0-5])$/.exec(String(value ?? '').trim().toUpperCase());
  return match ? `EF${match[1]}` : null;
}

/** Separate survey events preserve identity; a state/day report group is not one tornado. */
export function tornadoSurveyEvents(collection: GeoJSON.FeatureCollection, start: string, end: string): StormEvent[] {
  const groups = new Map<string, StormEvent>();
  for (const feature of collection.features) {
    const p = feature.properties || {};
    const timestamp = typeof p.stormdate === 'number' ? p.stormdate : Date.parse(p.stormdate);
    if (!Number.isFinite(timestamp) || timestamp < Date.parse(start) || timestamp >= Date.parse(end)) continue;
    if (!['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) continue;
    // Polygons link to the parent track by path_guid. Never join on a display name.
    const path = String(p.path_guid || '').toLowerCase().replace(/[{}]/g, '');
    const identity = path && path !== '00000000-0000-0000-0000-000000000000' ? path : String(p.globalid || '').toLowerCase().replace(/[{}]/g, '');
    if (!/^[a-f0-9-]{36}$/.test(identity)) continue;
    const key = `noaa-dat:${identity}`;
    const time = new Date(timestamp).toISOString();
    let event = groups.get(key);
    if (!event) {
      event = {key, title: `${String(p.event_id || 'Tornado survey').slice(0,110)} · ${time.slice(0,10)}`, hazard:'tornado', source:'noaa-dat', sourceId:identity, start:time, end:time, features:[], reportCount:0, maxHailMM:null, maxWindKPH:null, category:null, active:false, footprintStatus:'unavailable', surveyStatus:'available'};
      groups.set(key,event);
    }
    const rating = efRating(p.efscale);
    if (rating && (!event.category || rating > event.category)) event.category = rating;
    const polygon = feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon';
    if (polygon) event.footprintStatus = 'surveyed';
    const properties: StormMapFeature['properties'] = {id:`dat:${polygon?'area':'track'}:${p.objectid}`, label:`NWS preliminary survey · ${rating || 'EF rating unavailable'}`, time, kind:polygon?'survey-area':'track', category:rating || undefined, description:String(p.comments || '').slice(0,1500)};
    event.features.push({type:'Feature',geometry:feature.geometry,properties});
  }
  return [...groups.values()];
}

export async function loadTornadoSurveys(bbox:number[], start:string, end:string): Promise<StormEvent[]> {
  const key = `intelligence:dat:v1:${bbox.join(',')}:${start}:${end}`;
  const cached = await getCachedStormValue<StormEvent[]>(key);
  if (cached) return cached.value;
  const collections = await Promise.all([1,2].map(async layer => {
    const features: GeoJSON.Feature[] = [];
    for (let offset=0; offset<10000; offset+=1000) {
      const url = new URL(`${DAT_URL}/${layer}/query`);
      const sqlDate = (value:string) => new Date(value).toISOString().slice(0,19).replace('T',' ');
      const params = {f:'geojson',where:`stormdate >= TIMESTAMP '${sqlDate(start)}' AND stormdate < TIMESTAMP '${sqlDate(end)}'`,geometry:JSON.stringify({xmin:bbox[0],ymin:bbox[1],xmax:bbox[2],ymax:bbox[3],spatialReference:{wkid:4326}}),geometryType:'esriGeometryEnvelope',inSR:'4326',outSR:'4326',spatialRel:'esriSpatialRelIntersects',outFields:'*',orderByFields:'objectid',resultOffset:String(offset),resultRecordCount:'1000',returnGeometry:'true'};
      Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
      const response = await fetch(url,{signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error('NOAA tornado surveys unavailable');
      const body = await response.json();
      if (body.error || body.type !== 'FeatureCollection' || !Array.isArray(body.features)) throw new Error('Invalid NOAA survey response');
      features.push(...body.features);
      if (!body.exceededTransferLimit && !body.properties?.exceededTransferLimit && body.features.length<1000) return features;
    }
    throw new Error('NOAA survey region too large');
  }));
  const events = tornadoSurveyEvents({type:'FeatureCollection',features:collections.flat()},start,end);
  await setCachedStormValue(key,events,900,900);
  return events;
}
