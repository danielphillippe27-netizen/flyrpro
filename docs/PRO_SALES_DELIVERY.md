# Pro Sales delivery tracker

Authoritative scope: [complete supplied specification](PRO_SALES_REQUIREMENTS.md), plus the earlier Sales requirements where consistent. The latest brief takes precedence for performance-first Home and restrained gamification. Section 38 is truncated in the supplied file; clarification is pending.

Completion means implemented on public web and public iOS, with shared authorized backend behavior, meaningful regression coverage, client flow verification, and explicitly recorded release state. No percentage or passing subset substitutes for the full requirements.

## Implementation order

1. Shared sale lifecycle, financial ledger, attribution, historical credit, permissions and duplicate handling.
2. Shared reporting, date boundaries, goals, funnel drilldowns, forecasting, pipeline/losses, exports and integrations.
3. Web manager experience and fast Mark as Sold entry points.
4. Public iOS rep experience, performance-first Home, maps and record entry points.
5. Notifications, realtime updates, industry terminology and intelligence integration.
6. Requirement-by-requirement data, UI, security, performance and release acceptance.

## Requirement coverage

| Section | Requirement | Status | Completion evidence required |
|---|---|---|---|
| 1 | Core Sales Object | In progress | Backend + web + iOS behavior and relevant verification |
| 2 | Sales Pipeline | In progress | Backend + web + iOS behavior and relevant verification |
| 3 | Mark As Sold | In progress | Backend + web + iOS behavior and relevant verification |
| 4 | Revenue Definitions | In progress | Backend + web + iOS behavior and relevant verification |
| 5 | Attribution Engine | In progress | Backend + web + iOS behavior and relevant verification |
| 6 | Setter/Closer Model | In progress | Backend + web + iOS behavior and relevant verification |
| 7 | Attribution Rules | In progress | Backend + web + iOS behavior and relevant verification |
| 8 | Rep Home Screen | In progress | Backend + web + iOS behavior and relevant verification |
| 9 | Manager Dashboard | In progress | Backend + web + iOS behavior and relevant verification |
| 10 | Full Funnel Dashboard | In progress | Backend + web + iOS behavior and relevant verification |
| 11 | Rep Performance Dashboard | In progress | Backend + web + iOS behavior and relevant verification |
| 12 | Leaderboards | In progress | Backend + web + iOS behavior and relevant verification |
| 13 | Sales Leaderboard | In progress | Backend + web + iOS behavior and relevant verification |
| 14 | Campaign Roi | In progress | Backend + web + iOS behavior and relevant verification |
| 15 | Territory Revenue | In progress | Backend + web + iOS behavior and relevant verification |
| 16 | Property Sales History | In progress | Backend + web + iOS behavior and relevant verification |
| 17 | Sales Map | Open | Backend + web + iOS behavior and relevant verification |
| 18 | Sales Feed | Open | Backend + web + iOS behavior and relevant verification |
| 19 | Goals | In progress | Backend + web + iOS behavior and relevant verification |
| 20 | Forecasting | In progress | Backend + web + iOS behavior and relevant verification |
| 21 | Pipeline Value | In progress | Backend + web + iOS behavior and relevant verification |
| 22 | Loss Tracking | In progress | Backend + web + iOS behavior and relevant verification |
| 23 | Cancellations | In progress | Backend + web + iOS behavior and relevant verification |
| 24 | Duplicate Protection | In progress | Backend + web + iOS behavior and relevant verification |
| 25 | Permissions | In progress | Backend + web + iOS behavior and relevant verification |
| 26 | Sales Notifications | Open | Backend + web + iOS behavior and relevant verification |
| 27 | Crm-Lite Contact Record | Open | Backend + web + iOS behavior and relevant verification |
| 28 | Follow-Up System | Open | Backend + web + iOS behavior and relevant verification |
| 29 | Search | Open | Backend + web + iOS behavior and relevant verification |
| 30 | Exports | Open | Backend + web + iOS behavior and relevant verification |
| 31 | Api / Integration Architecture | In progress | Backend + web + iOS behavior and relevant verification |
| 32 | Industry-Aware Metrics | Open | Backend + web + iOS behavior and relevant verification |
| 33 | Real Estate Mode | Open | Backend + web + iOS behavior and relevant verification |
| 34 | Wolfy Ai — Reposition | Open | Backend + web + iOS behavior and relevant verification |
| 35 | Data Integrity | In progress | Backend + web + iOS behavior and relevant verification |
| 36 | Historical Snapshots | In progress | Backend + web + iOS behavior and relevant verification |
| 37 | Timezone Handling | In progress | Backend + web + iOS behavior and relevant verification |
| 38 | Performance | Open | Backend + web + iOS behavior and relevant verification |

