# Annual farm coverage planning

The farm Plan tab now has Touchpoint plan and Annual farm coverage modes. The original touchpoint plan and daily assignments remain available. The browser remembers its preferred mode per farm; each saved annual plan is stored on the farm.

Choose a start date, 1–10,000 homes per week, and a 1–52 week calendar horizon. Each week is a seven-day block from the start date. Mark any holiday weeks off explicitly. The planner allocates each eligible farm home once, grouped by the existing street/house ordering; holiday weeks get no homes. No statutory holidays are inferred. Do-not-knock homes are excluded and reported.

The preview shows available working weeks, required pace, unassigned homes, planned finish, cumulative planned coverage, actual unique door coverage, and weekly home lists with export/contact handoff. Saving is blocked if the selected weekly pace cannot cover every eligible home in the available weeks. Assignments are planning lists, not optimized walking routes or confirmed occupied-home counts.

The endpoint resolves the user and farm through existing access helpers. It rebuilds assignments from paginated canonical farm addresses and never trusts client-supplied allocations/counts. The existing daily door plan is stored separately. An additive migration adds `farms.annual_coverage_plan` and reloads the API schema.

Actual coverage is the first valid recorded doorknock outcome for each planned farm home within the annual plan's local calendar window, capped at now. Repeat visits count once. Planned touches, flyer delivery, DNC markers and invalid/orphan/future events do not establish door coverage. No session completion requirement is added. Historical status revisions within a session cannot be reconstructed from the existing per-session/home outcome snapshots.

Verification:
- `npx tsx lib/farms/__tests__/annual-coverage.test.ts`: full allocations, holiday gaps, shortened horizons, capacity shortfalls, stable ordering, DNC exclusions, leap years, settings validation, and real-activity definitions.
- `npx tsx lib/farms/__tests__/door-plan.test.ts`: existing daily allocation regression passes after sharing the canonical home ordering helper.
- `node scripts/test-farm-annual-coverage-api.cjs`: route boundary checks for authentication/access, invalid settings, no writes on failures, server-authoritative allocations, pagination and persistence responses.
- `node scripts/test-farm-annual-coverage-browser.cjs`: local test-fixture checks for modes, targets, holidays, suggested pace, save/reload, weekly lists, contact handoff, CSV and 320/390/768/1440px layouts.
- ESLint has no new errors. Full repository type checking still reports existing unrelated errors; no diagnostics in the changed annual planner files.
