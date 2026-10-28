# Drawn campaigns use the drawing — October 26, 2026

While drawing inside a saved storm territory, the campaign action now belongs to the drawn polygon. The full storm territory remains a reference overlay. Its campaign controls and whole-territory count are hidden from the drawing panel.

The drawing panel shows **Addresses in drawn campaign** and **Create campaign**. Creating automatically saves the drawing as a separate inspection area, plans its addresses, creates the campaign from that boundary, and provisions its homes. Saving the drawing does not replace the selected parent overlay. No empty area-campaign alternative is shown in this flow. The existing over-4,000-home policy still applies to the drawing itself.

Verification passed with a 6,446-home parent territory and a 12-address drawn area. The real-basemap phone-sized touch test verified one campaign action, the absence of the parent count, planning against the drawing's saved ID, and the campaign POST boundary matching the drawing rather than the parent. Injected provisioning failure/retry reused the drawing and created only one campaign. API responses were fixtures; no production campaign was created by the test.

Existing mobile session/wind, large-territory, Storm Maps and boundary/overlay suites passed. Focused ESLint passed. No changed runtime file appeared in the repository type diagnostics.

The release uses production source `dpl_BCAwd7GdSidh1REvLpjychJqwKua` plus four runtime edits. The visual evidence is retained as `TestArtifacts/storms-2026-10-26/drawn-campaign-only.png` in the sibling iOS project.

Deployment `dpl_CwxuVPTNM8eT8HhFLe2SqCYHe8J3` built successfully, served the mobile Storms bootstrap with HTTP 200 on its staged URL, and was promoted to `wolfgrid.app`. The production alias was independently confirmed READY. Reopening Storms on iOS loads the change without a native binary update.

The 6,446-parent/12-drawn-address browser regression also passed against the live production page, including the captured smaller boundary, drawn-area planning ID, and provisioning retry. Those APIs were intercepted fixtures; no production campaign records were created. The initial deployment error scan returned no logs.
