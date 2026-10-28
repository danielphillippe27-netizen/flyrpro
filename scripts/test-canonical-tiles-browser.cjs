/** Local renderer acceptance. Supply private fixtures; never commit campaign data.
 * node scripts/test-canonical-tiles-browser.cjs <bundle-v2.json> <campaign.pmtiles> <fixture.json> <output-dir>
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const { chromium } = require('playwright');
const { PMTiles } = require('pmtiles');
require('dotenv').config({ path: '.env.local', quiet: true });

async function main() {
  const [bundleFile, archiveFile, fixtureFile, output] = process.argv.slice(2);
  assert(output, 'Supply bundle, archive, fixture and output directory');
  await fs.mkdir(output, { recursive: true });
  const bundle = JSON.parse(await fs.readFile(bundleFile));
  const fixture = JSON.parse(await fs.readFile(fixtureFile));
  const handle = await fs.open(archiveFile);
  const archive = new PMTiles({ getKey: () => archiveFile, getBytes: async (offset, length) => {
    const bytes = Buffer.alloc(length); await handle.read(bytes, 0, length, offset);
    return { data: bytes.buffer };
  } });
  const errors = [];
  const script = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React, {useState} from 'react'; import {createRoot} from 'react-dom/client';
    import mapboxgl from 'mapbox-gl';
    import {CanonicalCampaignTilesLayer} from './components/map/CanonicalCampaignTilesLayer';
    import {DEFAULT_STATUS_FILTERS} from './lib/constants/mapStatus';
    const data = await fetch('/fixture').then(r=>r.json());
    mapboxgl.accessToken = data.token;
    const style = {version:8,glyphs:'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',sources:{},layers:[{id:'bg',type:'background',paint:{'background-color':'#192331'}}]};
    const map = new mapboxgl.Map({container:'map',style,center:data.fixture.targets[0].buildingCoordinate,zoom:18,pitch:0,preserveDrawingBuffer:true,attributionControl:false});
    window.map = map; window.hits=[]; window.mapErrors=[];
    map.on('error',e=>window.mapErrors.push(e.error.message));
    function App() {
      const [mode,setMode]=useState('buildings'); const [styleKey,setStyleKey]=useState('initial');
      const [addresses,setAddresses]=useState(data.bundle.records.addresses.map(r=>({...r.properties,id:r.id,campaign_id:data.bundle.campaign_id,coordinate:{lon:r.coordinate[0],lat:r.coordinate[1]},address_status:'none',scans:0})));
      const [selectedIds,setSelected]=useState([]); const [deleted,setDeleted]=useState([]);
      const [visible,setVisible]=useState(undefined);
      window.controls={setMode,setSelected,setDeleted,setVisible,
        status:(id,status)=>setAddresses(a=>a.map(r=>r.id===id?{...r,address_status:status}:r)),
        resetStyle:()=>{map.setStyle(style,{diff:false});setStyleKey('reset');}};
      return <CanonicalCampaignTilesLayer map={map} bundle={data.bundle} mapLoaded={true} styleKey={styleKey}
        mode={mode} addresses={addresses} dark={false} showParcels={false} showAddressLabels={false} statusFilters={DEFAULT_STATUS_FILTERS}
        selectedIds={selectedIds} deletedAddressIds={deleted} visibleAddressIds={visible}
        onClick={hit=>window.hits.push(hit)}/>;
    }
    map.once('load',()=>{createRoot(document.getElementById('controls')).render(<App/>);window.ready=true;});
  ` }, bundle: true, write: false, format: 'esm', target: 'es2022', jsx: 'automatic',
    plugins: [{ name: 'isolate-realtime', setup(builder) {
      // Exercise the actual renderer/state join without subscribing to production data.
      builder.onResolve({ filter: /useCardEngagement$/ }, () => ({ path: 'card-hook', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export function useCardEngagement(){}', loader: 'js' }));
    } }], define: { 'process.env.NODE_ENV': '"development"' } });
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === '/') { response.setHeader('Content-Type','text/html'); response.end('<style>body{margin:0}#map{width:100vw;height:100vh}</style><link rel="stylesheet" href="/map.css"><div id="map"></div><div id="controls"></div><script type="module" src="/app.js"></script>'); }
      else if (request.url === '/app.js') { response.setHeader('Content-Type','application/javascript'); response.end(script.outputFiles[0].contents); }
      else if (request.url === '/map.css') { response.setHeader('Content-Type','text/css'); response.end(await fs.readFile(require.resolve('mapbox-gl/dist/mapbox-gl.css'))); }
      else if (request.url === '/fixture') { response.setHeader('Content-Type','application/json'); response.end(JSON.stringify({ bundle: {...bundle,tiles:{...bundle.tiles,tile_url_template:`http://127.0.0.1:${server.address().port}/tile/{z}/{x}/{y}.mvt`}},fixture,
        token:process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN })); }
      else if (request.url.startsWith('/tile/')) { const parts = request.url.split('/').slice(2).map(x=>Number(x.replace('.mvt',''))); const result = await archive.getZxy(...parts); response.statusCode=result?200:204; response.setHeader('Content-Type','application/vnd.mapbox-vector-tile'); response.end(result?Buffer.from(result.data):undefined); }
      else { response.statusCode=404; response.end(); }
    } catch(error) { response.statusCode=500; response.end(); errors.push(error.message); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true,channel:'chrome',args:['--use-angle=metal']});
    const page = await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:1});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>window.ready && window.controls);
    const target=fixture.targets[0], neighbour=fixture.targets[1];
    const measurements=[];
    const sample = async (coordinate) => page.evaluate(point=> {
      const p=window.map.project(point), canvas=window.map.getCanvas(), gl=canvas.getContext('webgl2');
      const rgba=new Uint8Array(4); gl.readPixels(Math.round(p.x),canvas.height-1-Math.round(p.y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
      return Array.from(rgba);
    },coordinate);
    const distance=(a,b)=>a.slice(0,3).reduce((s,v,i)=>s+Math.abs(v-b[i]),0);
    for(const mode of ['buildings','addresses']) {
      await page.evaluate(mode=>window.controls.setMode(mode),mode);
      const layer=mode==='buildings'?'canonical-buildings':'canonical-address-circles';
      const coordinate=mode==='buildings'?target.buildingCoordinate:target.coordinate;
      const neighbourPoint=mode==='buildings'?neighbour.buildingCoordinate:neighbour.coordinate;
      await page.waitForFunction(({layer,coordinate})=>window.map.getLayer(layer)&&window.map.queryRenderedFeatures(window.map.project(coordinate),{layers:[layer]}).length>0,{layer,coordinate});
      await page.waitForTimeout(500); // Let the initial style colour transition settle before sampling its baseline.
      const before=await sample(coordinate), neighbourBefore=await sample(neighbourPoint);
      await page.screenshot({path:path.join(output,`${mode}-baseline.png`)});
      for(const status of ['attempted','talked','lead','appointment','do_not_knock','none']) {
        await page.evaluate(({id,status})=>window.controls.status(id,status),{id:target.address,status});
        await page.waitForTimeout(400);
        const after=await sample(coordinate), neighbourAfter=await sample(neighbourPoint);
        await page.screenshot({path:path.join(output,`${mode}-${status}.png`)});
        const state=await page.evaluate(id=>window.map.getFeatureState({source:'campaign-canonical-tiles',sourceLayer:'buildings',id:'building:'+id}),neighbour.building);
        assert.equal(state.status,'UNTOUCHED','Neighbour feature state stays untouched');
        if(status==='lead') assert(distance(before,after)>20,`${mode} must visibly change colour`);
        assert(distance(neighbourBefore,neighbourAfter)<15,`${mode} neighbour must not change: ${neighbourBefore} -> ${neighbourAfter}`);
        measurements.push({mode,status,pixel:after,neighbour:neighbourAfter});
        await page.screenshot({path:path.join(output,`${mode}-${status}.png`)});
      }
      const p=await page.evaluate(point=>window.map.project(point),coordinate);
      await page.mouse.click(p.x,p.y);
      const hit=await page.evaluate(()=>window.hits.at(-1));
      assert.equal(mode==='buildings'?hit?.buildingId:hit?.addressId,mode==='buildings'?target.building:target.address,'Click resolves canonical identity');
    }
    await page.evaluate(id=>{window.controls.status(id,'lead');window.controls.resetStyle();},target.address);
    await page.waitForFunction(id=>window.map.getSource('campaign-canonical-tiles') && window.map.getFeatureState({source:'campaign-canonical-tiles',sourceLayer:'address_circles',id:'address:'+id}).status==='LEADS',target.address);
    await page.evaluate(()=>window.map.jumpTo({zoom:12}));
    await page.waitForFunction(()=>window.map.areTilesLoaded() &&
      window.map.querySourceFeatures('campaign-canonical-tiles',{sourceLayer:'buildings'}).length > 0 &&
      window.map.querySourceFeatures('campaign-canonical-tiles',{sourceLayer:'address_circles'}).length > 0);
    await page.evaluate(()=>window.map.jumpTo({zoom:18}));
    await page.waitForFunction(()=>window.map.areTilesLoaded());
    await page.evaluate(id=>window.controls.setDeleted([id]),target.address);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(point=>window.map.queryRenderedFeatures(window.map.project(point),{layers:['canonical-address-circles']}).length,target.coordinate),0,'Deleted address excluded from hit testing');
    errors.push(...await page.evaluate(()=>window.mapErrors));
    assert.deepEqual(errors,[],'No renderer or tile errors');
    await fs.writeFile(path.join(output,'report.json'),JSON.stringify({result:'PASS',scope:'Actual web tile renderer, local canonical fixture, no production writes',measurements},null,2));
    console.log('PASS: visible home/pin colours, unaffected neighbours, canonical clicks, mode switches, style replay and deletion');
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); await handle.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
