import * as turf from '@turf/turf';
import RBush from 'rbush';

type RoadSample = { minX: number; maxX: number; minY: number; maxY: number; coordinate: [number, number] };
const ROAD_SERVICE = 'https://maps.durham.ca/arcgis/rest/services/Open_Data/Durham_OpenData/MapServer/17/query';
const MUNICIPALITIES = new Set(['ajax', 'brock', 'clarington', 'oshawa', 'pickering', 'scugog', 'uxbridge', 'whitby']);

/** Durham Open Data Licence v1.0: https://www.durham.ca/regional-government/access-to-information/open-data/ */
export async function fetchDurhamRoadCentrelines(parcels: GeoJSON.FeatureCollection): Promise<GeoJSON.FeatureCollection | null> {
  if (!parcels.features.length) return null;
  const bounds = turf.bbox(parcels);
  const namedDurham = parcels.features.some(f => MUNICIPALITIES.has(String(f.properties?.municipality ?? '').trim().toLowerCase()));
  const nearDurham = bounds[2] >= -79.35 && bounds[0] <= -78.45 && bounds[3] >= 43.7 && bounds[1] <= 44.65;
  if (!namedDurham && !nearDurham) return null;
  if (!bounds.every(Number.isFinite) || bounds[2] - bounds[0] > 1 || bounds[3] - bounds[1] > 1) throw new Error('Invalid Durham parcel bounds');
  const features: GeoJSON.Feature[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const params = new URLSearchParams({ f: 'geojson', geometry: bounds.join(','), geometryType: 'esriGeometryEnvelope',
      inSR: '4326', outSR: '4326', spatialRel: 'esriSpatialRelIntersects', where: '1=1', outFields: 'OBJECTID',
      returnGeometry: 'true', resultOffset: String(offset), resultRecordCount: '1000', orderByFields: 'OBJECTID ASC' });
    const response = await fetch(`${ROAD_SERVICE}?${params}`, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
    if (!response.ok) throw new Error(`Durham road data HTTP ${response.status}`);
    const page = await response.json() as GeoJSON.FeatureCollection & { error?: { message?: string } };
    if (page.error || !Array.isArray(page.features)) throw new Error(page.error?.message || 'Invalid Durham road data');
    features.push(...page.features);
    if (page.features.length < 1000) return { type: 'FeatureCollection', features };
  }
  throw new Error('Durham road data exceeded the safety limit');
}

/** A road must run >=30m at least 2m inside a polygon; boundary crossings do not qualify. */
export function filterRoadCentrelineParcels(parcels: GeoJSON.FeatureCollection, roads: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const samples: RoadSample[] = [];
  for (const road of roads.features) {
    try {
      turf.flattenEach(road, line => {
        if (line.geometry.type !== 'LineString') return;
        const roadLine = line as GeoJSON.Feature<GeoJSON.LineString>;
        const length = turf.length(roadLine, { units: 'meters' });
        for (let distance = 2.5; distance < length; distance += 5) {
          const coordinate = turf.along(roadLine, distance, { units: 'meters' }).geometry.coordinates as [number, number];
          samples.push({ minX: coordinate[0], maxX: coordinate[0], minY: coordinate[1], maxY: coordinate[1], coordinate });
        }
      });
    } catch { /* Malformed roads are not evidence for excluding parcels. */ }
  }
  const index = new RBush<RoadSample>(); index.load(samples);
  const features = parcels.features.filter(parcel => {
    try {
      const props = parcel.properties ?? {};
      const explicit = [props.parcel_intent, props.land_use, props.landuse, props.property_type].some(value => typeof value === 'string' && /residential/i.test(value));
      if (explicit || !['Polygon', 'MultiPolygon'].includes(parcel.geometry?.type)) return true;
      const box = turf.bbox(parcel); const candidates = index.search({ minX: box[0], minY: box[1], maxX: box[2], maxY: box[3] });
      if (candidates.length < 6) return true;
      const edges: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      turf.flattenEach(turf.polygonToLine(parcel as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>), edge => {
        if (edge.geometry.type === 'LineString') edges.push(edge as GeoJSON.Feature<GeoJSON.LineString>);
      });
      if (!edges.length) return true;
      // Large, narrow corridor geometry is required as well as road evidence.
      // This protects ordinary lots when a centreline is misaligned.
      const perimeter = edges.reduce((sum, edge) => sum + turf.length(edge, { units: 'meters' }), 0);
      const area = turf.area(parcel);
      if (area < 2000 || perimeter < 250 || area / (perimeter * perimeter) >= 0.025) return true;
      let qualifying = 0;
      for (const candidate of candidates) {
        const point = turf.point(candidate.coordinate);
        if (turf.booleanPointInPolygon(point, parcel as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>) &&
          edges.every(edge => turf.pointToLineDistance(point, edge, { units: 'meters' }) > 2)) {
          if (++qualifying >= 6) return false;
        }
      }
      return true;
    } catch { return true; }
  });
  return features.length === parcels.features.length ? parcels : { ...parcels, features };
}
