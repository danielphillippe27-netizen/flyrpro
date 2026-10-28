# Wind campaign address visibility

Campaign: `dfbc2e18-5f5a-4307-b083-059473e6c53f`.

The existing campaign bundle contains 1,011 point addresses with valid coordinates across western Montana and 892 building features. The live screenshot's camera was at zoom 7.91. Local address rendering previously had only 2.6-meter-radius cylinders with a minimum zoom of 10, and house-number labels starting at zoom 16. Consequently all addresses disappeared at the reported camera position; even above zoom 10 the cylinders were too small to see across a large storm territory.

`CampaignAddressPmtilesLayer` now draws point markers at overview zooms, fading them into the existing cylinders between zooms 14 and 16. The markers share address status colors and IDs, open the existing address card, exclude deleted addresses, and are removed when switching away from Addresses. The local marker refresh explicitly retains a Point filter. Vector-tile address rendering already had point markers and is unchanged.

Focused regression: `npx tsx lib/map/__tests__/campaignAddressOverview.test.tsx` covers regional visibility, street-level transition, address clicks, deletion, and layer/listener cleanup. Focused lint passes for both the changed runtime component and regression. No campaign or address records were edited. The count/estimate mismatch recorded in the previous loading-repair note remains separate from marker visibility.

The production release changes only the address-layer runtime file in the existing composite release folder.

Whole-repository type checking still reports the same 81 lines of pre-existing diagnostics seen before this change. Neither the changed runtime component nor the new regression has a type diagnostic. Focused lint and the regression pass.

Published deployment: `dpl_6Ny4keqh6z44rQ6YcT7LrCM1zKx4` (`flyrpro-2w4mdp5bm-danielphillippe27-netizens-projects.vercel.app`), promoted after READY.

Live browser verification confirmed the promoted build via its script deployment ID, reopened the existing campaign, selected Addresses, zoomed out to 7.65 (below the old minimum of 10), and disabled the storm shading to match the reported view. Address dots remained plainly visible. Clicking an isolated dot opened the existing location card; that particular record shows Address pending, consistent with unresolved records in the bundle. No address data was edited. Closed the card and left the repaired campaign open. Evidence screenshot: `wind-campaign-homes-visible-2026-10-24.png`.
