/**
 * Block Routing Service — Simple group-sort-connect routing
 *
 * Pipeline: group by street → postman sort each street (evens up, odds down)
 * → order streets by nearest-neighbor from depot → concatenate with sequence_index.
 * Optional: Valhalla only for polyline geometry when include_geometry=true.
 */

import * as turf from '@turf/turf';
import { RoutingService } from './RoutingService';

export interface BlockAddress {
  id: string;
  lon: number;
  lat: number;
  house_number?: string;
  /** Some loaders use street_number instead of house_number; we check both. */
  street_number?: string | number;
  street_name?: string;
  formatted?: string;
}

export interface BlockStop {
  id: string;
  lon: number;
  lat: number;
  addressIds: string[];
  metadata: {
    street_name?: string;
    count: number;
    bbox: [number, number, number, number];
    heading?: number;
    isOddSide?: boolean;
  };
}

/** Input address shape for buildRoute (id + coords + optional display fields) */
export interface BuildRouteAddress {
  id: string;
  lat: number;
  lon: number;
  house_number?: string;
  street_number?: string | number;
  street_name?: string;
  formatted?: string;
}

/** Output stop: address fields + 0-based sequence_index */
export interface OrderedAddress extends BuildRouteAddress {
  sequence_index: number;
}

export interface BlockSegment {
  id: string;
  streetName: string;
  side: 'even' | 'odd' | 'unknown';
  blockStart: number | null;
  addressIds: string[];
  centroid: { lat: number; lon: number };
  bbox: [number, number, number, number];
  weight: number;
}

export interface AgentRouteCluster {
  agent_id: number;
  addresses: OrderedAddress[];
  segments: BlockSegment[];
}

export type RouteSplitMode = 'natural' | 'balanced';

interface SegmentClusterState {
  agent_id: number;
  segments: BlockSegment[];
  weight: number;
  centroid: { lat: number; lon: number };
}

export interface BuildRouteOptions {
  include_geometry?: boolean;
  threshold_meters?: number;
  sweep_nn_threshold_m?: number;
  use_house_numbers?: boolean;
}

export interface BuildRouteResult {
  stops: OrderedAddress[];
  geometry?: {
    polyline: string;
    distance_m: number;
    time_sec: number;
  };
}

export interface BlockRouteOptions {
  maxRunGapM?: number;
  maxAddressesPerBlock?: number;
  useWalkwayProjection?: boolean;
}

const STREET_SUFFIXES = new Set([
  'dr', 'ave', 'st', 'rd', 'cr', 'blvd', 'ln', 'ct', 'pl', 'way', 'cir',
]);

const DIRECTION_PREFIXES = new Set([
  'n', 's', 'e', 'w', 'north', 'south', 'east', 'west', 'ne', 'nw', 'se', 'sw',
]);

function normalizeStreetName(name: string | undefined): string {
  if (!name || !name.trim()) return '';
  let s = name.trim().toLowerCase();

  const suffixes: [string, string][] = [
    [' drive', ' dr'],
    [' avenue', ' ave'],
    [' street', ' st'],
    [' road', ' rd'],
    [' crescent', ' cr'],
    [' boulevard', ' blvd'],
    [' lane', ' ln'],
    [' court', ' ct'],
    [' place', ' pl'],
    [' way', ' way'],
    [' circle', ' cir'],
  ];

  for (const [long, short] of suffixes) {
    if (s.endsWith(long)) s = s.slice(0, -long.length) + short;
  }

  let parts = s.split(/\s+/).filter(Boolean);

  while (parts.length > 1 && DIRECTION_PREFIXES.has(parts[0])) {
    parts = parts.slice(1);
  }
  if (parts.length >= 2 && STREET_SUFFIXES.has(parts[parts.length - 1])) {
    parts.pop();
  }

  return parts.join(' ') || s;
}

/**
 * Bulletproof number parsing:
 * 1. Checks house_number AND street_number (common DB/loader alias)
 * 2. Handles raw numbers (converts 50 to "50")
 * 3. Fallbacks: extract from street_name, then formatted
 */
