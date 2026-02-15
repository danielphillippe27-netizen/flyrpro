/**
 * Block Routing Service - Street-Block-Sweep-Snake routing
 *
 * Single method: buildRoute. No CVRP, TSP, or Valhalla sequencing.
 * Pipeline: group by street → split into runs (blocks) → order blocks by sweep from depot
 * → snake addresses within each block → concatenate with sequence_index.
 * Optional: Valhalla only for polyline geometry when include_geometry=true.
 */

import * as turf from '@turf/turf';
import type { Feature, Point, LineString } from '@turf/turf';
import { createAdminClient } from '@/lib/supabase/server';
import { RoutingService } from './RoutingService';

export interface BlockAddress {
  id: string;
  lon: number;
  lat: number;
  house_number?: string;
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
    bbox: [number, number, number, number]; // [west, south, east, north]
    heading?: number; // Principal axis heading (0-360)
    isOddSide?: boolean; // For street-side sorting
  };
}

/** Input address shape for buildRoute (id + coords + optional display fields) */
export interface BuildRouteAddress {
  id: string;
  lat: number;
  lon: number;
  house_number?: string;
  street_name?: string;
  formatted?: string;
}

/** Output stop: address fields + 0-based sequence_index */
export interface OrderedAddress extends BuildRouteAddress {
  sequence_index: number;
}

export interface BuildRouteOptions {
  include_geometry?: boolean;
  /** For splitIntoRuns gap (meters), default 50 */
  threshold_meters?: number;
  /** For sweep NN post-process (meters); if distance(block_i, block_i+1) > this, swap with closer block. Default 500. */
  sweep_nn_threshold_m?: number;
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
  /** Break run when distance between consecutive points > this (meters) (default: 50) */
  maxRunGapM?: number;
  /** Maximum addresses per block before splitting (default: 30) */
  maxAddressesPerBlock?: number;
  /** Enable walkway projection ordering within blocks (default: true) */
  useWalkwayProjection?: boolean;
}

interface RunSegment {
  addresses: BlockAddress[];
  streetName?: string;
  bbox: [number, number, number, number];
}

/**
 * Build block stops from addresses
 * 
 * Groups addresses by street, then splits into contiguous runs.
 * Each run becomes a block stop.
 */
export function buildBlockStops(
  addresses: BlockAddress[],
  options: {
    targetBlockSize?: number;
    maxRunGapM?: number;
    maxAddressesPerBlock?: number;
  } = {}
): BlockStop[] {
  const {
    targetBlockSize = 50,
    maxRunGapM = 50,
    maxAddressesPerBlock = 30
  } = options;

  if (addresses.length === 0) return [];
  if (addresses.length <= 3) {
    // Too few addresses - just one block
    return [createBlockFromAddresses(addresses, 'small-block')];
  }

  // Phase 1: Group by street name if available
  const streetGroups = groupByStreet(addresses);

  // Phase 2: Within each street, split into contiguous runs
  const runs: RunSegment[] = [];
  for (const [streetName, streetAddresses] of streetGroups) {
    const streetRuns = splitIntoRuns(streetAddresses, maxRunGapM);
    for (const run of streetRuns) {
      runs.push({ ...run, streetName });
    }
  }

  // Phase 3: Merge small runs if we have too many blocks
  let blocks = runs.map((run, idx) => 
    createBlockFromAddresses(run.addresses, run.streetName ? `${run.streetName}-${idx}` : `block-${idx}`)
  );

  // Phase 4: Split large blocks
  blocks = blocks.flatMap(block => 
    block.addressIds.length > maxAddressesPerBlock 
      ? splitLargeBlock(block, maxAddressesPerBlock)
      : [block]
  );

  // Phase 5: Merge if we have way more blocks than target
  if (blocks.length > targetBlockSize * 1.5) {
    blocks = mergeSmallBlocks(blocks, targetBlockSize);
  }

  return blocks;
}

/**
 * Order addresses within a block for human-like walking (cluster → sweep).
 * Uses a spine (walkway segment or PCA axis), projects addresses onto it,
 * then orders one side ascending and the other descending so the route
 * sweeps up one side of the street and back on the other.
 * Tries walkway projection first, falls back to PCA-based ordering.
 * When reverse=true (snake), the final order is reversed.
 */
