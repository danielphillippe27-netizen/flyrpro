/**
 * TownhouseSplitterService - Gold Standard Townhouse Geometric Splitting
 * 
 * Production-grade townhouse detection and splitting using proper polygon clipping
 * with Web Mercator projection for accurate meter-based slicing.
 * 
 * Key Features:
 * - Proper polygon clipping with line intersection
 * - Web Mercator projection (meter-based, no distortion)
 * - Two-pass clipping for accurate slice boundaries
 * - Validation to prevent degenerate slices
 * - Apartment placeholder circles (7+ units)
 * - Comprehensive error logging
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { isUnitPersistenceEnabled } from '../config/features';

// Types
export interface BuildingFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  properties: {
    gers_id: string;
    name?: string | null;
    height?: number | null;
    [key: string]: any;
  };
}

export interface AddressFeature {
  id: string;
  lon: number;
  lat: number;
  house_number?: string | null;
  street_name?: string | null;
  formatted?: string | null;
}

export interface SplitUnit {
  address_id: string;
  unit_geometry: GeoJSON.Polygon;
  unit_number: string;
  validation: 'passed' | 'warning' | 'failed';
  area_sqm: number;
}

export interface SplitResult {
  status: 'success' | 'error';
  building_id: string;
  units?: SplitUnit[];
  parent_type: 'townhouse' | 'apartment' | 'duplex' | 'triplex' | 'small_multifamily';
  split_method: 'obb_linear' | 'weighted' | 'apartment_placeholder';
  error_type?: string;
  error_message?: string;
}

export interface BuildingAnalysis {
  building_id: string;
  building: BuildingFeature;
  unit_count: number;
  addresses: AddressFeature[];
  classification: 'townhouse' | 'apartment' | 'small_multifamily';
  aspect_ratio: number;
  area_sqm: number;
  is_l_shaped: boolean;
}

export interface SplitErrorRecord {
  campaign_id: string;
  building_id: string;
  building_geometry: any;
  error_type: 'validation_failed' | 'geometry_complex' | 'address_mismatch' | 
              'split_failed' | 'self_intersection' | 'insert_failed';
  error_message: string;
  address_count: number;
  address_ids: string[];
  address_positions: Array<{
    address_id: string;
    lon: number;
    lat: number;
    house_number?: string;
  }>;
  suggested_action: 'manual_split' | 'merge_units' | 'flag_apartment' | 
                    'create_placeholders' | 'skip_building';
}

export interface TownhouseSplitSummary {
  total_buildings: number;
  townhouses_detected: number;
  apartments_skipped: number;
  units_created: number;
  errors_logged: number;
  avg_units_per_townhouse: number;
}

// ============================================================================
// GEOMETRY UTILITIES - Web Mercator Projection
// ============================================================================

/**
 * Convert longitude/latitude to Web Mercator meters
 */
function lonLatToMeters(lon: number, lat: number): [number, number] {
  const x = lon * 20037508.34 / 180;
  const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180);
  const y_m = y * 20037508.34 / 180;
  return [x, y_m];
}

/**
 * Convert Web Mercator meters back to longitude/latitude
 */
function metersToLonLat(x: number, y: number): [number, number] {
  const lon = x * 180 / 20037508.34;
  const lat = 180 / Math.PI * (2 * Math.atan(Math.exp(y * Math.PI / 20037508.34)) - Math.PI / 2);
  return [lon, lat];
}

/**
 * Clip polygon ring against start/end distances along axis
 * Uses Sutherland-Hodgman algorithm adapted for axis-aligned clipping
 */
