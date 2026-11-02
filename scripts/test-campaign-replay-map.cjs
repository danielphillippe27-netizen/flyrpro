/* Real Mapbox/WebGL capture with synthetic geometry; no campaign or GPS data is used. */
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ path: path.join(process.cwd(), '.env.local'), quiet: true });

function pixel(file, last, x = 540) {
  const args = ['-v', 'error'];
  if (last) args.push('-sseof', '-0.15');
  args.push('-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:960,scale=1:1`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-');
  const result = spawnSync('ffmpeg', args);
  if (result.status !== 0 || result.stdout.length < 3) throw new Error('Could not decode a replay frame.');
  return result.stdout.subarray(0, 3);
}

(async () => {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) throw new Error('NEXT_PUBLIC_MAPBOX_TOKEN is required for this integration test.');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wolfgrid-replay-test-'));
  let browser;
  try {
    const bundle = path.join(temp, 'fixture.js');
    await esbuild.build({ entryPoints: ['scripts/fixtures/campaign-replay-map.ts'], bundle: true, format: 'iife', platform: 'browser', outfile: bundle });
    const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await chromium.launch({ headless: true, ...(fs.existsSync(chrome) ? { executablePath: chrome } : {}), args: ['--use-gl=angle', '--use-angle=swiftshader'] });
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 500, height: 700 } });
    await page.setContent('<div id="map" style="position:absolute;inset:0"></div>');
    await page.addStyleTag({ path: require.resolve('mapbox-gl/dist/mapbox-gl.css') });
    await page.addScriptTag({ path: bundle });
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await page.evaluate((value) => window.runReplayFixture(value), token);
    const download = await downloadPromise;
    const video = path.join(temp, download.suggestedFilename());
    await download.saveAs(video);
    const before = pixel(video, false);
    const after = pixel(video, true);
    if (!(before[0] > before[1] && after[1] > after[0])) throw new Error('Recorded frames did not show the expected red-to-green change.');
    const edgeBefore = pixel(video, false, 300);
    const edgeAfter = pixel(video, true, 300);
    if (!(edgeBefore[0] > 200 && edgeBefore[1] > 200 && edgeAfter[1] > edgeAfter[0] * 1.3)) {
      throw new Error('Recorded frames did not show the expected camera zoom.');
    }
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', video], { encoding: 'utf8' });
    if (probe.status !== 0 || !probe.stdout.includes('1080,1920')) throw new Error('Replay is not 1080×1920.');
    console.log('Mapbox video export passed: 1080×1920, visible red-to-green map change and camera zoom.');
  } finally {
    if (browser) await browser.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
