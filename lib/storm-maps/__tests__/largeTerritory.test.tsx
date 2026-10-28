import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { StormTerritoryCampaignActions, StormTerritoryDrawingContext } from '../../../components/storm-maps/StormTerritoryCampaignActions';
import { StormTerritoryAddressCount } from '../../../components/storm-maps/StormTerritoryAddressCount';
import { StormMobileContext } from '../mobile-session';
import { stormNeedsTerritoryOverlay } from '../intelligence/campaign-policy';
import type { SavedStormTerritory } from '../intelligence/storm-territories';

async function main() {
  assert.equal(stormNeedsTerritoryOverlay(4000), false);
  for (const count of [4001, 6446]) assert.equal(stormNeedsTerritoryOverlay(count), true);
  for (const count of [null, undefined, NaN, Infinity, 0]) assert.equal(stormNeedsTerritoryOverlay(count), false);
  const TestDOM = JSDOM as unknown as new (html: string, options: { url: string }) => { window: Window & typeof globalThis };
  const dom = new TestDOM('<div id="root"></div>', { url: 'https://wolfgrid.app/mobile/storms' });
  Object.assign(globalThis, { React, window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
  const originalFetch = globalThis.fetch;
  const boundary: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[-106.5,31.7],[-106.4,31.7],[-106.4,31.8],[-106.5,31.8],[-106.5,31.7]]] };
  const territory = { id: '1b4bfab1-e49f-401e-9479-469719593c67', name: 'Storm territory', boundary, revision: 1, context: {} } as SavedStormTerritory;
  for (const [index, scenario] of [
    { count: 4000, saved: true, fallback: false },
    { count: 4001, saved: false, fallback: false },
    { count: 6446, saved: true, fallback: false },
    { count: 0, saved: false, fallback: true },
  ].entries()) {
    let saves = 0, draws = 0, navigations = 0;
    const requests: string[] = [];
    globalThis.fetch = (async input => {
      const url = String(input); requests.push(url);
      if (url.includes('/address-count')) return Response.json({ count: scenario.count, partial: false, zoom: 10, regions: ['TX'] });
      if (url.includes('/campaign-plan') && scenario.fallback) return Response.json({ territoryOnly: true, addressCount: 6446, parts: [] });
      throw Error(`Unexpected campaign write: ${url}`);
    }) as typeof fetch;
    const root = createRoot(document.getElementById('root')!);
    await act(async () => root.render(<AppRouterContext.Provider value={{ push: () => { navigations++; } } as never}>
      <StormMobileContext.Provider value={() => { navigations++; }}>
        <StormTerritoryDrawingContext.Provider value={value => { assert.equal(value.id, territory.id); draws++; }}>
          <StormTerritoryAddressCount workspaceId={`workspace-${index}`} boundary={boundary} />
          <StormTerritoryCampaignActions active={scenario.saved ? territory : null} workspaceId={`workspace-${index}`} draftBoundary={boundary} prepareTerritory={async () => { saves++; return territory; }} />
        </StormTerritoryDrawingContext.Provider>
      </StormMobileContext.Provider>
    </AppRouterContext.Provider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 650)); });
    const button = (label: string) => [...document.querySelectorAll('button')].find(node => node.textContent === label);
    if (scenario.count === 4000) {
      assert(button('Create campaign'), 'Exactly 4,000 still permits campaign creation');
      assert(!button('Create storm territory'));
    } else {
      if (scenario.fallback) {
        await act(async () => button('Create campaign')!.click());
        assert(button('Create storm territory'), 'Authoritative native address count can override an unknown estimate');
      }
      assert(!button('Create campaign'), 'Large territories cannot create split campaigns');
      assert(!button('Create area campaign'), 'Large territories remain overlays rather than empty campaigns');
      assert(document.body.textContent!.includes('draw a smaller area'));
      await act(async () => { button('Create storm territory')!.click(); button('Create storm territory')!.click(); });
      assert.equal(saves, scenario.saved ? 0 : 1, 'Save once or reuse the already saved territory');
      assert.equal(draws, 1, 'Keep the territory overlay and start drawing the smaller campaign');
      assert.equal(navigations, 0, 'Do not leave the storm overlay for an empty campaign');
      assert(!requests.some(url => url === '/api/campaigns' || url.includes('/provision')));
    }
    assert.equal(requests.filter(url => url.includes('/address-count')).length, 1);
    await act(async () => root.unmount());
  }
  globalThis.fetch = originalFetch;
  dom.window.close();
  console.log('PASS: 4,000 boundary, 4,001/6,446 territory-only workflow, save reuse, duplicate-click lock, overlay drawing and authoritative server fallback.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
