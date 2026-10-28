# Direct campaign creation from selected wind areas

A selected wind area previously showed only Save wind territory. Campaign actions appeared after a separate save. It now shows Create campaign and Create area campaign immediately for Canada/U.S. selections. Australia shows Create area campaign. Save wind territory remains a secondary action.

The primary action automatically saves the validated source boundary/context before using the existing campaign planner, campaign creation and address provisioning. The area action also saves first, then uses the existing area-only campaign path. No campaign is created before the territory save succeeds. Retries retain the prepared territory and any existing campaign batch state; repeated creation clicks are locked. Names and actions are disabled during work.

The same component handles desktop navigation and the native iOS campaign callback. Existing hail callers continue to supply a saved territory and keep their existing flow. No backend or database schema change.

Verification includes direct creation before manual save, authenticated native requests, simulated first-plan failure followed by retry without an extra territory, address provisioning, area campaign context, native campaign handoff, desktop navigation, and a repeated-click check. Storm Maps regression suites and focused lint passed. Whole-repository TypeScript errors are unrelated to changed files.

No real production campaign was created by this corrective implementation test. Live verification checks the new actions on a real selected wind area after deployment.

Production deployment: `dpl_3HwD7w6gdXazc2oHutQiHE7HsVUo`, published at wolfgrid.app after a successful Next production build. Both runtime files byte-match the isolated release; focused lint passed, and no changed-file TypeScript diagnostics were found. Runtime error/fatal scan returned no entries.

Live signed-in production verification loaded the new build and October 18 02:00 UTC U.S. wind map, selected the same connected 1,774.5 km² Montana gust area shown by the user, and observed 378 mapped address pins across ID/MT. Before any save, enabled Create campaign and Create area campaign buttons appeared above the secondary Save wind territory action. Screenshot: `direct-wind-campaign-2026-10-24.png`. No production territory/campaign was created by this check; the selected area and buttons remain open.