## Current work

- Source audit confirmed the V1 sale schema, shared RPCs, pipeline, Home cards and limited reports.
- Foundation expansion in progress. Existing financial eligibility remains verification-based; completed value and cash collected will be independent measures.
- No Pro Sales migration or client deployment has been performed.

## Carry-forward requirements from the initial brief

Explicit manager verification/rejection; configurable visibility and verification; safe workspace currency; audit events; refunds/chargebacks; exactly-once configurable sales rewards and auditable adjustments when enabled; configurable goals; CRM synchronization deduplication/error handling; privacy-safe team wins; split credit without inflated company revenue; all 15 original acceptance cases. The updated brief makes rewards secondary and does not justify putting XP above performance.

## Pass 1 — shared foundation and sale record screens

Implemented, not deployed:

- `20260916120000_pro_sales_foundation.sql` adds sale/property/opportunity links, setter/closer, team snapshots, product and completion fields, expected revenue, optional restricted commission/margin fields, split-credit rows, append-only payment API, settings, audit/outbox and request deduplication.
- Sales command supports submit/edit/attribution, verify/reject, cancel/refund/chargeback, completion, collection and cash reversal. Manager-confirmed separate jobs replace the blanket one-active-sale-per-lead restriction. Signed contract value, completion value and recorded cash remain independent.
- `20260916121000_pro_sales_records.sql` exposes authorized details, exact credit allocation (including rounding), payment ledger, source timeline and redacted audit history. Existing dashboard/history RPC access is wrapped to honor new monetary visibility and feed options.
- Both migrations are mirrored byte-for-byte in the web and public iOS repositories.
- Web `/sales/[saleId]` and iOS `FieldSalesRecordView` show separate financial values, attribution, job details, property timeline and history, and offer authorized verification, completion, collection/refund and cancellation actions. Entry links appear when the backend returns `pro_sales_version`.
- Both clients tolerate audit events that have no financial/status snapshot; negative payment amounts render correctly.

Verification completed this pass:

- `supabase/tests/pro_sales_foundation.mjs`: PASS against an isolated PGlite PostgreSQL fixture, including money/credit rounding, zero-share reps, request replay, payment reversals, cross-workspace/role attacks, source-event validation, multiple-job override, historical team retention, hidden revenue in details/history/legacy dashboard, setting validation, DST boundaries.
- Existing `field_sales`, `field_sales_pipeline`, `field_sales_periods`, `field_sales_rollout` suites: PASS (existing fixture/migrations). These are compatibility evidence, not full Pro reporting acceptance.
- Sales-specific ESLint: PASS.
- Whole-web TypeScript: still fails outside Sales; no diagnostics in changed Sales files. Log: `/tmp/wolfgrid-pro-sales-types.log`.
- Actual Sales SwiftUI sources compile in the isolated simulator host: BUILD SUCCEEDED. Log: `/tmp/wolfgrid-pro-sales-ios-build.log`. No new device installation or UI acceptance run yet.

Next required work, with no reduction of the original scope:

1. Replace the legacy reporting calculations with a shared Pro report RPC. Current V1 rankings still attribute whole amounts to the primary rep; they MUST be updated before deploying splits. Implement every required date/dimension filter, previous-period comparisons, safe funnel cohorts and drilldowns, role rankings, separate sold/completed/collected metrics, campaign/territory reports and historical-team queries.
2. Finish fast Mark as Sold UI and all specified entry points, including setter/closer/product/completion fields, manager split editing and duplicate override. The new data model supports fields that are not yet all exposed in the submission forms.
3. General goals and deterministic pacing/forecasting; pipeline defaults/loss reasons and manager drilldowns; accurate source inference and attribution corrections beyond supplied links.
4. Public iOS performance-first Home/navigation, web manager dashboard, maps/property timelines, CRM-lite/search/exports, notification/realtime delivery, industry terminology and real-estate mode, integration ingestion and Wolfy intelligence.
5. Integrate configurable rewards and cancellation adjustments only as secondary features consistent with the updated brief. Existing Wolfy verification reward trigger is not yet upgraded.
6. Validate against real schema and authenticated clients, visually verify the complete new flows, benchmark dashboards, create isolated releases and record actual deployed/installed versions. Do not apply Pro migrations before the new report/visibility contracts are complete.

