# Wind map country and overview correction — 2026-10-24

The original country archive retained complete z4 weather tiles and only constrained sampling/indexing to rectangular regional bounds. Display pixels outside those rectangles remained visible, including neighbouring countries and offshore weather. Threshold overviews also used max pooling, expanding small native high-gust cells into opaque larger blocks at lower zooms.

The correction applies a shared land mask to display rendering, point sampling, territory tracing, and the maximum-gust index used by recent daily rows. The mask comes from the public-domain Natural Earth 1:50m country polygons (`ne_50m_admin_0_countries.geojson`, upstream nvkelso/natural-earth-vector), projected into the same native 8192×8192 Mercator grid and sampled at cell centres. It is approximate at coastlines and borders at the existing native cell resolution. Original numeric archives are retained unchanged.

Overviews now use area-weighted resizing instead of opaque maximum pooling. A new raster URL version avoids reusing previously cached display tiles. Native cell positions, source hours, thresholds and gust decoding remain unchanged. Very small areas may be faint or disappear at world zoom; zoom in to inspect native cells.

Saved hours are reindexed with `windMaskVersion: 2`. The recent list excludes stale regional maxima until each hour is rechecked. Future collection produces masked display tiles and land-only maxima. New Zealand is omitted from both country selectors and new wind collection; existing saved records are retained.

This remains an estimated gust field, not measured damage geometry or a distinct storm-event catalogue. Broad inland wind regions can legitimately remain broad. Native-cell boundaries near coastlines can extend about half a cell beyond the polygon; there is no claim of parcel-level border accuracy.

Validation: regression suites for Storm Maps and native mobile session/campaign flow, raster footprint and country-location tests, connected-cell/holes/seam wind-zone tests, focused lint, production build and live browser checks. Full physical iPhone interaction is not verified unless separately recorded below.

## Live verification

Released to wolfgrid.app as deployment `dpl_7zauHfS6Vqc4wtWc2hrAAdULcd6X`. All nine runtime changes byte-match the isolated release folder. Production build completed successfully; focused lint and the Storm Maps/mobile regression suites passed. Whole-project TypeScript checking still reports unrelated existing diagnostics; none name changed wind files.

Reindexed 511 stored bundles (507 unique country/hour maps: 169 per supported country), including bootstrap duplicates. Verification found no pending supported-country rows. Numeric source bundles were preserved.

Signed-in production browser loaded the new deployment and an exact October 24 12:00 UTC Canadian wind evidence link. A tap on visible Manitoba shading returned an estimated 98 km/h gust and a connected 1,225.5 km² boundary at approximately 2.6 km native grid-cell spacing. Boundary displayed with a black outline; Save wind territory remained available. No new territory/campaign was created for this corrective verification. Server runtime error/fatal scan was empty.

iOS uses the same deployed page/API and mobile flow regression tests passed. Physical iPhone Mirroring reported the iPhone in use; the new release was not physically tapped through on the phone. Reopening Storm Maps loads the shared correction.
