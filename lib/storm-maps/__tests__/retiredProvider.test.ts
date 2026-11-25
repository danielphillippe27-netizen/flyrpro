import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET as getWeatherMap, POST as postWeatherMap } from '@/app/api/storm-maps/gl/[token]/[...path]/route';
import { GET as getHailPoint } from '@/app/api/storm-maps/intelligence/hail/route';
import { GET as getWindCollection } from '@/app/api/cron/storm-wind/route';
import { GET as getHailCollection } from '@/app/api/cron/storm-hail-watch/route';
import { GET as getTile } from '@/app/api/storm-maps/tiles/[provider]/[layer]/[time]/[z]/[x]/[y]/route';
import { issueStormMapsTileToken } from '../token';

async function verifyRetiredProvider() {
  process.env.XWEATHER_ENABLED = 'true';
  process.env.XWEATHER_API_KEY = 'old-test-key';
  process.env.XWEATHER_CLIENT_ID = 'old-test-id';
  process.env.XWEATHER_CLIENT_SECRET = 'old-test-secret';
  process.env.STORM_MAPS_SIGNING_SECRET = 'storm-maps-test-secret-with-sufficient-entropy';

  const token = issueStormMapsTileToken('workspace-a', ['xweather:radar:now', 'iem:radar:now', 'eccc:radar:now']).token;
  const fetchedHosts: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    fetchedHosts.push(new URL(String(input)).hostname);
    return new Response('test tile', { headers: { 'Content-Type': 'image/png' } });
  };

  try {
    for (const handler of [getWeatherMap, postWeatherMap, getHailPoint, getWindCollection, getHailCollection]) {
      assert.equal(handler().status, 410);
    }
    const tile = (provider: string, y: string) => getTile(
      new NextRequest(`https://wolfgrid.app/api/storm-maps/tiles/${provider}/radar/now/8/73/${y}?token=${token}`),
      { params: Promise.resolve({ provider, layer: 'radar', time: 'now', z: '8', x: '73', y }) },
    );
    assert.equal((await tile('xweather', '92.png')).status, 404);
    assert.deepEqual(fetchedHosts, [], 'Legacy credentials and a signed token cannot reach an upstream provider.');

    const canada = await tile('eccc', '92.png');
    const us = await tile('iem', '163.png');
    assert.equal(canada.status, 200);
    assert.equal(canada.headers.get('X-Storm-Maps-Source'), 'eccc');
    assert.equal(us.status, 200);
    assert.equal(us.headers.get('X-Storm-Maps-Source'), 'iem');
    assert.deepEqual(fetchedHosts, ['geo.weather.gc.ca', 'mesonet.agron.iastate.edu']);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

verifyRetiredProvider().then(() => {
  console.log('Retired weather routes deny legacy credentials and tokens. Public radar routes still work.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
