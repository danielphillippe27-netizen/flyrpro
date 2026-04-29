import regionBounds from '../../scripts/regions.json';

type RegionBoundsRow = {
  code: string;
};

const SUPPORTED_REGION_CODES = new Set(
  (regionBounds as RegionBoundsRow[])
    .map((row) => row.code.trim().toUpperCase())
    .filter((code) => code.length > 0)
);

export function normalizeRegionCode(regionCode: string | null | undefined): string | null {
  if (typeof regionCode !== 'string') return null;
  const normalized = regionCode.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

export function isParcelRegionSupported(regionCode: string | null | undefined): boolean {
  const normalized = normalizeRegionCode(regionCode);
  return normalized ? SUPPORTED_REGION_CODES.has(normalized) : false;
}
