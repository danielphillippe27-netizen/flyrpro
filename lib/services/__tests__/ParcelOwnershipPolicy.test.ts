import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueAddressParcelOwnership, applyAddressParcelOwnership, excludeOverlayParcelConflicts } from '../CampaignMapBundlePrebuilder';
const row=(addressId:string,parcelId:string)=>({addressId,parcelId,campaignParcelId:null,matchType:'contains' as const,confidence:1,parcelAreaSqm:100,distanceMeters:0});
test('one-to-one ownership rejects collisions in either direction without choosing by order',()=>{
 assert.deepEqual(uniqueAddressParcelOwnership([row('a','p'),row('b','p')]),[]);
 assert.deepEqual(uniqueAddressParcelOwnership([row('a','p'),row('a','q')]),[]);
 assert.equal(uniqueAddressParcelOwnership([row('a','p'),row('A','P')]).length,1);
 assert.equal(uniqueAddressParcelOwnership([row('a','p'),row('b','q')]).length,2);
});
test('ambiguous source ownership never creates reverse parcel links',()=>{
 const addresses:any={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[0,0]},properties:{id:'a',house_number:'1'}}]};
 const parcels:any={type:'FeatureCollection',features:['p','q'].map(id=>({type:'Feature',geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]},properties:{id,parcel_id:id}}))};
 const result=applyAddressParcelOwnership({addresses,parcels,ownership:[row('a','p'),row('a','q')]});
 assert.equal(result.addresses.features[0].properties?.has_parcel_link,false);
 for(const p of result.parcels.features) assert.deepEqual(p.properties?.address_ids,[]);
});

test('automatic rebuild defers to explicit parcel corrections instead of failing or taking their parcel',()=>{
 const aliases=new Map([['uuid-p','p']]);
 assert.deepEqual(excludeOverlayParcelConflicts([row('a','p')],{'address:b':{parcelLinkSet:true,parcelId:'uuid-p'}},aliases),[]);
 assert.equal(excludeOverlayParcelConflicts([row('a','p')],{'address:a':{parcelLinkSet:true,parcelId:'uuid-p'}},aliases).length,1);
 assert.equal(excludeOverlayParcelConflicts([row('a','p')],{'address:b':{hidden:true,parcelLinkSet:true,parcelId:'uuid-p'}},aliases).length,1);
});
test('new parcel ownership clears the old internal parcel ID',()=>{
 const addresses:any={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[0,0]},properties:{id:'a',campaign_parcel_id:'old-lot',house_number:'1'}}]};
 const parcels:any={type:'FeatureCollection',features:[]};
 const result=applyAddressParcelOwnership({addresses,parcels,ownership:[row('a','new-lot')]});
 assert.equal(result.addresses.features[0].properties?.parcel_id,'new-lot');
 assert.equal(result.addresses.features[0].properties?.campaign_parcel_id,null);
});
