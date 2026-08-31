import type { BuildingFeatureCollection } from '@/types/map-buildings';
import {
  hasRenderableCampaignBuildings,
  resolveCampaignMapRenderer,
} from '../campaignRenderer';

let failures = 0;

function test(name: string, run: () => void) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}:`, error);
  }
}

function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
}

function buildings(geometry: object, featureType = 'matched_house') {
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', id: 'building-1', geometry, properties: { feature_type: featureType } }],
  } as unknown as BuildingFeatureCollection;
}

test('loading never chooses a renderer', () => {
  equal(resolveCampaignMapRenderer({
    dataResolved: false,
    hasRenderableBuildings: false,
    activeSession: false,
    sessionUses2D: false,
    mapboxAvailable: true,
    googleAvailable: true,
  }), null);
});

test('an empty resolved campaign uses Google 2D', () => {
  equal(resolveCampaignMapRenderer({
    dataResolved: true,
    hasRenderableBuildings: false,
    activeSession: false,
    sessionUses2D: false,
    mapboxAvailable: true,
    googleAvailable: true,
  }), 'google2D');
});

test('the self-serve demo prefers Mapbox even without building footprints', () => {
  equal(resolveCampaignMapRenderer({
    dataResolved: true,
    hasRenderableBuildings: false,
    activeSession: false,
    sessionUses2D: false,
    mapboxAvailable: true,
    googleAvailable: true,
    preferMapbox3D: true,
  }), 'mapbox3D');
});

test('a populated campaign uses Mapbox 3D', () => {
  equal(resolveCampaignMapRenderer({
    dataResolved: true,
    hasRenderableBuildings: true,
    activeSession: false,
    sessionUses2D: false,
    mapboxAvailable: true,
    googleAvailable: true,
  }), 'mapbox3D');
});

test('active sessions default to Mapbox and honor the 2D override', () => {
  const base = {
    dataResolved: true,
    hasRenderableBuildings: false,
    activeSession: true,
    mapboxAvailable: true,
    googleAvailable: true,
  };
  equal(resolveCampaignMapRenderer({ ...base, sessionUses2D: false }), 'mapbox3D');
  equal(resolveCampaignMapRenderer({ ...base, sessionUses2D: true }), 'google2D');
});

test('provider failures follow the required fallback matrix', () => {
  equal(resolveCampaignMapRenderer({
    dataResolved: true,
    hasRenderableBuildings: true,
    activeSession: true,
    sessionUses2D: false,
    mapboxAvailable: false,
    googleAvailable: true,
  }), 'google2D');
  equal(resolveCampaignMapRenderer({
    dataResolved: true,
    hasRenderableBuildings: false,
    activeSession: false,
    sessionUses2D: false,
    mapboxAvailable: true,
    googleAvailable: false,
  }), null);
});

test('only valid Polygon and MultiPolygon footprints count as buildings', () => {
  equal(hasRenderableCampaignBuildings(buildings({
    type: 'Polygon',
    coordinates: [[[-79, 43], [-79.001, 43], [-79, 43.001], [-79, 43]]],
  })), true);
  equal(hasRenderableCampaignBuildings(buildings({
    type: 'MultiPolygon',
    coordinates: [[[[-79, 43], [-79.001, 43], [-79, 43.001], [-79, 43]]]],
  })), true);
  equal(hasRenderableCampaignBuildings(buildings({ type: 'Point', coordinates: [-79, 43] })), false);
  equal(hasRenderableCampaignBuildings(buildings({
    type: 'Polygon',
    coordinates: [[[-79, 43], [-79.001, 43], [-79, 43.001], [-79, 43]]],
  }, 'manual_pin')), false);
});

if (failures > 0) process.exitCode = 1;
