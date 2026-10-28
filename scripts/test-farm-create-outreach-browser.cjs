const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {build}=require('esbuild'),{chromium}=require('playwright');
(async()=>{
const root=process.cwd(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'wolfgrid-create-outreach-'));let server,browser;const writes=[];
const mocks={
'next/link':`export default function Link({children,href,...props}){return <a href={href} {...props}>{children}</a>;}`,
'next/navigation':`export const useRouter=()=>({push:url=>document.getElementById('navigation').textContent=url});`,
'@/lib/supabase/client':`export const createClient=()=>({auth:{getUser:async()=>({data:{user:{id:'fixture-owner'}}})}});`,
'@/lib/theme-provider':`export const useTheme=()=>({theme:'dark'});`,
'@/lib/map-style-provider':`export const useMapStyle=()=>({preset:'fixture'});`,
'@/lib/workspace-context':`export const useWorkspace=()=>({currentWorkspaceId:'fixture-workspace'});`,
'@/lib/mapbox':`export const getMapboxToken=()=> 'fixture';`,
'@/lib/map-styles':`const style={key:'fixture',style:{version:8,sources:{},layers:[]}};export const resolveMapStyle=()=>style;export const applyPresetVisualTweaks=()=>{};export const hideBaseBuildingLayers=()=>{};export const applyResolvedMapStyle=()=>{};`,
'@/lib/services/FarmService':`export const FarmTouchService={createSession:async payload=>{window.fixtureTouches.push(payload);return payload;}};`,
'mapbox-gl':`class Map {on(event,fn){if(event==='load')setTimeout(fn,10);return this;}off(){}getLayer(){return null;}getStyle(){return{layers:[]};}addLayer(){}addControl(){}fitBounds(){}resize(){}remove(){}removeControl(){}once(){}getCenter(){return{lng:0,lat:0};}getZoom(){return 14;}}export default{Map};`,
'@mapbox/mapbox-gl-draw':`export default class Draw{constructor(){this.data={type:'FeatureCollection',features:[]}}set(data){this.data=data;}getAll(){return this.data;}deleteAll(){this.data={type:'FeatureCollection',features:[]};}changeMode(){}}`,
'@/components/address/AddressAutocomplete':`export const AddressAutocomplete=()=>null;`,
'@/components/map/MapInfoButton':`export const MapInfoButton=()=>null;`,
'@/components/map/UserLocationLayer':`export const UserLocationLayer=()=>null;`,
'lottie-react':`export default function Lottie(){return null;}`,
};
try{
const entry=path.join(temp,'entry.tsx');await fs.writeFile(entry,`import React from'react';import{createRoot}from'react-dom/client';import{FarmCreationWorkspace}from ${JSON.stringify(path.join(root,'components/farms/FarmCreationWorkspace.tsx'))};window.fixtureTouches=[];const boundary={type:'Polygon',coordinates:[[[-79.4,43.6],[-79.3,43.6],[-79.3,43.7],[-79.4,43.6]]]};createRoot(document.getElementById('root')).render(<FarmCreationWorkspace initialBoundary={boundary}/>);`);
await build({entryPoints:[entry],outfile:path.join(temp,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',nodePaths:[path.join(root,'node_modules')],tsconfig:path.join(root,'tsconfig.json'),loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'external-boundaries',setup(b){b.onResolve({filter:/.*/},args=>Object.hasOwn(mocks,args.path)?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:root}));}}]});
server=http.createServer(async(req,res)=>{
res.setHeader('Content-Type','application/json');
if(req.url.startsWith('/api/farms/address-count'))return res.end(JSON.stringify({count:1003,partial:false,regions:['ON'],zoom:14}));
if(req.url==='/api/farms'){let body='';for await(const chunk of req)body+=chunk;writes.push(JSON.parse(body));return res.end(JSON.stringify({id:'fixture-farm',linked_campaign_id:'fixture-campaign',workspace_id:'fixture-workspace'}));}
if(req.url.endsWith('/import-homes'))return res.end(JSON.stringify({totalCount:1003}));
if(req.url.endsWith('/annual-coverage')){let body='';for await(const chunk of req)body+=chunk;writes.push(JSON.parse(body));return res.end(JSON.stringify({plan:{}}));}
if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(await fs.readFile(path.join(temp,'app.js')));}
if(req.url.endsWith('.json'))return res.end('{}');
res.setHeader('Content-Type','text/html');res.end('<html><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root" style="height:100vh"></div><div id="navigation"></div><script src="/app.js"></script></body></html>');
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
page.setDefaultTimeout(5000);await page.getByLabel('Farm name',{exact:true}).waitFor().catch(async error=>{console.error({errors,body:await page.locator('body').innerText()});throw error;});assert.equal(await page.getByLabel('Campaign name',{exact:true}).count(),0);
await page.getByRole('button',{name:/Create farm/}).click();await page.getByText('Enter a farm name.',{exact:true}).waitFor();assert.equal(writes.length,0);
await page.getByLabel('Farm name',{exact:true}).fill('Fixture farm');await page.getByLabel('Start date',{exact:true}).fill('2026-11-02');await page.getByLabel('Door-knocking rounds in this plan',{exact:true}).fill('2');await page.getByLabel('Calling rounds in this plan',{exact:true}).fill('1');
await page.getByText('Holidays & vacation dates',{exact:false}).first().click();await page.getByLabel('First day off',{exact:true}).fill('2026-12-25');await page.getByRole('button',{name:'Add time off',exact:true}).click();await page.getByText('1,003 homes',{exact:false}).first().waitFor();
await page.getByRole('button',{name:/Create farm/}).click();await page.waitForFunction(()=>document.getElementById('navigation').textContent.includes('/farms/fixture-farm'));
assert.equal(writes.length,2);assert.equal(writes[0].name,'Fixture farm');assert.equal(writes[0].campaign_name,'Fixture farm');assert.equal(writes[0].coverage_settings.outreach.doorsPerDay,50);assert.deepEqual(writes[0].coverage_settings.outreach.workingDays,[1,2,3,4,5,6]);assert.deepEqual(writes[1].outreach.holidays,['2026-12-25']);
const touches=await page.evaluate(()=>window.fixtureTouches);assert.equal(touches.length,3);assert.equal(touches.filter(x=>x.mode==='doorknock').length,2);assert.equal(touches.filter(x=>x.mode==='phone_call').length,1);assert.equal(await page.evaluate(()=>localStorage.getItem('wolfgrid:farm-plan-mode:fixture-farm')),'annual');assert.deepEqual(errors,[]);
console.log('PASS real creation component with isolated services: single name, validation, guided answers, saved settings before import, canonical import, annual save, selected round touchpoints and Dashboard handoff.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
