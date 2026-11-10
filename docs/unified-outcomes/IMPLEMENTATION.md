# Unified campaign and farm outcomes — November 7, 2026

## Status

The initial implementation and validation ran locally in the web and iOS working trees. On November 9, 2026, the linked Supabase connection passed a rollback rehearsal against the production schema. Migration `20261107020000` was then applied and recorded. Verification confirmed the receipt table and the authenticated RPC grant. The migration did not rewrite historical rows.

## Behavior

- `v3_record_field_outcome` validates campaign/farm/touch/session identity and requires exactly one saved farm-home link for every campaign address. Missing or ambiguous links reject the whole operation; it never guesses from address text, building IDs or proximity.
- The transaction reuses the campaign revision, permission, manual-pin, workspace-coverage and mutation-receipt protections. It saves campaign status and farm touch history together. A failure rolls back both, including campaign receipts and session events.
- A separate receipt binds the complete request to its original farm/touch. Replays cannot transfer credit to a different round. Single-home calls retain the original campaign receipt key for pre-upgrade queued edits.
- Older standalone farm writes remain callable with timestamp conflict protection. Only the private, revision-checked path may supersede history without that legacy timestamp gate.
- Do Not Knock and reset are saved outcomes but do not add visit/coverage credit. Previous farm rounds remain in history. Reset affects only the selected touch. Notes survive ordinary status-only edits.
- Session target completion totals use latest distinct target events instead of incrementing again on a status upgrade. A reset/exclusion with session context retracts that session's credit.
- Campaign dashboard counts use address outcomes instead of legacy roof statuses. Explicit exclusions override stale visited flags. A zero contacted count no longer falls back to building count.
- iOS stores campaign/farm changes and one queued operation atomically, including farm edits without an active field session. The queue keeps original farm/touch context. Farm revision conflicts require review and cannot be silently discarded by automatic campaign-conflict resolution.
- Web farm controls, house-detail controls, recipient status changes and the campaign-state API use the same transaction. The API no longer performs separate farm count increments. The legacy contact-timing bridge remains outside the field-visit UI migration; contact identity consolidation was not attempted.

Visits, conversations, unique homes and rounds remain distinct measures. Repeated legitimate touches in different rounds remain distinct visits; unique coverage counts a home once within its reporting scope. Missing links are visible failures, not successful partial saves.

## Validation

- 42 isolated PostgreSQL assertions passed against the actual migration and actual campaign outcome functions, including manual-pin and workspace-coverage wrappers. Authentication/client-policy dependencies and geometry use test fixtures. These tests do not establish live database parity.
- 24 shared web service/counting assertions passed.
- 20 existing farm-cycle assertions and 4 new exclusion/history assertions passed.
- iOS simulator: 27 passed, 0 failed, 3 skipped (unavailable local fixtures). Includes atomic local save/rollback, revision conflicts, saved context without an active session, note retention and acknowledgement behavior.
- Final simulator result: `/tmp/WolfGrid-field-repair/Logs/Test/Test-WolfGrid-2026.11.07_07-50-36--0500.xcresult`.
- Changed web files: lint has 0 errors and 2 existing warnings (image element and existing effect dependency). Full repository TypeScript still has 46 errors outside these changes; no changed-file errors were reported.
- Both repositories pass `git diff --check`.

Run database tests with `PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-unified-field-outcomes.mjs`. The tests use an isolated in-memory database and never load project credentials.

## Read-only production findings

See `live-audit.json`. The paginated API audit is not a transactionally consistent snapshot.

- 31 farms; 8 have no linked campaign.
- 64,686 farm homes; 2,412 have no campaign-address link.
- 465 duplicate farm/campaign-address link groups.
- 22 attributed farm sessions; none missing a touch. One session on a linked campaign has no farm attribution and requires review before assigning it to a round.
- 137 per-home outcomes, including 2 Do Not Knock outcomes.
- 11 touch totals differ from qualifying per-home visit outcomes. Some may be legitimate manually recorded totals; differences alone do not authorize reconstructing history.
- Repairs applied: zero.

## Remaining rollout and acceptance

1. Deploy the web changes after the verified database migration. New clients require the unified operation.
2. Install a build containing the scoped iOS changes.
3. On an authorized test farm, record an outcome on a phone, confirm campaign and farm views on web, go offline, change status and notes, restart, reconnect and verify one completed sync with unchanged original round attribution. Repeat with a bulk target, Do Not Knock and reset.
4. Review address-link and historical-total discrepancies by ID. Repair only verified links/aggregates; do not fabricate missing touches from latest campaign status, merge ambiguous homes, or reassign historical sessions to the current round.

A live phone-to-web acceptance run, network reconnect against production, deployed old-client compatibility, and historical repairs remain outstanding. The local checks are not release evidence.
