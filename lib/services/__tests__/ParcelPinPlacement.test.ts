import assert from 'node:assert/strict';
import * as turf from '@turf/turf';
import { planParcelPinPlacements, applyParcelPinPlacements, interiorCentroid, isAccessoryBuilding, mapWithConcurrency } from '../ParcelPinPlacement';
import { CampaignMapReconciliationService } from '../CampaignMapReconciliationService';
import { applyAddressAdjustments } from '../CampaignMapBundlePrebuilder';

const box = (id: string, x: number, y: number, w: number, h: number, properties = {}) =>
  turf.polygon([[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]], { id, ...properties }, { id });
const parcel = box('lot', -79, 43, .001, .001, { parcel_id: 'lot' });
const home = box('home', -78.9998, 43.0002, .0003, .0003, { building: 'house', gers_id: 'home', parcel_id: 'lot' });
const garage = box('garage', -78.9998, 43.0007, .0002, .0002, { building: 'garage', gers_id: 'garage', parcel_id: 'lot' });
const address = turf.point([-79.0001,43.0001], { id: 'address', parcel_id: 'lot', house_number: '10', street_name: 'Main Street' });
const plan = (buildings: GeoJSON.Feature[], addresses: GeoJSON.Feature[] = [address], parcels: GeoJSON.Feature[] = [parcel]) =>
  planParcelPinPlacements({ buildings, addresses, parcels });
