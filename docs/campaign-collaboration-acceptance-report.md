# Campaign Collaboration Acceptance Evidence

This document tracks execution evidence. Static code presence is not a pass.

## Production Supabase environment and execution

- Executed: 2026-07-16 against the production Supabase project **FLYR APP** (`kfnsnwqylsdsbgnwgxva`), after the user explicitly selected that project.
- Migration: `20260716130000_campaign_collaboration_v2.sql` was applied through the authenticated Supabase Management API and recorded as applied in `supabase_migrations.schema_migrations`.
- Command: `npx --yes supabase@latest db query --linked --file supabase/tests/campaign_collaboration_v2.test.sql --output json`.
- Result: **39 assertions passed, 0 failed** (`1..39`). These were executed by PostgreSQL/pgTAP on FLYR APP, not parsed or inferred locally.
- Isolation: the pgTAP fixture runs inside a transaction and rolls back. A post-run query confirmed zero retained fixture campaign-address rows.
- Post-run integrity: all eight collaboration columns exist, all five v2 RPC names exist, and both `campaign_addresses` and `address_statuses` are in the `supabase_realtime` publication.
- Live-schema issues caught by this run: `campaign_addresses.seq` is generated-always on FLYR APP, and legacy retry hashes were changing with the server-derived revision. Both incompatibilities were corrected before the passing run.

## Zero-user production enforcement

- iOS minimum: version 1.25, build 9; enforced immediately at `2026-07-16T18:52:13.006858Z`.
- Android minimum: version 0.1.5, build 6; enforced immediately at `2026-07-16T18:52:13.006976Z`.
- Legacy campaign writes: disabled immediately at `2026-07-16T18:52:13.006980Z`; legacy RPC names remain available as read-safe `CLIENT_UPGRADE_REQUIRED` rejection shims.
- Gate probes: iOS 9 and Android 6 are allowed; iOS 8, Android 5, and legacy writes are rejected.
- Post-enforcement pgTAP result: **39 passed, 0 failed**. The suite now controls its pre/post-cutoff state inside the rollback transaction, so existing production enforcement cannot invalidate the compatibility assertions.
- Final production snapshot: migration recorded, both Realtime tables published, RLS enabled on all three collaboration tables, nine canonical RLS policies present, and zero test fixtures retained.

There is no separate staging project configured in this workspace to compare against FLYR APP. Production was therefore compared directly with the canonical migration: the policy names, commands, roles, `USING` expressions, and `WITH CHECK` expressions match; no canonical-policy drift was found.

## Original 11 backend acceptance scenarios

| # | Scenario | Executed pgTAP evidence | FLYR APP status |
|---|---|---|---|
| 1 | Exact client pin UUID; repeat create replays | Assertions 1–5 | Passed |
| 2 | Changed input cannot reuse a mutation ID | Assertion 6 | Passed |
| 3 | Status replay creates one event and increments visits once | Assertions 8–10 | Passed |
| 4 | Legacy retry fingerprints deduplicate | Assertions 24–29 | Passed |
| 5 | Expired receipt cannot duplicate permanent audit event | Assertion 7 | Passed |
| 6 | Receipt cleanup deletes only expired rows | Assertions 37–39 | Passed |
| 7 | Active assignee view and zone-scoped mutation | Assertions 32–36 | Passed |
| 8 | Ordinary teammate overwrite is locked | Assertion 11 | Passed |
| 9 | Actor correction and reasoned manager override | Assertions 12–15 | Passed |
| 10 | Stale status, pin update, and pin delete preserve canonical revision | Assertions 16–23 | Passed |
| 11 | Legacy and below-minimum clients are rejected after cutoff | Assertions 30–31 | Passed |

## Required compounding conflict

The pgTAP contract executed web pin create at revision 1, web edit to revision 2, stale iOS submission against revision 1, canonical revision preservation, and explicit iOS reapply to revision 3. Assertions 16–19 passed on FLYR APP.

The iOS client-side half has separate simulator evidence in `CampaignMutationConflictTests`: the offline draft remains intact, the canonical revision is read, explicit reapply retains the draft values while rebasing to the latest revision, and a new mutation ID is required.

- Executed: 2026-07-16 on iPhone 16 Pro simulator, iOS 18.6.
- Result: 4 tests passed, 0 failed.
- Result bundle: `/Volumes/Samsung SSD/WolfGrid/.deriveddata-ios-conflict/Logs/Test/Test-WolfGrid-2026.07.16_14-11-41--0400.xcresult`.

## Scope note

This evidence validates the server contracts and the iOS conflict state machine. It does not claim that physical iOS and Android devices plus a browser were manually observed together; that remains a release-candidate end-to-end UI pass.
