export type ParcelClickLngLat = {
  lng?: number;
  lat?: number;
  lon?: number;
};

export type ParcelClickPayload = {
  parcelId?: string | null;
  externalParcelId?: string | null;
  featureId?: string | number | null;
  properties?: Record<string, unknown> | null;
  lngLat?: ParcelClickLngLat | null;
};

export type ParcelResolutionAddress = {
  id: string;
  buildingId?: string | null;
  lon?: number | null;
  lat?: number | null;
};

export type ParcelResolutionParcel = {
  id: string;
  externalId?: string | null;
  properties?: Record<string, unknown> | null;
};

export type ParcelMapTargetResolution = {
  buildingId: string | null;
  addressId: string | null;
  parcelId: string | null;
  linkedAddressIds: string[];
  isParcelOnly: boolean;
};

const PARCEL_ID_KEYS = [
  'parcel_row_id',
  'campaign_parcel_id',
  'parcel_id',
  'external_id',
  'PARCELID',
  'gisid',
  'roll_number',
  'id',
];

const DIRECT_ADDRESS_KEYS = [
  'address_id',
  'campaign_address_id',
  'campaignAddressId',
];

const LINKED_ADDRESS_KEYS = [
  'linked_address_ids',
  'address_ids',
];

const BUILDING_ID_KEYS = [
  'building_id',
  'building_gers_id',
  'gers_id',
  'public_building_id',
  'canonical_building_id',
];

export function stringValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = String(value).trim();
    return normalized || null;
  }
  return null;
}

function normalizedKey(value: unknown): string | null {
  return stringValue(value)?.toLowerCase() ?? null;
}

function firstStringProperty(properties: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(properties[key]);
    if (value) return value;
  }
  return null;
}

function stringListValue(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(stringListValue);
  }

  if (typeof value === 'number') {
    return [String(value)];
  }

  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      return stringListValue(JSON.parse(trimmed));
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  return trimmed
    .split(/[,\s;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function parcelIdentityCandidates(payload: ParcelClickPayload): string[] {
  const properties = payload.properties ?? {};
  return uniqueStrings([
    payload.parcelId,
    payload.externalParcelId,
    stringValue(payload.featureId),
    ...PARCEL_ID_KEYS.map((key) => stringValue(properties[key])),
  ]);
}

function parcelMatches(parcel: ParcelResolutionParcel, candidateKeys: Set<string>): boolean {
  const properties = parcel.properties ?? {};
  const parcelKeys = [
    parcel.id,
    parcel.externalId,
    ...PARCEL_ID_KEYS.map((key) => stringValue(properties[key])),
  ]
    .map(normalizedKey)
    .filter((value): value is string => Boolean(value));

  return parcelKeys.some((key) => candidateKeys.has(key));
}

function findParcel(
  payload: ParcelClickPayload,
  parcels: ParcelResolutionParcel[]
): ParcelResolutionParcel | null {
  const candidates = parcelIdentityCandidates(payload);
  const candidateKeys = new Set(candidates.map((value) => value.toLowerCase()));
  if (candidateKeys.size === 0) return null;
  return parcels.find((parcel) => parcelMatches(parcel, candidateKeys)) ?? null;
}

function collectLinkedAddressIds(
  payload: ParcelClickPayload,
  parcel: ParcelResolutionParcel | null
): string[] {
  const payloadProperties = payload.properties ?? {};
  const parcelProperties = parcel?.properties ?? {};
  const directIds = [
    ...DIRECT_ADDRESS_KEYS.map((key) => stringValue(payloadProperties[key])),
    ...DIRECT_ADDRESS_KEYS.map((key) => stringValue(parcelProperties[key])),
  ];
  const linkedIds = [
    ...LINKED_ADDRESS_KEYS.flatMap((key) => stringListValue(payloadProperties[key])),
    ...LINKED_ADDRESS_KEYS.flatMap((key) => stringListValue(parcelProperties[key])),
  ];

  return uniqueStrings([...directIds, ...linkedIds]);
}

function coordinateFromClick(payload: ParcelClickPayload): { lon: number; lat: number } | null {
  const lon = payload.lngLat?.lng ?? payload.lngLat?.lon;
  const lat = payload.lngLat?.lat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon: lon as number, lat: lat as number };
}

function squaredDistance(
  lhs: { lon: number; lat: number },
  rhs: { lon?: number | null; lat?: number | null }
): number | null {
  if (!Number.isFinite(rhs.lon) || !Number.isFinite(rhs.lat)) return null;
  const dx = lhs.lon - (rhs.lon as number);
  const dy = lhs.lat - (rhs.lat as number);
  return dx * dx + dy * dy;
}

function chooseAddress(
  linkedAddressIds: string[],
  addresses: ParcelResolutionAddress[],
  clickCoordinate: { lon: number; lat: number } | null
): ParcelResolutionAddress | null {
  if (linkedAddressIds.length === 0) return null;
  const linkedKeys = new Set(linkedAddressIds.map((id) => id.toLowerCase()));
  const candidates = addresses.filter((address) => linkedKeys.has(address.id.toLowerCase()));
  if (candidates.length === 0) return null;
  if (candidates.length === 1 || !clickCoordinate) return candidates[0];

  return candidates
    .map((address) => ({ address, distance: squaredDistance(clickCoordinate, address) }))
    .sort((lhs, rhs) => (lhs.distance ?? Number.POSITIVE_INFINITY) - (rhs.distance ?? Number.POSITIVE_INFINITY))[0]
    ?.address ?? candidates[0];
}

export function resolveParcelMapTarget(params: {
  payload: ParcelClickPayload;
  parcels: ParcelResolutionParcel[];
  addresses: ParcelResolutionAddress[];
}): ParcelMapTargetResolution {
  const parcel = findParcel(params.payload, params.parcels);
  const properties = {
    ...(parcel?.properties ?? {}),
    ...(params.payload.properties ?? {}),
  };
  const parcelId =
    parcel?.id ??
    params.payload.parcelId ??
    firstStringProperty(properties, ['parcel_row_id', 'campaign_parcel_id']) ??
    firstStringProperty(properties, PARCEL_ID_KEYS) ??
    stringValue(params.payload.featureId);
  const linkedAddressIds = collectLinkedAddressIds(params.payload, parcel);
  const selectedAddress = chooseAddress(
    linkedAddressIds,
    params.addresses,
    coordinateFromClick(params.payload)
  );
  const buildingId =
    selectedAddress?.buildingId ??
    firstStringProperty(properties, BUILDING_ID_KEYS);
  const addressId = selectedAddress?.id ?? null;

  return {
    buildingId: buildingId ?? null,
    addressId,
    parcelId: parcelId ?? null,
    linkedAddressIds,
    isParcelOnly: !buildingId && !addressId,
  };
}