The new outbox is durable storage only; no webhook delivery or notification worker is claimed. Extended settings are backend contracts; complete admin controls remain to be built. Source-event attribution currently validates supplied direct links, not the complete automatic attribution resolver. Manager team management and full historical activity snapshots remain open.


## Pass 2 — shared reporting and first performance screens

Implemented, not deployed:

- `20260916122000_pro_sales_reporting.sql`: shared filter/period/credit helpers and `field_sales_report`. Supports today/yesterday/week/last week/month/last month/quarter/year/all/custom; representative, campaign, territory, historical sale team, product, status and source; offset paging; financial dimension breakdowns and equal-day previous-period comparison.
- Company financial records count once. Rep revenue is allocated exactly, including minor-unit residue. Sold is recognized by sold date; completed by completion date; collections/refunds by actual payment timestamp. Cancellation reverses the original sale period and never invents cash movement.
- Source-owner activity, deduplicated visits with undo, lead cohorts and explicitly completed appointment cohorts are reported. Product/source/status sale filters suppress unsupported backward activity attribution rather than manufacturing denominators. Close-rate ranking eligibility is thresholded; full rankings/drilldowns remain open.
- Existing opportunity creation dates now come from recorded creation evidence, or remain unknown. They are not backfilled as migration-day production.
- Web `/sales/reports` and public iOS `FieldSalesReportView` show report KPIs, date/dimension filters, source activity, revenue breakdowns and paginated sales linked to the record screen. Entry points are in the existing Sales screen. Full Home/leaderboard replacement is still required before rollout.
- Web report filter state resets on account/workspace identity change. This fixed a browser-observed manager-to-rep switch error.
- Acceptance harness supports `PRO_SALES=1 SALES_TEST_PORT=4328` and loads the real report/record components against isolated migrated PostgreSQL.

Verification:

- `pro_sales_reporting.mjs` passes: company/rep split reconciliation, sold/completion/payment periods, cancellation, source cohorts, filters/custom dates, pagination, hidden dollars, cross-workspace and role access.
- Isolated public SwiftUI report screen build: BUILD SUCCEEDED (`/tmp/wolfgrid-pro-sales-ios-report-build.log`).
- Changed Sales web files pass ESLint. Whole-web TypeScript still fails outside Sales; no changed Sales diagnostics (`/tmp/wolfgrid-pro-sales-report-types.log`).
- Agent-browser local acceptance: report and detail routes render, custom period controls remain usable, manager/team view switches to a fresh rep/self view on account change, no page errors. A synthetic verified CAD 31,500 sale appears as 1 sale / CAD 31,500 sold / CAD 0 completed / CAD 0 collected, and its detail screen agrees.
- The local harness has simplified styling; this is behavioral evidence, not final responsive shell/design acceptance. Browser and server were closed after verification. No live Supabase/production writes or device installation.

Next priority: implement complete multi-category leaderboards and funnel drilldowns using the shared report definitions; replace legacy rankings and Home calculations. Then proceed through all remaining goals/pipeline/maps/CRM/integration/notification/industry/intelligence and release requirements. The report has not completed campaign/territory ROI drilldowns, historical activity snapshot coverage, territory naming, rep comparative trends or performance benchmarks. No section is marked fully complete on the strength of this partial report.


## Pass 3 — multi-category rankings and funnel record drilldowns

Implemented, not deployed:

