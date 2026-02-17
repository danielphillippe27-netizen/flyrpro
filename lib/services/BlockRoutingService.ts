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
