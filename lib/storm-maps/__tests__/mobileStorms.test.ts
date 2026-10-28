import assert from 'node:assert/strict';
import { isMobileStormAPI, mobileStormFetch, mobileStormMapRequest } from '../mobile-session';
import { areaCampaignMapBundle } from '../intelligence/area-campaign';
import { campaignStormSchema } from '../intelligence/model';
import { stormTerritoryPolygonSchema } from '../intelligence/territory-review';

async function main() {
  const origin = 'https://wolfgrid.app';
  const workspace = 'c02ae085-144b-4234-b1f7-234fd7a937ed';
  let token = 'first-session';
  const image = mobileStormMapRequest(`${origin}/api/storm-maps/intelligence/wind/map?workspaceId=wrong&country=CA&z=4&x=3&y=5`, origin, () => token, workspace);
  assert.equal(image.headers?.Authorization, 'Bearer first-session', 'Wind image requests authenticate even when fetched in a map worker');
  assert.equal(new URL(image.url).searchParams.get('workspaceId'), workspace);
  assert(!image.url.includes(token), 'App credentials never appear in image URLs');
  for(const url of ['https://api.mapbox.com/styles/v1/test', 'https://other.example/api/storm-maps/intelligence/wind/map', `${origin}/api/storm-maps/gl/provider/tile`, `${origin}/api/billing`]) {
    assert.deepEqual(mobileStormMapRequest(url,origin,()=>token,workspace),{url},'Only saved wind images receive app credentials');
  }
  const calls: Request[] = [];
  const fetcher = mobileStormFetch((async (input, init) => {
    calls.push(new Request(input, init)); return new Response('{}');
  }) as typeof fetch, origin, () => token, workspace);
  assert.equal(isMobileStormAPI(new URL('/api/storm-maps/intelligence/events', origin), origin), true);
  for (const url of ['https://other.example/api/campaigns', 'https://wolfgrid.app.evil.test/api/campaigns', `${origin}/api/billing`, `${origin}/api/campaigns/123`]) {
    assert.equal(isMobileStormAPI(new URL(url), origin), false);
    await fetcher(url);
    assert.equal(calls.at(-1)!.headers.has('Authorization'), false, 'No credentials on unrelated APIs or origins');
  }
  const weatherURL = `${origin}/api/storm-maps/gl/weather-capability/tile`;
  assert.equal(isMobileStormAPI(new URL(weatherURL), origin), false);
  await fetcher(weatherURL, { headers: { Authorization: 'Bearer provider-session' } });
  assert.equal(calls.at(-1)!.headers.get('Authorization'), 'Bearer provider-session', 'Preserve MapsGL credentials; never forward app tokens to the weather provider');
  assert.equal(new URL(calls.at(-1)!.url).searchParams.has('workspaceId'), false);
  await fetcher(`${origin}/api/storm-maps/gl/weather-capability/auth/token`, { method: 'POST', headers: { Authorization: 'Basic weather-sdk' }, body: 'grant_type=client_credentials' });
  assert.equal(calls.at(-1)!.headers.get('Authorization'), 'Basic weather-sdk');
  const abort = new AbortController();
  await fetcher('/api/storm-maps/intelligence/events?workspaceId=wrong&hazard=hail', { signal: abort.signal });
  const read = calls.at(-1)!;
  assert.equal(new URL(read.url).searchParams.get('workspaceId'), workspace);
  assert.equal(read.headers.get('Authorization'), 'Bearer first-session');
  assert.equal(read.credentials, 'omit'); assert.equal(read.redirect, 'error'); assert.equal(read.cache, 'no-store');
  abort.abort(); assert.equal(read.signal.aborted, true, 'Unmount cancels the actual network request');
  token = 'refreshed-session';
  assert.equal(mobileStormMapRequest(image.url,origin,()=>token,workspace).headers?.Authorization,'Bearer refreshed-session','Map workers receive refreshed credentials');
  assert.deepEqual(mobileStormMapRequest(image.url,origin,()=>'',workspace).headers,{},'Clearing the app session clears resource credentials');
  const body = JSON.stringify({ name: 'Storm area', area_only: true, workspace_id: workspace });
  await fetcher('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal(calls.at(-1)!.headers.get('Authorization'), 'Bearer refreshed-session');
  assert.equal(calls.at(-1)!.method, 'POST'); assert.equal(await calls.at(-1)!.text(), body);
  const boundary = { type: 'Polygon', coordinates: [[[-80,43],[-79.5,43],[-79.5,43.5],[-80,43.5],[-80,43]]] };
  assert.ok(stormTerritoryPolygonSchema.safeParse(boundary).success, 'A large area can be saved without a 1,000 home scan');
  assert.equal(stormTerritoryPolygonSchema.safeParse({ ...boundary, coordinates: [[[-180,-80],[180,-80],[180,80],[-180,80],[-180,-80]]] }).success, false);
  const bundle = areaCampaignMapBundle(workspace, boundary, '2026-10-22T10:00:00Z');
  assert.equal(bundle.map_ready, true); assert.equal(bundle.status, 'ready');
  assert.equal(bundle.addresses.features.length, 0); assert.deepEqual(bundle.territory_boundary, boundary);
  assert.notEqual(bundle.links_status, 'pending_provision', 'An area campaign must never wait for a home scan');
  const context = { version: 2, event: { key: 'hail:2026-10-22', title: 'Hail area', hazard: 'hail', source: 'iem', sourceId: 'reports', start: '2026-10-22T00:00:00Z', end: '2026-10-22T01:00:00Z' }, territoryId: workspace, campaignMode: 'area', selectedAt: '2026-10-22T02:00:00Z', minimumHailMM: null, selection: 'user-drawn', evidenceKind: 'user-drawn' };
  assert.ok(campaignStormSchema.safeParse(context).success);
  assert.equal(campaignStormSchema.safeParse({ ...context, minimumHailMM: 30 }).success, false, 'Drawing an area cannot claim measured hail');
  console.log('PASS: native credentials scoped to storm APIs, workspace pinned, requests/cancellation preserved, refreshed session used, large-area ready bundle and evidence validation.');
}
void main();