export async function orderAddressesWithinBlock(
  addresses: BlockAddress[],
  options: {
    useWalkwayProjection?: boolean;
    reverse?: boolean;
  } = {}
): Promise<string[]> {
  const { useWalkwayProjection = true, reverse = false } = options;

  if (addresses.length <= 1) {
    return addresses.map(a => a.id);
  }

  let ordered: string[];
  if (useWalkwayProjection) {
    try {
      const walkwayOrder = await orderByWalkwayProjection(addresses);
      ordered = walkwayOrder ?? orderByPCA(addresses);
    } catch {
      ordered = orderByPCA(addresses);
    }
  } else {
    ordered = orderByPCA(addresses);
  }

  if (reverse) {
    ordered = [...ordered].reverse();
  }
  return ordered;
}

/**
 * Group addresses by street name. Returns Map<street_name, addresses>.
 * Used internally by buildRoute; street_name can be undefined for unknown streets.
 */
export function groupAddressesByStreet(addresses: BlockAddress[]): Map<string | undefined, BlockAddress[]> {
  return groupByStreet(addresses);
}

/**
 * Order blocks by sweep angle from depot (atan2 ascending), then optionally
 * apply nearest-neighbor post-process: if distance(block_i, block_i+1) > threshold_m,
 * scan remaining blocks for a closer one and swap.
 */
export function orderBlocksBySweep(
  blocks: BlockStop[],
  depot: { lat: number; lon: number },
  sweepNnThresholdM?: number
): BlockStop[] {
  if (blocks.length <= 1) return [...blocks];

  const sorted = [...blocks].sort((a, b) => {
    const angleA = Math.atan2(a.lat - depot.lat, a.lon - depot.lon);
    const angleB = Math.atan2(b.lat - depot.lat, b.lon - depot.lon);
    return angleA - angleB;
  });

  const threshold = sweepNnThresholdM ?? 500;
  if (!Number.isFinite(threshold) || threshold <= 0) return sorted;

  // NN post-process: for each adjacent pair, if too far, swap with closer block
  const result = [...sorted];
  for (let i = 0; i < result.length - 1; i++) {
    const curr = result[i];
    const next = result[i + 1];
    const distToNext = turf.distance(
      turf.point([curr.lon, curr.lat]),
      turf.point([next.lon, next.lat]),
      { units: 'meters' }
    );
    if (distToNext <= threshold) continue;

    let bestIdx = i + 1;
    let bestDist = distToNext;
    for (let j = i + 2; j < result.length; j++) {
      const d = turf.distance(
        turf.point([curr.lon, curr.lat]),
        turf.point([result[j].lon, result[j].lat]),
        { units: 'meters' }
      );
      if (d < bestDist) {
        bestDist = d;
        bestIdx = j;
      }
    }
    if (bestIdx !== i + 1) {
      [result[i + 1], result[bestIdx]] = [result[bestIdx], result[i + 1]];
    }
  }
  return result;
}

/**
 * Single entry point: Street-Block-Sweep-Snake route.
 * No CVRP, TSP, or Valhalla sequencing. Optional Valhalla only for polyline when include_geometry=true.
 */
