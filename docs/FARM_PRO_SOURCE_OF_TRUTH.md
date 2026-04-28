# Farm Pro Source of Truth

This doc defines the Farm data contract for Pro mode, compares it to how Campaigns already operate, and lays out a cutover plan so Farm stops having multiple competing truths.

## Goal

Make Farms behave like Campaigns at their best:

1. One root row owns the territory and config.
2. Persisted child tables hold operational data.
3. Views and RPCs are read/write helpers, not alternate truth sources.
4. iOS consumes the same contract instead of maintaining a parallel Farm schema story.

## Campaign Pattern To Copy

Campaigns already have a clearer canonical spine:

- Root entity: `campaigns`
- Canonical child rows: `campaign_addresses`
- Read model / projection: `campaign_addresses_geojson`, `rpc_get_campaign_addresses`
- Provision/generation: downstream jobs that populate canonical rows, not a separate truth

References:

- Web create is a direct `campaigns` insert in [CampaignsService.ts](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/lib/services/CampaignsService.ts#L110)
- Web reads canonical addresses from `campaign_addresses` plus projection state in [CampaignsService.ts](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/lib/services/CampaignsService.ts#L146)
- iOS reads campaign addresses from a stable RPC projection in [MapFeaturesService.swift](/Users/danielphillippe/Desktop/FLYR/FLYR%20IOS/FLYR/Services/MapFeaturesService.swift#L1056)
- Campaign create/provision contract is documented in [CAMPAIGN_POLYGON_AND_MOTHERDUCK_REFERENCE.md](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/docs/CAMPAIGN_POLYGON_AND_MOTHERDUCK_REFERENCE.md#L91)

The important bit is not that Campaigns are perfect. It is that they already separate:

- root truth
- persisted operational rows
- convenience projections

Farm should do the same.

## Farm Canonical Contract

### 1. Root entity

`public.farms` is the Farm root row.

It owns:

- identity: `id`
- ownership and scope: `owner_id`, `workspace_id`
- linked campaign: `linked_campaign_id`
- territory identity: `name`, `description`, `polygon`, `area_label`
- lifecycle: `start_date`, `end_date`, `is_active`
- cadence and goals: `touches_interval`, `goal_type`, `goal_target`, `cycle_completion_window_days`, `touch_types`
- budgeting and inventory: `annual_budget_cents`, `home_limit`, `address_count`, `last_generated_at`

In Pro mode:

- one cycle = one planned hit on the area
- one Farm session/touch belongs to one cycle
- home workload belongs in `goal_target` and per-session `homes_target`
- legacy `frequency` / `touches_per_interval` may remain mirrored as compatibility fields, but they are not the planning truth

References:

- Pro Farm type in [database.ts](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/types/database.ts#L295)
- Web create payload in [types/farms.ts](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/types/farms.ts#L31)
- Pro create API in [app/api/farms/route.ts](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/app/api/farms/route.ts#L108)

### 2. Canonical home inventory

`public.farm_addresses` is the canonical list of homes in a Farm.

It is the Farm equivalent of `campaign_addresses`.

It owns:

- stable farm-scoped address identity
- normalized address text and fields
- coordinate / geometry cache
- link back to the backing campaign address when available
- visit rollups: `visited_count`, `last_visited_at`, `last_touch_id`, `last_outcome_status`

References:

- Schema expansion in [20260414111000_expand_farms_for_sessions_and_addresses.sql](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/supabase/migrations/20260414111000_expand_farms_for_sessions_and_addresses.sql#L148)
- Outcome history sync in [20260414173000_create_farm_touch_address_history.sql](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/supabase/migrations/20260414173000_create_farm_touch_address_history.sql#L233)
- Web fetch in [FarmService.ts](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/lib/services/FarmService.ts#L292)

Rule:

- UI must read Farm homes from `farm_addresses`, not by re-running polygon lookup at detail-view time.

### 3. Canonical session table

`public.farm_touches` is the canonical Farm session table.

In Pro mode, a touch is not just an old planner row. It is the Farm execution/session record.

Canonical fields:

- identity and scope: `id`, `farm_id`, `workspace_id`
- cadence placement: `cycle_number`
- session semantics: `mode`, `title`, `scheduled_date`, `started_at`, `status`
- completion semantics: `completed_date`, `last_completed_at`
- performance fields: `homes_target`, `homes_reached`
- timestamps: `created_at`, `updated_at`

Legacy compatibility fields can remain temporarily:

- `date`
- `type`
- `completed`
- `completed_at`

But they should be treated as compatibility shims only, not the source contract.

References:

- Pro touch type in [database.ts](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/types/database.ts#L339)
- Pro service write path in [FarmService.ts](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/lib/services/FarmService.ts#L328)
- Session backfill in [20260415083000_backfill_farm_touches_session_columns.sql](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/supabase/migrations/20260415083000_backfill_farm_touches_session_columns.sql#L1)
- Mode rename in [20260414221500_rename_farm_touch_modes_and_types.sql](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/supabase/migrations/20260414221500_rename_farm_touch_modes_and_types.sql#L10)

### 4. Canonical per-home outcome history

`public.farm_touch_addresses` is the canonical per-home outcome history for Farm sessions.

It is the Farm equivalent of persisted campaign address outcomes.

It owns:

- which home was touched in which Farm session
- actual outcome status
- optional notes
- occurrence timestamp
- audit metadata

References:

- Table and constraints in [20260414173000_create_farm_touch_address_history.sql](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/supabase/migrations/20260414173000_create_farm_touch_address_history.sql#L24)
- Web read/write helpers in [FarmService.ts](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/lib/services/FarmService.ts#L553)

### 5. Canonical lead table

`public.farm_leads` is the canonical Farm lead table.

It owns:

- `farm_id`
- optional `touch_id`
- `lead_source`
- lead identity/contact fields
- `created_at`

References:

- Pro type in [database.ts](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/types/database.ts#L358)
- Web service in [FarmService.ts](/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/lib/services/FarmService.ts#L514)

## What Is Not Canonical

These should not be treated as truth in Pro mode:

- polygon-based address reads for Farm detail screens
- old iOS touch semantics built around only `date/type/completed`
- phase-era Farm planning as a persistence model
- duplicate Farm create flows in legacy `Feautures/Farm`
- QR-specific Farm row shapes like `frequency_days`

References:

- iOS Farm detail still reads homes from polygon RPC in [FarmDetailViewModel.swift](/Users/danielphillippe/Desktop/FLYR/FLYR%20IOS/FLYR/Features/Farm/ViewModels/FarmDetailViewModel.swift#L78)
- legacy iOS Farm create stub in [FarmAPI.swift](/Users/danielphillippe/Desktop/FLYR/FLYR%20IOS/FLYR/Feautures/Farm/FarmAPI.swift#L3)
- QR Farm row still expects `frequency_days` in [FarmListItem.swift](/Users/danielphillippe/Desktop/FLYR/FLYR%20IOS/FLYR/Features/QRCodes/Models/FarmListItem.swift#L19)

## Current Drift Against The Target

### Drift 1: schema ownership is split

Farm schema changes currently live across:

- `/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/supabase/migrations`
- `/Users/danielphillippe/Desktop/FLYR/FLYR IOS/supabase/migrations`
- `/Users/danielphillippe/Desktop/FLYR/supabase/migrations`

That means Farm truth depends on which migration stream actually reached the live database.

### Drift 2: iOS and web do not use the same home inventory

- Web treats `farm_addresses` as canonical.
- iOS still derives homes from polygon lookup.

This is the biggest read inconsistency because the same Farm can show different home counts and coverage depending on client.

### Drift 3: touch/session semantics are still mixed

- Web is moving to `mode/scheduled_date/status/homes_*`
- iOS still models touches primarily as `date/type/completed`

That causes both write drift and analytics drift.

### Drift 4: legacy cadence fields still carry overloaded meaning

Older Farm code used `frequency` / `touches_per_interval` both as cadence and as per-cycle workload. That made cycle numbering, planner output, and goal tracking disagree with each other.

Target rule:

- cadence lives in `touches_interval`
- one created session means one cycle hit
- home workload lives in `goal_target` or session `homes_target`

## Pro-Owned Write Rules

In Pro mode, writes should follow these rules:

### Farm create

Allowed writer:

- `POST /api/farms`

Required behavior:

1. Insert `farms`
2. Create or resolve linked backing campaign
3. Generate and sync `farm_addresses`
4. Seed initial `farm_touches` from cadence config

### Farm config update

Allowed writers:

- web Farm config UI
- server-side helpers used by that UI

Must update only the root row and any explicitly dependent projections.

### Farm session create / update / complete

Allowed writers:

- `FarmTouchService`
- DB RPCs specifically designed around the canonical session contract

All client code should write the canonical session fields first. Legacy fields may be mirrored only for compatibility.

### Farm home outcomes

Allowed writer:

- `record_farm_address_outcome`

This should remain the single write path for per-home outcomes because it also maintains aggregate state on `farm_addresses` and `farm_touches`.

## Read Rules

### Web and iOS should read:

- Farm root: `farms` or `farms_with_geojson`
- Farm homes: `farm_addresses`
- Farm sessions: `farm_touches`
- Farm outcomes: `farm_touch_addresses`
- Farm leads: `farm_leads`

### Web and iOS should not read:

- homes from polygon lookup when a persisted Farm already exists
- QR-specific lightweight Farm rows as a substitute for the main Farm contract

## Recommended Ownership

For Pro mode, Farm schema ownership should move to one migration owner.

Recommended owner:

- `/Users/danielphillippe/Desktop/FLYR/FLYR-PRO/supabase/migrations`

Recommended consumer:

- iOS consumes the Pro Farm contract and stops independently redefining Farm schema semantics

This matches the user's stated direction: build Farm in Pro mode first, then let iOS follow the Pro contract.

## Cutover Plan

### Phase 1: freeze the contract

1. Declare the canonical Farm tables listed above.
2. Stop adding new Farm semantics in multiple migration streams.
3. Treat legacy fields as compatibility-only.

Definition of done:

- new Farm changes are authored in one migration owner only
- a single Farm contract doc exists and is current

### Phase 2: unify reads

1. Move iOS Farm detail reads from polygon lookup to `farm_addresses`
2. Move any Farm list/count UI to use `address_count` and persisted rows
3. Keep polygon RPCs only for generation and import flows

Definition of done:

- Farm home counts match across web and iOS for the same Farm
- analytics are computed from the same persisted address/outcome inventory

### Phase 3: unify session semantics

1. Update iOS Farm touch models and services to understand the canonical session fields
2. Keep reading legacy fields while old data exists
3. Stop introducing new logic that depends on only `date/type/completed`

Definition of done:

- iOS and web can create, start, and complete the same Farm sessions without translation drift

### Phase 4: remove dead Farm paths

1. Delete or quarantine legacy `Feautures/Farm` create flow
2. Remove QR-specific Farm row assumptions like `frequency_days`
3. Retire deprecated phase-era persistence assumptions from active flows

Definition of done:

- one create path
- one touch contract
- one address source

### Phase 5: tighten the contract

1. Add compatibility views or RPCs only where needed for migration
2. Backfill any remaining legacy session fields from canonical ones if still required
3. When safe, stop writing legacy columns from new code paths

Definition of done:

- canonical fields alone are sufficient for all active clients

## Acceptance Test For Farm Truth

A Farm is "unified" when all of the following are true:

1. Create a Farm on web.
2. Web and iOS load the same Farm root configuration.
3. Web and iOS show the same home count for that Farm.
4. A session created on one client appears with the same semantics on the other.
5. A home outcome recorded on one client updates Farm coverage and session metrics everywhere.
6. Leads created from that Farm attach to the same Farm and optional session on both clients.

If any one of those fails, Farm still has more than one truth.

## Practical Summary

If Campaigns are the template, then the Farm equivalent is:

- `campaigns` -> `farms`
- `campaign_addresses` -> `farm_addresses`
- persisted campaign visit/outcome state -> `farm_touch_addresses`
- campaign operational activity -> `farm_touches`

That is the universal truth for Pro mode.
