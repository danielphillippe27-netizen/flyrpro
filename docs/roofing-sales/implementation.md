# WolfGrid roofing sales pilot

## Release status

The implementation is isolated in the Web, iOS and Android `codex/roofing-sales` branches. All pilot capabilities default off. The application builds and tests below use fixture data. A production migration, workspace activation, App Store submission, Play Store publication and field pilot are separate release milestones.

## Components and contract

- Canonical appointments extend the existing calendar, map, contact and sales entry points. The shared Supabase contract is `field_appointment_command`, `field_appointment_list`, `field_appointment_detail`, `field_appointment_options` and `field_appointment_alerts`. New property contact creation and booking commit together. iOS and Android submit the same stable appointment and request IDs from their existing outboxes. Appointment and reminder records have independent schedule versions.
- The existing `field_sales_opportunities`, stages, sale records, credit rows, payment ledger and verification commands are reused. `field_sales_pipeline_command` accepts `deal` mutations with an opportunity ID. `field_sales_roofing_entry` scopes the entry form. `field_sales_command` accepts held appointment and door sources. `field_sales_roofing_contact` supplies a permission-filtered contact panel. Sale, completion and net cash continue to have independent values and dates.
- `field_earnings_command` publishes effective-dated plans, records adjustments and bonuses, reviews entries and records external settlement. `field_earnings_list` returns personal and permission-gated team statements. Web has plan publishing, review, credit allocation and CSV export. The public mobile apps have My Earnings and line-item details. The prior Pro Sales commission estimate is labelled separately from the ledger.
- The existing APNs registration and delivery code powers the iOS reminder worker. In-app alerts are drawn from current reminder records in all three clients. Appointments and earnings restrict direct table access. Every mutation checks workspace membership and capability in Supabase. Raw writes to legacy appointment sources are blocked for enabled workspaces, including direct PostgREST writes. The legacy calendar API and RLS also require event ownership or scheduling authority and valid contact scope.

## Calculation and permissions

The plan resolver chooses a representative-specific plan before the workspace role default. Within that scope it chooses the latest version effective on the qualifying date. Held inspection fees use the recorded held date. At verification, the ledger snapshots role, credit basis and plan version using the sold date. Later collections use that snapshot. A missing plan becomes a review exception. Existing historical records do not generate retroactive earnings.

Fixed amounts and percentages use integer minor units and exact numeric calculation. Optional sale-credit scaling uses cumulative rounding in representative ID order, so a shared pool of the same rate allocates exactly the rounded total. Default contract credit is 100% to the actual closer. Setter attribution and setter earnings remain independent. Final credit corrections retain history and need separate earnings adjustments where pay changes.

On the example $20,000 roofing contract, the held appointment accrues Alex’s $100 fee and an $8,000 receipt accrues Casey’s $400 at 5%. A $2,000 receipt refund creates a separate −$100 entry. A full reversal of the receipt reverses its original commission to the cent. Contract cancellation reverses contract-based earnings and preserves the held fee. Customer cash only changes through a receipt or reversal. Previous paid lines and references remain visible.

Owners and admins configure plans and pipeline stages. Authorized team managers can assign, review and settle. Anyone earning the entry needs another authorized approver for approval and settlement. The rep can read their own statement. Payment references document external payments.

## Migrations and cutover

Apply in order in a disposable staging project first. The iOS copies are mirrors of the Web migrations. Run each once in the shared Supabase database.

1. `20261110120000_roofing_appointments.sql` adds canonical records, history, access checks, request replay and legacy write guards.
2. `20261110121000_roofing_appointment_reminders.sql` adds the current reminder inbox and service-only APNs claim, recheck and delivery receipt.
3. `20261110122000_roofing_sales.sql` adds stable opportunity identity, one designated legacy opportunity per contact, roofing sale sources, duplicate review and original receipt references.
4. `20261110123000_roofing_earnings.sql` adds plan versions, locked sale snapshots, accrual and reversal rules, ledger reads and controlled review/settlement.
5. `20261110124000_roofing_entry_and_reporting.sql` adds entry context, linked contact views and Pro Sales reporting changes.

Before changing flags, take a schema snapshot and run the legacy reconciliation report with an explicitly selected workspace. The report is read-only and emits record IDs, exact timestamps and dispositions.

```sh
psql -v roofing_workspace='<workspace UUID>' -f supabase/scripts/roofing-legacy-appointment-audit.sql
```