function clipRingByAxis(
  ring: [number, number][], 
  axis: [number, number],
  origin: [number, number],
  start: number, 
  end: number
): [number, number][] | null {
  
  // Project all points to meters and onto axis
  const projected = ring.map(([lon, lat]) => {
    const [x, y] = lonLatToMeters(lon, lat);
    // Distance from origin along axis
    const dist = (x - origin[0]) * axis[0] + (y - origin[1]) * axis[1];
    return { lon, lat, x, y, dist };
  });

  const result: [number, number][] = [];
  
  // Helper: interpolate between two points at target distance
  const interpolate = (
    p1: typeof projected[0], 
    p2: typeof projected[0], 
    targetDist: number
  ): [number, number] => {
    const t = (targetDist - p1.dist) / (p2.dist - p1.dist);
    const x = p1.x + t * (p2.x - p1.x);
    const y = p1.y + t * (p2.y - p1.y);
    return metersToLonLat(x, y);
  };

  // First pass: clip against start boundary (keep dist >= start)
  let current = projected[projected.length - 1];
  for (const next of projected) {
    const insideCurrent = current.dist >= start;
    const insideNext = next.dist >= start;
    
    if (insideCurrent && insideNext) {
      result.push([next.lon, next.lat]);
    } else if (insideCurrent && !insideNext) {
      result.push(interpolate(current, next, start));
    } else if (!insideCurrent && insideNext) {
      result.push(interpolate(current, next, start));
      result.push([next.lon, next.lat]);
    }
    current = next;
  }

  if (result.length < 3) return null;

  // Second pass: clip against end boundary (keep dist <= end)
  const projected2 = result.map(([lon, lat]) => {
    const [x, y] = lonLatToMeters(lon, lat);
    const dist = (x - origin[0]) * axis[0] + (y - origin[1]) * axis[1];
    return { lon, lat, x, y, dist };
  });

  const result2: [number, number][] = [];
  current = projected2[projected2.length - 1];
  
  for (const next of projected2) {
    const insideCurrent = current.dist <= end;
    const insideNext = next.dist <= end;
    
    if (insideCurrent && insideNext) {
      result2.push([next.lon, next.lat]);
    } else if (insideCurrent && !insideNext) {
      result2.push(interpolate(current, next, end));
    } else if (!insideCurrent && insideNext) {
      result2.push(interpolate(current, next, end));
      result2.push([next.lon, next.lat]);
    }
    current = next;
  }

  if (result2.length < 3) return null;
  
  // Close the ring
  if (result2[0][0] !== result2[result2.length - 1][0] || 
      result2[0][1] !== result2[result2.length - 1][1]) {
    result2.push(result2[0]);
  }

  return result2;
}

/**
 * Shrink polygon inward by inset distance to create visual gaps between units
 * Uses vertex normal method - moves each vertex along the angle bisector
 */
function shrinkPolygon(
  ring: [number, number][], 
  insetMeters: number
): [number, number][] {
  if (ring.length < 4) return ring; // Need at least triangle
  
  const insetM = insetMeters;
  const shrunk: [number, number][] = [];
  const n = ring.length - 1; // Exclude closing point for processing
  
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const curr = ring[i];
    const next = ring[(i + 1) % n];
    
    // Convert to meters
    const [px, py] = lonLatToMeters(prev[0], prev[1]);
    const [cx, cy] = lonLatToMeters(curr[0], curr[1]);
    const [nx, ny] = lonLatToMeters(next[0], next[1]);
    
    // Vector from curr to prev (incoming edge)
    const v1x = px - cx;
    const v1y = py - cy;
    const v1len = Math.sqrt(v1x * v1x + v1y * v1y);
    
    // Vector from curr to next (outgoing edge)
    const v2x = nx - cx;
    const v2y = ny - cy;
    const v2len = Math.sqrt(v2x * v2x + v2y * v2y);
    
    if (v1len === 0 || v2len === 0) {
      shrunk.push([curr[0], curr[1]]); // Degenerate, keep original
      continue;
    }
    
    // Normalize edge vectors
    const u1x = v1x / v1len;
    const u1y = v1y / v1len;
    const u2x = v2x / v2len;
    const u2y = v2y / v2len;
    
    // Angle bisector (pointing inward for CCW polygon)
    const bisectX = u1x + u2x;
    const bisectY = u1y + u2y;
    const bisectLen = Math.sqrt(bisectX * bisectX + bisectY * bisectY);
    
    if (bisectLen === 0) {
      // 180 degree angle (straight line), move perpendicular
      const perpX = -u1y;
      const perpY = u1x;
      const newX = cx + perpX * insetM;
      const newY = cy + perpY * insetM;
      const [newLon, newLat] = metersToLonLat(newX, newY);
      shrunk.push([newLon, newLat]);
    } else {
      // Move along bisector
      const bisectUnitX = bisectX / bisectLen;
      const bisectUnitY = bisectY / bisectLen;
      
      // Calculate offset distance (need to divide by sin(half_angle) for correct inset)
      const cosHalfAngle = bisectLen / 2;
      const sinHalfAngle = Math.sqrt(1 - cosHalfAngle * cosHalfAngle);
      const offsetDist = sinHalfAngle > 0.01 ? insetM / sinHalfAngle : insetM;
      
      const newX = cx + bisectUnitX * offsetDist;
      const newY = cy + bisectUnitY * offsetDist;
      const [newLon, newLat] = metersToLonLat(newX, newY);
      shrunk.push([newLon, newLat]);
    }
  }
  
  // Close the ring
  if (shrunk.length > 0) {
    shrunk.push([...shrunk[0]]);
  }
  
  return shrunk;
}

