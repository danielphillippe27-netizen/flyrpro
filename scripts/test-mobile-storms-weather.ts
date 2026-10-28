/** Read-only weather integration: app APIs are fixtures; the MapsGL proxy and provider are real. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { config } from 'dotenv';
import { issueStormMapsTileToken } from '../lib/storm-maps/token';
import { reportEvents } from '../lib/storm-maps/intelligence/normalize';
config({ path: '.env.local', quiet: true });
const base = process.env.STORMS_TEST_BASE || 'http://127.0.0.1:3028';
const workspace = 'c02ae085-144b-4234-b1f7-234fd7a937ed';
async function main() {
  const end = new Date().toISOString(), start = new Date(Date.now()-6*86400000).toISOString();
  const compact = (s: string) => s.replace(/[-:TZ.]/g, '').slice(0,12);
  const reports = await fetch(`https://mesonet.agron.iastate.edu/geojson/lsr.php?sts=${compact(start)}&ets=${compact(end)}`, { signal: AbortSignal.timeout(30000) });
  assert.equal(reports.status, 200);
  const events = reportEvents(await reports.json(), [-180,-85,180,85], start, end, 'hail').sort((a,b)=>Date.parse(b.start)-Date.parse(a.start));
  assert(events.length > 1, 'Real nationwide recent hail reports must be present');
  const event = events.find(e=>e.title.startsWith('AZ ') && e.start.startsWith('2026-10-21')) || events[0];
  const token = issueStormMapsTileToken(workspace, ['xweather:gl']);
  const browser = await chromium.launch({headless:true,channel:'chrome',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const errors: string[] = []; const weather: {path:string,status:number}[] = [];
    page.on('pageerror',()=>errors.push('Browser runtime error'));
    page.on('response',r=>{const u=new URL(r.url());if(u.pathname.includes('/api/storm-maps/gl/')) weather.push({path:u.pathname.replace(/\/gl\/[^/]+/,'/gl/[capability]'),status:r.status()});});
    if(!process.env.STORMS_TEST_REAL_BASEMAP)await page.route('https://api.mapbox.com/**',r=>r.fulfill({json:{version:8,glyphs:`${base}/fixtures/fonts/{fontstack}/{range}.pbf`,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#252525'}}]}}));
    await page.route('**/fixtures/fonts/**',r=>r.fulfill({status:200,body:Buffer.alloc(0)}));
    await page.route('https://events.mapbox.com/**',r=>r.fulfill({status:204,body:''}));
    await page.route('**/api/**',async route=>{
      const req=route.request(),u=new URL(req.url());
      if(u.pathname.includes('/api/storm-maps/gl/')) {
        assert(!u.pathname.includes('/session-'), 'Native renderer uses a weather capability, not a cookie session');
        assert.notEqual(req.headers().authorization,'Bearer app-fixture','Never send app credentials upstream');
        return route.continue();
      }
      assert.equal(req.headers().authorization,'Bearer app-fixture');
      if(u.pathname.endsWith('/events')) { assert.equal(u.searchParams.get('bbox'),'-180,-85,180,85');return route.fulfill({json:{events,nextCursor:null}}); }
      if(u.pathname.endsWith('/settings'))return route.fulfill({json:{addon:{isActive:true}}});
      if(u.pathname.endsWith('/manifest'))return route.fulfill({json:{enabled:true,glToken:token.token,expiresAt:token.expiresAt,providerHealth:{xweather:{available:true,status:'ready'}}}});
      if(u.pathname.endsWith('/zones'))return route.fulfill({json:{zones:[],available:false}});
      if(u.pathname.endsWith('/territories'))return route.fulfill({json:req.method()==='POST'?{territory:{...req.postDataJSON(),id:'1b4bfab1-e49f-401e-9479-469719593c67',revision:1}}:{territories:[]}});
      if(u.pathname.endsWith('/address-count'))return route.fulfill({json:{count:6446,partial:false,zoom:10,regions:['AZ']}});
      return route.fulfill({status:599,json:{error:'Unexpected app request blocked'}});
    });
    await page.goto(`${base}/mobile/storms?chrome=map&country=US&type=hail`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>!!window.WolfGridStorms,null,{timeout:60000});
    await page.evaluate(({workspace})=>window.WolfGridStorms!.start({accessToken:'app-fixture',workspaceId:workspace,center:[-79.35,43.7]}),{workspace});
    await page.getByRole('button',{name:new RegExp(event.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click({timeout:60000});
    await page.getByRole('complementary',{name:'Storm list'}).waitFor({state:'hidden'});
    // Wait for actual weather-image responses; no provider response is mocked.
    const until=Date.now()+60000;
    while(Date.now()<until&&!weather.some(r=>r.path.endsWith('.png')&&r.status===200)) await page.waitForTimeout(1000);
    assert(weather.some(r=>r.path.endsWith('/auth/token')&&r.status===200),'Provider login succeeds');
    assert(weather.some(r=>r.path.endsWith('.png')&&r.status===200),'Real hail imagery loads');
    assert(!weather.some(r=>r.status>=400),JSON.stringify(weather));
    assert.equal(await page.getByText(/Your session expired/).count(),0);
    assert.equal(errors.length,0);
    await page.getByText('Loading weather…',{exact:true}).waitFor({state:'hidden',timeout:60000});
    await page.waitForTimeout(2500);
    await page.screenshot({path:'/tmp/wolfgrid-mobile-real-hail.png'});
    // Optional read-only probe into a shaded point observed in the screenshot.
    // Coordinates belong to the selected real storm, never to synthetic provider data.
    const probe = process.env.STORMS_TEST_HAIL_TAP?.split(',').map(Number);
    if (probe) {
      assert(probe.length === 2 && probe.every(Number.isFinite), 'Supply a screenshot-observed x,y hail point');
      await page.locator('.mapboxgl-canvas').tap({position:{x:probe[0],y:probe[1]}});
      await page.getByLabel('Storm territory name',{exact:true}).waitFor({timeout:45000}).catch(async error => {
        await page.screenshot({path:'/tmp/wolfgrid-mobile-real-hail-selection.png'});
        throw error;
      });
      assert(await page.getByText(/Clicked estimate:/).isVisible(), 'Real numerical hail sampling produces a reviewed zone');
      await page.screenshot({path:'/tmp/wolfgrid-mobile-real-hail-selection.png'});
      if(process.env.STORMS_TEST_SAVE_TERRITORY){
        await page.getByRole('button',{name:'Create storm territory',exact:true}).click();
        await page.getByText('Storm territory saved.',{exact:true}).waitFor();
        await page.getByRole('button',{name:'Hide storm list',exact:true}).click();
        await page.waitForTimeout(1200);
        await page.screenshot({path:'/tmp/wolfgrid-mobile-saved-territory-clear.png'});
      }
    }
    console.log(JSON.stringify({passed:true,recentStorms:events.length,selected:event.title,providerLogin:true,hailImages:weather.filter(r=>r.path.endsWith('.png')&&r.status===200).length,weatherErrors:0,numericalHailSelection:!!probe}));
  } finally { await browser.close(); }
}
main().catch(e=>{console.error(e instanceof Error ? e.message.replace(/\/gl\/[^/\s]+/g,'/gl/[capability]') : 'Weather integration failed');process.exitCode=1;});
