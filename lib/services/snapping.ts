/**
 * Snap to Roads: snap campaign polygon vertices to Overture road centerlines
 * to prevent boundary bleed (selecting addresses across the street).
 */
import * as turf from '@turf/turf';
import type { Feature, LineString, Polygon } from '@turf/turf';
import type { SupabaseClient } from '@supabase/supabase-js';

const SNAP_THRESHOLD_M = 20;
const SIMPLIFY_TOLERANCE = 0.00008; // ~8–9m at mid-latitudes
const TINY_NUB_THRESHOLD_M = 2.5;

export type SnapResult = {
  polygon: GeoJSON.Polygon;
  wasSnapped: boolean;
};

/**
 * Fetch road segments in bbox from Supabase (get_roads_in_bbox RPC).
 * Returns LineString features for drivable roads only.
 */
async function fetchRoadsInBbox(
  supabase: SupabaseClient,
  minLon: number,
  minLat: number,
  maxLon: number,
  maxLat: number
): Promise<Feature<LineString>[]> {
  console.log('[SnappingService] Fetching roads in bbox:', { minLon, minLat, maxLon, maxLat });
  
  const { data, error } = await supabase.rpc('get_roads_in_bbox', {
    min_lon: minLon,
    min_lat: minLat,
    max_lon: maxLon,
    max_lat: maxLat,
  });

  if (error) {
    console.error('[SnappingService] get_roads_in_bbox error:', error);
    throw new Error(`Failed to fetch roads: ${error.message}`);
  }

  console.log('[SnappingService] Raw RPC response:', { dataType: typeof data, isArray: Array.isArray(data), dataLength: Array.isArray(data) ? data.length : null });

  const segments: Feature<LineString>[] = [];
  if (!Array.isArray(data)) {
    console.warn('[SnappingService] RPC returned non-array data:', data);
    return segments;
  }

  for (const row of data) {
    const geojson = row?.geojson;
    if (!geojson || !geojson.coordinates) {
      console.warn('[SnappingService] Skipping malformed row:', row);
      continue;
    }
    try {
      const line = turf.lineString(geojson.coordinates as [number, number][]);
      segments.push(line);
    } catch (e) {
      console.warn('[SnappingService] Failed to parse line:', e, row);
      // skip malformed row
    }
  }
  
  console.log('[SnappingService] Parsed', segments.length, 'road segments');
  return segments;
}

/**
 * Remove vertices that are closer than threshold meters to the previous vertex
 * to avoid jagged corners / "nubs" after snapping to intersections.
 */
function removeTinyNubs(
  ring: number[][],
  thresholdM: number
): number[][] {
  if (ring.length < 4) return ring;

  const out: number[][] = [ring[0]];
  let lastKept = turf.point(ring[0]);

  for (let i = 1; i < ring.length; i++) {
    const pt = ring[i];
    const dist = turf.distance(lastKept, turf.point(pt), { units: 'meters' });
    if (dist >= thresholdM) {
      out.push(pt);
      lastKept = turf.point(pt);
    }
  }

  // Ensure closed ring (last === first)
  if (out.length > 1 && (out[out.length - 1][0] !== out[0][0] || out[out.length - 1][1] !== out[0][1])) {
    out.push([out[0][0], out[0][1]]);
  }
  return out;
}

/**
 * Snap a single vertex to the nearest point on the nearest road segment if within threshold.
 */
function snapVertex(
  vertex: [number, number],
  segments: Feature<LineString>[],
  thresholdM: number
): [number, number] {
  const pt = turf.point(vertex);
  let best: { coords: [number, number]; dist: number } | null = null;

  for (const line of segments) {
    const nearest = turf.nearestPointOnLine(line, pt, { units: 'meters' });
    const dist = turf.distance(pt, nearest, { units: 'meters' });
    if (dist < thresholdM && (best === null || dist < best.dist)) {
      best = {
        coords: nearest.geometry.coordinates as [number, number],
        dist,
      };
    }
  }

  return best ? best.coords : vertex;
}

/**
 * Snap polygon vertices to road centerlines, simplify, and validate.
 * Returns the snapped polygon or the original on failure.
 */
