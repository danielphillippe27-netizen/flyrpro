import { distance } from '@turf/turf';

export type DurhamPlace = {
  id: string; names?: { primary?: string | null } | null;
  addresses?: { freeform?: string | null }[] | null;
  basic_category?: string | null; operating_status?: string | null;
  taxonomy?: { hierarchy?: string[] | null } | null;
  lon: number; lat: number;
};
export type DurhamFarmAddress = {
  id: string; formatted: string; house_number: string | null; street_name: string | null;
  latitude: number | null; longitude: number | null;
};
export type DurhamPlaceMatch = { addressId: string; address: string; places: { id: string; name: string; category: string | null; distanceMeters: number }[] };

function normalizeAddress(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(street|st)\b/g, 'st').replace(/\b(road|rd)\b/g, 'rd')
    .replace(/\b(avenue|ave)\b/g, 'ave').replace(/\b(west|w)\b/g, 'w')
    .replace(/\b(east|e)\b/g, 'e').replace(/\b(north|n)\b/g, 'n')
    .replace(/\b(south|s)\b/g, 's').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Review suggestions only: neither a place nor proximity proves a building is commercial-only. */
export function findDurhamPlaceMatches(addresses: DurhamFarmAddress[], places: DurhamPlace[]): DurhamPlaceMatch[] {
  const byAddress = new Map<string, DurhamPlace[]>();
  const residentialByAddress = new Map<string, DurhamPlace[]>();
  const businessCategories = new Set(['services_and_business', 'lifestyle_services', 'shopping', 'food_and_drink', 'health_care', 'lodging']);
  const residentialCategories = new Set(['senior_living_facility', 'retirement_home', 'assisted_living_facility', 'apartment', 'service_apartment', 'mobile_home_park', 'condominium']);
  for (const place of places) {
    if (place.operating_status === 'permanently_closed' || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;
    const hierarchy = place.taxonomy?.hierarchy ?? [];
    const residential = hierarchy.some(category => residentialCategories.has(category));
    if (!residential && !businessCategories.has(hierarchy[0] ?? '')) continue;
    for (const address of place.addresses ?? []) {
      if (!address.freeform) continue;
      const key = normalizeAddress(address.freeform);
      const index = residential ? residentialByAddress : byAddress;
      const current = index.get(key) ?? [];
      current.push(place); index.set(key, current);
    }
  }
  return addresses.flatMap(address => {
    if (!address.house_number || !address.street_name || address.latitude == null || address.longitude == null) return [];
    const key = normalizeAddress(`${address.house_number} ${address.street_name}`);
    if ((residentialByAddress.get(key) ?? []).some(place => distance([address.longitude!, address.latitude!], [place.lon, place.lat], { units: 'meters' }) <= 50)) return [];
    const candidates = (byAddress.get(key) ?? []).flatMap(place => {
      const meters = distance([address.longitude!, address.latitude!], [place.lon, place.lat], { units: 'meters' });
      return meters <= 50 ? [{ id: place.id, name: place.names?.primary || 'Unnamed place', category: place.basic_category ?? null, distanceMeters: Math.round(meters) }] : [];
    });
    return candidates.length ? [{ addressId: address.id, address: address.formatted, places: candidates }] : [];
  });
}
