import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { StormDiscoveryPanel } from '../../../components/storm-maps/intelligence/StormDiscoveryPanel';
import { savedStormArchiveFilter, savedStormArchiveOffset } from '../intelligence/saved-history';

async function main() {
  assert.equal(savedStormArchiveOffset(null), 0);
  for (const invalid of ['-1', 'abc', '1.5', '9007199254740991']) assert.equal(savedStormArchiveOffset(invalid), null);
  assert.equal(savedStormArchiveOffset('200'), 200);
  assert.equal(savedStormArchiveFilter('US', 'hail')?.source, 'iem');
  assert.equal(savedStormArchiveFilter('AU', 'hail')?.keyPattern, 'xweather:au:hail:%');
  assert.equal(savedStormArchiveFilter('CA', 'hail')?.keyPattern, 'xweather:ca:hail:%');
  assert.equal(savedStormArchiveFilter('NZ', 'hail'), null);

  const dom = new JSDOM('<div id="root"></div>', { url: 'https://wolfgrid.app/campaigns/create' });
  Object.assign(globalThis, { React, self: dom.window, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  window.matchMedia = (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  const map = { getBounds: () => null, getStyle: () => null, getLayer: () => null, getSource: () => null, isStyleLoaded: () => true, on() {}, off() {}, once() {} };
  const event = (date: string) => ({ key: `iem:hail:${date}:TX`, title: `TX hail reports · ${date}`, start: `${date}T00:00:00Z`, end: `${date}T23:59:59Z`, hazard: 'hail', source: 'iem', sourceId: date, reportCount: 1, maxHailMM: 25.4, features: [], footprintStatus: 'unavailable', active: false, maxWindKPH: null, category: null });
  const queries: URL[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async input => {
    const query = new URL(String(input), window.location.origin); queries.push(query);
    assert.equal(query.pathname, '/api/storm-maps/intelligence/history');
    assert.equal(query.searchParams.get('country'), 'US');
    assert.equal(query.searchParams.has('from'), false, 'History must not have a rolling date cutoff');
    assert.equal(query.searchParams.has('to'), false);
    return Response.json({ events: [event(query.searchParams.has('cursor') ? '2010-01-01' : '2020-01-01')], nextCursor: query.searchParams.has('cursor') ? null : '100', archiveStartsAt: '2010-01-01T00:00:00Z' });
  }) as typeof fetch;
  const root = createRoot(document.getElementById('root')!);
  await act(async () => root.render(<StormDiscoveryPanel simple savedHistory savedCountry="US" allAreasByDefault map={map as never} workspaceId="fixture" onSelect={() => {}} onTerritory={() => {}} onSaveZone={async () => {}} />));
  assert(document.body.textContent?.includes('Saved history begins 2010-01-01 UTC'));
  const older = [...document.querySelectorAll('button')].find(button => button.textContent === 'Load older storms');
  assert(older); await act(async () => older.click());
  assert.equal(queries[1].searchParams.get('cursor'), '100');
  assert(document.body.textContent?.includes('2020-01-01'));
  assert(document.body.textContent?.includes('2010-01-01'));
  assert(![...document.querySelectorAll('button')].some(button => button.textContent === 'Load older storms'));
  await act(async () => root.unmount()); globalThis.fetch = original;
  console.log('PASS: country-isolated saved archive, validated cursors, earliest-date display and pagination without any rolling date cutoff.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
