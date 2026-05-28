export type AddressIdentityInput = {
  houseNumber?: unknown;
  streetName?: unknown;
  postalCode?: unknown;
  formatted?: unknown;
};

export type NormalizedAddressIdentity = {
  primary: string;
  postalCode: string | null;
};

function normalizeHouseNumber(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return normalized.length > 0 ? normalized : null;
}

function normalizePostalCode(value: unknown): string | null {
  const normalized = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return normalized.length > 0 ? normalized : null;
}

function normalizeStreetName(value: unknown): string | null {
  const words = String(value ?? "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => {
      switch (word) {
        case "st":
        case "str":
          return "street";
        case "rd":
          return "road";
        case "ave":
        case "av":
          return "avenue";
        case "blvd":
          return "boulevard";
        case "dr":
          return "drive";
        case "ct":
          return "court";
        case "cres":
          return "crescent";
        case "ln":
          return "lane";
        case "pl":
          return "place";
        case "trl":
          return "trail";
        case "pkwy":
          return "parkway";
        case "hwy":
          return "highway";
        default:
          return word;
      }
    });
  const normalized = words.join(" ").trim();
  return normalized.length > 0 ? normalized : null;
}

function parseFormattedAddress(formatted: unknown) {
  const text = String(formatted ?? "").trim();
  if (!text) {
    return { houseNumber: null, streetName: null, postalCode: null };
  }

  const firstLine = text.split(",")[0] ?? text;
  const [rawHouseNumber, ...rawStreetParts] = firstLine.trim().split(/\s+/);
  const postalCandidates = text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(normalizePostalCode)
    .filter((value): value is string => Boolean(value));
  const postalCode = [...postalCandidates]
    .reverse()
    .find((value) => value.length >= 4 && value.length <= 10 && /\d/.test(value)) ?? null;

  return {
    houseNumber: normalizeHouseNumber(rawHouseNumber),
    streetName: normalizeStreetName(rawStreetParts.join(" ")),
    postalCode,
  };
}

export function normalizedAddressIdentity(
  input: AddressIdentityInput
): NormalizedAddressIdentity | null {
  const parsed = parseFormattedAddress(input.formatted);
  const houseNumber = normalizeHouseNumber(input.houseNumber) ?? parsed.houseNumber;
  const streetName = normalizeStreetName(input.streetName) ?? parsed.streetName;
  if (!houseNumber || !streetName) return null;

  return {
    primary: `${houseNumber}|${streetName}`,
    postalCode: normalizePostalCode(input.postalCode) ?? parsed.postalCode,
  };
}

export function addressIdentitiesMatch(
  incoming: NormalizedAddressIdentity | null,
  existing: NormalizedAddressIdentity | null
): boolean {
  if (!incoming || !existing || incoming.primary !== existing.primary) return false;
  if (incoming.postalCode && existing.postalCode) {
    return incoming.postalCode === existing.postalCode;
  }
  return true;
}
