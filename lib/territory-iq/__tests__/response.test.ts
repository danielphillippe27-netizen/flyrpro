import assert from 'node:assert/strict';
import * as wkx from 'wkx';
import {
  decodeTerritoryIQGeometry,
  responseFromRows,
  territoryIQRowsHaveData,
  type CellRow,
  type ScoreRow,
} from '@/app/api/campaigns/[campaignId]/territory-iq/_response';
import type { TerritoryIQFactor } from '../types';

const factor = (score: number): TerritoryIQFactor => ({
  key: 'canvassability',
  label: 'Canvassability',
  rawValue: score,
  rawUnit: 'target homes / km²',
  score,
  configuredWeight: 100,
  effectiveWeight: 100,
  confidence: 0.8,
  available: true,
  source: 'fixture',
  areaEstimate: false,
  contribution: score,
});

const scoreRow: ScoreRow = {
  id: 'score-1',
  status: 'ready',
  score: 65,
  confidence: 0.8,
  confidence_label: 'high',
  target_home_count: 4,
  model_key: 'generic',
  model_name: 'Field Sales',
  model_version: 'grid-score-v1',
  benchmark: 'Toronto',
  explanation: 'Fixture',
  factors: [factor(65)],
  sources: [],
  insights: [],
  missing_factors: [],
  calculated_at: '2026-07-30T00:00:00.000Z',
};

const polygon = (offset: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [[
    [offset, 0],
    [offset + 0.01, 0],
    [offset + 0.01, 0.01],
    [offset, 0.01],
    [offset, 0],
  ]],
});

const ewkbPolygon = wkx.Geometry.parseGeoJSON(polygon(2)).toEwkb().toString('hex');
assert.deepEqual(decodeTerritoryIQGeometry(ewkbPolygon), polygon(2));

const cells: CellRow[] = [
  {
    cell_key: 'a',
    geom: polygon(0),
    target_home_count: 1,
    target_address_ids: ['home-a'],
    score: 80,
    confidence: 0.8,
    confidence_label: 'high',
    rank: 1,
    factors: [factor(80)],
    census_dguid: 'da-a',
  },
  {
    cell_key: 'b',
    geom: polygon(1),
    target_home_count: 3,
    target_address_ids: ['home-b', 'home-c', 'home-d'],
    score: 60,
    confidence: 0.8,
    confidence_label: 'high',
    rank: 2,
    factors: [factor(60)],
    census_dguid: 'da-b',
  },
];

const owner = responseFromRows(scoreRow, cells, null);
assert.equal(owner.overall.score, 65);
assert.equal(owner.cells.features.length, 2);
assert.equal(territoryIQRowsHaveData(scoreRow, cells, null), true);

const member = responseFromRows(scoreRow, cells, new Set(['home-a']));
assert.equal(member.overall.score, 80);
assert.equal(member.overall.targetHomeCount, 1);
assert.equal(member.cells.features.length, 1);
assert.match(member.overall.explanation, /assigned homes/);

const unassigned = responseFromRows(scoreRow, cells, new Set());
assert.equal(unassigned.status, 'insufficient_data');
assert.equal(unassigned.overall.score, null);
assert.equal(unassigned.cells.features.length, 0);
assert.equal(territoryIQRowsHaveData(scoreRow, cells, new Set()), false);

assert.equal(territoryIQRowsHaveData({ score: null }, cells, null), false);

const encoded = responseFromRows(
  scoreRow,
  [{ ...cells[0], geom: ewkbPolygon }],
  null
);
assert.deepEqual(encoded.cells.features[0].geometry, polygon(2));

console.log('Territory IQ response scoping tests passed');
