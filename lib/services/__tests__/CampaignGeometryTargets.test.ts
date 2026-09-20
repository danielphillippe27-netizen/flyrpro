import assert from 'node:assert/strict';
import { BedrockCountryService, BEDROCK_US_CONFIG } from '../BedrockCountryService';
import { test } from 'node:test';
import * as turf from '@turf/turf';
import { planGeometryTargets } from '../CampaignGeometryTargets';
import { resolveAmbiguousRegionCountry } from '../../geo/regionResolver';
import { safeGeometryAddress, type EnrichmentTarget } from '../CampaignAddressEnrichmentService';
import type { ReverseResult } from '../CampaignMapReconciliationService';

const box = (x: number, y: number, size = .0002, properties = {}): GeoJSON.Feature<GeoJSON.Polygon> =>
  turf.polygon([[[x,y],[x+size,y],[x+size,y+size],[x,y+size],[x,y]]], properties);
const building = (id: string, x: number, properties = {}) => box(x,47.95,.0002,{ building_id:id, ...properties });
const boundary = box(-124.4,47.94,.02).geometry;
const defaults = { boundary, existing: [], parcels: [], limit: 1000 };

test('zero address territory creates usable building stops with stable geometry IDs', () => {
 const a=building('a',-124.395), b=building('b',-124.394);
 const first=planGeometryTargets({...defaults,buildings:[a,b]});
 assert.equal(first.length,2); assert.equal(first[0].houseNumber,null);
 assert.deepEqual(first,planGeometryTargets({...defaults,buildings:[b,a]}));
 assert.ok(first.every(t=>turf.booleanPointInPolygon(t.coordinate,t.geometry)));
});
test('partial address coverage creates only the missing property', () => {
 const targets=planGeometryTargets({...defaults,buildings:[building('a',-124.395),building('b',-124.394)],
 existing:[{id:'visited-home',coordinate:{lon:-124.3949,lat:47.9501}}]});
 assert.deepEqual(targets.map(t=>t.geometryId),['b']);
});
test('retry preserves stops even if their coordinates were manually moved', () => {
 assert.equal(planGeometryTargets({...defaults,buildings:[building('a',-124.395)],
 existing:[{id:'same-visited-id',gers_id:'synthetic:geometry-target:building:a',coordinate:{lon:0,lat:0}}]}).length,0);
});
test('legacy building proxies and linked unit addresses are not duplicated', () => {
 assert.equal(planGeometryTargets({...defaults,buildings:[building('a',-124.395)],
 existing:[{id:'legacy',gers_id:'bedrock_us:building-proxy:a'}]}).length,0);
 assert.equal(planGeometryTargets({...defaults,buildings:[building('a',-124.395)],
 existing:[{id:'unit1',building_gers_id:'a'},{id:'unit2',building_gers_id:'a'}]}).length,0);
});
test('road-offset address inside the parcel prevents a duplicate building stop', () => {
 const parcel=box(-124.3952,47.9498,.0008,{parcel_id:'p'});
 assert.equal(planGeometryTargets({...defaults,buildings:[building('a',-124.395)],parcels:[parcel],
 existing:[{id:'offset',coordinate:{lon:-124.3951,lat:47.9501}}]}).length,0);
});
test('building plus parcel yields one stop, and parcel address attributes are reused', () => {
 const parcel=box(-124.3952,47.9498,.0008,{parcel_id:'p',house_number:'12',street_name:'Wood St'});
 const targets=planGeometryTargets({...defaults,buildings:[building('a',-124.395)],parcels:[parcel]});
 assert.equal(targets.length,1); assert.equal(targets[0].kind,'parcel'); assert.equal(targets[0].houseNumber,'12');
});
test('eligible parcel-only property becomes a stop; unknown and vacant land do not', () => {
 const parcels=[box(-124.395,47.95,.0003,{parcel_id:'res',land_use:'residential'}),
 box(-124.394,47.95,.0003,{parcel_id:'vacant',land_use:'vacant residential'}),
 box(-124.393,47.95,.0003,{parcel_id:'unknown'})];
 assert.deepEqual(planGeometryTargets({...defaults,buildings:[],parcels}).map(t=>t.geometryId),['res']);
});
test('sheds, commercial buildings and display-buffer neighbours never become stops', () => {
 assert.equal(planGeometryTargets({...defaults,buildings:[building('shed',-124.395,{building:'shed'}),
 building('shop',-124.394,{building_type:'commercial'}),building('outside',-124.5)]}).length,0);
});
test('capacity applies deterministically without deleting existing stops', () => {
 assert.deepEqual(planGeometryTargets({...defaults,limit:1,buildings:[building('b',-124.394),building('a',-124.395)]}).map(t=>t.geometryId),['a']);
 assert.equal(planGeometryTargets({...defaults,limit:0,buildings:[building('a',-124.395)]}).length,0);
});
test('country routing distinguishes all shared abbreviations using actual geography', () => {
 for(const [code,x,y,expected] of [['WA',-124.39,47.95,'US'],['WA',115.86,-31.95,'AU'],
 ['NT',-114.38,62.45,'CA'],['NT',130.84,-12.46,'AU'],['NC',-78.64,35.78,'US'],['NC',24.77,-28.73,'ZA']] as const)
 assert.equal(resolveAmbiguousRegionCountry(code,box(x,y).geometry),expected);
 assert.equal(resolveAmbiguousRegionCountry('ON',boundary),null);
 assert.throws(()=>resolveAmbiguousRegionCountry('WA',null),/ambiguous/);
});
test('the failed Forks campaign polygon routes WA to the United States', () => {
 const forksPolygon:GeoJSON.Polygon={type:'Polygon',coordinates:[[[-124.37437559332972,47.95595644470535],
  [-124.3801360363316,47.95591833057347],[-124.38032620362894,47.958088828982966],
  [-124.37425475063012,47.958088828982966],[-124.37437559332972,47.95595644470535]]]};
 assert.equal(resolveAmbiguousRegionCountry('WA',forksPolygon),'US');
});
test('enrichment requires a strong result inside this property in the correct region', () => {
 const target:EnrichmentTarget={address_resolution_permanent_allowed:true,id:'stop',campaign_id:'campaign',region:'WA',address_resolution_lease:'lease',geometry_target_geom:building('a',-124.395).geometry};
 const result={accuracy:'rooftop',region:'WA',longitude:-124.3949,latitude:47.9501} as ReverseResult;
 assert.equal(safeGeometryAddress(target,result),true);
 assert.equal(safeGeometryAddress(target,{...result,longitude:-124.394}),false);
 assert.equal(safeGeometryAddress(target,{...result,accuracy:'interpolated'}),false);
 assert.equal(safeGeometryAddress(target,{...result,region:'OR'}),false);
});

 test('an unavailable address artifact still returns the independent Washington geometry sources', async () => {
   const source = new BedrockCountryService(BEDROCK_US_CONFIG, async () => { throw new Error('Address artifact not found'); });
   const result = await source.provisionCampaign({ campaignId: 'fixture', polygon: boundary, regionCode: 'WA' });
   assert.equal(result.addresses.length, 0);
   assert.match(result.snapshot.s3_keys.buildings, /state=WA\/buildings.pmtiles$/);
   assert.match(String((result.snapshot.metadata?.tile_metrics as Record<string, unknown>)?.parcels_pmtiles_key), /state=WA\/parcels.pmtiles$/);
 });

