export const SAVED_STORM_PAGE_SIZE = 100;

export function savedStormArchiveFilter(country: string | null, hazard: string | null) {
  if (!['US', 'CA', 'AU'].includes(country ?? '') || !['hail', 'tornado'].includes(hazard ?? '')) return null;
  // Never show U.S. reports or Australian modeled detections under another country.
  return country === 'US'
    ? { hazard: hazard!, source: 'iem', keyPattern: '%' }
    : { hazard: hazard!, source: 'xweather', keyPattern: `xweather:${country!.toLowerCase()}:${hazard}:%` };
}

export function savedStormArchiveOffset(cursor: string | null): number | null {
  if (cursor == null) return 0;
  if (!/^\d+$/.test(cursor)) return null;
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) && offset <= Number.MAX_SAFE_INTEGER - SAVED_STORM_PAGE_SIZE ? offset : null;
}