/**
 * Create a unit polygon by slicing the building perpendicular to street edge
 */
function createUnitPolygon(
  buildingGeom: GeoJSON.Polygon,
  sortedAddresses: Array<{ lon: number; lat: number; house_number?: string | null; id: string }>,
  targetUnitIndex: number,
  streetEdgeP1: [number, number],
  streetEdgeP2: [number, number]
): GeoJSON.Polygon | null {

  // Calculate axis direction (street edge direction in meters)
  const [sx, sy] = lonLatToMeters(streetEdgeP1[0], streetEdgeP1[1]);
  const [ex, ey] = lonLatToMeters(streetEdgeP2[0], streetEdgeP2[1]);
  const dx = ex - sx;
  const dy = ey - sy;
  const len = Math.sqrt(dx * dx + dy * dy);
  
  if (len === 0) return null;
  
  const axis: [number, number] = [dx / len, dy / len];

  // Get outer ring
  const outerRing = buildingGeom.coordinates[0] as [number, number][];

  // Project all vertices to find min/max range for this building
  const projected = outerRing.map(([lon, lat]) => {
    const [x, y] = lonLatToMeters(lon, lat);
    const dist = (x - sx) * axis[0] + (y - sy) * axis[1];
    return dist;
  });
  
  const minDist = Math.min(...projected);
  const maxDist = Math.max(...projected);
  const totalRange = maxDist - minDist;

  // Calculate slice boundaries
  const unitCount = sortedAddresses.length;
  const sliceWidth = totalRange / unitCount;
  
  const start = minDist + (targetUnitIndex * sliceWidth);
  const end = start + sliceWidth;
  
  // Handle last unit (include any rounding errors)
  const actualEnd = targetUnitIndex === unitCount - 1 ? maxDist + 0.001 : end;

  // Clip the polygon
  const clippedRing = clipRingByAxis(outerRing, axis, [sx, sy], start, actualEnd);
  
  if (!clippedRing) {
    console.log(`[TownhouseSplitter] Slice ${targetUnitIndex} produced invalid geometry`);
    return null;
  }

  // Calculate area to check it's not degenerate (at least 10 m²)
  const area = calculatePolygonArea(clippedRing);
  if (area < 10) {
    console.log(`[TownhouseSplitter] Slice ${targetUnitIndex} too small: ${area.toFixed(1)}m²`);
    return null;
  }

  // SHRINK: Inset polygon by 0.3m to create visual gaps between units
  const shrunkRing = shrinkPolygon(clippedRing, 0.3);
  
  // Verify shrink didn't break the polygon
  const shrunkArea = calculatePolygonArea(shrunkRing);
  if (shrunkArea < 5) {
    console.log(`[TownhouseSplitter] Slice ${targetUnitIndex} too small after shrink, using original`);
    return {
      type: 'Polygon',
      coordinates: [clippedRing]
    };
  }

  return {
    type: 'Polygon',
    coordinates: [shrunkRing]
  };
}

