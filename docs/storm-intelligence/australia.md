# Australian storm archive and daily updates

Updated October 24, 2026. Open `/storms?region=au` or choose **Australia** in Find storm.

## Collection and retention

The existing Xweather MapsGL account supplies the `hail-threats-nowcast` vector product. Its published timeline provides approximately seven days of frames. The server collector runs every five minutes, checks which available frames are not yet archived, and saves up to 90 frames per run, newest first. This also catches frames published between checks and retries missing frames while they remain available from the provider.

Australian features are identified from provider time-zone metadata, including the mainland, Tasmania and the listed external-territory zones. Global source data is filtered before retention. The archive stores provider hail-threat identities and timestamps, estimated hail size, the issued centroid, immutable snapshots, and compressed Australian source features in the existing `storm-archive` bucket. Raw map geometry is simplified zoom-zero display geometry; it is not a verified impact polygon or address boundary.

Records persist after the provider's seven-day window expires. Raw snapshots include provider-labeled forecast periods, but the browsable marker uses only the issued/current centroid. Forecast points are never counted as ground reports. A provider may issue multiple threat identities for one physical storm, so counts are **hail-threat records**, not a count of distinct physical storms.

`storm_collection_runs` records each completed frame only after its events, snapshots and raw source data are durable. Failed frames remain retryable. Collection and digest health distinguish a complete retrieved 24-hour window, partial backfill, stale data and failed collection. None of these conditions establishes that every actual Australian storm was detected.

## Nationwide history

The Australian panel includes a date-filtered nationwide saved hail-threat list, pagination, and an estimated-size filter. The default is 20 mm+; all sizes are retained and can be selected. Clicking a record opens its location and time on the existing storm map. Saved detections can be browsed beyond seven days as the permanent archive grows; the provider's hail-size map shading still has its original rolling seven-day limit.

The authenticated, workspace-checked route is `/api/storm-maps/intelligence/australia`. It reads the archive rather than issuing point queries across the country. No schema migration or Australian automatic address counting was added.

Historical backfill is limited to frames the provider still exposes. The Bureau of Meteorology's older report download returned HTTP 403 during this work, so an older nationwide ground-report archive is not connected. Stored modeled threats must not be presented as equivalent to verified BOM reports or roof damage.

## Daily text

The existing enabled daily SMS subscription remains at 9 a.m. America/Toronto. Its existing recipient and duplicate-send protection are unchanged. The digest now includes Australian saved hail-threat records and the largest returned estimate in millimetres, alongside U.S. hail and global tropical-cyclone advisories. It labels the Australian data as modeled and links to the Australian map. Partial or unavailable data is explicitly identified.

A production `force=1&preview=1` request returned a valid combined preview without sending a test SMS or creating a send claim. The preview contained 1,715 Australian hail-threat records and a largest estimate of 41.2 mm for that retrieval window. Those values are time-specific, not fixed test expectations.

## Verification

- Australian format/archive and digest tests passed: country filtering, provider identity deduplication, forecast separation, nonzero selection timelines, invalid-frame retries, backfill limits, partial/unavailable digest labels and Toronto daylight-saving scheduling.
- Existing storm-map suites and focused ESLint passed. Whole-project type checking has pre-existing unrelated errors; the changed Australian files produced no diagnostics.
- A real five-minute production scheduler run completed at 12:20 UTC on October 24, saving 90 frames with zero failed frames.
- Authenticated production displayed the saved Australian list and opened a saved detection on the map.

Builds were prepared from the previously deployed source with only the Australia archive, digest, parser dependencies and scheduler changes. An accidental build from the dirty working checkout was cancelled before promotion; it did not replace the live site.

## Completed rollout

Production deployment: `dpl_2GS66vBiSnMMEBPcnbqgh1Z43F4B`, promoted to `wolfgrid.app` on October 24, 2026. The seven-day backfill finished at approximately 12:27 UTC with zero failed frames and zero remaining available frames. At verification, 10,648 Australian threat records were retained, with the earliest issued timestamp `2026-10-17T12:22:04Z`, across 58 compressed raw archive batches. These are provider threat records, not 10,648 distinct physical storms.

The production scheduler completed automatic runs at 12:20 and 12:25 UTC. The subscribed daily update remains enabled at 9 a.m. Toronto. Authenticated browser verification confirmed the nationwide list, exact count/pagination response, 40 mm+ size filtering and opening the 41.2 mm record near Port Augusta on the historical map. No test SMS was sent. Screenshot: `/tmp/wolfgrid-australia-archive-production.png`.