- Shared private `field_sales_activity_rows` keeps report totals, source drilldowns and rankings on the same definitions. Activity team attribution uses membership at the activity timestamp. Unknown legacy opportunity creation dates remain unknown.
- Public authorized funnel drilldown RPC supports doors, conversations, leads, appointments, completed appointments, opportunities, verified sales, completed jobs and payments, with pagination and exact financial values.
- Leaderboards support 15 categories, including split credited revenue, separate setter/closer participation, activity, collection, conversion and sales cycle. Ties share ranks. Conversion and cycle rankings require configurable minimum evidence. Adding rep participation counts is explicitly not a company sale count.
- Admin/owner controls select visible categories, minimum opportunities and featured sales/count/collected ranking. Disabled categories are removed from raw metric payloads as well as selectors. Hidden monetary data remains redacted; disabling every category preserves access to settings.
- Web and public iOS have dedicated leaderboard screens and funnel drilldowns, date/campaign/territory/historical team/product/source filters, and authorized settings controls. Existing Pro leaderboard entry points now use the new calculations. Legacy Home calculations still require replacement before rollout.
- Explicit SQL NULL report filters now normalize to the authenticated rep's self scope; regression coverage prevents null filters from widening access.
- All five Pro migrations through `20260916123000_pro_sales_leaderboards.sql` are mirrored byte-for-byte between repositories.

Verification:

- Expanded `pro_sales_reporting.mjs`: PASS. Covers drilldown/count agreement, exact split reconciliation, ties, minimum sample exclusion, category disabling and raw metric redaction, settings authorization, NULL-filter isolation, hidden revenue and private helper access.
- Sales-specific ESLint: PASS after final product/source filter changes.
- Isolated simulator host compiling actual Sales SwiftUI sources: BUILD SUCCEEDED after final filter changes (`/tmp/wolfgrid-pro-sales-ios-ranking-build.log`). This does not prove full application integration or device behavior.
- Whole-web TypeScript still has unrelated errors; no Sales diagnostics in `/tmp/wolfgrid-pro-sales-ranking-types.log`.
- Local browser acceptance: category/period/filter controls render, close-rate excludes insufficient samples, switching to a source filter resets unsupported categories, and a verified synthetic CAD 32,000 sale opens through the report's sales drilldown with matching count/value. No browser page errors. Simplified harness styling does not establish final visual acceptance.

Remaining: monthly goal-completion rankings and office/location scope; full comparative rep profiles and campaign/territory ROI; iOS navigation from raw source rows to their contact details; canonical territory labels; complete Home replacement; goals/forecasting; pipeline/loss; fast sale entry and attribution; maps; CRM/search/exports/integrations; notifications and real-time delivery; industry modes; Wolfy intelligence; production-schema, performance and complete client acceptance; isolated deployment and device installation. No section is claimed fully complete from this milestone.


## Pass 4 — scoped goals and deterministic pacing

Implemented, not deployed:

- `20260916124000_pro_sales_goals.sql` adds versioned, auditable targets at individual rep, team, workspace and campaign scope. Supports doors, conversations, leads, appointments, sales, sold value, collected revenue, commission, close rate and converted appointments. One active target per exact scope/metric/period; idempotent creation retries reject changed payloads.
- Goals use the shared verified-contract, credit-allocation, source-activity and payment definitions. Cancelling a sale immediately removes its eligible sold/commission/conversion contribution on the next read; it does not fabricate a payment refund. Restricted financial targets are omitted for unauthorized readers and cannot be changed by them.
- Calendar pacing returns actual, target, remaining, progress, required daily/weekly production and ahead/behind state. A linear projection is available only after seven elapsed local-calendar days, explicitly labeled uncertain. Rate goals require the configured evidence threshold and have no invented daily unit pace. No pipeline value is added to actual revenue or this linear projection.
- Web `/sales/goals` and public iOS `FieldSalesGoalsView` support create/edit/archive/restore, weekly/monthly/quarterly presets, custom dates, pagination and role-appropriate scope/metric choices. Both reset to the new identity on account/workspace change. Sales and report navigation link to goals. The web editor uses a native modal dialog for focus containment and Escape handling.
- The goal migration is mirrored byte-for-byte between both repositories.

Verification:

- `pro_sales_goals.mjs`: PASS in isolated migrated PostgreSQL. Tests four scopes, exact split credit, pending exclusion, cancellation recalculation, cash independence, activity counts and converted cohorts, retry deduplication, audit events, optimistic versions, archive/restore, workspace/role/financial privacy, minimum-evidence withholding and DST/calendar pacing.
- Web goal files pass ESLint. Whole-web TypeScript retains unrelated diagnostics; no Sales diagnostics in `/tmp/wolfgrid-pro-sales-goals-types.log` after fixing a BigInt literal target incompatibility.
- Actual public Sales SwiftUI sources compile in the isolated simulator host (`/tmp/wolfgrid-pro-sales-ios-goals-build.log`). No full public-app or device acceptance claimed.
- Browser verified creation of a CAD 60,000 workspace target, edit to CAD 75,000, archive/restore, pace display and owner-to-rep isolation. Rep creation excludes team/workspace/campaign scope and restricted commission. No page errors. Local harness styling remains simplified, so final responsive visual acceptance is outstanding.