async function main() {
  assert(isAccessoryBuilding(garage));
  const propertyStop = { ...address, properties: { ...address.properties,
    geometry_target_kind: 'parcel', geometry_target_id: 'lot' } };
  const propertyPlacement = plan([home, { ...garage, properties: { ...garage.properties, building: 'house' } }], [propertyStop]);
  assert.equal(propertyPlacement.length, 1);
  assert.equal(propertyPlacement[0].method, 'parcel_center');
  assert.deepEqual(propertyPlacement[0].coordinate, interiorCentroid(parcel));
  assert.equal(plan([home], [{...propertyStop, properties:{...propertyStop.properties,locked:true}}]).length,0);

  const lone = plan([home]);
  assert.equal(lone[0].buildingId, 'home');
  assert(turf.booleanPointInPolygon(lone[0].coordinate, home));
  assert.equal(plan([home, garage])[0].buildingId, 'home');
  assert.equal(plan([])[0].method, 'parcel_center');
  assert(turf.booleanPointInPolygon(plan([])[0].coordinate, parcel));
  const ambiguous = { ...garage, properties: { ...garage.properties, building: 'yes' } };
  assert.equal(plan([home, ambiguous]).length, 0);
  const linked = { ...address, properties: { ...address.properties, building_gers_id: 'home' } };
  assert.equal(plan([home, ambiguous], [linked])[0].buildingId, 'home');
  assert.equal(plan([ambiguous], [linked]).length, 0, 'missing linked home must not select garage');
  assert.equal(plan([], [linked])[0].method, 'parcel_center', 'missing footprint uses parcel without replacing existing link');
  assert.equal(plan([home], [{ ...address, properties: { ...address.properties, source: 'manual' } }]).length, 0);
  assert.equal(planParcelPinPlacements({ buildings: [home], addresses: [address], parcels: [parcel], protectedAddressIds: new Set(['address']) }).length, 0);
  assert.equal(plan([home], [address, { ...address, properties: { ...address.properties, id: 'second' } }]).length, 0);
  // Separate townhouse lots share a single footprint, and retain distinct pins.
  const left = box('left', -79,43,.0005,.001,{parcel_id:'left'});
  const right = box('right', -78.9995,43,.0005,.001,{parcel_id:'right'});
  const row = box('row', -78.9998,43.0002,.0006,.0004,{gers_id:'row'});
  const units = [turf.point([-79.0001,43],{id:'u1',parcel_id:'left'}),turf.point([-78.999,43],{id:'u2',parcel_id:'right'})];
  const town = plan([row], units, [left,right]);
  assert.equal(town.length,2);
  assert(turf.booleanPointInPolygon(town[0].coordinate,left));
  assert(turf.booleanPointInPolygon(town[1].coordinate,right));
  assert(town.every(p => turf.booleanPointInPolygon(p.coordinate,row)));
  assert.notDeepEqual(town[0].coordinate,town[1].coordinate);
  const concave = turf.polygon([[[0,0],[.003,0],[.003,.001],[.001,.001],[.001,.003],[0,.003],[0,0]]]);
  assert(turf.booleanPointInPolygon(interiorCentroid(concave),concave));
  const collection = turf.featureCollection([address]);
  const applied = applyParcelPinPlacements(collection,lone);
  assert.deepEqual(applied.features[0].properties?.source_geometry,address.geometry);
  assert.deepEqual(applyParcelPinPlacements(applied,lone),applied,'repeat placement must be idempotent');
  assert.deepEqual(address.geometry.coordinates,[-79.0001,43.0001]);
  const oldAdjustment = { address_id: 'address', source: 'reconciliation', label_anchor_lon: -79.01,
    label_anchor_lat: 43.01, access_lon: null, access_lat: null, updated_at: null };
  assert.equal(applyAddressAdjustments(applied,[oldAdjustment]).features[0].properties?.label_anchor_lon,
    lone[0].coordinate[0], 'old automatic labels must not undo canonical placement');
  assert.equal(applyAddressAdjustments(applied,[{...oldAdjustment,source:'manual'}]).features[0].properties?.label_anchor_lon,
    -79.01, 'manual adjustments retain priority');
  let active = 0, peak = 0;
  const parallel = await mapWithConcurrency(Array.from({length:24},(_,i)=>i),6,async i=>{
    active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;return i;
  });
  assert.equal(peak,6);assert.deepEqual(parallel,Array.from({length:24},(_,i)=>i));

  // Exercise the actual optimizer decision path with no external service access.
  const savedEnabled = process.env.MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE;
  process.env.MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE = 'true';
  try {
    for (const accessory of [garage, ambiguous]) {
      const links = [{address_id:'address',building_id:'home',confidence:0.5,match_type:'proximity'}];
      const mock = {from: (table: string) => {
        const result = {data:table === 'campaign_map_bundles' ? {links} : [],error:null};
        const chain: any = {select:()=>chain,eq:()=>chain,maybeSingle:async()=>result,then:(resolve:any)=>Promise.resolve(result).then(resolve)};
        return chain;
      }};
      const service = new CampaignMapReconciliationService(mock as any) as any;
      const queried: string[] = [];
      service.reverseGeocode = async (point: number[]) => {queried.push(JSON.stringify(point));return null;};
      service.heartbeatRun = async()=>{};
      const input = {run:{id:'run',campaign_id:'campaign'},buildings:[home,accessory],addresses:[linked],parcels:[parcel],
        linkedBuildingIds:new Set(['home']),linkedAddressIds:new Set(['address']),orphanBuildingIds:new Set(['garage']),orphanAddressIds:new Set(),protectedAddressIds:new Set(),protectedBuildingIds:new Set()};
      const decisions = await service.globalReverseGeocodeDecisions(input);
      assert.equal(queried.length,0,'home plus garage must not trigger reverse lookup, even without garage metadata');
      assert.equal(decisions.length,0,'existing home link must remain unchanged');
    }
    process.env.MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE = 'false';
    const mock = {from:()=>{const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:null}),then:(resolve:any)=>Promise.resolve({data:[]}).then(resolve)};return chain;}};
    const service = new CampaignMapReconciliationService(mock as any) as any;
    const decisions = await service.globalReverseGeocodeDecisions({run:{id:'run',campaign_id:'campaign'},buildings:[home],addresses:[address],parcels:[parcel],
      linkedBuildingIds:new Set(),linkedAddressIds:new Set(),orphanBuildingIds:new Set(['home']),orphanAddressIds:new Set(['address']),protectedAddressIds:new Set(),protectedBuildingIds:new Set()});
    assert.equal(decisions.length,1,'parcel links work without reverse geocoding');
    assert.equal(decisions[0].building_id,'home');assert.equal(decisions[0].proposed_state.move_source,false);
  } finally {
    if (savedEnabled === undefined) delete process.env.MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE;
    else process.env.MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE = savedEnabled;
  }
  console.log('✓ parcel placement, townhouse, primary-home protection, optimizer decisions and concurrency regressions passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
