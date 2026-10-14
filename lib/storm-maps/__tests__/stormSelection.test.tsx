import assert from 'node:assert/strict';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { StormWorkbenchView } from '../../../components/storm-maps/StormWorkbenchView';
import { StormDiscoveryPanel } from '../../../components/storm-maps/intelligence/StormDiscoveryPanel';
import { STRONGEST_STORM_SETTINGS } from '../gl-settings';

async function main() {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, HTMLElement: dom.window.document.createElement('div').constructor, IS_REACT_ACT_ENVIRONMENT: true });
  let mounts = 0, unmounts = 0;
  function Archive() {
    useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return <p>Selected storm geometry</p>;
  }
  const root = createRoot(document.getElementById('root')!);
  const range = { start: new Date('2026-10-13T00:00:00Z'), end: new Date('2026-10-13T23:59:59Z') };
  await act(async () => {
    root.render(<StormWorkbenchView map={{} as never} settings={{ ...STRONGEST_STORM_SETTINGS, mode: 'history' }} selectedStorm
      timelineRange={range} onTimelineRange={() => {}} onTimelineSpeed={() => {}} onChange={() => {}} onArchive={() => {}}
      ready={false} loading={false} error={null} playing={false} position={100} clock="7:59 PM" rangeTitle="Selected storm · Historical"
      rangeLabels={{ start: 'Oct 13', end: 'Oct 13' }} onPlay={() => {}} onScrub={() => {}} onNow={() => {}} legendRef={{ current: null }}
      renderArchive={() => <Archive />} renderSaved={() => <p>Saved territories</p>} renderTerritory={() => <p>Select zone</p>} renderLayers={() => null} />);
  });
  const click = async (label: string) => {
    const button = Array.from(document.querySelectorAll('button')).find(node => node.textContent === label);
    assert.ok(button, `Missing button: ${label}`);
    await act(async () => { const event = document.createEvent('MouseEvents'); event.initEvent('click', true, true); button.dispatchEvent(event); });
  };
  await click('Create storm territory');
  assert.equal(mounts, 1); assert.equal(unmounts, 0, 'Selecting a territory must keep historical geometry mounted');
  await click('Saved territories');
  await click('Recent storms');
  assert.equal(mounts, 1); assert.equal(unmounts, 0, 'Returning to the storm must preserve the selected event');
  assert.ok(document.body.textContent?.includes('Selected storm · Historical'));
  assert.ok(document.body.textContent?.includes('Storm end'));
  assert.equal(Array.from(document.querySelectorAll('button')).some(node => node.textContent === 'Now'), false);
  await act(async () => { root.unmount(); });
  // Selecting a storm fits the camera while its style may still be loading.
  let styleReady = true;
  const sources = new Map<string, unknown>(), layers = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  const map = {
    getBounds: () => ({ getWest: () => -103, getEast: () => -100, getSouth: () => 34, getNorth: () => 37 }),
    fitBounds: () => { styleReady = false; }, isStyleLoaded: () => styleReady, getStyle: () => ({ layers: [] }),
    getSource: (id: string) => sources.get(id), removeSource: (id: string) => sources.delete(id),
    addSource: (id: string, config: unknown) => sources.set(id, { config, setData: () => {} }),
    getLayer: (id: string) => layers.get(id), addLayer: (layer: { id: string }) => layers.set(layer.id, layer), removeLayer: (id: string) => layers.delete(id),
    on: (event: string, listener: () => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
    off: (event: string, listener: () => void) => listeners.get(event)?.delete(listener),
    once: (event: string, listener: () => void) => { const once = () => { listeners.get(event)?.delete(once); listener(); }; map.on(event, once); },
  };
  const storm = { key: 'iem:hail:2026-10-13:TX', title: 'TX hail reports', hazard: 'hail', source: 'iem', sourceId: 'test', start: range.start.toISOString(), end: range.end.toISOString(), reportCount: 1, maxHailMM: 50.8, features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-101, 35] }, properties: { kind: 'report', hailMM: 50.8 } }] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => ({ ok: true, json: async () => url.includes('/zones?') ? { zones: [{ id: 'zone', minimum_mm: 25.4, geometry: { type: 'Polygon', coordinates: [[[-102,34],[-100,34],[-100,36],[-102,36],[-102,34]]] } }] } : { events: [storm] } })) as typeof fetch;
  const stormRoot = createRoot(document.getElementById('root')!);
  await act(async () => { stormRoot.render(<StormDiscoveryPanel map={map as never} workspaceId="test" onSelect={() => {}} onTerritory={() => {}} onSaveZone={async () => {}} />); });
  await click('TX hail reports2026-10-13 · hail · 2.00″ hail1 reported observations · Reports only');
  assert.equal(sources.has('wolfgrid-historical-severity'), false);
  styleReady = true;
  await act(async () => { for (const listener of [...(listeners.get('idle') ?? [])]) listener(); });
  assert.ok(sources.has('wolfgrid-historical-severity'), 'Historical shading must retry when the fitted map becomes ready');
  assert.ok(layers.has('wolfgrid-historical-severity-fill'));
  await act(async () => { stormRoot.unmount(); });
  globalThis.fetch = originalFetch;
  dom.window.close();
  console.log('Selected storm map survives sidebar switches; historical shading retries after camera loading; historical timeline stays labelled.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
