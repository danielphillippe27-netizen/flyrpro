# Campaigns with missing address coverage

Campaign setup now probes property geometry independently of address coverage. A missing or empty address layer can produce a usable campaign when eligible buildings or residential/address-bearing parcels exist. Partial coverage adds only uncovered stops. The campaign remains usable while address enrichment is pending or unresolved.

## Parcel-first geometry fallback

For new fallback stops, each eligible occupied parcel gets one stop at an interior area-weighted center, even when several buildings occupy it. Building stops are used only where no usable parcel identity exists. The same parcel geometry validates reverse-geocoded results, so an address can be accepted inside the parcel without intersecting a roof. Source parcel address attributes are reused when available. Units are supplied by the user, never inferred from the number of footprints.

Existing authoritative addresses, units, legacy geometry stops, and field history remain intact. This is an additive provisioning change, not a destructive campaign consolidation. Explicit hospital/industrial parcels are excluded. The canonical renderer retains the parcel-center pin for these new targets while preserving existing/manual/unit placement rules.

## Stop identity and safety

- Geometry stops are ordinary `campaign_addresses` rows, so existing mobile visit, note, assignment, and routing flows use their persistent UUIDs.
- Stable `synthetic:geometry-target:<kind>:<source-id>` identifiers make provisioning retries additive and idempotent. The synthetic prefix deliberately excludes unverified property identities from shared workspace civic-address coverage.
- Unaddressed stops show `Address pending`. Source building/parcel number-and-street attributes are used first when available.
- Explicit accessory/non-residential buildings, tiny footprints, outside-boundary display-buffer buildings, and unknown/vacant parcels do not become stops. A parcel with an existing address does not produce a second generic building stop. Ambiguous multiple homes/units remain conservative; existing units are preserved.
- Source addresses arriving on a later provisioning attempt can enrich a uniquely contained provisional stop in place. Multi-unit groups do not collapse into one target.
- Enrichment updates civic text only. It never changes the stop UUID, geometry, source ID, visits, notes, outcomes, assignments, or canonical links. Manual address edits and locked links win.

## Background processing

`/api/cron/address-enrichment` runs every minute and claims up to 24 targets from one campaign, with six concurrent provider requests. Claims have five-minute leases. Transient failures retry up to three attempts; misses or ambiguous matches remain unresolved for review. Expired leases recover automatically. Successful data writes retain a bundle-refresh marker until a replacement canonical map bundle is saved.

Automatic provider enrichment uses the existing configuration:

- `MAP_RECONCILIATION_ENABLE_REVERSE_GEOCODE=true`
- `MAPBOX_GEOCODING_STORAGE_MODE=permanent`
- `MAPBOX_TOKEN` (or the existing public-token fallback)
- `MAP_RECONCILIATION_MAX_GEOCODES_PER_RUN` must not be zero
- `CRON_SECRET` authenticates the scheduled worker.

Temporary geocoding results are never persisted by this worker. If permanent geocoding is unavailable, stops remain usable and progress reports `needs_configuration`. Only rooftop/parcel results whose returned point lies inside the target geometry and matches its region/country are accepted. A transactional duplicate check prevents two stops from claiming the same civic address.

`GET /api/campaigns/:id/address-enrichment` returns pending/confirmed/unresolved counts. Owner/admin `POST` retries unresolved labels without provisioning the campaign again. Backend-managed enrichment columns cannot be forged through ordinary client address updates.

The existing reconciliation endpoint and map bundles incorporate enrichment progress. Existing web/iOS/Android polling continues until a matching bundle is published. For campaigns with geometry targets, `run_id` is a presentation revision (`address-enrichment:<hash>`), and `reconciliation_run_id` retains the underlying optimizer job ID. Presentation revisions are cache/adoption keys, not database job IDs. Existing active-session snapshot protections still apply.

## Routing

`WA`, `NT`, and `NC` use the campaign's geographic boundary to select their country before the Diamond or Bedrock probe. This distinguishes Washington/Western Australia, Northwest Territories/Northern Territory, and North Carolina/Northern Cape.

## Release order

1. Apply `supabase/migrations/20260919180000_campaign_geometry_targets.sql` to the public field project, not the internal Sales project.
2. Deploy the matching web backend, including the scheduled worker. Confirm the permanent-geocoding configuration and cron authentication.
3. Ship the iOS readiness-count correction in the next app build. Android already adopts the backend's persisted stop count and needs no source change for this contract.
4. Verify authenticated campaign creation on iOS and Android in a sparse-address area and a zero-address fixture, then verify label adoption after a completed background batch. Local checks do not establish production or device acceptance.