Next: replace legacy monthly-count target and Home consumers with these targets (including migrating existing target data and consistent goal-completion rankings); add opportunity-based recommendations and pipeline-aware forecasting as separately labeled evidence; deliver reached-goal events/notifications/rewards. The full original goals/intelligence/Home requirements are not complete. Continue fast sale entry, attribution, pipeline/loss, maps/CRM/search/exports/integrations/industry modes and full release acceptance from the overall tracker. No production migration/deployment or device install occurred.


## Pass 5 — Home performance and existing-goal compatibility

Implemented, not deployed:

- `20260916125000_pro_sales_goal_compatibility.sql` migrates existing personal/workspace monthly sales targets into the new goal model, preserving IDs. Imported creator is unknown rather than invented; migration is explicitly audited. Two-way triggers keep compatible monthly count targets synchronized for older clients, including edit/archive/restore and period changes. New arbitrary targets above the legacy one-million-count limit are not misrepresented in the old integer API.
- `20260916126000_pro_sales_home.sql` exposes shared rep/workspace Home summaries: weekly activity and credit-correct sales, today/month totals, independent sold/completed/collected values, active goals with pace, pending review counts, latest verified sale and configured ranking. It uses the report/goal helpers and existing visibility/feed rules.
- Leaderboard `focus_rep` selects a rep only after the full ranking calculation, so Home can retrieve the correct rank outside the first page. Filtered rank results do not claim another page.
- Web Home's existing `SalesCard` switches to `ProSalesHome` when Pro capabilities are present. Public iOS has a dedicated `FieldSalesProHomeView`; the performance Home replaces its older hero/funnel with this summary, and the grid Home includes the module. Campaign action precedes the secondary Wolfy section on performance Home.
- The updated leaderboard and two new migrations are mirrored byte-for-byte in the web repository.

Verification:

- `pro_sales_home.mjs`: PASS for legacy import, unknown historical authorship, two-way old/new goal edits, stable IDs, live recalculation after verification/cancellation, split credit, independent financial measures, focused rank and permissions/feed redaction.
- Existing goals suite now includes both new migrations: PASS. Reporting suite: PASS after leaderboard changes.
- Changed web components pass ESLint. Whole-web TypeScript retains unrelated errors; no Sales diagnostics in `/tmp/wolfgrid-pro-sales-home-types.log`.
- Actual Sales SwiftUI sources, including new Home component: isolated simulator-host BUILD SUCCEEDED (`/tmp/wolfgrid-pro-sales-ios-home-build.log`). The modified full HomeView/WolfyHomeView entry files additionally pass Swift parsing; full-app type checking and device UI behavior remain unverified.
- Browser Home component shows a synthetic CAD 31,500 company sale against CAD 60,000 goal (52.5%), independent CAD 0 completed/collected, then CAD 25,200 for the rep's 80% share after account switch. The workspace goal disappears for the rep; ranking follows permitted categories. No page errors. Simplified harness styling is not final layout acceptance.

Next required rollout blocker: replace the main Sales screen's legacy primary-rep totals/coaching/list calculations, which can disagree with new Home/reports for split sales. Finish fast Mark as Sold and its specified entry points while doing that replacement. Home metric configuration, goal-completion rankings, detailed forecasts/opportunity recommendations, realtime invalidation, and full performance benchmarks remain open along with the broader tracker. No production deployment, Supabase migration application, or device installation occurred.


## Pass 6 — primary Sales screen and fast sale entry

Implemented, not deployed:

