# Customer Sales V1

## Implementation

The public iOS app and `Wolfgrid-WEB` use the same authenticated Supabase RPCs. This module is independent of WolfGrid's internal salesperson pipeline and makes no changes to commissions, XP, payments, or invoicing.

- `field_sales_bootstrap(workspace)` supplies the server-controlled gate and reporting settings.
- `field_sales_command(workspace, action, data)` handles settings, monthly goals, submit/edit, verification, and cancellation in transactions.
- `field_sales_dashboard(workspace, period, team, rep, campaign, status)` supplies consistent totals, permission-filtered records, cohorts, rankings, wins, and deterministic coaching.
- All new tables have RLS enabled and deny direct authenticated/anonymous access. Only the public RPCs are callable. No service-role credential is shipped to either client.
- Settings and sale writes serialize per workspace. A unique active-lead index and persistent submission request ID prevent duplicate credit. Verification checks the reviewed record version. Audit events preserve before/after records.
- Existing leads map to `contacts`; appointments map to meeting `contact_activities`, whose `timestamp` is the scheduled date used by the current appointment UI. Optional cancellation status is respected. No legacy sales are inferred or backfilled.
- The rep defaults to the contact owner. Owner/admin submissions can assign another current member, but the submitting actor must still own the source contact. Campaign and territory come from the source lead's campaign.
- One active sale per lead. Replacements reference a cancelled sale. Verified records cannot be edited or reopened; managers cancel and the contact owner submits a replacement.
- Currency and timezone are chosen explicitly by the owner, then locked after the first sale. Supported reporting currencies: CAD, USD, EUR, GBP, AUD, NZD, JPY, CHF. JPY uses whole units; the others use two decimals. Wire amounts are decimal integer strings, preventing JavaScript precision loss.

## Metric definitions

Weeks start Monday in the workspace timezone. Sales and revenue use sale date and current verified eligibility, so cancellation reverses the original period. Revenue means contract value, not cash collected. Goals count all verified monthly workspace sales for the selected rep/team, irrespective of campaign filters.

Door counts reuse the Home event rule: latest event per session and building/address, excluding completion undo. Sales per 100 doors is a production ratio, not a conversion probability.

Lead conversion counts distinct source leads created during the period with a verified linked sale. Appointment conversion counts elapsed, non-cancelled meeting records scheduled during the period with a verified linked sale. Missing sale-to-appointment links make appointment conversion unavailable. Zero denominators display unavailable. Cohort numerators use assigned-rep attribution and cannot exceed their denominators. Period activity totals are labeled separately from cohort conversions. Wolfy suppresses conversion advice below ten opportunities and never predicts a guaranteed sale.

## Navigation and privacy

- iOS: Home Sales card, lead-detail Record Sale, and Sales/Revenue entry from the existing leaderboard. No bottom tab change.
- Web: `/sales`, gated customer sidebar item, lead-detail link, Home card, Sales/Revenue panel in the existing leaderboard.
- Owners/admins have a pending review queue. Only owners self-verify. Reps can edit their own pending submissions.
- Team feeds never contain contact IDs, names, addresses, appointment IDs, or notes. Contract values and revenue rankings remain hidden unless enabled for the team. Managers retain review visibility; personal revenue remains visible to its owner.
- Clients invalidate on mutation, focus/foreground return, and account/workspace changes; outdated requests cannot repopulate a changed scope.
- Recent sale records are capped at 200 with an explicit limit notice; use period/rep/campaign/status filters to narrow the result. The pending queue includes older pending submissions. Aggregates cover the entire eligible set.

## Validation

From the `WolfGrid-IOS` checkout, run the isolated PostgreSQL regression suite (install the test dependency outside the repository):

```sh
npm install --prefix /tmp/wolfgrid-sales-validation @electric-sql/pglite esbuild
PGLITE_MODULE=/tmp/wolfgrid-sales-validation/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/field_sales.mjs
```

The suite exercises the migration, feature gate, setup permissions, exact amounts, invalid/future data, retries, duplicate leads, cross-workspace attacks, role restrictions, stale verification, target ownership, direct-table denial, hidden values, replacement records, cancellation audit, conversion cohorts, appointment exclusions, deduplicated doors, and undo.

The web checkout contains `scripts/field-sales-validation.mjs`. It serves the real React components against this migrated database using synthetic identities and local-only transport on port 4318. From the web checkout:

```sh
PGLITE_MODULE=/tmp/wolfgrid-sales-validation/node_modules/@electric-sql/pglite/dist/index.js ESBUILD_MODULE=/tmp/wolfgrid-sales-validation/node_modules/esbuild/lib/main.js node scripts/field-sales-validation.mjs
```

This harness validates UI/data behavior; its lightweight stylesheet does not substitute for the full dashboard layout. Its synthetic transport does not test live Supabase authentication.

For iOS, build the public `WolfGrid` scheme first, then generate the isolated test app using the real Sales SwiftUI files and Supabase Swift client:

```sh
SUPABASE_SWIFT_CHECKOUT=/path/to/derived/SourcePackages/checkouts/supabase-swift ruby supabase/tests/field-sales-ios/create.rb
xcodebuild -project /tmp/wolfgrid-sales-ios-validation/SalesAcceptance.xcodeproj -scheme SalesAcceptance -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_ID' -derivedDataPath /tmp/wolfgrid-sales-ios-test-derived CODE_SIGNING_ALLOWED=NO test
```

Keep the local web acceptance server running. The XCTest records an owner sale, verifies it, checks Home and the leaderboard, cancels it, and checks the Home reversal. It uses synthetic owner identity, not a production session. Fixtures permit rerunning after cancellation.

## Release gate and remaining live checks

The additive migration is mirrored byte-for-byte in both repositories as `20260915190000_field_sales_v1.sql`. Apply it **once per actual Supabase database**, not twice merely because both clients contain it. The schema migration defaults to disabled. The separate `20260915233000_field_sales_beta_rollout.sql` enables Beta entry points only when applied after acceptance; owners still select reporting currency/timezone. Clients cannot enable the gate.

1. Confirm the deployed public iOS and web Supabase project references and check existing table shapes against the migration prerequisites. Do not use the internal Sales backend's database merely because it has Sales in its name.
2. Apply the migration to staging. An operator may create a settings row with `enabled=true` for a staging workspace; the owner then selects currency/timezone through the UI.
3. Validate authenticated owner/admin/member accounts through the real web shell and public iOS app, including account switching and lead entry points. The isolated tests do not certify live auth or deployed schema compatibility.
4. Apply only this migration to production, with all gates disabled. Release the scoped web changes and iOS build after staging acceptance. Enable selected workspaces only after verifying those clients.
5. Monitor RPC authorization/validation errors and compare Home, rankings, and verified database totals. Disable a workspace's settings gate to stop access immediately; preserve its data and audit events.

## Sales Beta expansion (15 September 2026)

- Historical periods now include last week, last month, this quarter and this year. Cohorts and activity use the same period boundaries; monthly goals continue to refer to the current month.
- `field_sales_history` exposes a permission-filtered timeline to the submitting rep and managers. Raw customer snapshots remain inaccessible.
- Web CSV exports contain the displayed records (maximum 200), exact integer minor units, period bounds and as-of time. They exclude private customer identity and hidden values; spreadsheet formula prefixes are escaped.
- `field_sales_workbench` and `field_sales_pipeline_command` implement the separate public customer pipeline, configurable stages/probabilities, private opportunity records, permission-filtered team estimates and individual follow-up tasks. Marking an opportunity Won does not verify a sale. Weighted values are estimates, with missing values explicitly disclosed.
- Sales entry points, screens, categories and settings carry Beta labels. The shared web Home wrapper covers owners and members. Public iOS retains its existing navigation in the isolated release.
- The internal `/sales/pipeline` and WolfGridSales app remain separate. No provider-backed electronic signature, automated sequence delivery, licensed homeowner/mover feed, arbitrary object/report builder, or enterprise service-level parity is claimed.

Additional regression suites: `field_sales_pipeline.mjs` and `field_sales_periods.mjs` in the public iOS repository’s `supabase/tests` directory.

See `SALES_COMPETITIVE_RESEARCH.html` and its JSON companion for 24 capability families, 26 official sources, existing-code evidence and outstanding parity requirements. Those documents are a public-documentation assessment, not a paid-account feature audit.

Live acceptance uses temporary accounts and a private workspace. The unsigned iOS acceptance app uses in-memory auth storage because it has no keychain entitlement; the production app’s auth storage is unchanged. Never commit the generated live credentials or temporary acceptance host.

Release results and actual deployment state are recorded separately in `SALES_BETA_RELEASE.md`.
