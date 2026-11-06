import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { IOS_BUILDING_LAYOUT, IOS_BUILDING_DEPTH, IOS_ADDRESS_LAYOUT, IOS_ADDRESS_DEPTH, IOS_ADDRESS_HEIGHT, IOS_ADDRESS_BASE, iosParcelPaint, parcelInsertionLayer } from '../iosMapPresentation';
import { getBuildingExtrusionHeightExpression, getBuildingExtrusionBaseExpression } from '../buildingHeight';
const require = createRequire(import.meta.url);
const { validate, expression } = require('mapbox-gl/dist/style-spec/index.cjs');
const selected = ['boolean', ['feature-state', 'selected'], false] as never;
const active = ['!=', ['feature-state', 'status'], 'UNTOUCHED'] as never;
const parcel = iosParcelPaint(selected, active);
const style = { version: 8, sources: { homes: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, layers: [
  { id: 'parcels', type: 'fill', source: 'homes', paint: { 'fill-opacity': parcel.fillOpacity } },
  { id: 'parcel-lines', type: 'line', source: 'homes', paint: { 'line-opacity': parcel.lineOpacity, 'line-width': parcel.lineWidth } },
  { id: 'buildings', type: 'fill-extrusion', source: 'homes', layout: IOS_BUILDING_LAYOUT, paint: { ...IOS_BUILDING_DEPTH, 'fill-extrusion-height': getBuildingExtrusionHeightExpression() } },
  { id: 'addresses', type: 'fill-extrusion', source: 'homes', layout: IOS_ADDRESS_LAYOUT, paint: { ...IOS_ADDRESS_DEPTH, 'fill-extrusion-height': IOS_ADDRESS_HEIGHT, 'fill-extrusion-base': IOS_ADDRESS_BASE } },
] };
assert.deepEqual(validate(style).map((error: {message:string}) => error.message), []);
function evaluate(raw: unknown, zoom: number, properties = {}, state = {}) {
  const compiled = expression.createExpression(raw);
  assert.equal(compiled.result, 'success', JSON.stringify(compiled.value));
  return compiled.value.evaluate({zoom}, {properties, type: 3}, state);
}
assert.equal(evaluate(getBuildingExtrusionHeightExpression(), 17), 2.6);
assert.equal(evaluate(getBuildingExtrusionHeightExpression(), 17, {height_m: 20}), 7);
assert.equal(evaluate(getBuildingExtrusionHeightExpression(), 17, {render_height: 10, height_m: 20}), 5);
assert.equal(evaluate(getBuildingExtrusionBaseExpression(), 17, {height_m: 12, min_height: 2}), 1);
assert.equal(evaluate(getBuildingExtrusionBaseExpression(), 17, {height_m: 12, min_height: 20}), 0);
assert.equal(evaluate(IOS_ADDRESS_HEIGHT, 17, {}, {height_m: 6}), 6);
assert.equal(evaluate(IOS_ADDRESS_BASE, 17, {min_height: -1}), 0);
assert.equal(evaluate(parcel.fillOpacity, 14, {}, {selected: false, status: 'UNTOUCHED'}), .06);
assert.equal(evaluate(parcel.fillOpacity, 14, {}, {selected: true, status: 'LEADS'}), .42);
assert.equal(evaluate(parcel.lineWidth, 19, {}, {selected: true}), 2.6);
assert.equal(parcelInsertionLayer([{id:'roads',type:'line'}, {id:'homes',type:'fill-extrusion'}, {id:'units',type:'fill-extrusion'}]), 'homes');
console.log('PASS: Mapbox validates iOS styles; building heights, address height/base state, selected/status parcel styles and underlay ordering');
