import { writeFileSync } from 'node:fs';
import * as turf from '@turf/turf';
import { BedrockCountryService, BEDROCK_US_CONFIG } from '../lib/services/BedrockCountryService';
import { fetchScopedPmtilesBuildingFeatures } from '../app/api/campaigns/_utils/scoped-pmtiles-buildings';
import { fetchScopedPmtilesParcels, parcelTilesFromSnapshot } from '../app/api/campaigns/_utils/scoped-pmtiles-parcels';
import { planGeometryTargets } from '../lib/services/CampaignGeometryTargets';
import { parseMapboxReverseResult } from '../lib/services/CampaignMapReconciliationService';
import { safeGeometryAddress } from '../lib/services/CampaignAddressEnrichmentService';

type Bounds = [number, number, number, number];
const candidates: Array<{ name: string; bbox: Bounds }> = [
  { name: 'Forks east', bbox: [-124.390, 47.946, -124.382, 47.952] },
  { name: 'Forks north', bbox: [-124.398, 47.952, -124.390, 47.958] },
  { name: 'Forks west', bbox: [-124.406, 47.946, -124.398, 47.952] },
  { name: 'Forks south', bbox: [-124.398, 47.940, -124.390, 47.946] },
];

function boundary([west, south, east, north]: Bounds): GeoJSON.Polygon {
  return { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
}

async function load(name: string, bbox: Bounds) {
  const campaignBoundary = boundary(bbox);
  const service = new BedrockCountryService(BEDROCK_US_CONFIG);
  const snapshot = await service.staticSnapshotForCampaign(`forks-neighbor-${name}`, 'WA');
  const row = {
    bucket: snapshot.bucket,
    prefix: snapshot.prefix,
    buildings_key: snapshot.s3_keys.buildings,
    addresses_key: snapshot.s3_keys.addresses,
    buildings_url: null,
    metadata_key: null,
    buildings_count: 0,
    created_at: null,
    tile_metrics: snapshot.metadata?.tile_metrics as Record<string, unknown>,
  };
  const tiles = parcelTilesFromSnapshot(row);
  if (!tiles) throw new Error('Parcel tiles are unavailable');
  const [addressResult, buildingResult, parcelResult] = await Promise.all([
    service.provisionCampaign({ campaignId: `forks-neighbor-${name}`, polygon: campaignBoundary, regionCode: 'WA', addressLimit: 1000 }),
    fetchScopedPmtilesBuildingFeatures(row, bbox, new Set(), campaignBoundary),
    fetchScopedPmtilesParcels(`forks-neighbor-${name}`, row, tiles, bbox, campaignBoundary, { residentialOnly: true }),
  ]);
  const buildings = buildingResult?.features ?? [];
  const parcels = parcelResult.parcels.map(parcel => ({
    type: 'Feature' as const,
    id: parcel.external_id,
    geometry: JSON.parse(parcel.geom),
    properties: { ...parcel.properties, parcel_id: parcel.external_id },
  }));
  const existing = addressResult.addresses.map((address, index) => ({
    id: `source-${index}`,
    coordinate: address.coordinate,
    gers_id: address.gers_id,
  }));
  const targets = planGeometryTargets({ boundary: campaignBoundary, buildings, parcels, existing, limit: 1000 });
  return { name, bbox, boundary: campaignBoundary, sourceAddresses: addressResult.addresses, buildings, parcels, targets };
}

async function main() {
  const scan = [];
  for (const candidate of candidates) {
    const result = await load(candidate.name, candidate.bbox);
    scan.push(result);
    console.log(JSON.stringify({
      name: result.name,
      bbox: result.bbox,
      sourceAddresses: result.sourceAddresses.length,
      buildings: result.buildings.length,
      parcels: result.parcels.length,
      propertyStops: result.targets.length,
      parcelStops: result.targets.filter(target => target.kind === 'parcel').length,
      buildingFallbacks: result.targets.filter(target => target.kind === 'building').length,
    }));
  }
  if (process.env.RUN_PERMANENT !== 'true') return;
  const selected = scan
    .filter(result => result.sourceAddresses.length === 0 && result.targets.length > 0)
    .sort((left, right) => right.targets.length - left.targets.length)[0];
  if (!selected) throw new Error('No zero-address neighboring area with property stops was found');
  const token = process.env.MAPBOX_TOKEN?.trim() || process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
  if (!token) throw new Error('Mapbox token is unavailable');
  const records = [];
  for (const [index, target] of selected.targets.entries()) {
    const [longitude, latitude] = target.coordinate;
    const url = new URL('https://api.mapbox.com/search/geocode/v6/reverse');
    for (const [key, value] of Object.entries({ longitude, latitude, types: 'address', limit: 1, permanent: true, access_token: token })) {
      url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const payload = response.ok ? await response.json() : { features: [] };
    const parsed = parseMapboxReverseResult(`neighbor-${index}`, payload);
    const accepted = safeGeometryAddress({
      id: `neighbor-${index}`,
      campaign_id: 'isolated-forks-neighbor',
      region: 'WA',
      geometry_target_geom: target.geometry,
      address_resolution_lease: 'diagnostic',
      address_resolution_permanent_allowed: true,
    }, parsed);
    records.push({ ...target, candidate: parsed ? { ...parsed, raw: undefined } : null, status: accepted ? 'confirmed' : 'unresolved' });
    if ((index + 1) % 10 === 0 || index + 1 === selected.targets.length) {
      console.log(JSON.stringify({ progress: index + 1, total: selected.targets.length }));
    }
  }
  const summary = {
    name: selected.name,
    bbox: selected.bbox,
    sourceAddresses: selected.sourceAddresses.length,
    buildings: selected.buildings.length,
    parcels: selected.parcels.length,
    propertyStops: records.length,
    confirmed: records.filter(record => record.status === 'confirmed').length,
    unresolved: records.filter(record => record.status === 'unresolved').length,
    permanentRequests: records.length,
    productionWrites: false,
  };
  writeFileSync('/private/tmp/wolfgrid-second-forks-results.json', JSON.stringify({ ...selected, records, summary }, null, 2));
  console.log(JSON.stringify(summary));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
