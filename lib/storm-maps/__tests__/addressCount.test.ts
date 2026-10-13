import assert from 'node:assert/strict';
import { BEDROCK_US_CONFIG, BedrockCountryService } from '@/lib/services/BedrockCountryService';
import { tileRangeForAddressBbox } from '@/app/api/campaigns/_utils/scoped-pmtiles-addresses';
async function run() {
  const boundary: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[-86.3,45.9],[-86.2,45.9],[-86.2,46],[-86.3,46],[-86.3,45.9]]] };
  let requested = false;
  const service = new BedrockCountryService(BEDROCK_US_CONFIG, async options => {
    requested = true;
    assert.equal(options.preferredZoom, 10);
    assert.equal(options.addressLimit, undefined);
    assert.deepEqual(options.boundary, boundary);
    assert.match(options.pmtilesKey!, /state=MI\/addresses.pmtiles$/);
    const feature = (id: string, unit: string) => ({ type: 'Feature' as const, properties: { address_id: id, house_number: '10', street_name: 'Main St', unit }, geometry: { type: 'Point' as const, coordinates: [-86.25,45.95] } });
    const addresses = ['a','b'].map(id => options.normalizeFeature({ campaignId: options.campaignId, feature: feature(id,id), lon: -86.25, lat: 45.95 })!);
    assert.notEqual(addresses[0].gers_id, addresses[1].gers_id, 'Separate units retain separate identities');
    return { addresses, metric: { touchedTiles: 1, timings: { queryZoom: 10 } } as any };
  });
  const count = await service.countStormTerritoryPins(boundary, 'MI');
  assert.equal(requested, true); assert.equal(count.ids.length, 2); assert.equal(count.tiles, 1);
  assert.equal(tileRangeForAddressBbox([-86.3,45.9,-86.2,46],10,10)!.z, 10);
  const native = new BedrockCountryService(BEDROCK_US_CONFIG, async options => {
    assert.equal(options.preferredZoom, undefined);
    assert.equal(options.minZoom, 10);
    assert.equal(options.addressLimit, undefined, 'Campaign planning must scan all addresses without a 1,000-home truncation');
    return { addresses: [], metric: { touchedTiles: 1, timings: { queryZoom: 14 } } as any };
  });
  assert.equal((await native.countStormTerritoryPins(boundary, 'MI', true)).tileZoom, 14);
  const failing = new BedrockCountryService(BEDROCK_US_CONFIG, async () => { throw new Error('Tiles missing'); });
  await assert.rejects(failing.countStormTerritoryPins(boundary,'MI'), /Tiles missing/, 'Missing coverage must not become a zero count');
  await assert.rejects(failing.countStormTerritoryPins(boundary,'MI',true), /Tiles missing/, 'Planning must fail on incomplete coverage');
  console.log('PASS: storm pin count prefers tile zoom 10, scans the full boundary, preserves address units, and propagates unavailable coverage.');
}
run();
