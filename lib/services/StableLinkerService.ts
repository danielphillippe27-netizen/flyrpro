/**
 * StableLinkerService - Gold Standard Spatial Join
 * 
 * Production-grade spatial matching between Overture building footprints
 * and address points with semantic validation, multi-unit detection,
 * and comprehensive quality assurance.
 * 
 * Implements 4-Tier Matching Hierarchy:
 * - Tier 1: Direct Containment + Street Verification (Confidence 1.0)
 * - Tier 2: Point-on-Surface (Confidence 0.9)
 * - Tier 3: Proximity + Semantic Match (Confidence 0.8)
 * - Tier 4: Fallback Nearest Valid (Confidence 0.5)
 */

import { SupabaseClient } from '@supabase/supabase-js';

/** Raised when an address cannot be uniquely assigned to a building due to identical confidence and spatial metrics after tie-breakers. */
export class DataIntegrityError extends Error {
  constructor(
    public readonly addressId: string,
    public readonly buildingIds: string[],
    public readonly score: number,
    message: string
  ) {
    super(message);
    this.name = 'DataIntegrityError';
  }
}

// Match result types
export interface MatchResult {
  addressId: string;
  addressGersId: string | null;
  buildingId: string;
  matchType: 'containment_verified' | 'containment_suspect' | 'point_on_surface' | 
             'proximity_verified' | 'proximity_fallback' | 'manual' | 'orphan';
  confidence: number;
  distanceMeters: number;
  streetMatchScore: number;
  buildingAreaSqm: number;
  buildingClass: string;
  buildingHeight: number | null;
  isMultiUnit: boolean;
  unitCount: number;
  unitArrangement: 'single' | 'horizontal' | 'vertical';
}

export interface OrphanRecord {
  addressId: string;
  coordinate: [number, number]; // [lon, lat]
  addressStreet: string;
  nearestBuildingId: string | null;
  nearestDistance: number | null;
  nearestBuildingStreet: string | null;
  streetMatchScore: number | null;
  suggestedBuildings: SuggestedBuilding[];
  /** pending_review = normal orphan; ambiguous_match = tie/conflict */
  status?: 'pending_review' | 'ambiguous_match';
  suggestedStreet?: string | null;
}

export interface SuggestedBuilding {
  buildingId: string;
  distance: number;
  streetScore: number;
  confidence: number;
  area: number;
}

export interface ProcessingMetadata {
  execution_time_ms: number;
  avg_precision_meters: number;
  street_mismatch_count: number;
  conflict_count: number;
  density_warning_count: number;
}

export interface SpatialJoinSummary {
  matched: number;
  orphans: number;
  suspect: number;
  avgConfidence: number;
  coveragePercent: number;
  matchBreakdown: {
    containmentVerified: number;
    containmentSuspect: number;
    pointOnSurface: number;
    proximityVerified: number;
    proximityFallback: number;
  };
  processing_metadata?: ProcessingMetadata;
}

// Building feature from GeoJSON (S3/TileLambda may include primary_street or street_name)
interface BuildingFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  properties: {
    gers_id: string;
    name: string | null;
    height: number | null;
    layer: string;
    primary_street?: string | null;
    street_name?: string | null;
  };
}

// Address from database
interface CampaignAddress {
  id: string;
  gers_id: string | null;
  formatted: string | null;
  house_number: string | null;
  street_name: string | null;
  geom: {
    type: 'Point';
    coordinates: [number, number];
  };
}

