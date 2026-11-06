# Strict automatic building linker — implementation and verification

Implemented and tested locally on November 3, 2026, then deployed to production at the user’s request. Backend and database deployment completed; campaign cleanup and physical-device installation were not performed.

## Behavior

- Automatic optimization preserves existing assignments and manual edits. Reset requests fail before any deletion.
- Only an unlinked address and an unlinked building can form a new automatic pair. Building row IDs and public IDs reserve the same building.
- Nearby addresses, shared parcels, townhouse flags, unit counts, and address counts no longer grant permission to add multiple addresses.
- Parcel bridges require one address and one eligible footprint, counting occupied/protected objects before filtering. Explicit street conflicts and overlapping parcel ownership stay unresolved.
- Proposals are evaluated together. A sole containment claim can beat a weaker claim, but competing claims at the same level stay unresolved. Rejected candidates are never retried against a neighboring home.
- Reconciliation preserves occupied buildings and sends existing reassignment decisions to review. Global automatic assignments must be isolated pairs rather than second-choice assignments to improve coverage.
- Bundle parcel placement cannot recreate a many-to-one group. Existing explicit multi-address associations retain their separate pins.
- New automatic link records and Gold mirrors save in one transaction. Campaign-level locks and database guards reject conflicting concurrent writes, including direct legacy writes. Explicit manual grouping remains available.
- Legacy SQL linkers that begin with a destructive campaign reset fail closed. Use the additive backend path.
- Both iOS fallback implementations follow the strict rules, and the Sales address model now decodes canonical pin placement so it is not reinterpreted offline.
- Summary coverage includes preserved assignments; `added` reports only this run's new links. Read-only previews never save links or orphan records.

## Verification

- 44 backend linker regression fixtures passed, including eight addresses on two streets, occupied buildings with unit flags, Gold-only assignments, parcel ambiguity, candidate competition, order independence, retry behavior, read-only preview, aliases, and reset protection.
- Parcel pin placement and reconciliation rule regression suites passed. Confirmed townhouse groups retain distinct placements; new shared-roof groups are rejected.
- 15 isolated PostgreSQL 18.6 integration checks passed, including two independent database connections racing for the same building through link/link, Gold/link, and Gold/Gold writes, transactional rollback, manual protection, aliases, Gold mirrors, legacy write rejection, and campaign isolation. These checks install the migration against a minimal local schema; they do not replay the full historical PostGIS/Supabase migration chain.
- All 15 `ClientMapLinkerServiceTests` passed in an iPhone 17 Pro simulator, including the new screenshot, occupied multi-unit, shared-parcel, and manual-pin cases.
- The companion WolfGrid Sales simulator build passed.
- Lint passed on changed service/test files. The repository-wide TypeScript check has 46 errors elsewhere in the repository and zero errors in the changed linker, parcel, reconciliation, or preview files.

## Read-only Lake campaign preview

Campaign `50f752dc-57c9-4d7c-a289-f897433fc9f2` matched the screenshot streets.

- 547 source addresses; 439 existing assignments preserved by the additive preview; 0 new assignments proposed.
- The screenshot building currently has 11 automatically linked addresses across E Parks St and S Tennessee Ave. Their stored match type is `point_on_surface`. The screenshots showed eight; this audit describes the later stored state and does not infer why the count changed.
- A fresh-link simulation clears assignments only in local copies. It accepts 180 pairs and leaves 367 addresses unresolved (33% coverage), and proposes zero addresses for the screenshot building. This is deliberately conservative and should not be used as a bulk replacement for the existing campaign.
- 59 existing multi-address groups span multiple streets. These are review candidates, not 59 proven errors; legitimate corner/multi-unit properties can have different street addresses.
- The focused audit is saved in `strict-linker-lake-preview-2026-11-03.json`. No production links, source coordinates, leads, or visit history changed.

## Reproduction

From the web repository:

```sh
npx tsx lib/services/__tests__/StableLinkerService.test.ts
npx tsx lib/services/__tests__/ParcelPinPlacement.test.ts
npx tsx lib/services/__tests__/CampaignMapReconciliationRules.test.ts
```

For database tests, supply `STRICT_LINKER_TEST_DATABASE_URL` pointing to a disposable, empty localhost database named `wolfgrid_strict_test`, then run `node scripts/test-strict-building-linker-db.mjs`. The script refuses nonlocal targets and existing campaign schemas. The test requires PostgreSQL and the repository's existing `pg` dependency; temporary PostgreSQL binaries used during this session were installed outside the repository.

Read-only preview with the existing project credentials:

```sh
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/preview-strict-campaign-linker.ts 50f752dc-57c9-4d7c-a289-f897433fc9f2
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/preview-strict-campaign-linker.ts 50f752dc-57c9-4d7c-a289-f897433fc9f2 --simulate-unlinked
```

## Rollout and cleanup

Deploy in a coordinated window with older optimization workers drained. The new backend requires `20261103140000_strict_additive_building_linker.sql`; until the RPC is installed, automatic saves fail closed. Do not leave older workers that reset assignments running during the transition. Then verify one small newly created campaign and one optimization rerun before broader use. iPhone fallback changes require a new app build.

Existing wrong assignments are intentionally unchanged. Review the screenshot group and other cross-street groups separately, retain assignments supported by evidence, detach only unsupported automatic links, and regenerate affected map bundles. Do not bulk rerun the fresh-link simulation as a cleanup operation.

## Production release — November 3, 2026

- Production: https://wolfgrid.app; Vercel project `flyrpro` in the confirmed account.
- Backend source pushed to `main`: `91762cb4b0e297e8fa08178cd4aa4db3cd199f38`. This includes the strict-linker change `fb5dec458` and preserves the newer committed map-notice change from main. Uncommitted workspace edits were excluded.
- Staged production deployment `dpl_7ghM4KyKhGC3dhdwfgweD9x4YNMs` built successfully and was promoted.
- Migration `20261103140000` passed a rollback-only check against the live schema, was applied, and was recorded in Supabase migration history. Both strict guards are enabled.
- Temporary gates protected link resets during the switch; all four temporary triggers were removed afterward.
- A rollback-only check under the actual `service_role` rejected an additional address targeting Lake’s occupied screenshot building. The empty-batch RPC also returned zero as expected.
- After release, Lake remains at 439 links; the screenshot building remains at its previous 11. No existing campaign links were cleared or repaired.
- Production homepage returned 200, unauthenticated matches returned the expected 401, and authenticated invalid internal-worker input returned the expected 400. No error/fatal runtime logs appeared in the initial deployed-release scan.
- iOS fallback source changes remain locally tested and require a separate app release.
