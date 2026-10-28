# Farms and weekday door plans

Implemented locally, 2026-10-27. Not deployed and the database migration has not been applied by this change.

- Farm is a button beside Storm in campaign creation, not a sidebar tab. It opens an embedded farm flow without leaving campaign creation. An existing drawn polygon and campaign name carry into the flow. Campaign returns to the unchanged campaign draft; Saved farms opens the farm list. Farms retain their existing workspace access rules and Contacts tab.
- Creation draws one saved boundary, counts available address records, takes a start date and doors-per-day target, imports farm addresses, and saves a weekday plan.
- Large imports scan native Canada/U.S. address tiles directly into farm addresses. They bypass the 1,000-home campaign provisioner. They still have the existing spatial scan safeguards (5,000 km² boundary validation, tile budgets and region/time limits). Available addresses are not a verified occupied-home inventory. Imports fail if a required region fails rather than reporting partial data as complete.
- Imports retain existing address IDs and visit fields. Address synchronization from the linked campaign is additive and does not delete imported homes/history.
- Weekday allocation uses stable street and numeric house-number ordering. Every eligible address is assigned once; weekends and do-not-knock homes are excluded. This is not walking-route optimization.
- A saved plan stores the exact daily farm-address IDs in `farms.door_plan`. Settings edits and previews leave the saved plan unchanged until saved. Refreshing homes flags unassigned or missing addresses instead of silently changing assignments.
- Daily lists allow adding contacts through the existing farm-linked contact dialog. The whole schedule can be exported as CSV.
- The Plan tab now opens with the compact touchpoint editor and progress graph described in `2026-10-27-touchpoint-plan.md`; weekday assignments remain under “Daily door assignments”. Phone layouts show the farm list separately from detail/create views.

## Release prerequisite

Apply `supabase/migrations/20261027190000_farm_door_plan.sql` before releasing this web code. It adds a nullable JSONB column under the existing farm RLS policies; existing farms do not need a backfill. New plan APIs check authentication and farm/workspace access before reading or writing. No live farm/contact records were created during verification.

## Validation

- `npx tsx lib/farms/__tests__/door-plan.test.ts`: passed; 12,003-home exact coverage, unique assignments, stable ordering, weekends, duplicate inputs, partial final days, do-not-knock exclusions, invalid capacities/dates, empty farms.
- `node scripts/test-farm-planner-browser.cjs`: passed with an isolated browser fixture using the actual component and allocation function, mocked HTTP persistence and supplied homes. Preview/save/reload, daily contact callback, no page errors, desktop and 390px phone widths. This does not verify live database persistence or real address data.
- ESLint on changed feature files: no errors; three pre-existing warnings in the farm detail/create flow (image optimization/map effect dependencies).
- Repository TypeScript check: fails in unrelated integrations/storm/recording areas; no diagnostics reported for changed farm files.
- Diff whitespace check: passed.

Still to verify after migration/deployment: sign in, draw a large real area, confirm the imported count against available native address coverage, save/reopen a plan from another authorized browser, create a contact from a daily list, and check workspace isolation. Existing campaign-backed field sessions are unchanged; the daily plan supplies address lists rather than creating one campaign/session per day.