Review cross-source exact matches and explicit source links. Keep single-source and ambiguous rows in legacy history. Never assign a historical setter or outcome from a contact owner, note or elapsed date. No legacy promotion is automated in this branch. Plan a reviewed mapping and UI de-duplication pass before promoting any legacy cluster. Keep old sale foreign keys and use the legacy history path during the pilot.

Deploy the clients with flags off. In an internal test workspace with Sales currency and timezone configured, enable appointment reads, then appointment writes, then the reminder flag after checking dispatch credentials. Enable roofing Sales and its write flag after all test clients have the new form. Enable earnings and its review/write flag for the setup team, publish and check the first effective plans, then allow bookings and verification that should accrue commission. Designate a second approver before settlement. Keep all other workspaces off. Confirm each step with the audit and test identities before admitting the roofing cohort.

For incident response, disable `roofing_appointment_writes_enabled`, `roofing_sale_writes_enabled`, `roofing_earnings_writes_enabled` and `roofing_reminders_enabled` in the affected workspace as appropriate. Leave the respective read gates on so canonical records remain visible. Keep the appointment read gate on during the pause to preserve the legacy write guard. Do not revert schema, delete ledger history or roll older clients into an enabled pilot. Rehearse pause/resume and receipt replay in staging before production.

## Feature parity and evidence

“Tested” below distinguishes a database fixture or browser harness from authenticated client acceptance.

| Feature | Web | iOS | Android | Tested | Build verified | Deployed | Field validated |
|---|---|---|---|---|---|---|---|
| Canonical booking, assignments, reschedule and outcomes | Implemented | Implemented | Implemented | Database, browser fixture; PostgreSQL concurrent booking replay | Next.js production, iOS simulator, Android debug APK | No | No |
| Mobile offline outbox and pending/failed display | N/A | Implemented | Implemented | Stable request replay at database boundary; on-device offline/restart acceptance open | Native builds | No | No |
| Appointment alerts | In-app | In-app and APNs worker | In-app | Database claim and stale reminder checks; live push delivery open | Web and native builds | No | No |
| Held conversion, door sale and sibling opportunities | Implemented | Implemented | Implemented | Database and browser fixture for held path; door path in database | Web and native builds | No | No |
| Attribution history and credit allocation | History and manager editor | History | History | Database and browser fixture | Web and native builds | No | No |
| My Earnings and line-item details | Implemented | Implemented | Implemented | Database and web fixture | Web and native builds | No | No |
| Plan publishing, approval, external settlement, adjustments and statements | Implemented | Web manager workflow | Web manager workflow | Database and browser fixture for approval and payment; refund/chargeback in database | Web build | No | No |
| Redesigned contact workspace | Shared panel wired into classic lead record | Contact and lead booking | Contact and lead booking | Redesign integration pending | Classic route builds | No | No |

## Test commands

- Run `roofing_appointments.mjs` and `roofing_sales.mjs` from the iOS `supabase/tests` directory with the existing PGlite fixture. The latter also accepts `ROOFING_PG_MODULE` and standard PG connection settings to run against an empty disposable PostgreSQL database and exercise independent connections.
- Use Web’s `scripts/field-sales-validation.mjs` with `ROOFING_SALES=1`, `SALES_FIXTURE` pointing at the iOS fixture module and `SALES_TEST_PORT=4322`. Run `node scripts/roofing-browser-acceptance.cjs` against that harness. The harness uses the real components and migrated SQL with synthetic authenticated identities.
- Web production build uses `npm run build`. Android uses `./gradlew :app:assembleProductionDebug`. iOS uses the public `WolfGrid` scheme with an iOS Simulator destination. Record signed builds and installed versions separately in the pilot log.

## Remaining release work

- Review and integrate the three-column contact redesign from its own work. Mount `RoofingContactPanel` in the right sidebar using the selected contact ID and name. Keep provider communication components in the middle and hide the older appointment editor when the canonical panel is enabled. The redesign is still separate from the isolated baseline.
- Rehearse the reviewed legacy mapping and backfill before promoting historical rows. Unmatched records stay available through legacy activity. No outcomes or compensation are inferred.
- Verify actual staging Supabase auth and workspace scoping, real notification delivery, end-to-end device sync and offline recovery on both mobile platforms. Run the user’s workflow beginning on each platform. Validate currency, timezone, duplicate review, refund, reversal and audit exports. A synthetic fixture cannot establish these outcomes.
- Obtain the internal and roofing pilot workspace/rep assignments and approved signed distribution. Record per-workspace migration counts, gate changes, sync failures, duplicate conflicts, stale reminders and discrepancies in ledger reconciliation. Expansion and public store publication require separate acceptance.
