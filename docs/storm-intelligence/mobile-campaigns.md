# Mobile storm campaigns

Implemented October 22, 2026. Changes are local; no production deployment or store submission was performed.

## User flow

- iOS and Android Settings → Campaign Maps → Storms. The preference persists on the device and defaults off.
- Campaign creation shows a Storms button directly below the fourth map control (map/satellite).
- The button opens an in-app storm page, using the native session, current workspace, and map location.
- The page uses the same StormMapWorkspace and StormMapsControl components as web. Recent hail storms appear first on phones; filters are expandable. The existing default hail threshold is 1 inch, with other sizes available in filters.
- Select an event, tap a verified hail polygon or use the web numerical hail selector, or draw a custom inspection area. Existing storm-source and geometry restrictions apply.
- Save the territory, then create address campaigns using the existing up-to-1,000-address partitioning flow, or choose **Create area campaign** to retain one boundary without a home scan.
- Successful creation hands the campaign ID back to the normal native campaign map.

## Shared API behavior

`POST /api/campaigns` accepts `area_only: true` only with a valid saved storm territory. It keeps normal workspace access and campaign allowance checks, validates the connected polygon, and writes `storm_context.campaignMode = "area"` into the existing JSON context. It marks the boundary map ready without claiming that homes were loaded. No database migration is required.

Area campaigns retain the existing maximum 5,000 km², non-crossing Polygon constraint. Disconnected MultiPolygon territories can still be saved as storm territories and split into address campaigns; they cannot be inserted into the existing Polygon-only campaign column as one area campaign.

The map-bundle endpoint returns a ready, empty feature bundle for an area campaign even without a home-data snapshot. The provisioning endpoint refuses to start a home scan for area campaigns. Normal campaigns retain the existing creation and provisioning behavior.

## Session handling

The native page is restricted to `/mobile/storms` on the configured HTTPS backend origin. Access tokens enter the page in memory and are attached only to same-origin Storms settings, manifest and intelligence APIs and the campaign creation/provision endpoints. MapsGL requests retain their separate provider credentials: they use a short-lived, signed weather-only capability from the manifest, without relying on web cookies or receiving the native account token. Weather-service 401 responses do not display an app-session-expired warning. They are not put in URLs, cookies, or browser storage; refresh tokens stay native. Requests omit web-account cookies, pin the storm workspace, reject redirects, preserve cancellation, and buffer JSON bodies for WebView compatibility. Expired sessions can reconnect without discarding the selected map state. Workspace changes close the native page.

## Verification

- iOS simulator build: passed, WolfGrid Debug, generic iOS Simulator, signing disabled.
- Android: `:app:compileProductionDebugKotlin --offline` passed using the already-installed SDK at `/opt/homebrew/share/android-commandlinetools`.
- `npm run test:storm-maps`: passed all existing storm suites.
- `npm run test:mobile-storms`: passed API credential scope, workspace, method/body/cancellation, token refresh, large-area map readiness, and source-evidence validation checks.
- `npm run test:mobile-storms-browser`: passed at 390×844 with fixture APIs: recent hail selection, tapping its verified polygon, drawing and saving a custom boundary, creating an area campaign, exact request body/workspace/authentication, and no home-provision request. No browser JavaScript errors. Start the web dev server on port 3028 first. This test uses Chrome, synthetic storm data, and a dummy token; it does not write to production.
- Changed React files pass targeted ESLint. The whole repository typecheck still reports existing errors in unrelated integration/demo code and pre-existing storm test typings; no new storm implementation errors were reported.

Live storm-provider data, production database writes, and the native-to-web-to-native flow on signed-in physical devices have not been verified. The web/API changes were deployed to wolfgrid.app on October 22, 2026 (deployment dpl_FG9ZZn4zH9j3TnFBJsMbJiHWXNdm), fixing the mobile page returning HTTP 404. The live route now returns HTTP 200; phone-sized fixture tests against the deployed bundle passed, including selecting a 76.2 mm zone and displaying 3.00″+. Both platforms still need a signed-in physical-device check with an entitled workspace. The Settings toggle shows the feature; it does not purchase or enable a workspace billing add-on.

## Simplified native screen

The native campaign entry shows only Find storm, Saved storms and Map settings. Layer rail, legends, playback/timeline, fullscreen, location and zoom controls are omitted; map attribution remains inline. The selection panel retains drawing, numerical hail-zone selection and campaign creation. Recent discovery defaults to all available coverage and the last seven days, with all reported hail sizes. Filters still allow older dates; reports outside the recent MapsGL archive may have no coloured hail imagery. Desktop Storms retains its controls.

The read-only `scripts/test-mobile-storms-weather.ts` check uses real IEM reports and real MapsGL authentication/imagery, with only app account APIs mocked. `scripts/test-mobile-storms-browser.cjs` separately verifies control removal, nationwide query bounds, provider/native credential separation, drawing, zone selection and campaign handoff.

Simplified native screen released as `dpl_6nPksVtqExtZ1Z7qVtbLJ7fFNuPv`. The production alias and fixture campaign flow passed. A staged test against the same deployment used real MapsGL imagery for the October 21 Arizona event and selected a numerical hail area (clicked estimate 48.6 mm / 1.9 inches). Account APIs were fixtures; no production campaigns were created. Signed-in physical-device verification remains user-side.