function getNum(a: BlockAddress): number {
  let val: string | number | undefined = a.house_number ?? a.street_number;

  if (!val && a.street_name) {
    const match = a.street_name.trim().match(/^(\d+)\s/);
    if (match) val = match[1];
  }

  if (!val && a.formatted) {
    const match = a.formatted.trim().match(/^(\d+)\s/);
    if (match) val = match[1];
  }

  if (val === undefined || val === null) return NaN;

  const s = String(val).replace(/\D/g, '');
  return s.length > 0 ? parseInt(s, 10) : NaN;
}

/**
 * Postman sort: evens then odds (up one side, down the other). Uses dominant axis for order.
 */
export function postmanSort(addresses: BlockAddress[]): string[] {
  const evens = addresses.filter((a) => {
    const n = getNum(a);
    return !isNaN(n) && n % 2 === 0;
  });

  const odds = addresses.filter((a) => {
    const n = getNum(a);
    return !isNaN(n) && n % 2 !== 0;
  });

  const unknown = addresses.filter((a) => isNaN(getNum(a)));

  if (unknown.length > 0 && evens.length === 0 && odds.length === 0) {
    console.warn(
      `[BlockRouting] All ${addresses.length} addresses on "${addresses[0]?.street_name}" failed number parsing. Falling back to geometric sort (zig-zag likely).`
    );
  }

  const getProj = (list: BlockAddress[]) => {
    if (list.length < 2) return (x: BlockAddress) => x.lon;
    const lats = list.map((a) => a.lat);
    const lons = list.map((a) => a.lon);
    const latSpan = Math.max(...lats) - Math.min(...lats);
    const lonSpan = Math.max(...lons) - Math.min(...lons);
    return latSpan > lonSpan ? (x: BlockAddress) => x.lat : (x: BlockAddress) => x.lon;
  };

  const proj = getProj(addresses);

  evens.sort((a, b) => proj(a) - proj(b));
  odds.sort((a, b) => proj(b) - proj(a));
  if (unknown.length > 1) {
    unknown.sort((a, b) => proj(a) - proj(b));
  }

  // Minimize the single "jump across the street": choose evens→odds vs odds→evens by bridge distance
  const dist = (a: BlockAddress, b: BlockAddress) =>
    Math.hypot(a.lon - b.lon, a.lat - b.lat);
  const lastE = evens[evens.length - 1];
  const firstE = evens[0];
  const lastO = odds[odds.length - 1];
  const firstO = odds[0];
  const bridgeEthenO = lastE && firstO ? dist(lastE, firstO) : Infinity;
  const bridgeOthenE = lastO && firstE ? dist(lastO, firstE) : Infinity;
  const doEvensFirst = bridgeEthenO <= bridgeOthenE;
  const ordered = doEvensFirst
    ? [...evens, ...odds, ...unknown]
    : [...odds, ...evens, ...unknown];

  return ordered.map((a) => a.id);
}

function groupByStreet(addresses: BlockAddress[]): Map<string, BlockAddress[]> {
  const groups = new Map<string, BlockAddress[]>();
  for (const addr of addresses) {
    const key = normalizeStreetName(addr.street_name) || 'unnamed';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(addr);
  }
  return groups;
}

function getStreetSide(address: BlockAddress): 'even' | 'odd' | 'unknown' {
  const n = getNum(address);
  if (Number.isNaN(n)) return 'unknown';
  return n % 2 === 0 ? 'even' : 'odd';
}

function getBlockStart(address: BlockAddress): number | null {
  const n = getNum(address);
  if (Number.isNaN(n)) return null;
  return Math.floor(n / 100) * 100;
}

