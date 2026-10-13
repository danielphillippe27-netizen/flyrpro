import assert from 'node:assert/strict';
import { booleanPointInPolygon, point } from '@turf/turf';
import { partitionStormCampaigns } from '../intelligence/campaign-partitions';
import { reviewPolygonSchema, stormTerritoryPolygonSchema } from '../intelligence/territory-review';
import { campaignWithinStormTerritory } from '../intelligence/storm-territories';
const boundary: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0,0],[0.1,0],[0.1,0.1],[0,0.1],[0,0]]] };
for (const count of [1, 999, 1000, 1001, 2000, 2500]) {
 const pins = Array.from({ length: count }, (_, i) => ({ id: String(i), lon: 0.001 + i / count * 0.098, lat: 0.03 }));
 const parts = partitionStormCampaigns(boundary, pins);
 assert.equal(parts.length, Math.ceil(count / 1000));
 assert.equal(parts.reduce((sum, part) => sum + part.addressCount, 0), count);
 assert.ok(parts.every(part => part.addressCount <= 1000 && campaignWithinStormTerritory(part.boundary, boundary)));
 for (const pin of pins) assert.equal(parts.filter(part => booleanPointInPolygon(point([pin.lon,pin.lat]),part.boundary)).length, 1);
 assert.equal(partitionStormCampaigns(boundary, [...pins, pins[0]]).length, parts.length);
}
const holed: GeoJSON.Polygon = { ...boundary, coordinates: [...boundary.coordinates, [[0.04,0.04],[0.04,0.06],[0.06,0.06],[0.06,0.04],[0.04,0.04]]] };
const parts = partitionStormCampaigns(holed, Array.from({ length: 1800 }, (_,i) => ({ id:String(i), lon:0.001+i/1800*0.098,lat:0.02 })));
assert.ok(parts.every(part => campaignWithinStormTerritory(part.boundary,holed) && !booleanPointInPolygon(point([0.05,0.05]),part.boundary)));
assert.throws(() => partitionStormCampaigns(boundary, []), /No campaign addresses/);
assert.throws(() => partitionStormCampaigns(boundary, Array.from({length:1001},(_,i)=>({id:String(i),lon:0.05,lat:0.05}))), /same location/);
console.log('Storm campaign partitions: caps, exact-once coverage, holes, duplicates and unsplittable locations passed');

const largerTerritory: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0,0],[0.3,0],[0.3,0.3],[0,0.3],[0,0]]] };
assert.equal(reviewPolygonSchema.safeParse(largerTerritory).success, false);
assert.equal(stormTerritoryPolygonSchema.safeParse(largerTerritory).success, true);
assert.equal(partitionStormCampaigns(largerTerritory, [{id:'one',lon:0.1,lat:0.1}]).length, 1);
