# Farm performance dashboard

Implemented in the existing `/farms/[id]` Dashboard tab. No new routes, chart dependencies, database migrations, or production fixtures. The dedicated Map tab is outside this change.

## Data definitions

- Uses existing `farm_touches`, `farm_touch_addresses`, `farm_addresses`, and `farm_leads` reads under their existing authorization policies.
- One outcome per session/home; latest revision wins. Different sessions can count legitimate repeat activity. Does not read GPS or sync telemetry.
- Door attempts are doorknock outcomes marked attempted (`delivered`), `no_answer`, or a conversation outcome. Conversations are `talked`, `lead`, `interested`, `appointment`, `follow_up`, `appointment_set`, `callback_requested`, `future_seller`, and `hot_lead`. `none` and DNC markers do not establish a visit. Flyer delivery contributes farm coverage, not door attempts.
- Includes valid recorded outcomes in active sessions. Excludes orphan homes/sessions, invalid dates, and future outcomes.
- Coverage counts distinct current farm homes reached by valid farm touches, preserving the earlier baseline when viewing a shorter chart range. Historical percentages use the current home inventory because no historical inventory snapshots exist.
- Lead KPI counts actual unique farm lead rows, scoped by session link in current-cycle mode. Unlinked leads only appear All Time; there is no date-based inferred cycle attribution.
- 7D/30D daily, 90D weekly (Monday), All Time monthly. Dates use the viewer's local calendar, matching existing UI date conventions. Period summary averages use sessions with recorded door activity in range.
- Outcome history is a per-session/home snapshot, so multiple visits to the same home within one session cannot be reconstructed. No additional visits are invented.
- Existing secondary metrics retain the existing analytics builder; contact rate there remains the legacy CRM contacts/farm-touch ratio and is explicitly separate from the primary door answer rate.
- Farm session, outcome and lead reads now paginate using the existing pagination helper. Outcome query failures enter the existing load-error/retry state rather than showing false zero metrics.

## Verification

- `npx tsx lib/farms/__tests__/performance.test.ts`: passes deduplication/revisions, active sessions, revisits, modes, cycles, leads, range grouping, cumulative baseline and empty-state tests.
- `node scripts/test-farm-performance-browser.cjs`: isolated local fixture browser checks pass time ranges, scope switching, keyboard arrows/Enter, session callback, touch inspection, empty states, dark/light, reduced motion, and no overflow at 320/390/768/1440px. Test data exists only in the test harness.
- ESLint: no errors in changed files; existing image warning in the farm page.
- Repository-wide TypeScript check has unrelated existing errors (settings integrations, field-recording modules and other areas). No diagnostics in the new dashboard/model, farm page or FarmService at time of check.
- Browser checks are component-level, not a signed-in live farm integration test. No deployment performed.