/**
 * Calculate polygon area using shoelace formula
 */
function calculatePolygonArea(coords: number[][]): number {
  let area = 0;
  const n = coords.length;
  
  for (let i = 0; i < n - 1; i++) {
    const [x1, y1] = lonLatToMeters(coords[i][0], coords[i][1]);
    const [x2, y2] = lonLatToMeters(coords[i + 1][0], coords[i + 1][1]);
    area += x1 * y2 - x2 * y1;
  }
  
  return Math.abs(area) / 2;
}

// ============================================================================
// MAIN SERVICE CLASS
// ============================================================================

export class TownhouseSplitterService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Main entry point: Process all multi-unit buildings in a campaign
   */
  async processCampaignTownhouses(
    campaignId: string,
    buildingsGeoJSON: { features: BuildingFeature[] },
    overtureRelease: string = '2026-01-21.0'
  ): Promise<TownhouseSplitSummary> {
    console.log(`[TownhouseSplitter] Processing campaign ${campaignId}`);

    try {
      // 1. Fetch addresses linked to buildings
      const { data: links, error: linksError } = await this.supabase
        .from('building_address_links')
        .select(`
          building_id,
          address_id,
          match_type,
          confidence,
          building_area_sqm,
          is_multi_unit,
          unit_count,
          campaign_addresses:campaign_addresses!inner (
            id,
            formatted,
            house_number,
            street_name,
            geom
          )
        `)
        .eq('campaign_id', campaignId)
        .eq('is_multi_unit', true);

      if (linksError) {
        throw new Error(`Failed to fetch links: ${linksError.message}`);
      }

      if (!links || links.length === 0) {
        console.log('[TownhouseSplitter] No multi-unit buildings found');
        return {
          total_buildings: 0,
          townhouses_detected: 0,
          apartments_skipped: 0,
          units_created: 0,
          errors_logged: 0,
          avg_units_per_townhouse: 0,
        };
      }

      // 2. Group by building
      const buildingGroups = this.groupLinksByBuilding(links);
      console.log(`[TownhouseSplitter] Found ${buildingGroups.size} multi-unit buildings`);

      // 3. Analyze each building
      const analyses: BuildingAnalysis[] = [];
      for (const [buildingId, buildingLinks] of buildingGroups) {
        const building = buildingsGeoJSON.features.find(
          b => b.properties.gers_id === buildingId
        );
        
        if (!building) {
          console.warn(`[TownhouseSplitter] Building ${buildingId} not found in GeoJSON`);
          continue;
        }

        const analysis = this.analyzeBuilding(building, buildingLinks);
        analyses.push(analysis);
      }

      // 4. Process each building
      const summary: TownhouseSplitSummary = {
        total_buildings: analyses.length,
        townhouses_detected: 0,
        apartments_skipped: 0,
        units_created: 0,
        errors_logged: 0,
        avg_units_per_townhouse: 0,
      };

      let totalTownhouseUnits = 0;

      console.log(`[TownhouseSplitter] Processing ${analyses.length} building analyses`);

      for (const analysis of analyses) {
        console.log(`[TownhouseSplitter] Building ${analysis.building_id}: classification=${analysis.classification}, units=${analysis.unit_count}`);

        if (analysis.classification === 'apartment') {
          // Analysis logged but persistence gated by feature flag
          if (!isUnitPersistenceEnabled()) {
            console.log(`[TownhouseSplitter] Skipping apartment placeholder creation for ${analysis.building_id} (flag off), ${analysis.unit_count} units`);
            summary.apartments_skipped++;
            continue;
          }
          
          const result = await this.createApartmentPlaceholders(campaignId, analysis, overtureRelease);
          if (result.status === 'success') {
            summary.apartments_skipped++;
            summary.units_created += result.units?.length || 0;
          }
        } else {
          // Split townhouse or small_multifamily
          const result = this.splitBuilding(analysis);
          
          if (result.status === 'success' && result.units) {
            // Gate persistence behind feature flag
            if (!isUnitPersistenceEnabled()) {
              console.log(`[TownhouseSplitter] Skipping unit persistence for ${analysis.building_id} (flag off), classification=${analysis.classification}, units=${result.units.length}`);
              summary.townhouses_detected++;
              totalTownhouseUnits += result.units.length;
              continue;
            }
            
            const saveSuccess = await this.saveUnits(campaignId, result, overtureRelease);
            if (saveSuccess) {
              summary.townhouses_detected++;
              summary.units_created += result.units.length;
              totalTownhouseUnits += result.units.length;
            }
          } else {
            await this.logSplitError(campaignId, analysis, result);
            summary.errors_logged++;
          }
        }
      }

      if (summary.townhouses_detected > 0) {
        summary.avg_units_per_townhouse = totalTownhouseUnits / summary.townhouses_detected;
      }

      return summary;

    } catch (error) {
      console.error('[TownhouseSplitter] Fatal error:', error);
      return {
        total_buildings: 0,
        townhouses_detected: 0,
        apartments_skipped: 0,
        units_created: 0,
        errors_logged: 1,
        avg_units_per_townhouse: 0,
      };
    }
  }

  /**
   * Split building into units using proper polygon clipping
   */
  private splitBuilding(analysis: BuildingAnalysis): SplitResult {
    const { building, addresses, building_id } = analysis;
    const nUnits = addresses.length;

    console.log(`[TownhouseSplitter] Splitting ${building_id} into ${nUnits} units`);

    try {
      const coords = building.geometry.coordinates[0];
      
      // Find the street-facing edge (most addresses near it)
      let bestEdgeIndex = 0;
      let bestEdgeScore = -Infinity;
      
      for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i];
        const p2 = coords[i + 1];
        
        let score = 0;
        for (const addr of addresses) {
          const dist = this.pointToLineDistance([addr.lon, addr.lat], p1, p2);
          if (dist < 20) {
            score += 1 / (dist + 1);
          }
        }
        
        if (score > bestEdgeScore) {
          bestEdgeScore = score;
          bestEdgeIndex = i;
        }
      }

      const streetEdgeP1 = coords[bestEdgeIndex] as [number, number];
      const streetEdgeP2 = coords[bestEdgeIndex + 1] as [number, number];

      // Order addresses along the street edge
      const edgeVec = [streetEdgeP2[0] - streetEdgeP1[0], streetEdgeP2[1] - streetEdgeP1[1]];
      const edgeLen = Math.sqrt(edgeVec[0] * edgeVec[0] + edgeVec[1] * edgeVec[1]);
      const edgeUnit = [edgeVec[0] / edgeLen, edgeVec[1] / edgeLen];
      
      const orderedAddrs = [...addresses].sort((a, b) => {
        const da = (a.lon - streetEdgeP1[0]) * edgeUnit[0] + (a.lat - streetEdgeP1[1]) * edgeUnit[1];
        const db = (b.lon - streetEdgeP1[0]) * edgeUnit[0] + (b.lat - streetEdgeP1[1]) * edgeUnit[1];
        return da - db;
      });

      // Create units using proper polygon clipping
      const units: SplitUnit[] = [];
      
      for (let i = 0; i < nUnits; i++) {
        const unitGeometry = createUnitPolygon(
          building.geometry,
          orderedAddrs,
          i,
          streetEdgeP1,
          streetEdgeP2
        );

        if (!unitGeometry) {
          console.warn(`[TownhouseSplitter] Failed to create geometry for unit ${i}`);
          continue;
        }

        const addr = orderedAddrs[i];
        const area = calculatePolygonArea(unitGeometry.coordinates[0]);

        // Validate address is in unit (with buffer)
        const addrPoint: [number, number] = [addr.lon, addr.lat];
        const unitRing = unitGeometry.coordinates[0];
        let validation: SplitUnit['validation'] = 'passed';
        
        if (!this.isPointInPolygon(addrPoint, unitRing)) {
          if (!this.isPointNearPolygon(addrPoint, unitRing, 15)) {
            validation = 'failed';
          } else {
            validation = 'warning';
          }
        }

        units.push({
          address_id: addr.id,
          unit_geometry: unitGeometry,
          unit_number: addr.house_number || String(i + 1),
          validation,
          area_sqm: area,
        });
      }

      if (units.length === 0) {
        return {
          status: 'error',
          building_id,
          error_type: 'split_failed',
          error_message: 'No valid unit geometries created',
          parent_type: 'townhouse',
          split_method: 'obb_linear',
        };
      }

      return {
        status: 'success',
        building_id,
        units,
        parent_type: analysis.classification === 'townhouse' ? 'townhouse' : 'small_multifamily',
        split_method: 'obb_linear',
      };

    } catch (error) {
      console.error('[TownhouseSplitter] Error splitting building:', error);
      return {
        status: 'error',
        building_id,
        error_type: 'split_failed',
        error_message: error instanceof Error ? error.message : 'Unknown error',
        parent_type: 'townhouse',
        split_method: 'obb_linear',
      };
    }
  }

  /**
   * Create apartment placeholder circles (7+ units)
   */
  private async createApartmentPlaceholders(
    campaignId: string,
    analysis: BuildingAnalysis,
    overtureRelease: string
  ): Promise<SplitResult> {
    const { building, addresses, building_id } = analysis;
    
    console.log(`[TownhouseSplitter] Creating apartment placeholders for ${building_id}`);

    const centroid = this.calculateCentroid(building.geometry.coordinates[0]);
    
    const units: SplitUnit[] = addresses.map((addr, i) => {
      const circle = this.createCirclePolygon([addr.lon, addr.lat], 2);
      
      return {
        address_id: addr.id,
        unit_geometry: circle,
        unit_number: addr.house_number || `Unit ${i + 1}`,
        validation: 'passed',
        area_sqm: Math.PI * 2 * 2,
      };
    });

    const result: SplitResult = {
      status: 'success',
      building_id,
      units,
      parent_type: 'apartment',
      split_method: 'apartment_placeholder',
    };

    await this.saveUnits(campaignId, result, overtureRelease);
    return result;
  }

  /**
   * Analyze building characteristics
   */
  private analyzeBuilding(building: BuildingFeature, links: any[]): BuildingAnalysis {
    const coords = building.geometry.coordinates[0];
    const n = coords.length - 1;
    
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of coords) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    
    const [mx1, my1] = lonLatToMeters(minX, minY);
    const [mx2, my2] = lonLatToMeters(maxX, maxY);
    const widthM = Math.abs(mx2 - mx1);
    const heightM = Math.abs(my2 - my1);
    const aspectRatio = Math.max(widthM, heightM) / Math.min(widthM, heightM);

    const addresses: AddressFeature[] = links.map(l => ({
      id: l.address_id,
      lon: l.campaign_addresses.geom.coordinates[0],
      lat: l.campaign_addresses.geom.coordinates[1],
      house_number: l.campaign_addresses.house_number,
      street_name: l.campaign_addresses.street_name,
      formatted: l.campaign_addresses.formatted,
    }));

    const unitCount = addresses.length;
    let classification: BuildingAnalysis['classification'];
    
    if (unitCount > 6) {
      classification = 'apartment';
    } else if (unitCount >= 2 && unitCount <= 6 && aspectRatio > 1.2) {
      classification = 'townhouse';
    } else {
      classification = 'small_multifamily';
    }

    return {
      building_id: building.properties.gers_id,
      building,
      unit_count: unitCount,
      addresses,
      classification,
      aspect_ratio: aspectRatio,
      area_sqm: calculatePolygonArea(coords),
      is_l_shaped: coords.length > 7,
    };
  }

  /**
   * Save units to database
   */
  private async saveUnits(
    campaignId: string,
    result: SplitResult,
    overtureRelease: string
  ): Promise<boolean> {
    if (!result.units || result.units.length === 0) return false;

    const records = result.units.map(u => ({
      campaign_id: campaignId,
      parent_building_id: result.building_id,
      address_id: u.address_id,
      unit_number: u.unit_number,
      unit_geometry: u.unit_geometry,
      split_method: result.split_method,
      parent_type: result.parent_type,
      validation_status: u.validation,
    }));

    const { error } = await this.supabase.from('building_units').insert(records);

    if (error) {
      console.error('[TownhouseSplitter] Error saving units:', error.message);
      return false;
    }

    console.log(`[TownhouseSplitter] Saved ${records.length} units`);
    return true;
  }

  /**
   * Log split errors for manual review
   */
  private async logSplitError(
    campaignId: string,
    analysis: BuildingAnalysis,
    result: SplitResult
  ): Promise<void> {
    const record: SplitErrorRecord = {
      campaign_id: campaignId,
      building_id: analysis.building_id,
      building_geometry: analysis.building.geometry,
      error_type: (result.error_type as any) || 'split_failed',
      error_message: result.error_message || 'Unknown error',
      address_count: analysis.unit_count,
      address_ids: analysis.addresses.map(a => a.id),
      address_positions: analysis.addresses.map(a => ({
        address_id: a.id,
        lon: a.lon,
        lat: a.lat,
        house_number: a.house_number || undefined,
      })),
      suggested_action: 'manual_split',
    };

    await this.supabase.from('building_split_errors').insert(record);
  }

  // Helper methods
  private groupLinksByBuilding(links: any[]): Map<string, any[]> {
    const groups = new Map<string, any[]>();
    for (const link of links) {
      const existing = groups.get(link.building_id) || [];
      existing.push(link);
      groups.set(link.building_id, existing);
    }
    return groups;
  }

  private pointToLineDistance(point: [number, number], lineStart: number[], lineEnd: number[]): number {
    const [px, py] = point;
    const [x1, y1] = lineStart;
    const [x2, y2] = lineEnd;
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    
    if (len === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (len * len)));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  }

  private isPointInPolygon(point: [number, number], polygon: number[][]): boolean {
    const [x, y] = point;
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      
      if (intersect) inside = !inside;
    }
    
    return inside;
  }

  private isPointNearPolygon(point: [number, number], polygon: number[][], bufferMeters: number): boolean {
    const bufferDeg = bufferMeters / 111320;
    
    for (let i = 0; i < polygon.length - 1; i++) {
      const dist = this.pointToLineDistance(point, polygon[i], polygon[i + 1]);
      if (dist < bufferDeg) return true;
    }
    
    return false;
  }

  private calculateCentroid(polygon: number[][]): [number, number] {
    let cx = 0, cy = 0;
    for (const [x, y] of polygon) {
      cx += x;
      cy += y;
    }
    return [cx / polygon.length, cy / polygon.length];
  }

  private createCirclePolygon(center: [number, number], radiusMeters: number): GeoJSON.Polygon {
    const points: number[][] = [];
    const radiusDeg = radiusMeters / 111320;
    
    for (let i = 0; i <= 32; i++) {
      const angle = (i / 32) * 2 * Math.PI;
      const x = center[0] + radiusDeg * Math.cos(angle);
      const y = center[1] + radiusDeg * Math.sin(angle);
      points.push([x, y]);
    }
    
    return { type: 'Polygon', coordinates: [points] };
  }
}
