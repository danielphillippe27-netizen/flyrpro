const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {build} = require('esbuild');
const {compile} = require('@tailwindcss/node');
const {chromium} = require('playwright');
(async()=>{
 const root=process.cwd(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'wolfgrid-annual-review-'));
 let browser,server;const homes=Array.from({length:1003},(_,index)=>({id:String(index),formatted:`${index+1} Farm Street`,street_name:'Farm Street',house_number:String(index+1),farm_id:'f',last_outcome_status:null}));let saved=null;
 try{
  await build({entryPoints:[path.join(root,'lib/farms/annual-coverage.ts')],outfile:path.join(temp,'model.cjs'),bundle:true,platform:'node',format:'cjs'});
  const {buildAnnualCoveragePlan}=require(path.join(temp,'model.cjs'));
  const entry=path.join(temp,'entry.tsx');await fs.writeFile(entry,`import React from 'react';import{createRoot}from'react-dom/client';import{FarmPlanModes}from ${JSON.stringify(path.join(root,'components/farms/FarmPlanModes.tsx'))};const homes=${JSON.stringify(homes)};createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-7xl p-4 sm:p-6"><FarmPlanModes farmId="f" addresses={homes} touches={[]} outcomes={[]} onAddContact={home=>document.getElementById('contact').textContent=home.id}><p>Existing touchpoint plan</p></FarmPlanModes><div id="contact"/></main>);`);
  await build({entryPoints:[entry],outfile:path.join(temp,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',nodePaths:[path.join(root,'node_modules')],tsconfig:path.join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'}});
  const compiler=await compile(await fs.readFile(path.join(root,'app/globals.css'),'utf8'),{base:path.join(root,'app'),onDependency(){}});
  const source=(await Promise.all(['components/farms/FarmAnnualCoveragePlan.tsx','components/farms/FarmOutreachQuestions.tsx','components/farms/FarmPlanModes.tsx','components/ui/button.tsx','components/ui/input.tsx','components/ui/label.tsx'].map(file=>fs.readFile(path.join(root,file),'utf8')))).join('\n');
  await fs.writeFile(path.join(temp,'style.css'),compiler.build((source+' mx-auto max-w-7xl p-4 sm:p-6').match(/[A-Za-z0-9_\-:/.[\]%#(),]+/g)||[]));
  server=http.createServer(async(req,res)=>{if(req.url.includes('/annual-coverage')){if(req.method==='PUT'){let body='';for await(const chunk of req)body+=chunk;saved=buildAnnualCoveragePlan(homes,JSON.parse(body));}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({plan:saved}));return;}const file=req.url==='/app.js'?'app.js':req.url==='/style.css'?'style.css':null;if(file){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(path.join(temp,file)));return;}res.setHeader('Content-Type','text/html');res.end('<html class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({headless:true,channel:'chrome'});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByText('Existing touchpoint plan',{exact:true}).waitFor();await page.getByRole('button',{name:'Annual farm coverage',exact:true}).click();
  await page.getByText('Unsaved preview',{exact:true}).waitFor();await page.getByRole('button',{name:'Weekly target',exact:true}).click();await page.getByLabel('Start date',{exact:true}).fill('2026-11-02');await page.getByLabel('Homes per week',{exact:true}).fill('20');
  await page.getByText('Holidays & weeks off',{exact:false}).first().click();for(const week of [8,9,10,20])await page.getByRole('checkbox',{name:`Take week ${week} off`,exact:true}).check();
  await page.getByRole('alert').filter({hasText:'43 homes won’t fit'}).waitFor();assert.equal(await page.getByRole('button',{name:'Save annual plan',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Use 21 homes / week',exact:true}).click();await page.getByRole('button',{name:'Save annual plan',exact:true}).click();await page.getByRole('status').filter({hasText:'Farm plan saved'}).waitFor();
  assert.equal(saved.weeksInPlan,52);assert.equal(saved.weeksOff.length,4);assert.equal(saved.weeks.flatMap(w=>w.addressIds).length,homes.length);assert.equal(new Set(saved.weeks.flatMap(w=>w.addressIds)).size,homes.length);
  await page.getByRole('button',{name:'Week 1: 21 homes',exact:true}).click();await page.getByRole('button',{name:'Add contact',exact:true}).first().click();assert.equal(await page.locator('#contact').textContent(),'0');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export weekly lists',exact:true}).click();const download=await downloadPromise;const csv=await fs.readFile(await download.path(),'utf8');assert(csv.includes('Farm home ID'));assert.equal(csv.trim().split('\r\n').length,1004);
  await page.getByRole('button',{name:'Close home list',exact:true}).click();await page.screenshot({path:path.join(temp,'desktop.png'),fullPage:true,animations:'disabled'});
  await page.reload();await page.getByRole('heading',{name:'Annual farm coverage',exact:true}).waitFor();await page.getByText('Saved for this farm',{exact:true}).waitFor();assert.equal(await page.getByLabel('Homes per week',{exact:true}).inputValue(),'21');await page.getByText('Holidays & weeks off',{exact:false}).first().click();assert.equal(await page.getByRole('checkbox',{name:'Take week 8 off',exact:true}).isChecked(),true);
  for(const width of [768,390,320]){await page.setViewportSize({width,height:844});await page.waitForFunction(()=>{const svg=document.querySelector('svg[aria-label^="Annual farm coverage:"]');return svg&&svg.getBoundingClientRect().width<innerWidth;});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);await page.screenshot({path:path.join(temp,`mobile-${width}.png`),fullPage:true,animations:'disabled'});}
  await page.getByRole('button',{name:'Daily pace',exact:true}).click();
  await page.getByLabel('Doors per day',{exact:true}).fill('50');
  await page.getByText('Advanced options',{exact:true}).click();await page.getByLabel('Calling rounds',{exact:true}).fill('2');
  await page.getByLabel('Calls per day',{exact:true}).fill('25');
  await page.getByText('Extra days off',{exact:false}).first().click();await page.getByLabel('Number of extra days off',{exact:true}).fill('1');
  assert.equal(await page.getByRole('button',{name:'Saturday',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('button',{name:'Sunday',exact:true}).getAttribute('aria-pressed'),'false');
  await page.getByRole('button',{name:'Save annual plan',exact:true}).click();
  await page.getByText('Saved for this farm',{exact:true}).waitFor();
  assert.deepEqual(saved.outreach.workingDays,[1,2,3,4,5,6]);assert.equal(saved.outreach.doorsPerDay,50);assert.equal(saved.outreach.callPasses,2);assert.equal(saved.outreach.extraDaysOffCount,1);
  await page.reload();await page.getByLabel('Doors per day',{exact:true}).waitFor();await page.getByText('Advanced options',{exact:true}).click();assert.equal(await page.getByLabel('Calling rounds',{exact:true}).inputValue(),'2');
  for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Daily questions overflow at ${width}`);await page.screenshot({path:path.join(temp,`daily-${width}.png`),fullPage:true,animations:'disabled'});}
  await page.getByRole('button',{name:'Touchpoint plan',exact:true}).click();await page.getByText('Existing touchpoint plan',{exact:true}).waitFor();assert.deepEqual(errors,[]);
  console.log(`Annual planner browser checks passed: mode switching, weekly target, holiday weeks, insufficient capacity, suggested pace, persistence/reload, weekly homes, contacts, CSV, mobile and console. Screenshots: ${temp}`);
 }finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
