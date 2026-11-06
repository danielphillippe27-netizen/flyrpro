const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { build } = require('esbuild');
const { chromium } = require('playwright');
(async () => {
  const root = process.cwd(), temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wolfgrid-relationships-'));
  const client = { id: '33333333-3333-4333-8333-333333333333', workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', first_name: 'Alex', last_name: 'Morgan', address: '1 Main Street', updated_at: '2026-01-01T00:00:00Z' };
  let fields = [], version = 0, events = [], calls = [];
  await fs.writeFile(path.join(temp, 'entry.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import {RelationshipPanel, OutreachTools} from ${JSON.stringify(path.join(root, 'components/coco/RelationshipTools.tsx'))};import ${JSON.stringify(path.join(root, 'components/coco/coco.css'))};const c=${JSON.stringify(client)};createRoot(document.getElementById('root')).render(<div className="coco-crm"><RelationshipPanel client={c} userId="11111111-1111-4111-8111-111111111111" tasks={[]} messages={[]} onSaved={async()=>{}}/><div id="bulk"><OutreachTools clients={[c,{...c,id:'44444444-4444-4444-8444-444444444444',first_name:'Robin'}]} userId="11111111-1111-4111-8111-111111111111" workspaceId={c.workspace_id} onSaved={async()=>{}}/></div></div>);`);
  await build({ entryPoints: [path.join(temp, 'entry.tsx')], outfile: path.join(temp, 'app.js'), bundle: true, jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')], tsconfig: path.join(root, 'tsconfig.json') });
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const p = raw ? JSON.parse(raw) : null;
      let result = { fields, version, events };
      if (p) { calls.push(p); if (p.action === 'fields') { fields = p.fields; version++; result = { version }; } else { events.push({ id: String(events.length), kind: p.kind, title: p.title, body: p.body, occurred_at: p.at }); result = { count: p.ids.length }; } }
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result)); return;
    }
    if (req.url === '/app.js' || req.url === '/app.css') { res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await fs.readFile(path.join(temp, req.url.slice(1)))); return; }
    res.end('<html><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--background:#fff;--foreground:#222;--secondary:#fafafa;--border:#ddd;--primary:#b62532;--muted-foreground:#777}*{box-sizing:border-box}body{font-family:Arial;margin:24px}</style><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } }); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByLabel('Birthday', { exact: true }).fill('2000-02-29');
    await page.getByLabel('Home anniversary', { exact: true }).fill('2020-06-15');
    await page.getByLabel('New field name').fill('Favorite coffee');
    await page.getByRole('button', { name: 'Add field', exact: true }).click();
    await page.getByLabel('Favorite coffee', { exact: true }).fill('Latte');
    await page.getByRole('button', { name: 'Save fields', exact: true }).click();
    await page.getByText('Fields saved.', { exact: true }).waitFor();
    assert.equal(fields.length, 3);
    await page.reload();
    await page.getByLabel('Favorite coffee', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Birthday', { exact: true }).inputValue(), '2000-02-29');
    const bulk = page.locator('#bulk');
    await bulk.getByRole('button', { name: 'Follow-ups, letters & touch points (2)' }).click();
    await bulk.getByLabel('Follow-up due').fill('2026-12-20T09:00');
    await bulk.getByRole('button', { name: 'Create 2 follow-up task(s)' }).click();
    await bulk.getByText('Saved for 2 contacts.', { exact: true }).waitFor();
    assert.equal(calls.at(-1).ids.length, 2);
    await bulk.getByLabel('Activity', { exact: true }).selectOption('letter-prepared');
    await bulk.getByLabel('Activity date').fill('2020-01-01T09:00');
    await bulk.getByLabel('Letter text').fill('Hello {first_name},\nMerry Christmas! <script>alert(1)</script>');
    const popupPromise = page.waitForEvent('popup');
    await bulk.getByRole('button', { name: 'Preview / print personalized letters' }).click();
    const popup = await popupPromise; await popup.waitForLoadState();
    assert.equal(await popup.locator('article').count(), 2);
    assert.match(await popup.locator('article').first().innerText(), /Hello Alex/);
    assert.match(await popup.locator('article').last().innerText(), /Hello Robin/);
    assert.equal(await popup.locator('script').count(), 0);
    assert.equal(calls.filter(call => call.kind === 'letter-mailed').length, 0);
    await popup.close();
    await bulk.getByRole('button', { name: 'Record letter prepared for 2 contact(s)' }).click();
    await bulk.getByText('Saved for 2 contacts.', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(temp, 'desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(temp, 'mobile.png'), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile layout does not overflow');
    assert.deepEqual(errors, []);
    console.log(`PASS: field save/reload, custom fields, bulk scheduling, personalized print pages, HTML escaping, preparation distinct from mailing, mobile layout. Screenshots: ${temp}`);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
