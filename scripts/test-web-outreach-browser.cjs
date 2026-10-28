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
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wolfgrid-web-outreach-'));
  const contacts = [
    { id: 'a', full_name: 'Alex Homeowner', phone: '+1 (416) 555-1234', email: 'alex@example.com' },
    { id: 'b', full_name: 'Alex duplicate', phone: '4165551234', email: 'ALEX@example.com' },
    { id: 'c', full_name: 'Robin Homeowner', phone: '9055551234', email: 'robin@example.com' },
    { id: 'd', full_name: 'No details', phone: null, email: null },
  ];
  await fs.writeFile(path.join(temp, 'entry.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import {ContactOutreach} from ${JSON.stringify(path.join(root, 'components/outreach/ContactOutreach.tsx'))};createRoot(document.getElementById('root')).render(<main className="p-4"><ContactOutreach contacts={${JSON.stringify(contacts)}}/><section aria-label="Single contact"><ContactOutreach compact contacts={${JSON.stringify([contacts[0]])}}/></section></main>);`);
  await build({ entryPoints: [path.join(temp, 'entry.tsx')], outfile: path.join(temp, 'app.js'), bundle: true, jsx: 'automatic', nodePaths: [path.join(root, 'node_modules')], tsconfig: path.join(root, 'tsconfig.json'), plugins: [{ name: 'mock-auth', setup(b) {
    b.onResolve({ filter: /^@\/lib\/(workspace-context|supabase\/client)$/ }, a => ({ path: a.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents: a.path.includes('workspace') ? 'export const useWorkspace=()=>({currentWorkspaceId:"workspace"})' : 'export const getClientAsync=async()=>({auth:{getSession:async()=>({data:{session:null}})}})', loader: 'js' }));
  } }] });
  const compiler = await compile(await fs.readFile('app/globals.css', 'utf8'), { base: path.join(root, 'app'), onDependency() {} });
  const source = (await Promise.all(['components/outreach/ContactOutreach.tsx', 'components/outreach/GmailConnection.tsx', 'components/ui/dialog.tsx', 'components/ui/button.tsx'].map(f => fs.readFile(f, 'utf8')))).join('\n');
  await fs.writeFile(path.join(temp, 'style.css'), compiler.build(source.match(/[A-Za-z0-9_\-:/.[\]%#(),]+/g) || []));
  const sends = []; let configured = true; let sendStatus = 'accepted';
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/outreach/gmail') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ configured, email: configured ? 'me@example.com' : null })); return; }
    if (req.url === '/api/outreach/gmail/send') { let raw = ''; for await (const chunk of req) raw += chunk; sends.push(JSON.parse(raw)); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: sendStatus })); return; }
    const filename = req.url === '/app.js' ? 'app.js' : req.url === '/style.css' ? 'style.css' : null;
    if (filename) { res.setHeader('Content-Type', filename.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(await fs.readFile(path.join(temp, filename))); }
    else res.end('<html class="dark"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.getByRole('link', { name: 'Call on Mac / iPhone' }).getAttribute('href'), 'tel:+14165551234');
    assert.equal(await page.getByRole('link', { name: 'Messages', exact: true }).getAttribute('href'), 'sms:+14165551234');
    await page.getByRole('button', { name: 'Call list', exact: true }).click();
    await page.getByText('2 unique recipients', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Start 2 contacts' }).click();
    assert.equal(await page.getByRole('link', { name: 'Open Phone' }).getAttribute('href'), 'tel:+14165551234');
    await page.getByRole('button', { name: 'Next contact' }).click();
    assert.equal(await page.getByRole('link', { name: 'Open Phone' }).getAttribute('href'), 'tel:9055551234');
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.getByText('List complete.').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Message list', exact: true }).click();
    await page.getByLabel('Message body').fill('Hello from WolfGrid');
    await page.getByRole('button', { name: 'Start 2 contacts' }).click();
    assert.equal(await page.getByRole('link', { name: 'Open Messages' }).getAttribute('href'), 'sms:+14165551234');
    await page.screenshot({ path: path.join(temp, 'messages-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(temp, 'messages-mobile.png') });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Email list', exact: true }).click();
    await page.getByText('me@example.com', { exact: true }).waitFor();
    await page.getByLabel('Email subject').fill('Campaign update');
    await page.getByLabel('Message body').fill('A private message to each homeowner.');
    await page.getByRole('button', { name: 'Review 2 contacts' }).click();
    await page.getByRole('button', { name: 'Send 2 emails' }).click();
    await page.getByText('Robin Homeowner (robin@example.com): Accepted by Gmail').waitFor();
    assert.deepEqual(sends.map(s => s.contactId), ['a', 'c']);
    assert.equal(sends[0].requestId, sends[1].requestId);
    await page.keyboard.press('Escape');
    sendStatus = 'unknown';
    await page.getByRole('button', { name: 'Email list', exact: true }).click();
    await page.getByRole('button', { name: 'Review 2 contacts' }).click();
    await page.getByRole('button', { name: 'Send 2 emails' }).click();
    await page.getByText('Sending paused.', { exact: false }).waitFor();
    assert.equal(sends.length, 3, 'Unknown send must stop the queue');
    await page.keyboard.press('Escape');
    configured = false; await page.reload();
    await page.getByRole('button', { name: 'Email list', exact: true }).click();
    await page.getByText('Gmail connections are awaiting setup by WolfGrid.').waitFor();
    assert(await page.getByRole('button', { name: 'Connect Gmail' }).isDisabled());
    assert.deepEqual(errors, []);
    console.log(`PASS: selection, deduplication, call/message links, queue advancement, email sends, unknown-result stop, setup state, mobile layout. Screenshots: ${temp}`);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
