import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as turf from '@turf/turf';
import {
  prebuildCampaignMapBundle,
  readCurrentCampaignMapBundle,
  responseFromCampaignMapBundleRow,
} from './CampaignMapBundlePrebuilder';
import { CampaignLinkQualityService } from './CampaignLinkQualityService';
import { CampaignMapModeService } from './CampaignMapModeService';
import { TownhouseSplitterService, type BuildingFeature as TownhouseBuildingFeature } from './TownhouseSplitterService';
import { uuidV5 } from './TownhouseUnitIdentity';

export const MAP_RECONCILIATION_ALGORITHM_VERSION = 'map-reconciliation-v13-parcel-orphan-reverse';
const AUTO_LINK_SCORE = 0.92;
const AUTO_LINK_MARGIN = 0.15;
const REVIEW_SCORE = 0.70;
const SYNTHETIC_SCORE = 0.96;
const SYNTHETIC_MARGIN = 0.20;
const REVERSE_PROVIDER_VERSION = 'mapbox-geocoding-v6';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MapReconciliationMode = 'off' | 'shadow' | 'apply_high_confidence';
export type ReverseGeocodingStorageMode = 'permanent' | 'temporary';
export type MapReconciliationStatus =
  | 'not_started'
  | 'queued'
  | 'matching'
  | 'geocoding'
  | 'applying'
  | 'review_needed'
  | 'completed'
  | 'failed';

type JsonRecord = Record<string, unknown>;
type Point = [number, number];
type BundleFeature = GeoJSON.Feature<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>;

type ReconciliationRunRow = {
  id: string;
  campaign_id: string;
  source_signature: string;
  algorithm_version: string;
  mode: MapReconciliationMode;
  status: Exclude<MapReconciliationStatus, 'not_started'> | 'superseded';
  attempt_count?: number;
  report?: JsonRecord | null;
};

type DecisionAction =
  | 'link_address'
  | 'reassign_address'
  | 'create_synthetic_address'
  | 'adjust_label'
  | 'hide_duplicate'
  | 'hide_auxiliary'
  | 'leave_unresolved';

type ReconciliationDecision = {
  id: string;
  run_id: string;
  campaign_id: string;
  action: DecisionAction;
  status: 'proposed' | 'requires_review' | 'applied' | 'rejected' | 'rolled_back' | 'stale';
  address_id: string | null;
  building_id: string | null;
  secondary_building_id: string | null;
  unit_id: string | null;
  parent_building_id: string | null;
  unit_index: number | null;
  address_identity: string | null;
  split_signature: string | null;
  evidence_codes: string[];
  score: number;
  runner_up_margin: number | null;
  precondition_hash: string;
  before_state: JsonRecord;
  proposed_state: JsonRecord;
};

export type ReverseResult = {
  cacheKey: string;
  formatted: string;
  houseNumber: string;
  streetName: string;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  longitude: number;
  latitude: number;
  accuracy: string;
  identity: string;
  raw: JsonRecord;
};

export type MapReconciliationReport = {
  addresses_examined: number;
  unlinked_buildings_examined: number;
  reverse_geocodes_matched: number;
  orphan_addresses_reused: number;
  provisional_addresses_created: number;
  unresolved_buildings: number;
  addresses_linked: number;
  links_reassigned: number;
  source_coordinates_corrected: number;
  label_anchors_adjusted: number;
  synthetic_addresses_created: number;
  duplicate_buildings_hidden: number;
  auxiliary_buildings_hidden: number;
  address_orphans_before: number;
  address_orphans_after: number;
  building_orphans_before: number;
  building_orphans_after: number;
  coverage_before: number;
  coverage_after: number;
  review_needed: number;
};

export type ReconciliationCandidateContext = {
  inferredStreetMatch?: boolean;
  neighborhoodSequenceScore?: number;
};

export type LinkedNeighborhoodEvidence = {
  addressId: string;
  buildingId: string;
  street: string;
  houseNumber: number;
  center: Point;
};

export type ReverseOrphanCorrectionAssessment = {
  eligible: boolean;
  moveSource: boolean;
  score: number;
  evidenceCodes: string[];
  rejectionReason?: string;
};

export type GlobalAssignmentEdge = {
  buildingId: string;
  addressId: string;
  weight: number;
};

/**
 * Maximum-cardinality, maximum-weight one-to-one assignment. Dummy columns
 * allow buildings to remain unresolved; real edges receive a cardinality
 * bonus so an extra valid match always beats any collection of weight gains.
 */