## Local verification

Run the TypeScript tests with `npx tsx --test lib/services/__tests__/CampaignGeometryTargets.test.ts lib/services/__tests__/GeometryTargetProgress.test.ts lib/services/__tests__/CampaignAddressEnrichmentWorker.test.ts`.

For database lifecycle verification, use a disposable PostgreSQL/PostGIS database only. Load `supabase/tests/campaign_geometry_targets_fixture.sql`, then the migration, then `supabase/tests/campaign_geometry_targets_test.sql`, using `psql -v ON_ERROR_STOP=1`. The test covers leases, in-place enrichment of a visited stop, foreign-key history, duplicate civic results, manual edits, spatial rejection, retry exhaustion, later source-address adoption, and backend-only metadata permissions. Never load the minimal fixture into an application database.

## Verification recorded for this change

- Read-only central Forks replay (`[-124.398, 47.946, -124.390, 47.952]`): US routing, 0 source addresses, 111 building footprints, 88 parcels, 100 eligible building stops planned; no production writes.
- 21 new geometry/progress/worker regression tests, 11 existing Bedrock tests, 9 existing bundle tests, and existing reconciliation-rule tests passed locally.
- Disposable PostgreSQL 17 / PostGIS 3.5 migration and lifecycle checks passed.
- Android `CampaignProvisionCountTest` and `CampaignBundleRepositoryParcelTest` passed with the production-debug variant. Both edited iOS creation screens passed Swift parsing; this is not an app build or a device test.
- Focused lint passed. Repository-wide TypeScript checking still reports errors in untouched integrations, demo, map styles, and existing tests; it reports no errors in this change's files.
- No production migration, deployment, or mobile release was performed.


## Parcel-first live test (2026-09-19)

The same Forks rectangle produced 49 initial property targets (48 parcel, 1 building fallback). 49 real permanent reverse requests confirmed 42. Inspecting source use classifications identified five hospital/industrial parcels; excluding them leaves **44 residential candidates: 43 parcel stops and one building fallback, 39 accepted addresses and 5 unresolved**. The denominator is property stops, not verified household count.

An additional five live requests asking for up to five address alternatives yielded no further safe matches. Four unresolved results lie outside their parcel; one has lower `point` accuracy. Of the original 100 building targets, 58 lie on accepted final properties, 23 on unresolved final properties, and 19 were excluded by nonresidential classification or parcel-center boundary selection. The 39/44 result must not be presented as 89% of the original buildings receiving complete unit addresses.

The real worker ran with an isolated queue adapter. Replaying its final results through the actual migration/save function in disposable PostGIS verified 39 confirmed and 5 unresolved, with 44 rows retained. Local focused tests (27 reported by node:test, including the placement regression suite) and bundle regression passed. Focused implementation lint passed; the existing ParcelPinPlacement test file retains unrelated no-explicit-any lint errors. Interactive diagnostic map refreshed at http://127.0.0.1:8769. This is not a deployed campaign, mobile UI test, or production rollout.


## Pipeline verification

`ParcelFirstCampaignFlow.test.ts` exercises target provisioning, repeat provisioning, actual enrichment worker orchestration, field-state preservation, and canonical render placement together. A provider point outside both roofs but inside their shared parcel resolves the same single stop without moving its pin. Thirty focused tests passed after integration, including the existing reconciliation and bundle regression scripts. Production activation still requires the public-project migration, backend deployment and permanent-geocoding configuration; mobile/device acceptance is separate.


## Final paid-enrichment policy

Permanent requests are enabled only for this geometry enrichment worker using `MAP_GEOMETRY_ENRICHMENT_STORAGE_MODE=permanent`. The legacy `MAPBOX_GEOCODING_STORAGE_MODE` remains temporary. There is no temporary-persistence override in the release.

Eligibility is recorded per target before geometry fallback inserts: the campaign must have zero saved addresses after the normal source import. Retries retain eligibility when all existing rows are eligible geometry targets. Existing native addresses, even partial coverage, prevent paid fallback for new targets. The database claim function filters eligibility and the worker checks it again. Ineligible provisional stops remain usable and unresolved, and the retry endpoint cannot queue them for paid enrichment.

Apply migrations `20260919180000` and `20260919210000` before deployment.
