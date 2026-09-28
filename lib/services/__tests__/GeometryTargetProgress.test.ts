import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeGeometryTargetProgress, type GeometryTargetState } from '../GeometryTargetProgress';
const row:GeometryTargetState={id:'stop',geometry_target_kind:'building',geometry_target_id:'roof',address_resolution_status:'pending',formatted:'Address pending',house_number:null,street_name:null};
const base={status:'completed',run_id:'optimizer-job',report:{review_needed:0},applied_bundle_signature:'old'};
test('existing clients keep polling while missing addresses are being filled',()=>{
 const progress=mergeGeometryTargetProgress(base,[row],true);
 assert.equal(progress.status,'geocoding'); assert.equal(progress.applied_bundle_signature,null);
 assert.equal((progress.report as Record<string,unknown>)?.pending_addresses,1);
});
test('confirmed labels produce a new adoption revision and terminal status',()=>{
 const pending=mergeGeometryTargetProgress(base,[row],true);
 const complete=mergeGeometryTargetProgress(base,[{...row,address_resolution_status:'confirmed',formatted:'111 Wood St',house_number:'111',street_name:'Wood St'}],true);
 assert.equal(complete.status,'completed'); assert.notEqual(complete.run_id,pending.run_id);
 assert.equal(mergeGeometryTargetProgress(base,[],true),base);
});
test('configuration gaps and unmatched addresses stay usable and need review',()=>{
 assert.equal(mergeGeometryTargetProgress(base,[row],false).status,'review_needed');
 assert.equal(mergeGeometryTargetProgress(base,[{...row,address_resolution_status:'unresolved'}],true).status,'review_needed');
});
test('address completion cannot hide an active or failed geometry optimizer',()=>{
 const resolved={...row,address_resolution_status:'confirmed'};
 assert.equal(mergeGeometryTargetProgress({...base,status:'matching'},[resolved],true).status,'matching');
 assert.equal(mergeGeometryTargetProgress({...base,status:'failed'},[resolved],true).status,'failed');
});
