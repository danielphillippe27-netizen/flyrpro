# Existing wind campaign map loading repair

Affected campaign: `dfbc2e18-5f5a-4307-b083-059473e6c53f`.

Browser console showed `Error: Style is not done loading` from `StormTerritoryOverlay`, specifically its initial clear call using `map.getStyle()` before readiness was checked. A newly created campaign could therefore reach the campaign error boundary even though its record and provisioned addresses existed.

The overlay now checks map readiness before drawing, does not serialize a loading style just to clear its layers, and tolerates layer/source removal after a parent basemap reset or disposal. It retries drawing on style-load/idle. Disabling the overlay during loading also clears any retained layer when the map becomes ready.

A focused regression mounts both null and real wind territories while getStyle throws until ready, triggers an early style.load, verifies later idle drawing, swaps basemaps, disables during loading, and disposes the map. It passes, along with the existing Storm Maps regression suite and focused lint.

Read-only database verification found the campaign and wind evidence intact, with 1,011 campaign-address rows. No campaign data was edited, recreated or deleted. The earlier storm UI displayed an estimate of 378 mapped pins. This repair does not alter address provisioning or investigate the difference between that estimate and the stored address-row count.

Live verification will reopen this same existing campaign after the single-file deployment, without creating another campaign.

Published production deployment: `dpl_9nDWWmNRmSdU6CDkmBtnxxdp9GNq`, after successful build. Only the storm overlay runtime file changed. The focused loading/style/disposal regression is also included in the standard Storm Maps test command in the workspace.

Live verification reloaded the same existing campaign on the new build. The campaign page loaded its storm evidence, 1,011 address total, tabs and interactive map with the wind territory outline enabled. The previous campaign error screen is gone. Screenshot: `wind-campaign-load-repaired-2026-10-24.png`. Earlier browser errors remain in the tab log from the old deployment; the repaired page rendered successfully on `dpl_9nDWWmNRmSdU6CDkmBtnxxdp9GNq`. No replacement campaign was created.
