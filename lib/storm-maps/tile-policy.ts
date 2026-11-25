import type { StormMapsProvider, StormRasterLayerId } from './types';

const COVERAGE = { west: -180, south: 18, east: -50, north: 85 } as const;

export function stormBoundsIntersectCoverage([west, south, east, north]: readonly number[]) {
  return west < COVERAGE.east && east > COVERAGE.west && south < COVERAGE.north && north > COVERAGE.south;
}

export function stormPointInCoverage(lon: number, lat: number) {
  return lon >= COVERAGE.west && lon <= COVERAGE.east && lat >= COVERAGE.south && lat <= COVERAGE.north;
}

export function isApprovedStormTileTime(
  provider: StormMapsProvider,
  layerId: StormRasterLayerId,
  value: string,
  approvedTiles: string[],
) {
  return approvedTiles.includes(`${provider}:${layerId}:${value}`);
}

function tileLatitude(y: number, tileCount: number) {
  return Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / tileCount))) * 180 / Math.PI;
}

export function stormTileIntersectsCoverage(
  provider: StormMapsProvider,
  z: number,
  x: number,
  y: number,
) {
  const tileCount = 2 ** z;
  const xyzY = provider === 'iem' ? tileCount - 1 - y : y;
  const west = (x / tileCount) * 360 - 180;
  const east = ((x + 1) / tileCount) * 360 - 180;
  const north = tileLatitude(xyzY, tileCount);
  const south = tileLatitude(xyzY + 1, tileCount);
  return stormBoundsIntersectCoverage([west, south, east, north]);
}
