import assert from 'node:assert/strict';
import type { StyleSpecification } from 'mapbox-gl';
import { createAtmosphericStyle } from '../map-atmospheric-themes';

const base: StyleSpecification = {
  version: 8, sources: { composite: { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v7' } },
  layers: [
    { id: 'background', type: 'background' },
    { id: 'water', type: 'fill', source: 'composite', 'source-layer': 'water' },
    { id: 'building', type: 'fill', source: 'composite', 'source-layer': 'building' },
    { id: 'road', type: 'line', source: 'composite', 'source-layer': 'road' },
    { id: 'park', type: 'fill', source: 'composite', 'source-layer': 'landuse' },
  ],
};
const snapshot = JSON.stringify(base);
const light = createAtmosphericStyle(base, 'light');
const dark = createAtmosphericStyle(base, 'dark');
assert.equal(JSON.stringify(base), snapshot, 'hosted source remains immutable');
assert.deepEqual(light.sources, base.sources, 'source IDs and definitions remain intact');
assert.deepEqual(dark.layers.map(l => l.id), base.layers.map(l => l.id));
assert.equal((light.layers[0].paint as Record<string, unknown>)['background-color'], '#FAFBFC');
assert.equal((dark.layers[0].paint as Record<string, unknown>)['background-color'], '#171C22');
assert.equal((light.layers[1].paint as Record<string, unknown>)['fill-color'], '#EAF4FA');
assert.equal((light.layers[2].paint as Record<string, unknown>)['fill-color'], '#E8ECF0');
assert.equal(light.projection?.name, 'globe');
assert.equal(light.fog?.['star-intensity'], 0);
assert.equal(dark.fog?.['star-intensity'], 0.035);
assert.doesNotThrow(() => createAtmosphericStyle({ version: 8, sources: {}, layers: [] }, 'dark'));
console.log('Atmospheric themes: palettes, globe, immutability and missing layers passed');
