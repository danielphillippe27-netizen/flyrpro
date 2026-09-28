import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as turf from '@turf/turf';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CampaignAddressEnrichmentService } from '../CampaignAddressEnrichmentService';
import { planParcelPinPlacements, applyParcelPinPlacements, interiorCentroid } from '../ParcelPinPlacement';

/** Exercise provisioning, retries, enrichment and canonical render placement together. */
test('a multi-building parcel stays one centered stop after address enrichment and reprovision', async t => {
 const boundary=turf.bboxPolygon([-124.4,47.94,-124.38,47.96]).geometry;
 const parcel=turf.bboxPolygon([-124.398,47.948,-124.394,47.952],{properties:{parcel_id:'lot'}});
 const buildings=[[-124.3978,47.9482,-124.3973,47.9487],[-124.396,47.9505,-124.3955,47.951]]
   .map((b,i)=>turf.bboxPolygon(b as [number,number,number,number],{properties:{building_id:`roof-${i}`}}));
 type Row = Record<string, unknown> & { id: string; gers_id: string };
 const rows:Row[]=[];
 const db={from:()=>({
   select:()=>({eq:()=>({range:async()=>({data:rows,error:null})})}),
   upsert:async(incoming:Row[])=>{for(const row of incoming)if(!rows.some(r=>r.gers_id===row.gers_id))rows.push({...row,id:'persistent-stop'});return {error:null};},
 }),rpc:async(name:string,args:Record<string,unknown>)=>{
   if(name==='claim_campaign_address_enrichment')return {data:rows.map(r=>({...r,address_resolution_lease:'lease'})),error:null};
   assert.equal(name,'finish_campaign_address_enrichment');
   assert.equal(args.p_address_id,'persistent-stop');
   assert.equal(args.p_lease,'lease');
   assert.ok(args.p_result);
   Object.assign(rows[0],args.p_result,{address_resolution_status:'confirmed'});
   return {data:true,error:null};
 }} as unknown as SupabaseClient;
 const service=new CampaignAddressEnrichmentService(db);
 const input={campaignId:'campaign',region:'WA',source:'bedrock_us' as const,boundary,buildings,parcels:[parcel]};
 assert.equal((await service.ensureTargets(input)).added,1);
 assert.equal(rows[0].geometry_target_kind,'parcel');
 assert.equal(rows[0].building_gers_id,null);
 const originalCoordinate=structuredClone(rows[0].coordinate);
 rows[0].visited=true; rows[0].field_note='Keep my field note';
 const settings={MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE:'true',MAPBOX_GEOCODING_STORAGE_MODE:'permanent',MAPBOX_TOKEN:'test',MAP_RECONCILIATION_MAX_GEOCODES_PER_RUN:'24'};
 const old=Object.fromEntries(Object.keys(settings).map(k=>[k,process.env[k]]));Object.assign(process.env,settings);
 t.after(()=>{for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;});
 // A valid parcel-level result, intentionally outside both roofs.
 const providerPoint:[number,number]=[-124.3945,47.9485];
 assert.ok(buildings.every(b=>!turf.booleanPointInPolygon(providerPoint,b)));
 t.mock.method(globalThis,'fetch',async()=>Response.json({features:[{geometry:{type:'Point',coordinates:providerPoint},properties:{
   address_number:'25',street_name:'Test Street',coordinates:{accuracy:'parcel'},context:{region:{region_code:'WA'},country:{country_code:'US'}},
 }}]}));
 assert.equal((await service.processBatch()).confirmed,1);
 assert.equal(rows[0].visited,true);assert.equal(rows[0].field_note,'Keep my field note');
 assert.deepEqual(rows[0].coordinate,originalCoordinate);
 assert.equal((await service.ensureTargets(input)).added,0);
 assert.equal(rows.length,1);
 const address=turf.point(providerPoint,{...rows[0],address_id:rows[0].id,parcel_id:'lot'});
 const placements=planParcelPinPlacements({addresses:[address],buildings,parcels:[parcel]});
 assert.equal(placements.length,1);assert.equal(placements[0].method,'parcel_center');
 const rendered=applyParcelPinPlacements(turf.featureCollection([address]),placements);
 const renderedGeometry=rendered.features[0].geometry;
 assert.ok(renderedGeometry.type==='Point');
 assert.deepEqual(renderedGeometry.coordinates,interiorCentroid(parcel));
 assert.equal(rendered.features[0].properties?.house_number,'25');
});

test('partial source coverage gets usable parcel stops but no paid enrichment eligibility', async () => {
 const boundary=turf.bboxPolygon([-124.4,47.94,-124.38,47.96]).geometry;
 const parcel=turf.bboxPolygon([-124.398,47.948,-124.394,47.952],{properties:{parcel_id:'missing-lot',land_use:'residential'}});
 const existing=[{id:'source-address',gers_id:'source:known',coordinate:{lon:-124.381,lat:47.941}}];
 let saved:Record<string,unknown>[]=[];
 const db={from:()=>({select:()=>({eq:()=>({range:async()=>({data:existing,error:null})})}),
 upsert:async(rows:Record<string,unknown>[])=>{saved=rows;return {error:null};}})} as unknown as SupabaseClient;
 const service=new CampaignAddressEnrichmentService(db);
 await service.ensureTargets({campaignId:'partial',region:'WA',source:'bedrock_us',boundary,buildings:[],parcels:[parcel]});
 assert.equal(saved.length,1);assert.equal(saved[0].address_resolution_permanent_allowed,false);
 assert.equal(saved[0].address_resolution_status,'unresolved');
});