- Pro web/iOS Sales entry points now show the shared report component instead of the legacy primary-rep totals, elapsed-appointment conversions and coaching. Managers start in workspace scope; reps start in self scope. Currency/timezone setup remains reachable before switching to Pro UI. Older backend capabilities retain the older client screen.
- `20260916127000_pro_sales_entry.sql` resolves authorized contact/appointment/opportunity/property/campaign context, supplies the workspace-local date and searchable contacts, preserves source links, returns allowed rep choices and existing-sale warnings. Foreign or contradictory context and future/cancelled appointments are rejected.
- New web modal and iOS bottom-sheet forms put contract value first, with optional product, date, completion date, appointment, primary rep, setter, closer, notes and two-party split credit. Manager-confirmed separate jobs require an identifier and reason. Save requests retain stable IDs and use the existing audited, idempotent sales command. iOS emits a subtle success haptic.
- Setter/closer reassignment now checks attribution permission independently of primary rep assignment; authorized unchanged historical assignments are preserved on edits.
- Lead links, open pipeline opportunities, campaign screens and iOS contact-activity appointment rows open the new flow. The API accepts property context, but complete property/map buttons and web appointment-source normalization are still outstanding.
- Current-page CSV export remains available from the replacement report when export permission allows it; financial fields use exact attributed minor units. This is not the complete multi-entity/full-filter export requirement.
- Entry migration and updated foundation are mirrored byte-for-byte between repositories.

Verification:

- `pro_sales_entry.mjs`: PASS for workspace/lead/appointment/opportunity context, local date, rep assignment rules, duplicate warning and legitimate second-job override. Foundation suite: PASS after attribution restriction.
- Browser: amount-only submit creates a pending CAD 31,500 sale; official totals stay zero until verification from its details. Re-entry shows the existing-sale warning and required manager override fields. A second flow creates CAD 20,000 with 50/50 setter/closer allocations, each CAD 10,000, preserving zero official sold while pending. Pro manager view defaults to workspace scope and uses the shared totals, without legacy coaching/totals beneath it.
- Sales files pass ESLint; the touched campaign page has existing warnings and no errors. Whole-web TypeScript has unrelated diagnostics, none in Sales/new campaign link (`/tmp/wolfgrid-pro-sales-entry-types.log`).
- Isolated simulator host compiling actual Sales SwiftUI sources: BUILD SUCCEEDED (`/tmp/wolfgrid-pro-sales-ios-entry-build.log`). Source-screen ActivityView and campaign changes pass Swift parsing; full-app typecheck/device interaction remains unverified.
- Local browser harness uses simplified styling. No full responsive design acceptance, live Supabase changes, deployment or device installation claimed.

Next: replace pipeline workbench scope/permissions, stage-transition/loss handling and manager pipeline drilldowns; complete all source-entry paths and general sale/attribution editing. The old dashboard RPC still exists for older clients/other consumers and must be reconciled before rollout; changing the Pro main UI does not prove all legacy/integration consumers are correct. Continue full goals/rankings/forecasting/maps/CRM/search/export/notifications/industry/Wolfy and production acceptance requirements.


## Pass 7 — pipeline scope, stage integrity and losses

Implemented, not deployed:

- `20260916128000_pro_sales_pipeline.sql` replaces workbench reads with consistent current-lead-owner scopes. Reps get personal records and matching aggregates; authorized managers get workspace opportunities. Hidden values are omitted from records and summaries, and stage edits preserve amounts the viewer cannot see.
- Authorized managers can update team opportunities without changing the assigned lead owner. Optimistic versions prevent stale edits. Notes do not reset time in stage. Stage outcomes with existing opportunities cannot be reclassified.
- A pipeline move cannot create a signed sale, bypass cancellation, or fabricate completion/collection. These transitions require the connected sale lifecycle.
- Loss reason/note and known transition timestamps are stored and audited with before/after records. Reopening clears current loss fields while retaining audit evidence. Historical loss dates with no evidence remain unknown. Current loss distribution is labeled as current, not a historical period conversion metric.
- Open-pipeline totals, missing-value count and 72-hour unchanged indicators are available. Weighted totals use exact numeric arithmetic. Stale here means no opportunity update, not a claim that no external contact occurred.
- Web/iOS show scope-appropriate headings, open value, current loss breakdowns, filters for unchanged/lost records and loss fields in editors. Empty stage columns are hidden. Personal follow-up choices remain separate from manager opportunity choices.
- Migration mirrored byte-for-byte in both repositories.

Verification:

