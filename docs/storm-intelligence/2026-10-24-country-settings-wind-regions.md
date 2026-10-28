# Country in settings and named wind regions

Country is now the first field in Map settings on the shared web/iOS Storm Maps workspace. Only Type remains above the storm list. The country state is shared with the browser, written to the existing country URL parameter, and stored as an optional workspace-scoped browser preference. Explicit country links take priority when opening a map. New Zealand remains absent.

Wind hourly archives now retain a maximum estimated gust per administrative region, sampled from the same land-masked native grid used by the displayed country wind map. Region boundaries use the public-domain Natural Earth 1:50m `ne_50m_admin_1_states_provinces.geojson` file from nvkelso/natural-earth-vector. Only Canada, the United States and Australia are included (73 regions).

Daily rows name states/provinces/territories that reached the selected threshold in any saved hour that day. Opening a row still opens the strongest saved country-wide hour; the selected map names only regions reaching the threshold at that exact hour. Names are geographic labels for estimated wind exposure, not separate verified storm counts or measured damage tracks.

Original numeric archives are unchanged. `windRegionVersion: 1` and per-region maxima are added to existing metadata; no database schema change. The existing collector populates them for future hours, and existing saved supported-country hours are reindexed.

Validation: shared country-context/browser regression, threshold-specific region labels and stale-snapshot deduplication, native state-grid assignment test, storm/mobile regression suites, focused lint, and isolated production build. Live verification follows after promotion.

Saved-history verification: 514 supported-country bundles checked, representing 510 unique country/hour maps (170 per supported country). No pending region indexes and every qualifying daily row has at least one assigned region. Shared storm/mobile regression suites, focused lint, and native country/state pixel tests passed. Whole-project TypeScript diagnostics remain unrelated to the changed files.

Published on wolfgrid.app as `dpl_9oNdvGKqfHi6EucFrMyLpf4psF3t` (production build READY). Country changes also recenter the map to that country's saved coverage. All 12 runtime source files match the isolated release.

Live browser verification observed the Type-only list header, state names on all U.S. daily entries, Montana on the selected October 18 02:00 UTC map, Country as the first Map settings field, and country/type changes through the real settings panel. Canada→United States and Hail→Wind routes update the country/type URL and source correctly. No physical iPhone interaction was performed in this task; iOS consumes the same page/API and its session/campaign regression suites passed.

Final-release live check also switched United States→Australia→United States in settings. The map centred on Australia at 133.5°E, 28.34°S and returned to U.S. coverage; Type remained Wind and daily region labels updated. Final proof: `country-first-in-settings-2026-10-24.png` and `type-only-wind-state-list-2026-10-24.png`. Runtime error/fatal scan returned no entries.
