import assert from 'node:assert/strict';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { StormWorkbenchView } from '../../../components/storm-maps/StormWorkbenchView';
import { StormOverlayPicker } from '../../../components/storm-maps/StormOverlayPicker';
import { StormEventMap } from '../../../components/storm-maps/intelligence/StormEventMap';
import { StormDiscoveryPanel } from '../../../components/storm-maps/intelligence/StormDiscoveryPanel';
import { STRONGEST_STORM_SETTINGS } from '../gl-settings';

async function main() {
  const dom = new JSDOM('<section id="workspace"><div id="canvas"></div><div id="root"></div></section>');
  Object.assign(globalThis, { React, self: dom.window, window: dom.window, document: dom.window.document, HTMLElement: dom.window.document.createElement('div').constructor, IS_REACT_ACT_ENVIRONMENT: true });
  let resizeCalls = 0;
  Object.assign(globalThis, { requestAnimationFrame: (callback: () => void) => { callback(); return 1; }, cancelAnimationFrame: () => {} });
  const workspace = document.getElementById('workspace')!;
  const workbenchMap = { getContainer: () => document.getElementById('canvas')!, resize: () => { resizeCalls++; } };
  const changeFullscreen = (element: Element | null) => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element });
    document.dispatchEvent(new dom.window.Event('fullscreenchange'));
  };
  workspace.requestFullscreen = async () => { changeFullscreen(workspace); };
  document.exitFullscreen = async () => { changeFullscreen(null); };
  let mobile = false;
  const mediaListeners = new Set<() => void>();
  window.matchMedia = (() => ({ get matches() { return mobile; }, addEventListener(_event: string, listener: () => void) { mediaListeners.add(listener); }, removeEventListener(_event: string, listener: () => void) { mediaListeners.delete(listener); } })) as unknown as typeof window.matchMedia;
  let sidebarWidth = -1;
  let mounts = 0, unmounts = 0;
  let selection: 'draw' | 'weather' | undefined;
  function Archive() {
    useEffect(() => { mounts++; return () => { unmounts++; }; }, []);
    return <p>Selected storm geometry</p>;
  }
  const root = createRoot(document.getElementById('root')!);
  const range = { start: new Date('2026-10-13T00:00:00Z'), end: new Date('2026-10-13T23:59:59Z') };
  await act(async () => {
    root.render(<StormWorkbenchView onSidebarWidth={width => { sidebarWidth = width; }} map={workbenchMap as never} settings={{ ...STRONGEST_STORM_SETTINGS, mode: 'history' }} selectedStorm onCreateTerritory={value => { selection = value; }}
      timelineRange={range} onTimelineRange={() => {}} onTimelineSpeed={() => {}} onChange={() => {}} onArchive={() => {}}
      ready={false} loading={false} error={null} playing={false} position={100} clock="7:59 PM" rangeTitle="Selected storm · Historical"
      rangeLabels={{ start: 'Oct 13', end: 'Oct 13' }} onPlay={() => {}} onScrub={() => {}} onNow={() => {}} legendRef={{ current: null }}
      renderArchive={onTerritory => <><Archive /><button onClick={onTerritory}>Select hail zone</button></>} renderSaved={() => <p>Saved territories</p>} renderTerritory={() => <p>Select zone</p>} renderLayers={() => null} />);
  });
  const click = async (label: string) => {
    const button = Array.from(document.querySelectorAll('button')).find(node => node.textContent === label);
    assert.ok(button, `Missing button: ${label}`);
    await act(async () => { const event = document.createEvent('MouseEvents'); event.initEvent('click', true, true); button.dispatchEvent(event); });
  };
  await click('Select hail zone');
  assert.equal(selection, 'weather', 'Select hail zone must open weather selection, not drawing');
  assert.equal(mounts, 1); assert.equal(unmounts, 0, 'Selecting a territory must keep historical geometry mounted');
  await click('Saved territories');
  await click('Recent storms');
  assert.equal(mounts, 1); assert.equal(unmounts, 0, 'Returning to the storm must preserve the selected event');
  await click('Create storm territory');
  assert.equal(selection, 'draw', 'Create storm territory still supports drawing');
  assert.equal(document.querySelector('[aria-label="Weather timeline"]'), null, 'The bottom playback bar is removed');
  assert.equal(document.querySelector('[aria-label="Play weather animation"]'), null);
  assert.ok(document.querySelector('nav[aria-label="Map settings and timeline"] button[aria-label="Timeline settings"]'), 'Timeline settings remain in the top-right controls');
  assert.equal(Array.from(document.querySelectorAll('button')).some(node => node.textContent === 'Now'), false);
  assert.equal(sidebarWidth, 280, 'Desktop keeps its sidebar');
  await act(async () => { mobile = true; mediaListeners.forEach(listener => listener()); });
  assert.equal(sidebarWidth, 0, 'Phones must reserve no map width for the storm list');
  const sidebarContent = () => document.querySelector('[aria-label="Storm list"] > div')!;
  assert.equal(sidebarContent().hasAttribute('inert'), false, 'Resizing preserves an explicitly opened panel');
  await click('Find storm');
  assert.equal(sidebarContent().hasAttribute('inert'), false);
  const clickLabel = async (label: string) => {
    const button = document.querySelector(`button[aria-label="${label}"]`)!;
    assert.ok(button, label);
    await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  };
  await clickLabel('Hide storm list');
  assert.ok(sidebarContent().hasAttribute('inert'));
  await click('Layers');
  assert.equal(document.querySelector('button[aria-expanded="true"]')?.textContent, 'Layers');
  await clickLabel('Close weather layers');
  assert.equal(mounts, 1); assert.equal(unmounts, 0, 'Mobile panels preserve the selected storm');
  await clickLabel('Enter fullscreen map');
  assert.equal(document.fullscreenElement, workspace, 'Fullscreen must contain the canvas and storm controls');
  assert.ok(workspace.classList.contains('storm-fullscreen-surface'));
  assert.equal(resizeCalls, 1, 'Entering fullscreen must resize the map');
  assert.equal(unmounts, 0, 'Fullscreen must preserve the selected storm');
  await clickLabel('Exit fullscreen map');
  assert.equal(document.fullscreenElement, null);
  assert.equal(resizeCalls, 2, 'Exiting fullscreen must resize the map');
  await act(async () => { window.dispatchEvent(new dom.window.Event('resize')); });
  assert.equal(resizeCalls, 3, 'Browser fullscreen/viewport resizing must resize the map too');
  await act(async () => { root.unmount(); });
  assert.equal(workspace.classList.contains('storm-fullscreen-surface'), false);
  window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(resizeCalls, 3, 'Unmount removes fullscreen resize listeners');
  // Selecting a storm fits the camera while its style may still be loading.
  let styleReady = true;
  const sources = new Map<string, unknown>(), layers = new Map<string, unknown>();
  const listeners = new Map<string, Set<() => void>>();
  const map = {
    queryRenderedFeatures: () => [],
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
  await click('TX hail reportshail · 2.00″ hail1 reported observations · Reports only');
  assert.equal(sources.has('wolfgrid-historical-severity'), false);
  styleReady = true;
  await act(async () => { for (const listener of [...(listeners.get('idle') ?? [])]) listener(); });
  assert.ok(sources.has('wolfgrid-historical-severity'), 'Historical shading must retry when the fitted map becomes ready');
  assert.ok(layers.has('wolfgrid-historical-severity-fill'));
  await act(async () => { stormRoot.unmount(); });
  // Weather timeline ticks rerender the parent every 400 ms, creating a new
  // location callback. That must not tear down the selected event's map layers.
  styleReady = true;
  const eventRoot = createRoot(document.getElementById('root')!);
  await act(async () => { eventRoot.render(<StormEventMap map={map as never} event={storm as never} minimumHailMM={25.4} onLocation={() => {}} />); });
  assert.ok(sources.has('storm-intelligence-event'));
  styleReady = false;
  let latestLocationCalls = 0;
  await act(async () => { eventRoot.render(<StormEventMap map={map as never} event={storm as never} minimumHailMM={25.4} onLocation={() => { latestLocationCalls++; }} />); });
  assert.ok(sources.has('storm-intelligence-event'), 'A timeline rerender must not remove the selected storm while map tiles are loading');
  assert.ok(layers.has('storm-intelligence-points'));
  for (const listener of listeners.get('click') ?? []) (listener as (event: unknown) => void)({ type: 'click', lngLat: { lng: -101, lat: 35 }, point: {} });
  assert.equal(latestLocationCalls, 1, 'Map clicks use the newest callback without redrawing');
  // Swapping between light/dark basemaps removes custom sources. The selected
  // storm must return even when style.load fires before the tiles are ready.
  for (const appearance of ['light', 'dark']) {
    sources.clear(); layers.clear(); styleReady = false;
    await act(async () => { for (const listener of [...(listeners.get('style.load') ?? [])]) listener(); });
    styleReady = true;
    await act(async () => { for (const listener of [...(listeners.get('idle') ?? [])]) listener(); });
    assert.ok(sources.has('storm-intelligence-event'), `${appearance} basemap restores storm data`);
    assert.ok(layers.has('storm-intelligence-points'), `${appearance} basemap restores storm reports`);
    assert.ok(layers.has('storm-intelligence-line'), `${appearance} basemap restores storm tracks`);
  }
  await act(async () => { eventRoot.unmount(); });
  // Campaign-map selection must move the camera, not only add the outline.
  const territory = { id: 'arizona-territory', name: 'Arizona hail territory', revision: 1,
    boundary: { type: 'Polygon', coordinates: [[[-112.2,33.3],[-112.0,33.3],[-112.0,33.5],[-112.2,33.5],[-112.2,33.3]]] },
    context: { event: { ...storm, start: '2026-10-21T00:00:00Z' }, selectedAt: '2026-10-22T00:00:00Z' } };
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ territories: [territory] }) })) as typeof fetch;
  const fits: Array<{ bounds: unknown; options: Record<string, unknown> }> = [];
  let selectedTerritoryId: string | undefined;
  const pickerMap = { ...map, getContainer: () => ({ clientWidth: 390, clientHeight: 700 }), fitBounds: (bounds: unknown, options: Record<string, unknown>) => { fits.push({ bounds, options }); } };
  styleReady = true;
  const pickerRoot = createRoot(document.getElementById('root')!);
  await act(async () => { pickerRoot.render(<StormOverlayPicker map={pickerMap as never} mapLoaded workspaceId="test" onStormCampaign={context => { selectedTerritoryId = context.territoryId; }} />); });
  await click('Storm');
  await click('Arizona hail territory2026-10-21 · hail');
  assert.equal(selectedTerritoryId, territory.id);
  assert.deepEqual(fits[0].bounds, [[-112.2,33.3],[-112.0,33.5]], 'Selecting the territory must frame its actual boundary');
  assert.equal(fits[0].options.maxZoom, 16, 'Small territories can be viewed at neighborhood scale');
  assert.equal(fits[0].options.retainPadding, false);
  assert.ok(Number(fits[0].options.padding) < 80, 'Phone maps use padding that fits the viewport');
  assert.equal(document.getElementById('storm-overlay-picker'), null, 'Selection closes the picker');
  await click('Storm');
  await click('Arizona hail territory2026-10-21 · hail');
  assert.equal(fits.length, 2, 'Clicking the active territory recenters it again');
  await act(async () => { pickerRoot.unmount(); });
  dom.reconfigure({ url: 'https://wolfgrid.test/campaigns/create?stormTerritory=arizona-territory' });
  const linkedRoot = createRoot(document.getElementById('root')!);
  await act(async () => { linkedRoot.render(<StormOverlayPicker map={pickerMap as never} mapLoaded workspaceId="test" />); });
  assert.equal(fits.length, 3, 'Territory links still focus the map automatically');
  await act(async () => { linkedRoot.unmount(); });
  globalThis.fetch = originalFetch;
  dom.window.close();
  console.log('PASS: desktop/mobile panels preserve selection, mobile map uses full width, historical geometry retries after loading, timeline rerenders preserve storm layers; territory selection, reselection and direct links focus the map.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
