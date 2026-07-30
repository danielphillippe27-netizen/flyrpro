import { createClient } from '@supabase/supabase-js';
import * as turf from '@turf/turf';
import {
  CampaignMapReconciliationService,
  normalizedCivicAddressIdentity,
  type ReverseResult,
} from '../lib/services/CampaignMapReconciliationService';
import {
  readCurrentCampaignMapBundle,
  responseFromCampaignMapBundleRow,
} from '../lib/services/CampaignMapBundlePrebuilder';

type JsonRecord = Record<string, unknown>;
type Feature = GeoJSON.Feature<GeoJSON.Geometry, GeoJSON.GeoJsonProperties>;

const campaignId = process.env.REVERSE_TEST_CAMPAIGN_ID;
if (!campaignId) throw new Error('REVERSE_TEST_CAMPAIGN_ID is required');
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase production credentials are required');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildingId(feature: Feature): string {
  const properties = record(feature.properties);
  return text(
    properties.canonical_building_id ??
    properties.public_building_id ??
    properties.building_id ??
    properties.gers_id ??
    properties.id ??
    feature.id
  );
}

function addressId(feature: Feature): string {
  const properties = record(feature.properties);
  return text(properties.address_id ?? properties.id ?? feature.id);
}

function civicIdentity(feature: Feature): string {
  const properties = record(feature.properties);
  return normalizedCivicAddressIdentity({
    houseNumber: properties.house_number ?? properties.street_number,
    houseSuffix: properties.house_suffix,
    streetName: properties.street_name ?? properties.street,
    unit: properties.unit ?? properties.unit_number,
  });
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeRegion(value: unknown): string {
  const normalized = normalize(value);
  return normalized === 'ontario' ? 'on' : normalized;
}

function pointDistanceMeters(point: [number, number], feature: Feature): number {
  const turfPoint = turf.point(point);
  try {
    if (
      (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') &&
      turf.booleanPointInPolygon(turfPoint, feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)
    ) return 0;
    const boundary = turf.polygonToLine(
      feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
    );
    return turf.pointToLineDistance(turfPoint, boundary, { units: 'meters' });
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function main(): Promise<void> {
  const row = await readCurrentCampaignMapBundle(supabase, campaignId);
  if (!row) throw new Error('Campaign has no current map bundle');
  const bundle = responseFromCampaignMapBundleRow(row);
  const addresses = (record(bundle.addresses).features as Feature[] | undefined) ?? [];
  const buildings = ((record(bundle.buildings).features as Feature[] | undefined) ?? [])
    .filter((feature) =>
      feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon'
    );
  const links = Array.isArray(bundle.links) ? bundle.links as JsonRecord[] : [];
  const addressOrphans = new Set(
    (Array.isArray(bundle.address_orphans) ? bundle.address_orphans as JsonRecord[] : [])
      .map((orphan) => text(orphan.address_id).toLowerCase())
      .filter(Boolean)
  );
  const addressById = new Map(
    addresses.map((feature) => [addressId(feature).toLowerCase(), feature])
  );
  const addressesByCivic = new Map<string, Feature[]>();
  for (const address of addresses) {
    const identity = civicIdentity(address);
    addressesByCivic.set(identity, [...(addressesByCivic.get(identity) ?? []), address]);
  }
  const linksByBuilding = new Map<string, JsonRecord[]>();
  for (const link of links) {
    const id = text(link.building_id ?? link.buildingId).toLowerCase();
    if (id) linksByBuilding.set(id, [...(linksByBuilding.get(id) ?? []), link]);
  }
  const campaignLocalities = new Set(addresses
    .map((address) => normalize(record(address.properties).locality))
    .filter(Boolean));
  const campaignRegions = new Set(addresses
    .map((address) => normalizeRegion(
      record(address.properties).region ??
      record(address.properties).province ??
      record(address.properties).state
    ))
    .filter(Boolean));
  const campaignPostals = new Set(addresses
    .map((address) => normalize(record(address.properties).postal_code).replaceAll(' ', ''))
    .filter(Boolean));

  const reverse = new CampaignMapReconciliationService(supabase) as unknown as {
    reverseGeocode(point: [number, number]): Promise<ReverseResult | null>;
  };
  const rows: JsonRecord[] = [];
  for (let index = 0; index < buildings.length; index += 1) {
    const building = buildings[index];
    const id = buildingId(building);
    const anchor = turf.pointOnFeature(building as GeoJSON.Feature).geometry.coordinates as [number, number];
    let result: ReverseResult | null = null;
    try {
      result = await reverse.reverseGeocode(anchor);
    } catch {
      // A provider failure stays in the report rather than aborting the comparison.
    }
    const buildingLinks = linksByBuilding.get(id.toLowerCase()) ?? [];
    const linkedAddress = buildingLinks[0]
      ? addressById.get(text(buildingLinks[0].address_id).toLowerCase())
      : null;
    if (!result) {
      rows.push({ building_id: id, outcome: 'no_reverse_result', currently_linked: buildingLinks.length > 0 });
      continue;
    }
    const distance = pointDistanceMeters([result.longitude, result.latitude], building);
    const localityMatches = campaignLocalities.size === 0 ||
      Boolean(result.locality && campaignLocalities.has(normalize(result.locality)));
    const regionMatches = campaignRegions.size === 0 ||
      Boolean(result.region && campaignRegions.has(normalizeRegion(result.region)));
    const postalMatches = campaignPostals.size === 0 ||
      Boolean(result.postalCode &&
        campaignPostals.has(normalize(result.postalCode).replaceAll(' ', '')));
    const strong = (
      (result.accuracy === 'rooftop' || result.accuracy === 'parcel') &&
      distance <= 12 &&
      localityMatches &&
      regionMatches &&
      postalMatches
    );
    if (!strong) {
      rows.push({
        building_id: id,
        outcome: !postalMatches
          ? 'postal_mismatch'
          : distance > 12
            ? 'reverse_point_too_far'
            : 'weak_reverse_accuracy',
        currently_linked: buildingLinks.length > 0,
        reverse_address: result.formatted,
        accuracy: result.accuracy,
        distance_m: Number(distance.toFixed(1)),
      });
      continue;
    }
    const reverseCivic = normalizedCivicAddressIdentity({
      houseNumber: result.houseNumber,
      streetName: result.streetName,
    });
    const equivalents = addressesByCivic.get(reverseCivic) ?? [];
    if (linkedAddress) {
      const linkedAddresses = buildingLinks.flatMap((link) => {
        const address = addressById.get(text(link.address_id).toLowerCase());
        return address ? [address] : [];
      });
      const agreeingAddress = linkedAddresses.find((address) =>
        civicIdentity(address) === reverseCivic
      );
      rows.push({
        building_id: id,
        outcome: agreeingAddress
          ? 'initial_link_agrees'
          : 'initial_link_conflicts',
        current_address: text(record((agreeingAddress ?? linkedAddress).properties).formatted),
        reverse_address: result.formatted,
        current_match_type: text(buildingLinks[0].match_type ?? buildingLinks[0].matchType),
        current_confidence: buildingLinks[0].confidence,
        current_distance_m: buildingLinks[0].distance_meters,
        accuracy: result.accuracy,
        reverse_distance_m: Number(distance.toFixed(1)),
      });
      continue;
    }
    const orphanEquivalent = equivalents.filter((address) =>
      addressOrphans.has(addressId(address).toLowerCase())
    );
    rows.push({
      building_id: id,
      outcome: orphanEquivalent.length === 1
        ? 'orphan_address_match'
        : equivalents.length > 0
          ? 'address_linked_elsewhere'
          : 'missing_address',
      reverse_address: result.formatted,
      accuracy: result.accuracy,
      reverse_distance_m: Number(distance.toFixed(1)),
      equivalent_addresses: equivalents.length,
    });
  }

  const counts = rows.reduce<Record<string, number>>((summary, item) => {
    const key = text(item.outcome);
    summary[key] = (summary[key] ?? 0) + 1;
    return summary;
  }, {});
  const conflictsBySource = rows
    .filter((item) => item.outcome === 'initial_link_conflicts')
    .reduce<Record<string, number>>((summary, item) => {
      const key = text(item.current_match_type) || 'unknown';
      summary[key] = (summary[key] ?? 0) + 1;
      return summary;
    }, {});

  console.log(JSON.stringify({
    campaign_id: campaignId,
    bundle_signature: row.asset_signature,
    addresses: addresses.length,
    buildings: buildings.length,
    links: links.length,
    counts,
    conflicts_by_current_match_type: conflictsBySource,
    conflict_samples: rows.filter((item) => item.outcome === 'initial_link_conflicts').slice(0, 25),
    orphan_samples: rows
      .filter((item) => ['orphan_address_match', 'address_linked_elsewhere', 'missing_address'].includes(text(item.outcome)))
      .slice(0, 25),
  }, null, 2));
}

void main();