- `pro_sales_pipeline.mjs`: PASS for role/owner scopes, contact reassignment, money redaction/preservation, real-sale stage guards, loss/reopen semantics, stage timers, version conflicts, stage classification and stale records.
- Browser created a CAD 24,000 proposal, changed it to Lost/Price with a note, and confirmed open value becomes zero while the current loss count becomes one/100%. No page errors. Simplified harness styling remains separate from full visual acceptance.
- Sales workbench ESLint passes; whole-web TypeScript still has unrelated errors, no Sales diagnostics (`/tmp/wolfgrid-pro-sales-pipeline-types.log`).
- Actual Sales SwiftUI sources compile in the isolated simulator host (`/tmp/wolfgrid-pro-sales-ios-pipeline-build.log`). Full-app/device verification remains open.

Remaining pipeline work: scalable pagination and server-side search/filtering, period-based loss history and conversion analysis, management of overdue team follow-ups, integration into manager KPI/forecast screens and performance benchmarks. Stage/outcome enforcement and the new default list do not complete all pipeline/CRM requirements. Continue the broader tracker and legacy-consumer reconciliation before deployment. No production changes or device installation in this pass.


## Pass 8 — final pipeline build correction and application integration check

- Rechecked the latest pass-7 log and found a SwiftUI type-check failure after its last empty-stage cleanup. Earlier pass-7 build success did not cover that final edit.
- Split pipeline filtering, stage sections and opportunity rows into typed helpers. Empty sections now disappear for the selected filter as well as for stages without records.
- Rebuilt the actual Sales SwiftUI sources in the isolated simulator host: BUILD SUCCEEDED (`/tmp/wolfgrid-pro-sales-ios-pipeline-build.log`).
- Reran all six Pro PostgreSQL fixture suites (foundation, reporting, goals, Home, entry and pipeline): PASS. This remains fixture evidence, not production-schema validation.
- Full public `WolfGrid` scheme simulator build: BUILD SUCCEEDED for arm64 and x86_64 (`/tmp/wolfgrid-pro-sales-full-app-build.log`). A fresh package cache resolved stale Google Maps/Turf artifact paths. The full build then exposed a campaign-detail SwiftUI type-check timeout; splitting content, navigation, presentations and lifecycle modifiers resolved it while preserving the Sales entry link. This verifies full application compilation, including Home and source entry screens; it does not establish authenticated runtime or device acceptance.
- All broader implementation and release requirements remain open as listed above. No deployment, production migration, or device installation.


## Pass 9 — primary public iOS Sales navigation (reverted by user request)

- Public iOS now uses Home, Map, Leads, Sales and Wolfy as its five primary destinations. Sales opens the authorized shared Sales module directly. Map retains the existing campaign/session destination.
- Preserved existing map, lead, secondary-tools and settings route IDs so campaign selection, notification routing and existing settings actions continue to target the same destinations. Sales and Wolfy use new IDs.
- Home provides an accessible All tools and campaigns button; the secondary grid retains activity, calendar, appointments, follow-ups, stats and campaign access. Campaign creation remains available from the campaign list toolbar and empty state.
- Added a standalone Wolfy coaching destination, keyed by user/workspace so changing identity replaces its conversation store. Its dark appearance matches the existing coach presentation. Performance loading now runs on the coach screen itself rather than depending on the collapsed context disclosure appearing. This does not complete the remaining Pro intelligence calculation/reconciliation work.
- Full public WolfGrid simulator build after final changes: BUILD SUCCEEDED (`/tmp/wolfgrid-pro-sales-navigation-build.log`), arm64 and x86_64. Authenticated navigation interactions, device installation and visual acceptance remain outstanding; compilation does not prove those. No production deployment or database change.


## Navigation decision — user correction

The user explicitly requested restoration of the previous Home navigation and Sales inside the Sales button in More. This overrides the earlier recommended primary-tab arrangement. Restored Home, Session, Create, Leads and More; removed the standalone Sales/Wolfy tab destinations and the added Home tools button. Preserve this arrangement during remaining Sales work. Sales functionality and Home performance data remain in scope.

Navigation revert verification: full public WolfGrid simulator build succeeded (`/tmp/wolfgrid-pro-sales-navigation-revert-build.log`). No deployment or device installation.


## Alternate commission Home — user-requested addition

