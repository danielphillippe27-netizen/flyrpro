import assert from 'node:assert/strict';
import type mapboxgl from 'mapbox-gl';
import {
  applyPresetVisualTweaks,
  classifyWhiteOutRoadLayer,
  type ResolvedMapStyle,
} from '../map-styles';

assert.equal(classifyWhiteOutRoadLayer({ id: 'road-simple', type: 'line', 'source-layer': 'road' }), 'surface');
assert.equal(classifyWhiteOutRoadLayer({ id: 'bridge-case-simple', type: 'line', 'source-layer': 'road' }), 'casing');
assert.equal(classifyWhiteOutRoadLayer({ id: 'road-path', type: 'line', 'source-layer': 'road' }), 'path');
assert.equal(classifyWhiteOutRoadLayer({ id: 'road-rail', type: 'line', 'source-layer': 'road' }), 'rail');
assert.equal(classifyWhiteOutRoadLayer({ id: 'road-label-simple', type: 'symbol', 'source-layer': 'road' }), 'label');
assert.equal(classifyWhiteOutRoadLayer({ id: 'waterway-label', type: 'symbol', 'source-layer': 'waterway_label' }), null);

const layers = [
  { id: 'background', type: 'background' },
  { id: 'water', type: 'fill', 'source-layer': 'water' },
  { id: 'road-simple', type: 'line', 'source-layer': 'road' },
  { id: 'bridge-case-simple', type: 'line', 'source-layer': 'road' },
  { id: 'road-label-simple', type: 'symbol', 'source-layer': 'road' },
  { id: 'campaign-road-overlay', type: 'line', 'source-layer': 'road' },
] as mapboxgl.AnyLayer[];

const paintChanges = new Map<string, unknown>();
const layoutChanges = new Map<string, unknown>();
const fakeMap = {
  getStyle: () => ({ layers }),
  setPaintProperty: (layerId: string, property: string, value: unknown) => {
    paintChanges.set(`${layerId}:${property}`, value);
  },
  setLayoutProperty: (layerId: string, property: string, value: unknown) => {
    layoutChanges.set(`${layerId}:${property}`, value);
  },
} as unknown as mapboxgl.Map;

const whiteOutStyle: ResolvedMapStyle = {
  key: 'whiteOut:light-v11',
  style: 'mapbox://styles/mapbox/light-v11',
};

applyPresetVisualTweaks(fakeMap, whiteOutStyle, {
  preserveLayerPrefixes: ['campaign-'],
});

assert.equal(paintChanges.get('background:background-color'), '#f8fafc');
assert.equal(paintChanges.get('water:fill-color'), '#eaf2f8');
assert.deepEqual(paintChanges.get('road-simple:line-color'), [
  'match',
  ['get', 'class'],
  ['motorway', 'trunk', 'primary'],
  '#d7e0ea',
  ['secondary', 'tertiary'],
  '#dfe6ee',
  ['motorway_link', 'trunk_link', 'primary_link', 'street', 'street_limited'],
  '#e7ecf2',
  '#edf1f5',
]);
assert.equal(paintChanges.get('bridge-case-simple:line-color'), '#cbd5e1');
assert.equal(paintChanges.get('road-label-simple:text-color'), '#475569');
assert.equal(paintChanges.has('campaign-road-overlay:line-color'), false);
assert.equal(layoutChanges.has('road-label-simple:visibility'), false);

console.log('White Out road styling tests passed');
