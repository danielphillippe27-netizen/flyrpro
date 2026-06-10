/**
 * Run with: npx tsx lib/__tests__/scopedPmtilesParcels.test.ts
 */

import {
  featureWithinParcelCampaignScope,
  getParcelFeatureExternalId,
  isDisplayableParcelFeature,
  isResidentialParcelFeature,
  parcelTilesFromSnapshot,
  parseParcelBbox,
  tileRangeForParcelBbox,
} from '../../app/api/campaigns/_utils/scoped-pmtiles-parcels';
import type { CampaignSnapshotRow } from '../diamond/geometry';

function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value: unknown, message?: string) {
  if (!value) throw new Error(message ?? 'Expected truthy value');
}

function assertFalse(value: unknown, message?: string) {
  if (value) throw new Error(message ?? 'Expected falsey value');
}

function feature(
  geometry: GeoJSON.Geometry,
  properties: Record<string, unknown> = {},
  id?: string | number
): GeoJSON.Feature {
  return {
    type: 'Feature',
    id,
    geometry,
    properties,
  };
}

function snapshot(tileMetrics: Record<string, unknown>): CampaignSnapshotRow {
  return {
    bucket: 'flyr-pro-addresses-2025',
    prefix: 'bedrock/canada/current',
    buildings_key: null,
    addresses_key: null,
    buildings_url: null,
    metadata_key: null,
    buildings_count: 0,
    created_at: '2026-05-29T00:00:00.000Z',
    tile_metrics: tileMetrics,
  };
}