export function buildBlockSegments(addresses: BlockAddress[]): BlockSegment[] {
  const segmentMap = new Map<string, BlockAddress[]>();

  for (const address of addresses) {
    const streetName = normalizeStreetName(address.street_name) || 'unnamed';
    const side = getStreetSide(address);
    const blockStart = getBlockStart(address);
    const blockKey = blockStart === null ? 'na' : String(blockStart);
    const key = `${streetName}::${side}::${blockKey}`;

    if (!segmentMap.has(key)) segmentMap.set(key, []);
    segmentMap.get(key)!.push(address);
  }

  return Array.from(segmentMap.entries())
    .map(([key, segmentAddresses]) => {
      const [streetName, sideRaw, blockRaw] = key.split('::');
      const addressIds = postmanSort(segmentAddresses);
      const lons = segmentAddresses.map((address) => address.lon);
      const lats = segmentAddresses.map((address) => address.lat);
      const centroid = segmentAddresses.reduce(
        (acc, address) => ({
          lat: acc.lat + address.lat / segmentAddresses.length,
          lon: acc.lon + address.lon / segmentAddresses.length,
        }),
        { lat: 0, lon: 0 }
      );

      const bbox: [number, number, number, number] = [
        Math.min(...lons),
        Math.min(...lats),
        Math.max(...lons),
        Math.max(...lats),
      ];

      return {
        id: key,
        streetName,
        side: sideRaw as BlockSegment['side'],
        blockStart: blockRaw === 'na' ? null : Number(blockRaw),
        addressIds,
        centroid,
        bbox,
        weight: segmentAddresses.length,
      };
    })
    .sort((a, b) => {
      if (a.streetName !== b.streetName) return a.streetName.localeCompare(b.streetName);
      if (a.blockStart === null && b.blockStart !== null) return 1;
      if (a.blockStart !== null && b.blockStart === null) return -1;
      if ((a.blockStart ?? 0) !== (b.blockStart ?? 0)) return (a.blockStart ?? 0) - (b.blockStart ?? 0);
      return a.side.localeCompare(b.side);
    });
}

function centroidDistanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  return turf.distance(turf.point([a.lon, a.lat]), turf.point([b.lon, b.lat]), { units: 'kilometers' });
}

function chooseSeedSegments(
  segments: BlockSegment[],
  nSeeds: number,
  depot: { lat: number; lon: number }
): BlockSegment[] {
  if (segments.length === 0 || nSeeds <= 0) return [];

  const remaining = [...segments];
  remaining.sort((a, b) => centroidDistanceKm(a.centroid, depot) - centroidDistanceKm(b.centroid, depot));

  const seeds: BlockSegment[] = [remaining.shift()!];

  while (seeds.length < nSeeds && remaining.length > 0) {
    let bestIndex = 0;
    let bestScore = -1;

    for (let i = 0; i < remaining.length; i++) {
      const segment = remaining[i];
      const minDistanceToSeed = Math.min(
        ...seeds.map((seed) => centroidDistanceKm(segment.centroid, seed.centroid))
      );
      if (minDistanceToSeed > bestScore) {
        bestScore = minDistanceToSeed;
        bestIndex = i;
      }
    }

    seeds.push(remaining.splice(bestIndex, 1)[0]);
  }

  return seeds;
}

function weightedClusterCentroid(segments: BlockSegment[]): { lat: number; lon: number } {
  if (segments.length === 0) return { lat: 0, lon: 0 };

  const totalWeight = segments.reduce((sum, segment) => sum + segment.weight, 0) || 1;
  return segments.reduce(
    (acc, segment) => ({
      lat: acc.lat + (segment.centroid.lat * segment.weight) / totalWeight,
      lon: acc.lon + (segment.centroid.lon * segment.weight) / totalWeight,
    }),
    { lat: 0, lon: 0 }
  );
}

function blockDifference(a: number | null, b: number | null): number {
  if (a === null || b === null) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b);
}

function bboxGapKm(a: [number, number, number, number], b: [number, number, number, number]): number {
  const lonGap =
    a[2] < b[0] ? b[0] - a[2] : b[2] < a[0] ? a[0] - b[2] : 0;
  const latGap =
    a[3] < b[1] ? b[1] - a[3] : b[3] < a[1] ? a[1] - b[3] : 0;

  if (lonGap === 0 && latGap === 0) return 0;

  const centerLat = (a[1] + a[3] + b[1] + b[3]) / 4;
  const kmPerLat = 111.32;
  const kmPerLon = 111.32 * Math.cos((centerLat * Math.PI) / 180);
  return Math.hypot(lonGap * kmPerLon, latGap * kmPerLat);
}

