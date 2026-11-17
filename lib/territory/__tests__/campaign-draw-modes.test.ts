import test from 'node:test';
import assert from 'node:assert/strict';
import Draw from '@mapbox/mapbox-gl-draw';
import { createCampaignDrawModes } from '../campaign-draw-modes';
const pause = (ms=230) => new Promise(resolve=>setTimeout(resolve,ms));
function harness() {
  let busy = false;
  let error: string|null = null;
  const changes: string[] = [];
  const feature = { id:'boundary',type:'Polygon',coordinates:[[]] as [number, number][][],
    setCoordinates(rings:[number, number][][]){ this.coordinates=rings; },
    updateCoordinate(path:string,lng:number,lat:number){this.coordinates[0][Number(path.split('.')[1])]=[lng,lat];},
    toGeoJSON(): GeoJSON.Feature<GeoJSON.Polygon>{return {type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[this.coordinates[0].concat([this.coordinates[0][0]])]}};},
  };
  let alive=true;
  const context = {
    getFeature:()=>alive?feature:undefined, getSelected:()=>[feature],
    fire:(name:string)=>changes.push(name),
    map:{dragPan:{isEnabled:()=>true,enable(){},disable(){}},doubleClickZoom:{enable(){}}},
    updateUIClasses(){},activateUIButton(){},deleteFeature(){alive=false;},changeMode(){},
  };
  const controller = createCampaignDrawModes(Draw.modes,{enabled:()=>true,onBusy:v=>busy=v,onError:v=>error=v});
  const mode=controller.modes.draw_polygon;
  const state={polygon:feature};
  const click=(lng:number,lat:number)=>mode.onClick.call(context,state,{lngLat:{lng,lat}});
  return {controller,mode,state,context,feature,click,changes,get busy(){return busy;},get error(){return error;}};
}
test('first pin snaps; nearest-edge insertion has no extra cursor point; stopping retains final snap', async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(_url,options)=>new Response(JSON.stringify({points:JSON.parse(options!.body as string).points.map(([x,y]:number[])=>[x+.01,y])}));
  const h=harness();
  try {
    h.click(0,0); assert.equal(h.busy,true); await pause();
    assert.deepEqual(h.feature.coordinates,[[[.01,0]]]);
    h.click(10,0); h.click(10,10); h.click(0,10); h.click(5,-1);
    assert.deepEqual(h.feature.coordinates[0],[[.01,0],[5,-1],[10,0],[10,10],[0,10]]);
    h.mode.onStop.call(h.context,h.state); await pause();
    assert.equal(h.feature.coordinates[0].length,5);
    assert.equal(h.feature.coordinates[0][1][0],5.01);
    assert.equal(h.busy,false); assert(h.changes.includes('draw.create'));
  } finally {h.controller.dispose();globalThis.fetch=original;}
});
test('a stale response cannot overwrite a new tap; disposal cancels outstanding work',async()=>{
  const original=globalThis.fetch;
  const pending: Array<(r:Response)=>void>=[];
  globalThis.fetch=()=>new Promise(resolve=>pending.push(resolve));
  const h=harness();
  try {
    h.click(1,1); await pause(); h.click(2,2);
    pending[0](new Response(JSON.stringify({points:[[99,99]]}))); await pause();
    assert.deepEqual(h.feature.coordinates[0],[[1,1],[2,2]]);
    assert.equal(h.busy,true);
    h.controller.dispose(); pending[1](new Response(JSON.stringify({points:[[88,88],[77,77]]}))); await pause(10);
    assert.deepEqual(h.feature.coordinates[0],[[1,1],[2,2]]); assert.equal(h.busy,false);
  } finally {h.controller.dispose();globalThis.fetch=original;}
});
test('dragging supersedes the pending snap and keeps the vertex in place in the sequence', async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(_url,options)=>new Response(JSON.stringify({points:JSON.parse(options!.body as string).points}));
  const h=harness();
  try {
    h.click(0,0);h.click(10,0);h.click(10,10);h.click(0,10);
    h.mode.onMouseDown.call(h.context,h.state,{featureTarget:{properties:{meta:'vertex',coord_path:'0.1'}}});
    h.mode.onDrag.call(h.context,h.state,{lngLat:{lng:11,lat:1}});
    h.mode.onMouseUp.call(h.context,h.state); await pause();
    assert.deepEqual(h.feature.coordinates[0],[[0,0],[11,1],[10,10],[0,10]]);
  } finally {h.controller.dispose();globalThis.fetch=original;}
});
