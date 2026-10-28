# Farm touchpoint plan

Implemented locally on October 27, 2026. Production deployment and signed-in database verification remain unperformed.

The Plan tab now opens with compact editable touchpoint rows (title, all eight touch types, date). Notes and target homes expand per row. Users can add an arbitrary number of touchpoints, remove scheduled touches, undo draft changes, and save an empty plan. Existing saved touches are authoritative; there is no generated twelve-cycle refill. Daily door assignments remain available in a separate collapsible section below.

The graph compares cumulative planned dates with actual completion dates and marks today. Completed activity and active sessions remain visible in the timeline. Upcoming graph points and timeline cards link back to the editor; graph points support Enter and Space. The graph measures its container so dates and labels remain readable at phone width. Preview screenshots use fixture data: [desktop](touchpoint-plan/desktop.png), [phone](touchpoint-plan/mobile.png).

Saving uses the existing authenticated FarmTouchService. All rows are validated before writes. Removed scheduled touches become `skipped`, retaining activity/history records. Completed and active touches are not removed. Successful creations retain their IDs across failed saves/retries, and pending creations are included in later removals. A direct touch refresh must succeed before the UI announces success; errors stay inline and preserve the draft. This is a sequence of existing service writes, not an atomic database transaction.

## Verification

- `npx tsx lib/farms/__tests__/touch-plan.test.ts`: passed. Separate planned/completed dates, skipped-history exclusion, zero targets, overdue boundaries, invalid rows before any writes, removal/history preservation, empty saves, retry without duplicate creation.
- `node scripts/test-farm-touch-plan-browser.cjs`: passed with the real component and fixture callbacks. Eight types, inline edits, details, graph keyboard selection, timeline edit/removal, add/undo, save callback, no page errors, desktop and 390px layout. The harness does not connect to the live database.
- ESLint: no errors in the component, model, tests, or farm page; the existing image optimization warning remains in the farm page.
- The full farm route compiled and returned HTTP 200 from the local Next.js server. A malformed closing wrapper in the shared farm page was corrected during this check.
- Opening the full local page reached its login screen, so signed-in persistence/workspace isolation was not verified. The existing production browser session was read only.
- Full repository TypeScript check continues to fail in unrelated integrations/other files; no diagnostics for the planner model/component or farm page.

No migration is needed for touchpoint editing itself. The separate weekday door-plan feature still has the prerequisite documented in [weekday door plan notes](2026-10-27-weekday-door-plan.md).
