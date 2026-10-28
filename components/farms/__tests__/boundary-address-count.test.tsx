import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { FarmBoundaryAddressCount } from '../FarmBoundaryAddressCount';

async function main() {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const listeners = new Map<string, Set<() => void>>();
  const map = { current: {
    on(event: string, fn: () => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn); },
    off(event: string, fn: () => void) { listeners.get(event)?.delete(fn); },
  }};
  const polygon = { type: 'Polygon', coordinates: [[[-79.4,43.6],[-79.3,43.6],[-79.3,43.7],[-79.4,43.6]]] };
  let features: unknown[] = [{ type: 'Feature', properties: {}, geometry: polygon }];
  const draw = { current: { getAll: () => ({ type: 'FeatureCollection', features }) } };
  const requests: { url: string; body: unknown }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ count: 6446, partial: false, regions: ['ON'], zoom: 14 });
  }) as typeof fetch;
  const root = createRoot(document.getElementById('root')!);
  const emit = async (event: string) => act(async () => { listeners.get(event)?.forEach(fn => fn()); });
  const wait = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
  try {
    await act(async () => root.render(<FarmBoundaryAddressCount map={map as never} draw={draw as never} mapLoaded workspaceId="farm-workspace" />));
    await wait();
    assert.match(document.body.textContent!, /6,446/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/farms/address-count?workspaceId=farm-workspace');
    assert.deepEqual(requests[0].body, polygon, 'Count the entire geometry, not viewport bounds');
    for (let i = 0; i < 5; i++) await emit('idle');
    await wait();
    assert.equal(requests.length, 1, 'Panning/zooming must not rescan or change the count');
    features = [];
    await emit('draw.delete');
    assert.match(document.body.textContent!, /Address pins0/);
    assert.doesNotMatch(document.body.textContent!, /6,446/);
    await act(async () => root.unmount());
    assert([...listeners.values()].every(set => set.size === 0), 'Unsubscribe map events');
    console.log('PASS farm full-boundary count, over-limit totals, viewport independence, clear and cleanup');
  } finally { globalThis.fetch = originalFetch; dom.window.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
