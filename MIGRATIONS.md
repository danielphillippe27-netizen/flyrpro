# Migration History & Schema Reference

> **If you are about to run a migration, apply a schema change, or modify a database
> object, read this document first.**
>
> This document covers what the migration history actually looks like, what is missing
> from it, which tables are iOS-coupled, and how to safely add new migrations going
> forward.

---

## Table of contents

1. [The schema problem](#1-the-schema-problem)
2. [Migration inventory](#2-migration-inventory)
3. [Tables with no CREATE TABLE in this repo](#3-tables-with-no-create-table-in-this-repo)
4. [Duplicate migration timestamps](#4-duplicate-migration-timestamps)
5. [SQL files outside supabase/migrations/](#5-sql-files-outside-supabasemigrations)
6. [iOS-specific tables and migrations](#6-ios-specific-tables-and-migrations)
7. [Tables with no active web app usage](#7-tables-with-no-active-web-app-usage)
8. [DROP statements — high risk](#8-drop-statements--high-risk)
9. [How to add a migration safely](#9-how-to-add-a-migration-safely)
10. [Local Supabase setup](#10-local-supabase-setup)

---

## 1. The schema problem

**`supabase/schema.sql` is not the production schema.** It reflects the original MVP
and only defines four things:

- `campaigns`
- `campaign_recipients` (legacy — see Section 3)
- `user_profiles`
- Storage bucket policies for `qr` and `flyers`

The actual production database has been built through 263 migration files spanning
January 2025 to May 2026, plus migrations applied from the iOS repo
(`FLYR/supabase/migrations/`). Neither repo's migration history is complete on its own.

**Critical tables with no `CREATE TABLE` in this repo:**

| Table | Where it was created |
|-------|---------------------|
| `campaign_addresses` | iOS repo migrations |
| `qr_codes` | iOS repo migrations |
| `farms` | iOS repo migrations |
| `contacts` | iOS repo migrations |
| `sessions` | iOS repo migrations |
| `session_events` | iOS repo migrations |

If you run migrations from scratch using only this repo, these tables will not exist
and the app will fail. A `supabase/schema.current.sql` reflecting the full production
state needs to be created — see Section 9.

---

## 2. Migration inventory

**Total migration files:** 263  
**Earliest:** `20250117000000_add_full_unique_constraint_campaign_addresses.sql`  
**Latest:** `20260525000000_add_contractor_crm_integrations.sql`  
**One non-timestamped file:** `create_flyers_table.sql` — treat as applied, do not re-run.

The migrations fall into these functional groups:

### Campaign and address management
Migrations from `20250117` through `20260425` covering campaign creation, address
provisioning, building linking, geocoding, road snapping, QR code columns, and
outcome tracking. These are the most heavily modified tables and the highest risk area
for breaking iOS.

### Building and map infrastructure
Migrations from `20250127` through `20260428` covering building tables, spatial
indexes, GERS IDs, building stats, slices, road layers, and map feature RPCs. Many
of these are iOS-coupled — the iOS app renders the map directly from this data.

### QR system
- `20251205221730_enhance_qr_codes_and_scans.sql` — creates `qr_code_scans`, alters `qr_codes`
- `20251208000004_add_qr_png_url_to_campaign_addresses.sql` — adds `qr_png_url`
- `20251210000001_create_qr_generation_jobs_table.sql` — creates `qr_generation_jobs`
- `20251211000001_create_increment_scan_rpc.sql` — creates `increment_scan` RPC
- `20251212000000_add_qr_tracking_columns.sql` — adds `qr_code_base64` and `purl`
- `20260325134500_record_public_qr_scan_outcome.sql` — creates `record_public_qr_scan_outcome` RPC
- `20260307000000_ios_schema_alignment.sql` — creates `address_content`, `campaign_qr_batches`, scan count RPCs

### Workspace and team
- `20260218220000_workspace_multitenancy_phase1.sql` — creates `workspaces`, `workspace_members`
- `20260218223000_workspace_rls_child_tables_phase1_1.sql` — adds RLS to child tables
- `20260218236000_workspace_invites.sql` — creates invite system
- `20260218242000_team_dashboard_tables.sql` — team dashboard tables and RPCs

### Billing and entitlements
- `20260215000000_create_entitlements.sql` — creates `entitlements` table; source of truth for web + iOS
- `20260216010000_entitlements_add_stripe_columns.sql` — adds Stripe fields
- `20260220120000_founder_entitlement.sql` — founder entitlement gating

### CRM integrations
- `20260209163331_add_crm_connections.sql` — creates `crm_connections`
- `20260214000000_user_integrations_api_key_text.sql` — creates `user_integrations`; used by web and iOS Edge Function
- `20260307000000_ios_schema_alignment.sql` — creates `crm_object_links`, `crm_events` for iOS voice-log parity

### Features added in 2026
- `20260407153000_create_partner_offers.sql` — partner offers
- `20260408200000_challenges_first_30.sql` — challenges and leaderboard
- `20260414111000_expand_farms_for_sessions_and_addresses.sql` — farms expansion
- `20260421103000_add_twilio_power_dialer.sql` — Twilio voice dialer schema
- `20260419110000_create_ambassador_applications.sql` — ambassador program
- `20260427111500_workspace_dialer_addon_and_numbers.sql` — dialer add-on

### Bedrock/Diamond and Meta migrations added in May 2026

| Migration | Date | Description | Tables / objects affected | DROP statements or destructive operations |
|-----------|------|-------------|---------------------------|-------------------------------------------|
| `20260429120000_add_campaign_data_quality_grade.sql` | 2026-04-29 | Adds campaign link-quality and data-quality grading fields, backfills grades from existing link/building confidence values, and documents the new columns. | `campaigns` | No DROP statements. Runs a non-destructive `UPDATE` backfill on existing campaign rows. |
| `20260506183000_meta_ads_readonly_tracking.sql` | 2026-05-06 | Adds read-only Meta Ads tracking tables, indexes, RLS policies, and updated-at triggers for farm campaign attribution metrics. | `meta_connections`, `meta_ad_accounts`, `farm_meta_campaign_links`, `farm_meta_ad_daily_metrics`; references `farms` and `auth.users` | Uses `DROP TRIGGER IF EXISTS` before recreating triggers on the new Meta tables. No DROP TABLE or DROP COLUMN. |
| `20260506190000_meta_ads_nightly_sync_fields.sql` | 2026-05-06 | Adds nightly sync metadata for Meta campaign links and a sync log table with RLS and indexes. | `farm_meta_campaign_links`, `meta_sync_logs` | No DROP statements. |
| `20260508000000_add_real_estate_campaign_types.sql` | 2026-05-08 | Expands allowed `campaigns.type` values for real estate campaign workflows. | `campaigns` | Drops and recreates `campaigns_type_check`; no table or column drops. |
| `20260508120000_campaign_assignments.sql` | 2026-05-08 | Creates campaign assignment and assignment-home tables, indexes, timestamp trigger, RLS policies, and adds assignments to realtime publication. | `campaign_assignments`, `campaign_assignment_homes`; references `campaigns`, `workspaces`, `campaign_addresses`, and `auth.users` | Uses `DROP TRIGGER IF EXISTS` and `DROP POLICY IF EXISTS` before recreating trigger/policies. No DROP TABLE or DROP COLUMN. |
| `20260508133000_expand_farm_wizard_touch_types.sql` | 2026-05-08 | Adds farm social-ad spend flag and expands/normalizes farm touch types and farm touch modes for the farm wizard. | `farms`, `farm_touches` | Drops and recreates touch-type check constraints. Runs data-normalizing `UPDATE`s that map legacy touch/mode values to the new allowed set. |
| `20260509113000_add_bedrock_provision_sources.sql` | 2026-05-09 | Temporarily expands `campaigns.provision_source` to include Bedrock regional sources alongside legacy gold/silver/lambda values. | `campaigns` | Drops and recreates `campaigns_provision_source_check`; no table or column drops. |
| `20260510000000_restrict_campaign_provision_sources_to_diamond_bedrock.sql` | 2026-05-10 | Replaces legacy provision-source values with the Diamond/Bedrock source set and documents the new source semantics. | `campaigns` | Drops and recreates `campaigns_provision_source_check`. Updates existing `gold`, `silver`, and `lambda` values to `NULL`, which is a destructive normalization of legacy source labels. |
| `20260511140000_add_country_flags_to_profiles_and_leaderboard.sql` | 2026-05-11 | Adds country-code fields to profile tables and recreates `get_leaderboard` so leaderboard rows can include a country code. | `user_profiles`, `profiles`, `leaderboard_rollups`, `challenge_participants`; reads `auth.users`; function `get_leaderboard` | Uses `DROP FUNCTION IF EXISTS public.get_leaderboard(...)` before recreating it with a new return shape. No table or column drops. |
| `20260514120000_skip_building_rpc_for_bedrock_campaigns.sql` | 2026-05-14 | Replaces `rpc_get_campaign_map_bundle` so Diamond/Bedrock campaigns skip the legacy Gold building RPC and rely on PMTiles/frontend fallback buildings instead. | Function `rpc_get_campaign_map_bundle`; reads `campaigns`, `campaign_addresses`, `campaign_parcels`; conditionally calls building/parcels/roads RPCs | No DROP statements. Uses `CREATE OR REPLACE FUNCTION`; does not alter `rpc_get_campaign_full_features`. |
| `20260521131000_live_session_codes_and_participants.sql` | 2026-05-21 | Adds live session participant tracking, share/join codes, RLS policies, and `is_session_participant` helper for collaborative campaign sessions. | `session_participants`, `live_session_codes`; references `sessions`, `campaigns`, `workspace_invites`, `workspaces`, and `auth.users`; function `is_session_participant` | Uses `DROP POLICY IF EXISTS` before recreating RLS policies on the new `session_participants` table. No DROP TABLE or DROP COLUMN. |
| `20260522170000_create_salespeople.sql` | 2026-05-22 | Creates salesperson admin table with commission settings, Stripe Connect fields, indexes, RLS, and updated-at trigger. | `salespeople`; function/trigger `salespeople_set_updated_at` | Uses `DROP TRIGGER IF EXISTS` before recreating the trigger. No DROP TABLE or DROP COLUMN. |
| `20260522173000_seed_salesperson_workspace.sql` | 2026-05-22 | Seeds salesperson records for two specific email addresses, creates or updates a Salesperson Workspace, and attaches matching auth users to that workspace. | `salespeople`, `workspaces`, `user_profiles`, `workspace_members`; reads `auth.users` | No DROP statements. Performs data-seeding `INSERT`/`UPDATE` operations for named users/workspace. |
| `20260522180000_salesperson_commissions_and_payouts.sql` | 2026-05-22 | Adds commission duration to salespeople and creates salesperson referral, commission, payout batch, and payout batch item tables with indexes, RLS, FK wiring, and updated-at triggers. | `salespeople`, `salesperson_referrals`, `salesperson_commissions`, `salesperson_payout_batches`, `salesperson_payout_batch_items`; references `workspaces` and `auth.users` | Drops and recreates `salespeople_commission_duration_months_check`; uses `DROP TRIGGER IF EXISTS` before recreating triggers. No table or column drops. |
| `20260522190000_salesperson_invites_and_workspaces.sql` | 2026-05-22 | Adds salesperson invite/workspace ownership fields, backfills invite tokens and founder user links, and adds lookup indexes. | `salespeople`; reads `user_profiles` | No DROP statements. Runs backfill `UPDATE`s for invite tokens and founder assignment. |
| `20260525000000_add_contractor_crm_integrations.sql` | 2026-05-25 | Expands allowed CRM object link provider values for contractor/home-service CRM integrations. | `crm_object_links` | Drops and recreates `crm_object_links_crm_type_check`. No table or column drops. |
| `20260529120000_add_lifetime_session_totals_rpc.sql` | 2026-05-29 | Adds `get_lifetime_session_totals` RPC to return lifetime `doors_hit` and `conversations` totals from completed sessions for one user, replacing two full-row dashboard fallback scans. | Function `get_lifetime_session_totals`; reads `sessions` | No DROP statements. Uses `CREATE OR REPLACE FUNCTION` and grants execute to `authenticated` and `service_role`. |
| `20260529130000_add_performance_indexes.sql` | 2026-05-29 | Adds composite indexes for dashboard, activity, leads, campaign, scan, CRM appointment, and session lifetime query paths. Skips `session_events` composite index because exported schema does not show the required `workspace_id`/`event_time` columns. | Indexes on `sessions`, `contacts`, `crm_events`, `scan_events`, `campaigns` | No DROP statements. Uses `CREATE INDEX CONCURRENTLY IF NOT EXISTS`; no existing indexes modified or dropped. |
| `20260617133000_create_demo_links.sql` | 2026-06-17 | Creates DB-backed demo links for the cinematic demo engine, with service-role-only access enforced by RLS and no permissive policies. | `demo_links` | No DROP statements. Creates a new isolated table and enables RLS without anon/authenticated policies. |

---

## 3. Tables with no CREATE TABLE in this repo

These tables exist in production but have no `CREATE TABLE` statement in
`supabase/schema.sql` or `supabase/migrations/`. They were created by iOS repo
migrations applied directly to the shared database.

| Table | Why it exists | Risk if altered |
|-------|-------------|----------------|
| `campaign_addresses` | Core address table — created in iOS repo | **Critical iOS coupling. Must not alter without coordination.** |
| `qr_codes` | QR tracking — created in iOS repo | **Critical iOS coupling. Must not alter without coordination.** |
| `farms` | Farm management — created in iOS repo | iOS reads/writes farms directly. |
| `contacts` | Contact management — created in iOS repo | iOS reads/writes contacts directly. |
| `sessions` | Field sessions — created in iOS repo | iOS is the primary writer. |
| `session_events` | Session events — created in iOS repo | iOS is the primary writer. |

**Consequence:** Running `supabase db reset` on a local environment will produce a
broken schema. Do not do this until `supabase/schema.current.sql` has been created
from a full production export.

**Also missing CREATE TABLE (but less critical):**
- `campaign_recipients` — exists in schema.sql and a migration, but is the legacy
  MVP table superseded by `campaign_addresses`. See note in Section 7.

---

## 4. Duplicate migration timestamps

The following timestamp prefixes appear on more than one migration file. When Supabase
runs migrations in alphabetical order, both files with the same timestamp will run —
but their execution order between each other is determined by alphabetical filename
sort, not by time. This is a correctness risk if one file depends on the other.

| Timestamp | Files | Risk |
|-----------|-------|------|
| `20250128000014` | `create_sync_bbox_data_rpc.sql`, `ensure_address_id_in_buildings.sql` | Low — independent operations |
| `20250209000000` | `building_units_and_split_errors.sql`, `building_units_simple.sql` | **High — both DROP and CREATE the same tables** |
| `20250209000001` | `add_link_columns.sql`, `add_linker_columns.sql` | Medium — both ALTER same table |
| `20250209000002` | `add_cvrp_cluster_columns.sql`, `fix_split_errors_schema.sql` | Low — different tables |
| `20260210000004` | `campaign_addresses_geojson_route_columns.sql`, `find_nearest_walkway_segment_rpc.sql` | Low — independent operations |
| `20260216160000` | `parcel_bridge_linker.sql`, `parcel_bridge_linker_fixed.sql`, `user_profiles_and_oauth_trigger.sql` | **High — three files at the same timestamp, one is a fix for another** |
| `20260216170000` | `fix_update_campaign_boundary.sql`, `user_stats_by_period_rpc.sql` | Low — independent operations |
| `20260217000000` | `cascading_geocoder_schema.sql`, `create_gold_data_tables.sql` | Low — independent operations |
| `20260217310000` | `add_timeframe_to_leaderboard.sql`, `get_leaderboard_timeframe.sql` | Medium — both touch leaderboard RPC |

**Action required:** Do not create new migrations with timestamps that conflict with
existing ones. Always use the current UTC timestamp when creating a new migration file.

---

## 5. SQL files outside supabase/migrations/

These files exist in the repo but are not in the migrations folder. They should not
be run automatically and must not be treated as part of the canonical migration history.

### supabase/ (non-migration SQL)
| File | Purpose | Safe to run? |
|------|---------|-------------|
| `supabase/schema.sql` | Original MVP baseline. Outdated. | Only on a fresh DB with no migrations |
| `supabase/QUICK_FIX_crm_connections.sql` | Creates `crm_connections` if missing | One-time manual fix only |
| `supabase/QUICK_FIX_refresh_view.sql` | Recreates `campaign_addresses_geojson` | Safe to re-run on view issues |

### supabase/scripts/ (operational scripts)
These are smoke tests, repair scripts, and audit tools. Run manually in the SQL editor
when debugging specific issues. Do not run as migrations.

| File | Purpose |
|------|---------|
| `campaign_persisted_outcomes_smoke_test.sql` | Tests outcome persistence |
| `record_campaign_address_outcome_smoke_test.sql` | Tests address outcome RPC |
| `record_campaign_target_outcome_smoke_test.sql` | Tests target outcome RPC |
| `repair_record_campaign_address_outcome_compat.sql` | Repairs outcome RPC if broken |
| `repair_record_campaign_target_outcome_compat.sql` | Repairs target outcome RPC |
| `repair_session_analytics_leads_compat.sql` | Repairs session analytics |
| `repair_user_stats_session_trigger.sql` | Repairs user stats trigger |
| `repair_user_stats_single_writer.sql` | Audits user stats consistency |
| `workspace_dedupe_audit.sql` | Audits duplicate workspaces |
| `ensure_danielteam_workspace.sql` | Repairs Daniel team workspace records |

### scripts/ (data pipeline scripts)
These operate on MotherDuck/DuckDB or reference data, not the application database.

| File | Purpose |
|------|---------|
| `scripts/bake.sql` | Bakes geospatial data via DuckDB |
| `scripts/debug-scan-colors.sql` | Diagnostic for scan/building state |
| `scripts/load_gold_sql.sql` | Loads gold reference address data |
| `scripts/motherduck/create_building_views.sql` | Creates MotherDuck building views from S3 |

### drizzle/
`drizzle/0000_swift_randall.sql` — Drizzle-generated schema for `editor_project`,
`flyer`, and `user` tables. This is the editor-only database schema managed by Drizzle,
separate from the main application schema managed by Supabase migrations.

---

## 6. iOS-specific tables and migrations

### Tables created specifically for iOS

These tables were created by `20260307000000_ios_schema_alignment.sql` and exist
exclusively to support iOS functionality. Do not drop, rename, or alter columns on
these tables without coordinating with iOS development.

| Table | iOS purpose | RLS |
|-------|------------|-----|
| `address_content` | iOS QR content editor — stores videos, images, forms per address | Owner or workspace member |
| `campaign_qr_batches` | iOS export metadata — tracks QR batch export state | Owner or workspace member |
| `building_touches` | iOS map interactions — records every door knock on the map | Own rows only |
| `crm_object_links` | iOS CRM voice-log parity — links contacts to CRM objects | Own rows only |
| `crm_events` | iOS CRM event log — records CRM activity from iOS | Own rows only |

### RPCs created specifically for iOS

| Function | Purpose | Risk if removed |
|----------|---------|----------------|
| `get_address_scan_count(p_address_id uuid)` | Returns scan count for one address | iOS QR analytics fails |
| `get_campaign_scan_count(p_campaign_id uuid)` | Returns scan count for a campaign | iOS QR analytics fails |
| `set_address_content_updated_at()` | Trigger to update `address_content.updated_at` | Data consistency issue |

Both scan count RPCs count from `qr_code_scans` and are granted to `anon`,
`authenticated`, and `service_role`.

### Other migrations with explicit iOS coupling

These migrations were written specifically to support iOS behavior. Their comments
explicitly say so — do not modify without understanding the iOS impact.

| Migration | iOS coupling note |
|-----------|------------------|
| `20251216000000_add_campaign_snapshot_columns.sql` | S3 snapshot URLs rendered directly by the iOS app |
| `20260214000000_user_integrations_api_key_text.sql` | Used by iOS Edge Function `crm_sync` |
| `20260215000000_create_entitlements.sql` | Source of truth for web + iOS billing |
| `20260215100000_create_address_statuses.sql` | Used by web and iOS for address color coding |
| `20260215200000_enable_realtime_field_leads.sql` | Enables realtime so web shows leads created on iOS |
| `20260220110000_team_dashboard_use_ios_sessions_events.sql` | Switches team dashboard to iOS session tables |
| `20260220200000_route_plans_and_assignments.sql` | Powers iOS Routes tab |
| `20260307000000_ios_schema_alignment.sql` | Full iOS schema alignment — see Section 6 above |
| `20260330100000_manual_map_shapes_rpc.sql` | Serves the stream the iOS map uses for rendering |
| `20260408233000_challenge_badges_streaks_share_cards.sql` | Notification queue used by mobile and web |
| `20260427213000_fix_campaign_outcome_workspace_and_ios_event_types.sql` | Fixes iOS offline outcome flow |

---

## 7. Tables with no active web app usage

These tables have a `CREATE TABLE` in migrations but no `.from('table_name')` call
found in `app/`, `components/`, or `lib/`. They may be used by iOS, by background
jobs, or may be genuinely unused.

| Table | Created by | Likely status |
|-------|-----------|---------------|
| `address_content` | iOS alignment migration | iOS-only — not queried by web |
| `campaign_exports` | `20251205105523_add_campaign_exports_table.sql` | Unused — no web caller found |
| `campaign_recipients` | `schema.sql` + migration | **Legacy.** Superseded by `campaign_addresses`. Do not use for new features. |
| `challenge_badges` | Challenge migration | Possibly iOS-only |
| `editor_project` | Drizzle migration | Editor-specific — not in main app queries |
| `gers_id_mapping` | GERS migration | Background pipeline only |
| `global_address_cache` | Zero-gap discovery migration | Background pipeline only |
| `leaderboard_rollups` | Leaderboard projection migration | Materialized view support |
| `notifications` | Challenge badges migration | Push notification queue — may be background worker |
| `overture_buildings` | Cascading geocoder migration | Data pipeline only |
| `ref_addresses_silver` | Cascading geocoder migration | Data pipeline only |
| `ref_addresses_sync_log` | Cascading geocoder migration | Data pipeline only |
| `regional_data_load_log` | Cascading geocoder migration | Data pipeline only |

---

## 8. DROP statements — high risk

These migrations contain `DROP TABLE` statements. If they have not yet been applied
to a given environment, running them will destroy data. Verify against production
before running on any environment.

| Migration | Tables dropped | Notes |
|-----------|---------------|-------|
| `20250131000020_cleanup_redundant_tables.sql` | `scan_events`, `qr_scan_events`, `map_buildings` | These are later recreated by `20251214000000_create_map_buildings_schema.sql`. Must run in order. |
| `20250208230000_enhanced_building_address_links.sql` | `address_orphans`, `building_address_links` | `building_address_links` is immediately recreated with enhanced schema in the same file. |
| `20250209000000_building_units_and_split_errors.sql` | `building_split_errors`, `building_units` | Immediately recreated. Both `building_units_and_split_errors.sql` and `building_units_simple.sql` share the same timestamp and drop the same tables — **collision risk**. |
| `20251207000004_add_campaign_id_to_buildings.sql` | `sync_history` | Legacy table removal. |

No `DROP COLUMN` statements were found in any migration file.

---

## 9. How to add a migration safely

### Rules

1. **Always use a new unique timestamp.** Format: `YYYYMMDDHHMMSS`. Never reuse an
   existing timestamp. Check the list in Section 4 before creating a new file.

2. **Never apply SQL directly in the Supabase dashboard without also committing it
   as a migration file.** This is how `campaign_addresses` and `qr_codes` ended up
   with no `CREATE TABLE` in this repo.

3. **For iOS-coupled tables, get sign-off first.** Any migration that alters a table
   listed in Section 6 or IOS_INTEGRATION.md Section 8.2 must be reviewed with the
   iOS developer before being applied.

4. **Use `IF NOT EXISTS` and `IF EXISTS` guards.** Migrations may be re-run on
   different environments. Guard all `CREATE TABLE`, `CREATE INDEX`, and `ALTER TABLE
   ADD COLUMN` statements.

5. **Test on staging first.** There is currently no staging Supabase project. Creating
   one is a prerequisite for safe migration development.

### Migration file naming

```
supabase/migrations/YYYYMMDDHHMMSS_short_description.sql
```

Example:
```
supabase/migrations/20260502120000_add_voice_transcript_to_addresses.sql
```

### Migration file template

```sql
-- Migration: YYYYMMDDHHMMSS_short_description
-- Description: One sentence explaining what this does and why.
-- iOS impact: none | altered tables: [list] | requires iOS coordination: yes/no
-- Author: Harry Brown
-- Date: YYYY-MM-DD

-- Add your SQL here.
-- Use IF NOT EXISTS for CREATE TABLE and CREATE INDEX.
-- Use column existence checks for ALTER TABLE ADD COLUMN where possible.

-- Example:
ALTER TABLE public.campaign_addresses
  ADD COLUMN IF NOT EXISTS new_column text;
```

### Creating schema.current.sql

Until a full schema export is created, new contributors cannot set up a working local
environment. To create it:

1. Go to Supabase dashboard → SQL Editor
2. Run:
```sql
-- This requires pg_dump access or the Supabase schema export feature.
-- Ask the project owner to export via:
-- Supabase dashboard → Settings → Database → Database backups → Schema only
```

Alternatively, ask the project owner to run:
```sql
SELECT
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
FROM information_schema.tables t
JOIN information_schema.columns c
  ON t.table_name = c.table_name
  AND t.table_schema = c.table_schema
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
ORDER BY t.table_name, c.ordinal_position;
```

And paste the result — it can be formatted into `supabase/schema.current.sql`.

---

## 10. Local Supabase setup

**No `supabase/config.toml` exists in this repo.** The Supabase CLI has not been
configured for local development.

Consequences:
- `supabase start` will not work
- `supabase db reset` will not work correctly even if configured — missing CREATE TABLE
  statements mean the schema will be incomplete after running migrations
- There is no local test database — all development currently runs against the
  shared production Supabase project

**To set up local Supabase properly, the following are prerequisites:**

1. Create `supabase/schema.current.sql` from a production export (see Section 9)
2. Run `supabase init` to generate `supabase/config.toml`
3. Convert `schema.current.sql` into a single baseline migration that can be
   run from scratch
4. Verify all 240 existing migrations apply cleanly on top of that baseline
5. Create a separate Supabase project for local/staging use

This is a significant undertaking and should be planned as a dedicated task, not
attempted as part of feature work.
