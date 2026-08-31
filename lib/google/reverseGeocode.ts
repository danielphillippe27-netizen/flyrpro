export type NormalizedReverseGeocode = {
  formatted: string;
  houseNumber: string | null;
  streetName: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
};

export type GoogleGeocodingResult = {
  formatted_address?: string;
  address_components?: Array<{
    long_name?: string;
    short_name?: string;
    types?: string[];
  }>;
};

function component(
  result: GoogleGeocodingResult,
  types: string[],
  name: 'long_name' | 'short_name' = 'long_name',
): string | null {
  for (const type of types) {
    const match = result.address_components?.find((candidate) => candidate.types?.includes(type));
    const value = match?.[name]?.trim();
    if (value) return value;
  }
  return null;
}

export function normalizeGoogleReverseGeocode(
  result: GoogleGeocodingResult | null | undefined,
): NormalizedReverseGeocode | null {
  if (!result) return null;
  const houseNumber = component(result, ['street_number']);
  const streetName = component(result, ['route']);
  const formatted = result.formatted_address?.trim() || [houseNumber, streetName].filter(Boolean).join(' ');
  if (!formatted) return null;

  return {
    formatted,
    houseNumber,
    streetName,
    locality: component(result, ['locality', 'postal_town', 'sublocality', 'administrative_area_level_2']),
    region: component(result, ['administrative_area_level_1'], 'short_name'),
    postalCode: component(result, ['postal_code']),
    country: component(result, ['country'], 'short_name'),
  };
}
