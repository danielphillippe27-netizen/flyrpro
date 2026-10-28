// Start the web dev server on port 3028 before running this fixture-only phone workflow check.
const {chromium}=require('playwright');
const base=process.env.STORMS_TEST_BASE || 'http://127.0.0.1:3028';
const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true});
const failures=[]; const requests=[];
page.on('pageerror',e=>failures.push(e.message));
const workspace='c02ae085-144b-4234-b1f7-234fd7a937ed';
const territoryId='ac78c005-f4c4-4fda-8f53-63751929e4d2';
const campaignId='9dcf4d6b-64f3-4c7b-8c2c-d1c0581b86b2';
const boundary={type:'Polygon',coordinates:[[[-79.5,43.6],[-79.2,43.6],[-79.2,43.8],[-79.5,43.8],[-79.5,43.6]]]};
const event={key:'hail:test',title:'Recent hail test storm · 2026-10-22',hazard:'hail',source:'iem',sourceId:'reports',start:'2026-10-22T00:00:00Z',end:'2026-10-22T01:00:00Z',reportCount:3,maxHailMM:50,maxWindKPH:null,category:null,active:false,footprintStatus:'surveyed',features:[{type:'Feature',geometry:{type:'Point',coordinates:[-79.35,43.7]},properties:{id:'report',label:'Hail',time:'2026-10-22T00:30:00Z',kind:'report',hailMM:50}}]};
const context={version:2,event:{...event,features:undefined,reportCount:undefined,maxHailMM:undefined,maxWindKPH:undefined,category:undefined,active:undefined,footprintStatus:undefined},selectedAt:'2026-10-22T02:00:00Z',minimumHailMM:25.4,selection:'intensity-zone',evidenceKind:'hail-size',zoneId:territoryId};
const territory={id:territoryId,name:'Test hail area',boundary,context,revision:1};
let drawnTerritory=null;
const drawnTerritoryId='bc154527-f0b6-43c4-a34d-0e1b0245e847';
if(!process.env.STORMS_TEST_REAL_BASEMAP)await page.route('https://api.mapbox.com/**',route=>route.request().url().includes('/fonts/') ? route.fulfill({status:200,body:Buffer.alloc(0)}) : route.fulfill({json:{version:8,glyphs:'http://127.0.0.1:3028/fixtures/fonts/{fontstack}/{range}.pbf',sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#e4eced'}}]}}));
await page.route('**/fixtures/fonts/**',route=>route.fulfill({status:200,body:Buffer.alloc(0)}));
await page.route('https://events.mapbox.com/**',route=>route.fulfill({status:204,body:''}));
await page.route('**/api/storm-maps/**',async route=>{
 const req=route.request(); const u=new URL(req.url()); requests.push({path:u.pathname,auth:req.headers().authorization,workspace:u.searchParams.get('workspaceId'),bbox:u.searchParams.get('bbox'),method:req.method(),body:req.postDataJSON()});
 let json={};
 if(u.pathname.includes('/gl/')) { await route.fulfill({status:401,json:{error:'Weather provider test failure'}}); return; }
 if(u.pathname.endsWith('/settings'))json={addon:{isActive:true}};
 else if(u.pathname.endsWith('/manifest'))json=null;
 else if(u.pathname.endsWith('/events'))json={events:[event],nextCursor:null};
 else if(u.pathname.endsWith('/zones'))json={zones:[{id:territoryId,minimum_mm:25.4,geometry:boundary,source_resolution_m:1000,estimation_method:'verified fixture'}],available:true};
 else if(u.pathname.endsWith('/territories')){
  if(req.method()==='POST'&&req.postDataJSON().context.selection==='user-drawn'){
   drawnTerritory={...req.postDataJSON(),id:drawnTerritoryId,revision:1};json={territory:drawnTerritory};
  }else json=req.method()==='POST'?{territory}:{territories:[territory]};
 }
 else if(u.pathname.endsWith('/campaign-plan')){
  const selected=req.postDataJSON().territoryId===drawnTerritoryId?drawnTerritory:territory;
  json={parts:[{boundary:selected.boundary,addressCount:12}],name:selected.name,context:{...selected.context,territoryId:selected.id}};
 }
 else if(u.pathname.endsWith('/address-count'))json={count:process.env.STORMS_TEST_DRAWN_CAMPAIGN&&JSON.stringify(req.postDataJSON())!==JSON.stringify(boundary)?12:Number(process.env.STORMS_TEST_LARGE_COUNT)||0,partial:false,zoom:14,regions:['ON']};
 else if(u.pathname.endsWith('/exposure'))json={counts:[{minimumMM:25.4,count:2400}],available:true};
 await route.fulfill({json});
});
let provisionAttempts=0;
await page.route('**/api/campaigns/provision',async route=>{
 requests.push({path:'/api/campaigns/provision',auth:route.request().headers().authorization,method:route.request().method(),body:route.request().postDataJSON()});
 provisionAttempts++;
 await route.fulfill(provisionAttempts===1
  ? {status:503,json:{error:'Home provisioning temporarily unavailable. Retry.'}}
  : {json:{success:true,status:'ready',addressCount:12}});
});
await page.route('**/api/campaigns',async route=>{requests.push({path:'/api/campaigns',auth:route.request().headers().authorization,method:route.request().method(),body:route.request().postDataJSON()});await route.fulfill({json:{id:campaignId}})});
await page.goto(`${base}/mobile/storms?chrome=map&inset=20&country=US&type=hail`,{waitUntil:'domcontentloaded',timeout:120000});
await page.waitForFunction(()=>!!window.WolfGridStorms,null,{timeout:60000});
await page.evaluate(({workspace})=>window.WolfGridStorms.start({accessToken:'fixture-session',workspaceId:workspace,center:[-79.35,43.7]}),{workspace});
await page.getByRole('button',{name:/Recent hail test storm/}).waitFor({timeout:60000});
assert(requests.filter(r=>r.path.endsWith('/events')).every(r=>r.bbox==='-180,-85,180,85'), 'Discover storms across all coverage, regardless of map center');
assert.equal(await page.getByRole('button',{name:'Layers',exact:true}).count(),0);
assert.equal(await page.getByRole('complementary',{name:'Weather legends'}).count(),0);
assert.equal(await page.getByRole('slider',{name:'Weather timeline'}).count(),0);
assert.equal(await page.locator('.mapboxgl-ctrl-zoom-in:visible,.mapboxgl-ctrl-geolocate:visible,.mapboxgl-ctrl-attrib-button:visible').count(),0);
await page.evaluate(()=>fetch('/api/storm-maps/gl/test-capability/tile',{headers:{Authorization:'Bearer weather-session'}}));
assert.equal(await page.getByText(/Your session expired/).count(),0,'Weather failures must not claim the app session expired');
assert.equal(requests.find(r=>r.path.includes('/gl/')).auth,'Bearer weather-session');

const stormRow = page.getByRole('button',{name:/Recent hail test storm/});
assert.equal(((await stormRow.innerText()).match(/2026-10-22/g)||[]).length,1,'Storm date appears once');
const savedIcon = await page.getByRole('button',{name:'Saved storm maps',exact:true}).boundingBox();
const settingsIcon = await page.getByRole('button',{name:'Map settings',exact:true}).boundingBox();
assert(Math.abs(savedIcon.x-settingsIcon.x)<1 && savedIcon.y>settingsIcon.y,'Saved aligns in the right icon column');
await page.screenshot({path:'/tmp/wolfgrid-mobile-storms-recent.png'});
if (Number(process.env.STORMS_TEST_LARGE_COUNT) > 4000 && !process.env.STORMS_TEST_DRAWN_CAMPAIGN) {
 await page.getByRole('button',{name:'Saved storm maps',exact:true}).click();
 await page.getByRole('button',{name:/Test hail area/}).click();
 await page.getByRole('button',{name:'Create storm territory',exact:true}).waitFor();
 await page.waitForTimeout(1200);
 assert.equal(await page.getByRole('button',{name:'Create campaign',exact:true}).count(),0);
 assert.equal(await page.getByRole('button',{name:'Create area campaign',exact:true}).count(),0);
 await page.getByText(/This area has over 4,000 homes/).waitFor();
 await page.screenshot({path:'/tmp/wolfgrid-mobile-large-territory.png'});
 await page.getByRole('button',{name:'Create storm territory',exact:true}).click();
 await page.getByText('Tap to draw. Tap the first point to finish.',{exact:true}).waitFor();
 await page.waitForTimeout(800);
 assert(!requests.some(r=>r.path==='/api/campaigns'||r.path.endsWith('/campaign-plan')||r.path.endsWith('/provision')),'A large storm territory must never start split campaigns');
 await page.screenshot({path:'/tmp/wolfgrid-mobile-large-territory-draw.png'});
 assert.equal(failures.length,0,failures.join('\n'));
 console.log(JSON.stringify({passed:true,addressCount:Number(process.env.STORMS_TEST_LARGE_COUNT),checks:['Create storm territory replaces campaign action','large area remains a saved overlay','drawing starts on the unobstructed map','no campaign planning, creation or provisioning']}));
 await browser.close();
 return;
}

await page.getByRole('button',{name:/Recent hail test storm/}).click();
await page.getByRole('button',{name:'Storm info',exact:true}).waitFor();
assert.equal(await page.getByRole('complementary',{name:'Storm list'}).isVisible(),false,'Selecting a storm leaves a clean map');
assert.equal(await page.getByRole('button',{name:'Saved storm maps'}).innerText(),'');
assert.equal(await page.getByRole('button',{name:'Map settings'}).innerText(),'');
await page.getByRole('button',{name:'Storm info',exact:true}).click();
await page.getByText('Select a hail zone on the map.',{exact:true}).waitFor();
await page.getByRole('button',{name:'Hide storm list',exact:true}).click();
await page.waitForTimeout(900);
await page.screenshot({path:'/tmp/wolfgrid-mobile-storms-zone.png'});
await page.locator('.mapboxgl-canvas').click({position:{x:195,y:422}});
await page.getByRole('button',{name:'Storm info',exact:true}).click();
await page.getByLabel('Selected zone territory name').fill('Selected hail area');
await page.getByRole('region',{name:'Find storm content'}).getByRole('button',{name:'Create storm territory',exact:true}).click();
await page.waitForTimeout(300);
assert(requests.some(r=>r.path.endsWith('/territories')&&r.method==='POST'&&r.body.context.evidenceKind==='hail-size'),'Tapping the verified zone saves its actual hail geometry');
await page.getByRole('button',{name:'Draw campaign area',exact:true}).click();
assert.equal(await page.getByRole('complementary',{name:'Storm list'}).isVisible(),false,'Drawing starts on the unobstructed map');
await page.locator('.mapboxgl-canvas').tap({position:{x:150,y:380}});
await page.waitForTimeout(200);
await page.locator('.mapboxgl-canvas').tap({position:{x:240,y:380}});
await page.waitForTimeout(200);
await page.locator('.mapboxgl-canvas').tap({position:{x:240,y:450}});
await page.waitForTimeout(200);
await page.locator('.mapboxgl-canvas').tap({position:{x:150,y:450}});
await page.waitForTimeout(200);
await page.locator('.mapboxgl-canvas').tap({position:{x:150,y:380}});
await page.getByRole('button',{name:'Create campaign',exact:true}).waitFor({timeout:5000}).catch(async error => { await page.screenshot({path:'/tmp/storm-draw-failure.png'}); throw error; });
await page.getByRole('button',{name:'Hide storm list',exact:true}).click();
await page.getByRole('button',{name:'Review campaign area',exact:true}).click();
await page.getByText(process.env.STORMS_TEST_DRAWN_CAMPAIGN?'12':'Unknown',{exact:true}).waitFor();
if(process.env.STORMS_TEST_DRAWN_CAMPAIGN)assert.equal(await page.getByText('6,446',{exact:true}).count(),0,'The full storm home count is absent from drawn campaign controls');
assert.equal(await page.getByRole('button',{name:/Test hail area/}).count(),0,'Drawing hides the parent territory campaign actions');
assert.equal(await page.getByRole('button',{name:'Create campaign',exact:true}).count(),1,'Only the drawn area has a campaign action');
await page.getByRole('button',{name:'Create campaign',exact:true}).waitFor();
await page.screenshot({path:'/tmp/wolfgrid-mobile-storms-area.png'});
const panel = await page.getByRole('complementary', { name: 'Storm list' }).boundingBox();
assert(panel.y > 300 && panel.height < 520, 'Phone storm sheet must leave the map exposed');
await page.getByRole('button',{name:'Create campaign',exact:true}).click();
await page.getByRole('alert').filter({hasText:'Home provisioning temporarily unavailable. Retry.'}).waitFor();
await page.getByRole('button',{name:'Continue creating campaign',exact:true}).click();
await page.waitForTimeout(600);
const creation=requests.find(r=>r.path==='/api/campaigns'&&r.method==='POST');
assert(creation);assert.equal(creation.body.area_only,undefined);assert.equal(creation.body.workspace_id,workspace);assert(drawnTerritory);assert.deepEqual(creation.body.territory_boundary,drawnTerritory.boundary);assert.notDeepEqual(creation.body.territory_boundary,boundary,'The campaign must never use the full reference outline');
assert.deepEqual(requests.find(r=>r.path.endsWith('/campaign-plan')).body,{territoryId:drawnTerritoryId});
assert.equal(requests.filter(r=>r.path.endsWith('/territories')&&r.method==='POST'&&r.body.context.selection==='user-drawn').length,1,'Provisioning retry reuses the drawn area');
assert(requests.filter(r=>!r.path.includes('/gl/')).every(r=>r.auth==='Bearer fixture-session'));
assert.equal(requests.filter(r=>r.path.includes('/gl/')).length,1);
assert(requests.filter(r=>r.path.startsWith('/api/storm-maps/')&&!r.path.includes('/gl/')).every(r=>r.workspace===workspace));
assert(requests.some(r=>r.path.endsWith('/provision')&&r.body.campaign_id===campaignId),'Create campaign must provision its homes');
assert.equal(requests.filter(r=>r.path==='/api/campaigns').length,1,'Retry provisioning the existing campaign without creating a duplicate');
assert.equal(provisionAttempts,2,'A failed home provision can be retried');
assert.equal(await page.getByRole('button',{name:'Create area campaign',exact:true}).count(),0);
assert.equal(failures.length,0,failures.join('\n'));
console.log(JSON.stringify({passed:true,checks:['phone-sized storm discovery opens first','recent hail selection and tapping its verified area','drawn campaign uses its own smaller boundary and count','full storm remains a reference overlay','address campaign POST with native auth/workspace','home provisioning','zero estimate displays Unknown','one Create campaign action','no JavaScript runtime errors'],apiRequests:requests.length}));
await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
