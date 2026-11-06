import assert from 'node:assert/strict';
import { area, feature, booleanPointInPolygon, point } from '@turf/turf';
import { splitTownhome, townhomeLabels, townhomeAddressGroups, type TownhomeFootprint } from '../townhomeSlices';
import type { CampaignAddress } from '@/types/database';
const at=(x:number,y:number)=>[-78+x/80000,44+y/111320];
const shape=(ring:number[][],holes:number[][][]=[])=>feature({type:'Polygon',coordinates:[ring,...holes].map(r=>r.map(p=>at(p[0],p[1])))} as GeoJSON.Polygon,{building_id:'row',height_m:10}) as TownhomeFootprint;
const building=shape([[0,0],[30,0],[30,10],[0,10],[0,0]]);
const address=(id:string,house:string,x:number,y=5)=>({id,house_number:house,street_name:'Test Road',building_gers_id:'row',coordinate:{lon:at(x,y)[0],lat:at(x,y)[1]}} as CampaignAddress);
const homes=[address('a','10',25),address('b','12',15),address('c','14',5)];
const slices=splitTownhome(building,homes);
assert.equal(slices.length,3);
assert.deepEqual(slices.map(s=>s.properties.address_id),['c','b','a'],'Reverse numbering follows physical address positions');
assert(Math.abs(slices.reduce((sum,s)=>sum+area(s),0)-area(building))<.01,'Slices cover the whole original footprint');
for(const slice of slices){
  const a=homes.find(a=>a.id===slice.properties.address_id)!;
  assert(booleanPointInPolygon(point([a.coordinate!.lon,a.coordinate!.lat]),slice));
  assert.equal(slice.properties.overlay_height,5.125);
}
const labels=townhomeLabels(slices);
for(const label of labels.features){
  const slice=slices.find(s=>s.id===label.id)!;
  assert.equal(label.properties!.address_id,slice.properties.address_id);
  assert(booleanPointInPolygon(label,slice),'Label is inside its own selectable unit');
}
assert.deepEqual(splitTownhome(building,[homes[2],homes[0],homes[1]]),slices,'Input order does not swap units');
assert.deepEqual(splitTownhome(building,[...homes,homes[0]]),slices,'Duplicate identity does not create another slice');
const rotated=JSON.parse(JSON.stringify(building)) as TownhomeFootprint;
const rotate=(p:number[])=>{const x=(p[0]+78)*80000,y=(p[1]-44)*111320;return at(x*.7071-y*.7071,x*.7071+y*.7071);};
(rotated.geometry as GeoJSON.Polygon).coordinates=(building.geometry as GeoJSON.Polygon).coordinates.map(r=>r.map(rotate));
const rotatedHomes=homes.map(a=>{const p=rotate([a.coordinate!.lon,a.coordinate!.lat]);return {...a,coordinate:{lon:p[0],lat:p[1]}};});
for(const slice of splitTownhome(rotated,rotatedHomes)){
 const a=rotatedHomes.find(a=>a.id===slice.properties.address_id)!;
 assert(booleanPointInPolygon(point([a.coordinate!.lon,a.coordinate!.lat]),slice),'Rotated row keeps physical unit alignment');
}
const holed=shape([[0,0],[30,0],[30,15],[0,15],[0,0]],[[[12,4],[12,8],[18,8],[18,4],[12,4]]]);
const holedSlices=splitTownhome(holed,homes);
assert.equal(holedSlices.length,3);
assert(Math.abs(holedSlices.reduce((sum,s)=>sum+area(s),0)-area(holed))<.01,'Courtyard holes are not filled by a split');
assert(!holedSlices.some(s=>booleanPointInPolygon(point(at(15,6)),s)));
const missing=homes.map(a=>({...a,coordinate:undefined}));
assert.deepEqual(splitTownhome(building,missing).map(s=>s.properties.address_id),['a','b','c'],'Missing coordinates use deterministic natural numbering');
assert.equal(splitTownhome(building,[homes[0]]).length,0,'Single homes do not split');
const groups=townhomeAddressGroups([{id:'row',properties:{row_id:'db-row',address_ids:['a','b','c']}},{id:'other',properties:{}}],
 [{...homes[0],building_id:'other'},homes[1],homes[2],{...address('orphan','16',3),building_gers_id:null,gers_id:'row'}],[]);
assert.deepEqual(groups.get('row')?.map(a=>a.id),['b','c'],'Live relink wins; address-source gers_id never creates a building join');
assert.equal(groups.has('other'),false,'One linked address is not a townhome');
console.log('PASS: reverse and rotated rows, stable identity, full footprint coverage, holes, label/hit agreement, missing coordinates, explicit-link-only grouping and live reassignment');

const ambiguous=townhomeAddressGroups([{id:'row',properties:{address_ids:['a','b']}},{id:'other',properties:{address_ids:['a','c']}}],homes.map(a=>({...a,building_gers_id:null,building_id:null})));
assert.equal(ambiguous.size,0,'Conflicting historical links do not paint one address on two rows');