export async function buildRoute(
  addresses: BuildRouteAddress[],
  depot: { lat: number; lon: number },
  options: BuildRouteOptions = {}
): Promise<BuildRouteResult> {
  const {
    include_geometry = false,
    threshold_meters = 50,
    sweep_nn_threshold_m = 500
  } = options;

  const blockAddresses: BlockAddress[] = addresses.map(a => ({
    id: a.id,
    lon: a.lon,
    lat: a.lat,
    house_number: a.house_number,
    street_name: a.street_name,
    formatted: a.formatted
  }));

  const addressById = new Map(blockAddresses.map(a => [a.id, a]));

  if (blockAddresses.length === 0) {
    return { stops: [] };
  }
  if (blockAddresses.length === 1) {
    const a = blockAddresses[0];
    const stops: OrderedAddress[] = [{ ...a, sequence_index: 0 }];
    return { stops };
  }

  // 1. Group by street
  const streetGroups = groupByStreet(blockAddresses);

  // 2. For each street: splitIntoRuns → collect all runs as blocks
  const runs: RunSegment[] = [];
  for (const [, streetAddresses] of streetGroups) {
    const streetRuns = splitIntoRuns(streetAddresses, threshold_meters);
    for (const run of streetRuns) {
      runs.push({ ...run, streetName: streetAddresses[0]?.street_name });
    }
  }

  const blocks: BlockStop[] = runs.map((run, idx) =>
    createBlockFromAddresses(run.addresses, run.streetName ? `${run.streetName}-${idx}` : `block-${idx}`)
  );

  // 3. Order blocks by sweep from depot (with optional NN post-process)
  const orderedBlocks = orderBlocksBySweep(blocks, depot, sweep_nn_threshold_m);

  // 4. Snake: order addresses within each block (alternate direction per block)
  const orderedIds: string[] = [];
  for (let i = 0; i < orderedBlocks.length; i++) {
    const block = orderedBlocks[i];
    const blockAddrs = blockAddresses.filter(a => block.addressIds.includes(a.id));
    const ids = await orderAddressesWithinBlock(blockAddrs, {
      useWalkwayProjection: true,
      reverse: i % 2 === 1
    });
    orderedIds.push(...ids);
  }

  // 5. Build stops with sequence_index (validation: every input appears exactly once)
  const idSet = new Set(orderedIds);
  for (const a of blockAddresses) {
    if (!idSet.has(a.id)) throw new Error(`buildRoute: address ${a.id} missing from output`);
  }
  if (orderedIds.length !== blockAddresses.length) {
    throw new Error(`buildRoute: output length ${orderedIds.length} != input ${blockAddresses.length}`);
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
        .map(s => ({ lat: s.lat, lon: s.lon }));
      const geom = await RoutingService.getRouteGeometry(orderedCoords);
      geometry = { polyline: geom.polyline, distance_m: geom.distance_m, time_sec: geom.time_sec };
    } catch (e) {
      console.warn('[BlockRoutingService] getRouteGeometry failed:', e);
    }
  }

  return { stops, geometry };
}

// ==================== Internal Helper Functions ====================

function groupByStreet(addresses: BlockAddress[]): Map<string | undefined, BlockAddress[]> {
  const groups = new Map<string | undefined, BlockAddress[]>();
  
  for (const addr of addresses) {
    const key = addr.street_name?.trim() || undefined;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(addr);
  }
  
  return groups;
}

function splitIntoRuns(addresses: BlockAddress[], maxGapM: number): RunSegment[] {
  if (addresses.length === 0) return [];
  if (addresses.length === 1) {
    return [{
      addresses,
      bbox: calculateBbox(addresses)
    }];
  }

  const runs: RunSegment[] = [];
  let currentRun: BlockAddress[] = [addresses[0]];
  
  for (let i = 1; i < addresses.length; i++) {
    const prev = currentRun[currentRun.length - 1];
    const curr = addresses[i];
    const dist = turf.distance(
      turf.point([prev.lon, prev.lat]),
      turf.point([curr.lon, curr.lat]),
      { units: 'meters' }
    );
    
    if (dist > maxGapM) {
      // Break the run
      runs.push({
        addresses: currentRun,
        bbox: calculateBbox(currentRun)
      });
      currentRun = [curr];
    } else {
      currentRun.push(curr);
    }
  }
  
  // Don't forget the last run
  if (currentRun.length > 0) {
    runs.push({
      addresses: currentRun,
      bbox: calculateBbox(currentRun)
    });
  }
  
  return runs;
}

function createBlockFromAddresses(addresses: BlockAddress[], idBase: string): BlockStop {
  const centroid = calculateCentroid(addresses);
  const bbox = calculateBbox(addresses);
  
  // Calculate principal heading
  const heading = calculatePrincipalHeading(addresses);
  
  return {
    id: `${idBase}-${addresses[0].id.slice(0, 8)}`,
    lon: centroid.lon,
    lat: centroid.lat,
    addressIds: addresses.map(a => a.id),
    metadata: {
      street_name: addresses[0].street_name,
      count: addresses.length,
      bbox,
      heading
    }
  };
}

function splitLargeBlock(block: BlockStop, maxSize: number): BlockStop[] {
  const nSubBlocks = Math.ceil(block.addressIds.length / maxSize);
  const subBlocks: BlockStop[] = [];
  
  for (let i = 0; i < nSubBlocks; i++) {
    const startIdx = i * maxSize;
    const endIdx = Math.min((i + 1) * maxSize, block.addressIds.length);
    const subIds = block.addressIds.slice(startIdx, endIdx);
    
    subBlocks.push({
      id: `${block.id}-part${i}`,
      lon: block.lon, // Approximate - will use actual centroid later
      lat: block.lat,
      addressIds: subIds,
      metadata: {
        ...block.metadata,
        count: subIds.length
      }
    });
  }
  
  return subBlocks;
}

