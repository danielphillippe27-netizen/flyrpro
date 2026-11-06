import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { IOS_BUILDING_LAYOUT, IOS_BUILDING_DEPTH, IOS_ADDRESS_LAYOUT, IOS_ADDRESS_DEPTH, IOS_ADDRESS_HEIGHT, iosParcelPaint } from '../lib/map/iosMapPresentation';
import { getBuildingExtrusionHeightExpression } from '../lib/map/buildingHeight';
import { splitTownhome, townhomeLabels } from '../lib/map/townhomeSlices';
import type { CampaignAddress } from '../types/database';
const require = createRequire(import.meta.url);
async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.setContent('<div id="map" style="position:absolute;inset:0"></div>');
    await page.addStyleTag({ path: require.resolve('mapbox-gl/dist/mapbox-gl.css') });
    await page.addScriptTag({ path: require.resolve('mapbox-gl/dist/mapbox-gl.js') });
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      readFileSync('.env.local', 'utf8').match(/NEXT_PUBLIC_MAPBOX_(?:ACCESS_)?TOKEN=["']?([^\s"']+)/)?.[1];
    const parcels = iosParcelPaint(['boolean', ['feature-state', 'selected'], false], ['!=', ['feature-state', 'status'], 'UNTOUCHED']);
    const polygon = (id: string, points: number[][], properties = {}) => ({ type: 'Feature', id, properties, geometry: { type: 'Polygon', coordinates: [[...points, points[0]]] } });
    const house = polygon('house', [[-78.0004,44],[-78.0001,44],[-78.0001,44.0001],[-78.00025,44.0001],[-78.00025,44.00025],[-78.0004,44.00025]], {height_m:12});
    const parcel = polygon('lot', [[-78.0005,43.9999],[-77.99995,43.9999],[-77.99995,44.00035],[-78.0005,44.00035]]);
    const circle = polygon('pin', Array.from({length:32},(_,i)=>[-77.9998+Math.cos(i*Math.PI/16)*.000045,44.0001+Math.sin(i*Math.PI/16)*.000032]));
    const homes = [
      {id:'unit-10',house_number:'10',coordinate:{lon:-78.00013,lat:44.00004}},
      {id:'unit-12',house_number:'12',coordinate:{lon:-78.00027,lat:44.00008}},
      {id:'unit-14',house_number:'14',coordinate:{lon:-78.00036,lat:44.00018}},
    ] as CampaignAddress[];
    house.properties = {...house.properties,building_id:'row'} as typeof house.properties;
    const units=splitTownhome(house as never,homes);
    if(units.length!==3)throw new Error('Expected three complete townhome slices');
    const labels=townhomeLabels(units);
    const style = { version:8, glyphs:'mapbox://fonts/mapbox/{fontstack}/{range}.pbf', sources: Object.fromEntries([['house',house],['lot',parcel],['pin',circle],['units',{type:'FeatureCollection',features:units}],['labels',labels]].map(([id,data])=>[id,{type:'geojson',data}])), layers:[
      {id:'background',type:'background',paint:{'background-color':'#e8edf1'}},
      {id:'parcels',type:'fill',source:'lot',paint:{'fill-color':'#2563eb','fill-opacity':parcels.fillOpacity}},
      {id:'parcel-outline',type:'line',source:'lot',paint:{'line-color':'#2563eb','line-opacity':parcels.lineOpacity,'line-width':parcels.lineWidth}},
      {id:'homes',type:'fill-extrusion',source:'house',layout:IOS_BUILDING_LAYOUT,paint:{...IOS_BUILDING_DEPTH,'fill-extrusion-color':'#b6d1e6','fill-extrusion-height':getBuildingExtrusionHeightExpression()}},
      {id:'pins',type:'fill-extrusion',source:'pin',layout:IOS_ADDRESS_LAYOUT,paint:{...IOS_ADDRESS_DEPTH,'fill-extrusion-color':'#22c55e','fill-extrusion-height':IOS_ADDRESS_HEIGHT}},
      {id:'townhome-live-fill',type:'fill-extrusion',source:'units',layout:{'fill-extrusion-edge-radius':0},paint:{...IOS_BUILDING_DEPTH,'fill-extrusion-color':['match',['get','address_id'],'unit-10','#22c55e','unit-12','#facc15','#b6d1e6'],'fill-extrusion-height':['get','overlay_height'],'fill-extrusion-base':['get','overlay_base']}},
      {id:'townhome-live-labels',type:'symbol',source:'labels',layout:{'text-field':['get','house_number'],'text-size':16,'text-allow-overlap':true,'symbol-z-elevate':true,'symbol-elevation-reference':'ground'},paint:{'text-color':'#ffffff','text-halo-color':'#111827','text-halo-width':1,'symbol-z-offset':.05}}
    ]};
    const result = await page.evaluate(async ({token,style,labels}) => {
      const gl = (window as any).mapboxgl;
      gl.accessToken = token;
      const map = new gl.Map({container:'map',style,center:[-78.00015,44.0001],zoom:19,pitch:55,bearing:-20,attributionControl:false});
      const errors:string[]=[];
      map.on('error',(event:any)=>errors.push(event.error.message));
      await new Promise<void>((resolve,reject)=>{map.once('idle',resolve);setTimeout(()=>reject(new Error('Map render timeout')),20000);});
      map.setFeatureState({source:'lot',id:'lot'},{selected:true,status:'LEADS'});
      await new Promise<void>(resolve=>map.once('idle',resolve));
      const hitIds=labels.features.map((label:any)=>{
        const point=map.project(label.geometry.coordinates,label.properties.overlay_height+.05);
        const hit=map.queryRenderedFeatures(point,{layers:['townhome-live-fill','townhome-live-labels']})[0];
        return {expected:label.properties.address_id,actual:hit?.properties.address_id};
      });
      return {errors, rendered:map.queryRenderedFeatures().length,hitIds};
    }, {token,style,labels});
    const output = process.env.MAP_PARITY_OUTPUT ?? '/tmp/wolfgrid-townhome-parity';
    mkdirSync(output,{recursive:true});
    await page.screenshot({path:`${output}/map.png`});
    if(result.errors.length || !result.rendered || result.hitIds.some(hit=>hit.actual!==hit.expected)) throw new Error(JSON.stringify(result));
    console.log('PASS: browser rendered three clipped townhome units and labels above a parcel; every label hit resolves to its own unit');
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
