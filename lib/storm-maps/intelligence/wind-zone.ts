import sharp from 'sharp';
import { windCountryCell } from './wind-country-mask';
import { area, featureCollection, polygon, union } from '@turf/turf';
import { canonicalWindTime, WIND_COUNTRIES, windGustKPH, type WindArchiveBundle } from './wind-archive-format';
import { loadWindArchive } from './wind-archive-history';
import { stormGeometrySchema } from './geometry';
import type { StormCampaignContext } from './model';

const size = 8192;
export const WIND_BANDS = [40, 60, 93.341952, 120, 160] as const;
export function windGridPoint(x: number, y: number): [number, number] {
  return [x / size * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / size))) * 180 / Math.PI];
}
export function windGridCell(lon: number, lat: number): [number, number] {
  return [Math.min(size - 1, Math.floor((lon + 180) / 360 * size)), Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * size)];
}
/** Trace whole native cells, including holes, with no interpolation or screen clipping. */
export async function traceWindZone(bundle: WindArchiveBundle, lon: number, lat: number, minimum?: number, bandOnly = true) {
  const decoded = new Map<string, Buffer>();
  const read = async (x: number, y: number): Promise<number | null> => {
    if (x < 0 || x >= size || y < 0 || y >= size) return null;
    const [lng, latitude] = windGridPoint(x + .5, y + .5);
    if (!WIND_COUNTRIES[bundle.country].bounds.some(([w,s,e,n]) => lng >= w && lng <= e && latitude >= s && latitude <= n)) return null;
    if(!windCountryCell(bundle.country,x,y))return 0;
    const key = `4/${Math.floor(x / 512)}/${Math.floor(y / 512)}`;
    const png = bundle.numericTiles[key]; if (!png) return null;
    if (!decoded.has(key)) decoded.set(key, await sharp(Buffer.from(png, 'base64')).ensureAlpha().raw().toBuffer());
    return windGustKPH(decoded.get(key)![((y % 512) * 512 + x % 512) * 4]);
  };
  const [sx, sy] = windGridCell(lon, lat);
  if(!windCountryCell(bundle.country,sx,sy))throw Error('Select wind shading on land inside the selected country.');
  const clickedKPH = await read(sx, sy);
  if (clickedKPH == null) throw Error('No saved gust data here. Tap inside the selected country’s wind shading.');
  if (clickedKPH < 40) throw Error(`Estimated gust: ${Math.round(clickedKPH)} km/h. Select a shaded area of at least 40 km/h to create a wind territory.`);
  const min = minimum ?? [...WIND_BANDS].reverse().find(value => value <= clickedKPH)!;
  if (!WIND_BANDS.includes(min as typeof WIND_BANDS[number])) throw Error('Choose a supported wind threshold.');
  const max = bandOnly ? WIND_BANDS.find(value => value > min) ?? null : null;
  const qualifies = (value: number) => value >= min && (max == null || value < max);
  if (!qualifies(clickedKPH)) throw Error(`Estimated gust: ${Math.round(clickedKPH)} km/h. Tap inside the selected wind range.`);
  const queue: [number,number][] = [[sx,sy]], seen = new Set<string>(), rows = new Map<number, number[]>(); let squareMeters = 0;
  for (let i = 0; i < queue.length; i++) {
    const [x,y] = queue[i], key = `${x}/${y}`; if (seen.has(key)) continue; seen.add(key);
    const value = await read(x,y);
    if (value == null) throw Error('This gust area reaches missing data or the coverage edge. Select another enclosed area.');
    if (!qualifies(value)) continue;
    if (Math.abs(x-sx)>128 || Math.abs(y-sy)>128) throw Error('This connected wind area is too large. Choose a higher threshold or a narrower wind band.');
    const [w,n] = windGridPoint(x,y), [e,s] = windGridPoint(x+1,y+1);
    squareMeters += area(polygon([[[w,s],[e,s],[e,n],[w,n],[w,s]]]));
    if (squareMeters > 5_000_000_000) throw Error('This connected wind area exceeds 5,000 km². Choose a higher threshold or a narrower wind band.');
    const row = rows.get(y) ?? []; row.push(x); rows.set(y,row);
    queue.push([x-1,y],[x+1,y],[x,y-1],[x,y+1]);
  }
  const runs: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  for (const [y, xs] of rows) {
    xs.sort((a,b)=>a-b);
    for (let i=0;i<xs.length;i++) {
      const left=xs[i]; while(i+1<xs.length&&xs[i+1]===xs[i]+1)i++;
      const [w,n]=windGridPoint(left,y),[e,s]=windGridPoint(xs[i]+1,y+1);
      runs.push(polygon([[[w,s],[e,s],[e,n],[w,n],[w,s]]]));
    }
  }
  const boundary = runs.length===1 ? runs[0].geometry : union(featureCollection(runs))?.geometry;
  if (!boundary || !stormGeometrySchema.safeParse(boundary).success) throw Error('This gust area has too complex a boundary. Select a smaller wind pocket.');
  return {boundary,clickedKPH,minimumKPH:min,maximumKPH:max,areaKM2:squareMeters/1e6,cellMeters:Math.round(40075016.686/size*Math.cos(lat*Math.PI/180))};
}
export async function archivedWindZone(country: WindArchiveBundle['country'], time: string, lon: number, lat: number, minimum?: number, bandOnly=true) {
  time=canonicalWindTime(time);
  const result=await traceWindZone(await loadWindArchive(country,time),lon,lat,minimum,bandOnly);
  const context: StormCampaignContext={version:2,event:{key:`xweather:wind:${country}:${time}`,title:`${WIND_COUNTRIES[country].name} wind gusts · ${time.slice(0,16)} UTC`,hazard:'wind',source:'xweather',sourceId:'conditions_GUST_10-HTGL',start:time,end:time},selectedAt:new Date().toISOString(),minimumHailMM:null,selection:'intensity-zone',evidenceKind:'wind-sampled',gustSelection:{country,time,longitude:lon,latitude:lat,minimumKPH:result.minimumKPH,maximumKPH:result.maximumKPH,method:'archived-native-grid'}};
  return {...result,context};
}
