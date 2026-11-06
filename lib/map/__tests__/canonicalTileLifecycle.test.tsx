import assert from 'node:assert/strict';
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { CanonicalCampaignTilesLayer } from '../../../components/map/CanonicalCampaignTilesLayer';

async function main() {
  const dom = new JSDOM('<div id="root"></div>');
  Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  for (const parentRemovesMap of [true, false]) {
    let removed = false;
    const layers = new Set<string>();
    const sources = new Set<string>();
    const listeners = new Set<unknown>();
    const assertStyle = () => {
      if (removed) throw new TypeError("Cannot read properties of undefined (reading 'getOwnLayer')");
    };
    const map = {
      getStyle: () => removed ? undefined : { layers: [...layers] },
      isStyleLoaded: () => !removed,
      getLayer: (id: string) => { assertStyle(); return layers.has(id); },
      getSource: (id: string) => { assertStyle(); return sources.has(id); },
      addSource: (id: string) => sources.add(id),
      addLayer: (layer: { id: string }) => layers.add(layer.id),
      removeLayer: (id: string) => { assertStyle(); layers.delete(id); },
      removeSource: (id: string) => { assertStyle(); assert.equal(layers.size, 0); sources.delete(id); },
      setLayoutProperty() {}, setFilter() {}, setPaintProperty() {}, setFeatureState() {},
      on: (_event: string, fn: unknown) => listeners.add(fn),
      off: (_event: string, fn: unknown) => listeners.delete(fn),
    };
    const bundle = { campaign_id: '', records: { buildings: [], addresses: [], parcels: [] }, links: [],
      tiles: { layers: {}, geometry_revision: 'test', tile_url_template: '/tiles/{z}/{x}/{y}', bounds: [0, 0, 1, 1] } };
    function MapTab() {
      useEffect(() => () => { if (parentRemovesMap) { removed = true; layers.clear(); sources.clear(); } }, []);
      return <CanonicalCampaignTilesLayer map={map as never} bundle={bundle as never} mapLoaded styleKey="test"
        mode="buildings" addresses={[]} dark showParcels statusFilters={{ QR_SCANNED: true } as never} onClick={() => {}} />;
    }
    const root = createRoot(document.getElementById('root')!);
    await act(async () => { root.render(<MapTab />); });
    assert.ok(layers.size > 0, 'Map layers must be attached before switching tabs');
    await act(async () => { root.render(<div>Campaign activity</div>); });
    assert.equal(document.getElementById('root')!.textContent, 'Campaign activity');
    assert.equal(listeners.size, 0, 'Cleanup must detach listeners');
    assert.equal(layers.size, 0);
    assert.equal(sources.size, 0);
    await act(async () => { root.unmount(); });
  }
  dom.window.close();
  console.log('PASS: Activity tab survives parent map removal; live map cleanup removes layers before source and detaches listeners');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