- Doors is now the default Home mode, including for Pro workspaces. A local Doors / Sales switch adds a second view without changing the restored bottom navigation. Sales remains in More.
- Sales Home uses a large weekly gross commission ring, with Daily Earned and Sales Closed this week to its right. Weekly personal commission goals fill the ring; without a goal no progress is invented.
- New `field_sales_commission_home` RPC is always personal, including for managers. It uses exact split credit on verified sales by workspace-local sold date, excludes reversed contracts, hides restricted commission, and flags missing commission values. Daily Earned is explicitly estimated commission, not paid-out commission; user clarification on that preference remains unanswered.
- Migration `20260916130000_pro_sales_commission_home.sql` mirrored in both repositories. New commission Home test passes for personal scope, pending exclusion, verification, exact splits, missing values, cancellations, privacy and workspace isolation.
- Full public iOS simulator build succeeded after final layout changes (`/tmp/wolfgrid-pro-sales-commission-home-build.log`). Actual component checked on an iPhone 16e simulator against a synthetic local PostgreSQL fixture: CAD 4,200 commission / CAD 6,000 goal (70%), Daily Earned CAD 4,200, one sale. Screenshot `/tmp/wolfgrid-commission-home-preview.png`. This is isolated component runtime evidence, not a live-account/device release.
- No production migration, deployment or physical-device installation. The interrupted report-pipeline additions in migration 1290 and both report clients remain local work; database regression passes, but their web UI acceptance remains outstanding.


## Live Sales entry diagnosis — 15 September 2026

User reports More → Sales on iPhone shows nothing useful. Live read-only inspection of public project `kfnsnwqylsdsbgnwgxva` confirmed 232 workspaces and only one Sales settings row, enabled/configured for `Sales Beta Acceptance — temporary`. Ordinary workspaces have no Sales activation. The live API schema exposes only bootstrap/command/dashboard/history/pipeline/workbench/role; Pro reporting, goals, Home, entry, commission and related APIs are not deployed. Thus local feature coverage is not usable production integration. Connected public iPhone app reports 1.28 build 15.

Asked for the user's current workspace name to activate the correct workspace without changing unrelated workspaces. No production write performed. Locally made the Sales root restore the navigation bar and render explicit disabled/error/retry states, and allowed admins as well as owners to reach reporting setup. Priority is enabling and verifying a real recording flow on the user's workspace/device, followed by scoped Pro migration/client release and complete acceptance.


## Appointment-led V1 integration — 17 September 2026

The user's updated V1 approach makes appointments the sole new-sale intake. Preserve existing reports, Sales screens, commission counter, goals, verification and rankings; do not restore direct lead/campaign/pipeline submission. Keep Sales in More and Doors as default Home.

- Confirmed the appointment conversion writes the existing `field_sales` record consumed by the reporting framework.
- Added optional expected gross commission to web and public iOS appointment conversion, gated by the existing commission capability. Missing commission stays unknown; payment/collection is not inferred. Form identity now follows appointment ID so selecting another appointment for the same contact starts fresh form/request state.
- Added mirrored `20260917121000_appointment_sale_uniqueness.sql`: a partial unique index enforces one pending/verified sale per appointment across concurrent inserts and status changes. The earlier procedural trigger alone did not enforce this for status-only changes.
- `pro_sales_appointment_integration.mjs`: PASS across the complete migration chain. Owner conversion retains rep credit; pending sales are excluded; verification updates company/rep reports, Home, personal commission, commission goal and revenue ranking; cancellation reverses them without removing the sale. Tests cross-workspace denial and active-appointment uniqueness on status restoration. Existing appointment-led V1 suite also passes.
- Browser acceptance against real components and synthetic migrated PostgreSQL: converted an appointment into a CAD 2,500 sale with CAD 250 expected commission, verified it, and observed one sale/CAD 2,500 on Home and the Sales dashboard, zero pending, and separate zero completed/collected values. No browser page errors. Harness now loads appointment migrations and supplies two synthetic past appointments.
- Changed web conversion component: ESLint passes with zero warnings. Full public iOS simulator build: BUILD SUCCEEDED (`/tmp/wolfgrid-appointment-integration-build.log`). Browser harness styling is simplified; this does not establish full visual acceptance or iPhone device interaction.
- These are local integration results. Supabase migration application/workspace activation, scoped web release and signed public iPhone release remain required before users receive the new appointment-led framework. Do not call source completion a deployed Sales component.
