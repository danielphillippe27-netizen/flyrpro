/** App login is a fixture; MapsGL authentication, imagery and point-history data are live. No database writes. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { config } from 'dotenv';
import { issueStormMapsTileToken } from '../lib/storm-maps/token';
config({ path: '.env.local', quiet: true });
const base = process.env.STORMS_TEST_BASE || 'http://127.0.0.1:3028';
const workspace = 'c02ae085-144b-4234-b1f7-234fd7a937ed';

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [], weather: Array<{ path: string; status: number }> = [];
    let pointLookups = 0, reportRequests = 0;
    page.on('pageerror', () => errors.push('Browser runtime error'));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.pathname.includes('/api/storm-maps/gl/')) weather.push({ path: url.pathname.replace(/\/gl\/[^/]+/, '/gl/[capability]'), status: response.status() });
    });
    await page.route('https://api.mapbox.com/**', route => route.fulfill({ json: { version: 8, glyphs: `${base}/fixtures/fonts/{fontstack}/{range}.pbf`, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e4eced' } }] } }));
    await page.route('**/fixtures/fonts/**', route => route.fulfill({ status: 200, body: Buffer.alloc(0) }));
    await page.route('https://events.mapbox.com/**', route => route.fulfill({ status: 204, body: '' }));
    const token = issueStormMapsTileToken(workspace, ['xweather:gl']);
    await page.route('**/api/**', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.pathname.includes('/api/storm-maps/gl/')) return route.continue();
      assert.equal(req.headers().authorization, 'Bearer app-fixture');
      if (url.pathname.endsWith('/settings')) return route.fulfill({ json: { addon: { isActive: true } } });
      if (url.pathname.endsWith('/manifest')) return route.fulfill({ json: { enabled: true, glToken: token.token, expiresAt: token.expiresAt, providerHealth: { xweather: { available: true, status: 'ready' } } } });
      if (url.pathname.endsWith('/territories')) return route.fulfill({ json: { territories: [] } });
      if (url.pathname.endsWith('/australia')) return route.fulfill({ json: { events: [], total: 0, nextOffset: null, archiveStartsAt: null, health: { message: 'Fixture archive' } } });
      if (url.pathname.endsWith('/events')) { reportRequests++; return route.fulfill({ json: { events: [], nextCursor: null } }); }
      if (url.pathname.endsWith('/hail')) {
        pointLookups++;
        assert.equal(url.searchParams.get('workspaceId'), workspace);
        assert.equal(url.searchParams.get('lat'), '-33.8688');
        assert.equal(url.searchParams.get('lon'), '151.2093');
        const provider = new URL(`https://data.api.xweather.com/hail/archive/${url.searchParams.get('lat')},${url.searchParams.get('lon')}`);
        const date = url.searchParams.get('date')!;
        const start = new Date(`${date}T00:00:00Z`);
        provider.search = new URLSearchParams({ client_id: process.env.XWEATHER_CLIENT_ID!, client_secret: process.env.XWEATHER_CLIENT_SECRET!, from: start.toISOString(), to: new Date(+start + 86400000).toISOString() }).toString();
        const response = await fetch(provider, { signal: AbortSignal.timeout(20000) });
        const data = await response.json();
        assert.equal(response.status, 200); assert.equal(data.success, true);
        const periods = data.response.flatMap((row: { periods: unknown[] }) => row.periods);
        assert(periods.length > 0);
        return route.fulfill({ json: { periods, coverage: 'available', message: 'Location estimate for the selected UTC day; not an inspection or regional damage footprint.' } });
      }
      return route.fulfill({ status: 599, json: { error: 'Unexpected app request blocked' } });
    });
    await page.goto(`${base}/mobile/storms?region=au`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.WolfGridStorms, null, { timeout: 60000 });
    await page.evaluate(({ workspace }) => window.WolfGridStorms!.start({ accessToken: 'app-fixture', workspaceId: workspace, center: [153.0251, -27.4698] }), { workspace });
    await page.getByRole('region', { name: 'Australian storm maps' }).waitFor({ timeout: 60000 });
    assert.equal(reportRequests, 0, 'Australia must not query the U.S. storm-report feed');
    await page.getByLabel('Australian storm region').selectOption('sydney');
    await page.getByLabel('Australian hail date').fill(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Look up hail at this point' }).click();
    await page.getByText(/Maximum estimated hail:/).waitFor({ timeout: 30000 });
    assert.equal(pointLookups, 1, 'A single selected point produces one bounded request');
    await page.getByRole('button', { name: 'Show this day’s hail map' }).click();
    await page.waitForFunction(() => !document.body.textContent?.includes('Loading weather…'), null, { timeout: 60000 });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && !weather.some(item => item.path.endsWith('.png') && item.status === 200)) await page.waitForTimeout(1000);
    assert(weather.some(item => item.path.endsWith('/auth/token') && item.status === 200), 'Real MapsGL authentication');
    assert(weather.some(item => item.path.endsWith('.png') && item.status === 200), 'Real Australian map imagery');
    assert.equal(weather.filter(item => item.status >= 400).length, 0, JSON.stringify(weather));
    await page.getByLabel('Australian hail date').fill('2025-10-23');
    assert.equal(await page.getByRole('button', { name: 'Show this day’s hail map' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Look up hail at this point' }).isEnabled(), true);
    await page.getByRole('button', { name: 'Live hail tracks' }).click();
    await page.waitForTimeout(2000);
    assert.equal(errors.length, 0);
    await page.screenshot({ path: '/tmp/wolfgrid-australia-storms.png' });
    await page.getByRole('button', { name: 'Storm reports', exact: true }).click();
    await page.getByLabel('Storm search area').waitFor();
    assert(reportRequests > 0, 'Original report browser remains accessible');
    console.log(JSON.stringify({ passed: true, liveProviderAuth: true, australianMapImages: weather.filter(item => item.path.endsWith('.png') && item.status === 200).length, pointLookups, reportBrowserRestored: true, runtimeErrors: errors.length }));
  } finally { await browser.close(); }
}
main().catch(() => { console.error('Australian storm integration failed; inspect the local browser/server diagnostics.'); process.exitCode = 1; });
