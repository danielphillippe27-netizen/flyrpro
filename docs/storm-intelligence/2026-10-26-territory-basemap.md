# Clear basemap after saving a territory — October 26, 2026

Saving or selecting a storm territory now hides the weather imagery and temporary selection graphics. The saved geometry remains as a light-purple fill (`#a78bfa`, opacity `0.1`) with a black boundary and white casing, leaving streets and building detail readable. The saved polygon itself is unchanged.

The standalone shared iOS/web workbench provides a territory-display state to hail selection, historical severity/report graphics, archived wind imagery, and wind selection. Saved-territory mode clears the weather layers requested by MapsGL as well as the archived wind raster. Temporary selection contours and markers are removed, and map taps stop selecting new weather zones while users draw campaigns. Existing zone details, campaign controls, and the 4,000-home policy remain available. Selecting another storm restores weather-selection mode.

Verification:

- Mobile session, wind interaction, large-territory and existing Storm Maps suites passed.
- Wind regression explicitly confirms saving hides the raster and temporary outline, preserves campaign controls, and prevents drawing taps from selecting another gust zone.
- Overlay regression checks the new fill colour/opacity alongside readiness, style-switch recovery, boundary retention and disposal.
- Real-provider phone-sized browser check loaded actual hail imagery, sampled a real zone, saved it through a fixture API, and verified the resulting clear map visually using a real Mapbox basemap. The screenshot is `TestArtifacts/storms-2026-10-26/wolfgrid-mobile-saved-territory-clear.png` in the sibling iOS project. No production territory or campaign was created by this test.
- Focused ESLint passed. Repository type diagnostics contained no changed runtime-file errors.

Release is staged from the exact preceding production source (`dpl_3uRVcoA77xqavgXYbqQBZTvJvZBR`) with six runtime source edits and one new display context. Deployment status is recorded after verification below.

Deployment `dpl_BCAwd7GdSidh1REvLpjychJqwKua` built successfully, returned HTTP 200 with the Storms bootstrap on its staged URL, and was promoted to `wolfgrid.app`. The production alias was independently confirmed READY. Reopening Storms on iOS loads the shared display change; no native binary update is required.

The real-weather browser check also passed against the live production page: actual provider authentication, four hail imagery responses, real numerical zone sampling, and fixture territory saving followed by the clear basemap and saved outline. The production screenshot replaced the local evidence screenshot above. The deployment-specific error scan returned no logs during the initial check.