test('national regions accept their own country context without accepting another country', () => {
 const target:EnrichmentTarget={address_resolution_permanent_allowed:true,id:'nz',campaign_id:'campaign',region:'NZ',address_resolution_lease:'lease',geometry_target_geom:box(174.76,-36.85,.0002).geometry};
 const result={accuracy:'rooftop',region:'AUK',country:'NZ',longitude:174.7601,latitude:-36.8499} as ReverseResult;
 assert.equal(safeGeometryAddress(target,result),true);
 assert.equal(safeGeometryAddress(target,{...result,country:'AU'}),false);
});

 test('road-offset points outside parcels reserve nearby roofs without duplicating the existing stop', () => {
   const targets = planGeometryTargets({ ...defaults,
     buildings: [building('known', -124.395), building('missing', -124.394)],
     existing: [{id:'road-point', coordinate:{lon:-124.39505,lat:47.9501}}],
   });
   assert.deepEqual(targets.map(t => t.geometryId), ['missing']);
 });


test('multiple buildings on a parcel produce one centered property stop without invented units', () => {
 const parcel=box(-124.3952,47.9498,.0018,{parcel_id:'shared'});
 const targets=planGeometryTargets({...defaults,buildings:[building('a',-124.395),building('b',-124.394)],parcels:[parcel]});
 assert.equal(targets.length,1); assert.equal(targets[0].kind,'parcel');
 assert.equal(targets[0].geometryId,'shared'); assert.equal(targets[0].houseNumber,null);
 assert.ok(turf.booleanPointInPolygon(targets[0].coordinate,parcel));
 assert.deepEqual(targets[0].coordinate,turf.centroid(parcel).geometry.coordinates);
});
test('parcel arrival never duplicates or merges legacy geometry stops with field history', () => {
 const parcel=box(-124.3952,47.9498,.0018,{parcel_id:'shared'});
 const targets=planGeometryTargets({...defaults,buildings:[building('a',-124.395),building('b',-124.394)],parcels:[parcel],
 existing:[{id:'visited',gers_id:'synthetic:geometry-target:building:a',coordinate:{lon:0,lat:0}}]});
 assert.equal(targets.length,0);
});
test('mixed parcel coverage uses a parcel stop and an uncovered building stop', () => {
 const parcel=box(-124.3952,47.9498,.0008,{parcel_id:'p'});
 const targets=planGeometryTargets({...defaults,buildings:[building('a',-124.395),building('b',-124.394)],parcels:[parcel]});
 assert.deepEqual(targets.map(t=>[t.kind,t.geometryId]),[['parcel','p'],['building','b']]);
});
test('moved parcel stops are not regenerated as building stops on retry', () => {
 const parcel=box(-124.3952,47.9498,.0008,{parcel_id:'p'});
 const targets=planGeometryTargets({...defaults,buildings:[building('a',-124.395)],parcels:[parcel],
 existing:[{id:'visited',gers_id:'synthetic:geometry-target:parcel:p',coordinate:{lon:0,lat:0}}]});
 assert.equal(targets.length,0);
});

test('explicit hospital and industrial parcels cannot reappear as building fallback stops', () => {
 for (const usedesc of ['HOSPITAL','INDUSTRIAL']) {
 const parcel=box(-124.3952,47.9498,.0008,{parcel_id:'nonres',usedesc});
 assert.equal(planGeometryTargets({...defaults,buildings:[building('a',-124.395)],parcels:[parcel]}).length,0);
 }
});
