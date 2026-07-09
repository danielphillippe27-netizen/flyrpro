/**
 * StableLinkerService - Gold Standard Spatial Join
 * 
 * Production-grade spatial matching between Overture building footprints
 * and address points with semantic validation, multi-unit detection,
 * and comprehensive quality assurance.
 * 
 * Implements 5-Tier Matching Hierarchy:
 * - Tier 1: Direct Containment + Street Verification (Confidence 1.0)
 * - Tier 2: Parcel Bridge (Confidence 0.95)
 * - Tier 3: Point-on-Surface (Confidence 0.9)
 * - Tier 4: Proximity + Semantic Match (Confidence 0.8)
 * - Tier 5: Fallback Nearest Valid (Confidence 0.5)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import { retryWithBackoff } from '@/lib/utils/retryWithBackoff';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GOLD_ADDRESS_UPDATE_BATCH_SIZE = 50;

// Match result types
export interface MatchResult {
  addressId: string;
  addressGersId: string | null;
  buildingId: string;
  matchType: 'containment_verified' | 'containment_suspect' | 'point_on_surface' |
             'parcel_verified' | 'proximity_verified' | 'proximity_fallback' | 'manual' | 'orphan';
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
    parcelVerified: number;
    proximityVerified: number;
    proximityFallback: number;
  };
  processing_metadata?: ProcessingMetadata;
}

// Building feature from GeoJSON (S3/TileLambda may include primary_street or street_name)
export interface BuildingFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    gers_id: string;
    name: string | null;
    height: number | null;
    layer: string;
    primary_street?: string | null;
    street_name?: string | null;
    house_number?: string | null;
    address_text?: string | null;
    address_count?: number | null;
    units_count?: number | null;
    is_townhome?: boolean | null;
    source?: string | null;
    feature_type?: string | null;
    feature_status?: string | null;
    building_identifier_source?: string | null;
  };
}

interface SpatialJoinOptions {
  resetExisting?: boolean;
  persistenceMode?: 'silver' | 'gold';
  parcelsGeoJSON?: { features: ParcelFeature[] } | null;
}

export interface StableManualLinkResult {
  linkedAddressIds: string[];
  unitCount: number;
}

export interface StableManualUnlinkResult {
  linkedAddressIds: string[];
  unitCount: number;
  deletedAddressId?: string;
}

type ManualLinkRpcData = {
  linked_address_ids?: unknown;
  unit_count?: unknown;
  deleted_address_id?: unknown;
};

type ManualLinkRpcResult = {
  data: ManualLinkRpcData | null;
  error: { message: string } | null;
};

type ManualLinkRpc = (
  functionName: string,
  args: Record<string, unknown>
) => Promise<ManualLinkRpcResult>;

const MIN_LINKABLE_BUILDING_AREA_SQM = 30;
const NEAREST_BUILDING_CANDIDATE_LIMIT = 10;
const PARCEL_BRIDGE_CONFIDENCE = 0.95;
const PROXIMITY_CONFIDENCE = 0.80;
const FOOTPRINT_EDGE_GRACE_CONFIDENCE = 0.90;
const FOOTPRINT_EDGE_GRACE_METERS = 10;
const FALLBACK_RADIUS_METERS = 75;
const PROXIMITY_RADIUS_METERS = 60;
const MULTI_ADDRESS_NEARBY_RADIUS_METERS = 25;
const MINIMUM_SEMANTIC_PROXIMITY_SCORE = 0.65;

interface ParcelFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties?: Record<string, unknown> | null;
}

type MatchCandidate = {
  building: BuildingFeature;
  matchType: MatchResult['matchType'];
  confidence: number;
  distance: number;
  streetScore: number;
};

type PreparedParcel = {
  rings: number[][][];
  bbox: [number, number, number, number];
};

function manualLinkRpc(client: SupabaseClient): ManualLinkRpc | null {
  const rpc = (client as SupabaseClient & { rpc?: unknown }).rpc;
  return typeof rpc === 'function' ? (rpc.bind(client) as unknown as ManualLinkRpc) : null;
}

// Address from database
interface CampaignAddress {
  id: string;
  gers_id: string | null;
  formatted: string | null;
  house_number: string | null;
  street_name: string | null;
  geom: unknown;
}

interface CampaignAddressWithPoint extends Omit<CampaignAddress, 'geom'> {
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

  private parsePointGeometry(value: unknown): CampaignAddressWithPoint['geom'] | null {
    if (!value) return null;

    if (typeof value === 'object') {
      const geometry = value as { type?: unknown; coordinates?: unknown; geometry?: unknown };
      if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
        return this.pointFromCoordinates(geometry.coordinates);
      }
      if (geometry.geometry) {
        return this.parsePointGeometry(geometry.geometry);
      }
      return null;
    }

    if (typeof value !== 'string') return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      return this.parsePointGeometry(JSON.parse(trimmed));
    } catch {
      // Continue through WKT/EWKB parsing.
    }

    const wktMatch = trimmed.match(/(?:SRID=\d+;)?POINT\s*\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/i);
    if (wktMatch) {
      return this.pointFromLonLat(Number(wktMatch[1]), Number(wktMatch[2]));
    }

    return this.pointFromWkbHex(trimmed);
  }

  private pointFromCoordinates(coordinates: unknown[]): CampaignAddressWithPoint['geom'] | null {
    if (coordinates.length < 2) return null;
    return this.pointFromLonLat(Number(coordinates[0]), Number(coordinates[1]));
  }

  private pointFromLonLat(lon: number, lat: number): CampaignAddressWithPoint['geom'] | null {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    return { type: 'Point', coordinates: [lon, lat] };
  }

  private pointFromWkbHex(value: string): CampaignAddressWithPoint['geom'] | null {
    const hex = value.replace(/^\\x/i, '');
    if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 42) return null;

    try {
      const buffer = Buffer.from(hex, 'hex');
      const littleEndian = buffer.readUInt8(0) === 1;
      const readUInt32 = (offset: number) =>
        littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
      const readDouble = (offset: number) =>
        littleEndian ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset);

      const rawType = readUInt32(1);
      const hasSrid = (rawType & 0x20000000) !== 0;
      const geometryType = rawType & 0xff;
      if (geometryType !== 1) return null;

      const coordinateOffset = 5 + (hasSrid ? 4 : 0);
      if (buffer.length < coordinateOffset + 16) return null;
      return this.pointFromLonLat(readDouble(coordinateOffset), readDouble(coordinateOffset + 8));
    } catch {
      return null;
    }
  }

  /**
   * Main entry point: Run complete spatial join
   */
  async runSpatialJoin(
    campaignId: string,
    buildingsGeoJSON: { features: BuildingFeature[] },
    overtureRelease: string = '2026-01-21.0',
    options: SpatialJoinOptions = {}
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

      // 1. Fetch addresses for this campaign (PostgREST caps unbounded selects at 1000 rows)
      const rawAddresses = await fetchAllInPages<CampaignAddress>(async (from, to) =>
        await this.supabase
          .from('campaign_addresses')
          .select('id, gers_id, formatted, house_number, street_name, geom')
          .eq('campaign_id', campaignId)
          .order('id', { ascending: true })
          .range(from, to)
      );
      
      // Parse geom field which may be string or object from Supabase
      const addresses: CampaignAddressWithPoint[] = (rawAddresses || []).flatMap((addr) => {
        const geom = this.parsePointGeometry(addr.geom);
        if (!geom) {
          console.warn(`[StableLinker] Skipping address ${addr.id}; unsupported point geometry`);
          return [];
        }
        return [{ ...addr, geom }];
      });

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
            parcelVerified: 0,
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

      // 2. Use the same renderable footprint set the canonical map bundle serves.
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
            parcelVerified: 0,
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

      if (options.resetExisting) {
        await this.resetCampaignArtifacts(campaignId, options.persistenceMode === 'gold');
      }

      // 3. Run the canonical iOS-equivalent matcher: containment, parcel bridge,
      // then semantic proximity. This is the only automatic production linker.
      const matches: MatchResult[] = [];
      const orphans: OrphanRecord[] = [];
      const conflictCount = 0;
      const densityWarningCount = 0;
      const preparedParcels = this.prepareParcels(options.parcelsGeoJSON?.features ?? []);
      const inferredMultiAddressBuildingIds = this.inferMultiAddressBuildingIds(
        addresses,
        validBuildings,
        preparedParcels
      );
      if (inferredMultiAddressBuildingIds.size > 0) {
        console.log(`[StableLinker] Inferred ${inferredMultiAddressBuildingIds.size} multi-address building(s) from footprint/parcel evidence`);
      }
      const claimedSingleUnitBuildingIds = new Set<string>();
      console.log(`[StableLinker] Starting matching for ${addresses.length} addresses...`);

      for (const address of addresses) {
        const result = this.matchAddressToBuilding(
          address,
          validBuildings,
          preparedParcels,
          claimedSingleUnitBuildingIds,
          inferredMultiAddressBuildingIds
        );

        if (result.matchType === 'orphan') {
          orphans.push(this.createOrphanRecord(address, validBuildings));
        } else {
          matches.push(result);
          const building = validBuildings.find(
            (candidate) => this.buildingPublicId(candidate) === result.buildingId
          );
          if (building && !this.canAcceptMultipleAddresses(building, inferredMultiAddressBuildingIds)) {
            claimedSingleUnitBuildingIds.add(result.buildingId.toLowerCase());
          }
        }
      }

      console.log(`[StableLinker] Matching complete: ${matches.length} matches, ${orphans.length} orphans, ${conflictCount} conflicts`);

      // 4. Detect multi-unit buildings
      this.detectMultiUnitBuildings(matches);

      // 5. Save results to database
      await this.saveMatches(
        campaignId,
        matches,
        overtureRelease,
        options.persistenceMode ?? 'silver'
      );
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

  private filterValidBuildings(buildings: BuildingFeature[]): BuildingFeature[] {
    const filtered = buildings.filter((building) => {
      if (building.geometry?.type !== 'Polygon' && building.geometry?.type !== 'MultiPolygon') {
        return false;
      }
      if (this.isAddressProxyBuildingFeature(building)) {
        return false;
      }

      const source = this.normalizedText(building.properties?.source);
      if (source === 'manual' || source === 'manual_fallback') {
        return true;
      }

      const area = this.calculateBuildingArea(building);
      return area >= MIN_LINKABLE_BUILDING_AREA_SQM;
    });
    console.log(
      `[StableLinker] Filtered: ${filtered.length}/${buildings.length} renderable buildings (polygon, non-proxy, >= ${MIN_LINKABLE_BUILDING_AREA_SQM} m²)`
    );
    return filtered;
  }

  private matchAddressToBuilding(
    address: CampaignAddressWithPoint,
    buildings: BuildingFeature[],
    parcels: PreparedParcel[] = [],
    claimedSingleUnitBuildingIds: Set<string> = new Set(),
    inferredMultiAddressBuildingIds: Set<string> = new Set()
  ): MatchResult {
    const addressCoords = address.geom.coordinates;
    const nearby = this.findNearestBuildings(addressCoords, buildings, NEAREST_BUILDING_CANDIDATE_LIMIT)
      .filter((candidate) => (
        this.canAcceptMultipleAddresses(candidate.building, inferredMultiAddressBuildingIds) ||
        !claimedSingleUnitBuildingIds.has(this.buildingPublicId(candidate.building).toLowerCase())
      ))
      .map((candidate): MatchCandidate => ({
        building: candidate.building,
        matchType: 'proximity_fallback',
        confidence: 0.5,
        distance: candidate.distance,
        streetScore: this.streetScore(address, candidate.building),
      }))
      .filter((candidate) => candidate.distance <= FALLBACK_RADIUS_METERS);

    if (nearby.length === 0) {
      return this.createMatchResult(address, null, 'orphan', 0, 0, 0);
    }

    const contained = nearby
      .filter((candidate) => this.isPointInBuilding(addressCoords, candidate.building))
      .map((candidate) => ({
        ...candidate,
        matchType: candidate.streetScore >= 0.40 ? 'containment_verified' : 'containment_suspect',
        confidence: candidate.streetScore >= 0.40 ? 1.0 : 0.70,
      } satisfies MatchCandidate))
      .sort((a, b) => this.rankMatches(a, b))[0];
    if (contained) return this.matchFromCandidate(address, contained);

    const parcelMatch = this.parcelBridgeMatch(addressCoords, nearby, parcels);
    if (parcelMatch) return this.matchFromCandidate(address, parcelMatch);

    const semantic = nearby
      .filter((candidate) => (
        candidate.distance <= PROXIMITY_RADIUS_METERS &&
        candidate.streetScore >= MINIMUM_SEMANTIC_PROXIMITY_SCORE
      ))
      .map((candidate) => ({
        ...candidate,
        matchType: 'proximity_verified',
        confidence: PROXIMITY_CONFIDENCE,
      } satisfies MatchCandidate))
      .sort((a, b) => this.rankMatches(a, b))[0];
    if (semantic) return this.matchFromCandidate(address, semantic);

    const footprintEdgeMatch = nearby
      .filter((candidate) => (
        candidate.distance <= FOOTPRINT_EDGE_GRACE_METERS &&
        this.hasFootprintEdgeGrace(address, candidate)
      ))
      .map((candidate) => ({
        ...candidate,
        matchType: 'point_on_surface',
        confidence: FOOTPRINT_EDGE_GRACE_CONFIDENCE,
      } satisfies MatchCandidate))
      .sort((a, b) => this.rankMatches(a, b))[0];
    if (footprintEdgeMatch) return this.matchFromCandidate(address, footprintEdgeMatch);

    const inferredMultiNearby = nearby
      .filter((candidate) => (
        candidate.distance <= MULTI_ADDRESS_NEARBY_RADIUS_METERS &&
        inferredMultiAddressBuildingIds.has(this.buildingPublicId(candidate.building).toLowerCase())
      ))
      .sort((a, b) => this.rankMatches(a, b))[0];
    if (inferredMultiNearby) return this.matchFromCandidate(address, inferredMultiNearby);

    return this.createMatchResult(address, null, 'orphan', 0, 0, 0);
  }

  private hasFootprintEdgeGrace(address: CampaignAddressWithPoint, candidate: MatchCandidate): boolean {
    if (candidate.streetScore >= 0.40) return true;

    const addressStreet = this.normalizeStreet(address.street_name ?? address.formatted);
    const buildingStreet = this.normalizeStreet(
      candidate.building.properties.street_name ??
      candidate.building.properties.primary_street ??
      candidate.building.properties.name ??
      candidate.building.properties.address_text
    );
    const buildingHouse = this.normalizeHouseNumber(
      candidate.building.properties.house_number ??
      candidate.building.properties.address_text ??
      candidate.building.properties.name
    );

    return Boolean(addressStreet) && !buildingStreet && !buildingHouse;
  }

  private matchFromCandidate(address: CampaignAddressWithPoint, candidate: MatchCandidate): MatchResult {
    return this.createMatchResult(
      address,
      candidate.building,
      candidate.matchType,
      candidate.confidence,
      candidate.distance,
      candidate.streetScore
    );
  }

  private parcelBridgeMatch(
    addressCoords: [number, number],
    nearby: MatchCandidate[],
    parcels: PreparedParcel[]
  ): MatchCandidate | null {
    const parcel = parcels.find((candidate) => this.pointInPreparedParcel(addressCoords, candidate));
    if (!parcel) return null;

    return nearby
      .filter((candidate) => {
        const centroid = this.buildingCentroid(candidate.building);
        return this.pointInPreparedParcel(centroid, parcel) ||
          this.bboxesIntersect(this.buildingBbox(candidate.building), parcel.bbox);
      })
      .map((candidate) => ({
        ...candidate,
        matchType: 'parcel_verified',
        confidence: PARCEL_BRIDGE_CONFIDENCE,
      } satisfies MatchCandidate))
      .sort((a, b) => this.rankMatches(a, b))[0] ?? null;
  }

  private rankMatches(lhs: MatchCandidate, rhs: MatchCandidate): number {
    if (lhs.confidence !== rhs.confidence) return rhs.confidence - lhs.confidence;
    if (lhs.streetScore !== rhs.streetScore) return rhs.streetScore - lhs.streetScore;
    if (Math.abs(lhs.distance - rhs.distance) >= 0.5) return lhs.distance - rhs.distance;
    return this.buildingPublicId(lhs.building).localeCompare(this.buildingPublicId(rhs.building));
  }

  private streetScore(address: CampaignAddressWithPoint, building: BuildingFeature): number {
    const addressStreet = this.normalizeStreet(address.street_name ?? address.formatted);
    const buildingStreet = this.normalizeStreet(
      building.properties.street_name ??
      building.properties.primary_street ??
      building.properties.name ??
      building.properties.address_text
    );
    let score = 0;

    if (addressStreet && buildingStreet) {
      if (addressStreet === buildingStreet) {
        score += 0.65;
      } else if (addressStreet.includes(buildingStreet) || buildingStreet.includes(addressStreet)) {
        score += 0.45;
      }
    }

    const addressHouse = this.normalizeHouseNumber(address.house_number);
    const buildingHouse = this.normalizeHouseNumber(
      building.properties.house_number ?? building.properties.address_text ?? building.properties.name
    );
    if (addressHouse && buildingHouse && addressHouse === buildingHouse) {
      score += 0.35;
    }

    return Math.min(score, 1);
  }

  private normalizeStreet(value: string | null | undefined): string {
    const replacements: Array<[RegExp, string]> = [
      [/\bstreet\b/g, 'st'],
      [/\bavenue\b/g, 'ave'],
      [/\broad\b/g, 'rd'],
      [/\bdrive\b/g, 'dr'],
      [/\bcrescent\b/g, 'cres'],
      [/\bboulevard\b/g, 'blvd'],
    ];
    let normalized = this.normalizedText(value);
    for (const [pattern, replacement] of replacements) {
      normalized = normalized.replace(pattern, replacement);
    }
    return normalized
      .split(/[^a-z0-9]+/i)
      .filter((part) => part && !/^\d+$/.test(part))
      .join(' ')
      .trim();
  }

  private normalizeHouseNumber(value: string | null | undefined): string {
    return this.normalizedText(value)
      .split(/[^a-z0-9]+/i)
      .find(Boolean) ?? '';
  }

  private normalizedText(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  private buildingPublicId(building: BuildingFeature): string {
    return String(
      building.properties.gers_id ??
      (building as unknown as { id?: unknown }).id ??
      ''
    );
  }

  private isAddressProxyBuildingFeature(building: BuildingFeature): boolean {
    const properties = building.properties ?? {};
    const identifiers = [
      this.buildingPublicId(building),
      (building as unknown as { id?: unknown }).id,
      properties.gers_id,
    ].map((value) => this.normalizedText(value));

    return this.normalizedText(properties.source) === 'address_proxy' ||
      this.normalizedText(properties.feature_type) === 'address_proxy' ||
      this.normalizedText(properties.feature_status) === 'missing_footprint_proxy' ||
      this.normalizedText(properties.building_identifier_source) === 'address_proxy' ||
      identifiers.some((id) => id.startsWith('address-proxy-'));
  }

  private inferMultiAddressBuildingIds(
    addresses: CampaignAddressWithPoint[],
    buildings: BuildingFeature[],
    parcels: PreparedParcel[]
  ): Set<string> {
    const addressIdsByBuilding = new Map<string, Set<string>>();
    const nearbyAddressIdsByBuildingStreet = new Map<string, Map<string, Set<string>>>();

    const addAddressEvidence = (building: BuildingFeature | null, address: CampaignAddressWithPoint) => {
      if (!building) return;
      const buildingId = this.buildingPublicId(building).toLowerCase();
      if (!buildingId) return;
      const group = addressIdsByBuilding.get(buildingId) ?? new Set<string>();
      group.add(address.id.toLowerCase());
      addressIdsByBuilding.set(buildingId, group);
    };

    const addNearbyEvidence = (building: BuildingFeature | null, address: CampaignAddressWithPoint) => {
      if (!building) return;
      const buildingId = this.buildingPublicId(building).toLowerCase();
      const street = this.normalizeStreet(address.street_name ?? address.formatted);
      if (!buildingId || !street) return;
      const streetGroups = nearbyAddressIdsByBuildingStreet.get(buildingId) ?? new Map<string, Set<string>>();
      const group = streetGroups.get(street) ?? new Set<string>();
      group.add(address.id.toLowerCase());
      streetGroups.set(street, group);
      nearbyAddressIdsByBuildingStreet.set(buildingId, streetGroups);
    };

    for (const address of addresses) {
      const addressCoords = address.geom.coordinates;
      const nearby = this.findNearestBuildings(addressCoords, buildings, NEAREST_BUILDING_CANDIDATE_LIMIT)
        .map((candidate): MatchCandidate => ({
          building: candidate.building,
          matchType: 'proximity_fallback',
          confidence: 0.5,
          distance: candidate.distance,
          streetScore: this.streetScore(address, candidate.building),
        }))
        .filter((candidate) => candidate.distance <= FALLBACK_RADIUS_METERS);

      const contained = nearby
        .filter((candidate) => this.isPointInBuilding(addressCoords, candidate.building))
        .map((candidate) => ({
          ...candidate,
          matchType: candidate.streetScore >= 0.40 ? 'containment_verified' : 'containment_suspect',
          confidence: candidate.streetScore >= 0.40 ? 1.0 : 0.70,
        } satisfies MatchCandidate))
        .sort((a, b) => this.rankMatches(a, b))[0];
      if (contained) {
        addAddressEvidence(contained.building, address);
        continue;
      }

      const parcelMatch = this.parcelBridgeMatch(addressCoords, nearby, parcels);
      if (parcelMatch) {
        addAddressEvidence(parcelMatch.building, address);
        continue;
      }

      const nearbyMatch = nearby
        .filter((candidate) => candidate.distance <= MULTI_ADDRESS_NEARBY_RADIUS_METERS)
        .sort((a, b) => this.rankMatches(a, b))[0];
      if (nearbyMatch) {
        addNearbyEvidence(nearbyMatch.building, address);
      }
    }

    const inferred = new Set(
      Array.from(addressIdsByBuilding.entries())
        .filter(([, addressIds]) => addressIds.size > 1)
        .map(([buildingId]) => buildingId)
    );
    for (const [buildingId, streetGroups] of nearbyAddressIdsByBuildingStreet) {
      if (Array.from(streetGroups.values()).some((addressIds) => addressIds.size > 1)) {
        inferred.add(buildingId);
      }
    }
    return inferred;
  }

  private canAcceptMultipleAddresses(
    building: BuildingFeature,
    inferredMultiAddressBuildingIds: Set<string> = new Set()
  ): boolean {
    const props = building.properties as BuildingFeature['properties'];
    const publicId = this.buildingPublicId(building).toLowerCase();
    return props.is_townhome === true ||
      inferredMultiAddressBuildingIds.has(publicId) ||
      Number(props.units_count ?? 0) > 1 ||
      Number(props.address_count ?? 0) > 1;
  }

  private async resetCampaignArtifacts(campaignId: string, clearCampaignAddressLinks: boolean): Promise<void> {
    const operations: Array<PromiseLike<{ error: { message: string } | null }>> = [
      this.supabase
        .from('building_address_links')
        .delete()
        .eq('campaign_id', campaignId),
      this.supabase
        .from('building_slices')
        .delete()
        .eq('campaign_id', campaignId),
      this.supabase
        .from('address_orphans')
        .delete()
        .eq('campaign_id', campaignId),
    ];

    if (clearCampaignAddressLinks) {
      operations.push(
        this.supabase
          .from('campaign_addresses')
          .update({
            building_id: null,
            building_gers_id: null,
            match_source: null,
            confidence: null,
          })
          .eq('campaign_id', campaignId)
      );
    }

    const results = await Promise.all(operations);
    const deleteLinksError = results[0].error;
    const deleteSlicesError = results[1].error;
    const deleteOrphansError = results[2].error;
    const resetAddressesError = clearCampaignAddressLinks ? results[3]?.error ?? null : null;

    if (deleteLinksError) {
      throw new Error(`Failed to clear building links: ${deleteLinksError.message}`);
    }
    if (deleteSlicesError) {
      throw new Error(`Failed to clear building slices: ${deleteSlicesError.message}`);
    }
    if (deleteOrphansError) {
      throw new Error(`Failed to clear address orphans: ${deleteOrphansError.message}`);
    }
    if (resetAddressesError) {
      throw new Error(`Failed to clear campaign address links: ${resetAddressesError.message}`);
    }
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
   * Find K nearest buildings by footprint distance, so address points just
   * outside a building boundary still auto-link.
   */
  private findNearestBuildings(
    point: [number, number],
    buildings: BuildingFeature[],
    k: number
  ): Array<{ building: BuildingFeature; distance: number }> {
    const distances = buildings.map(building => {
      const distance = this.calculatePointToBuildingDistance(point, building);
      return { building, distance };
    });

    return distances
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  }

  private calculatePointToBuildingDistance(point: [number, number], building: BuildingFeature): number {
    if (this.isPointInBuilding(point, building) || this.isPointOnBuildingBoundary(point, building)) {
      return 0;
    }

    const polygons = building.geometry.type === 'Polygon'
      ? [building.geometry.coordinates as number[][][]]
      : building.geometry.coordinates as number[][][][];

    let minDistance = Infinity;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i += 1) {
          const lineStart = ring[i] as [number, number];
          const lineEnd = ring[i + 1] as [number, number];
          const distance = this.pointToLineSegmentDistanceMeters(point, lineStart, lineEnd);
          if (distance < minDistance) {
            minDistance = distance;
          }
        }
      }
    }

    return Number.isFinite(minDistance) ? minDistance : Infinity;
  }

  private pointToLineSegmentDistanceMeters(
    point: [number, number],
    lineStart: [number, number],
    lineEnd: [number, number]
  ): number {
    const [px, py] = this.projectToLocalMeters(point, point);
    const [x1, y1] = this.projectToLocalMeters(lineStart, point);
    const [x2, y2] = this.projectToLocalMeters(lineEnd, point);

    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) {
      return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    }

    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
  }

  private projectToLocalMeters(
    coordinate: [number, number],
    origin: [number, number]
  ): [number, number] {
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLon = metersPerDegreeLat * Math.cos(origin[1] * Math.PI / 180);
    return [
      (coordinate[0] - origin[0]) * metersPerDegreeLon,
      (coordinate[1] - origin[1]) * metersPerDegreeLat,
    ];
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

  private isPointInMultiPolygon(
    point: [number, number],
    coordinates: number[][][][]
  ): boolean {
    return coordinates.some((polygon) => this.isPointInPolygonRings(point, polygon));
  }

  private isPointInPolygonRings(
    point: [number, number],
    rings: number[][][]
  ): boolean {
    if (rings.length === 0) return false;
    if (!this.isPointInPolygon(point, rings[0])) return false;

    for (let i = 1; i < rings.length; i += 1) {
      if (this.isPointInPolygon(point, rings[i])) {
        return false;
      }
    }

    return true;
  }

  private getPolygonRings(building: BuildingFeature): number[][][] {
    if (building.geometry.type === 'Polygon') {
      return building.geometry.coordinates as number[][][];
    }

    const polygons = building.geometry.coordinates as number[][][][];
    if (polygons.length === 0) {
      return [];
    }

    return polygons.reduce((largest, polygon) => {
      const largestArea = largest.length > 0 ? this.calculatePolygonArea(largest[0] ?? []) : 0;
      const polygonArea = polygon.length > 0 ? this.calculatePolygonArea(polygon[0] ?? []) : 0;
      return polygonArea > largestArea ? polygon : largest;
    }, polygons[0] ?? []);
  }

  private calculateBuildingArea(building: BuildingFeature): number {
    if (building.geometry.type === 'Polygon') {
      const rings = building.geometry.coordinates as number[][][];
      return this.calculatePolygonArea(rings[0] ?? []);
    }

    const polygons = building.geometry.coordinates as number[][][][];
    return polygons.reduce((sum, polygon) => sum + this.calculatePolygonArea(polygon[0] ?? []), 0);
  }

  private isPointInBuilding(point: [number, number], building: BuildingFeature): boolean {
    if (building.geometry.type === 'Polygon') {
      return this.isPointInPolygonRings(point, building.geometry.coordinates as number[][][]);
    }

    return this.isPointInMultiPolygon(point, building.geometry.coordinates as number[][][][]);
  }

  private isPointOnBuildingBoundary(point: [number, number], building: BuildingFeature): boolean {
    if (building.geometry.type === 'Polygon') {
      const rings = building.geometry.coordinates as number[][][];
      return rings.some((ring) => this.isPointOnPolygonBoundary(point, ring));
    }

    const polygons = building.geometry.coordinates as number[][][][];
    return polygons.some((polygon) => polygon.some((ring) => this.isPointOnPolygonBoundary(point, ring)));
  }

  private prepareParcels(parcels: ParcelFeature[]): PreparedParcel[] {
    return parcels.flatMap((parcel) => {
      if (parcel.geometry?.type !== 'Polygon' && parcel.geometry?.type !== 'MultiPolygon') {
        return [];
      }
      const polygons = parcel.geometry.type === 'Polygon'
        ? [parcel.geometry.coordinates as number[][][]]
        : parcel.geometry.coordinates as number[][][][];
      const rings = polygons.flatMap((polygon) => polygon);
      if (rings.length === 0) return [];
      return [{
        rings,
        bbox: this.bboxForPositions(rings.flat()),
      }];
    });
  }

  private pointInPreparedParcel(point: [number, number], parcel: PreparedParcel): boolean {
    if (!this.pointInBbox(point, parcel.bbox)) return false;
    return parcel.rings.some((ring) => this.isPointInPolygon(point, ring));
  }

  private buildingBbox(building: BuildingFeature): [number, number, number, number] {
    const polygons = building.geometry.type === 'Polygon'
      ? [building.geometry.coordinates as number[][][]]
      : building.geometry.coordinates as number[][][][];
    return this.bboxForPositions(polygons.flat(2));
  }

  private buildingCentroid(building: BuildingFeature): [number, number] {
    const [minLon, minLat, maxLon, maxLat] = this.buildingBbox(building);
    return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
  }

  private bboxForPositions(positions: number[][]): [number, number, number, number] {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    for (const position of positions) {
      const lon = Number(position[0]);
      const lat = Number(position[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }

    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
      return [0, 0, 0, 0];
    }
    return [minLon, minLat, maxLon, maxLat];
  }

  private pointInBbox(point: [number, number], bbox: [number, number, number, number]): boolean {
    return point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3];
  }

  private bboxesIntersect(
    lhs: [number, number, number, number],
    rhs: [number, number, number, number]
  ): boolean {
    return !(rhs[0] > lhs[2] || rhs[2] < lhs[0] || rhs[1] > lhs[3] || rhs[3] < lhs[1]);
  }

  /**
   * Create match result object
   */
  private createMatchResult(
    address: CampaignAddressWithPoint,
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

    const area = this.calculateBuildingArea(building);
    
    return {
      addressId: address.id,
      addressGersId: address.gers_id,
      buildingId: this.buildingPublicId(building),
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
    for (const [, buildingMatches] of buildingGroups) {
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
    address: CampaignAddressWithPoint,
    buildings: BuildingFeature[]
  ): OrphanRecord {
    const addressCoords = address.geom.coordinates;
    
    // Find top 3 suggestions
    const nearest = this.findNearestBuildings(addressCoords, buildings, 3);
    const suggestions: SuggestedBuilding[] = nearest.map(n => {
      const area = this.calculateBuildingArea(n.building);
      
      // Confidence based purely on distance
      let confidence = 0.3;
      if (n.distance < 10) confidence += 0.3;
      else if (n.distance < 25) confidence += 0.2;
      else if (n.distance < 50) confidence += 0.1;
      
      return {
        buildingId: n.building.properties.gers_id,
        distance: n.distance,
        streetScore: 0,
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
      streetMatchScore: 0,
      suggestedBuildings: suggestions,
      status: 'pending_review',
      suggestedStreet: address.street_name ?? null,
    };
  }

  /**
   * Save matches to database
   */
  private async saveMatches(
    campaignId: string,
    matches: MatchResult[],
    overtureRelease: string,
    persistenceMode: 'silver' | 'gold'
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
      linker_version: 2,
    }));

    // Batch insert
    const batchSize = 500;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await this.supabase
        .from('building_address_links')
        .upsert(batch, { onConflict: 'campaign_id,address_id' });
      
      if (error) {
        console.error(`[StableLinker] Error saving batch ${i / batchSize + 1}:`, error.message);
        throw new Error(`Failed to save building address links: ${error.message}`);
      }
    }

    if (persistenceMode === 'gold') {
      for (let i = 0; i < validMatches.length; i += GOLD_ADDRESS_UPDATE_BATCH_SIZE) {
        const batch = validMatches.slice(i, i + GOLD_ADDRESS_UPDATE_BATCH_SIZE);
        try {
          await Promise.all(
            batch.map((match) =>
              retryWithBackoff(
                async () => {
                  const { error } = await this.supabase
                    .from('campaign_addresses')
                    .update({
                      building_id: UUID_PATTERN.test(match.buildingId) ? match.buildingId : null,
                      building_gers_id: match.buildingId,
                      match_source: this.toGoldMatchSource(match.matchType),
                      confidence: match.confidence,
                    })
                    .eq('id', match.addressId)
                    .eq('campaign_id', campaignId);

                  if (error) {
                    throw new Error(error.message || 'Unknown Supabase update error');
                  }
                },
                { maxAttempts: 4, baseDelayMs: 500 }
              )
            )
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            `[StableLinker] Error saving Gold address assignments batch ${i / GOLD_ADDRESS_UPDATE_BATCH_SIZE + 1}:`,
            message
          );
          throw new Error(`Failed to save Gold address assignments: ${message}`);
        }
      }
    }

    console.log(`[StableLinker] Saved ${validMatches.length} matches`);
  }

  /**
   * Persist one user-confirmed address/building assignment through the stable linker path.
   * This is intentionally scoped to one address so edit-mode fixes do not rerun the full
   * campaign join or overwrite other manual corrections.
   */
  async assignAddressToBuilding(input: {
    campaignId: string;
    addressId: string;
    buildingRowId: string;
    buildingPublicId: string;
    coordinate?: [number, number];
    assignedBy?: string;
  }): Promise<StableManualLinkResult> {
    const { campaignId, addressId, buildingRowId, buildingPublicId, coordinate, assignedBy } = input;

    const rpc = manualLinkRpc(this.supabase);
    if (rpc) {
      const { data, error } = await rpc('assign_address_to_building_manual', {
        p_campaign_id: campaignId,
        p_address_id: addressId,
        p_building_row_id: buildingRowId,
        p_building_public_id: buildingPublicId,
        p_lon: coordinate?.[0] ?? null,
        p_lat: coordinate?.[1] ?? null,
        p_assigned_by: assignedBy ?? null,
      });
      if (!error && data) {
        const rpcLinkedAddressIds = Array.isArray(data.linked_address_ids) ? data.linked_address_ids.map(String) : [];
        const linkedAddressIds = await this.loadRemainingBuildingAddressIds(
          campaignId,
          buildingPublicId,
          buildingRowId,
          rpcLinkedAddressIds
        );
        return {
          linkedAddressIds,
          unitCount: Math.max(Number(data.unit_count ?? 0), linkedAddressIds.length, 1),
        };
      }
      if (error) {
        console.warn('[StableLinker] assign_address_to_building_manual RPC unavailable or failed, falling back:', error.message);
      }
    }

    const { data: previousLinks } = await this.supabase
      .from('building_address_links')
      .select('building_id')
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId);

    const previousBuildingIds = Array.from(
      new Set(
        ((previousLinks ?? []) as Array<{ building_id: string }>)
          .map((row) => row.building_id)
          .filter(Boolean)
      )
    );

    const { error: linkError } = await this.supabase
      .from('building_address_links')
      .upsert({
        campaign_id: campaignId,
        building_id: buildingRowId,
        address_id: addressId,
        match_type: 'manual',
        confidence: 1,
        distance_meters: 0,
        street_match_score: 1,
        is_multi_unit: false,
        unit_count: 1,
        unit_arrangement: 'single',
      }, { onConflict: 'campaign_id,address_id' });

    if (linkError) {
      throw new Error(`Failed to create stable manual link: ${linkError.message}`);
    }

    await this.supabase
      .from('address_orphans')
      .update({
        status: 'assigned',
        assigned_building_id: buildingRowId,
        assigned_by: assignedBy ?? null,
        assigned_at: new Date().toISOString(),
      })
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId);

    const linkTableAddressIds = await this.syncBuildingUnitCounts(campaignId, buildingRowId);
    const linkedAddressIds = await this.loadRemainingBuildingAddressIds(
      campaignId,
      buildingPublicId,
      buildingRowId,
      linkTableAddressIds
    );
    for (const previousBuildingId of previousBuildingIds) {
      if (previousBuildingId === buildingRowId) continue;
      await this.syncBuildingUnitCounts(campaignId, previousBuildingId);
    }

    const addressUpdate: Record<string, unknown> = {
      building_id: buildingRowId,
      building_gers_id: buildingPublicId,
      match_source: 'manual',
      confidence: 1,
    };
    if (coordinate) {
      addressUpdate.geom = JSON.stringify({ type: 'Point', coordinates: coordinate });
    }

    const { error: addressError } = await this.supabase
      .from('campaign_addresses')
      .update(addressUpdate)
      .eq('campaign_id', campaignId)
      .eq('id', addressId);

    if (addressError) {
      throw new Error(`Failed to sync linked address: ${addressError.message}`);
    }

    return {
      linkedAddressIds,
      unitCount: Math.max(linkedAddressIds.length, 1),
    };
  }

  async assignAddressToGoldBuilding(input: {
    campaignId: string;
    addressId: string;
    buildingPublicId: string;
    coordinate?: [number, number];
    assignedBy?: string;
  }): Promise<StableManualLinkResult> {
    const { campaignId, addressId, buildingPublicId, coordinate, assignedBy } = input;

    const addressUpdate: Record<string, unknown> = {
      building_id: buildingPublicId,
      building_gers_id: buildingPublicId,
      match_source: 'manual',
      confidence: 1,
    };
    if (coordinate) {
      addressUpdate.geom = JSON.stringify({ type: 'Point', coordinates: coordinate });
    }

    const { error: addressError } = await this.supabase
      .from('campaign_addresses')
      .update(addressUpdate)
      .eq('campaign_id', campaignId)
      .eq('id', addressId);

    if (addressError) {
      throw new Error(`Failed to sync Gold linked address: ${addressError.message}`);
    }

    await this.supabase
      .from('address_orphans')
      .update({
        status: 'assigned',
        assigned_building_id: buildingPublicId,
        assigned_by: assignedBy ?? null,
        assigned_at: new Date().toISOString(),
      })
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId);

    const linkedAddressIds = await this.loadRemainingBuildingAddressIds(
      campaignId,
      buildingPublicId,
      null,
      [addressId]
    );

    return {
      linkedAddressIds,
      unitCount: Math.max(linkedAddressIds.length, 1),
    };
  }

  async unassignAddressFromBuilding(input: {
    campaignId: string;
    addressId: string;
    buildingRowId: string | null;
    buildingPublicId: string;
    deleteManualAddress?: boolean;
  }): Promise<StableManualUnlinkResult> {
    const { campaignId, addressId, buildingRowId, buildingPublicId, deleteManualAddress } = input;

    const rpc = manualLinkRpc(this.supabase);
    if (rpc && buildingRowId) {
      const { data, error } = await rpc('unassign_address_from_building_manual', {
        p_campaign_id: campaignId,
        p_address_id: addressId,
        p_building_row_id: buildingRowId,
        p_building_public_id: buildingPublicId,
        p_delete_manual_address: deleteManualAddress === true,
      });
      if (!error && data) {
        const rpcLinkedAddressIds = Array.isArray(data.linked_address_ids) ? data.linked_address_ids.map(String) : [];
        const linkedAddressIds = await this.loadRemainingBuildingAddressIds(
          campaignId,
          buildingPublicId,
          buildingRowId,
          rpcLinkedAddressIds
        );
        return {
          linkedAddressIds,
          unitCount: Math.max(Number(data.unit_count ?? 0), linkedAddressIds.length, 1),
          deletedAddressId: data.deleted_address_id ? String(data.deleted_address_id) : undefined,
        };
      }
      if (error) {
        console.warn('[StableLinker] unassign_address_from_building_manual RPC unavailable or failed, falling back:', error.message);
      }
    }

    if (buildingRowId) {
      const { error: deleteError } = await this.supabase
        .from('building_address_links')
        .delete()
        .eq('building_id', buildingRowId)
        .eq('address_id', addressId)
        .eq('campaign_id', campaignId);

      if (deleteError) {
        throw new Error(`Failed to unlink address: ${deleteError.message}`);
      }
    }

    if (deleteManualAddress) {
      await this.deleteCampaignAddressDependents(campaignId, addressId);
      await this.expectMutation(
        'Failed to delete manual address',
        this.supabase
          .from('campaign_addresses')
          .delete()
          .eq('campaign_id', campaignId)
          .eq('id', addressId)
          .eq('source', 'manual')
      );
    } else {
      const { error: addressError } = await this.supabase
        .from('campaign_addresses')
        .update({
          building_id: null,
          building_gers_id: null,
          match_source: null,
          confidence: null,
        })
        .eq('campaign_id', campaignId)
        .eq('id', addressId);

      if (addressError) {
        throw new Error(`Failed to clear linked address: ${addressError.message}`);
      }

      await this.supabase
        .from('address_orphans')
        .update({
          status: 'pending_review',
          assigned_building_id: null,
          assigned_by: null,
          assigned_at: null,
        })
        .eq('campaign_id', campaignId)
        .eq('address_id', addressId);
    }

    const linkTableAddressIds = buildingRowId
      ? await this.syncBuildingUnitCounts(campaignId, buildingRowId)
      : [];
    const linkedAddressIds = await this.loadRemainingBuildingAddressIds(
      campaignId,
      buildingPublicId,
      buildingRowId,
      linkTableAddressIds
    );

    return {
      linkedAddressIds,
      unitCount: Math.max(linkedAddressIds.length, 1),
      deletedAddressId: deleteManualAddress ? addressId : undefined,
    };
  }

  private async expectMutation(
    label: string,
    mutation: PromiseLike<{ error: { message: string } | null }>
  ): Promise<void> {
    const { error } = await mutation;
    if (error) {
      throw new Error(`${label}: ${error.message}`);
    }
  }

  private async deleteCampaignAddressDependents(
    campaignId: string,
    addressId: string
  ): Promise<void> {
    await this.expectMutation(
      'Failed to delete address statuses',
      this.supabase
        .from('address_statuses')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('campaign_address_id', addressId)
    );
    await this.expectMutation(
      'Failed to delete campaign home events',
      this.supabase
        .from('campaign_home_events')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('campaign_address_id', addressId)
    );
    await this.expectMutation(
      'Failed to delete building address links',
      this.supabase
        .from('building_address_links')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to delete address content',
      this.supabase
        .from('address_content')
        .delete()
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to delete address orphan records',
      this.supabase
        .from('address_orphans')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to delete building slices',
      this.supabase
        .from('building_slices')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to delete building touches',
      this.supabase
        .from('building_touches')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to delete building units',
      this.supabase
        .from('building_units')
        .delete()
        .eq('campaign_id', campaignId)
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to delete campaign assignment homes',
      this.supabase
        .from('campaign_assignment_homes')
        .delete()
        .eq('campaign_address_id', addressId)
    );
    await this.expectMutation(
      'Failed to delete session events',
      this.supabase
        .from('session_events')
        .delete()
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to unlink contacts',
      this.supabase
        .from('contacts')
        .update({ address_id: null })
        .eq('campaign_id', campaignId)
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to unlink landing pages',
      this.supabase
        .from('landing_pages')
        .update({ address_id: null })
        .eq('campaign_id', campaignId)
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to unlink QR codes',
      this.supabase
        .from('qr_codes')
        .update({ address_id: null })
        .eq('campaign_id', campaignId)
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to unlink QR code scans',
      this.supabase
        .from('qr_code_scans')
        .update({ address_id: null })
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to unlink scan events',
      this.supabase
        .from('scan_events')
        .update({ address_id: null })
        .eq('campaign_id', campaignId)
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to unlink route stops',
      this.supabase
        .from('route_stops')
        .update({ address_id: null })
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to unlink buildings',
      this.supabase
        .from('buildings')
        .update({ address_id: null })
        .eq('campaign_id', campaignId)
        .eq('address_id', addressId)
    );
    await this.expectMutation(
      'Failed to unlink map buildings',
      this.supabase
        .from('map_buildings')
        .update({ address_id: null })
        .eq('campaign_id', campaignId)
        .eq('address_id', addressId)
    );
  }

  private async syncBuildingUnitCounts(
    campaignId: string,
    buildingId: string
  ): Promise<string[]> {
    const { data: rows, error: rowsError } = await this.supabase
      .from('building_address_links')
      .select('address_id')
      .eq('campaign_id', campaignId)
      .eq('building_id', buildingId);

    if (rowsError) {
      throw new Error(`Failed to load building links: ${rowsError.message}`);
    }

    const linkedAddressIds = Array.from(
      new Set(((rows ?? []) as Array<{ address_id: string }>).map((row) => row.address_id).filter(Boolean))
    );
    const unitCount = Math.max(linkedAddressIds.length, 1);

    if (linkedAddressIds.length > 0) {
      const { error: updateError } = await this.supabase
        .from('building_address_links')
        .update({
          is_multi_unit: unitCount > 1,
          unit_count: unitCount,
          unit_arrangement: unitCount > 1 ? 'horizontal' : 'single',
        })
        .eq('campaign_id', campaignId)
        .eq('building_id', buildingId);

      if (updateError) {
        throw new Error(`Failed to sync building unit count: ${updateError.message}`);
      }
    }

    return linkedAddressIds;
  }

  private async loadRemainingBuildingAddressIds(
    campaignId: string,
    buildingPublicId: string,
    buildingRowId: string | null,
    seedAddressIds: string[] = []
  ): Promise<string[]> {
    const identifiers = new Set(
      [buildingPublicId, buildingRowId]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase())
    );
    const seen = new Set<string>();
    const linkedAddressIds: string[] = [];

    for (const addressId of seedAddressIds) {
      const key = String(addressId).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      linkedAddressIds.push(String(addressId));
    }

    const { data, error } = await this.supabase
      .from('campaign_addresses')
      .select('id, building_id, building_gers_id')
      .eq('campaign_id', campaignId);

    if (error) {
      throw new Error(`Failed to load remaining linked addresses: ${error.message}`);
    }

    for (const row of (data ?? []) as Array<{ id: string; building_id: string | null; building_gers_id: string | null }>) {
      const rowIdentifiers = [row.building_id, row.building_gers_id]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase());
      if (!rowIdentifiers.some((identifier) => identifiers.has(identifier))) continue;

      const key = String(row.id).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      linkedAddressIds.push(String(row.id));
    }

    return linkedAddressIds;
  }

  private toGoldMatchSource(
    matchType: MatchResult['matchType']
  ): 'gold_exact' | 'gold_parcel' | 'gold_proximity' {
    switch (matchType) {
      case 'containment_verified':
      case 'containment_suspect':
      case 'point_on_surface':
        return 'gold_exact';
      case 'parcel_verified':
        return 'gold_parcel';
      default:
        return 'gold_proximity';
    }
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
    const parcelVerified = validMatches.filter(m => m.matchType === 'parcel_verified').length;
    const proximityVerified = validMatches.filter(m => m.matchType === 'proximity_verified').length;
    const proximityFallback = validMatches.filter(m => m.matchType === 'proximity_fallback').length;

    const suspect = containmentSuspect + proximityFallback;
    const orphans = matches.filter(m => m.matchType === 'orphan').length;

    const avgConfidence = validMatches.length > 0
      ? validMatches.reduce((sum, m) => sum + m.confidence, 0) / validMatches.length
      : 0;

    const proximityMatches = validMatches.filter(
      m =>
        m.matchType === 'parcel_verified' ||
        m.matchType === 'point_on_surface' ||
        m.matchType === 'proximity_verified' ||
        m.matchType === 'proximity_fallback'
    );
    const avgPrecisionMeters =
      proximityMatches.length > 0
        ? proximityMatches.reduce((sum, m) => sum + m.distanceMeters, 0) / proximityMatches.length
        : 0;
    const streetMismatchCount = 0;

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
        parcelVerified,
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
