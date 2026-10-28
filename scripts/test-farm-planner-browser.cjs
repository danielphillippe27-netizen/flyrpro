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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wolfgrid-farm-review-'));
  let browser, server;
  try {
    const homes = Array.from({ length: 253 }, (_, i) => ({ id: String(i), farm_id: 'test-farm', formatted: `${i + 1} Farm Street`, street_name: 'Farm Street', house_number: String(i + 1), source: 'map' }));
    await build({ entryPoints: [path.join(root, 'lib/farms/door-plan.ts')], outfile: path.join(temp, 'plan.cjs'), bundle: true, platform: 'node', format: 'cjs' });
    const { buildFarmDoorPlan } = require(path.join(temp, 'plan.cjs'));
    let saved = buildFarmDoorPlan(homes, '2026-10-30', 100);
    const entry = path.join(temp, 'entry.tsx');
    await fs.writeFile(entry, `import React from 'react'; import { createRoot } from 'react-dom/client'; import { FarmDoorPlanner } from ${JSON.stringify(path.join(root, 'components/farms/FarmDoorPlanner.tsx'))}; const homes=${JSON.stringify(homes)}; createRoot(document.getElementById('root')).render(<main className="p-4"><FarmDoorPlanner farmId="test-farm" addresses={homes} onHomesImported={async()=>{}} onAddContact={home=>{document.getElementById('contact').textContent=home.formatted}}/><div id="contact"/></main>);`);
    await build({ entryPoints: [entry], outfile: path.join(temp, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')], tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' } });
    const compiler = await compile(await fs.readFile(path.join(root, 'app/globals.css'), 'utf8'), { base: path.join(root, 'app'), onDependency() {} });
    const source = (await Promise.all(['components/farms/FarmDoorPlanner.tsx', 'components/ui/button.tsx', 'components/ui/input.tsx', 'components/ui/label.tsx'].map(file => fs.readFile(path.join(root, file), 'utf8')))).join('\n');
    const candidates = source.match(/[A-Za-z0-9_\-:/.[\]%#(),]+/g) || [];
    await fs.writeFile(path.join(temp, 'style.css'), compiler.build(candidates));
    server = http.createServer(async (req, res) => {
      if (req.url.includes('/door-plan')) {
        if (req.method === 'PUT') {
          let body = ''; for await (const chunk of req) body += chunk;
          const data = JSON.parse(body); saved = buildFarmDoorPlan(homes, data.startDate, data.doorsPerDay);
        }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ plan: saved })); return;
      }
      const filename = req.url === '/app.js' ? 'app.js' : req.url === '/style.css' ? 'style.css' : null;
      if (filename) { res.setHeader('Content-Type', filename.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(temp, filename))); return; }
      res.setHeader('Content-Type', 'text/html'); res.end('<html class="dark"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('Friday, Oct 30', { exact: true }).waitFor();
    await page.getByLabel('Doors per day').fill('50');
    await page.getByRole('button', { name: 'Preview plan', exact: true }).click();
    await page.getByText('Preview — save to keep these assignments.').waitFor();
    await page.getByRole('button', { name: 'Replace saved plan' }).click();
    await page.getByText('Weekday plan saved for this farm.').waitFor();
    assert.equal(saved.days.length, 6);
    await page.reload();
    await page.getByText('Friday, Oct 30', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Doors per day').inputValue(), '50');
    await page.getByRole('button').filter({ has: page.getByText('Friday, Oct 30', { exact: true }) }).click();
    await page.getByRole('button', { name: 'Add contact', exact: true }).first().click();
    await page.locator('#contact').filter({ hasText: '1 Farm Street' }).waitFor();
    await page.screenshot({ path: path.join(temp, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(temp, 'mobile.png'), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile layout overflows');
    assert.deepEqual(errors, []);
    console.log(`Farm planner browser checks passed: preview, save, reload, daily contacts, mobile layout. Screenshots: ${temp}`);
  } finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
