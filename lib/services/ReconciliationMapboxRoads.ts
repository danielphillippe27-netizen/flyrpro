import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import * as turf from '@turf/turf';
import { reconciliationLookupPool } from './ReconciliationLookupPool';

type Feature = GeoJSON.Feature<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>;
const ZOOM = 15;
const MAX_TILES = 64;
const CONCURRENCY_DEADLINE_MS = 25_000;

/** Mapbox road tiles are fetched only into this run's memory, never published in the map bundle. */
export async function loadReconciliationMapboxRoads(
  buildings: Feature[], token = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
): Promise<Feature[]> {
  if (!token || buildings.length === 0) return [];
  const points = buildings.flatMap(feature => {
    try { const [x, y] = turf.centroid(feature).geometry.coordinates; return Number.isFinite(x) && Number.isFinite(y) ? [[x, y]] : []; }
    catch { return []; }
  });
  if (!points.length) return [];
  const n = 2 ** ZOOM;
  const x = (lon: number) => Math.floor((lon + 180) / 360 * n);
  const y = (lat: number) => Math.floor((1 - Math.asinh(Math.tan(Math.max(-85, Math.min(85, lat)) * Math.PI / 180)) / Math.PI) / 2 * n);
  const xs = points.map(p => x(p[0])), ys = points.map(p => y(p[1]));
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_TILES) throw new Error('Road coverage exceeds the reconciliation tile limit');
  const tiles: Array<[number, number]> = [];
  for (let tx = minX; tx <= maxX; tx++) for (let ty = minY; ty <= maxY; ty++) tiles.push([tx, ty]);
  const results = await reconciliationLookupPool(tiles, async ([tx, ty]) => {
    const url = new URL(`https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/${ZOOM}/${tx}/${ty}.mvt`);
    url.searchParams.set('access_token', token);
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Mapbox road tile request failed (${response.status})`);
    const tile = new VectorTile(new Pbf(new Uint8Array(await response.arrayBuffer())));
    const layer = tile.layers.road;
    if (!layer) return [];
    const roads: Feature[] = [];
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      const name = f.properties.name || f.properties['name_en'];
      if (typeof name !== 'string' || !name || !['street', 'street_limited', 'secondary', 'tertiary', 'primary'].includes(String(f.properties.class))) continue;
      const feature = f.toGeoJSON(tx, ty, ZOOM) as Feature;
      if (feature.geometry.type === 'LineString') roads.push(feature);
      if (feature.geometry.type === 'MultiLineString') for (const coordinates of feature.geometry.coordinates) roads.push({ ...feature, geometry: { type: 'LineString', coordinates } });
    }
    return roads;
  }, async () => {}, { deadline: Date.now() + CONCURRENCY_DEADLINE_MS });
  if (results.some(result => result == null)) throw new Error('Mapbox road tile lookup did not complete');
  return results.flatMap(result => result ?? []);
}