export function solveGlobalOneToOneAssignment(
  edges: GlobalAssignmentEdge[]
): Array<{ buildingId: string; addressId: string }> {
  const buildingIds = [...new Set(edges.map((edge) => edge.buildingId))].sort();
  const addressIds = [...new Set(edges.map((edge) => edge.addressId))].sort();
  if (buildingIds.length === 0 || addressIds.length === 0) return [];

  const rowByBuilding = new Map(buildingIds.map((id, index) => [id, index] as const));
  const columnByAddress = new Map(addressIds.map((id, index) => [id, index] as const));
  const columnCount = addressIds.length + buildingIds.length;
  const forbiddenCost = 1_000_000_000;
  const cardinalityBonus = 1_000_000;
  const costs: number[][] = Array.from({ length: buildingIds.length }, () =>
    Array.from({ length: columnCount }, (_, column) =>
      column < addressIds.length ? forbiddenCost : 0
    )
  );
  for (const edge of edges) {
    const row = rowByBuilding.get(edge.buildingId);
    const column = columnByAddress.get(edge.addressId);
    if (row === undefined || column === undefined) continue;
    costs[row][column] = Math.min(
      costs[row][column],
      -(cardinalityBonus + Math.round(edge.weight * 1_000))
    );
  }

  // Hungarian algorithm for a rectangular matrix where rows <= columns.
  const rowCount = buildingIds.length;
  const potentialRows = Array(rowCount + 1).fill(0);
  const potentialColumns = Array(columnCount + 1).fill(0);
  const matchedRowForColumn = Array(columnCount + 1).fill(0);
  const predecessor = Array(columnCount + 1).fill(0);
  for (let row = 1; row <= rowCount; row += 1) {
    matchedRowForColumn[0] = row;
    let column0 = 0;
    const minimum = Array(columnCount + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array(columnCount + 1).fill(false);
    do {
      used[column0] = true;
      const currentRow = matchedRowForColumn[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) continue;
        const currentCost =
          costs[currentRow - 1][column - 1] -
          potentialRows[currentRow] -
          potentialColumns[column];
        if (currentCost < minimum[column]) {
          minimum[column] = currentCost;
          predecessor[column] = column0;
        }
        if (minimum[column] < delta) {
          delta = minimum[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) {
          potentialRows[matchedRowForColumn[column]] += delta;
          potentialColumns[column] -= delta;
        } else {
          minimum[column] -= delta;
        }
      }
      column0 = column1;
    } while (matchedRowForColumn[column0] !== 0);
    do {
      const column1 = predecessor[column0];
      matchedRowForColumn[column0] = matchedRowForColumn[column1];
      column0 = column1;
    } while (column0 !== 0);
  }

  const assignments: Array<{ buildingId: string; addressId: string }> = [];
  for (let column = 1; column <= addressIds.length; column += 1) {
    const row = matchedRowForColumn[column];
    if (row === 0 || costs[row - 1][column - 1] >= forbiddenCost) continue;
    assignments.push({
      buildingId: buildingIds[row - 1],
      addressId: addressIds[column - 1],
    });
  }
  return assignments.sort((left, right) =>
    left.buildingId.localeCompare(right.buildingId) ||
    left.addressId.localeCompare(right.addressId)
  );
}

export function canCreateSyntheticAfterGlobalAssignment(input: {
  targetBuildingId: string;
  currentAddressIds: string[];
  assignments: Array<{ buildingId: string; addressId: string }>;
}): boolean {
  const target = input.targetBuildingId.toLowerCase();
  const assignmentBuildingByAddress = new Map(input.assignments.map((assignment) => [
    assignment.addressId.toLowerCase(),
    assignment.buildingId.toLowerCase(),
  ] as const));
  return input.currentAddressIds.every((addressIdValue) => {
    const assignedBuilding = assignmentBuildingByAddress.get(addressIdValue.toLowerCase());
    return Boolean(assignedBuilding && assignedBuilding !== target);
  });
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function unitIdentityFromFormatted(value: unknown): string | null {
  const formatted = String(value ?? '');
  const match = formatted.match(/\b(?:unit|suite|apt|apartment)\s*#?\s*([a-z0-9-]+)\b/i) ??
    formatted.match(/#\s*([a-z0-9-]+)\b/i);
  return match?.[1] ?? null;
}

function normalizedRegion(value: unknown): string {
  const region = normalizeText(value);
  const aliases: Record<string, string> = {
    ontario: 'on',
    quebec: 'qc',
    'new brunswick': 'nb',
    'nova scotia': 'ns',
    manitoba: 'mb',
    saskatchewan: 'sk',
    alberta: 'ab',
    'british columbia': 'bc',
    'prince edward island': 'pe',
    newfoundland: 'nl',
    'newfoundland and labrador': 'nl',
  };
  return aliases[region] ?? region;
}

export function normalizedCivicAddressIdentity(input: {
  houseNumber?: unknown;
  houseSuffix?: unknown;
  streetName?: unknown;
  unit?: unknown;
}): string {
  return [
    `${normalizeText(input.houseNumber)}${normalizeText(input.houseSuffix)}`,
    normalizeStreet(input.streetName),
    normalizeText(input.unit),
  ].join('|');
}

export function normalizedAddressIdentity(input: {
  houseNumber?: unknown;
  houseSuffix?: unknown;
  streetName?: unknown;
  locality?: unknown;
  region?: unknown;
  postalCode?: unknown;
  unit?: unknown;
}): string {
  return [
    normalizedCivicAddressIdentity(input),
    normalizeText(input.locality),
    normalizedRegion(input.region),
    normalizeText(input.postalCode).replaceAll(' ', ''),
  ].join('|');
}

export function parseMapboxReverseResult(
  cacheKey: string,
  payload: JsonRecord
): ReverseResult | null {
  const feature = asRecord(asArray(payload.features)[0]);
  const properties = asRecord(feature.properties);
  const context = asRecord(properties.context);
  const addressContext = asRecord(context.address);
  const streetContext = asRecord(context.street);
  const coordinatesMetadata = asRecord(properties.coordinates);
  const geometry = asRecord(feature.geometry);
  const coordinates = asArray<number>(geometry.coordinates);
  const houseNumber = stringValue(
    properties.address_number ??
    addressContext.address_number
  );
  const streetName = stringValue(
    properties.street ??
    properties.street_name ??
    addressContext.street_name ??
    streetContext.name
  );
  const longitude = numberValue(coordinatesMetadata.longitude ?? coordinates[0]);
  const latitude = numberValue(coordinatesMetadata.latitude ?? coordinates[1]);
  if (!houseNumber || !streetName || longitude === null || latitude === null) return null;
  const locality = stringValue(asRecord(context.place).name ?? asRecord(context.locality).name);
  const postalCode = stringValue(asRecord(context.postcode).name);
  const region = stringValue(asRecord(context.region).region_code ?? asRecord(context.region).name);
  const country = stringValue(asRecord(context.country).country_code ?? asRecord(context.country).name);
  const accuracy = normalizeText(coordinatesMetadata.accuracy ?? properties.accuracy);
  const identity = normalizedAddressIdentity({ houseNumber, streetName, locality, region, postalCode });
  return {
    cacheKey,
    formatted: stringValue(
      properties.full_address ??
      properties.name ??
      feature.place_name
    ) ?? `${houseNumber} ${streetName}`,
    houseNumber,
    streetName,
    locality,
    region,
    postalCode,
    country,
    longitude,
    latitude,
    accuracy,
    identity,
    raw: payload,
  };
}

function featureId(feature: BundleFeature): string | null {
  const properties = asRecord(feature.properties);
  return stringValue(
    properties.canonical_building_id ??
    properties.public_building_id ??
    properties.building_id ??
    properties.gers_id ??
    properties.address_id ??
    properties.id ??
    feature.id
  );
}

function addressId(feature: BundleFeature): string | null {
  const properties = asRecord(feature.properties);
  return stringValue(properties.address_id ?? properties.id ?? feature.id);
}

function featurePoint(feature: BundleFeature): Point | null {
  if (feature.geometry?.type !== 'Point') return null;
  const coordinates = feature.geometry.coordinates;
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function geometryStreet(feature: BundleFeature): string | null {
  const properties = asRecord(feature.properties);
  return stringValue(
    properties.street_name ??
    properties.primary_street_name ??
    properties.primary_street ??
    properties.addr_street ??
    properties.street
  );
}

function parcelId(feature: BundleFeature): string | null {
  const properties = asRecord(feature.properties);
  return stringValue(
    properties.parcel_id ??
    properties.parcel_external_id ??
    properties.canonical_parcel_id
  );
}

function addressIdentityFromFeature(feature: BundleFeature): string {
  const properties = asRecord(feature.properties);
  return normalizedAddressIdentity({
    houseNumber: properties.house_number ?? properties.street_number,
    houseSuffix: properties.house_suffix,
    streetName: properties.street_name ?? properties.street,
    locality: properties.locality,
    region: properties.region,
    postalCode: properties.postal_code,
    unit:
      properties.unit ??
      properties.unit_number ??
      unitIdentityFromFormatted(properties.formatted ?? properties.full_address),
  });
}

function civicIdentityFromFeature(feature: BundleFeature): string {
  const properties = asRecord(feature.properties);
  return normalizedCivicAddressIdentity({
    houseNumber: properties.house_number ?? properties.street_number,
    houseSuffix: properties.house_suffix,
    streetName: properties.street_name ?? properties.street,
    unit:
      properties.unit ??
      properties.unit_number ??
      unitIdentityFromFormatted(properties.formatted ?? properties.full_address),
  });
}

export function reverseAddressContextCompatibility(
  feature: BundleFeature,
  result: ReverseResult
): {
  localityMatches: boolean;
  regionMatches: boolean;
  postalMatches: boolean;
} {
  const properties = asRecord(feature.properties);
  const locality = normalizeText(
    properties.locality ?? properties.municipality ?? properties.city
  );
  const resultLocality = normalizeText(result.locality);
  const region = normalizedRegion(
    properties.region ?? properties.province ?? properties.state
  );
  const resultRegion = normalizedRegion(result.region);
  const postal = normalizeText(
    properties.postal_code ?? properties.postalCode ?? properties.zip
  ).replaceAll(' ', '');
  const resultPostal = normalizeText(result.postalCode).replaceAll(' ', '');
  const regionMatches = !(region && resultRegion && region !== resultRegion);
  const postalMatches = !(postal && resultPostal && postal !== resultPostal);
  const exactPostalContext = Boolean(
    postal &&
    resultPostal &&
    postal === resultPostal
  );
  // Municipal datasets sometimes use the source jurisdiction (for example
  // "Durham") as locality while the geocoder returns the civic place
  // ("Bowmanville"). An exact postal + region match is stronger evidence than
  // that source-label mismatch.
  const localityMatches = !(
    locality &&
    resultLocality &&
    locality !== resultLocality
  ) || (regionMatches && exactPostalContext);
  return { localityMatches, regionMatches, postalMatches };
}

export function addressContextMatchesReverse(
  feature: BundleFeature,
  result: ReverseResult
): boolean {
  const context = reverseAddressContextCompatibility(feature, result);
  return context.localityMatches && context.regionMatches && context.postalMatches;
}

function normalizeStreet(value: unknown): string {
  return normalizeText(value)
    .replace(/\bst\b/g, 'street')
    .replace(/\brd\b/g, 'road')
    .replace(/\bave\b/g, 'avenue')
    .replace(/\bdr\b/g, 'drive')
    .replace(/\bblvd\b/g, 'boulevard')
    .replace(/\bcrt\b/g, 'court')
    .replace(/\bct\b/g, 'court')
    .replace(/\bcr\b/g, 'crescent')
    .replace(/\bcres\b/g, 'crescent')
    .replace(/\bpl\b/g, 'place')
    .replace(/\bln\b/g, 'lane')
    .replace(/\btrl\b/g, 'trail')
    .replace(/\bter\b/g, 'terrace')
    .replace(/\bcir\b/g, 'circle')
    .replace(/\bpkwy\b/g, 'parkway')
    .replace(/\brdg\b/g, 'ridge')
    .replace(/\bgrv\b/g, 'grove')
    .replace(/\bhts\b/g, 'heights')
    .replace(/\bsq\b/g, 'square')
    .replace(/\bhwy\b/g, 'highway');
}

function numericHouseNumber(feature: BundleFeature): number | null {
  const properties = asRecord(feature.properties);
  const match = String(
    properties.house_number ??
    properties.street_number ??
    properties.formatted ??
    properties.full_address ??
    ''
  ).match(/\d+/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function featureCenter(feature: BundleFeature): Point | null {
  try {
    if (feature.geometry?.type === 'Point') return featurePoint(feature);
    const center = turf.centroid(feature as GeoJSON.Feature).geometry.coordinates;
    return [Number(center[0]), Number(center[1])];
  } catch {
    return null;
  }
}

export function buildLinkedNeighborhoodEvidence(input: {
  links: JsonRecord[];
  addressesById: ReadonlyMap<string, BundleFeature>;
  buildingsById: ReadonlyMap<string, BundleFeature>;
}): LinkedNeighborhoodEvidence[] {
  return input.links.flatMap((link) => {
    const addressIdValue = stringValue(link.address_id ?? link.addressId);
    const buildingIdValue = stringValue(link.building_id ?? link.buildingId);
    if (!addressIdValue || !buildingIdValue) return [];
    const address = input.addressesById.get(addressIdValue.toLowerCase());
    const building = input.buildingsById.get(buildingIdValue.toLowerCase());
    if (!address || !building) return [];
    const street = normalizeStreet(geometryStreet(address));
    const houseNumber = numericHouseNumber(address);
    const center = featureCenter(building);
    if (!street || houseNumber == null || !center) return [];
    return [{
      addressId: addressIdValue,
      buildingId: buildingIdValue,
      street,
      houseNumber,
      center,
    }];
  });
}

export function neighborhoodContextForCandidate(input: {
  address: BundleFeature;
  building: BundleFeature;
  linkedEvidence: LinkedNeighborhoodEvidence[];
}): ReconciliationCandidateContext {
  const street = normalizeStreet(geometryStreet(input.address));
  const houseNumber = numericHouseNumber(input.address);
  const addressIdValue = addressId(input.address)?.toLowerCase() ?? null;
  const buildingIdValue = featureId(input.building)?.toLowerCase() ?? null;
  const center = featureCenter(input.building);
  if (!street || houseNumber == null || !center) return {};
  const nearby = input.linkedEvidence
    .filter((evidence) =>
      evidence.street === street &&
      evidence.addressId.toLowerCase() !== addressIdValue &&
      evidence.buildingId.toLowerCase() !== buildingIdValue
    )
    .map((evidence) => ({
      ...evidence,
      distance: turf.distance(turf.point(center), turf.point(evidence.center), { units: 'meters' }),
    }))
    .filter((evidence) => evidence.distance <= 55)
    .sort((left, right) => left.distance - right.distance);
  if (nearby.length === 0) return {};

  const lower = nearby
    .filter((evidence) => evidence.houseNumber < houseNumber)
    .sort((left, right) =>
      houseNumber - left.houseNumber - (houseNumber - right.houseNumber) ||
      left.distance - right.distance
    )[0];
  const upper = nearby
    .filter((evidence) => evidence.houseNumber > houseNumber)
    .sort((left, right) =>
      left.houseNumber - houseNumber - (right.houseNumber - houseNumber) ||
      left.distance - right.distance
    )[0];
  let sequenceScore = 0;
  if (
    lower &&
    upper &&
    upper.houseNumber - lower.houseNumber <= 40 &&
    lower.houseNumber < houseNumber &&
    houseNumber < upper.houseNumber
  ) {
    sequenceScore = 1;
  } else {
    const nearestNumber = [...nearby]
      .sort((left, right) =>
        Math.abs(left.houseNumber - houseNumber) - Math.abs(right.houseNumber - houseNumber) ||
        left.distance - right.distance
      )[0];
    const difference = Math.abs(nearestNumber.houseNumber - houseNumber);
    const parityMatches = nearestNumber.houseNumber % 2 === houseNumber % 2;
    if (nearby.length >= 2 && parityMatches && difference <= 8) {
      sequenceScore = Math.max(0.35, 0.8 * (1 - difference / 10));
    }
  }
  return {
    inferredStreetMatch: true,
    neighborhoodSequenceScore: sequenceScore,
  };
}

function streetScore(address: BundleFeature, building: BundleFeature): number {
  const left = normalizeStreet(geometryStreet(address));
  const right = normalizeStreet(geometryStreet(building));
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftWords = new Set(left.split(' '));
  const rightWords = right.split(' ');
  return rightWords.filter((word) => leftWords.has(word)).length / rightWords.length;
}

function pointToGeometryDistanceMeters(point: Point, geometry: GeoJSON.Geometry): number {
  try {
    const pointFeature = turf.point(point);
    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      const polygonFeature = turf.feature(geometry);
      if (turf.booleanPointInPolygon(pointFeature, polygonFeature)) return 0;
      const lines = turf.polygonToLine(polygonFeature);
      let minimum = Number.POSITIVE_INFINITY;
      turf.segmentEach(lines, (segment) => {
        if (!segment) return;
        minimum = Math.min(
          minimum,
          turf.pointToLineDistance(pointFeature, segment, { units: 'meters' })
        );
      });
      return minimum;
    }
  } catch {
    return Number.POSITIVE_INFINITY;
  }
  return Number.POSITIVE_INFINITY;
}

export function scoreReconciliationCandidate(
  address: BundleFeature,
  building: BundleFeature,
  context: ReconciliationCandidateContext = {}
): {
  score: number;
  distance: number;
  evidence: string[];
} {
  const point = featurePoint(address);
  if (!point || !building.geometry) return { score: 0, distance: Number.POSITIVE_INFINITY, evidence: [] };
  const distance = pointToGeometryDistanceMeters(point, building.geometry);
  if (!Number.isFinite(distance) || distance > 60) return { score: 0, distance, evidence: [] };
  const contained = distance === 0;
  const street = streetScore(address, building);
  const addressParcel = parcelId(address);
  const buildingParcel = parcelId(building);
  const sameParcel = Boolean(addressParcel && buildingParcel && addressParcel === buildingParcel);
  const distanceEvidence = contained ? 0.06 : Math.max(0, 0.64 * (1 - distance / 60));
  const effectiveStreet = Math.max(street, context.inferredStreetMatch ? 1 : 0);
  const sequenceScore = Math.max(0, Math.min(1, context.neighborhoodSequenceScore ?? 0));
  const score = Math.min(1,
    (contained ? 0.78 : 0) +
    distanceEvidence +
    effectiveStreet * 0.14 +
    (sameParcel ? 0.08 : 0) +
    sequenceScore * 0.16
  );
  return {
    score,
    distance,
    evidence: [
      ...(contained ? ['footprint_containment'] : distance <= 10 ? ['footprint_edge_10m'] : ['nearby_building']),
      ...(street >= 0.99 ? ['street_exact'] : street > 0 ? ['street_partial'] : []),
      ...(street < 0.99 && context.inferredStreetMatch ? ['street_inferred_from_linked_neighbor'] : []),
      ...(sequenceScore > 0 ? ['house_number_sequence'] : []),
      ...(sameParcel ? ['same_parcel'] : []),
    ],
  };
}

export function buildingAllowsMultipleAddresses(building: BundleFeature): boolean {
  const properties = asRecord(building.properties);
  const type = normalizeText(
    properties.subtype ??
    properties.building_type ??
    properties.class ??
    properties.type
  );
  return (
    properties.is_townhouse === true ||
    Number(properties.address_count ?? properties.unit_count ?? 0) > 1 ||
    ['townhouse', 'row house', 'terrace', 'apartment', 'multi family', 'multiplex']
      .some((candidate) => type.includes(candidate))
  );
}

export function buildingHasAuthoritativeMultiUnitMetadata(building: BundleFeature): boolean {
  const properties = asRecord(building.properties);
  const type = normalizeText(
    properties.subtype ??
    properties.building_type ??
    properties.class ??
    properties.type
  );
  return (
    properties.is_townhouse === true ||
    Number(properties.authoritative_unit_count ?? properties.source_unit_count ?? 0) > 1 ||
    ['townhouse', 'row house', 'terrace', 'apartment', 'multi family', 'multiplex']
      .some((candidate) => type.includes(candidate))
  );
}

function isExplicitNonResidentialBuilding(building: BundleFeature): boolean {
  const properties = asRecord(building.properties);
  const type = normalizeText(
    properties.subtype ??
    properties.building_type ??
    properties.class ??
    properties.type
  );
  return [
    'garage', 'shed', 'outbuilding', 'carport', 'barn', 'storage', 'utility',
    'industrial', 'commercial', 'retail', 'warehouse', 'school', 'church',
  ].some((candidate) => type.includes(candidate));
}

export function shouldAutoHideOverlappingDuplicate(input: {
  polygonIou: number;
  centroidDistanceMeters: number;
  leftParcelId: string | null;
  rightParcelId: string | null;
  hasProtectedHistory: boolean;
}): boolean {
  return (
    !input.hasProtectedHistory &&
    Boolean(input.leftParcelId) &&
    input.leftParcelId === input.rightParcelId &&
    input.polygonIou >= 0.90 &&
    input.centroidDistanceMeters <= 3
  );
}

export function shouldAutoHideAuxiliary(input: {
  explicitNonResidentialType: boolean;
  areaSquareMeters: number;
  primaryAreaSquareMeters: number;
  hasUniqueAddressOrHistory: boolean;
  duplicateReverseIdentity: boolean;
  outbuildingPlacement: boolean;
}): boolean {
  if (input.hasUniqueAddressOrHistory || !input.duplicateReverseIdentity) return false;
  if (input.explicitNonResidentialType) return true;
  return (
    input.areaSquareMeters <= 30 &&
    input.areaSquareMeters <= input.primaryAreaSquareMeters * 0.25 &&
    input.outbuildingPlacement
  );
}

export function assessReverseOrphanCorrection(input: {
  accuracy: string;
  reversePointDistanceMeters: number;
  sourcePointDistanceMeters: number;
  addressIdentityMatches: boolean;
  uniqueAddressIdentity: boolean;
  uniqueBuildingIdentity: boolean;
  addressIsOrphan: boolean;
  buildingIsOrphan: boolean;
  localityMatches: boolean;
  regionMatches: boolean;
  postalMatches: boolean;
  protectedHistory: boolean;
  explicitNonResidentialType: boolean;
}): ReverseOrphanCorrectionAssessment {
  const accuracy = normalizeText(input.accuracy);
  const baseEvidence = [
    'reverse_address_complete',
    `accuracy_${accuracy || 'unknown'}`,
    'exact_orphan_address_identity',
    'unique_orphan_address_identity',
    'unique_reverse_building_identity',
    'campaign_context_match',
    'orphan_address',
    'orphan_building',
  ];
  const reject = (rejectionReason: string): ReverseOrphanCorrectionAssessment => ({
    eligible: false,
    moveSource: false,
    score: 0,
    evidenceCodes: baseEvidence,
    rejectionReason,
  });
  if (!input.addressIsOrphan || !input.buildingIsOrphan) return reject('orphan_pair_required');
  if (input.protectedHistory) return reject('protected_history');
  if (input.explicitNonResidentialType) return reject('non_residential_building');
  if (!input.addressIdentityMatches) return reject('address_identity_mismatch');
  if (!input.uniqueAddressIdentity) return reject('ambiguous_orphan_address_identity');
  if (!input.uniqueBuildingIdentity) return reject('ambiguous_reverse_building_identity');
  if (!input.localityMatches || !input.regionMatches || !input.postalMatches) {
    return reject('campaign_context_mismatch');
  }
  const rooftop = accuracy === 'rooftop' && input.reversePointDistanceMeters <= 8;
  const parcel =
    accuracy === 'parcel' &&
    input.reversePointDistanceMeters === 0;
  if (!rooftop && !parcel) return reject('reverse_point_failed_building_test');
  return {
    eligible: true,
    moveSource: true,
    score: rooftop ? 0.995 : 0.985,
    evidenceCodes: [
      ...baseEvidence,
      rooftop ? 'rooftop_within_8m' : 'parcel_point_inside_footprint',
      'source_geometry_aligned_to_building',
    ],
  };
}

export function isBuildingAvailableForCivicAssignment(
  buildingId: string,
  allowsMultipleAddresses: boolean,
  occupiedSingleAddressBuildings: ReadonlySet<string>
): boolean {
  return (
    allowsMultipleAddresses ||
    !occupiedSingleAddressBuildings.has(buildingId.toLowerCase())
  );
}

function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function decisionId(runId: string, action: DecisionAction, addressIdValue: string | null, buildingId: string | null): string {
  return uuidV5(`${runId}:${action}:${addressIdValue ?? 'none'}:${buildingId ?? 'none'}`);
}

function defaultReport(): MapReconciliationReport {
  return {
    addresses_examined: 0,
    unlinked_buildings_examined: 0,
    reverse_geocodes_matched: 0,
    orphan_addresses_reused: 0,
    provisional_addresses_created: 0,
    unresolved_buildings: 0,
    addresses_linked: 0,
    links_reassigned: 0,
    source_coordinates_corrected: 0,
    label_anchors_adjusted: 0,
    synthetic_addresses_created: 0,
    duplicate_buildings_hidden: 0,
    auxiliary_buildings_hidden: 0,
    address_orphans_before: 0,
    address_orphans_after: 0,
    building_orphans_before: 0,
    building_orphans_after: 0,
    coverage_before: 0,
    coverage_after: 0,
    review_needed: 0,
  };
}

export function configuredMapReconciliationMode(campaignId?: string): MapReconciliationMode {
  if (process.env.MAP_RECONCILIATION_KILL_SWITCH === 'true') return 'off';
  const configured = normalizeText(process.env.MAP_RECONCILIATION_MODE);
  const explicitCohort = String(process.env.MAP_RECONCILIATION_CAMPAIGN_IDS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    campaignId &&
    explicitCohort.length > 0 &&
    !explicitCohort.includes(campaignId.toLowerCase())
  ) return 'off';
  const cohortPercent = Math.max(
    0,
    Math.min(100, Number(process.env.MAP_RECONCILIATION_COHORT_PERCENT ?? 100))
  );
  if (campaignId && cohortPercent < 100) {
    const bucket = Number.parseInt(stableHash(campaignId).slice(0, 8), 16) % 100;
    if (bucket >= cohortPercent) return 'off';
  }
  if (configured === 'apply high confidence' || configured === 'apply_high_confidence') {
    return 'apply_high_confidence';
  }
  if (configured === 'off') return 'off';
  return 'shadow';
}

export function configuredReverseGeocodingStorageMode(
  configured = process.env.MAPBOX_GEOCODING_STORAGE_MODE
): ReverseGeocodingStorageMode {
  return normalizeText(configured) === 'temporary' ? 'temporary' : 'permanent';
}

export class CampaignMapReconciliationService {
  private readonly temporaryReverseResults = new Map<string, ReverseResult | null>();

  constructor(private readonly supabase: SupabaseClient) {}

  async reviewDecision(
    decisionIdValue: string,
    reviewerId: string,
    outcome: 'approve' | 'reject',
    reason?: string,
    rebuildBundle = true,
    options?: { preserveSourceCoordinates?: boolean }
  ): Promise<JsonRecord> {
    const { data, error } = await this.supabase
      .from('map_reconciliation_decisions')
      .select('*')
      .eq('id', decisionIdValue)
      .maybeSingle();
    if (error || !data) throw new Error(error?.message ?? 'Reconciliation decision not found');
    const decision = data as ReconciliationDecision;
    if (!['proposed', 'requires_review'].includes(decision.status)) {
      return { decision_id: decision.id, status: decision.status, unchanged: true };
    }
    const reviewedAt = new Date().toISOString();
    if (outcome === 'reject') {
      await this.supabase
        .from('map_reconciliation_decisions')
        .update({
          status: 'rejected',
          reviewed_by: reviewerId,
          reviewed_at: reviewedAt,
          review_reason: reason ?? null,
        })
        .eq('id', decision.id);
      return { decision_id: decision.id, status: 'rejected' };
    }
    if (decision.action === 'leave_unresolved') {
      await this.supabase
        .from('map_reconciliation_decisions')
        .update({
          status: 'rejected',
          reviewed_by: reviewerId,
          reviewed_at: reviewedAt,
          review_reason: reason ?? 'Reviewed and intentionally left unresolved',
        })
        .eq('id', decision.id);
      return { decision_id: decision.id, status: 'rejected', unchanged: true };
    }

    decision.status = 'proposed';
    if (
      options?.preserveSourceCoordinates === true &&
      decision.action === 'link_address' &&
      decision.proposed_state.move_source === true
    ) {
      decision.proposed_state = {
        ...decision.proposed_state,
        move_source: false,
        coordinate_policy: 'preserve_source',
      };
      decision.evidence_codes = [
        ...decision.evidence_codes.filter((code) => code !== 'source_move_with_rollback'),
        'source_coordinate_preserved_by_policy',
      ];
      const override = await this.supabase
        .from('map_reconciliation_decisions')
        .update({
          proposed_state: decision.proposed_state,
          evidence_codes: decision.evidence_codes,
        })
        .eq('id', decision.id);
      if (override.error) {
        throw new Error(`Failed to preserve source coordinates: ${override.error.message}`);
      }
    }
    const applied = await this.applyDecision(decision);
    await this.supabase
      .from('map_reconciliation_decisions')
      .update({
        reviewed_by: reviewerId,
        reviewed_at: reviewedAt,
        review_reason: reason ?? null,
      })
      .eq('id', decision.id);
    if (applied && rebuildBundle) {
      await prebuildCampaignMapBundle(this.supabase, decision.campaign_id, undefined, {
        forceRebuild: true,
      });
    }
    return { decision_id: decision.id, status: applied ? 'applied' : 'stale' };
  }

  async rollbackDecision(
    decisionIdValue: string,
    reviewerId: string,
    reason?: string,
    rebuildBundle = true
  ): Promise<JsonRecord> {
    const { data, error } = await this.supabase
      .from('map_reconciliation_decisions')
      .select('*')
      .eq('id', decisionIdValue)
      .maybeSingle();
    if (error || !data) throw new Error(error?.message ?? 'Reconciliation decision not found');
    const decision = data as ReconciliationDecision;
    if (decision.status === 'rolled_back') {
      return { decision_id: decision.id, status: 'rolled_back', unchanged: true };
    }
    if (decision.status !== 'applied') throw new Error('Only applied decisions can be rolled back');

    if (
      (decision.action === 'link_address' || decision.action === 'reassign_address') &&
      decision.proposed_state.global_assignment === true
    ) {
      const rollback = await this.supabase.rpc('rollback_global_reverse_assignment', {
        p_run_id: decision.run_id,
      });
      if (rollback.error) {
        throw new Error(`Failed to roll back global reverse assignment: ${rollback.error.message}`);
      }
      if (rollback.data !== true) {
        throw new Error('Global reverse assignment is no longer safe to roll back');
      }
      const rolledBackAt = new Date().toISOString();
      await this.supabase
        .from('map_reconciliation_decisions')
        .update({
          reviewed_at: rolledBackAt,
          reviewed_by: reviewerId,
          review_reason: reason ?? 'Global assignment rolled back',
        })
        .eq('run_id', decision.run_id)
        .eq('status', 'rolled_back');
      if (rebuildBundle) {
        await prebuildCampaignMapBundle(this.supabase, decision.campaign_id, undefined, {
          forceRebuild: true,
        });
      }
      return {
        decision_id: decision.id,
        run_id: decision.run_id,
        status: 'rolled_back',
        batch: true,
      };
    }

    if (
      decision.action === 'link_address' &&
      decision.address_id &&
      decision.proposed_state.move_source === true
    ) {
      const protectedState = await this.loadProtectedState(decision.campaign_id);
      if (protectedState.addressIds.has(decision.address_id.toLowerCase())) {
        throw new Error('Corrected address now has protected field history and cannot be moved back');
      }
      const rollback = await this.supabase.rpc('rollback_reverse_geocode_orphan_correction', {
        p_decision_id: decision.id,
      });
      if (rollback.error) {
        throw new Error(`Failed to roll back reverse-geocode source correction: ${rollback.error.message}`);
      }
      if (rollback.data !== true) {
        throw new Error('Reverse-geocode source correction is no longer safe to roll back');
      }
      const rolledBackAt = new Date().toISOString();
      await this.supabase
        .from('map_reconciliation_decisions')
        .update({
          reviewed_at: rolledBackAt,
          reviewed_by: reviewerId,
          review_reason: reason ?? 'Rolled back',
        })
        .eq('id', decision.id);
      if (rebuildBundle) {
        await prebuildCampaignMapBundle(this.supabase, decision.campaign_id, undefined, {
          forceRebuild: true,
        });
      }
      return { decision_id: decision.id, status: 'rolled_back' };
    }

    if ((decision.action === 'link_address' || decision.action === 'reassign_address') && decision.address_id) {
      await this.supabase
        .from('building_address_links')
        .delete()
        .eq('campaign_id', decision.campaign_id)
        .eq('address_id', decision.address_id)
        .eq('reconciliation_decision_id', decision.id);
      await this.supabase
        .from('campaign_addresses')
        .update({
          building_id: decision.before_state.building_id ?? null,
          building_gers_id: decision.before_state.building_gers_id ?? null,
          match_source: decision.before_state.match_source ?? null,
          confidence: decision.before_state.confidence ?? null,
        })
        .eq('campaign_id', decision.campaign_id)
        .eq('id', decision.address_id)
        .like('match_source', 'reconciliation%');
      if (decision.action === 'reassign_address') {
        const previousLink = asRecord(decision.before_state.link);
        const previousBuildingId = stringValue(
          previousLink.building_id ?? decision.before_state.building_gers_id
        );
        if (previousBuildingId) {
          await this.supabase
            .from('building_address_links')
            .upsert({
              campaign_id: decision.campaign_id,
              address_id: decision.address_id,
              building_id: previousBuildingId,
              match_type: stringValue(previousLink.match_type) ?? 'stable_linker',
              confidence: numberValue(previousLink.confidence),
              distance_meters: numberValue(previousLink.distance_meters),
              street_match_score: numberValue(previousLink.street_match_score),
              is_multi_unit: previousLink.is_multi_unit === true,
              unit_count: numberValue(previousLink.unit_count),
              unit_arrangement: stringValue(previousLink.unit_arrangement),
              linker_version: numberValue(previousLink.linker_version),
              evidence_codes: asArray<string>(previousLink.evidence_codes),
              user_confirmed: previousLink.user_confirmed === true,
              locked: previousLink.locked === true,
              link_state: 'active',
              reconciliation_decision_id: null,
              reconciliation_version: null,
          }, { onConflict: 'campaign_id,address_id' });
        }
      } else {
        const orphanSnapshot = asRecord(decision.before_state.address_orphan);
        if (Object.keys(orphanSnapshot).length > 0) {
          const restore = await this.supabase
            .from('address_orphans')
            .upsert({
              ...orphanSnapshot,
              campaign_id: decision.campaign_id,
              address_id: decision.address_id,
            }, { onConflict: 'campaign_id,address_id' });
          if (restore.error) {
            throw new Error(`Failed to restore address orphan: ${restore.error.message}`);
          }
        }
      }
    } else if (decision.action === 'create_synthetic_address' && decision.address_id) {
      const protectedState = await this.loadProtectedState(decision.campaign_id);
      if (protectedState.addressIds.has(decision.address_id.toLowerCase())) {
        throw new Error('Synthetic address now has protected field history and cannot be removed');
      }
      await this.supabase
        .from('building_address_links')
        .delete()
        .eq('campaign_id', decision.campaign_id)
        .eq('address_id', decision.address_id)
        .eq('reconciliation_decision_id', decision.id);
      await this.supabase
        .from('campaign_addresses')
        .delete()
        .eq('campaign_id', decision.campaign_id)
        .eq('id', decision.address_id)
        .eq('source', 'derived_reverse_geocode');
    } else if (decision.action === 'adjust_label' && decision.address_id) {
      await this.supabase
        .from('campaign_address_adjustments')
        .delete()
        .eq('campaign_id', decision.campaign_id)
        .eq('address_id', decision.address_id)
        .eq('decision_id', decision.id);
    } else if (
      (decision.action === 'hide_duplicate' || decision.action === 'hide_auxiliary') &&
      decision.building_id
    ) {
      const priorResolution = asRecord(decision.before_state.resolution);
      if (decision.before_state.existed === true) {
        await this.supabase
          .from('campaign_building_resolutions')
          .upsert({
            ...priorResolution,
            campaign_id: decision.campaign_id,
            building_id: decision.building_id,
          }, { onConflict: 'campaign_id,building_id' });
      } else {
        await this.supabase
          .from('campaign_building_resolutions')
          .delete()
          .eq('campaign_id', decision.campaign_id)
          .eq('building_id', decision.building_id)
          .eq('decision_id', decision.id);
      }
    }

    const rolledBackAt = new Date().toISOString();
    await this.supabase
      .from('map_reconciliation_decisions')
      .update({
        status: 'rolled_back',
        rolled_back_at: rolledBackAt,
        reviewed_at: rolledBackAt,
        reviewed_by: reviewerId,
        review_reason: reason ?? 'Rolled back',
      })
      .eq('id', decision.id);
    if (rebuildBundle) {
      await prebuildCampaignMapBundle(this.supabase, decision.campaign_id, undefined, {
        forceRebuild: true,
      });
    }
    return { decision_id: decision.id, status: 'rolled_back' };
  }

  async rollbackRun(runId: string, reviewerId: string, reason?: string): Promise<JsonRecord> {
    const { data, error } = await this.supabase
      .from('map_reconciliation_decisions')
      .select('id')
      .eq('run_id', runId)
      .eq('status', 'applied')
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to load applied decisions: ${error.message}`);
    const results: JsonRecord[] = [];
    for (const row of data ?? []) {
      results.push(await this.rollbackDecision(String(row.id), reviewerId, reason, false));
    }
    const { data: run } = await this.supabase
      .from('map_reconciliation_runs')
      .select('campaign_id')
      .eq('id', runId)
      .maybeSingle();
    if (run?.campaign_id && results.length > 0) {
      await this.supabase
        .from('map_reconciliation_runs')
        .update({
          status: 'superseded',
          phase: 'rolled_back',
          updated_at: new Date().toISOString(),
        })
        .eq('id', runId);
      await prebuildCampaignMapBundle(this.supabase, String(run.campaign_id), undefined, {
        forceRebuild: true,
      });
    }
    return { run_id: runId, rolled_back: results.length, decisions: results };
  }

  async enqueue(campaignId: string, sourceSignature?: string | null): Promise<ReconciliationRunRow | null> {
    const mode = await this.rolloutMode(campaignId);
    if (mode === 'off') return null;
    const currentBundle = sourceSignature
      ? null
      : await readCurrentCampaignMapBundle(this.supabase, campaignId);
    const signature = sourceSignature ?? currentBundle?.asset_signature;
    if (!signature) throw new Error('Cannot queue reconciliation without an optimized bundle signature');
    const idempotencyKey = stableHash({
      campaignId,
      sourceSignature: signature,
      algorithmVersion: MAP_RECONCILIATION_ALGORITHM_VERSION,
      mode,
    });
    const { data, error } = await this.supabase
      .from('map_reconciliation_runs')
      .upsert({
        campaign_id: campaignId,
        source_signature: signature,
        idempotency_key: idempotencyKey,
        algorithm_version: MAP_RECONCILIATION_ALGORITHM_VERSION,
        mode,
        status: 'queued',
        phase: 'queued',
      }, { onConflict: 'idempotency_key', ignoreDuplicates: true })
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`Failed to queue map reconciliation: ${error.message}`);
    if (data) return data as ReconciliationRunRow;
    const existing = await this.supabase
      .from('map_reconciliation_runs')
      .select('*')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (existing.error) throw new Error(`Failed to read queued reconciliation: ${existing.error.message}`);
    return existing.data as ReconciliationRunRow | null;
  }

  private async rolloutMode(campaignId: string): Promise<MapReconciliationMode> {
    const configured = configuredMapReconciliationMode(campaignId);
    if (
      configured !== 'apply_high_confidence' ||
      process.env.MAP_RECONCILIATION_ROLLOUT_GATE_BYPASS === 'true'
    ) return configured;

    const { data, error } = await this.supabase
      .from('map_reconciliation_decisions')
      .select('campaign_id, action, status, reviewed_at')
      .not('reviewed_at', 'is', null)
      .in('status', ['applied', 'rejected', 'rolled_back'])
      .order('reviewed_at', { ascending: false })
      .limit(5000);
    if (error) return 'shadow';
    const reviewed = data ?? [];
    const campaignCount = new Set(reviewed.map((decision) => decision.campaign_id)).size;
    if (reviewed.length < 500 || campaignCount < 20) return 'shadow';

    const precisionFor = (actions: string[]): number => {
      const sample = reviewed.filter((decision) => actions.includes(decision.action));
      if (sample.length === 0) return 0;
      const accepted = sample.filter((decision) => decision.status === 'applied').length;
      return accepted / sample.length;
    };
    const linkPrecision = precisionFor(['link_address', 'reassign_address']);
    const syntheticPrecision = precisionFor(['create_synthetic_address']);
    const rejectedHide = reviewed.some((decision) =>
      ['hide_duplicate', 'hide_auxiliary'].includes(decision.action) &&
      (decision.status === 'rejected' || decision.status === 'rolled_back')
    );
    return (
      linkPrecision >= 0.99 &&
      syntheticPrecision >= 0.99 &&
      !rejectedHide
    ) ? configured : 'shadow';
  }

  async claimAndProcess(workerId: string): Promise<ReconciliationRunRow | null> {
    const { data, error } = await this.supabase.rpc('claim_map_reconciliation_run', {
      p_worker_id: workerId,
      p_lease_seconds: 240,
    });
    if (error) throw new Error(`Failed to claim reconciliation run: ${error.message}`);
    const run = asArray<ReconciliationRunRow>(data)[0] ?? null;
    if (!run) return null;
    await this.processRun(run);
    return run;
  }

  async processRun(run: ReconciliationRunRow): Promise<void> {
    // Temporary results are session-scoped testing evidence. Never carry them
    // into a later reconciliation run or persist them in Supabase.
    this.temporaryReverseResults.clear();
    try {
      const currentRow = await readCurrentCampaignMapBundle(this.supabase, run.campaign_id);
      if (!currentRow) throw new Error('No current canonical map bundle');
      if (currentRow.asset_signature !== run.source_signature) {
        await this.supabase
          .from('map_reconciliation_runs')
          .update({
            status: 'superseded',
            phase: 'superseded',
            lease_owner: null,
            lease_expires_at: null,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', run.id);
        await this.enqueue(run.campaign_id, currentRow.asset_signature);
        return;
      }

      const bundle = responseFromCampaignMapBundleRow(currentRow);
      const addresses = asArray<BundleFeature>(asRecord(bundle.addresses).features);
      const buildings = asArray<BundleFeature>(asRecord(bundle.buildings).features)
        .filter((feature) => feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon');
      const links = asArray<JsonRecord>(bundle.links);
      const addressOrphans = asArray<JsonRecord>(bundle.address_orphans);
      const buildingOrphans = asArray<JsonRecord>(bundle.building_orphans);
      const report = defaultReport();
      report.addresses_examined = addresses.length;
      report.address_orphans_before = addressOrphans.length;
      report.building_orphans_before = buildingOrphans.length;
      report.coverage_before = addresses.length > 0 ? round(links.length / addresses.length * 100, 2) : 100;

      const protectedState = await this.loadProtectedState(run.campaign_id);
      const hasUsableParcels =
        asArray<BundleFeature>(asRecord(bundle.parcels).features).length > 0;
      if (
        MAP_RECONCILIATION_ALGORITHM_VERSION.includes('global-reverse') &&
        !hasUsableParcels
      ) {
        await this.processGlobalReverseAssignment({
          run,
          addresses,
          buildings,
          sourceBuildings: bundle.buildings as GeoJSON.FeatureCollection,
          sourceParcels: bundle.parcels as GeoJSON.FeatureCollection,
          links,
          addressOrphans,
          buildingOrphans,
          report,
          protectedAddressIds: protectedState.addressIds,
          protectedBuildingIds: protectedState.buildingIds,
        });
        return;
      }
      const linkedAddressIds = new Set(links
        .map((link) => stringValue(link.address_id ?? link.addressId)?.toLowerCase())
        .filter((id): id is string => Boolean(id)));
      const linkedBuildingIds = new Set(links
        .map((link) => stringValue(link.building_id ?? link.buildingId)?.toLowerCase())
        .filter((id): id is string => Boolean(id)));
      const addressById = new Map(addresses.flatMap((feature) => {
        const id = addressId(feature);
        return id ? [[id.toLowerCase(), feature] as const] : [];
      }));
      const buildingById = new Map(buildings.flatMap((feature) => {
        const id = featureId(feature);
        return id ? [[id.toLowerCase(), feature] as const] : [];
      }));
      const linkedNeighborhoodEvidence = buildLinkedNeighborhoodEvidence({
        links,
        addressesById: addressById,
        buildingsById: buildingById,
      });
      const linkedMultiAddressBuildingIds = new Set(links.flatMap((link) => {
        const id = stringValue(link.building_id ?? link.buildingId);
        const unitCount = numberValue(link.unit_count ?? link.unitCount) ?? 0;
        return id && (link.is_multi_unit === true || link.isMultiUnit === true || unitCount > 1)
          ? [id.toLowerCase()]
          : [];
      }));
      const allowsMultipleAddresses = (building: BundleFeature): boolean => {
        const id = featureId(building);
        return buildingAllowsMultipleAddresses(building) ||
          Boolean(id && linkedMultiAddressBuildingIds.has(id.toLowerCase()));
      };
      const scoreCandidate = (address: BundleFeature, building: BundleFeature) =>
        scoreReconciliationCandidate(address, building, neighborhoodContextForCandidate({
          address,
          building,
          linkedEvidence: linkedNeighborhoodEvidence,
        }));
      const satisfiesAutomaticLinkConstraints = (evidence: string[]) =>
        evidence.includes('footprint_containment') || evidence.includes('same_parcel');
      const spatialCellSize = 0.001;
      const spatialBuildingCells = new Map<string, BundleFeature[]>();
      for (const building of buildings) {
        try {
          const [minLon, minLat, maxLon, maxLat] = turf.bbox(building as GeoJSON.Feature);
          const minX = Math.floor(minLon / spatialCellSize) - 1;
          const maxX = Math.floor(maxLon / spatialCellSize) + 1;
          const minY = Math.floor(minLat / spatialCellSize) - 1;
          const maxY = Math.floor(maxLat / spatialCellSize) + 1;
          for (let x = minX; x <= maxX; x += 1) {
            for (let y = minY; y <= maxY; y += 1) {
              const key = `${x}:${y}`;
              spatialBuildingCells.set(key, [...(spatialBuildingCells.get(key) ?? []), building]);
            }
          }
        } catch {
          // Invalid source polygons remain visible and can be reviewed manually.
        }
      }
      const buildingsNearAddress = (feature: BundleFeature): BundleFeature[] => {
        const point = featurePoint(feature);
        if (!point) return [];
        const cellX = Math.floor(point[0] / spatialCellSize);
        const cellY = Math.floor(point[1] / spatialCellSize);
        const unique = new Map<string, BundleFeature>();
        for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
          for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
            for (const building of spatialBuildingCells.get(`${cellX + xOffset}:${cellY + yOffset}`) ?? []) {
              const id = featureId(building);
              if (id) unique.set(id.toLowerCase(), building);
            }
          }
        }
        return [...unique.values()];
      };
      const decisions: ReconciliationDecision[] = [];

      const orphanAddressIds = new Set(
        addressOrphans
          .map((orphan) => stringValue(orphan.address_id)?.toLowerCase())
          .filter((id): id is string => Boolean(id))
      );
      const orphanBuildingIds = new Set(
        buildingOrphans
          .map((orphan) => stringValue(orphan.building_id ?? orphan.buildingId)?.toLowerCase())
          .filter((id): id is string => Boolean(id))
      );
      const orphanCandidates: Array<{
        feature: BundleFeature;
        addressIdValue: string;
        ranked: Array<{
          building: BundleFeature;
          score: number;
          distance: number;
          evidence: string[];
        }>;
      }> = [];
      for (const feature of addresses) {
        const id = addressId(feature);
        if (!id || linkedAddressIds.has(id.toLowerCase()) || protectedState.addressIds.has(id.toLowerCase())) continue;
        if (orphanAddressIds.size > 0 && !orphanAddressIds.has(id.toLowerCase())) continue;
        const ranked = buildingsNearAddress(feature)
          .filter((building) => {
            const idValue = featureId(building);
            return idValue && !protectedState.buildingIds.has(idValue.toLowerCase());
          })
          .map((building) => ({ building, ...scoreCandidate(feature, building) }))
          .filter((candidate) => candidate.score >= REVIEW_SCORE)
          .sort((left, right) => right.score - left.score || left.distance - right.distance);
        if (ranked.length > 0) orphanCandidates.push({ feature, addressIdValue: id, ranked });
      }

      // Resolve the parcel/block candidate graph as a constrained assignment.
      // Existing links occupy ordinary single-address footprints. The most
      // spatially certain orphan is assigned first so an ambiguous nearby
      // address cannot steal another address's containing building.
      orphanCandidates.sort((left, right) => {
        const leftMargin = (left.ranked[0]?.score ?? 0) - (left.ranked[1]?.score ?? 0);
        const rightMargin = (right.ranked[0]?.score ?? 0) - (right.ranked[1]?.score ?? 0);
        return (
          (right.ranked[0]?.score ?? 0) - (left.ranked[0]?.score ?? 0) ||
          rightMargin - leftMargin ||
          left.addressIdValue.localeCompare(right.addressIdValue)
        );
      });
      const occupiedSingleAddressBuildings = new Set(linkedBuildingIds);
      for (const candidateGraph of orphanCandidates) {
        const { feature, addressIdValue: id } = candidateGraph;
        const ranked = candidateGraph.ranked.filter(({ building }) => {
          const idValue = featureId(building)?.toLowerCase();
          return Boolean(idValue && isBuildingAvailableForCivicAssignment(
            idValue,
            allowsMultipleAddresses(building),
            occupiedSingleAddressBuildings
          ));
        });
        const best = ranked[0];
        if (!best) continue;
        const buildingIdValue = featureId(best.building);
        if (!buildingIdValue) continue;
        const runnerUp = ranked[1]?.score ?? 0;
        const margin = best.score - runnerUp;
        const canApply = (
          best.score >= AUTO_LINK_SCORE &&
          margin >= AUTO_LINK_MARGIN &&
          satisfiesAutomaticLinkConstraints(best.evidence)
        );
        const beforeState = { link: null, address_id: id };
        decisions.push({
          id: decisionId(run.id, 'link_address', id, buildingIdValue),
          run_id: run.id,
          campaign_id: run.campaign_id,
          action: 'link_address',
          status: canApply ? 'proposed' : 'requires_review',
          address_id: id,
          building_id: buildingIdValue,
          secondary_building_id: null,
          unit_id: null,
          parent_building_id: null,
          unit_index: null,
          address_identity: addressIdentityFromFeature(feature),
          split_signature: null,
          evidence_codes: best.evidence,
          score: round(best.score),
          runner_up_margin: round(margin),
          precondition_hash: stableHash(beforeState),
          before_state: beforeState,
          proposed_state: {
            building_id: buildingIdValue,
            distance_meters: round(best.distance, 1),
          },
        });
        if (!allowsMultipleAddresses(best.building)) {
          occupiedSingleAddressBuildings.add(buildingIdValue.toLowerCase());
        }
      }

      for (const link of links) {
        const id = stringValue(link.address_id ?? link.addressId);
        const currentBuildingId = stringValue(link.building_id ?? link.buildingId);
        if (
          !id ||
          !currentBuildingId ||
          protectedState.addressIds.has(id.toLowerCase()) ||
          protectedState.buildingIds.has(currentBuildingId.toLowerCase())
        ) continue;
        const feature = addressById.get(id.toLowerCase());
        if (!feature) continue;
        const ranked = buildingsNearAddress(feature)
          .filter((building) => {
            const candidateBuildingId = featureId(building);
            if (!candidateBuildingId) return false;
            if (protectedState.buildingIds.has(candidateBuildingId.toLowerCase())) return false;
            return (
              candidateBuildingId.toLowerCase() === currentBuildingId.toLowerCase() ||
              isBuildingAvailableForCivicAssignment(
                candidateBuildingId,
                allowsMultipleAddresses(building),
                linkedBuildingIds
              )
            );
          })
          .map((building) => ({ building, ...scoreCandidate(feature, building) }))
          .filter((candidate) => candidate.score >= REVIEW_SCORE)
          .sort((left, right) => right.score - left.score || left.distance - right.distance);
        const best = ranked[0];
        const bestBuildingId = best ? featureId(best.building) : null;
        if (!best || !bestBuildingId || bestBuildingId.toLowerCase() === currentBuildingId.toLowerCase()) continue;
        const currentScore = ranked.find(({ building }) =>
          featureId(building)?.toLowerCase() === currentBuildingId.toLowerCase()
        )?.score ?? 0;
        const runnerUp = ranked[1]?.score ?? currentScore;
        const margin = best.score - runnerUp;
        const improvement = best.score - currentScore;
        if (
          best.score < AUTO_LINK_SCORE ||
          margin < AUTO_LINK_MARGIN ||
          improvement < AUTO_LINK_MARGIN ||
          !satisfiesAutomaticLinkConstraints(best.evidence)
        ) continue;
        const beforeState = {
          address_id: id,
          building_id: UUID_PATTERN.test(currentBuildingId) ? currentBuildingId : null,
          building_gers_id: currentBuildingId,
          link,
        };
        decisions.push({
          id: decisionId(run.id, 'reassign_address', id, bestBuildingId),
          run_id: run.id,
          campaign_id: run.campaign_id,
          action: 'reassign_address',
          status: 'proposed',
          address_id: id,
          building_id: bestBuildingId,
          secondary_building_id: currentBuildingId,
          unit_id: null,
          parent_building_id: null,
          unit_index: null,
          address_identity: addressIdentityFromFeature(feature),
          split_signature: null,
          evidence_codes: [...best.evidence, 'better_than_existing_link'],
          score: round(best.score),
          runner_up_margin: round(margin),
          precondition_hash: stableHash(beforeState),
          before_state: beforeState,
          proposed_state: {
            building_id: bestBuildingId,
            previous_building_id: currentBuildingId,
            distance_meters: round(best.distance, 1),
            score_improvement: round(improvement),
          },
        });
      }

      decisions.push(...this.duplicateBuildingDecisions({
        run,
        buildings,
        linkedBuildingIds,
        protectedBuildingIds: protectedState.buildingIds,
      }));

      await this.updateRun(run.id, 'geocoding', 'geocoding');
      report.unlinked_buildings_examined = buildings.filter((building) => {
        const id = featureId(building);
        return Boolean(
          id &&
          !linkedBuildingIds.has(id.toLowerCase()) &&
          !protectedState.buildingIds.has(id.toLowerCase()) &&
          (orphanBuildingIds.size === 0 || orphanBuildingIds.has(id.toLowerCase())) &&
          !isExplicitNonResidentialBuilding(building)
        );
      }).length;
      const reverseDecisions = await this.reverseGeocodeDecisions({
        run,
        buildings,
        addresses,
        linkedBuildingIds,
        linkedAddressIds,
        orphanBuildingIds,
        orphanAddressIds,
        protectedAddressIds: protectedState.addressIds,
        protectedBuildingIds: protectedState.buildingIds,
      });
      const reverseCorrectedAddressIds = new Set(reverseDecisions
        .filter((decision) =>
          decision.action === 'link_address' &&
          decision.proposed_state.move_source === true &&
          decision.address_id
        )
        .map((decision) => decision.address_id!.toLowerCase()));
      for (let index = decisions.length - 1; index >= 0; index -= 1) {
        const decision = decisions[index];
        if (
          decision.action === 'link_address' &&
          decision.address_id &&
          reverseCorrectedAddressIds.has(decision.address_id.toLowerCase())
        ) {
          decisions.splice(index, 1);
        }
      }
      decisions.push(...reverseDecisions);

      decisions.push(...this.labelAdjustmentDecisions({
        run,
        addresses: addressById,
        buildings: buildingById,
        links,
        linkDecisions: decisions.filter((decision) => decision.action === 'link_address'),
      }));

      if (decisions.length > 0) {
        const { error } = await this.supabase
          .from('map_reconciliation_decisions')
          .upsert(decisions, { onConflict: 'id' });
        if (error) throw new Error(`Failed to persist reconciliation decisions: ${error.message}`);
      }

      const reviewCount = decisions.filter((decision) => decision.status === 'requires_review').length;
      let appliedCount = 0;
      if (run.mode === 'apply_high_confidence') {
        await this.updateRun(run.id, 'applying', 'applying');
        for (const decision of decisions.filter((item) => item.status === 'proposed')) {
          if (await this.applyDecision(decision)) appliedCount += 1;
        }
        if (appliedCount > 0) {
          const currentAfterApply = await readCurrentCampaignMapBundle(this.supabase, run.campaign_id);
          const buildingCollection = currentAfterApply
            ? responseFromCampaignMapBundleRow(currentAfterApply).buildings
            : bundle.buildings;
          const polygonBuildings = asArray<TownhouseBuildingFeature>(asRecord(buildingCollection).features)
            .filter((feature) => feature.geometry?.type === 'Polygon');
          if (polygonBuildings.length > 0) {
            await new TownhouseSplitterService(this.supabase).processCampaignTownhouses(
              run.campaign_id,
              { features: polygonBuildings }
            );
          }
          const qualityService = new CampaignLinkQualityService(this.supabase);
          const quality = await qualityService.assessPersistedLinks(run.campaign_id);
          await qualityService.persist(run.campaign_id, quality);
          await new CampaignMapModeService(this.supabase).computeAndPersist(run.campaign_id);
        }
      }

      report.addresses_linked = decisions.filter((item) =>
        item.action === 'link_address' && (run.mode === 'shadow' || item.status === 'applied')
      ).length;
      report.links_reassigned = decisions.filter((item) => item.action === 'reassign_address').length;
      report.source_coordinates_corrected = decisions.filter((item) =>
        item.action === 'link_address' &&
        item.proposed_state.move_source === true &&
        (run.mode === 'shadow' || item.status === 'applied')
      ).length;
      report.label_anchors_adjusted = decisions.filter((item) =>
        item.action === 'adjust_label' && (run.mode === 'shadow' || item.status === 'applied')
      ).length;
      report.synthetic_addresses_created = decisions.filter((item) =>
        item.action === 'create_synthetic_address' && (run.mode === 'shadow' || item.status === 'applied')
      ).length;
      report.orphan_addresses_reused = reverseDecisions.filter((item) =>
        item.action === 'link_address' && (run.mode === 'shadow' || item.status === 'applied')
      ).length;
      report.provisional_addresses_created = reverseDecisions.filter((item) =>
        item.action === 'create_synthetic_address' &&
        (run.mode === 'shadow' || item.status === 'applied')
      ).length;
      report.reverse_geocodes_matched =
        report.orphan_addresses_reused + report.provisional_addresses_created;
      report.duplicate_buildings_hidden = decisions.filter((item) =>
        item.action === 'hide_duplicate' && (run.mode === 'shadow' || item.status === 'applied')
      ).length;
      report.auxiliary_buildings_hidden = decisions.filter((item) =>
        item.action === 'hide_auxiliary' && (run.mode === 'shadow' || item.status === 'applied')
      ).length;
      report.review_needed = reviewCount;
      report.address_orphans_after = Math.max(0, report.address_orphans_before - report.addresses_linked);
      report.building_orphans_after = Math.max(
        0,
        report.building_orphans_before -
          report.addresses_linked -
          report.synthetic_addresses_created -
          report.duplicate_buildings_hidden -
          report.auxiliary_buildings_hidden
      );
      report.unresolved_buildings = report.building_orphans_after;
      report.coverage_after = addresses.length > 0
        ? round(Math.min(addresses.length, links.length + report.addresses_linked + report.synthetic_addresses_created) / addresses.length * 100, 2)
        : 100;

      const completedAt = new Date().toISOString();
      await this.supabase
        .from('map_reconciliation_runs')
        .update({
          status: run.mode === 'apply_high_confidence' && reviewCount > 0 ? 'review_needed' : 'completed',
          phase: 'completed',
          after_metrics: {
            address_orphans: report.address_orphans_after,
            building_orphans: report.building_orphans_after,
            coverage_percent: report.coverage_after,
          },
          before_metrics: {
            address_orphans: report.address_orphans_before,
            building_orphans: report.building_orphans_before,
            coverage_percent: report.coverage_before,
          },
          report,
          lease_owner: null,
          lease_expires_at: null,
          completed_at: completedAt,
          updated_at: completedAt,
        })
        .eq('id', run.id);

      const rebuilt = await prebuildCampaignMapBundle(this.supabase, run.campaign_id);
      await this.supabase
        .from('map_reconciliation_runs')
        .update({
          applied_bundle_signature: stringValue(asRecord(rebuilt).asset_signature),
          updated_at: new Date().toISOString(),
        })
        .eq('id', run.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = Number(run.attempt_count ?? 1) >= 5;
      await this.supabase
        .from('map_reconciliation_runs')
        .update({
          status: exhausted ? 'failed' : 'queued',
          phase: exhausted ? 'failed' : 'retry_wait',
          error_message: message,
          lease_owner: null,
          lease_expires_at: null,
          completed_at: exhausted ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', run.id);
      throw error;
    }
  }

  private async updateRun(runId: string, status: string, phase: string): Promise<void> {
    const { error } = await this.supabase
      .from('map_reconciliation_runs')
      .update({
        status,
        phase,
        lease_expires_at: new Date(Date.now() + 240_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId);
    if (error) throw new Error(`Failed to update reconciliation run: ${error.message}`);
  }

  private async loadProtectedState(campaignId: string): Promise<{
    addressIds: Set<string>;
    buildingIds: Set<string>;
  }> {
    const [addressesResult, linksResult, touchesResult] = await Promise.all([
      this.supabase
        .from('campaign_addresses')
        .select('id, visited, match_source')
        .eq('campaign_id', campaignId),
      this.supabase
        .from('building_address_links')
        .select('address_id, building_id, match_type, user_confirmed, locked')
        .eq('campaign_id', campaignId),
      this.supabase
        .from('building_touches')
        .select('address_id, building_id')
        .eq('campaign_id', campaignId),
    ]);
    const addressIds = new Set<string>();
    const buildingIds = new Set<string>();
    for (const row of addressesResult.data ?? []) {
      const source = normalizeText(row.match_source);
      if (row.visited === true || source.includes('manual') || source === 'field_manual_pin') {
        addressIds.add(String(row.id).toLowerCase());
      }
    }
    for (const row of linksResult.data ?? []) {
      const manual = normalizeText(row.match_type).includes('manual') || row.user_confirmed === true || row.locked === true;
      if (!manual) continue;
      if (row.address_id) addressIds.add(String(row.address_id).toLowerCase());
      if (row.building_id) buildingIds.add(String(row.building_id).toLowerCase());
    }
    for (const row of touchesResult.data ?? []) {
      if (row.address_id) addressIds.add(String(row.address_id).toLowerCase());
      if (row.building_id) buildingIds.add(String(row.building_id).toLowerCase());
    }
    return { addressIds, buildingIds };
  }

  private async processGlobalReverseAssignment(input: {
    run: ReconciliationRunRow;
    addresses: BundleFeature[];
    buildings: BundleFeature[];
    sourceBuildings: GeoJSON.FeatureCollection;
    sourceParcels: GeoJSON.FeatureCollection;
    links: JsonRecord[];
    addressOrphans: JsonRecord[];
    buildingOrphans: JsonRecord[];
    report: MapReconciliationReport;
    protectedAddressIds: Set<string>;
    protectedBuildingIds: Set<string>;
  }): Promise<void> {
    const linkedAddressIds = new Set(input.links
      .map((link) => stringValue(link.address_id ?? link.addressId)?.toLowerCase())
      .filter((id): id is string => Boolean(id)));
    const linkedBuildingIds = new Set(input.links
      .map((link) => stringValue(link.building_id ?? link.buildingId)?.toLowerCase())
      .filter((id): id is string => Boolean(id)));
    const orphanAddressIds = new Set(input.addressOrphans
      .map((orphan) => stringValue(orphan.address_id)?.toLowerCase())
      .filter((id): id is string => Boolean(id)));
    const orphanBuildingIds = new Set(input.buildingOrphans
      .map((orphan) => stringValue(orphan.building_id ?? orphan.buildingId)?.toLowerCase())
      .filter((id): id is string => Boolean(id)));

    input.report.unlinked_buildings_examined = input.buildings.length;
    input.report.coverage_before = input.buildings.length > 0
      ? round(linkedBuildingIds.size / input.buildings.length * 100, 2)
      : 100;
    await this.updateRun(input.run.id, 'geocoding', 'geocoding');
    const decisions = await this.globalReverseGeocodeDecisions({
      run: input.run,
      buildings: input.buildings,
      addresses: input.addresses,
      linkedBuildingIds,
      linkedAddressIds,
      orphanBuildingIds,
      orphanAddressIds,
      protectedAddressIds: input.protectedAddressIds,
      protectedBuildingIds: input.protectedBuildingIds,
    });

    if (decisions.length > 0) {
      const { error } = await this.supabase
        .from('map_reconciliation_decisions')
        .upsert(decisions, { onConflict: 'id' });
      if (error) throw new Error(`Failed to persist reconciliation decisions: ${error.message}`);
    }

    let appliedCount = 0;
    if (input.run.mode === 'apply_high_confidence') {
      await this.updateRun(input.run.id, 'applying', 'applying');
      const globalAssignments = decisions.filter((decision) =>
        decision.status === 'proposed' &&
        (decision.action === 'link_address' || decision.action === 'reassign_address') &&
        decision.proposed_state.global_assignment === true
      );
      if (globalAssignments.length > 0) {
        appliedCount += await this.applyGlobalAssignmentBatch(input.run, globalAssignments);
      }
      for (const decision of decisions.filter((candidate) =>
        candidate.proposed_state.global_assignment !== true
      )) {
        if (decision.status === 'proposed' && await this.applyDecision(decision)) {
          appliedCount += 1;
        }
      }
      if (appliedCount > 0) {
        const qualityService = new CampaignLinkQualityService(this.supabase);
        const quality = await qualityService.assessPersistedLinks(input.run.campaign_id);
        await qualityService.persist(input.run.campaign_id, quality);
        await new CampaignMapModeService(this.supabase).computeAndPersist(input.run.campaign_id);
      }
    }

    const countsDecision = (decision: ReconciliationDecision) =>
      input.run.mode === 'shadow' || decision.status === 'applied';
    input.report.orphan_addresses_reused = decisions.filter((decision) =>
      decision.action === 'link_address' && countsDecision(decision)
    ).length;
    input.report.links_reassigned = decisions.filter((decision) =>
      decision.action === 'reassign_address' &&
      decision.proposed_state.assignment_unchanged !== true &&
      countsDecision(decision)
    ).length;
    input.report.provisional_addresses_created = decisions.filter((decision) =>
      decision.action === 'create_synthetic_address' && countsDecision(decision)
    ).length;
    input.report.source_coordinates_corrected = decisions.filter((decision) =>
      (decision.action === 'link_address' || decision.action === 'reassign_address') &&
      decision.proposed_state.move_source === true &&
      countsDecision(decision)
    ).length;
    input.report.review_needed = decisions.filter((decision) =>
      decision.status === 'requires_review'
    ).length;

    // Preserve the established additive report contract for older clients.
    input.report.addresses_linked = input.report.orphan_addresses_reused;
    input.report.synthetic_addresses_created = input.report.provisional_addresses_created;
    const resultingAddressCount = input.addresses.length + input.report.provisional_addresses_created;
    if (input.run.mode === 'apply_high_confidence') {
      const [linksAfter, addressOrphansAfter] = await Promise.all([
        this.supabase
          .from('building_address_links')
          .select('address_id, building_id')
          .eq('campaign_id', input.run.campaign_id)
          .eq('link_state', 'active'),
        this.supabase
          .from('address_orphans')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', input.run.campaign_id)
          .in('status', ['pending', 'pending_review', 'ambiguous_match']),
      ]);
      const linkedBuildingCount = new Set((linksAfter.data ?? [])
        .map((link) => stringValue(link.building_id)?.toLowerCase())
        .filter((id): id is string => Boolean(id))).size;
      input.report.address_orphans_after = addressOrphansAfter.count ?? Math.max(
        0,
        resultingAddressCount - (linksAfter.data?.length ?? 0)
      );
      input.report.building_orphans_after = Math.max(
        0,
        input.buildings.length - linkedBuildingCount
      );
      input.report.unresolved_buildings = input.report.building_orphans_after;
      input.report.reverse_geocodes_matched = Math.max(
        0,
        linkedBuildingCount - (input.buildings.length - input.report.building_orphans_before)
      ) + input.report.links_reassigned;
      input.report.coverage_after = input.buildings.length > 0
        ? round(linkedBuildingCount / input.buildings.length * 100, 2)
        : 100;
    } else {
      const proposedBuildingIds = new Set(decisions
        .filter((decision) => decision.status === 'proposed' && decision.building_id)
        .map((decision) => decision.building_id!.toLowerCase()));
      const projectedLinkedBuildingIds = new Set([
        ...linkedBuildingIds,
        ...proposedBuildingIds,
      ]);
      input.report.building_orphans_after = Math.max(
        0,
        input.buildings.length - projectedLinkedBuildingIds.size
      );
      input.report.unresolved_buildings = input.report.building_orphans_after;
      input.report.reverse_geocodes_matched = proposedBuildingIds.size;
      input.report.address_orphans_after = Math.max(
        0,
        input.report.address_orphans_before -
          input.report.orphan_addresses_reused +
          input.report.links_reassigned
      );
      input.report.coverage_after = input.buildings.length > 0
        ? round(projectedLinkedBuildingIds.size / input.buildings.length * 100, 2)
        : 100;
    }

    const completedAt = new Date().toISOString();
    await this.supabase
      .from('map_reconciliation_runs')
      .update({
        status: 'completed',
        phase: 'completed',
        after_metrics: {
          address_orphans: input.report.address_orphans_after,
          building_orphans: input.report.building_orphans_after,
          coverage_percent: input.report.coverage_after,
        },
        before_metrics: {
          address_orphans: input.report.address_orphans_before,
          building_orphans: input.report.building_orphans_before,
          coverage_percent: input.report.coverage_before,
        },
        report: input.report,
        error_message: null,
        lease_owner: null,
        lease_expires_at: null,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq('id', input.run.id);

    const rebuilt = await prebuildCampaignMapBundle(
      this.supabase,
      input.run.campaign_id,
      undefined,
      {
        forceRebuild: true,
        scopedGeometry: {
          buildings: input.sourceBuildings,
          parcels: input.sourceParcels,
        },
      }
    );
    await this.supabase
      .from('map_reconciliation_runs')
      .update({
        applied_bundle_signature: stringValue(asRecord(rebuilt).asset_signature),
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.run.id);
  }

  private duplicateBuildingDecisions(input: {
    run: ReconciliationRunRow;
    buildings: BundleFeature[];
    linkedBuildingIds: Set<string>;
    protectedBuildingIds: Set<string>;
  }): ReconciliationDecision[] {
    const decisions: ReconciliationDecision[] = [];
    const cells = new Map<string, BundleFeature[]>();
    const centerFor = (feature: BundleFeature): Point | null => {
      try {
        const center = turf.centroid(feature as GeoJSON.Feature).geometry.coordinates;
        return [center[0], center[1]];
      } catch {
        return null;
      }
    };
    for (const building of input.buildings) {
      const center = centerFor(building);
      if (!center) continue;
      const cellX = Math.floor(center[0] / 0.0005);
      const cellY = Math.floor(center[1] / 0.0005);
      for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
        for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
          const key = `${cellX + xOffset}:${cellY + yOffset}`;
          cells.set(key, [...(cells.get(key) ?? []), building]);
        }
      }
    }
    const seen = new Set<string>();
    for (const group of cells.values()) {
      for (let leftIndex = 0; leftIndex < group.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < group.length; rightIndex += 1) {
          const left = group[leftIndex];
          const right = group[rightIndex];
          const leftId = featureId(left);
          const rightId = featureId(right);
          if (!leftId || !rightId) continue;
          const pairKey = [leftId, rightId].sort().join('|').toLowerCase();
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          if (
            input.protectedBuildingIds.has(leftId.toLowerCase()) ||
            input.protectedBuildingIds.has(rightId.toLowerCase())
          ) continue;
          const leftParcel = parcelId(left);
          const rightParcel = parcelId(right);
          if (!leftParcel || !rightParcel || leftParcel !== rightParcel) continue;
          try {
            const leftArea = turf.area(left as GeoJSON.Feature);
            const rightArea = turf.area(right as GeoJSON.Feature);
            const intersection = turf.intersect(turf.featureCollection([
              left as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
              right as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>,
            ]));
            if (!intersection) continue;
            const intersectionArea = turf.area(intersection);
            const unionArea = leftArea + rightArea - intersectionArea;
            const iou = unionArea > 0 ? intersectionArea / unionArea : 0;
            const leftCenter = centerFor(left);
            const rightCenter = centerFor(right);
            if (!leftCenter || !rightCenter) continue;
            const centroidDistance = turf.distance(turf.point(leftCenter), turf.point(rightCenter), { units: 'meters' });
            if (!shouldAutoHideOverlappingDuplicate({
              polygonIou: iou,
              centroidDistanceMeters: centroidDistance,
              leftParcelId: leftParcel,
              rightParcelId: rightParcel,
              hasProtectedHistory:
                input.protectedBuildingIds.has(leftId.toLowerCase()) ||
                input.protectedBuildingIds.has(rightId.toLowerCase()),
            })) continue;
            const hidden = leftArea <= rightArea ? left : right;
            const canonical = hidden === left ? right : left;
            const hiddenId = featureId(hidden);
            const canonicalId = featureId(canonical);
            if (!hiddenId || !canonicalId) continue;
            // A linked smaller footprint could represent a legitimate unit. Keep
            // it for review instead of auto-hiding it.
            const auto = !input.linkedBuildingIds.has(hiddenId.toLowerCase());
            const beforeState = { resolution_status: 'active', building_id: hiddenId };
            decisions.push({
              id: decisionId(input.run.id, 'hide_duplicate', null, hiddenId),
              run_id: input.run.id,
              campaign_id: input.run.campaign_id,
              action: 'hide_duplicate',
              status: auto ? 'proposed' : 'requires_review',
              address_id: null,
              building_id: hiddenId,
              secondary_building_id: canonicalId,
              unit_id: null,
              parent_building_id: null,
              unit_index: null,
              address_identity: null,
              split_signature: null,
              evidence_codes: ['polygon_iou_90', 'centroid_3m', 'same_parcel'],
              score: round(Math.min(1, iou)),
              runner_up_margin: null,
              precondition_hash: stableHash(beforeState),
              before_state: beforeState,
              proposed_state: {
                resolution_status: 'hidden_duplicate',
                canonical_building_id: canonicalId,
                polygon_iou: round(iou),
                centroid_distance_m: round(centroidDistance, 1),
              },
            });
          } catch {
            // Invalid source polygons stay visible.
          }
        }
      }
    }
    return decisions;
  }

  private async globalReverseGeocodeDecisions(input: {
    run: ReconciliationRunRow;
    buildings: BundleFeature[];
    addresses: BundleFeature[];
    linkedBuildingIds: Set<string>;
    linkedAddressIds: Set<string>;
    orphanBuildingIds: Set<string>;
    orphanAddressIds: Set<string>;
    protectedAddressIds: Set<string>;
    protectedBuildingIds: Set<string>;
  }): Promise<ReconciliationDecision[]> {
    if (process.env.MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE !== 'true') return [];
    const maxGeocodes = Math.max(
      0,
      Math.min(500, Number(process.env.MAP_RECONCILIATION_MAX_GEOCODES_PER_RUN ?? 500))
    );
    if (maxGeocodes === 0) return [];

    const addressesById = new Map<string, BundleFeature>();
    const addressesByCivicIdentity = new Map<string, BundleFeature[]>();
    for (const address of input.addresses) {
      const id = addressId(address);
      if (!id) continue;
      addressesById.set(id.toLowerCase(), address);
      const identity = civicIdentityFromFeature(address);
      if (!identity.replaceAll('|', '')) continue;
      addressesByCivicIdentity.set(identity, [
        ...(addressesByCivicIdentity.get(identity) ?? []),
        address,
      ]);
    }

    const currentLinkByAddress = new Map<string, JsonRecord>();
    const currentAddressIdsByBuilding = new Map<string, string[]>();
    const currentLinks = asArray<JsonRecord>(
      (await readCurrentCampaignMapBundle(this.supabase, input.run.campaign_id))
        ?.links
    );
    // The source bundle is authoritative for this run. Falling back to the
    // current row above keeps direct method tests and retried workers safe.
    const linkRows: JsonRecord[] = currentLinks.length > 0
      ? currentLinks
      : ((await this.supabase
          .from('building_address_links')
          .select('address_id, building_id, match_type, confidence, user_confirmed, locked')
          .eq('campaign_id', input.run.campaign_id)).data ?? []) as JsonRecord[];
    for (const link of linkRows) {
      const addressIdValue = stringValue(link.address_id ?? link.addressId);
      const buildingIdValue = stringValue(link.building_id ?? link.buildingId);
      if (!addressIdValue || !buildingIdValue) continue;
      currentLinkByAddress.set(addressIdValue.toLowerCase(), link);
      currentAddressIdsByBuilding.set(buildingIdValue.toLowerCase(), [
        ...(currentAddressIdsByBuilding.get(buildingIdValue.toLowerCase()) ?? []),
        addressIdValue,
      ]);
    }

    const geocoded: Array<{
      building: BundleFeature;
      buildingId: string;
      anchor: Point;
      result: ReverseResult;
      spatialDistance: number;
      strong: boolean;
      multipleAddressesAllowed: boolean;
    }> = [];
    const orderedBuildings = input.buildings
      .filter((building) => !isExplicitNonResidentialBuilding(building))
      .sort((left, right) => (featureId(left) ?? '').localeCompare(featureId(right) ?? ''));
    for (const building of orderedBuildings.slice(0, maxGeocodes)) {
      const buildingIdValue = featureId(building);
      if (!buildingIdValue) continue;
      try {
        const anchor = turf.pointOnFeature(building as GeoJSON.Feature).geometry.coordinates as Point;
        const result = await this.reverseGeocode(anchor);
        if (!result || !result.houseNumber || !result.streetName) continue;
        const spatialDistance = pointToGeometryDistanceMeters(
          [result.longitude, result.latitude],
          building.geometry
        );
        if (!Number.isFinite(spatialDistance) || spatialDistance > 12) continue;
        geocoded.push({
          building,
          buildingId: buildingIdValue,
          anchor,
          result,
          spatialDistance,
          strong: result.accuracy === 'rooftop' || result.accuracy === 'parcel',
          multipleAddressesAllowed: buildingHasAuthoritativeMultiUnitMetadata(building),
        });
        if (geocoded.length === 1 || geocoded.length % 10 === 0) {
          await this.heartbeatRun(input.run.id, {
            phase: 'geocoding',
            building_index: geocoded.length,
            building_count: orderedBuildings.length,
          });
        }
      } catch {
        // Invalid geometry or a provider miss remains visible for review.
      }
    }

    const reverseIdentityCounts = new Map<string, number>();
    for (const item of geocoded) {
      reverseIdentityCounts.set(
        item.result.identity,
        (reverseIdentityCounts.get(item.result.identity) ?? 0) + 1
      );
    }

    const edges: GlobalAssignmentEdge[] = [];
    const edgeEvidence = new Map<string, {
      item: typeof geocoded[number];
      address: BundleFeature;
    }>();
    const reviewDecisions: ReconciliationDecision[] = [];
    const syntheticDecisions: ReconciliationDecision[] = [];

    for (const item of geocoded) {
      const buildingKey = item.buildingId.toLowerCase();
      const civicIdentity = normalizedCivicAddressIdentity({
        houseNumber: item.result.houseNumber,
        streetName: item.result.streetName,
      });
      const civicMatches = addressesByCivicIdentity.get(civicIdentity) ?? [];
      const contextMatches = civicMatches.filter((address) =>
        addressContextMatchesReverse(address, item.result)
      );
      const currentAddressIds = currentAddressIdsByBuilding.get(buildingKey) ?? [];
      const currentExactAddress = currentAddressIds.find((id) => {
        const address = addressesById.get(id.toLowerCase());
        return Boolean(
          address &&
          civicIdentityFromFeature(address) === civicIdentity &&
          addressContextMatchesReverse(address, item.result)
        );
      });

      if (
        input.protectedBuildingIds.has(buildingKey) ||
        (currentExactAddress && input.protectedAddressIds.has(currentExactAddress.toLowerCase()))
      ) {
        continue;
      }

      if (item.multipleAddressesAllowed) {
        const beforeState = {
          building_id: item.buildingId,
          current_address_ids: currentAddressIds,
        };
        reviewDecisions.push({
          id: decisionId(input.run.id, 'leave_unresolved', null, item.buildingId),
          run_id: input.run.id,
          campaign_id: input.run.campaign_id,
          action: 'leave_unresolved',
          status: 'requires_review',
          address_id: null,
          building_id: item.buildingId,
          secondary_building_id: null,
          unit_id: null,
          parent_building_id: null,
          unit_index: null,
          address_identity: item.result.identity,
          split_signature: null,
          evidence_codes: [
            'global_reverse_geocode',
            'authoritative_multi_unit_capacity',
            'multi_unit_review',
          ],
          score: REVIEW_SCORE,
          runner_up_margin: null,
          precondition_hash: stableHash(beforeState),
          before_state: beforeState,
          proposed_state: {
            formatted: item.result.formatted,
            accuracy: item.result.accuracy,
          },
        });
        continue;
      }

      if (!item.strong) {
        const beforeState = {
          building_id: item.buildingId,
          current_address_ids: currentAddressIds,
        };
        reviewDecisions.push({
          id: decisionId(input.run.id, 'leave_unresolved', null, item.buildingId),
          run_id: input.run.id,
          campaign_id: input.run.campaign_id,
          action: 'leave_unresolved',
          status: 'requires_review',
          address_id: null,
          building_id: item.buildingId,
          secondary_building_id: null,
          unit_id: null,
          parent_building_id: null,
          unit_index: null,
          address_identity: item.result.identity,
          split_signature: null,
          evidence_codes: [
            'global_reverse_geocode',
            `accuracy_${item.result.accuracy || 'unknown'}`,
            'weak_accuracy_review',
          ],
          score: REVIEW_SCORE,
          runner_up_margin: null,
          precondition_hash: stableHash(beforeState),
          before_state: beforeState,
          proposed_state: {
            formatted: item.result.formatted,
            accuracy: item.result.accuracy,
            spatial_distance_m: round(item.spatialDistance, 1),
          },
        });
        continue;
      }

      for (const address of contextMatches) {
        const addressIdValue = addressId(address);
        if (!addressIdValue || input.protectedAddressIds.has(addressIdValue.toLowerCase())) continue;
        const sourcePoint = featurePoint(address);
        const sourceDistance = sourcePoint
          ? pointToGeometryDistanceMeters(sourcePoint, item.building.geometry)
          : 100;
        const currentBuildingId = stringValue(
          currentLinkByAddress.get(addressIdValue.toLowerCase())?.building_id
        );
        const weight =
          100 +
          (currentBuildingId?.toLowerCase() === buildingKey ? 10 : 0) +
          Math.max(0, 100 - Math.min(sourceDistance, 100)) / 1_000;
        edges.push({
          buildingId: item.buildingId,
          addressId: addressIdValue,
          weight,
        });
        edgeEvidence.set(`${buildingKey}:${addressIdValue.toLowerCase()}`, { item, address });
      }

      if (
        contextMatches.length === 0 &&
        civicMatches.length === 0 &&
        reverseIdentityCounts.get(item.result.identity) === 1
      ) {
        const beforeState = {
          address_identity: item.result.identity,
          exists: false,
          current_address_ids: currentAddressIds,
        };
        syntheticDecisions.push({
          id: decisionId(input.run.id, 'create_synthetic_address', null, item.buildingId),
          run_id: input.run.id,
          campaign_id: input.run.campaign_id,
          action: 'create_synthetic_address',
          status: 'proposed',
          address_id: null,
          building_id: item.buildingId,
          secondary_building_id: null,
          unit_id: null,
          parent_building_id: null,
          unit_index: null,
          address_identity: item.result.identity,
          split_signature: null,
          evidence_codes: [
            'global_reverse_geocode',
            `accuracy_${item.result.accuracy}`,
            'unique_reverse_building_identity',
            'no_equivalent_campaign_address',
          ],
          score: SYNTHETIC_SCORE,
          runner_up_margin: SYNTHETIC_MARGIN,
          precondition_hash: stableHash(beforeState),
          before_state: beforeState,
          proposed_state: {
            formatted: item.result.formatted,
            house_number: item.result.houseNumber,
            street_name: item.result.streetName,
            locality: item.result.locality,
            region: item.result.region,
            postal_code: item.result.postalCode,
            country: item.result.country,
            longitude: item.anchor[0],
            latitude: item.anchor[1],
            accuracy: item.result.accuracy,
            spatial_distance_m: round(item.spatialDistance, 1),
            source: 'derived_reverse_geocode',
          },
        });
      }
    }

    const assignments = solveGlobalOneToOneAssignment(edges);
    const safeSyntheticDecisions = syntheticDecisions.filter((decision) => {
      const buildingIdValue = decision.building_id?.toLowerCase();
      const currentAddressIds = asArray<string>(decision.before_state.current_address_ids);
      return Boolean(
        buildingIdValue &&
        canCreateSyntheticAfterGlobalAssignment({
          targetBuildingId: buildingIdValue,
          currentAddressIds,
          assignments,
        })
      );
    });
    const assignmentDecisions = assignments.flatMap(({ buildingId, addressId: addressIdValue }) => {
      const evidence = edgeEvidence.get(`${buildingId.toLowerCase()}:${addressIdValue.toLowerCase()}`);
      if (!evidence) return [];
      const currentLink = currentLinkByAddress.get(addressIdValue.toLowerCase());
      const currentBuildingId = stringValue(currentLink?.building_id ?? currentLink?.buildingId);
      const assignmentUnchanged =
        currentBuildingId?.toLowerCase() === buildingId.toLowerCase();
      const action: DecisionAction = currentBuildingId ? 'reassign_address' : 'link_address';
      const candidateProperties = asRecord(evidence.address.properties);
      const candidatePostal = normalizeText(
        candidateProperties.postal_code ??
        candidateProperties.postalCode ??
        candidateProperties.zip
      ).replaceAll(' ', '');
      const reversePostal = normalizeText(evidence.item.result.postalCode).replaceAll(' ', '');
      const beforeState = currentBuildingId
        ? {
            address_id: addressIdValue,
            building_id: UUID_PATTERN.test(currentBuildingId) ? currentBuildingId : null,
            building_gers_id: currentBuildingId,
            link: currentLink,
          }
        : { link: null, address_id: addressIdValue };
      return [{
        id: decisionId(input.run.id, action, addressIdValue, buildingId),
        run_id: input.run.id,
        campaign_id: input.run.campaign_id,
        action,
        status: 'proposed' as const,
        address_id: addressIdValue,
        building_id: buildingId,
        secondary_building_id: currentBuildingId,
        unit_id: null,
        parent_building_id: null,
        unit_index: null,
        address_identity: evidence.item.result.identity,
        split_signature: null,
        evidence_codes: [
          'global_reverse_geocode',
          `accuracy_${evidence.item.result.accuracy}`,
          'normalized_civic_identity',
          'candidate_context_match',
          candidatePostal && reversePostal
            ? 'candidate_postal_match'
            : 'candidate_postal_unavailable',
          'global_one_to_one',
          'building_capacity_one',
          ...(assignmentUnchanged ? ['existing_link_confirmed'] : []),
        ],
        score: 0.995,
        runner_up_margin: SYNTHETIC_MARGIN,
        precondition_hash: stableHash(beforeState),
        before_state: beforeState,
        proposed_state: {
          building_id: buildingId,
          previous_building_id: currentBuildingId,
          move_source: true,
          source_longitude: evidence.item.anchor[0],
          source_latitude: evidence.item.anchor[1],
          accuracy: evidence.item.result.accuracy,
          spatial_distance_m: round(evidence.item.spatialDistance, 1),
          source: 'reconciliation_reverse_geocode',
          global_assignment: true,
          assignment_unchanged: assignmentUnchanged,
        },
      } satisfies ReconciliationDecision];
    });

    return [
      ...assignmentDecisions,
      ...safeSyntheticDecisions,
      ...reviewDecisions,
    ];
  }

  private async reverseGeocodeDecisions(input: {
    run: ReconciliationRunRow;
    buildings: BundleFeature[];
    addresses: BundleFeature[];
    linkedBuildingIds: Set<string>;
    linkedAddressIds: Set<string>;
    orphanBuildingIds: Set<string>;
    orphanAddressIds: Set<string>;
    protectedAddressIds: Set<string>;
    protectedBuildingIds: Set<string>;
  }): Promise<ReconciliationDecision[]> {
    if (process.env.MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE !== 'true') return [];
    const maxGeocodes = Math.max(0, Math.min(500, Number(process.env.MAP_RECONCILIATION_MAX_GEOCODES_PER_RUN ?? 100)));
    if (maxGeocodes === 0) return [];
    const allAddressesByIdentity = new Map<string, BundleFeature[]>();
    const orphanAddressesByIdentity = new Map<string, BundleFeature[]>();
    for (const feature of input.addresses) {
      const id = addressId(feature);
      const identity = civicIdentityFromFeature(feature);
      if (!id || !identity.replaceAll('|', '')) continue;
      allAddressesByIdentity.set(identity, [
        ...(allAddressesByIdentity.get(identity) ?? []),
        feature,
      ]);
      if (
        input.linkedAddressIds.has(id.toLowerCase()) ||
        input.protectedAddressIds.has(id.toLowerCase()) ||
        (input.orphanAddressIds.size > 0 && !input.orphanAddressIds.has(id.toLowerCase()))
      ) continue;
      orphanAddressesByIdentity.set(identity, [
        ...(orphanAddressesByIdentity.get(identity) ?? []),
        feature,
      ]);
    }
    const campaignLocalities = new Set(input.addresses
      .map((feature) => normalizeText(asRecord(feature.properties).locality))
      .filter(Boolean));
    const campaignRegions = new Set(input.addresses
      .map((feature) => {
        const properties = asRecord(feature.properties);
        return normalizedRegion(
          properties.region ?? properties.province ?? properties.state
        );
      })
      .filter(Boolean));
    const campaignPostals = new Set(input.addresses
      .map((feature) => normalizeText(asRecord(feature.properties).postal_code).replaceAll(' ', ''))
      .filter(Boolean));
    const candidates: Array<{
      building: BundleFeature;
      result: ReverseResult;
      spatialDistance: number;
      buildingAnchor: Point;
      localityMatches: boolean;
      regionMatches: boolean;
      postalMatches: boolean;
    }> = [];
    let geocodeCursor = 0;
    const orphanAddressPoints = input.addresses.flatMap((feature): Point[] => {
      const id = addressId(feature);
      const point = id && input.orphanAddressIds.has(id.toLowerCase())
        ? featurePoint(feature)
        : null;
      return point ? [point] : [];
    });
    const eligibleBuildings = input.buildings
      .filter((building) => {
        const id = featureId(building);
        return Boolean(
          id &&
          !input.linkedBuildingIds.has(id.toLowerCase()) &&
          !input.protectedBuildingIds.has(id.toLowerCase()) &&
          (input.orphanBuildingIds.size === 0 || input.orphanBuildingIds.has(id.toLowerCase())) &&
          !isExplicitNonResidentialBuilding(building)
        );
      })
      .map((building) => ({
        building,
        orphanDistance: orphanAddressPoints.reduce((minimum, point) =>
          Math.min(minimum, pointToGeometryDistanceMeters(point, building.geometry)),
        Number.POSITIVE_INFINITY),
      }))
      .sort((left, right) => left.orphanDistance - right.orphanDistance);
    for (const { building } of eligibleBuildings) {
      const id = featureId(building);
      if (!id) continue;
      if (geocodeCursor >= maxGeocodes) break;
      geocodeCursor += 1;
      if (geocodeCursor === 1 || geocodeCursor % 10 === 0) {
        await this.heartbeatRun(input.run.id, {
          phase: 'geocoding',
          building_index: geocodeCursor,
          candidate_count: candidates.length,
        });
      }
      try {
        const buildingAnchor = turf.pointOnFeature(building as GeoJSON.Feature).geometry.coordinates as Point;
        const result = await this.reverseGeocode(buildingAnchor);
        if (!result) continue;
        const spatialDistance = pointToGeometryDistanceMeters(
          [result.longitude, result.latitude],
          building.geometry
        );
        const regionMatches = campaignRegions.size === 0 ||
          (Boolean(result.region) && campaignRegions.has(normalizedRegion(result.region)));
        const normalizedResultPostal = normalizeText(result.postalCode).replaceAll(' ', '');
        const postalMatches = campaignPostals.size === 0 ||
          (Boolean(normalizedResultPostal) && campaignPostals.has(normalizedResultPostal));
        const localityMatches = campaignLocalities.size === 0 ||
          (Boolean(result.locality) && campaignLocalities.has(normalizeText(result.locality))) ||
          (
            regionMatches &&
            Boolean(normalizedResultPostal) &&
            campaignPostals.has(normalizedResultPostal)
          );
        if (
          !Number.isFinite(spatialDistance) ||
          spatialDistance > 12 ||
          !localityMatches ||
          !regionMatches ||
          !postalMatches
        ) continue;
        candidates.push({
          building,
          result,
          spatialDistance,
          buildingAnchor,
          localityMatches,
          regionMatches,
          postalMatches,
        });
      } catch {
        // Invalid source geometry remains unresolved.
      }
    }
    const identityCounts = new Map<string, number>();
    for (const candidate of candidates) {
      identityCounts.set(candidate.result.identity, (identityCounts.get(candidate.result.identity) ?? 0) + 1);
    }
    const decisionForCandidate = (
      candidate: typeof candidates[number],
      uniqueBuildingIdentity: boolean
    ): ReconciliationDecision | null => {
      const { building, result, spatialDistance, buildingAnchor } = candidate;
      const buildingIdValue = featureId(building);
      if (!buildingIdValue || !result.houseNumber || !result.streetName) return null;
      const reverseCivicIdentity = normalizedCivicAddressIdentity({
        houseNumber: result.houseNumber,
        streetName: result.streetName,
      });
      const orphanIdentityMatches = (
        orphanAddressesByIdentity.get(reverseCivicIdentity) ?? []
      ).filter((feature) => addressContextMatchesReverse(feature, result));
      const allIdentityMatches = (
        allAddressesByIdentity.get(reverseCivicIdentity) ?? []
      ).filter((feature) => addressContextMatchesReverse(feature, result));
      const existingAddress = orphanIdentityMatches.length === 1 ? orphanIdentityMatches[0] : null;
      const existingAddressId = existingAddress ? addressId(existingAddress) : null;
      const sourcePoint = existingAddress ? featurePoint(existingAddress) : null;
      if (existingAddress && existingAddressId) {
        const addressContext = reverseAddressContextCompatibility(existingAddress, result);
        const assessment = assessReverseOrphanCorrection({
          accuracy: result.accuracy,
          reversePointDistanceMeters: spatialDistance,
          sourcePointDistanceMeters: sourcePoint
            ? pointToGeometryDistanceMeters(sourcePoint, building.geometry)
            : Number.POSITIVE_INFINITY,
          addressIdentityMatches:
            civicIdentityFromFeature(existingAddress) === reverseCivicIdentity &&
            addressContextMatchesReverse(existingAddress, result),
          uniqueAddressIdentity: orphanIdentityMatches.length === 1,
          uniqueBuildingIdentity,
          addressIsOrphan: input.orphanAddressIds.has(existingAddressId.toLowerCase()),
          buildingIsOrphan: input.orphanBuildingIds.has(buildingIdValue.toLowerCase()),
          localityMatches: addressContext.localityMatches,
          regionMatches: addressContext.regionMatches,
          postalMatches: addressContext.postalMatches,
          protectedHistory:
            input.protectedAddressIds.has(existingAddressId.toLowerCase()) ||
            input.protectedBuildingIds.has(buildingIdValue.toLowerCase()),
          explicitNonResidentialType: isExplicitNonResidentialBuilding(building),
        });
        if (!assessment.eligible) return null;
        const beforeState = {
          link: null,
          address_id: existingAddressId,
          building_id: null,
          building_gers_id: null,
          match_source: stringValue(asRecord(existingAddress.properties).match_source),
          confidence: numberValue(asRecord(existingAddress.properties).confidence),
          source_point: sourcePoint,
          source_coordinate: asRecord(existingAddress.properties).coordinate ?? null,
        };
        return {
          id: decisionId(input.run.id, 'link_address', existingAddressId, buildingIdValue),
          run_id: input.run.id,
          campaign_id: input.run.campaign_id,
          action: 'link_address',
          status: 'proposed',
          address_id: existingAddressId,
          building_id: buildingIdValue,
          secondary_building_id: null,
          unit_id: null,
          parent_building_id: null,
          unit_index: null,
          address_identity: result.identity,
          split_signature: null,
          evidence_codes: assessment.evidenceCodes,
          score: assessment.score,
          runner_up_margin: SYNTHETIC_MARGIN,
          precondition_hash: stableHash(beforeState),
          before_state: beforeState,
          proposed_state: {
            building_id: buildingIdValue,
            distance_meters: 0,
            move_source: assessment.moveSource,
            source_longitude: buildingAnchor[0],
            source_latitude: buildingAnchor[1],
            reverse_longitude: result.longitude,
            reverse_latitude: result.latitude,
            reverse_cache_key: result.cacheKey,
            accuracy: result.accuracy,
            spatial_distance_m: round(spatialDistance, 1),
            source: 'reconciliation_reverse_geocode',
          },
        };
      }

      const strongAccuracy = result.accuracy === 'rooftop' || result.accuracy === 'parcel';
      if (
        allIdentityMatches.length > 0 ||
        !uniqueBuildingIdentity ||
        !strongAccuracy ||
        isExplicitNonResidentialBuilding(building)
      ) return null;
      const beforeState = { address_identity: result.identity, exists: false };
      return {
        id: decisionId(input.run.id, 'create_synthetic_address', null, buildingIdValue),
        run_id: input.run.id,
        campaign_id: input.run.campaign_id,
        action: 'create_synthetic_address',
        status: 'proposed',
        address_id: null,
        building_id: buildingIdValue,
        secondary_building_id: null,
        unit_id: null,
        parent_building_id: null,
        unit_index: null,
        address_identity: result.identity,
        split_signature: null,
        evidence_codes: [
          'reverse_address_complete',
          `accuracy_${result.accuracy}`,
          'unique_reverse_building_identity',
          'campaign_context_match',
          'orphan_building',
          'no_equivalent_campaign_address',
        ],
        score: SYNTHETIC_SCORE,
        runner_up_margin: SYNTHETIC_MARGIN,
        precondition_hash: stableHash(beforeState),
        before_state: beforeState,
        proposed_state: {
          formatted: result.formatted,
          house_number: result.houseNumber,
          street_name: result.streetName,
          locality: result.locality,
          region: result.region,
          postal_code: result.postalCode,
          country: result.country,
          longitude: buildingAnchor[0],
          latitude: buildingAnchor[1],
          reverse_longitude: result.longitude,
          reverse_latitude: result.latitude,
          reverse_cache_key: result.cacheKey,
          accuracy: result.accuracy,
          spatial_distance_m: round(spatialDistance, 1),
          source: 'derived_reverse_geocode',
        },
      };
    };
    const addressDecisions: ReconciliationDecision[] = candidates.flatMap((candidate) => {
      if (identityCounts.get(candidate.result.identity) !== 1) return [];
      const decision = decisionForCandidate(candidate, true);
      return decision ? [decision] : [];
    });
    const auxiliaryDecisions: ReconciliationDecision[] = [];
    const candidatesByIdentity = new Map<string, typeof candidates>();
    for (const candidate of candidates) {
      candidatesByIdentity.set(candidate.result.identity, [
        ...(candidatesByIdentity.get(candidate.result.identity) ?? []),
        candidate,
      ]);
    }
    for (const group of candidatesByIdentity.values()) {
      if (group.length < 2) continue;
      const rankedByArea = [...group].sort((left, right) =>
        turf.area(right.building as GeoJSON.Feature) - turf.area(left.building as GeoJSON.Feature)
      );
      const primary = rankedByArea[0];
      const primaryId = featureId(primary.building);
      const primaryArea = turf.area(primary.building as GeoJSON.Feature);
      if (!primaryId || primaryArea <= 0) continue;
      for (const possibleAuxiliary of rankedByArea.slice(1)) {
        const auxiliaryId = featureId(possibleAuxiliary.building);
        if (!auxiliaryId) continue;
        const properties = asRecord(possibleAuxiliary.building.properties);
        const type = normalizeText(
          properties.subtype ??
          properties.building_type ??
          properties.class ??
          properties.type
        );
        const explicitNonResidential = [
          'garage', 'shed', 'outbuilding', 'carport', 'barn', 'storage', 'utility',
        ].some((candidate) => type.includes(candidate));
        const auxiliaryArea = turf.area(possibleAuxiliary.building as GeoJSON.Feature);
        const sameParcel = Boolean(
          parcelId(primary.building) &&
          parcelId(possibleAuxiliary.building) &&
          parcelId(primary.building) === parcelId(possibleAuxiliary.building)
        );
        let centroidDistance = Number.POSITIVE_INFINITY;
        try {
          centroidDistance = turf.distance(
            turf.centroid(primary.building as GeoJSON.Feature),
            turf.centroid(possibleAuxiliary.building as GeoJSON.Feature),
            { units: 'meters' }
          );
        } catch {
          continue;
        }
        const inferredOutbuilding = (
          sameParcel &&
          auxiliaryArea <= 30 &&
          auxiliaryArea <= primaryArea * 0.25 &&
          centroidDistance >= 3 &&
          centroidDistance <= 60
        );
        if (!shouldAutoHideAuxiliary({
          explicitNonResidentialType: explicitNonResidential,
          areaSquareMeters: auxiliaryArea,
          primaryAreaSquareMeters: primaryArea,
          hasUniqueAddressOrHistory:
            input.linkedBuildingIds.has(auxiliaryId.toLowerCase()) ||
            input.protectedBuildingIds.has(auxiliaryId.toLowerCase()),
          duplicateReverseIdentity: true,
          outbuildingPlacement: inferredOutbuilding,
        })) continue;
        const beforeState = { resolution_status: 'active', building_id: auxiliaryId };
        auxiliaryDecisions.push({
          id: decisionId(input.run.id, 'hide_auxiliary', null, auxiliaryId),
          run_id: input.run.id,
          campaign_id: input.run.campaign_id,
          action: 'hide_auxiliary',
          status: 'proposed',
          address_id: null,
          building_id: auxiliaryId,
          secondary_building_id: primaryId,
          unit_id: null,
          parent_building_id: null,
          unit_index: null,
          address_identity: possibleAuxiliary.result.identity,
          split_signature: null,
          evidence_codes: [
            'duplicate_reverse_identity',
            ...(sameParcel ? ['same_parcel'] : []),
            ...(explicitNonResidential
              ? ['explicit_non_residential_type']
              : ['area_30m2', 'area_25_percent', 'outbuilding_placement']),
          ],
          score: explicitNonResidential ? 0.99 : 0.97,
          runner_up_margin: SYNTHETIC_MARGIN,
          precondition_hash: stableHash(beforeState),
          before_state: beforeState,
          proposed_state: {
            resolution_status: 'hidden_auxiliary',
            canonical_building_id: primaryId,
            area_m2: round(auxiliaryArea, 1),
            primary_area_m2: round(primaryArea, 1),
            centroid_distance_m: round(centroidDistance, 1),
          },
        });
      }
      const proposedAuxiliaryIds = new Set(
        auxiliaryDecisions
          .filter((decision) => decision.address_identity === group[0]?.result.identity)
          .map((decision) => decision.building_id?.toLowerCase())
          .filter((id): id is string => Boolean(id))
      );
      const survivingPrimaryCandidates = group.filter((candidate) => {
        const id = featureId(candidate.building)?.toLowerCase();
        return Boolean(id && !proposedAuxiliaryIds.has(id));
      });
      if (proposedAuxiliaryIds.size > 0 && survivingPrimaryCandidates.length === 1) {
        const survivor = survivingPrimaryCandidates[0];
        const decision = decisionForCandidate(survivor, true);
        if (decision) {
          decision.evidence_codes = [
            ...decision.evidence_codes,
            'unique_primary_after_auxiliary_resolution',
          ];
          addressDecisions.push(decision);
        }
        continue;
      }
      for (const ambiguous of group) {
        const ambiguousBuildingId = featureId(ambiguous.building);
        if (!ambiguousBuildingId || proposedAuxiliaryIds.has(ambiguousBuildingId.toLowerCase())) continue;
        const beforeState = {
          building_id: ambiguousBuildingId,
          resolution_status: 'active',
        };
        auxiliaryDecisions.push({
          id: decisionId(input.run.id, 'leave_unresolved', null, ambiguousBuildingId),
          run_id: input.run.id,
          campaign_id: input.run.campaign_id,
          action: 'leave_unresolved',
          status: 'requires_review',
          address_id: null,
          building_id: ambiguousBuildingId,
          secondary_building_id: null,
          unit_id: null,
          parent_building_id: null,
          unit_index: null,
          address_identity: ambiguous.result.identity,
          split_signature: null,
          evidence_codes: ['duplicate_reverse_identity', 'multiple_legitimate_buildings_possible'],
          score: REVIEW_SCORE,
          runner_up_margin: 0,
          precondition_hash: stableHash(beforeState),
          before_state: beforeState,
          proposed_state: { resolution_status: 'active', review_only: true },
        });
      }
    }
    // V6 deliberately does not classify or hide buildings. When more than one
    // building resolves to the same civic address, leave the whole group
    // untouched instead of guessing which footprint is primary.
    return addressDecisions;
  }

  private async heartbeatRun(runId: string, cursor: JsonRecord): Promise<void> {
    const { error } = await this.supabase
      .from('map_reconciliation_runs')
      .update({
        cursor,
        lease_expires_at: new Date(Date.now() + 240_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId);
    if (error) throw new Error(`Failed to renew reconciliation lease: ${error.message}`);
  }

  private async reverseGeocode(point: Point): Promise<ReverseResult | null> {
    const roundedLon = round(point[0], 6);
    const roundedLat = round(point[1], 6);
    const storageMode = configuredReverseGeocodingStorageMode();
    const permanent = storageMode === 'permanent';
    const cacheKey = stableHash({
      provider: REVERSE_PROVIDER_VERSION,
      longitude: roundedLon,
      latitude: roundedLat,
      permanent,
    });
    if (!permanent && this.temporaryReverseResults.has(cacheKey)) {
      return this.temporaryReverseResults.get(cacheKey) ?? null;
    }
    if (permanent) {
      const cached = await this.supabase
        .from('reverse_geocode_cache')
        .select('response')
        .eq('cache_key', cacheKey)
        .maybeSingle();
      if (cached.data?.response) {
        return this.parseReverseResult(cacheKey, asRecord(cached.data.response));
      }
    }

    const token = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) return null;
    const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
    url.searchParams.set('longitude', String(roundedLon));
    url.searchParams.set('latitude', String(roundedLat));
    url.searchParams.set('types', 'address');
    url.searchParams.set('limit', '1');
    url.searchParams.set('permanent', permanent ? 'true' : 'false');
    url.searchParams.set('access_token', token);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Mapbox reverse geocode failed: ${response.status}`);
    const payload = await response.json() as JsonRecord;
    const parsed = this.parseReverseResult(cacheKey, payload);
    if (!permanent) {
      this.temporaryReverseResults.set(cacheKey, parsed);
      return parsed;
    }
    if (!parsed) return null;
    await this.supabase.from('reverse_geocode_cache').upsert({
      cache_key: cacheKey,
      provider: 'mapbox',
      provider_version: REVERSE_PROVIDER_VERSION,
      longitude: roundedLon,
      latitude: roundedLat,
      response: payload,
      normalized_identity: parsed.identity,
      accuracy: parsed.accuracy,
      permanent_storage: true,
    }, { onConflict: 'cache_key' });
    return parsed;
  }

  private parseReverseResult(cacheKey: string, payload: JsonRecord): ReverseResult | null {
    return parseMapboxReverseResult(cacheKey, payload);
  }

  private labelAdjustmentDecisions(input: {
    run: ReconciliationRunRow;
    addresses: Map<string, BundleFeature>;
    buildings: Map<string, BundleFeature>;
    links: JsonRecord[];
    linkDecisions: ReconciliationDecision[];
  }): ReconciliationDecision[] {
    const addressIdsByBuilding = new Map<string, Set<string>>();
    const add = (buildingIdValue: string, addressIdValue: string) => {
      const key = buildingIdValue.toLowerCase();
      const group = addressIdsByBuilding.get(key) ?? new Set<string>();
      group.add(addressIdValue.toLowerCase());
      addressIdsByBuilding.set(key, group);
    };
    for (const link of input.links) {
      const building = stringValue(link.building_id ?? link.buildingId);
      const address = stringValue(link.address_id ?? link.addressId);
      if (building && address) add(building, address);
    }
    for (const decision of input.linkDecisions) {
      if (decision.building_id && decision.address_id && decision.status === 'proposed') {
        add(decision.building_id, decision.address_id);
      }
    }
    const decisions: ReconciliationDecision[] = [];
    for (const [buildingKey, addressIds] of addressIdsByBuilding) {
      if (addressIds.size < 2) continue;
      const building = input.buildings.get(buildingKey);
      if (!building) continue;
      let center: Point;
      try {
        center = turf.pointOnFeature(building as GeoJSON.Feature).geometry.coordinates as Point;
      } catch {
        continue;
      }
      const sortedIds = [...addressIds].sort((left, right) => {
        const leftFeature = input.addresses.get(left);
        const rightFeature = input.addresses.get(right);
        const leftIdentity = leftFeature ? addressIdentityFromFeature(leftFeature) : left;
        const rightIdentity = rightFeature ? addressIdentityFromFeature(rightFeature) : right;
        return leftIdentity.localeCompare(rightIdentity);
      });
      sortedIds.forEach((id, index) => {
        const angle = -Math.PI / 2 + index * (2 * Math.PI / sortedIds.length);
        const radiusMeters = 3 + Math.floor(index / 8) * 2;
        const latDelta = Math.sin(angle) * radiusMeters / 111_320;
        const lonScale = Math.max(0.1, Math.cos(center[1] * Math.PI / 180));
        const lonDelta = Math.cos(angle) * radiusMeters / (111_320 * lonScale);
        const anchor = [center[0] + lonDelta, center[1] + latDelta] as Point;
        const beforeState = { adjustment: null, address_id: id };
        decisions.push({
          id: decisionId(input.run.id, 'adjust_label', id, buildingKey),
          run_id: input.run.id,
          campaign_id: input.run.campaign_id,
          action: 'adjust_label',
          status: 'proposed',
          address_id: id,
          building_id: buildingKey,
          secondary_building_id: null,
          unit_id: null,
          parent_building_id: null,
          unit_index: null,
          address_identity: input.addresses.get(id) ? addressIdentityFromFeature(input.addresses.get(id)!) : null,
          split_signature: null,
          evidence_codes: ['multi_address_building', 'deterministic_label_layout'],
          score: 1,
          runner_up_margin: 1,
          precondition_hash: stableHash(beforeState),
          before_state: beforeState,
          proposed_state: {
            label_anchor_lon: anchor[0],
            label_anchor_lat: anchor[1],
          },
        });
      });
    }
    return decisions;
  }

  private async applyGlobalAssignmentBatch(
    run: ReconciliationRunRow,
    decisions: ReconciliationDecision[]
  ): Promise<number> {
    const assignments = decisions.flatMap((decision) =>
      decision.address_id && decision.building_id
        ? [{
            decision_id: decision.id,
            address_id: decision.address_id,
            building_id: decision.building_id,
            score: decision.score,
            evidence_codes: decision.evidence_codes,
            source_longitude: numberValue(decision.proposed_state.source_longitude),
            source_latitude: numberValue(decision.proposed_state.source_latitude),
          }]
        : []
    );
    if (assignments.length === 0) return 0;
    const { data, error } = await this.supabase.rpc('apply_global_reverse_assignment', {
      p_campaign_id: run.campaign_id,
      p_run_id: run.id,
      p_assignments: assignments,
      p_algorithm_version: MAP_RECONCILIATION_ALGORITHM_VERSION,
    });
    if (error) {
      throw new Error(`Failed to apply global reverse assignment: ${error.message}`);
    }
    const applied = Math.max(0, Number(data ?? 0));
    for (const decision of decisions) {
      decision.status = applied > 0 ? 'applied' : 'stale';
    }
    return applied;
  }

  private async applyDecision(decision: ReconciliationDecision): Promise<boolean> {
    if (decision.status !== 'proposed') return false;
    if (!await this.preconditionsStillMatch(decision)) {
      await this.markDecision(decision.id, 'stale', 'Decision preconditions changed before apply');
      decision.status = 'stale';
      return false;
    }
    if (
      (decision.action === 'link_address' || decision.action === 'reassign_address') &&
      decision.address_id &&
      decision.building_id
    ) {
      const protectedState = await this.loadProtectedState(decision.campaign_id);
      if (protectedState.addressIds.has(decision.address_id.toLowerCase())) {
        await this.markDecision(decision.id, 'stale', 'Protected field state changed before apply');
        return false;
      }
      const proposed = decision.proposed_state;
      if (decision.action === 'link_address' && proposed.move_source === true) {
        const sourcePoint = asArray<number>(decision.before_state.source_point);
        const expectedLongitude = numberValue(sourcePoint[0]);
        const expectedLatitude = numberValue(sourcePoint[1]);
        const sourceLongitude = numberValue(proposed.source_longitude);
        const sourceLatitude = numberValue(proposed.source_latitude);
        const accuracy = stringValue(proposed.accuracy);
        if (
          sourcePoint.length < 2 ||
          expectedLongitude === null ||
          expectedLatitude === null ||
          sourceLongitude === null ||
          sourceLatitude === null ||
          !accuracy ||
          !['rooftop', 'parcel'].includes(accuracy)
        ) {
          await this.markDecision(decision.id, 'stale', 'Reverse-geocode correction coordinates are incomplete');
          return false;
        }
        const correction = await this.supabase.rpc('apply_reverse_geocode_orphan_correction', {
          p_campaign_id: decision.campaign_id,
          p_address_id: decision.address_id,
          p_building_id: decision.building_id,
          p_decision_id: decision.id,
          p_expected_lon: expectedLongitude,
          p_expected_lat: expectedLatitude,
          p_corrected_lon: sourceLongitude,
          p_corrected_lat: sourceLatitude,
          p_provider: 'mapbox',
          p_accuracy: accuracy,
          p_reverse_cache_key: stringValue(proposed.reverse_cache_key),
          p_score: decision.score,
          p_evidence_codes: decision.evidence_codes,
          p_algorithm_version: MAP_RECONCILIATION_ALGORITHM_VERSION,
        });
        if (correction.error) {
          throw new Error(`Failed to apply reverse-geocode source correction: ${correction.error.message}`);
        }
        if (correction.data !== true) {
          await this.markDecision(decision.id, 'stale', 'Reverse-geocode correction preconditions changed');
          decision.status = 'stale';
          return false;
        }
        decision.status = 'applied';
        return true;
      }
      const orphanSnapshot = await this.supabase
        .from('address_orphans')
        .select('*')
        .eq('campaign_id', decision.campaign_id)
        .eq('address_id', decision.address_id)
        .maybeSingle();
      if (orphanSnapshot.error) {
        throw new Error(`Failed to snapshot address orphan: ${orphanSnapshot.error.message}`);
      }
      if (orphanSnapshot.data) {
        decision.before_state = {
          ...decision.before_state,
          address_orphan: orphanSnapshot.data,
        };
        const snapshotUpdate = await this.supabase
          .from('map_reconciliation_decisions')
          .update({ before_state: decision.before_state })
          .eq('id', decision.id);
        if (snapshotUpdate.error) {
          throw new Error(`Failed to store address orphan snapshot: ${snapshotUpdate.error.message}`);
        }
      }
      const { error } = await this.supabase
        .from('building_address_links')
        .upsert({
          campaign_id: decision.campaign_id,
          address_id: decision.address_id,
          building_id: decision.building_id,
          match_type: 'reconciliation',
          confidence: decision.score,
          distance_meters: numberValue(proposed.distance_meters) ?? 0,
          reconciliation_decision_id: decision.id,
          evidence_codes: decision.evidence_codes,
          link_state: 'active',
          reconciliation_version: MAP_RECONCILIATION_ALGORITHM_VERSION,
        }, { onConflict: 'campaign_id,address_id' });
      if (error) throw new Error(`Failed to apply link decision: ${error.message}`);
      await this.supabase
        .from('campaign_addresses')
        .update({
          building_id: UUID_PATTERN.test(decision.building_id) ? decision.building_id : null,
          building_gers_id: decision.building_id,
          match_source: 'reconciliation',
          confidence: decision.score,
        })
        .eq('campaign_id', decision.campaign_id)
        .eq('id', decision.address_id);
      await this.supabase
        .from('address_orphans')
        .delete()
        .eq('campaign_id', decision.campaign_id)
        .eq('address_id', decision.address_id);
      await this.markDecision(decision.id, 'applied');
      decision.status = 'applied';
      return true;
    }

    if (decision.action === 'create_synthetic_address' && decision.building_id) {
      const state = decision.proposed_state;
      const identity = decision.address_identity;
      if (!identity) return false;
      const existing = await this.findAddressByIdentity(decision.campaign_id, identity);
      if (existing) {
        await this.markDecision(decision.id, 'stale', 'Equivalent address now exists');
        return false;
      }
      const syntheticId = uuidV5(`${decision.campaign_id}:synthetic-address:${identity}`);
      const longitude = numberValue(state.longitude);
      const latitude = numberValue(state.latitude);
      if (longitude === null || latitude === null) return false;
      const { error } = await this.supabase.from('campaign_addresses').upsert({
        id: syntheticId,
        campaign_id: decision.campaign_id,
        formatted: stringValue(state.formatted) ?? `${state.house_number ?? ''} ${state.street_name ?? ''}`.trim(),
        house_number: stringValue(state.house_number),
        street_name: stringValue(state.street_name),
        locality: stringValue(state.locality),
        region: stringValue(state.region),
        postal_code: stringValue(state.postal_code),
        source: 'derived_reverse_geocode',
        source_id: `reconciliation:${identity}`,
        geom: `SRID=4326;POINT(${longitude} ${latitude})`,
        coordinate: { longitude, latitude },
      }, { onConflict: 'id' });
      if (error) throw new Error(`Failed to create synthetic address: ${error.message}`);
      decision.address_id = syntheticId;
      await this.supabase
        .from('map_reconciliation_decisions')
        .update({ address_id: syntheticId })
        .eq('id', decision.id);
      const linkDecision = { ...decision, action: 'link_address' as const, address_id: syntheticId };
      const linked = await this.applyDecision(linkDecision);
      if (linked) {
        await this.markDecision(decision.id, 'applied');
        decision.status = 'applied';
      }
      return linked;
    }

    if (decision.action === 'adjust_label' && decision.address_id) {
      const { error } = await this.supabase
        .from('campaign_address_adjustments')
        .upsert({
          campaign_id: decision.campaign_id,
          address_id: decision.address_id,
          label_anchor_lon: numberValue(decision.proposed_state.label_anchor_lon),
          label_anchor_lat: numberValue(decision.proposed_state.label_anchor_lat),
          source: 'reconciliation',
          decision_id: decision.id,
          algorithm_version: MAP_RECONCILIATION_ALGORITHM_VERSION,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'campaign_id,address_id' });
      if (error) throw new Error(`Failed to apply label adjustment: ${error.message}`);
      await this.markDecision(decision.id, 'applied');
      decision.status = 'applied';
      return true;
    }

    if ((decision.action === 'hide_duplicate' || decision.action === 'hide_auxiliary') && decision.building_id) {
      const protectedState = await this.loadProtectedState(decision.campaign_id);
      if (protectedState.buildingIds.has(decision.building_id.toLowerCase())) {
        await this.markDecision(decision.id, 'stale', 'Building received protected field history before apply');
        return false;
      }
      const { data: priorResolution } = await this.supabase
        .from('campaign_building_resolutions')
        .select('*')
        .eq('campaign_id', decision.campaign_id)
        .eq('building_id', decision.building_id)
        .maybeSingle();
      const exactBeforeState = priorResolution
        ? { existed: true, resolution: priorResolution }
        : { existed: false };
      await this.supabase
        .from('map_reconciliation_decisions')
        .update({
          before_state: exactBeforeState,
          precondition_hash: stableHash(exactBeforeState),
        })
        .eq('id', decision.id);
      decision.before_state = exactBeforeState;
      decision.precondition_hash = stableHash(exactBeforeState);
      const { error } = await this.supabase
        .from('campaign_building_resolutions')
        .upsert({
          campaign_id: decision.campaign_id,
          building_id: decision.building_id,
          resolution_status: decision.action === 'hide_duplicate' ? 'hidden_duplicate' : 'hidden_auxiliary',
          canonical_building_id: decision.secondary_building_id,
          reason: decision.evidence_codes.join(','),
          confidence: decision.score,
          decision_id: decision.id,
          algorithm_version: MAP_RECONCILIATION_ALGORITHM_VERSION,
          previous_state: decision.before_state,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'campaign_id,building_id' });
      if (error) throw new Error(`Failed to apply building resolution: ${error.message}`);
      await this.markDecision(decision.id, 'applied');
      decision.status = 'applied';
      return true;
    }
    return false;
  }

  private async preconditionsStillMatch(decision: ReconciliationDecision): Promise<boolean> {
    if (decision.unit_id && decision.split_signature) {
      const unit = await this.supabase
        .from('building_units')
        .select('id')
        .eq('id', decision.unit_id)
        .eq('campaign_id', decision.campaign_id)
        .eq('split_signature', decision.split_signature)
        .eq('lifecycle_state', 'active')
        .maybeSingle();
      if (!unit.data) return false;
    }
    if (
      (decision.action === 'link_address' || decision.action === 'reassign_address') &&
      decision.address_id
    ) {
      const [link, address] = await Promise.all([
        this.supabase
          .from('building_address_links')
          .select('address_id, building_id')
          .eq('campaign_id', decision.campaign_id)
          .eq('address_id', decision.address_id)
          .eq('link_state', 'active')
          .limit(1)
          .maybeSingle(),
        this.supabase
          .from('campaign_addresses')
          .select('building_id, building_gers_id')
          .eq('campaign_id', decision.campaign_id)
          .eq('id', decision.address_id)
          .maybeSingle(),
      ]);
      if (decision.action === 'reassign_address') {
        const expectedBuilding = stringValue(
          decision.before_state.building_gers_id ?? decision.before_state.building_id
        )?.toLowerCase();
        const linkBuilding = stringValue(
          (link.data as JsonRecord | null)?.building_id
        )?.toLowerCase();
        const addressBuilding = stringValue(
          address.data?.building_gers_id ?? address.data?.building_id
        )?.toLowerCase();
        return Boolean(
          expectedBuilding &&
          linkBuilding === expectedBuilding &&
          addressBuilding === expectedBuilding
        );
      }
      return !link.data && !address.data?.building_id && !address.data?.building_gers_id;
    }
    if (decision.action === 'create_synthetic_address' && decision.address_identity) {
      return !await this.findAddressByIdentity(decision.campaign_id, decision.address_identity);
    }
    if (decision.action === 'adjust_label' && decision.address_id) {
      const adjustment = await this.supabase
        .from('campaign_address_adjustments')
        .select('address_id')
        .eq('campaign_id', decision.campaign_id)
        .eq('address_id', decision.address_id)
        .maybeSingle();
      return !adjustment.data;
    }
    if (
      (decision.action === 'hide_duplicate' || decision.action === 'hide_auxiliary') &&
      decision.building_id
    ) {
      const resolution = await this.supabase
        .from('campaign_building_resolutions')
        .select('resolution_status')
        .eq('campaign_id', decision.campaign_id)
        .eq('building_id', decision.building_id)
        .maybeSingle();
      return !resolution.data || resolution.data.resolution_status === 'active';
    }
    return stableHash(decision.before_state) === decision.precondition_hash;
  }

  private async markDecision(
    decisionIdValue: string,
    status: 'applied' | 'stale' | 'rejected' | 'rolled_back',
    reason?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.supabase
      .from('map_reconciliation_decisions')
      .update({
        status,
        applied_at: status === 'applied' ? now : undefined,
        review_reason: reason,
      })
      .eq('id', decisionIdValue);
  }

  private async findAddressByIdentity(campaignId: string, identity: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('campaign_addresses')
      .select('id, formatted, house_number, street_name, locality, region, postal_code')
      .eq('campaign_id', campaignId);
    for (const row of data ?? []) {
      if (normalizedAddressIdentity({
        houseNumber: row.house_number,
        streetName: row.street_name,
        locality: row.locality,
        region: row.region,
        postalCode: row.postal_code,
        unit: unitIdentityFromFormatted(row.formatted),
      }) === identity) return String(row.id);
    }
    return null;
  }

}
