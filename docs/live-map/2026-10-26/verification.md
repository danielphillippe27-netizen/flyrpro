# Team Live Map — October 26, 2026

Implemented locally in the dedicated team dashboard Live Map tab. Campaign-map screens and native mobile apps were not changed.

## Behaviour

- Profile-photo markers with initials when a photo is missing or fails, names, session stats, coloured position dots and selected-person highlighting.
- Team roster with active, paused, delayed and offline filters; session totals count a shared session once. Shared-session stats are labelled.
- Select a teammate to centre and follow their reported position. Manual map panning stops following; Show everyone restores team framing.
- Automatic refresh every 15 seconds. Locations become delayed after 60 seconds and leave the map after five minutes without a report. Following waits while a location is delayed.
- Temporary refresh failures retain the last reported positions and display an error. Loss of authorization clears team data and locations.
- Responsive map/roster layout, compact mobile markers, and viewport fitting after a resize. Demo activity remains explicitly labelled as simulated.

## Verification

- 25 data-loader tests passed, covering active sessions, workspace isolation, missing/invalid GPS, stale reports, shared sessions, campaign switches, paused teammates, photo payloads and database errors.
- 5 presentation-policy tests passed, covering freshness boundaries, invalid locations, clock skew, shared-session totals, photo URL validation and initials.
- Real Chrome/Mapbox browser check passed with controlled workspace and team API fixtures. It exercises the actual TeamMapTab and TeamLiveActivity components and production styles, profile photos and failure fallback, moving coordinates/stats, follow/pan controls, actual 15-second polling, outage recovery, delayed/expired markers, filters, permission revocation, four-person demo, light/dark themes, mobile resize and cleanup. No browser runtime errors were observed.
- ESLint passed for all changed TypeScript/TSX files. Diff whitespace check passed.
- Full-project type checking still reports errors in unrelated existing modules (including integrations settings, map styles and storms); it reports none in the changed Live Map files.

Re-run from Wolfgrid-WEB using Node 22:

```sh
npx tsx lib/__tests__/teamLiveMap.test.ts
npx tsx lib/__tests__/teamLiveMapDisplay.test.ts
node scripts/test-team-live-map-browser.cjs
```

The browser check uses installed Chrome and the public Mapbox token from `.env.local`. It serves a temporary local harness, intercepts team-data requests, changes no production records, and removes its temporary bundle when finished. The saved previews contain fictional test people and data.

## Limits

These changes have not been deployed. Real phone GPS publishing, background location permissions, and a multi-device field session were not exercised. Browser coverage uses real rendering and controlled API responses; data-loader coverage uses the production loader with an in-memory database transport.

## Previews

- [Desktop](desktop.png)
- [Mobile dark](mobile-dark.png)
- [Mobile light](mobile-light.png)
