import assert from 'node:assert/strict';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { StormWorkbenchView } from '../../../components/storm-maps/StormWorkbenchView';
import { StormOverlayPicker } from '../../../components/storm-maps/StormOverlayPicker';
import { StormEventMap } from '../../../components/storm-maps/intelligence/StormEventMap';
import { StormDiscoveryPanel } from '../../../components/storm-maps/intelligence/StormDiscoveryPanel';

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
  await act(async () => {
    root.render(<StormWorkbenchView onSidebarWidth={width => { sidebarWidth = width; }} map={workbenchMap as never} selectedStorm onCreateTerritory={value => { selection = value; }}
      onArchive={() => {}} loading={false} error={null}
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
  assert.ok(document.querySelector('nav[aria-label="Map settings and timeline"] button[aria-label="Weather layers"]'), 'Public weather layers remain in the top-right controls');
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
  const range = { start: new Date('2026-10-13T00:00:00Z'), end: new Date('2026-10-13T23:59:59Z') };
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
  const storm = { key: 'iem:hail:2026-10-21:AZ', title: 'TX hail reports', hazard: 'hail', source: 'iem', sourceId: 'test', start: range.start.toISOString(), end: range.end.toISOString(), reportCount: 1, maxHailMM: 50.8, features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [-101, 35] }, properties: { kind: 'report', hailMM: 50.8 } }] };
  const originalFetch = globalThis.fetch;
  const selectedBoundary = { type: 'Polygon', coordinates: [[[-101.1,34.9],[-100.9,34.9],[-100.9,35.1],[-101.1,35.1],[-101.1,34.9]]] };
  const emptyBoundary = { type: 'Polygon', coordinates: [[[-101.5,34.9],[-101.3,34.9],[-101.3,35.1],[-101.5,35.1],[-101.5,34.9]]] };
  const countedBoundaries: unknown[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.includes('/zones?')) return Response.json({ zones: [{
      id: 'zone', minimum_mm: 25.4, estimation_method: 'WolfGrid zones derived from NOAA MRMS 24-hour maximum estimated hail size',
      geometry: { type: 'MultiPolygon', coordinates: [selectedBoundary.coordinates, emptyBoundary.coordinates] },
    }] });
    if (url.includes('/campaign-preview?')) {
      const boundary = JSON.parse(String(init?.body));
      countedBoundaries.push(boundary);
      const known = JSON.stringify(boundary) === JSON.stringify(selectedBoundary);
      return Response.json({
        count: known ? 26 : 0, partial: false, regions: ['TX'],
        campaignPreview: known
          ? { status: 'ready', total: 31, pendingParcelStops: 5, addressedParcelStops: 0, buildingStops: 0, campaignCount: 1 }
          : { status: 'no-mapped-addresses' },
      });
    }
    if (url.includes('/exposure?')) return Response.json({ available: false, counts: null, reason: 'Historical exposure is disabled.' });
    return Response.json({ events: [storm] });
  }) as typeof fetch;
  let savedZoneId: string | undefined;
  const stormRoot = createRoot(document.getElementById('root')!);
  await act(async () => { stormRoot.render(<StormDiscoveryPanel allAreasByDefault map={map as never} workspaceId="test" onSelect={() => {}} onTerritory={() => {}} onSaveZone={async (_name, _boundary, context) => { savedZoneId = context.zoneId; }} />); });
  await click('TX hail reportshail · 2.00″ hail1 reported observations');
  assert.equal(sources.has('wolfgrid-historical-severity'), false);
  styleReady = true;
  await act(async () => { for (const listener of [...(listeners.get('idle') ?? [])]) listener(); });
  assert.ok(sources.has('wolfgrid-historical-severity'), 'Historical shading must retry when the fitted map becomes ready');
  assert.ok(layers.has('wolfgrid-historical-severity-raster'), 'Archived hail opens directly on the smooth raster');
  assert.ok(document.body.textContent?.includes('Tap a shaded hail zone'));
  assert.ok(![...document.querySelectorAll('button')].some(button => button.textContent === 'Select hail zone'),
    'Archived zones are selected directly on the map, without opening the rolling provider selector');
  const pickZone = async (lng: number) => {
    await act(async () => {
      for (const listener of listeners.get('click') ?? []) {
        (listener as (event: { lngLat: { lng: number; lat: number } }) => void)({ lngLat: { lng, lat: 35 } });
      }
    });
  };
  const waitForCount = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
  await pickZone(-101);
  assert.ok(document.body.textContent?.includes('Estimated hail: 1.00″+'));
  await waitForCount();
  assert.deepEqual(countedBoundaries, [selectedBoundary], 'Count only the selected connected polygon before it is saved');
  const preview = () => [...document.querySelectorAll('[aria-live="polite"]')].find(node => node.textContent?.includes('Mapped address pins in this hail zone'));
  assert.ok(preview()?.textContent?.includes('26'), 'Mapped pin totals are available with historical exposure disabled');
  assert.ok(preview()?.textContent?.includes('31 stops'), 'Show the total before save');
  const parcelRow = [...preview()!.querySelectorAll('dt')].find(term => term.textContent === 'Pending parcel stops');
  assert.equal(parcelRow?.nextElementSibling?.textContent, '5');
  assert.equal(savedZoneId, undefined);
  await pickZone(-101.4);
  assert.ok(!preview()?.textContent?.includes('26'), 'Switching zones must hide the previous count immediately');
  assert.ok(!preview()?.textContent?.includes('31 stops'));
  await waitForCount();
  assert.deepEqual(countedBoundaries, [selectedBoundary, emptyBoundary]);
  assert.ok(preview()?.textContent?.includes('No mapped pins found'));
  await pickZone(-101);
  await click('Create storm territory');
  assert.equal(savedZoneId, 'zone');
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
