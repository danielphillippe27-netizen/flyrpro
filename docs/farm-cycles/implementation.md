# Explicit farm cycles

Implemented on November 5, 2026. Production migration `20261106012000` was applied during the web release and verified: all farms have an active cycle row, RLS is enabled, and both cycle RPCs are present. The migration number was moved from `20261106010000` to avoid the existing CRM migration. Native apps are unchanged.

## Behaviour

- Each farm persists one `active_cycle_number`. New farms start at 1.
- Farm Settings shows the current cycle, start date, reached homes, editable optional end date, and a confirmed action to start the next cycle.
- History retains earlier cycle dates and coverage/session counts. Earlier end dates can also be edited.
- End dates use calendar dates, can be cleared, and cannot precede the cycle start. Saving a date never changes cycle membership or advances a round.
- The working web map and dashboard follow the active cycle without a cycle selector or Master/All Time toggle. Existing lifetime supporting totals and activity history remain available.
- New ordinary sessions and touchpoints use the active cycle. Explicit planned/offline assignments are preserved, including existing future plans. Plans never determine the active cycle.
- A new round starts fresh coverage. No session, contact, note, lead, follow-up, or outcome is deleted. Do-not-knock markers remain visible across rounds.

## Persistence and rollout

Apply `supabase/migrations/20261106012000_explicit_farm_cycles.sql` before deploying this web change. The client deliberately fails session creation if cycle settings are unavailable, instead of silently assigning the wrong cycle.

The migration backfills the active cycle from recorded activity, excluding scheduled-only future plans. Existing explicit session numbers are retained; missing legacy numbers use chronological fallback. It creates `farm_cycles`, date/transition RPCs, RLS, initial-cycle creation, and a default-assignment trigger for unassigned sessions.

Cycle transitions lock the farm and check the expected active number. End-date writes check the previous update timestamp. Direct active-number changes cannot bypass the transition records. Owner/workspace membership is checked before each write. Offline sessions with an explicit older cycle stay there when synchronized.

Native iOS/Android screens and cycle-resolution code were not changed here. They must adopt `active_cycle_number` and the cycle RPCs before claiming cross-platform parity. Old clients that send explicit cycle numbers retain those assignments; the database intentionally does not rewrite them. A farm refresh reads the persisted active cycle; no new live subscription was added.

## Validation

- Farm cycle unit checks: active cycle independent of future plans, multiple outings in one cycle, fresh-round coverage, history retention, end-date validation, do-not-knock persistence.
- Existing performance, session-total, and touch-plan tests passed.
- 23 isolated PostgreSQL assertions passed with PGlite: migration/backfill, end-date edits, clearing dates, stale-write rejection, date ordering, invalid direct updates, next-cycle transition, duplicate transition rejection, history edits, access isolation, workspace access, and offline/default assignments.
- Mocked-persistence browser checks passed at 320, 390, and 1100 px: current/history date edits, invalid dates blocked before writes, dirty-date guard, next-cycle confirmation, updated active cycle and next end date. The narrow confirmation screenshot was visually inspected. These are component checks, not a live-account walkthrough.
- Targeted lint: no errors, one existing farm-page image warning.
- Full-project TypeScript check: blocked by unrelated errors in integrations, demo player, sessions, and existing test files. No diagnostics in the changed cycle files.

Re-run unit tests using the existing `../system-tests/node_modules/.bin/tsx` runner. Run browser checks with `node scripts/test-farm-cycles-browser.cjs`. Run database checks with `PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-farm-cycles-db.mjs`; the harness creates an in-memory fixture and never reads `.env` or connects to Supabase. The validation-only PGlite installation used `/tmp/wolfgrid-cycle-validation`, without changing project dependencies.
