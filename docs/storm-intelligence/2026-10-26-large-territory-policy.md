# Large storm territories — October 26, 2026

Areas with more than 4,000 mapped homes now use **Create storm territory**. They remain saved overlays while the user draws a smaller campaign. Exactly 4,000 homes still permits the existing campaign creation flow, with each campaign capped at 1,000 addresses.

The shared iOS/web workbench uses this rule for saved hail/wind territories, newly selected hail/wind zones, and manually drawn territories. An already saved territory is reused. Selecting the large-area action keeps the saved boundary visible and starts the existing drawing flow. The UI explains: “Use this storm territory as an overlay, then draw a smaller area to create a campaign.”

The campaign planning API independently counts unique address identities inside the boundary using the native-resolution scan. Above 4,000 it returns `territoryOnly: true` and no campaign parts. The client switches to the territory workflow before issuing any campaign creation or provisioning requests. This also handles unavailable or underestimated display counts. Counts and campaign actions share the same short-lived, workspace-and-boundary-scoped scan, with cancellation when no consumers remain.

## Verification

- New regression suite: exactly 4,000; 4,001; the user's 6,446 example; already saved and unsaved territories; double-click protection; overlay/drawing handoff; server-authoritative fallback; and one shared count request for count display plus actions. Passed.
- Existing mobile session/wind tests, all eight Storm Maps suites, and campaign partition tests passed.
- Phone-sized touch browser tests passed for both the original smaller address-campaign workflow (including provisioning failure/retry) and the 6,446-home territory workflow. Large-area tests issued no campaign planning, creation, or provisioning requests.
- Real Mapbox basemap check visually confirmed the saved territory outline remains present after entering drawing mode. Screenshots are retained in the sibling iOS project's `TestArtifacts/storms-2026-10-26/` folder.
- Focused ESLint passed. Repository-wide type checking has existing unrelated diagnostics; the initial new-test JSDOM declaration errors were repaired using the repository's constructor typing pattern. No changed runtime file appeared in those diagnostics.

Production release preparation used deployment `dpl_CEi7KVmGDuFHwKPthkmsdUixcXyE` as the verified source baseline. Every other runtime source matched that deployment's source hash. Production status is recorded after verification below.

## Production

Deployment `dpl_3uRVcoA77xqavgXYbqQBZTvJvZBR` built successfully, returned HTTP 200 with the mobile Storms bootstrap on its staged URL, and was promoted to `wolfgrid.app`. The production alias was independently confirmed READY on that deployment.

The touch browser regression passed against the live `https://wolfgrid.app/mobile/storms` page using a real Mapbox basemap and fixture territory/count APIs for the 6,446-home example. It confirmed the new label, guidance, saved overlay/drawing handoff, and zero campaign planning, creation, or provisioning requests. This check did not create any production records. Close and reopen Storms on iOS to load the updated shared page; no new native binary is required for this policy.
