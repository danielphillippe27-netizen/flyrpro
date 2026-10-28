# Historical hail and wind maps: Canada, United States, Australia and New Zealand

Research date: October 24, 2026, America/Toronto.

Subsequent implementation: Daniel selected the existing-provider approach—retain the available seven days and keep collecting new wind data. The permanent Xweather wind-gust archive is now live; see [launch and verification notes](2026-10-24-wind-archive.md). The research below remains the assessment for deeper historical footprint and campaign-targeting parity.

## Recommendation

Build a shared Hail / Wind experience with country-specific data adapters. Use public observations for supporting evidence and licensed numerical footprints for intensity selection, address exposure and long-term map history. Evaluate a HailTrace partner integration first for North America, The Weather Company for Canadian hail geometry, Weatherwatch for Australia, and MetService / Earth Sciences New Zealand for New Zealand.

The interface and campaign workflow are feasible. Equivalent historical coverage, meteorologist review and property reports across all four countries are not yet established. No single reviewed source demonstrates that complete package. Vendor coverage, redistribution terms, historical exports and pricing need written confirmation.

“Taylor Storms” is an unresolved product name. HailTrace is a provisional benchmark; Daniel has been asked to identify the intended product. This report does not claim a verified comparison with a product called Taylor Storms.

This is research and a source-code review. No application code, production configuration, database, subscriptions or provider contracts were changed. No provider was contacted. Existing production behavior and physical devices were not tested in this review.

## What WolfGrid already has

Current source, rather than earlier status documents, establishes:

- `lib/storm-maps/intelligence/model.ts` already supports hail, wind, tornado and hurricane hazards, and maximum reported wind speed.
- `intelligence/provider.ts` retrieves U.S. Local Storm Reports through Iowa Environmental Mesonet. `normalize.ts` groups those reports by UTC day and state; these are not individual physical storm identities. Wind damage reports can lack numeric gusts.
- `components/storm-maps/intelligence/StormDiscoveryPanel.tsx` already has a wind-speed filter. It also routes both hail and wind details through a hail-oriented selection block: wind can receive “Select hail zone” wording. Wind needs its own details, selector and evidence rules.
- `app/api/storm-maps/intelligence/events/route.ts` currently accepts a search range of up to 366 days and returns paginated slices. The older implementation-status document's 31-day limit is stale.
- Hail severity geometry, territory selection, address counting, campaign provenance and campaign review provide reusable foundations. Current severity fields and thresholds are hail-specific.
- Hurricane advisory wind areas are supported separately. Their wind thresholds must retain their sustained/advisory meaning; they are not thunderstorm peak-gust footprints.
- The Australian collector saves modeled Xweather hail-threat records and source snapshots. This supports a growing detection archive, not automatically a permanent archive of numerical hail-size surfaces.
- `country-collector.ts` archives Canadian, Australian and New Zealand warnings. It attempts Canadian historical hail ingestion and Australian hail/tornado report exports. It does not currently retrieve Australian wind report exports or provide New Zealand historical hail/wind footprints.

The implementation should extend the current system rather than add a disconnected wind map.

## What feature parity means