function mergeSmallBlocks(blocks: BlockStop[], targetSize: number): BlockStop[] {
  // Simple greedy merge of smallest neighboring blocks
  while (blocks.length > targetSize) {
    // Find smallest block
    let smallestIdx = 0;
    let smallestSize = Infinity;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].addressIds.length < smallestSize) {
        smallestSize = blocks[i].addressIds.length;
        smallestIdx = i;
      }
    }
    
    // Find nearest neighbor
    const smallest = blocks[smallestIdx];
    let nearestIdx = -1;
    let nearestDist = Infinity;
    
    for (let i = 0; i < blocks.length; i++) {
      if (i === smallestIdx) continue;
      const dist = turf.distance(
        turf.point([smallest.lon, smallest.lat]),
        turf.point([blocks[i].lon, blocks[i].lat]),
        { units: 'meters' }
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    
    if (nearestIdx === -1) break;
    
    // Merge smallest into nearest
    const nearest = blocks[nearestIdx];
    const merged: BlockStop = {
      id: `${nearest.id}-merged`,
      lon: (nearest.lon * nearest.addressIds.length + smallest.lon * smallest.addressIds.length) / 
           (nearest.addressIds.length + smallest.addressIds.length),
      lat: (nearest.lat * nearest.addressIds.length + smallest.lat * smallest.addressIds.length) / 
           (nearest.addressIds.length + smallest.addressIds.length),
      addressIds: [...nearest.addressIds, ...smallest.addressIds],
      metadata: {
        street_name: nearest.metadata.street_name || smallest.metadata.street_name,
        count: nearest.addressIds.length + smallest.addressIds.length,
        bbox: mergeBboxes(nearest.metadata.bbox, smallest.metadata.bbox),
        heading: nearest.metadata.heading // Keep nearest's heading
      }
    };
    
    // Replace nearest with merged, remove smallest
    blocks[nearestIdx] = merged;
    blocks.splice(smallestIdx, 1);
  }
  
  return blocks;
}

/** Side of segment for sweep ordering (left = cross product > 0) */
type SegmentSide = 'left' | 'right';

/**
 * Sweep order: one side of spine in ascending order, then the other in descending
 * so the route goes up one side and back on the other (no mid-block crossing).
 */
function sweepOrderFromProjections(
  projections: Array<{ id: string; distanceAlong: number; side: SegmentSide }>
): string[] {
  const left = projections.filter(p => p.side === 'left');
  const right = projections.filter(p => p.side === 'right');
  const minLeft = left.length ? Math.min(...left.map(p => p.distanceAlong)) : Infinity;
  const minRight = right.length ? Math.min(...right.map(p => p.distanceAlong)) : Infinity;
  const startSideIsLeft = minLeft <= minRight;
  const startSide = startSideIsLeft ? left : right;
  const otherSide = startSideIsLeft ? right : left;
  const startOrdered = [...startSide].sort((a, b) => a.distanceAlong - b.distanceAlong);
  const otherOrdered = [...otherSide].sort((a, b) => b.distanceAlong - a.distanceAlong);
  return [...startOrdered.map(p => p.id), ...otherOrdered.map(p => p.id)];
}

async function orderByWalkwayProjection(addresses: BlockAddress[]): Promise<string[] | null> {
  if (addresses.length < 2) return addresses.map(a => a.id);
  
  try {
    const supabase = createAdminClient();
    
    // Calculate centroid
    const centroid = calculateCentroid(addresses);
    
    // Find nearest walkway segment
    const { data: segment, error } = await supabase.rpc('find_nearest_walkway_segment', {
      p_lon: centroid.lon,
      p_lat: centroid.lat,
      p_radius_m: 100
    });
    
    if (error || !segment) {
      return null;
    }
    const seg = Array.isArray(segment) ? segment[0] : segment;
    if (!seg) return null;

    const projections = addresses.map(addr => {
      const projected = projectPointOntoSegment(
        { lon: addr.lon, lat: addr.lat },
        seg
      );
      return {
        id: addr.id,
        distanceAlong: projected.distanceAlong,
        side: projected.side
      };
    });
    
    return sweepOrderFromProjections(projections);
  } catch (e) {
    return null;
  }
}

