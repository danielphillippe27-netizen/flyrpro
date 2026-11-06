# Campaign creation optimization — November 3, 2026

Implemented locally in Wolfgrid-WEB. No push, deployment, or phone installation performed.

## Changes

- Read municipal address/building manifests in bounded batches of six instead of serially. Each municipality reads its address and building manifests concurrently, so at most twelve manifest requests are active in that stage.
- Fetch up to six address tiles at a time and process them in the original x/y order. This preserves address deduplication, ordering and home-limit selection. A capped scan can prefetch up to five extra tiles in its final batch.
- Read parcel manifests while scanning address tiles.
- Load scoped building/parcel geometry while saving campaign addresses. Geometry extraction reads static artifacts; target generation and canonical bundle publication still wait for both branches. Both branches settle before failure handling or retry begins.
- Remove the preliminary address-count query and repeated pre-insert/no-op counts; combine consecutive source/loading status writes.
- Save stage timings on map readiness: source resolution, address ingestion, scoped geometry (including substeps), geometry targets, snapshot persistence and canonical bundle publication.
- Set the initial map-ready timestamp after bundle preparation; later post-processing still has its existing timestamp behavior.
- Discard failed cached catalog promises so a transient error does not poison subsequent requests in the same process.

## Measured source-loading results

Read-only calls to the real Durham municipal source for the same 172-home Oshawa polygon used in earlier campaign tests. Each variant started in a fresh process for each trial; a second call measured the warm path. Trial ordering alternated to reduce ordering bias. These calls did not create campaigns or change production records.

| Source lookup | Before | After | Median change |
|---|---:|---:|---:|
| Cold trial 1 | 2,918ms | 2,836ms | |
| Cold trial 2 | 3,046ms | 2,460ms | |
| Cold trial 3 | 2,916ms | 2,496ms | |
| Cold median | 2,918ms | 2,496ms | 14.5% faster |
| Warm median | 110ms | 35ms | 68.2% faster |

Exact contents and order of all 172 normalized address records matched across all twelve full source calls. Separate before/after calls capped at 25 records also returned identical contents and ordering. This is source-resolution improvement, not a measurement of total campaign creation or iPhone display latency. The address/geometry overlap and removed database round trips have not yet been measured end to end.

## Verification

- Six concurrency/timing tests pass, covering ordering, request bounds, overlapping branches, failure draining, synchronous errors and failed-stage timing.
- Twenty geometry-target regression tests pass, including partial/zero coverage, retries, moved stops, capacity and property eligibility.
- Eight canonical-map ownership/rendering fixtures pass.
- Four provisioning-quality fixtures pass.
- Full TypeScript check remains blocked by existing errors in untouched files (settings integrations, static snapshots and other unrelated code). It reports no errors in the changed provisioning route, municipal source loader, concurrency helper or its test file.
- Existing strict-linker changes in the provision route were preserved. Other pre-existing repository changes were not altered.

Raw benchmark outputs, before-source snapshot, summary.json, typecheck log and the patch relative to the starting files are saved locally under artifacts/campaign-performance-2026-11-03/. Concurrency regressions run with `npx tsx --test lib/services/__tests__/ProvisionConcurrency.test.ts`.

## Remaining validation

Deploy the backend changes and repeat the three campaign tests against the deployed version, then capture one iPhone create/open trace. Confirm persisted stage timings, exact campaign home counts and map readiness. Earlier live campaign tests showed canonical/raw building and parcel count differences; this work does not resolve or claim to validate those existing geometry differences.