export class StableLinkerService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Main entry point: Run complete spatial join
   */
  async runSpatialJoin(
    campaignId: string,
    buildingsGeoJSON: { features: BuildingFeature[] },
    overtureRelease: string = '2026-01-21.0'
  ): Promise<SpatialJoinSummary> {
    const joinStartMs = Date.now();
    try {
      console.log(`[StableLinker] Starting spatial join for campaign ${campaignId}`);
      console.log(`[StableLinker] Buildings: ${buildingsGeoJSON?.features?.length || 0}`);

      // Validate input
      if (!buildingsGeoJSON?.features || !Array.isArray(buildingsGeoJSON.features)) {
        console.error('[StableLinker] Invalid buildings GeoJSON:', buildingsGeoJSON);
        throw new Error('Invalid buildings GeoJSON: missing features array');
      }

      // 1. Fetch addresses for this campaign
      const { data: addresses, error: addrError } = await this.supabase
        .from('campaign_addresses')
        .select('id, gers_id, formatted, house_number, street_name, geom')
        .eq('campaign_id', campaignId);

      if (addrError) {
        throw new Error(`Failed to fetch addresses: ${addrError.message}`);
      }

      if (!addresses || addresses.length === 0) {
        console.log('[StableLinker] No addresses found for campaign');
        return {
          matched: 0,
          orphans: 0,
          suspect: 0,
          avgConfidence: 0,
          coveragePercent: 0,
          matchBreakdown: {
            containmentVerified: 0,
            containmentSuspect: 0,
            pointOnSurface: 0,
            proximityVerified: 0,
            proximityFallback: 0,
          },
          processing_metadata: {
            execution_time_ms: 0,
            avg_precision_meters: 0,
            street_mismatch_count: 0,
            conflict_count: 0,
            density_warning_count: 0,
          },
        };
      }

      console.log(`[StableLinker] Addresses to match: ${addresses.length}`);

      // 2. Filter valid buildings (exclude sheds, garages)
      const validBuildings = this.filterValidBuildings(buildingsGeoJSON.features);
      console.log(`[StableLinker] Valid buildings after filtering: ${validBuildings.length}`);

      if (validBuildings.length === 0) {
        console.error('[StableLinker] No valid buildings after filtering!');
        return {
          matched: 0,
          orphans: addresses.length,
          suspect: 0,
          avgConfidence: 0,
          coveragePercent: 0,
          matchBreakdown: {
            containmentVerified: 0,
            containmentSuspect: 0,
            pointOnSurface: 0,
            proximityVerified: 0,
            proximityFallback: 0,
          },
          processing_metadata: {
            execution_time_ms: Date.now() - joinStartMs,
            avg_precision_meters: 0,
            street_mismatch_count: 0,
            conflict_count: 0,
            density_warning_count: 0,
          },
        };
      }

      // 3. Run 4-tier matching algorithm
      const matches: MatchResult[] = [];
      const orphans: OrphanRecord[] = [];
      const matchedBuildingIds = new Set<string>();
      let conflictCount = 0;
      let densityWarningCount = 0;

      console.log(`[StableLinker] Starting matching for ${addresses.length} addresses...`);

      for (const address of addresses) {
        try {
          const raw = this.matchAddressToBuilding(
            address,
            validBuildings,
            matchedBuildingIds
          );
          const result: MatchResult = Array.isArray(raw) ? raw[0] : raw;
          const densityWarning = Array.isArray(raw) && raw[1].densityWarning;
          if (densityWarning) densityWarningCount++;

          if (result.matchType === 'orphan') {
            orphans.push(this.createOrphanRecord(address, validBuildings));
          } else {
            matches.push(result);
            matchedBuildingIds.add(result.buildingId);
          }
        } catch (err) {
          if (err instanceof DataIntegrityError) {
            conflictCount++;
            console.warn(`[StableLinker] DataIntegrityError: ${err.message} (building_ids: ${err.buildingIds.join(', ')})`);
            const ambiguousOrphan = this.createAmbiguousOrphanRecord(address, err.buildingIds);
            orphans.push(ambiguousOrphan);
          } else {
            throw err;
          }
        }
      }

      console.log(`[StableLinker] Matching complete: ${matches.length} matches, ${orphans.length} orphans, ${conflictCount} conflicts`);

      // 4. Detect multi-unit buildings
      this.detectMultiUnitBuildings(matches);

      // 5. Save results to database
      await this.saveMatches(campaignId, matches, overtureRelease);
      await this.saveOrphans(campaignId, orphans);

      // 6. Generate summary with telemetry
      const executionTimeMs = Date.now() - joinStartMs;
      const summary = this.generateSummary(matches, addresses.length, {
        conflictCount,
        densityWarningCount,
        executionTimeMs,
      });

      if (summary.coveragePercent < 95) {
        console.warn(`[StableLinker] building_coverage_ratio below 95%: ${summary.coveragePercent}%`);
      }

      console.log(`[StableLinker] Complete:`, summary);

      return summary;
    } catch (error) {
      console.error('[StableLinker] CRITICAL ERROR in runSpatialJoin:', error);
      throw error;
    }
  }

  /**
   * Filter out noise and optionally small outbuildings (gold standard).
   * - Noise: exclude area < 5 m².
   * - Shed/outbuilding: exclude area < 30 m² so main building wins when multiple candidates (tie-break by area handles the rest).
   */
  private filterValidBuildings(buildings: BuildingFeature[]): BuildingFeature[] {
    const filtered = buildings.filter(b => {
      const area = this.calculatePolygonArea(b.geometry.coordinates[0]);
      if (area < 5) {
        return false; // noise_geometry
      }
      if (area < 30) {
        return false; // shed/outbuilding; prefer main building (area tie-break in match)
      }
      return true;
    });
    console.log(`[StableLinker] Filtered: ${filtered.length}/${buildings.length} buildings (excluded < 5 m² noise, < 30 m² sheds)`);
    return filtered;
  }

  /**
   * 4-Tier Matching Algorithm (with tie-break; can throw DataIntegrityError).
   * Returns MatchResult or [MatchResult, { densityWarning: true }] when density guard triggers.
   */
  private matchAddressToBuilding(
    address: CampaignAddress,
    buildings: BuildingFeature[],
    matchedBuildingIds: Set<string>
  ): MatchResult | [MatchResult, { densityWarning: true }] {
    const addressCoords = address.geom.coordinates;

    // TIER 1: Direct Containment + street verification (may throw on tie)
    const containingBuilding = this.pickBestContainingOrThrow(address.id, addressCoords, buildings);
    if (containingBuilding) {
      const streetScore = this.calculateStreetMatchScore(
        address.street_name ?? '',
        this.getBuildingStreet(containingBuilding) ?? ''
      );
      const verified = streetScore >= 0.8;
      return this.createMatchResult(
        address,
        containingBuilding,
        verified ? 'containment_verified' : 'containment_suspect',
        verified ? 1.0 : 0.85,
        0,
        streetScore
      );
    }

    // Density guard: if > 100 candidates within 100m, only allow containment (avoid memory/spurious matches)
    const candidateCount = this.countCandidatesWithin(addressCoords, buildings, 100);
    if (candidateCount > 100) {
      console.warn(`[StableLinker] density_warning addressId=${address.id} candidateCount=${candidateCount} using containment-only`);
      const orphanResult = this.createMatchResult(address, null, 'orphan', 0, 0, 0);
      return [orphanResult, { densityWarning: true }];
    }

    // TIER 2: Point-on-Surface + street (may throw on tie)
    const pointOnSurfaceBuilding = this.pickBestPointOnSurfaceOrThrow(address.id, addressCoords, buildings);
    if (pointOnSurfaceBuilding) {
      const streetScore = this.calculateStreetMatchScore(
        address.street_name ?? '',
        this.getBuildingStreet(pointOnSurfaceBuilding) ?? ''
      );
      const verified = streetScore >= 0.8;
      return this.createMatchResult(
        address,
        pointOnSurfaceBuilding,
        'point_on_surface',
        verified ? 0.9 : 0.85,
        0,
        streetScore
      );
    }

    // TIER 3: Proximity within 50m; prefer street match, then area, then distance
    const nearestMatches = this.findNearestBuildings(addressCoords, buildings, 10);
    const within50 = nearestMatches.filter(c => c.distance <= 50);
    if (within50.length > 0) {
      const withStreet = within50.map(c => ({
        ...c,
        area: this.calculatePolygonArea(c.building.geometry.coordinates[0]),
        streetScore: this.calculateStreetMatchScore(
          address.street_name ?? '',
          this.getBuildingStreet(c.building) ?? ''
        ),
      }));
      withStreet.sort((a, b) => {
        if (b.streetScore !== a.streetScore) return b.streetScore - a.streetScore;
        if (Math.abs(a.distance - b.distance) >= 0.5) return a.distance - b.distance;
        return b.area - a.area;
      });
      const best = this.pickBestProximityOrThrow(address.id, withStreet, 0.7);
      if (best) {
        const streetScore = this.calculateStreetMatchScore(
          address.street_name ?? '',
          this.getBuildingStreet(best.building) ?? ''
        );
        const verified = streetScore >= 0.8;
        return this.createMatchResult(
          address,
          best.building,
          verified ? 'proximity_verified' : 'proximity_fallback',
          verified ? Math.max(0.7, 0.9 - best.distance * 0.01) : Math.max(0.5, 0.7 - best.distance * 0.01),
          best.distance,
          streetScore
        );
      }
    }

    // TIER 4: Fallback (nearest within 100m, not already matched); no street requirement
    const within100 = nearestMatches.filter(
      c => c.distance <= 100 && !matchedBuildingIds.has(c.building.properties.gers_id)
    );
    if (within100.length > 0) {
      const best = this.pickBestProximityOrThrow(address.id, within100, 0.5);
      if (best) {
        return this.createMatchResult(
          address,
          best.building,
          'proximity_fallback',
          Math.max(0.5, 0.7 - best.distance * 0.01),
          best.distance,
          0
        );
      }
    }

    // ORPHAN: No match found
    return this.createMatchResult(
      address,
      null,
      'orphan',
      0,
      0,
      0
    );
  }

  /**
   * Check if point is inside polygon (ray casting algorithm)
   */
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

  /**
   * Check if point is on polygon boundary
   */
  private isPointOnPolygonBoundary(point: [number, number], polygon: number[][]): boolean {
    const tolerance = 0.00001; // ~1m in degrees
    
    for (let i = 0; i < polygon.length - 1; i++) {
      const [x1, y1] = polygon[i];
      const [x2, y2] = polygon[i + 1];
      
      // Distance from point to line segment
      const distance = this.pointToLineSegmentDistance(point, [x1, y1], [x2, y2]);
      if (distance < tolerance) return true;
    }
    
    return false;
  }

  /**
   * Calculate distance from point to line segment
   */
  private pointToLineSegmentDistance(
    point: [number, number],
    lineStart: [number, number],
    lineEnd: [number, number]
  ): number {
    const [px, py] = point;
    const [x1, y1] = lineStart;
    const [x2, y2] = lineEnd;
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (length * length)));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  }

  /**
   * Find all buildings containing point (for tie-break: prefer largest area)
   */
  private findAllContainingBuildings(
    point: [number, number],
    buildings: BuildingFeature[]
  ): BuildingFeature[] {
    const containing: BuildingFeature[] = [];
    for (const building of buildings) {
      const coords = building.geometry.coordinates[0];
      if (this.isPointInPolygon(point, coords)) {
        containing.push(building);
      }
    }
    return containing.sort((a, b) => {
      const areaA = this.calculatePolygonArea(a.geometry.coordinates[0]);
      const areaB = this.calculatePolygonArea(b.geometry.coordinates[0]);
      return areaB - areaA; // largest first
    });
  }

  /**
   * Pick best containing building or throw DataIntegrityError if tie (area within 2x).
   */
  private pickBestContainingOrThrow(
    addressId: string,
    point: [number, number],
    buildings: BuildingFeature[]
  ): BuildingFeature | null {
    const containing = this.findAllContainingBuildings(point, buildings);
    if (containing.length === 0) return null;
    if (containing.length === 1) return containing[0];
    const area0 = this.calculatePolygonArea(containing[0].geometry.coordinates[0]);
    const area1 = this.calculatePolygonArea(containing[1].geometry.coordinates[0]);
    if (area0 > 2 * area1) return containing[0];
    throw new DataIntegrityError(
      addressId,
      containing.slice(0, 2).map(b => b.properties.gers_id),
      1.0,
      `Containment tie: address ${addressId} in multiple buildings (area tier)`
    );
  }

  /**
   * Find building containing point (convenience; returns first/largest from findAllContainingBuildings)
   */
  private findContainingBuilding(
    point: [number, number],
    buildings: BuildingFeature[]
  ): BuildingFeature | null {
    const containing = this.findAllContainingBuildings(point, buildings);
    return containing.length > 0 ? containing[0] : null;
  }

  /**
   * Find all buildings with point on boundary (for tie-break: prefer largest area)
   */
  private findAllPointOnSurfaceBuildings(
    point: [number, number],
    buildings: BuildingFeature[]
  ): BuildingFeature[] {
    const onSurface: BuildingFeature[] = [];
    for (const building of buildings) {
      if (this.isPointOnPolygonBoundary(point, building.geometry.coordinates[0])) {
        onSurface.push(building);
      }
    }
    return onSurface.sort((a, b) => {
      const areaA = this.calculatePolygonArea(a.geometry.coordinates[0]);
      const areaB = this.calculatePolygonArea(b.geometry.coordinates[0]);
      return areaB - areaA;
    });
  }

  /**
   * Pick best point-on-surface building or throw if tie.
   */
  private pickBestPointOnSurfaceOrThrow(
    addressId: string,
    point: [number, number],
    buildings: BuildingFeature[]
  ): BuildingFeature | null {
    const onSurface = this.findAllPointOnSurfaceBuildings(point, buildings);
    if (onSurface.length === 0) return null;
    if (onSurface.length === 1) return onSurface[0];
    const area0 = this.calculatePolygonArea(onSurface[0].geometry.coordinates[0]);
    const area1 = this.calculatePolygonArea(onSurface[1].geometry.coordinates[0]);
    if (area0 > 2 * area1) return onSurface[0];
    throw new DataIntegrityError(
      addressId,
      onSurface.slice(0, 2).map(b => b.properties.gers_id),
      0.9,
      `Point-on-surface tie: address ${addressId} on boundary of multiple buildings`
    );
  }

  /**
   * Find building with point on surface (convenience)
   */
  private findPointOnSurfaceBuilding(
    point: [number, number],
    buildings: BuildingFeature[]
  ): BuildingFeature | null {
    const onSurface = this.findAllPointOnSurfaceBuildings(point, buildings);
    return onSurface.length > 0 ? onSurface[0] : null;
  }

  /**
   * Count buildings within radius (meters) of point (for density guard)
   */
  private countCandidatesWithin(
    point: [number, number],
    buildings: BuildingFeature[],
    radiusMeters: number
  ): number {
    let count = 0;
    for (const building of buildings) {
      const centroid = this.calculateCentroid(building.geometry.coordinates[0]);
      if (this.calculateDistance(point, centroid) <= radiusMeters) count++;
    }
    return count;
  }

  /**
   * Find K nearest buildings (by centroid distance)
   */
  private findNearestBuildings(
    point: [number, number],
    buildings: BuildingFeature[],
    k: number
  ): Array<{ building: BuildingFeature; distance: number }> {
    const distances = buildings.map(building => {
      const centroid = this.calculateCentroid(building.geometry.coordinates[0]);
      const distance = this.calculateDistance(point, centroid);
      return { building, distance };
    });

    return distances
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  }

  /**
   * Pick best proximity candidate (by optional streetScore, then distance, then area) or throw DataIntegrityError if tie.
   */
  private pickBestProximityOrThrow(
    addressId: string,
    candidates: Array<{ building: BuildingFeature; distance: number; area?: number; streetScore?: number }>,
    score: number
  ): { building: BuildingFeature; distance: number } | null {
    if (candidates.length === 0) return null;
    const withArea = candidates.map(c => ({
      ...c,
      area: c.area ?? this.calculatePolygonArea(c.building.geometry.coordinates[0]),
    }));
    withArea.sort((a, b) => {
      if (a.streetScore != null && b.streetScore != null && b.streetScore !== a.streetScore) {
        return b.streetScore - a.streetScore;
      }
      if (Math.abs(a.distance - b.distance) >= 0.5) return a.distance - b.distance;
      return b.area - a.area;
    });
    const first = withArea[0];
    if (withArea.length === 1) return { building: first.building, distance: first.distance };
    const second = withArea[1];
    const distTie = Math.abs(first.distance - second.distance) < 0.5;
    const areaTie = first.area <= 2 * second.area && second.area <= 2 * first.area;
    if (distTie && areaTie) {
      throw new DataIntegrityError(
        addressId,
        [first.building.properties.gers_id, second.building.properties.gers_id],
        score,
        `Proximity tie: address ${addressId} equidistant to multiple buildings`
      );
    }
    return { building: first.building, distance: first.distance };
  }

  /**
   * Calculate polygon centroid
   */
  private calculateCentroid(polygon: number[][]): [number, number] {
    let sumX = 0, sumY = 0;
    for (const [x, y] of polygon) {
      sumX += x;
      sumY += y;
    }
    return [sumX / polygon.length, sumY / polygon.length];
  }

  /**
   * Calculate distance between two points (in meters)
   */
  private calculateDistance(p1: [number, number], p2: [number, number]): number {
    const R = 6371000; // Earth radius in meters
    const lat1 = p1[1] * Math.PI / 180;
    const lat2 = p2[1] * Math.PI / 180;
    const deltaLat = (p2[1] - p1[1]) * Math.PI / 180;
    const deltaLon = (p2[0] - p1[0]) * Math.PI / 180;
    
    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(deltaLon/2) * Math.sin(deltaLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  }

  /**
   * Calculate polygon area (approximate, in square meters)
   */
  private calculatePolygonArea(polygon: number[][]): number {
    let area = 0;
    const n = polygon.length;
    
    for (let i = 0; i < n - 1; i++) {
      area += polygon[i][0] * polygon[i + 1][1];
      area -= polygon[i + 1][0] * polygon[i][1];
    }
    
    area = Math.abs(area) / 2;
    
    // Convert to approximate square meters (rough conversion at mid-latitudes)
    const avgLat = polygon.reduce((sum, p) => sum + p[1], 0) / n;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLon = 111320 * Math.cos(avgLat * Math.PI / 180);
    
    return area * metersPerDegreeLat * metersPerDegreeLon;
  }

  /**
   * Get building street for semantic match (primary_street | street_name | name)
   */
  private getBuildingStreet(building: BuildingFeature): string | null {
    const p = building.properties;
    return p.primary_street ?? p.street_name ?? p.name ?? null;
  }

  /**
   * Normalize street name for comparison
   */
  private normalizeStreetName(street: string): string {
    return street
      .toLowerCase()
      .replace(/\bst\b/g, 'street')
      .replace(/\bave\b/g, 'avenue')
      .replace(/\bave\.?\b/g, 'avenue')
      .replace(/\bdr\b/g, 'drive')
      .replace(/\bblvd\b/g, 'boulevard')
      .replace(/\bblvd\.?\b/g, 'boulevard')
      .replace(/\broad\b/g, 'road')
      .replace(/\bhwy\b/g, 'highway')
      .replace(/\bhwy\.?\b/g, 'highway')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculate street name match score (0-1)
   */
  private calculateStreetMatchScore(addrStreet: string, bldgStreet: string): number {
    if (!addrStreet || !bldgStreet) return 0;
    if (addrStreet === bldgStreet) return 1;
    
    const addr = this.normalizeStreetName(addrStreet);
    const bldg = this.normalizeStreetName(bldgStreet);
    
    if (addr === bldg) return 1;
    
    // Simple word overlap score
    const addrWords = new Set(addr.split(' '));
    const bldgWords = bldg.split(' ');
    
    let matches = 0;
    for (const word of bldgWords) {
      if (addrWords.has(word)) matches++;
    }
    
    return matches / Math.max(addrWords.size, bldgWords.length);
  }

  /**
   * Create match result object
   */
  private createMatchResult(
    address: CampaignAddress,
    building: BuildingFeature | null,
    matchType: MatchResult['matchType'],
    confidence: number,
    distanceMeters: number,
    streetMatchScore: number
  ): MatchResult {
    if (!building) {
      return {
        addressId: address.id,
        addressGersId: address.gers_id,
        buildingId: '',
        matchType: 'orphan',
        confidence: 0,
        distanceMeters: 0,
        streetMatchScore: 0,
        buildingAreaSqm: 0,
        buildingClass: '',
        buildingHeight: null,
        isMultiUnit: false,
        unitCount: 1,
        unitArrangement: 'single',
      };
    }

    const area = this.calculatePolygonArea(building.geometry.coordinates[0]);
    
    return {
      addressId: address.id,
      addressGersId: address.gers_id,
      buildingId: building.properties.gers_id,
      matchType,
      confidence,
      distanceMeters,
      streetMatchScore,
      buildingAreaSqm: area,
      buildingClass: 'residential', // Default, could be enhanced
      buildingHeight: building.properties.height,
      isMultiUnit: false, // Will be updated in detectMultiUnitBuildings
      unitCount: 1,
      unitArrangement: 'single',
    };
  }

  /**
   * Detect multi-unit buildings
   */
  private detectMultiUnitBuildings(matches: MatchResult[]): void {
    // Group matches by building
    const buildingGroups = new Map<string, MatchResult[]>();
    
    for (const match of matches) {
      if (match.matchType === 'orphan') continue;
      
      const existing = buildingGroups.get(match.buildingId) || [];
      existing.push(match);
      buildingGroups.set(match.buildingId, existing);
    }
    
    // Analyze each building with multiple addresses
    for (const [buildingId, buildingMatches] of buildingGroups) {
      if (buildingMatches.length <= 1) continue;
      
      // Mark all as multi-unit
      for (const match of buildingMatches) {
        match.isMultiUnit = true;
        match.unitCount = buildingMatches.length;
      }
      
      // Determine arrangement (simplified)
      // In a real implementation, we'd calculate convex hull and analyze spread
      const firstMatch = buildingMatches[0];
      if (buildingMatches.length > 6) {
        firstMatch.unitArrangement = 'vertical'; // Assume apartment
      } else if (buildingMatches.length > 1) {
        firstMatch.unitArrangement = 'horizontal'; // Assume townhouse/side-by-side
      }
      
      // Propagate arrangement to all matches
      for (const match of buildingMatches) {
        match.unitArrangement = firstMatch.unitArrangement;
      }
    }
  }

  /**
   * Create orphan record with suggestions (Pure Spatial)
   */
  private createOrphanRecord(
    address: CampaignAddress,
    buildings: BuildingFeature[]
  ): OrphanRecord {
    const addressCoords = address.geom.coordinates;
    
    // Find top 3 suggestions
    const nearest = this.findNearestBuildings(addressCoords, buildings, 3);
    const suggestions: SuggestedBuilding[] = nearest.map(n => {
      const area = this.calculatePolygonArea(n.building.geometry.coordinates[0]);
      
      // Confidence based purely on distance
      let confidence = 0.3;
      if (n.distance < 10) confidence += 0.3;
      else if (n.distance < 25) confidence += 0.2;
      else if (n.distance < 50) confidence += 0.1;
      
      return {
        buildingId: n.building.properties.gers_id,
        distance: n.distance,
        streetScore: 1.0, // Always 1.0 when no street matching
        confidence: Math.min(confidence, 0.8),
        area,
      };
    });

    const nearestBuilding = nearest[0];

    return {
      addressId: address.id,
      coordinate: addressCoords,
      addressStreet: address.street_name || '',
      nearestBuildingId: nearestBuilding?.building.properties.gers_id || null,
      nearestDistance: nearestBuilding?.distance || null,
      nearestBuildingStreet: nearestBuilding?.building.properties.name || null,
      streetMatchScore: 1.0,
      suggestedBuildings: suggestions,
      status: 'pending_review',
      suggestedStreet: address.street_name ?? null,
    };
  }

  /**
   * Create orphan record for ambiguous match (DataIntegrityError)
   */
  private createAmbiguousOrphanRecord(
    address: CampaignAddress,
    buildingIds: string[]
  ): OrphanRecord {
    return {
      addressId: address.id,
      coordinate: address.geom.coordinates,
      addressStreet: address.street_name || '',
      nearestBuildingId: buildingIds[0] ?? null,
      nearestDistance: null,
      nearestBuildingStreet: null,
      streetMatchScore: null,
      suggestedBuildings: buildingIds.map(bid => ({
        buildingId: bid,
        distance: 0,
        streetScore: 0,
        confidence: 0,
        area: 0,
      })),
      status: 'ambiguous_match',
      suggestedStreet: address.street_name ?? null,
    };
  }

  /**
   * Save matches to database
   */
  private async saveMatches(
    campaignId: string,
    matches: MatchResult[],
    overtureRelease: string
  ): Promise<void> {
    const validMatches = matches.filter(m => m.matchType !== 'orphan');
    
    if (validMatches.length === 0) {
      console.log('[StableLinker] No matches to save');
      return;
    }

    const records = validMatches.map(match => ({
      campaign_id: campaignId,
      building_id: match.buildingId,
      address_id: match.addressId,
      match_type: match.matchType,
      confidence: match.confidence,
      distance_meters: match.distanceMeters,
      street_match_score: match.streetMatchScore,
      building_area_sqm: match.buildingAreaSqm,
      building_class: match.buildingClass,
      building_height: match.buildingHeight,
      is_multi_unit: match.isMultiUnit,
      unit_count: match.unitCount,
      unit_arrangement: match.unitArrangement,
      overture_release: overtureRelease,
    }));

    // Batch insert
    const batchSize = 500;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await this.supabase
        .from('building_address_links')
        .insert(batch);
      
      if (error) {
        console.error(`[StableLinker] Error saving batch ${i / batchSize + 1}:`, error.message);
      }
    }

    console.log(`[StableLinker] Saved ${validMatches.length} matches`);
  }

  /**
   * Save orphans to database (with coordinate, suggested_street, status via batch RPC)
   */
  private async saveOrphans(
    campaignId: string,
    orphans: OrphanRecord[]
  ): Promise<void> {
    if (orphans.length === 0) {
      console.log('[StableLinker] No orphans to save');
      return;
    }

    const rows = orphans.map(orphan => ({
      address_id: orphan.addressId,
      nearest_building_id: orphan.nearestBuildingId ?? '',
      nearest_distance: orphan.nearestDistance ?? undefined,
      nearest_building_street: orphan.nearestBuildingStreet ?? '',
      address_street: orphan.addressStreet ?? '',
      street_match_score: orphan.streetMatchScore ?? undefined,
      suggested_buildings: orphan.suggestedBuildings,
      status: orphan.status ?? 'pending_review',
      suggested_street: orphan.suggestedStreet ?? orphan.addressStreet ?? '',
      lon: orphan.coordinate[0],
      lat: orphan.coordinate[1],
    }));

    const { error } = await this.supabase.rpc('insert_address_orphans_batch', {
      p_campaign_id: campaignId,
      p_rows: rows,
    });

    if (error) {
      console.error('[StableLinker] Error saving orphans:', error.message);
    } else {
      console.log(`[StableLinker] Saved ${orphans.length} orphans`);
    }
  }

  /**
   * Generate summary statistics and optional processing_metadata
   */
  private generateSummary(
    matches: MatchResult[],
    totalAddresses: number,
    telemetry?: { conflictCount: number; densityWarningCount: number; executionTimeMs: number }
  ): SpatialJoinSummary {
    const validMatches = matches.filter(m => m.matchType !== 'orphan');

    const containmentVerified = validMatches.filter(m => m.matchType === 'containment_verified').length;
    const containmentSuspect = validMatches.filter(m => m.matchType === 'containment_suspect').length;
    const pointOnSurface = validMatches.filter(m => m.matchType === 'point_on_surface').length;
    const proximityVerified = validMatches.filter(m => m.matchType === 'proximity_verified').length;
    const proximityFallback = validMatches.filter(m => m.matchType === 'proximity_fallback').length;

    const suspect = containmentSuspect + proximityFallback;
    const orphans = matches.filter(m => m.matchType === 'orphan').length;

    const avgConfidence = validMatches.length > 0
      ? validMatches.reduce((sum, m) => sum + m.confidence, 0) / validMatches.length
      : 0;

    const proximityMatches = validMatches.filter(
      m => m.matchType === 'proximity_verified' || m.matchType === 'proximity_fallback'
    );
    const avgPrecisionMeters =
      proximityMatches.length > 0
        ? proximityMatches.reduce((sum, m) => sum + m.distanceMeters, 0) / proximityMatches.length
        : 0;
    const streetMismatchCount = validMatches.filter(
      m => m.matchType === 'containment_suspect' || (m.matchType === 'proximity_fallback' && m.streetMatchScore > 0 && m.streetMatchScore < 0.8)
    ).length;

    const summary: SpatialJoinSummary = {
      matched: validMatches.length,
      orphans,
      suspect,
      avgConfidence: Math.round(avgConfidence * 100) / 100,
      coveragePercent: Math.round((validMatches.length / totalAddresses) * 100),
      matchBreakdown: {
        containmentVerified,
        containmentSuspect,
        pointOnSurface,
        proximityVerified,
        proximityFallback,
      },
    };

    if (telemetry) {
      summary.processing_metadata = {
        execution_time_ms: telemetry.executionTimeMs,
        avg_precision_meters: Math.round(avgPrecisionMeters * 100) / 100,
        street_mismatch_count: streetMismatchCount,
        conflict_count: telemetry.conflictCount,
        density_warning_count: telemetry.densityWarningCount,
      };
    }

    return summary;
  }

  /**
   * Get matches for a campaign (API endpoint helper)
   */
  async getCampaignMatches(campaignId: string): Promise<MatchResult[]> {
    const { data, error } = await this.supabase
      .from('building_address_links')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('confidence', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch matches: ${error.message}`);
    }

    return (data || []).map(row => ({
      addressId: row.address_id,
      addressGersId: null,
      buildingId: row.building_id,
      matchType: row.match_type,
      confidence: row.confidence,
      distanceMeters: row.distance_meters,
      streetMatchScore: row.street_match_score,
      buildingAreaSqm: row.building_area_sqm,
      buildingClass: row.building_class,
      buildingHeight: row.building_height,
      isMultiUnit: row.is_multi_unit,
      unitCount: row.unit_count,
      unitArrangement: row.unit_arrangement,
    }));
  }

  /**
   * Get orphans for a campaign (API endpoint helper)
   */
  async getCampaignOrphans(campaignId: string): Promise<OrphanRecord[]> {
    const { data, error } = await this.supabase
      .from('address_orphans')
      .select('*')
      .eq('campaign_id', campaignId)
      .in('status', ['pending', 'pending_review', 'ambiguous_match'])
      .order('nearest_distance', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch orphans: ${error.message}`);
    }

    return (data || []).map(row => {
      const coord = row.coordinate as { type: 'Point'; coordinates: [number, number] } | null;
      return {
        addressId: row.address_id,
        coordinate: (coord?.coordinates ?? [0, 0]) as [number, number],
        addressStreet: row.address_street ?? '',
        nearestBuildingId: row.nearest_building_id,
        nearestDistance: row.nearest_distance,
        nearestBuildingStreet: row.nearest_building_street,
        streetMatchScore: row.street_match_score,
        suggestedBuildings: row.suggested_buildings || [],
        status: row.status as OrphanRecord['status'],
        suggestedStreet: row.suggested_street ?? undefined,
      };
    });
  }

  /**
   * Manually assign orphan to building (API endpoint helper)
   */
  async assignOrphan(
    orphanId: string,
    buildingId: string,
    assignedBy: string
  ): Promise<void> {
    // Update orphan status
    const { error: orphanError } = await this.supabase
      .from('address_orphans')
      .update({
        status: 'assigned',
        assigned_building_id: buildingId,
        assigned_by: assignedBy,
        assigned_at: new Date().toISOString(),
      })
      .eq('id', orphanId);

    if (orphanError) {
      throw new Error(`Failed to update orphan: ${orphanError.message}`);
    }

    // Get orphan details to create link
    const { data: orphan } = await this.supabase
      .from('address_orphans')
      .select('campaign_id, address_id')
      .eq('id', orphanId)
      .single();

    if (orphan) {
      // Create manual link
      const { error: linkError } = await this.supabase
        .from('building_address_links')
        .insert({
          campaign_id: orphan.campaign_id,
          building_id: buildingId,
          address_id: orphan.address_id,
          match_type: 'manual',
          confidence: 1.0,
          distance_meters: 0,
          street_match_score: 1.0,
        });

      if (linkError) {
        throw new Error(`Failed to create link: ${linkError.message}`);
      }
    }
  }
}
