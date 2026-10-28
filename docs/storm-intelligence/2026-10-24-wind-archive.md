# Permanent wind-gust archive

Launched October 24, 2026. Open [Storm Maps → Wind history](https://wolfgrid.app/storms?region=wind).

## Behavior

- Uses the existing Vaisala Xweather account and its `conditions_GUST_10-HTGL` MapsGL product. No additional provider, account or subscription was added.
- Bootstraps the available past seven days, then checks the provider every five minutes through `/api/cron/storm-wind`. The source supplies hourly gust estimates and can publish behind the current clock; the archive retains the actual source hour.
- Saves country/hour bundles to the existing private `storm-archive` bucket and indexes them in `storm_archive_assets`. Collection runs use the existing durable ledger. No schema migration was required.
- Retains encoded numerical map values and pre-rendered display tiles from zoom 0 through the provider's maximum zoom 4. Source tiles are 512 pixels. This preserves the available provider map resolution; it does not establish the resolution or accuracy of underlying meteorological observations.
- Old maps and point inspections read saved storage only. They do not request an expired upstream frame. No rolling deletion is configured for these wind assets.
- Country, UTC date and saved-hour controls are available in the shared web Storm Maps interface. Hour options also show the browser's local time. Tap the map to inspect the retained gust estimate in km/h and mph.
- Wind archive mode hides the unrelated live-weather timeline and legend. Changing archived dates/hours changes the saved source rather than a live layer.
- Switching to regular weather layers or another sidebar removes the saved-wind overlay. “Show selected wind map” restores the retained selection without mixing it with the live-weather timeline.

## Coverage and meaning

The retained coverage uses regional bounding boxes for Canada, the United States including Alaska/Hawaii and the western Aleutians, mainland Australia/Tasmania, and New Zealand's main islands/Chathams. It does not establish coverage of every external territory. Tiles can include adjoining countries or nearby ocean; rectangles are data-collection extents, not storm footprints or national boundaries.

Values are regional gridded gust estimates, not a measurement at every home or confirmed damage. These are hourly source frames, not independently reconstructed peak gusts for every storm between frames. Sustained wind, animated wind direction and damage-only reports remain distinct from this archive. Automatic wind intensity territory selection and address-exposure calculations were not added by this change.

Numerical tiles use the red band with `0` as no data and `1..255` encoding `0..100 m/s`. Quantization is approximately 1.42 km/h. A maximum-byte sample is labeled as a lower bound. Calm wind is distinct from missing data. Display colors are illustrative bands; inspection reads numerical bytes, never rendered colors.

## Reliability

The provider can silently return a different source time when the requested hour is unavailable. The collector checks returned timestamps, units, channel layout and image dimensions. Packed requests validate every returned hour and split images using the provider's actual frame order. Forecast hours are excluded.

A country/hour is indexed only after every required numerical tile, the display pyramid and the compressed bundle are durable. Partial failures are retryable. Newest missing hours are prioritized, followed by the oldest frames at risk of leaving the seven-day window. Storage/query failures are never interpreted as calm wind.

Manual backfill can use three disjoint hour partitions through `WIND_BACKFILL_SHARD=0`, `1` or `2` and `scripts/backfill-wind-archive.ts`. This is a one-time catch-up mechanism; ongoing production collection uses Vercel Cron. All provider credentials stay server-side.

## Verification

- Calendar/hour identity, forecast exclusion, stale feeds, missing values, units and New Zealand date-line coverage tests passed.
- Packed frame-order and incomplete-response tests passed.
- Saved-map rendering tests passed for native/overview zooms, colors and transparent no-data areas.
- Existing storm-map regression suites and focused ESLint passed. Whole-project type checking still reports unrelated existing errors; no changed wind files produced diagnostics.
- A saved New Zealand tile was decoded and independently compared with the provider at the same historical hour: all 1,048,576 RGBA bytes matched.
- Saved bundles reopened successfully for CA, US, AU and NZ, including their numerical tiles and overview maps.
- The oldest saved New Zealand hour also reopened with all Xweather credentials removed from the verification process, proving that archive playback needs no upstream provider request.
- Signed-in production displayed Canada and New Zealand, inspected gust values, changed dates/hours and opened the earliest saved October 17 hour. New Zealand's map crosses the date line correctly.
- Both new endpoint groups rejected unauthenticated requests with HTTP 401.
- The first automatic production collection ran at 13:35 UTC on October 24 and completed at 13:36:00 UTC with eight country/hour assets, zero failed frames and continued backfill.
- No error/fatal runtime logs were returned for the released deployment during the initial verification window.
- Final signed-in verification confirmed the completed-history status, switching to regular gust layers and restoring the selected archive. The final production collector endpoint returned HTTP 200 at 13:48 UTC with zero missing frames and zero new writes, confirming idempotent collection.

## Release

Production deployment: `dpl_AAbchwChh3TPqgyth68Z16AC4tyK`, promoted to `wolfgrid.app` on October 24, 2026.

The release was prepared from the verified Australian-archive production source (`dpl_2GS66vBiSnMMEBPcnbqgh1Z43F4B`) with only the wind collector, archive reader/API, interface integration, scheduler configuration and wind tests added. Unrelated dirty working-checkout changes were excluded.

Initial backfill completed before 13:46 UTC. Every available hour from `2026-10-17T14:00:00.000Z` through `2026-10-24T12:00:00.000Z` is retained for all four regions: **167 distinct hours per country, 668 distinct country/hour maps**. There are 674 immutable bundles, including six additional snapshots created during overlapping bootstrap requests; the browser deduplicates hours. Total compressed retained size at verification was 829,877,217 bytes. Interrupted manual bootstrap runs were reconciled in the ledger after their remaining frames had been collected.

| Region | Distinct saved hours | Compressed retained bytes |
|---|---:|---:|
| Canada | 167 | 274,616,911 |
| United States | 167 | 401,643,083 |
| Australia | 167 | 107,505,041 |
| New Zealand | 167 | 46,112,182 |

The source's latest available hour was 12:00 UTC at verification; the remaining portion of the rolling week had not yet been published by the provider. Ongoing collection continues every five minutes. No test notifications were sent.

Production preview: [wind-archive-2026-10-24.png](wind-archive-2026-10-24.png).


## Historical high-wind selection and campaigns — October 24 follow-up

Production: `dpl_6A9WUzf4snRayGm33vj26b6k111T`, built from `/tmp/wolfgrid-wind-campaign-release`, promoted to wolfgrid.app.

The Wind history panel now opens as **Historical wind storms**, defaulting to a gust threshold of 93.341952 km/h (58 mph, displayed as 93 km/h). Presets: 40, 60, 93, 120 and 160 km/h. This is a user-selected filter, not a universal official warning threshold. Only native values meeting the chosen threshold are shaded. Overview rendering preserves isolated high-wind cells; native cells remain the source for selection. Country selectors represent the existing regional bounding boxes, including nearby water/land, rather than administrative clipping.

Existing immutable bundles were retained. All 674 existing archive records were indexed in their existing metadata JSON with maximumGustKPH. Future collector runs compute this during collection. The hour menu excludes indexed hours without qualifying values. A high-wind hour is not a distinct named storm: one system can span multiple hours. At validation, the archive had 167 unique hours per country; qualifying 93 km/h hours were CA 142, US 167, AU 18, NZ 13 across the regional coverage rectangles.

Tap a qualifying area to select its four-neighbour connected native grid cells across tile seams. Stronger winds are included by default; an optional band filter excludes stronger colour bands. Holes and disconnected pockets remain separate. The black boundary follows native Mercator cell edges without interpolation. Selection fails explicitly at missing data/coverage edges, the date line, overly complex geometry, or areas exceeding 5,000 km²; it never silently clips to the screen. Cell size varies by latitude (the verified Manitoba example was approximately 2.6 km).

Save wind territory → existing campaign actions. Canada/USA support the existing address scan and partition flow, plus area campaigns. Australia/New Zealand use area campaigns because automatic address campaigns currently support CA/US. Archived numerical evidence is retained in gustSelection with country, exact UTC hour, click, threshold, band and method. Territory saving recomputes the boundary on the server from the stored frame and rejects altered outlines. Archived wind boundaries cannot be reshaped through territory PATCH while retaining the wind claim. Names remain editable. Saved lists, overlays and campaign summaries display wind ranges and hour. Reopen storm evidence restores the country, date/hour and threshold.

No database schema, RPC, index, new provider or paid data purchase was required. Evidence remains an estimated regional wind exposure, not confirmed property damage.

Validation:
- Focused wind contour tests: disconnected cells, holes, stronger-wind inclusion, native tile seams, unsupported ranges, calm points and strict campaign evidence validation.
- Wind rendering tests: below-threshold transparency and isolated high-wind cells preserved through all overview zooms.
- Existing Storm Maps six-suite regression passed; focused ESLint passed. Whole-repository TypeScript still reports pre-existing errors elsewhere, with no diagnostics in the changed implementation files.
- Production builds succeeded. Signed-in Chrome on wolfgrid.app: selected a real 93+ km/h Manitoba area for 2026-10-24 12:00 UTC (1,225.5 km²), saved it, created an area campaign, verified the boundary and ready status in the database, and reopened its wind evidence from the campaign summary.
- Temporary QA campaign `7a832033-9e76-48e5-846c-f312ebb07b03` and territory `38b550cf-2ab4-49f1-9031-e7016a4e033c` were removed after verification, with exact ID/name/evidence checks. No user-created records were deleted.
- Australia on October 24 showed only the single qualifying 09:00 UTC hour at 93 km/h, demonstrating that quieter hours are excluded.
- Verification snapshot: `wind-campaign-verification-2026-10-24.json`; campaign screenshot: `wind-campaign-proof-2026-10-24.png` (temporary QA campaign, removed after verification).

Native iOS/Android binaries were not rebuilt or physically tested for this follow-up. The shared Storm Maps web flow is implemented; browser verification was desktop Chrome. Automatic address campaign creation from wind was not separately exercised against a populated territory; it reuses the existing hail territory planner/actions, covered by the regression suite. Live end-to-end verification used the area campaign path.
