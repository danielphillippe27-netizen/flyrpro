// Isolated component fixture. Uses mocked persistence; no live account/network data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { compile } = require('@tailwindcss/node');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wolfgrid-cycles-browser-'));
  let browser, server;
  try {
    const entry = path.join(temp, 'entry.tsx');
    await fs.writeFile(entry, `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {FarmCycleSettings} from ${JSON.stringify(path.join(root,'components/farms/FarmCycleSettings.tsx'))};
      window.fixture={active:2,calls:[],cycles:[{farm_id:'farm',cycle_number:2,started_on:'2026-11-01',ends_on:'2026-11-20',updated_at:'v1'},{farm_id:'farm',cycle_number:1,started_on:'2026-10-01',ends_on:'2026-10-31',updated_at:'v0'}]};
      function App(){const [farm,setFarm]=useState({id:'farm',active_cycle_number:2});return <main className="mx-auto max-w-3xl p-4"><FarmCycleSettings farm={farm} touches={[]} outcomes={[]} onChanged={async()=>setFarm({id:'farm',active_cycle_number:window.fixture.active})}/></main>}createRoot(document.getElementById('root')).render(<App/>);`);
    await build({entryPoints:[entry],outfile:path.join(temp,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',nodePaths:[path.join(root,'node_modules')],tsconfig:path.join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'},plugins:[{
      name:'fixture-client',setup(b){b.onResolve({filter:/^@\/lib\/supabase\/client$/},()=>({path:'fixture-client',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export function createClient(){return {from(){return {select(){return {eq(){return {async order(){return {data:window.fixture.cycles,error:null}}}}}}}},async rpc(name,p){const f=window.fixture;f.calls.push({name,p});if(name==='set_farm_cycle_end_date'){const c=f.cycles.find(c=>c.cycle_number===p.p_cycle_number);const next={...c,ends_on:p.p_ends_on,updated_at:String(Date.now())};f.cycles=f.cycles.map(c=>c.cycle_number===next.cycle_number?next:c);return {data:next,error:null}}f.active++;f.cycles.push({farm_id:'farm',cycle_number:f.active,started_on:p.p_started_on,ends_on:p.p_ends_on,updated_at:'next'});return {data:f.active,error:null}}}}`,loader:'js'}))}
    }]});
    const compiler=await compile(await fs.readFile(path.join(root,'app/globals.css'),'utf8'),{base:path.join(root,'app'),onDependency(){}});
    const source=(await Promise.all(['components/farms/FarmCycleSettings.tsx','components/ui/button.tsx','components/ui/input.tsx','components/ui/label.tsx','components/ui/dialog.tsx'].map(file=>fs.readFile(path.join(root,file),'utf8')))).join('\n');
    await fs.writeFile(path.join(temp,'style.css'),compiler.build((source+' mx-auto max-w-3xl p-4').match(/[A-Za-z0-9_\-:/.[\]%#(),]+/g)||[]));
    server=http.createServer(async(req,res)=>{const file=req.url==='/app.js'?'app.js':req.url==='/style.css'?'style.css':req.url==='/app.css'?'app.css':null;if(file){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(path.join(temp,file)));return;}res.setHeader('Content-Type','text/html');res.end('<html class="dark"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,channel:'chrome'});
    const page=await browser.newPage({viewport:{width:1100,height:900}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('Current cycle: Cycle 2',{exact:true}).waitFor();
    await page.getByLabel('Cycle 2 end date').fill('2026-11-25');
    assert(await page.getByRole('button',{name:'Start Cycle 3',exact:true}).isDisabled());
    await page.getByRole('button',{name:'Save end date',exact:true}).click();
    await page.getByText('End date saved.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.fixture.cycles.find(c=>c.cycle_number===2).ends_on),'2026-11-25');
    assert.equal(await page.evaluate(()=>window.fixture.active),2,'Saving a date does not advance the cycle');
    await page.getByLabel('Cycle 2 end date').fill('2026-10-31');
    await page.getByRole('button',{name:'Save end date',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'before'}).waitFor();
    assert.equal(await page.evaluate(()=>window.fixture.calls.length),1,'Invalid dates never write');
    await page.getByLabel('Cycle 2 end date').fill('2026-11-25');
    await page.getByText('Cycle history',{exact:true}).click();
    await page.getByLabel('Cycle 1 end date').fill('2026-10-30');
    await page.getByRole('button',{name:'Save end date',exact:true}).nth(1).click();
    await page.waitForFunction(()=>window.fixture.cycles.find(c=>c.cycle_number===1).ends_on==='2026-10-30');
    await page.screenshot({path:path.join(temp,'desktop.png'),fullPage:true});
    for(const width of [390,320]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);await page.screenshot({path:path.join(temp,`mobile-${width}.png`),fullPage:true});}
    await page.getByRole('button',{name:'Start Cycle 3',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    await page.getByLabel('New cycle start date').fill('2026-11-05');
    await page.getByLabel('New cycle end date (optional)').fill('2026-12-05');
    await page.screenshot({path:path.join(temp,'confirmation-mobile.png'),fullPage:true});
    await page.getByRole('dialog').getByRole('button',{name:'Start Cycle 3',exact:true}).click();
    await page.getByText('Current cycle: Cycle 3',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Cycle 3 end date').inputValue(),'2026-12-05');
    assert.equal(await page.evaluate(()=>window.fixture.calls.filter(c=>c.name==='advance_farm_cycle').length),1);
    await page.reload();
    await page.getByText('Current cycle: Cycle 2',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    console.log(`Cycle browser checks passed: current/history date edits, validation, dirty-state guard, advance confirmation, refreshed active cycle, 320/390/1100 layouts. Screenshots: ${temp}`);
  } finally {await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
