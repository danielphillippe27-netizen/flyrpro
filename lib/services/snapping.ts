/**
 * Polygon Optimizer: Simplify and clean campaign polygon vertices.
 * 
 * ROAD SNAPPING DISABLED: Previously snapped to road centerlines, but now
 * just optimizes the polygon shape via simplification and nub removal.
 * This is much faster as it avoids S3/DB fetching.
 */
import * as turf from '@turf/turf';
import type { SupabaseClient } from '@supabase/supabase-js';

const SIMPLIFY_TOLERANCE = 0.00008;
const TINY_NUB_THRESHOLD_M = 2.5;

export type SnapResult = {
  polygon: GeoJSON.Polygon;
  wasSnapped: boolean;
};

function removeTinyNubs(ring: number[][], thresholdM: number): number[][] {
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

  if (out.length > 1 && (out[out.length - 1][0] !== out[0][0] || out[out.length - 1][1] !== out[0][1])) {
    out.push([out[0][0], out[0][1]]);
  }
  return out;
}

export async function snapPolygonToRoads(
  rawPolygon: GeoJSON.Polygon,
  _supabase: SupabaseClient
): Promise<SnapResult> {
  console.log('[SnappingService] Optimizing polygon (roads disabled)');
  
  const ring = rawPolygon.coordinates[0];
  if (!ring || ring.length < 3) {
    return { polygon: rawPolygon, wasSnapped: false };
  }

  try {
    // Close ring if not already
    const closedRing: number[][] = [...ring];
    const first = closedRing[0];
    const last = closedRing[closedRing.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      closedRing.push([first[0], first[1]]);
    }

    // Simplify for clean edges
    let poly = turf.polygon([closedRing]);
    poly = turf.simplify(poly, { tolerance: SIMPLIFY_TOLERANCE, highQuality: true });

    // Tiny-nub cleanup: drop vertices closer than 2.5m to previous
    const cleanedRing = removeTinyNubs(poly.geometry.coordinates[0], TINY_NUB_THRESHOLD_M);
    if (cleanedRing.length < 3) {
      return { polygon: rawPolygon, wasSnapped: false };
    }
    poly = turf.polygon([cleanedRing]);

    // Validate
    let valid = turf.booleanValid(poly);
    if (!valid) {
      try {
        const buffered = turf.buffer(poly, 0, { units: 'meters' });
        if (buffered && turf.booleanValid(buffered)) {
          const coords = buffered.geometry.type === 'Polygon'
            ? buffered.geometry.coordinates
            : buffered.geometry.type === 'MultiPolygon'
              ? buffered.geometry.coordinates[0]
              : null;
          if (coords && coords[0] && coords[0].length >= 3) {
            poly = turf.polygon([coords[0]]);
            valid = turf.booleanValid(poly);
          }
        }
      } catch {}
    }

    if (!valid) {
      return { polygon: rawPolygon, wasSnapped: false };
    }

    const vertexChange = ring.length - poly.geometry.coordinates[0].length;
    console.log(`[SnappingService] Optimized: ${ring.length} → ${poly.geometry.coordinates[0].length} vertices (${vertexChange} removed)`);

    return { 
      polygon: { type: 'Polygon', coordinates: poly.geometry.coordinates }, 
      wasSnapped: vertexChange > 0 
    };
  } catch (err) {
    console.error('[SnappingService] optimization error:', err);
    throw err;
  }
}
