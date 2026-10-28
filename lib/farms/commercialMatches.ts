/** Conservative matching for farm addresses. A place alone does not make a home commercial. */
export type FarmAddress = {
  id: string;
  houseNumber?: string | null;
  street?: string | null;
  locality?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type CommercialPlace = {
  id: string;
  houseNumber?: string | null;
  street?: string | null;
  locality?: string | null;
  latitude: number;
  longitude: number;
  /** The building containing the place, as established by a spatial join. */
  buildingId?: string | null;
};

export type FarmBuilding = {
  id: string;
  subtype?: string | null;
  /** Address IDs spatially associated with this building, not proximity guesses. */
  addressIds: string[];
};

export type FarmCommercialMatch = {
  addressId: string;
  placeId: string;
  buildingId: string;
};

function normalize(value?: string | null): string {
  return (value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function distanceMeters(a: FarmAddress, b: CommercialPlace): number {
  if (a.latitude == null || a.longitude == null) return Infinity;
  const radians = Math.PI / 180;
  const lat1 = a.latitude * radians;
  const lat2 = b.latitude * radians;
  const dLat = lat2 - lat1;
  const dLon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function findFarmCommercialMatches(
  addresses: FarmAddress[], places: CommercialPlace[], buildings: FarmBuilding[],
): FarmCommercialMatch[] {
  const buildingById = new Map(buildings.map(building => [building.id, building]));
  const matches: FarmCommercialMatch[] = [];
  for (const address of addresses) {
    const number = normalize(address.houseNumber);
    const street = normalize(address.street);
    const locality = normalize(address.locality);
    if (!number || !street || !locality) continue;
    const place = places.find(candidate => {
      const building = candidate.buildingId ? buildingById.get(candidate.buildingId) : undefined;
      return building?.subtype === 'commercial' && building.addressIds.includes(address.id)
        && building.addressIds.length === 1
        && normalize(candidate.houseNumber) === number && normalize(candidate.street) === street
        && normalize(candidate.locality) === locality && distanceMeters(address, candidate) <= 50;
    });
    if (place?.buildingId) matches.push({ addressId: address.id, placeId: place.id, buildingId: place.buildingId });
  }
  return matches;
}