HailTrace publicly describes hail history from 2010, wind history from 2020, severe-wind maps beginning at 58 mph, multiple-date overlays, address history PDFs, asset alerts, canvassing and prospecting. Meteorologist-reviewed/certified reports are separate services. These are vendor statements, not accuracy independently established by this review. [HailTrace FAQ](https://hailtrace.com/faq)

Its documentation distinguishes U.S.-only algorithm hail maps from meteorologist hail maps with limited Canadian and Australian availability. It does not establish New Zealand coverage or matching wind coverage in those countries. [Map specifications](https://hailtrace.zohodesk.com/portal/en/kb/articles/the-power-of-meteorologist-algorithm-hail-maps)

| Capability to reproduce | WolfGrid implementation requirement |
|---|---|
| Hail and wind history | Search country, address, date range and intensity; expose available years and coverage |
| Colored intensity footprints | Numeric rasters or threshold polygons, with event time, units, resolution and provenance |
| Multiple storm dates | Independently styled overlays and property intersections; deduplicate addresses |
| Address history | Separate at-address modeled estimates, nearby reports and observed measurements |
| Campaign creation | Select a connected intensity area, review exclusions, count eligible addresses and create territory/campaign |
| Impact alerts | Match newly issued/revised footprints to watched assets; avoid duplicate alerts |
| Reports | Branded factual summaries; licensed or commissioned meteorologist review when requested |
| Mobile | Same source, thresholds and revisions on web, iOS and Android; test each actual interface |

HailTrace already documents integrations that deliver maps/history into other contractor and canvassing platforms. This makes a partner route credible, but does not prove WolfGrid can use an unrestricted API or resell its datasets. Some integrations differ in access to algorithm versus meteorologist maps. [Integration documentation](https://hailtrace.zohodesk.com/portal/en/kb/articles/5-0-how-to-set-up-one-way-hailtrace-integrations)

## Country assessment

### United States: strongest starting point

**Public foundation:** keep IEM for recent reports; evaluate direct NOAA SPC and NCEI bulk ingestion for deeper history and reconciliation. SPC publishes hail and damaging-wind reports back to 1955. Reporting practices and completeness vary over time. NCEI's reviewed page currently lists finalized data through June 2026, so recent provisional reports and finalized history need different update paths. [SPC data](https://origin-west-www-spc.woc.noaa.gov/wcm/index.html), [NCEI Storm Events](https://www.ncei.noaa.gov/access/storm-events-database/)

**Footprints:** investigate HailTrace partner access and Verisk Respond. Cotality Weather Verify is another candidate: it advertises hail/wind mapping and API connectivity, while its hail-specific documentation explicitly describes continental-U.S. coverage. Do not assume its other-country coverage from its global corporate presence. [Cotality Weather Verify](https://www.cotality.com/platforms/weather-verify), [hail product coverage](https://content.cotality.com/product-docs/claims-weather-hail-verify/)

**Build alternative:** historical radar analysis is technically possible, but adds ingestion, radar QC, surface-wind estimation, ground-truth reconciliation, meteorological validation and ongoing operations. NOAA explicitly warns that radar-derived severe-weather signatures represent probable conditions and absence of records does not prove absence of severe weather. This is a weather-analysis program, beyond a UI layer. [NOAA SWDI](https://www.ncei.noaa.gov/maps/swdi/)

**Recommendation:** first pilot a licensed U.S. hail and peak-gust footprint source, keeping public reports visible as evidence. Scope CONUS and other U.S. regions explicitly; do not treat “U.S.” as a guarantee of equal Alaska, Hawaii and territory coverage.

### Canada: observations available; full wind geometry unresolved

**Historical hail reports:** the Integrated Canadian Hail Database v1.1 covers 2005–2024. It includes crowd-sourced records and added METAR/SPECI hail/graupel observations. Its authors say entries were checked but not externally validated and warn against climatic-trend use. These are report locations, not hail polygons. [Dataset and caveats](https://zenodo.org/records/17517119)

**Fresh access check:** the published CSV returned HTTP 200 and a readable header on October 24. The current collector already targets this URL, so an earlier unavailable-download result may be recoverable. This check did not run the collector or establish that records are stored in production.

**Wind measurements:** ECCC historical station data is a useful foundation, including maximum-gust information where available. Station periods, missing values and variable availability must be respected. A station reading cannot establish the same gust at every nearby home. [ECCC historical data](https://climat.weather.gc.ca/historical_data/search_historic_data_e.html)

**Hail polygons:** The Weather Company's HailVision documents radar-derived MESH for CONUS and Canada, 1-km grids, and vector threshold geometry via `/v2/featurizer/feature`. This is a good technical fit for selectable hail zones. Its public documentation establishes current accumulation windows, not a multiyear backfill entitlement. Archive depth, numerical exports and commercial display/retention rights remain unconfirmed. [HailVision](https://developer.weather.com/docs/openapi/hailvision-2-0)

**Survey evidence:** Western's Canadian Severe Storms Laboratory researches hail, tornadoes, downbursts and derechos. Its public page directs commercial users to contact CSSL. Survey geometry can supplement events after permission and metadata review; it does not establish continuous national gust-speed coverage. [CSSL](https://www.uwo.ca/cssl/index.html)

**Commercial candidates:** ask HailTrace about its actual Canadian event inventory and both hail/wind availability. Ask Verisk for a hazard-by-country matrix: a Respond brochure discusses U.S./Canada, while an older technical presentation marks Canadian coverage specifically for hail and U.S. coverage for several other perils. The public material is insufficient to promise Canadian wind footprints. [Respond overview](https://integration.verisk.com/495f96/siteassets/media/downloads/property-estimating/respond.pdf), [technical coverage presentation](https://risksolutions.verisk.com/siteassets/Publications/Presentations/attachments/unwrapping-verisk-real-time-analytics-bundle.pdf)

**Recommendation:** pursue Canadian hail geometry and historical gust observations together, with Canadian convective-wind footprints as an explicit vendor qualification requirement.

### Australia: strong specialist hail option; wind product needs qualification

**Public evidence:** BOM's Severe Storms Archive has a wind search with maximum gust and CSV export controls. BOM also documents historical synoptic wind products and daily gust information. These are useful observed/reported points, not continuous property-level storm intensity. [BOM wind archive](https://www.bom.gov.au/australia/stormarchive/storm.php?advanced=1&stormType=wind), [historical wind products](https://www.bom.gov.au/climate/how/newproducts/IDChw.shtml)

**Fresh access check:** the wind archive HTML page returned HTTP 200, but a bounded 2020–2024 wind CSV export request returned HTTP 500. The export request requires investigation with BOM; the result does not establish zero events or a reliable integration. Existing collector failures must remain explicit.

**Commercial route:** Weatherwatch HailTracker advertises Australian hail maps, API integration and up to 30 years of history, dependent on radar. Its user guide documents archived wind and gust observations from December 2023. Its storm-intensity product identifies severe-thunderstorm potential for selected radars, which does not by itself establish a calibrated continuous peak-gust footprint. Ask specifically for numerical gust swaths, coverage and historical delivery. [HailTracker](https://www.weatherwatch.net.au/hailtracker), [observation archive guide](https://hailtracker.weatherwatch.net.au/help/HailTracker_User_Guide.pdf), [product updates](https://www.weatherwatch.net.au/hailtrackerupdates)

**Recommendation:** Weatherwatch is the leading Australian specialist candidate from this review. Preserve WolfGrid's existing Australian detection archive as a distinct evidence type. Obtain older licensed hail footprints and establish what form of wind data can actually be supplied.

BOM's data-services page says some free forecast/warning/observation products are not for commercial use and offers paid services. Check the terms for each chosen product; neither blanket commercial permission nor a blanket prohibition across all BOM datasets follows from that statement. [BOM data services](https://www.bom.gov.au/resources/data-services)

### New Zealand: history possible; detailed footprint parity unverified

**Station history:** Earth Sciences New Zealand's DataHub replaces CliFlo and provides National Climate Database access. The documented archive is about a month behind, with newer/realtime data available by request; commercial fees apply and the minimum download unit is a station/parameter history. This supports a licensed historical gust product, rather than an assumed free realtime footprint service. [DataHub access](https://data.niwa.co.nz/pages/clidb-on-datahub)

**Event discovery:** the Historic Weather Events Catalogue describes major events since the 1800s and exposes event XML. It helps find storms but is not a complete hail-size or gust-speed surface for every event. [Historic Weather Events](https://hwe.niwa.co.nz/)

**Radar and observations:** MetService makes specified observational products available for commercial use subject to terms, including three-hourly surface observations and hourly radar reflectivity images through SFTP. These public products do not establish access to a complete multiyear volumetric radar archive or ready-made hail/peak-gust footprints. [MetService open data](https://about.metservice.com/open-access-data)

**Recommendation:** obtain a MetService / Earth Sciences New Zealand proposal for historical observations, event-based reconstructions and any derived numerical hail/wind products. Launch station/event history first if a footprint supplier cannot be validated. No reviewed source established a nationwide historical New Zealand hail-and-wind footprint API equivalent to the provisional benchmark.

## How far the existing Xweather relationship gets us

Xweather is a useful shared layer, but current public documentation does not establish the complete desired archive:

- MapsGL has global wind-gust shading over a rolling seven-day past window. Historical dates and forecast dates must remain distinct, and available model/SDK support varies.
- MapsGL hail-size shading lists U.S., Europe, Japan and Australia over seven days. Its hail-threat product also lists Canada, but threats include nowcast/forecast information.
- The location Hail Archive lists U.S./Canada/Australia, not New Zealand; API docs date Canada/Australia availability from February 1, 2025. Queries use 24-hour increments and carry a documented 12x multiplier.
- Global station observations archive is documented from August 2, 2011, with actual station/date/variable availability varying.

These products can add recent gust context and address/station lookups. They do not establish rights or access to permanent, country-wide historical numerical gust swaths. Use written confirmation to resolve inconsistent archive dates in marketing versus API documentation. [MapsGL layers](https://www.xweather.com/docs/mapsgl/weather-layers), [Hail Archive API](https://www.xweather.com/docs/weather-api/endpoints/hail-archive), [Observations Archive API](https://www.xweather.com/docs/weather-api/endpoints/observations-archive)

## Implementation design

1. **Common controls:** Hail, Wind and Both; country/address search; date range; a coverage/years indicator; local event time with UTC retained. Preserve the full-height left sidebar and existing icon/settings behavior. Keep reports, warnings, estimates and surveyed evidence visually distinguishable.
2. **Wind definition:** use peak gust as the principal severe-wind metric. Also retain averaging duration, measurement height where known, native units and method. Keep sustained wind, gusts, damage-only reports and cyclone advisory areas separate. Never fill an unknown gust with zero or derive one from damage alone.
3. **Intensity filters:** use configurable numeric thresholds and country-appropriate units. A 58 mph filter is exactly 93.341952 km/h, with rounded display labels; do not silently substitute a country's warning criteria. Suggested extra thresholds are product filters, not universal damage thresholds.
4. **Shared footprint model:** add hazard, metric, minimum/maximum value, unit, observation/estimate status, provider event ID, revision, valid interval, retrieval time, resolution, coverage/no-data geometry, confidence/QC and license capability. Generalize hail-only zone and campaign fields through an additive migration plan; preserve existing hail campaign provenance.
5. **Durable archive:** when licensed, store immutable numerical grids and/or original vectors, checksums, revisions and a collection ledger. Store reusable display tiles separately. Replaying old storms must resolve the retained source revision, not depend on a rolling provider tile window.
6. **Wind selection:** implement a dedicated selector for connected gust-threshold polygons. Preserve holes and disconnected parts. If only reports exist, offer inspection-area drawing with reports-only provenance; do not manufacture a footprint by buffering points.
7. **Exposure:** intersect licensed intensity areas with versioned, licensed country address data. Count distinct eligible addresses, distinguish buildings/units, exclude do-not-knock and already-assigned properties as required, and show dataset incompleteness. A finer address coordinate does not improve a coarse weather grid's accuracy. An exposed address is an inspection candidate, not confirmed damage.
8. **Multi-event history and alerts:** retain separate event intensities, merge exposure without duplicate properties, and send asset alerts only for new or meaningfully revised intersections. A warning polygon alone must not trigger an “observed impact” claim.
9. **Reports and mobile:** build branded summaries from the same evidence model. Identify provider/method/date/units and separate nearby observations from at-address estimates. Certified or forensic reports require the corresponding provider/professional service. Verify web, iOS and Android against the same retained event revision.

## Delivery order and acceptance

| Stage | Deliverable | Exit criteria |
|---|---|---|
| 1: Provider qualification | Coverage matrix, sample events and written commercial terms | Hail and gust data independently demonstrated for each contracted geography; archive, API, storage and display scope explicit |
| 2: Shared experience | Hail/Wind/Both, gust details, reports, coverage and date handling | No hail-only controls on wind; no forecast shown as historical evidence; missing data explicit |
| 3: First footprint pilot | U.S. plus a Canadian market if qualified | Real historical event reopens after provider rolling window; numeric thresholds agree with source; independent address counts match |
| 4: Country expansion | Australian specialist adapter; NZ observation/event adapter and footprints where available | Country-specific sources, rights and completeness verified; no misleading parity claims |
| 5: Complete workflow | Multi-event overlays, watched assets, reports and campaign handoff | Duplicate-safe alerts, revised footprint handling, exclusions and mobile behavior verified |

Use multiple real event types for validation: U.S. convective wind/hail, Canadian derecho/downburst and hail, Australian hail/severe wind, New Zealand high wind/hail. Test no-data areas, cancelled warnings, gusts without measurements, radar outages, changing provider revisions, geometry holes and disconnected zones. Test New Zealand's date-line geography and local storm-day boundaries, including daylight-saving changes.

Cost and schedule cannot be quoted responsibly before provider samples and license scope. Ask for setup/backfill fees, recurring license, API multipliers, map loads, per-seat/BYOK costs, exports/reports, minimum commitments and redistribution charges. Consumer map subscription pricing is not an embedded commercial data license. Estimate engineering after the first data sample proves its geometry and retention behavior.

## Provider qualification brief

Request, separately for CA, US, AU and NZ:

- Available hail-size and peak-gust products, actual geographic coverage/no-data masks, start dates, update latency and historical event inventory.
- Observed versus radar-derived versus model-derived status; gust duration/height; spatial resolution; QC and meteorologist review.
- Numerical raster or vector exports, event identifiers/revisions, date/location search, webhook/bulk/backfill access and supported tile formats.
- Rights for WolfGrid web/iOS/Android customer display, multi-tenant access, paid resale, permanent retention, derived polygons, address intersections, campaign generation, alerts and downloadable reports.
- Sample convective wind and hail events, including one older than the rolling map archive. Confirm Canadian wind and New Zealand footprints explicitly.
- Attribution requirements, service levels, country limitations, pricing and any use restrictions affecting contractor prospecting.

The immediate decision is a data-source pilot. A global gust shading layer can improve the maps quickly, but full historical intensity selection and campaign targeting require the numerical footprint and rights work above.
