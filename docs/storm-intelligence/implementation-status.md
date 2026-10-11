# Storm Intelligence implementation status

## Implemented

- Historical U.S. hail/wind/tornado report search by UTC date range and map region, up to 31 days per request (older dates allowed). Report groups are explicitly day/state observations, not inferred storm-cell identities or damage footprints.
- Xweather active cyclones and historical nearby cyclone queries; archived storms reopen by provider ID. Advisory tracks split at the date line; forecast positions are distinct.
- Recent U.S. hail events use MapsGL maximum hail-size shading when the event is inside its rolling seven-day window. Severity filtering currently applies to report points, not raster shading.
- Location-specific Xweather hail archive lookups, including Canada, for one selected UTC day. No automatic bulk/property fan-out.
- Workspace bookmarks store event references only. Reopening fetches provider data again. These are not immutable licensed source-data snapshots.
- User-drawn campaign creation stores versioned selection provenance in campaigns.storm_context atomically with campaign creation. Campaign details link back to the source event.
- Linked campaign activity exposes owned campaigns for ordinary members, workspace campaigns for managers; counts distinguish visited/unvisited stops. These are not estimates of all exposed properties.
- Inspection observations are separate from weather estimates and protected behind authenticated workspace/entitlement checks. Text summaries are downloadable; certified/PDF weather reports are not implemented.
- Workspace archive request budget, additive database migrations, server-only provider credentials.
- Stable MapsGL session URL with a rotating HttpOnly capability cookie; manifest refresh no longer recreates the renderer. Historical intelligence hides current warnings/outlooks.

## Campaign review and inspection continuation

- Storm-linked drawing now reviews overlapping saved campaign boundaries and recorded inspection locations inside the selected polygon. Polygon holes, boundary-only contact and separate unit labels are handled explicitly.
- Campaign visibility is workspace-wide for owners/admins and owned campaigns for ordinary members. Campaigns without boundaries and other CRM opt-out sources are outside this review.
- Review requests debounce after drawing edits and cancel stale requests. Caps (500 campaigns / 500 inspection records) and invalid stored boundaries produce explicit incomplete-review warnings.
- Inspection worklist provides follow-up, pending, do-not-knock and all filters; search, map focus marker and append-only observation updates. It checks the newest 500 source records and labels truncation.
- This is an advisory territory review. It does not identify exact duplicate homes, automatically exclude addresses, or provide a verified storm footprint. Final campaign addresses still resolve after creation.

## Provider verification

Live account checks successfully retrieved historical Canadian point hail records and Hurricane Milton (2024-AL-14). Historical IEM report normalization tested against September 17, 2026.

## Unresolved product dependencies

Bulk archive and long-term provider retention were initially asserted then explicitly withdrawn as uncertain by the user. Do not permanently ingest Xweather provider datasets without resolving these rights and the actual bulk endpoint/export format.

No verified bulk historical hail footprint source is configured, especially for Canada. Do not interpolate report points into a supposed hail swath. Do not raster-color-sample a screenshot for property exposure. A cyclone centre track is not a wind damage footprint.

## Remaining plan work

- Licensed, versioned event/footprint ingestion and 90-day-plus regional archive.
- Verified hurricane wind-exposure footprints; advisory radii alone are not a continuous surface wind damage swath.
- Spatial property exposure jobs, deduplication against existing campaigns, do-not-knock exclusions and exact candidate selection previews.
- Multi-event exposure overlays, unworked-area map, transparent next-area recommendations.
- Inspection photos/attachments, branded PDF summaries, notifications and market watches.
- Offline/mobile integration and performance benchmarks on reference devices.

## Verification

Run `npm run test:storm-maps` and `npx tsx lib/storm-maps/__tests__/intelligence.test.ts`.
Focused ESLint and changed-file type diagnostics must pass. Whole-project typecheck has pre-existing errors outside this change; the Next build config skips type errors, so a successful build alone is not a full typecheck.

Database migrations use RLS plus revoked anonymous/authenticated table grants; all browser access goes through workspace-checked server routes. Migration tests use rollback-only writes and verify request 301 is rejected after a daily allowance of 300.

Deploy only the storm-scoped commit; this checkout contains unrelated map/address changes. Browser verification must prove historical search, event selection, save/reopen, campaign linkage and session refresh. Preserve the user's existing campaign data during checks.

### Production verification, October 10, 2026

- Signed-in production retrieved Hurricane Milton (2024), rendered its centre track, saved a workspace reference and reopened it from Saved.
- Draw campaign handed off the selected storm with a visible provenance banner. No test campaign or invented damage inspection was created; persisted campaign linkage still needs a real campaign verification.
- Switching back to live overview rendered radar, storm tracks and wind particles through the session endpoint. Ten-minute token rotation and device performance are not yet benchmarked.
- Database migration checks passed using rollback-only writes. Focused lint and storm tests passed; unrelated existing whole-project type errors remain.