const tests: Array<[string, () => void]> = [
  [
    'selects the highest bounded parcel tile range within the scan budget',
    () => {
      const range = tileRangeForParcelBbox([-78.7842255, 43.9225422, -78.7774978, 43.9268414], 16);
      assertTrue(range, 'Expected a tile range');
      assertEqual(range?.z, 16);
      const tileCount = ((range?.maxX ?? 0) - (range?.minX ?? 0) + 1) * ((range?.maxY ?? 0) - (range?.minY ?? 0) + 1);
      assertTrue(tileCount <= 64, `Expected <=64 tiles, got ${tileCount}`);
    },
  ],
  [
    'parses only valid lon/lat bbox arrays',
    () => {
      assertEqual(parseParcelBbox(['-78.8', '43.9', '-78.7', '44']), [-78.8, 43.9, -78.7, 44]);
      assertEqual(parseParcelBbox(['-78.8', 'oops', '-78.7', '44']), null);
      assertEqual(parseParcelBbox([-78.8, 43.9, -78.7]), null);
    },
  ],
  [
    'extracts parcel ids using current priority order',
    () => {
      assertEqual(getParcelFeatureExternalId(feature({ type: 'Point', coordinates: [0, 0] }, { parcel_id: 'p-1', external_id: 'e-1' })), 'p-1');
      assertEqual(getParcelFeatureExternalId(feature({ type: 'Point', coordinates: [0, 0] }, { custom_pid: 'custom-1', parcel_id: 'p-1' }), 'custom_pid'), 'custom-1');
      assertEqual(getParcelFeatureExternalId(feature({ type: 'Point', coordinates: [0, 0] }, { PARCELID: 42 })), '42');
      assertEqual(getParcelFeatureExternalId(feature({ type: 'Point', coordinates: [0, 0] }, {}, 'feature-id')), 'feature-id');
    },
  ],
  [
    'displayable parcel filter only rejects non-doorable keyword parcels',
    () => {
      assertTrue(isDisplayableParcelFeature(feature({ type: 'Point', coordinates: [0, 0] }, { parcel_intent: 'commercial condominium' })));
      assertTrue(isDisplayableParcelFeature(feature({ type: 'Point', coordinates: [0, 0] }, { topology_type: 'secondary' })));
      assertTrue(isDisplayableParcelFeature(feature({ type: 'Point', coordinates: [0, 0] }, { name: 'Courtice Heights' })));
      assertTrue(isDisplayableParcelFeature(feature({ type: 'Point', coordinates: [0, 0] }, { street_name: 'Moyse Drive' })));
      assertFalse(isDisplayableParcelFeature(feature({ type: 'Point', coordinates: [0, 0] }, { parcel_intent: 'road allowance' })));
      assertFalse(isDisplayableParcelFeature(feature({ type: 'Point', coordinates: [0, 0] }, { land_use: 'public park' })));
      assertFalse(isDisplayableParcelFeature(feature({ type: 'Point', coordinates: [0, 0] }, { raw_attributes: { COMMENT: 'stormwater management pond' } })));
      assertFalse(isDisplayableParcelFeature(feature({ type: 'Point', coordinates: [0, 0] }, {
        area_sqm: 65,
        raw_attributes: { Shape__Length: 610 },
      })));
    },
  ],
  [
    'keeps residential parcel features and rejects non-residential terms',
    () => {
      assertTrue(isResidentialParcelFeature(feature({ type: 'Point', coordinates: [0, 0] }, { parcel_intent: 'residential' })));
      assertTrue(isResidentialParcelFeature(feature({ type: 'Point', coordinates: [0, 0] }, {})));
      assertFalse(isResidentialParcelFeature(feature({ type: 'Point', coordinates: [0, 0] }, { parcel_intent: 'road allowance' })));
      assertFalse(isResidentialParcelFeature(feature({ type: 'Point', coordinates: [0, 0] }, { topology_type: 'secondary' })));
    },
  ],
  [
    'checks bbox and polygon scope using centers and vertices',
    () => {
      const boundary: GeoJSON.Polygon = {
        type: 'Polygon',
        coordinates: [[
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ]],
      };
      const inside = feature({
        type: 'Polygon',
        coordinates: [[
          [0.2, 0.2],
          [0.4, 0.2],
          [0.4, 0.4],
          [0.2, 0.4],
          [0.2, 0.2],
        ]],
      });
      const crossing = feature({
        type: 'Polygon',
        coordinates: [[
          [0.8, 0.8],
          [1.4, 0.8],
          [1.4, 1.4],
          [0.8, 1.4],
          [0.8, 0.8],
        ]],
      });
      const outside = feature({
        type: 'Polygon',
        coordinates: [[
          [2, 2],
          [3, 2],
          [3, 3],
          [2, 3],
          [2, 2],
        ]],
      });
      assertTrue(featureWithinParcelCampaignScope(inside, [0, 0, 1, 1], boundary));
      assertTrue(featureWithinParcelCampaignScope(crossing, [0, 0, 1, 1], boundary));
      assertFalse(featureWithinParcelCampaignScope(outside, [0, 0, 1, 1], boundary));
    },
  ],
  [
    'resolves explicit parcel PMTiles and New Zealand derived parcel PMTiles',
    () => {
      assertEqual(
        parcelTilesFromSnapshot(snapshot({
          parcels_pmtiles_key: 'diamond/parcels/canada/on/durham/parcels.pmtiles',
          source_layers: { parcels: 'land_parcels' },
          promote_ids: { parcels: 'custom_pid' },
        }))?.pmtilesKey,
        'diamond/parcels/canada/on/durham/parcels.pmtiles'
      );
      assertEqual(
        parcelTilesFromSnapshot(snapshot({
          parcels_pmtiles_key: 'diamond/parcels/canada/on/durham/parcels.pmtiles',
          source_layers: { parcels: 'land_parcels' },
          promote_ids: { parcels: 'custom_pid' },
        }))?.sourceLayer,
        'land_parcels'
      );
      assertEqual(
        parcelTilesFromSnapshot(snapshot({
          parcels_pmtiles_key: 'diamond/parcels/canada/on/durham/parcels.pmtiles',
          source_layers: { parcels: 'land_parcels' },
          promote_ids: { parcels: 'custom_pid' },
        }))?.promoteId,
        'custom_pid'
      );
      assertEqual(
        parcelTilesFromSnapshot(snapshot({
          bedrock_mode: true,
          bedrock_country_code: 'NZ',
          pmtiles_key: 'bedrock/new-zealand/current/buildings/buildings.pmtiles',
        }))?.pmtilesKey,
        'bedrock/new-zealand/current/parcels/parcels.pmtiles'
      );
    },
  ],
];

let passed = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`PASS ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

console.log(`\n${passed} passed, ${tests.length - passed} failed`);
