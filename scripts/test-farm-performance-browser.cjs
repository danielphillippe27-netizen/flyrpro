const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { compile } = require('@tailwindcss/node');
const { chromium } = require('playwright');

// Local fixture-only component checks. No preview route or sample data ships in the app.
(async () => {
  const root = process.cwd();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wolfgrid-dashboard-review-'));
  let browser, server;
  try {
    const entry = path.join(temp, 'entry.tsx');
    await fs.writeFile(entry, `import React, {useState} from 'react'; import {createRoot} from 'react-dom/client'; import {FarmPerformanceDashboard} from ${JSON.stringify(path.join(root, 'components/farms/FarmPerformanceDashboard.tsx'))};
      const now = new Date(); const date = days => {const d = new Date(now); d.setDate(d.getDate()-days); return d.toISOString()};
      const addresses = Array.from({length: 163},(_,i)=>({id:String(i)}));
      const touches = [{id:'s1',resolvedCycleNumber:1,mode:'doorknock'}, {id:'s2',resolvedCycleNumber:2,mode:'doorknock'}];
      const outcomes = Array.from({length:70},(_,i)=>({id:String(i),farm_touch_id:i<35?'s1':'s2',farm_address_id:String(i%50),status:i%3===0?'talked':'no_answer',occurred_at:date(i<35?15:i%7),created_at:date(i<35?15:i%7)}));
      function Review(){const [scope,setScope]=useState('current_cycle');const [empty,setEmpty]=useState(false);return <main className="mx-auto max-w-7xl p-4 sm:p-8"><FarmPerformanceDashboard name="North Oshawa Farm" addresses={addresses} touches={touches} outcomes={empty?[]:outcomes} leads={[]} currentCycle={2} scope={scope} onScopeChange={setScope}/><button id="empty" onClick={()=>setEmpty(!empty)}>Toggle empty fixture</button></main>} createRoot(document.getElementById('root')).render(<Review/>);`);
    await build({entryPoints:[entry],outfile:path.join(temp,'app.js'),bundle:true,platform:'browser',format:'iife',jsx:'automatic',nodePaths:[path.join(root,'node_modules')],tsconfig:path.join(root,'tsconfig.json'),define:{'process.env.NODE_ENV':'"development"'}});
    const compiler = await compile(await fs.readFile(path.join(root,'app/globals.css'),'utf8'),{base:path.join(root,'app'),onDependency(){}});
    const source = await fs.readFile(path.join(root,'components/farms/FarmPerformanceDashboard.tsx'),'utf8');
    await fs.writeFile(path.join(temp,'style.css'),compiler.build((source+' mx-auto max-w-7xl p-4 sm:p-8').match(/[A-Za-z0-9_\-:/.[\]%#(),]+/g)||[]));
    server=http.createServer(async(req,res)=>{const file=req.url==='/app.js'?'app.js':req.url==='/style.css'?'style.css':null;if(file){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(await fs.readFile(path.join(temp,file)));return;}res.setHeader('Content-Type','text/html');res.end('<html class="dark"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true,channel:'chrome'});
    const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('heading',{name:'Homes Visited',exact:true}).waitFor();
    const core=page.getByRole('heading',{name:'Homes Visited',exact:true}).locator('..').locator('..');
    assert((await core.textContent()).includes('35'));
    await page.getByRole('button',{name:'All Time',exact:true}).first().click();
    assert((await core.textContent()).includes('50'));
    assert.equal(await page.getByRole('heading',{name:'Door-Knocking Performance',exact:true}).count(),0);
    assert.equal(await page.getByRole('heading',{name:'Farm Coverage Over Time',exact:true}).count(),0);
    await page.screenshot({path:path.join(temp,'desktop.png'),fullPage:true});
    for(const width of [768,390,320]){await page.setViewportSize({width,height:844});await page.screenshot({path:path.join(temp,`mobile-${width}.png`),fullPage:true,animations:'disabled'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);}
    await page.locator('#empty').click();
    await page.waitForFunction(()=>document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')==='0');
    assert((await core.textContent()).includes('0'));
    await page.screenshot({path:path.join(temp,'empty-mobile.png'),fullPage:true});
    await page.evaluate(()=>document.documentElement.classList.remove('dark'));
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#empty').click();
    await page.screenshot({path:path.join(temp,'light-desktop.png'),fullPage:true});
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('[role=progressbar] > div').evaluate(el=>getComputedStyle(el).transitionProperty),'none');
    assert.deepEqual(errors,[]);
    console.log(`Dashboard browser checks passed: scope, real overview/KPI totals, removed legacy graphs, empty states, light/dark, reduced motion and 320/390/768/1440 layouts. Screenshots: ${temp}`);
  } finally {await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
