import { polygonSmooth, kinks, simplify } from '@turf/turf';
import { featureCollection, polygon } from '@turf/helpers';
import union from '@turf/union';

export const HAIL_BANDS = [0, 12.7, 25.4, 38.1, 50.8, 76.2] as const;
export type HailSample = { value: number; unit?: string; nodata: boolean } | null | undefined;
export function hailMillimeters(sample: HailSample): number | null {
  if (!sample || sample.nodata || !Number.isFinite(sample.value) || sample.value < 0) return null;
  // MESH encoded data uses mm; query results can include their measurement unit.
  if (!sample.unit || sample.unit === 'mm') return sample.value;
  if (sample.unit === 'in') return sample.value * 25.4;
  if (sample.unit === 'cm') return sample.value * 10;
  return null;
}
export function bandForHail(mm: number) {
  if (!Number.isFinite(mm) || mm <= 0) throw new Error('No estimated hail at this point. Click inside a shaded hail area.');
  const minimum = [...HAIL_BANDS].reverse().find(value => mm >= value);
  if (minimum == null) throw new Error('No estimated hail at this point. Click inside a shaded hail area.');
  return { minimum, maximum: HAIL_BANDS.find(value => value > minimum) ?? null };
}

/** Four-neighbour connectivity keeps separate storm pockets separate. Unknown cells are never included. */
export function connectedHailCells(values: (number | null)[], width: number, height: number, seed: number, minimum: number, maximum: number | null) {
  if (values.length !== width * height || seed < 0 || seed >= values.length) throw new Error('Invalid hail grid.');
  const qualifies = (id: number) => values[id] != null && values[id]! > 0 && values[id]! >= minimum && (maximum == null || values[id]! < maximum);
  if (!qualifies(seed)) throw new Error('The clicked point is outside this intensity range. Choose another zone or a lower threshold.');
  const cells = new Set<number>(); const seen = new Set<number>([seed]); const queue = [seed];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor]; if (!qualifies(id)) continue;
    cells.add(id); const x = id % width, y = Math.floor(id / width);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) throw new Error('This zone extends beyond the map. Zoom out slightly to include its edges, then select it again.');
    for (const next of [id - 1, id + 1, id - width, id + width]) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return cells;
}

/** Merge contiguous row runs; preserve holes instead of taking a convex hull. */
export function hailCellsPolygon(cells: Set<number>, width: number, height: number, bounds: [number, number, number, number]): GeoJSON.Feature<GeoJSON.Polygon> {
  const [west, south, east, north] = bounds, dx = (east - west) / width, dy = (north - south) / height;
  const rows: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!cells.has(y * width + x)) continue;
      const start = x; while (x + 1 < width && cells.has(y * width + x + 1)) x++;
      const left = west + start * dx, right = west + (x + 1) * dx, bottom = south + y * dy, top = south + (y + 1) * dy;
      rows.push(polygon([[[left,bottom],[right,bottom],[right,top],[left,top],[left,bottom]]]));
    }
  }
  const result = rows.length === 1 ? rows[0] : union(featureCollection(rows));
  if (!result || result.geometry.type !== 'Polygon') throw new Error('Could not form one connected boundary. Zoom in and select a smaller area.');
  return result as GeoJSON.Feature<GeoJSON.Polygon>;
}

export function smoothHailBoundary(boundary: GeoJSON.Feature<GeoJSON.Polygon>) {
  let smoothed=polygonSmooth(boundary,{iterations:2}).features[0];
  if(smoothed?.geometry.type==='Polygon'){
    let tolerance=0.00005;
    for(let attempt=0;attempt<12&&smoothed.geometry.coordinates.reduce((total,ring)=>total+ring.length,0)>900;attempt++){
      smoothed=simplify(smoothed,{tolerance,highQuality:true});tolerance*=1.5;
    }
  }
  if(!smoothed||smoothed.geometry.type!=='Polygon'||kinks(smoothed).features.length)return boundary;
  return smoothed as GeoJSON.Feature<GeoJSON.Polygon>;
}
