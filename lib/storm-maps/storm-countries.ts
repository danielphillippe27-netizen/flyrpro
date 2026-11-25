export const STORM_COUNTRIES = ['CA', 'US'] as const;
export type StormCountry = typeof STORM_COUNTRIES[number];

export function isStormCountry(value: unknown): value is StormCountry {
  return value === 'CA' || value === 'US';
}