function segmentPairDistanceKm(
  left: BlockSegment,
  right: BlockSegment,
  addressById: Map<string, BlockAddress>
): number {
  let best = Infinity;

  for (const leftId of left.addressIds) {
    const leftAddress = addressById.get(leftId);
    if (!leftAddress) continue;
    for (const rightId of right.addressIds) {
      const rightAddress = addressById.get(rightId);
      if (!rightAddress) continue;
      const distance = centroidDistanceKm(
        { lat: leftAddress.lat, lon: leftAddress.lon },
        { lat: rightAddress.lat, lon: rightAddress.lon }
      );
      if (distance < best) best = distance;
    }
  }

  return best;
}

function buildSegmentAdjacency(
  segments: BlockSegment[],
  addressById: Map<string, BlockAddress>
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const segment of segments) adjacency.set(segment.id, new Set<string>());

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const left = segments[i];
      const right = segments[j];

      const sameStreet =
        left.streetName === right.streetName &&
        left.side === right.side &&
        blockDifference(left.blockStart, right.blockStart) <= 100;
      const closeBboxes = bboxGapKm(left.bbox, right.bbox) <= 0.06;
      const closeAddresses = segmentPairDistanceKm(left, right, addressById) <= 0.08;

      if (sameStreet || closeBboxes || closeAddresses) {
        adjacency.get(left.id)!.add(right.id);
        adjacency.get(right.id)!.add(left.id);
      }
    }
  }

  return adjacency;
}

function clusterTouchesSegment(
  clusterSegments: BlockSegment[],
  candidate: BlockSegment,
  adjacency: Map<string, Set<string>>
): boolean {
  return clusterSegments.some((segment) => adjacency.get(segment.id)?.has(candidate.id));
}

function detectBoundaryLatitude(addresses: BlockAddress[]): number | null {
  const boundaryAddresses = addresses.filter((address) => {
    const normalized = normalizeStreetName(address.street_name);
    return normalized.includes('carnwith');
  });

  if (boundaryAddresses.length === 0) return null;
  const sortedLats = boundaryAddresses.map((address) => address.lat).sort((a, b) => a - b);
  const mid = Math.floor(sortedLats.length / 2);
  return sortedLats.length % 2 === 0
    ? (sortedLats[mid - 1] + sortedLats[mid]) / 2
    : sortedLats[mid];
}

function allocateRepCountsByWeight(weights: number[], nAgents: number): number[] {
  if (weights.length === 0) return [];
  if (weights.length === 1) return [nAgents];

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const base = weights.map((weight) => Math.max(1, Math.floor((weight / totalWeight) * nAgents)));
  let assigned = base.reduce((sum, count) => sum + count, 0);

  while (assigned > nAgents) {
    let bestIndex = 0;
    for (let i = 1; i < base.length; i++) {
      if (base[i] > base[bestIndex]) bestIndex = i;
    }
    if (base[bestIndex] === 1) break;
    base[bestIndex] -= 1;
    assigned -= 1;
  }

  while (assigned < nAgents) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < base.length; i++) {
      const target = (weights[i] / totalWeight) * nAgents;
      const score = target - base[i];
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    base[bestIndex] += 1;
    assigned += 1;
  }

  return base;
}

