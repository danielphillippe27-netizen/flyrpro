export interface AddressPresentationInput {
  house_number?: string | null;
  street_name?: string | null;
  formatted?: string | null;
}

interface HouseNumberSortParts {
  number: number | null;
  suffix: string;
  raw: string;
}

function clean(value?: string | null): string {
  return (value ?? '').trim();
}

function firstStreetSegment(formatted?: string | null): string {
  const value = clean(formatted);
  return value.split(',', 1)[0]?.trim() ?? value;
}

export function resolveHouseNumberLabel(address: AddressPresentationInput): string | null {
  const directHouseNumber = clean(address.house_number);
  if (directHouseNumber) {
    return directHouseNumber;
  }

  const firstToken = firstStreetSegment(address.formatted).split(/\s+/, 1)[0]?.trim() ?? '';
  return firstToken || null;
}

export function normalizedStreetName(address: AddressPresentationInput): string {
  const explicitStreet = clean(address.street_name);
  if (explicitStreet) {
    return explicitStreet;
  }

  return firstStreetSegment(address.formatted)
    .replace(/^\s*\d+[A-Za-z-]*\s+/, '')
    .trim();
}

export function displayAddressText(address: AddressPresentationInput): string | null {
  const formattedValue = clean(address.formatted);
  if (formattedValue) {
    return formattedValue;
  }

  const combined = `${clean(address.house_number)} ${clean(address.street_name)}`.trim();
  return combined || null;
}

export function houseNumberSortParts(address: AddressPresentationInput): HouseNumberSortParts {
  const rawValue = (resolveHouseNumberLabel(address) ?? '').toUpperCase();
  const match = rawValue.match(/^\d+/);

  if (!match) {
    return { number: null, suffix: rawValue, raw: rawValue };
  }

  return {
    number: Number.parseInt(match[0], 10),
    suffix: rawValue.slice(match[0].length).trim(),
    raw: rawValue,
  };
}

export function compareAddressesForDisplay(
  left: AddressPresentationInput,
  right: AddressPresentationInput
): number {
  const leftStreet = normalizedStreetName(left);
  const rightStreet = normalizedStreetName(right);
  const streetCompare = leftStreet.localeCompare(rightStreet, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (streetCompare !== 0) return streetCompare;

  const leftHouse = houseNumberSortParts(left);
  const rightHouse = houseNumberSortParts(right);

  if (leftHouse.number !== rightHouse.number) {
    if (leftHouse.number === null) return 1;
    if (rightHouse.number === null) return -1;
    return leftHouse.number - rightHouse.number;
  }

  const suffixCompare = leftHouse.suffix.localeCompare(rightHouse.suffix, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (suffixCompare !== 0) return suffixCompare;

  const rawCompare = leftHouse.raw.localeCompare(rightHouse.raw, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
  if (rawCompare !== 0) return rawCompare;

  const leftFormatted = clean(left.formatted) || `${clean(left.house_number)} ${clean(left.street_name)}`.trim();
  const rightFormatted = clean(right.formatted) || `${clean(right.house_number)} ${clean(right.street_name)}`.trim();
  return leftFormatted.localeCompare(rightFormatted, undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}
