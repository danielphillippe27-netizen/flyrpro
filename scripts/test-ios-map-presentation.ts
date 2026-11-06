import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { IOS_BUILDING_LAYOUT, IOS_BUILDING_DEPTH, IOS_ADDRESS_LAYOUT, IOS_ADDRESS_DEPTH, IOS_ADDRESS_HEIGHT, iosParcelPaint } from '../lib/map/iosMapPresentation';
import { getBuildingExtrusionHeightExpression } from '../lib/map/buildingHeight';
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
    const style = { version:8, sources: Object.fromEntries([['house',house],['lot',parcel],['pin',circle]].map(([id,data])=>[id,{type:'geojson',data}])), layers:[
      {id:'background',type:'background',paint:{'background-color':'#e8edf1'}},
      {id:'parcels',type:'fill',source:'lot',paint:{'fill-color':'#2563eb','fill-opacity':parcels.fillOpacity}},
      {id:'parcel-outline',type:'line',source:'lot',paint:{'line-color':'#2563eb','line-opacity':parcels.lineOpacity,'line-width':parcels.lineWidth}},
      {id:'homes',type:'fill-extrusion',source:'house',layout:IOS_BUILDING_LAYOUT,paint:{...IOS_BUILDING_DEPTH,'fill-extrusion-color':'#b6d1e6','fill-extrusion-height':getBuildingExtrusionHeightExpression()}},
      {id:'pins',type:'fill-extrusion',source:'pin',layout:IOS_ADDRESS_LAYOUT,paint:{...IOS_ADDRESS_DEPTH,'fill-extrusion-color':'#22c55e','fill-extrusion-height':IOS_ADDRESS_HEIGHT}},
    ]};
    const result = await page.evaluate(async ({token,style}) => {
      const gl = (window as any).mapboxgl;
      gl.accessToken = token;
      const map = new gl.Map({container:'map',style,center:[-78.00015,44.0001],zoom:19,pitch:55,bearing:-20,attributionControl:false});
      const errors:string[]=[];
      map.on('error',(event:any)=>errors.push(event.error.message));
      await new Promise<void>((resolve,reject)=>{map.once('idle',resolve);setTimeout(()=>reject(new Error('Map render timeout')),20000);});
      map.setFeatureState({source:'lot',id:'lot'},{selected:true,status:'LEADS'});
      await new Promise<void>(resolve=>map.once('idle',resolve));
      return {errors, rendered:map.queryRenderedFeatures().length};
    }, {token,style});
    if(result.errors.length || !result.rendered) throw new Error(JSON.stringify(result));
    const output = process.env.MAP_PARITY_OUTPUT ?? '/tmp/wolfgrid-ios-map-parity';
    mkdirSync(output,{recursive:true});
    await page.screenshot({path:`${output}/map.png`});
    console.log('PASS: browser rendered concave rounded building, address cylinder and selected parcel without Mapbox errors');
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