function clusterSegmentsIntoAgents(
  segments: BlockSegment[],
  addressById: Map<string, BlockAddress>,
  nAgents: number,
  depot: { lat: number; lon: number },
  agentIdOffset = 0,
  strategy: RouteSplitMode = 'natural'
): AgentRouteCluster[] {
  if (segments.length === 0 || nAgents <= 0) return [];

  const adjacency = buildSegmentAdjacency(segments, addressById);
  const nClusters = Math.min(nAgents, segments.length);
  const seeds = chooseSeedSegments(segments, nClusters, depot);
  const seedIds = new Set(seeds.map((seed) => seed.id));
  const unassigned = segments
    .filter((segment) => !seedIds.has(segment.id))
    .sort((a, b) => b.weight - a.weight);

  const clusters: SegmentClusterState[] = seeds.map((seed, idx) => ({
    agent_id: agentIdOffset + idx + 1,
    segments: [seed],
    weight: seed.weight,
    centroid: { ...seed.centroid },
  }));

  const totalWeight = segments.reduce((sum, segment) => sum + segment.weight, 0);
  const targetWeight = totalWeight / nClusters;

  while (unassigned.length > 0) {
    let bestClusterIndex = 0;
    let bestSegmentIndex = 0;
    let bestScore = Infinity;

    for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex++) {
      const cluster = clusters[clusterIndex];
      const hasAdjacentFrontier = unassigned.some((segment) =>
        clusterTouchesSegment(cluster.segments, segment, adjacency)
      );

      for (let segmentIndex = 0; segmentIndex < unassigned.length; segmentIndex++) {
        const segment = unassigned[segmentIndex];
        const touchesCluster = clusterTouchesSegment(cluster.segments, segment, adjacency);
        if (strategy === 'natural' && hasAdjacentFrontier && !touchesCluster) continue;

        const distancePenalty = centroidDistanceKm(cluster.centroid, segment.centroid);
        const loadPenalty =
          Math.abs(cluster.weight + segment.weight - targetWeight) / Math.max(1, targetWeight);
        const deficitBonus = Math.max(0, targetWeight - cluster.weight) / Math.max(1, targetWeight);
        const adjacencyBonus =
          strategy === 'natural'
            ? touchesCluster ? -0.9 : 0
            : touchesCluster ? -0.15 : 0;
        const score =
          strategy === 'natural'
            ? distancePenalty + loadPenalty * 0.55 - deficitBonus * 0.15 + adjacencyBonus
            : distancePenalty * 0.35 + loadPenalty * 1.15 - deficitBonus * 0.35 + adjacencyBonus;

        if (score < bestScore) {
          bestScore = score;
          bestClusterIndex = clusterIndex;
          bestSegmentIndex = segmentIndex;
        }
      }
    }

    const chosen = unassigned.splice(bestSegmentIndex, 1)[0];
    const cluster = clusters[bestClusterIndex];
    cluster.segments.push(chosen);
    cluster.weight += chosen.weight;
    cluster.centroid = weightedClusterCentroid(cluster.segments);
  }

  return clusters
    .sort((a, b) => a.agent_id - b.agent_id)
    .map((cluster) => {
      const orderedIds = orderSegmentsByProximity(cluster.segments, addressById, depot);
      const orderedAddresses = orderedIds.map((id, sequenceIndex) => {
        const address = addressById.get(id);
        if (!address) throw new Error(`clusterSegmentsIntoAgents: unknown id ${id}`);
        return {
          ...address,
          sequence_index: sequenceIndex,
        };
      });

      return {
        agent_id: cluster.agent_id,
        addresses: orderedAddresses,
        segments: cluster.segments,
      };
    });
}