export async function snapPolygonToRoads(
  rawPolygon: GeoJSON.Polygon,
  supabase: SupabaseClient
): Promise<SnapResult> {
  console.log('[SnappingService] Starting snapPolygonToRoads');
  
  const ring = rawPolygon.coordinates[0];
  if (!ring || ring.length < 3) {
    console.warn('[SnappingService] Invalid polygon: less than 3 vertices');
    return { polygon: rawPolygon, wasSnapped: false };
  }

  try {
    const bbox = turf.bbox(rawPolygon);
    console.log('[SnappingService] Calculated bbox:', bbox);
    
    const [minLon, minLat, maxLon, maxLat] = bbox;
    
    // Validate bbox values
    if (!isFinite(minLon) || !isFinite(minLat) || !isFinite(maxLon) || !isFinite(maxLat)) {
      throw new Error(`Invalid bbox values: ${JSON.stringify(bbox)}`);
    }
    
    const segments = await fetchRoadsInBbox(supabase, minLon, minLat, maxLon, maxLat);
    
    if (segments.length === 0) {
      console.log('[SnappingService] No road segments found, returning original polygon');
      return { polygon: rawPolygon, wasSnapped: false };
    }

    // Snap each vertex (exterior ring only)
    console.log('[SnappingService] Snapping', ring.length, 'vertices');
    const snappedRing: number[][] = [];
    let snapCount = 0;
    
    for (let i = 0; i < ring.length; i++) {
      const vertex = ring[i] as [number, number];
      const snapped = snapVertex(vertex, segments, SNAP_THRESHOLD_M);
      if (snapped[0] !== vertex[0] || snapped[1] !== vertex[1]) {
        snapCount++;
      }
      snappedRing.push(snapped);
    }
    
    console.log('[SnappingService] Snapped', snapCount, 'of', ring.length, 'vertices');
    
    // Close ring if not already
    const first = snappedRing[0];
    const last = snappedRing[snappedRing.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      snappedRing.push([first[0], first[1]]);
    }

    let poly = turf.polygon([snappedRing]);

    // Simplify for clean block edges
    console.log('[SnappingService] Simplifying polygon');
    poly = turf.simplify(poly, { tolerance: SIMPLIFY_TOLERANCE, highQuality: true });

    // Tiny-nub cleanup: drop vertices closer than 2.5m to previous
    console.log('[SnappingService] Removing tiny nubs');
    const cleanedRing = removeTinyNubs(poly.coordinates[0], TINY_NUB_THRESHOLD_M);
    if (cleanedRing.length < 3) {
      console.warn('[SnappingService] Cleaned ring has less than 3 vertices, returning original');
      return { polygon: rawPolygon, wasSnapped: false };
    }
    poly = turf.polygon([cleanedRing]);

    // Validate
    console.log('[SnappingService] Validating polygon');
    let valid = turf.booleanValid(poly);
    if (!valid) {
      console.log('[SnappingService] Polygon invalid, attempting buffer fix');
      try {
        const buffered = turf.buffer(poly, 0, { units: 'meters' });
        if (buffered && turf.booleanValid(buffered)) {
          // Take exterior of buffer if it's a polygon
          const coords = buffered.geometry.type === 'Polygon'
            ? buffered.geometry.coordinates
            : buffered.geometry.type === 'MultiPolygon'
              ? buffered.geometry.coordinates[0]
              : null;
          if (coords && coords[0] && coords[0].length >= 3) {
            poly = turf.polygon([coords[0]]);
            valid = turf.booleanValid(poly);
            console.log('[SnappingService] Buffer fix result:', valid);
          }
        }
      } catch (e) {
        console.warn('[SnappingService] Buffer fix failed:', e);
      }
    }

    if (!valid) {
      console.warn('[SnappingService] Polygon still invalid after fixes, returning original');
      return { polygon: rawPolygon, wasSnapped: false };
    }

    const polygon: GeoJSON.Polygon = {
      type: 'Polygon',
      coordinates: poly.coordinates,
    };
    
    console.log('[SnappingService] Successfully snapped polygon');
    return { polygon, wasSnapped: true };
  } catch (err) {
    console.error('[SnappingService] snap error:', err);
    throw err; // Re-throw to let caller handle it
  }
}
