# Shared team home coverage

## Accepted scope

One coverage policy per workspace. Default off. Only the workspace owner or an
owner/admin membership (the existing manager role) can change it or override a
cross-campaign lock; campaign ownership alone is insufficient. No global locks.

## Implementation

1. Database-owned setting and durable home coverage ledger, with membership RLS.
2. Conservative address identity: stable source identifier plus the complete
   normalized address (including unit). Never merge on building geometry or
   building ID alone. Synthetic/manual/reconciliation identities stay unmatched.
   Source-ID churn or different datasets require explicit reconciliation later;
   do not automatically merge one-to-many GERS mappings.
3. Keep visited history when campaigns are archived or a status is cleared.
   Active unvisited campaign overlap is informational, not a reservation.
4. Serialize first-touch writes against the shared ledger. Reject duplicate
   cross-campaign writes with WORKSPACE_HOME_ALREADY_VISITED, including offline
   replay. A manager supplies a 3–200 character override reason. Keep campaign
   status/revision separate from workspace coverage; never copy foreign notes.
5. Settings controls on web, iOS, Android. Coverage summaries and selected-home
   notices use the same server snapshot; refresh during active use.
6. Test default-off behavior, role restrictions, tenant isolation, apartment
   identity, archived history, manager override, direct-write backstop, and replay.

## Operational limits

Offline devices cannot learn about a visit that has not synced yet. Server
conflicts prevent accepting duplicate synced outcomes, but cannot physically
prevent simultaneous offline knocks. Campaign overlap warnings do not promise
exclusive territory assignment. The setting remains off until intentionally
activated. Source/build tests do not prove deployed or installed-device behavior.

## Delivery state

Implemented and published to the production web/backend on 2026-09-19:

- Web Settings and Team Settings, iOS Settings, Android Settings have the owner/
  manager control. Members have no toggle; the database enforces the permission.
- Mobile maps/cards consume separate coverage, show visited locks and overlap
  notices, and preserve individual unit selection. Web maps show campaign
  summaries and selected-home notices. No foreign notes are copied.
- Shared ledger, backfill, atomic single/bulk guards, audited overrides and
  idempotent rejected receipts are in the migration. Old direct status writes
  cannot bypass the guard. Web status writes now preserve the caller's identity
  and report rejected outcomes rather than treating them as successful saves.

Verification:

- 36 isolated PostgreSQL assertions passed using PGlite, the real new migration,
  real existing v2 single/target outcome functions, and manual-pin guard. Auth,
  access and client-policy dependencies use a minimal fixture schema. This is
  not a live Supabase schema migration or a two-connection concurrency test.
- 4 Android coverage tests passed; production-debug Kotlin compilation passed.
- 3 standalone Swift coverage model checks passed; final iOS simulator build
  passed. XCTest source is included for the normal app test target.
- Focused web ESLint and all three repository diff checks passed. Full web
  TypeScript checking remains blocked by errors in unrelated existing files
  (integrations, session start, demo100 and other existing modules); no coverage
  file errors were reported.
- Production field Supabase migrations applied to `kfnsnwqylsdsbgnwgxva`.
  All 232 workspaces explicitly disabled; enabled column default verified false.
  A rollback-only live check passed owner access, enabled/disabled coverage
  reads and anonymous toggle rejection. No workspace was left enabled.
- Live validation corrected the profile-name query to first_name/last_name and
  refreshed expression-index statistics after an initial enabled-read timeout.
- Web production build passed. Application code is deployed from `d91a13b4d`;
  subsequent commits contain database follow-ups, tests and this release record.
- iOS source pushed as `262699d8d`; Android source verified on its upstream at
  `4c92ccdc94b32a861615ccb5e647a5deaf80bc13`. No new App Store or Play Store binary
  was uploaded in this release.
- Real-device visuals, authenticated browser flows, live multi-rep sync and
  two-connection concurrency remain unverified. No workspace activation.

Run the database checks from Wolfgrid-WEB:

```sh
npm install --prefix /tmp/wolfgrid-coverage-test --no-audit --no-fund @electric-sql/pglite
PGLITE_MODULE=/tmp/wolfgrid-coverage-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-workspace-coverage.mjs
```

Before activation, test simultaneous writes with two authenticated reps and
ship compatible mobile clients. Keep the default off. The production migration
uses an immutable expression index rather than rewriting
address rows or firing their update triggers. Existing workspaces are explicitly
seeded with enabled=false; workspaces without a settings row also resolve to off.