function orderSegmentsByProximity(
  segments: BlockSegment[],
  addressById: Map<string, BlockAddress>,
  start: { lat: number; lon: number }
): string[] {
  const orderedIds: string[] = [];
  const remaining = segments.map((segment) => ({ ...segment, addressIds: [...segment.addressIds] }));
  let walkerPos = { ...start };

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    let bestReverse = false;

    for (let i = 0; i < remaining.length; i++) {
      const segment = remaining[i];
      const first = addressById.get(segment.addressIds[0]);
      const last = addressById.get(segment.addressIds[segment.addressIds.length - 1]);
      if (!first || !last) continue;

      const distToEntry = centroidDistanceKm(walkerPos, { lat: first.lat, lon: first.lon });
      const distToExit = centroidDistanceKm(walkerPos, { lat: last.lat, lon: last.lon });

      if (distToEntry < bestDist) {
        bestDist = distToEntry;
        bestIdx = i;
        bestReverse = false;
      }
      if (distToExit < bestDist) {
        bestDist = distToExit;
        bestIdx = i;
        bestReverse = true;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    const ids = bestReverse ? [...chosen.addressIds].reverse() : chosen.addressIds;
    orderedIds.push(...ids);

    const exitAddr = addressById.get(ids[ids.length - 1]);
    if (exitAddr) walkerPos = { lat: exitAddr.lat, lon: exitAddr.lon };
  }

  return orderedIds;
}

export function buildBalancedBlockClusters(
  addresses: BuildRouteAddress[],
  nAgents: number,
  depot: { lat: number; lon: number }
): AgentRouteCluster[] {
  const safeAgentCount = Math.max(1, Math.floor(nAgents) || 1);
  const blockAddresses: BlockAddress[] = addresses.map((a) => ({
    id: a.id,
    lon: a.lon,
    lat: a.lat,
    house_number: a.house_number,
    street_number: a.street_number,
    street_name: a.street_name,
    formatted: a.formatted,
  }));

  const addressById = new Map(blockAddresses.map((address) => [address.id, address]));
  const segments = buildBlockSegments(blockAddresses);
  if (segments.length === 0) return [];

  const orderedIds = orderSegmentsByProximity(segments, addressById, depot);
  const clusters: AgentRouteCluster[] = [];
  let cursor = 0;

  for (let index = 0; index < safeAgentCount; index += 1) {
    const remainingAgents = safeAgentCount - index;
    const remainingHomes = orderedIds.length - cursor;
    const chunkSize = Math.ceil(remainingHomes / remainingAgents);
    const chunkIds = orderedIds.slice(cursor, cursor + chunkSize);
    const chunkIdSet = new Set(chunkIds);
    cursor += chunkSize;

    clusters.push({
      agent_id: index + 1,
      addresses: chunkIds.map((id, sequenceIndex) => {
        const address = addressById.get(id);
        if (!address) throw new Error(`buildBalancedBlockClusters: unknown id ${id}`);
        return {
          ...address,
          sequence_index: sequenceIndex,
        };
      }),
      segments: segments.filter((segment) => segment.addressIds.some((id) => chunkIdSet.has(id))),
    });
  }

  return clusters;
}

export function buildNaturalZoneClusters(
  addresses: BuildRouteAddress[],
  nAgents: number,
  depot: { lat: number; lon: number }
): AgentRouteCluster[] {
  const safeAgentCount = Math.max(1, Math.floor(nAgents) || 1);
  const blockAddresses: BlockAddress[] = addresses.map((a) => ({
    id: a.id,
    lon: a.lon,
    lat: a.lat,
    house_number: a.house_number,
    street_number: a.street_number,
    street_name: a.street_name,
    formatted: a.formatted,
  }));

  const addressById = new Map(blockAddresses.map((address) => [address.id, address]));
  const segments = buildBlockSegments(blockAddresses);
  if (segments.length === 0) return [];
  const boundaryLat = detectBoundaryLatitude(blockAddresses);
  if (boundaryLat === null || safeAgentCount <= 1) {
    return clusterSegmentsIntoAgents(segments, addressById, safeAgentCount, depot, 0, 'natural');
  }

  const northSegments = segments.filter((segment) => segment.centroid.lat > boundaryLat);
  const southSegments = segments.filter((segment) => segment.centroid.lat <= boundaryLat);
  if (northSegments.length === 0 || southSegments.length === 0) {
    return clusterSegmentsIntoAgents(segments, addressById, safeAgentCount, depot, 0, 'natural');
  }

  const zoneWeights = [
    northSegments.reduce((sum, segment) => sum + segment.weight, 0),
    southSegments.reduce((sum, segment) => sum + segment.weight, 0),
  ];
  const [northAgents, southAgents] = allocateRepCountsByWeight(zoneWeights, safeAgentCount);

  const northDepot =
    northSegments.reduce(
      (acc, segment) => ({
        lat: acc.lat + segment.centroid.lat / northSegments.length,
        lon: acc.lon + segment.centroid.lon / northSegments.length,
      }),
      { lat: 0, lon: 0 }
    );
  const southDepot =
    southSegments.reduce(
      (acc, segment) => ({
        lat: acc.lat + segment.centroid.lat / southSegments.length,
        lon: acc.lon + segment.centroid.lon / southSegments.length,
      }),
      { lat: 0, lon: 0 }
    );

  const northClusters = clusterSegmentsIntoAgents(northSegments, addressById, northAgents, northDepot, 0, 'natural');
  const southClusters = clusterSegmentsIntoAgents(
    southSegments,
    addressById,
    southAgents,
    southDepot,
    northClusters.length,
    'natural'
  );

  return [...northClusters, ...southClusters];
}

/**
 * Single entry point: Group by street → postman sort each → order streets by nearest-neighbor from depot.
 */
export async function buildRoute(
  addresses: BuildRouteAddress[],
  depot: { lat: number; lon: number },
  options: BuildRouteOptions = {}
): Promise<BuildRouteResult> {
  const { include_geometry = false } = options;

  const blockAddresses: BlockAddress[] = addresses.map((a) => ({
    id: a.id,
    lon: a.lon,
    lat: a.lat,
    house_number: a.house_number,
    street_number: a.street_number,
    street_name: a.street_name,
    formatted: a.formatted,
  }));

  const addressById = new Map(blockAddresses.map((a) => [a.id, a]));

  if (blockAddresses.length === 0) return { stops: [] };
  if (blockAddresses.length === 1) {
    const a = blockAddresses[0];
    return { stops: [{ ...a, sequence_index: 0 }] };
  }

  const streetGroups = groupByStreet(blockAddresses);

  const streets: { streetName: string; ids: string[] }[] = [];
  for (const [streetName, addrs] of streetGroups) {
    const ids = postmanSort(addrs);
    streets.push({ streetName: streetName || 'unnamed', ids });
  }

  const orderedIds: string[] = [];
  let walkerPos = { lon: depot.lon, lat: depot.lat };
  const remaining = streets.map((s) => ({ ...s }));

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Infinity;
    let bestReverse = false;

    for (let i = 0; i < remaining.length; i++) {
      const s = remaining[i];
      const first = addressById.get(s.ids[0])!;
      const last = addressById.get(s.ids[s.ids.length - 1])!;

      const distToEntry = turf.distance(
        turf.point([walkerPos.lon, walkerPos.lat]),
        turf.point([first.lon, first.lat]),
        { units: 'meters' }
      );

      const distToExit = turf.distance(
        turf.point([walkerPos.lon, walkerPos.lat]),
        turf.point([last.lon, last.lat]),
        { units: 'meters' }
      );

      if (distToEntry < bestDist) {
        bestDist = distToEntry;
        bestIdx = i;
        bestReverse = false;
      }
      if (distToExit < bestDist) {
        bestDist = distToExit;
        bestIdx = i;
        bestReverse = true;
      }
    }

    const chosen = remaining.splice(bestIdx, 1)[0];
    const ids = bestReverse ? [...chosen.ids].reverse() : chosen.ids;
    orderedIds.push(...ids);

    const exitAddr = addressById.get(ids[ids.length - 1])!;
    walkerPos = { lon: exitAddr.lon, lat: exitAddr.lat };
  }

  const stops: OrderedAddress[] = orderedIds.map((id, seq) => {
    const a = addressById.get(id);
    if (!a) throw new Error(`buildRoute: unknown id ${id}`);
    return { ...a, sequence_index: seq };
  });

  let geometry: BuildRouteResult['geometry'];
  if (include_geometry && stops.length >= 2) {
    try {
      const orderedCoords = stops
        .sort((x, y) => x.sequence_index - y.sequence_index)
        .map((s) => ({ lat: s.lat, lon: s.lon }));
      const geom = await RoutingService.getRouteGeometry(orderedCoords);
      geometry = { polyline: geom.polyline, distance_m: geom.distance_m, time_sec: geom.time_sec };
    } catch (e) {
      console.warn('[BlockRoutingService] getRouteGeometry failed:', e);
    }
  }

  return { stops, geometry };
}