function projectPointOntoSegment(
  point: { lon: number; lat: number },
  segment: { lon1: number; lat1: number; lon2: number; lat2: number }
): { point: { lon: number; lat: number }; distanceAlong: number; side: SegmentSide } {
  const p = turf.point([point.lon, point.lat]);
  const line = turf.lineString([[segment.lon1, segment.lat1], [segment.lon2, segment.lat2]]);
  
  const nearest = turf.nearestPointOnLine(line, p);
  const lineLength = turf.length(line, { units: 'meters' });
  const location = (nearest.properties?.location as number | undefined) ?? 0;
  const distanceAlong = location * lineLength;
  
  const segDx = segment.lon2 - segment.lon1;
  const segDy = segment.lat2 - segment.lat1;
  const ptDx = point.lon - segment.lon1;
  const ptDy = point.lat - segment.lat1;
  const cross = segDx * ptDy - segDy * ptDx;
  const side: SegmentSide = cross > 0 ? 'left' : 'right';
  
  return {
    point: { lon: nearest.geometry.coordinates[0], lat: nearest.geometry.coordinates[1] },
    distanceAlong,
    side
  };
}

function orderByPCA(addresses: BlockAddress[]): string[] {
  if (addresses.length < 2) return addresses.map(a => a.id);
  
  // Simple PCA: find principal axis and project points onto it
  const points = addresses.map(a => [a.lon, a.lat]);
  
  // Calculate centroid
  const centroid = points.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1]], [0, 0])
    .map(v => v / points.length);
  
  // Calculate covariance matrix
  let cxx = 0, cyy = 0, cxy = 0;
  for (const p of points) {
    const dx = p[0] - centroid[0];
    const dy = p[1] - centroid[1];
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  cxx /= points.length;
  cyy /= points.length;
  cxy /= points.length;
  
  // Find principal eigenvector
  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const eigenvalue1 = trace / 2 + Math.sqrt(trace * trace / 4 - det);
  
  let axis: [number, number];
  if (Math.abs(cxy) < 1e-10) {
    axis = cxx > cyy ? [1, 0] : [0, 1];
  } else {
    axis = [eigenvalue1 - cyy, cxy];
    const norm = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1]);
    axis = [axis[0] / norm, axis[1] / norm];
  }
  
  const projections = addresses.map((addr, i) => {
    const p = points[i];
    const dx = p[0] - centroid[0];
    const dy = p[1] - centroid[1];
    const projection = dx * axis[0] + dy * axis[1];
    const cross = axis[0] * dy - axis[1] * dx;
    const side: SegmentSide = cross > 0 ? 'left' : 'right';
    return { id: addr.id, distanceAlong: projection, side };
  });
  
  return sweepOrderFromProjections(projections);
}

function calculateCentroid(addresses: BlockAddress[]): { lon: number; lat: number } {
  const sumLon = addresses.reduce((s, a) => s + a.lon, 0);
  const sumLat = addresses.reduce((s, a) => s + a.lat, 0);
  return {
    lon: sumLon / addresses.length,
    lat: sumLat / addresses.length
  };
}

function calculateBbox(addresses: BlockAddress[]): [number, number, number, number] {
  const lons = addresses.map(a => a.lon);
  const lats = addresses.map(a => a.lat);
  return [
    Math.min(...lons), // west
    Math.min(...lats), // south
    Math.max(...lons), // east
    Math.max(...lats)  // north
  ];
}

function mergeBboxes(b1: [number, number, number, number], b2: [number, number, number, number]): [number, number, number, number] {
  return [
    Math.min(b1[0], b2[0]),
    Math.min(b1[1], b2[1]),
    Math.max(b1[2], b2[2]),
    Math.max(b1[3], b2[3])
  ];
}

function calculatePrincipalHeading(addresses: BlockAddress[]): number | undefined {
  if (addresses.length < 2) return undefined;
  
  const points = addresses.map(a => [a.lon, a.lat]);
  const centroid = points.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1]], [0, 0])
    .map(v => v / points.length);
  
  // Calculate covariance
  let cxy = 0, cxx = 0, cyy = 0;
  for (const p of points) {
    const dx = p[0] - centroid[0];
    const dy = p[1] - centroid[1];
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  
  // Principal axis angle
  const angle = Math.atan2(2 * cxy, cxx - cyy) / 2;
  const heading = (angle * 180 / Math.PI + 360) % 360;
  
  return heading;
}
