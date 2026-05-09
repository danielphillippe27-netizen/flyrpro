-- ============================================================
-- schema.current.sql
-- FLYR PRO — Production schema as of May 2026
--
-- THIS FILE IS THE CANONICAL SCHEMA REFERENCE.
-- It was exported directly from the production Supabase database.
-- Do not edit manually. To update, re-export from Supabase.
--
-- 124 tables, 1591 columns
--
-- IMPORTANT NOTES:
-- 1. Tables marked [iOS-ONLY] were created by the FLYR iOS repo
--    migrations. Do not alter without iOS developer coordination.
-- 2. Tables marked [MISSING FROM WEB MIGRATIONS] exist in production
--    but have no CREATE TABLE in supabase/migrations/. They were
--    created by iOS repo migrations.
-- 3. Tables marked [LEGACY] are superseded and should not be used
--    for new features.
-- ============================================================

-- Required extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── account [LEGACY] ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.account (
  userId                                   text NOT NULL,
  type                                     text NOT NULL,
  provider                                 text NOT NULL,
  providerAccountId                        text NOT NULL,
  refresh_token                            text,
  access_token                             text,
  expires_at                               integer,
  token_type                               text,
  scope                                    text,
  id_token                                 text,
  session_state                            text
);

-- ── activity_events ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_events (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  event_type                               text NOT NULL,
  event_time                               timestamp with time zone NOT NULL,
  ref_id                                   uuid,
  payload                                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── address_content [iOS-ONLY] ────────────────────────
CREATE TABLE IF NOT EXISTS public.address_content (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  address_id                               uuid NOT NULL,
  title                                    text NOT NULL DEFAULT ''::text,
  videos                                   text[] NOT NULL DEFAULT ARRAY[]::text[],
  images                                   text[] NOT NULL DEFAULT ARRAY[]::text[],
  forms                                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── address_orphans ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.address_orphans (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid,
  address_id                               uuid,
  nearest_building_id                      text,
  nearest_distance                         double precision,
  nearest_building_street                  text,
  address_street                           text,
  street_match_score                       double precision,
  suggested_buildings                      jsonb DEFAULT '[]'::jsonb,
  status                                   text DEFAULT 'pending'::text,
  assigned_building_id                     text,
  assigned_by                              uuid,
  assigned_at                              timestamp without time zone,
  created_at                               timestamp without time zone DEFAULT now(),
  coordinate                               geometry,
  suggested_street                         text
);

-- ── address_statuses ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.address_statuses (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_address_id                      uuid NOT NULL,
  campaign_id                              uuid NOT NULL,
  status                                   text NOT NULL DEFAULT 'none'::text,
  last_visited_at                          timestamp with time zone,
  notes                                    text,
  visit_count                              integer NOT NULL DEFAULT 0,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  last_action_by                           uuid,
  last_session_id                          uuid,
  last_home_event_id                       uuid
);

-- ── ambassador_applications ───────────────────────────
CREATE TABLE IF NOT EXISTS public.ambassador_applications (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  full_name                                text NOT NULL,
  email                                    text NOT NULL,
  phone                                    text,
  city                                     text,
  primary_niche                            text NOT NULL,
  primary_platform                         text NOT NULL,
  audience_size                            text,
  instagram_handle                         text,
  tiktok_handle                            text,
  youtube_handle                           text,
  website_url                              text,
  audience_summary                         text,
  why_flyr                                 text NOT NULL,
  promotion_plan                           text,
  status                                   text NOT NULL DEFAULT 'applied'::text,
  review_notes                             text,
  approved_at                              timestamp with time zone,
  rejected_at                              timestamp with time zone,
  stripe_connect_account_id                text,
  stripe_onboarding_completed              boolean NOT NULL DEFAULT false,
  stripe_details_submitted                 boolean NOT NULL DEFAULT false,
  stripe_charges_enabled                   boolean NOT NULL DEFAULT false,
  stripe_payouts_enabled                   boolean NOT NULL DEFAULT false,
  referral_code                            text,
  commission_rate_bps                      integer NOT NULL DEFAULT 2500,
  commission_duration_months               integer NOT NULL DEFAULT 12,
  referral_code_max_uses                   integer,
  stripe_promotion_code_id                 text
);

-- ── ambassador_commissions ────────────────────────────
CREATE TABLE IF NOT EXISTS public.ambassador_commissions (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  ambassador_referral_id                   uuid NOT NULL,
  ambassador_application_id                uuid NOT NULL,
  referred_user_id                         uuid NOT NULL,
  referred_workspace_id                    uuid NOT NULL,
  stripe_customer_id                       text,
  stripe_subscription_id                   text NOT NULL,
  stripe_invoice_id                        text NOT NULL,
  revenue_amount_cents                     integer NOT NULL,
  commission_rate_bps                      integer NOT NULL,
  commission_amount_cents                  integer NOT NULL,
  currency                                 text NOT NULL,
  earned_at                                timestamp with time zone NOT NULL,
  status                                   text NOT NULL DEFAULT 'pending'::text,
  paid_out_at                              timestamp with time zone,
  payout_batch_id                          uuid,
  stripe_transfer_id                       text
);

-- ── ambassador_payout_batch_items ─────────────────────
CREATE TABLE IF NOT EXISTS public.ambassador_payout_batch_items (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  payout_batch_id                          uuid NOT NULL,
  ambassador_commission_id                 uuid NOT NULL,
  amount_cents                             integer NOT NULL
);

-- ── ambassador_payout_batches ─────────────────────────
CREATE TABLE IF NOT EXISTS public.ambassador_payout_batches (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  created_by_user_id                       uuid,
  status                                   text NOT NULL DEFAULT 'draft'::text,
  currency                                 text NOT NULL,
  total_commission_cents                   integer NOT NULL DEFAULT 0,
  note                                     text,
  paid_at                                  timestamp with time zone,
  ambassador_application_id                uuid,
  stripe_connect_account_id                text,
  stripe_transfer_id                       text,
  transfer_group                           text,
  commission_snapshot_hash                 text,
  failure_reason                           text,
  processed_at                             timestamp with time zone
);

-- ── ambassador_referrals ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.ambassador_referrals (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  ambassador_application_id                uuid NOT NULL,
  referred_user_id                         uuid NOT NULL,
  referred_workspace_id                    uuid NOT NULL,
  referral_code                            text NOT NULL,
  stripe_customer_id                       text,
  stripe_subscription_id                   text,
  stripe_subscription_status               text,
  commission_rate_bps                      integer NOT NULL DEFAULT 2500,
  commission_duration_months               integer NOT NULL DEFAULT 12,
  first_paid_at                            timestamp with time zone,
  eligible_until                           timestamp with time zone,
  last_paid_at                             timestamp with time zone,
  status                                   text NOT NULL DEFAULT 'attributed'::text
);

-- ── auth_handoff_codes ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_handoff_codes (
  code                                     text NOT NULL,
  user_id                                  uuid NOT NULL,
  expires_at                               timestamp with time zone NOT NULL,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  used_at                                  timestamp with time zone
);

-- ── auth_handoffs ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_handoffs (
  code                                     text NOT NULL,
  user_id                                  uuid NOT NULL,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  expires_at                               timestamp with time zone NOT NULL,
  used_at                                  timestamp with time zone,
  user_agent                               text,
  ip                                       text
);

-- ── authenticator [LEGACY] ────────────────────────────
CREATE TABLE IF NOT EXISTS public.authenticator (
  credentialID                             text NOT NULL,
  userId                                   text NOT NULL,
  providerAccountId                        text NOT NULL,
  credentialPublicKey                      text NOT NULL,
  counter                                  integer NOT NULL,
  credentialDeviceType                     text NOT NULL,
  credentialBackedUp                       boolean NOT NULL,
  transports                               text
);

-- ── batches ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.batches (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  name                                     text NOT NULL,
  qr_type                                  text NOT NULL,
  landing_page_id                          uuid,
  custom_url                               text,
  export_format                            text NOT NULL,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── brokerages ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brokerages (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  name                                     text NOT NULL,
  slug                                     text,
  logo_url                                 text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── building_address_links ────────────────────────────
CREATE TABLE IF NOT EXISTS public.building_address_links (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid,
  building_id                              text NOT NULL,
  address_id                               uuid,
  match_type                               text,
  confidence                               double precision,
  distance_meters                          double precision,
  street_match_score                       double precision,
  building_area_sqm                        double precision,
  building_class                           text,
  building_height                          double precision,
  is_multi_unit                            boolean DEFAULT false,
  unit_count                               integer DEFAULT 1,
  unit_arrangement                         text,
  overture_release                         text,
  matched_at                               timestamp without time zone DEFAULT now(),
  modified_at                              timestamp without time zone,
  linker_version                           integer NOT NULL DEFAULT 1
);

-- ── building_slices ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.building_slices (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  address_id                               uuid NOT NULL,
  building_id                              uuid NOT NULL,
  geom                                     geometry NOT NULL,
  created_at                               timestamp with time zone DEFAULT now()
);

-- ── building_split_errors ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.building_split_errors (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  building_id                              text NOT NULL,
  building_geometry                        jsonb,
  error_type                               text NOT NULL,
  error_message                            text,
  created_at                               timestamp with time zone DEFAULT now(),
  address_count                            integer,
  address_ids                              text[],
  building_area                            double precision,
  original_building_geojson                jsonb,
  address_positions                        jsonb,
  suggested_action                         text
);

-- ── building_stats ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.building_stats (
  gers_id                                  text NOT NULL,
  status                                   text DEFAULT 'not_visited'::text,
  scans_today                              integer DEFAULT 0,
  scans_total                              integer DEFAULT 0,
  last_scan_at                             timestamp with time zone,
  campaign_id                              uuid
);

-- ── building_touches [iOS-ONLY] ───────────────────────
CREATE TABLE IF NOT EXISTS public.building_touches (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  address_id                               uuid NOT NULL,
  campaign_id                              uuid NOT NULL,
  building_id                              text,
  session_id                               uuid,
  touched_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── building_units ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.building_units (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  parent_building_id                       text NOT NULL,
  address_id                               uuid,
  unit_number                              text NOT NULL,
  unit_geometry                            geometry NOT NULL,
  split_method                             text DEFAULT 'obb_linear'::text,
  parent_type                              text DEFAULT 'townhouse'::text,
  created_at                               timestamp with time zone DEFAULT now(),
  parent_building_area                     double precision,
  validation_status                        text DEFAULT 'passed'::text
);

-- ── buildings ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.buildings (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  gers_id                                  text NOT NULL,
  geom                                     geometry NOT NULL,
  centroid                                 geometry NOT NULL,
  latest_status                            text DEFAULT 'default'::text,
  is_hidden                                boolean NOT NULL DEFAULT false,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  campaign_id                              uuid,
  gers_id_uuid                             uuid,
  addr_housenumber                         text,
  addr_street                              text,
  addr_unit                                text,
  height                                   numeric,
  house_name                               text,
  height_m                                 numeric,
  address_id                               uuid,
  is_townhome_row                          boolean DEFAULT false,
  units_count                              integer DEFAULT 1,
  workspace_id                             uuid NOT NULL
);

-- ── campaign_addresses [MISSING FROM WEB MIGRATIONS] ──
CREATE TABLE IF NOT EXISTS public.campaign_addresses (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  formatted                                text NOT NULL,
  postal_code                              text,
  source                                   text NOT NULL DEFAULT 'mapbox'::text,
  geom                                     geometry NOT NULL,
  seq                                      integer NOT NULL,
  visited                                  boolean NOT NULL DEFAULT false,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  road_bearing                             double precision,
  house_bearing                            double precision,
  street_name                              text,
  is_oriented                              boolean DEFAULT false,
  orientation_locked                       boolean DEFAULT false,
  gers_id                                  text,
  qr_code_base64                           text,
  purl                                     text,
  gers_id_uuid                             uuid,
  house_number                             text,
  locality                                 text,
  region                                   text,
  building_gers_id                         text,
  scans                                    integer DEFAULT 0,
  last_scanned_at                          timestamp with time zone,
  source_id                                text,
  coordinate                               jsonb,
  building_outline                         jsonb,
  contact_name                             text,
  lead_status                              text DEFAULT 'new'::text,
  product_interest                         text,
  follow_up_date                           timestamp with time zone,
  raw_transcript                           text,
  ai_summary                               text,
  status                                   text DEFAULT 'pending'::text,
  cluster_id                               integer,
  sequence                                 integer,
  walk_time_sec                            integer,
  distance_m                               integer,
  route_polyline                           text,
  building_id                              uuid,
  match_source                             text,
  confidence                               double precision,
  street_number                            text,
  address                                  text
);

-- ── campaign_assignment_homes ─────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_assignment_homes (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  assignment_id                            uuid NOT NULL,
  campaign_address_id                      uuid NOT NULL,
  sequence                                 integer NOT NULL,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── campaign_assignments ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_assignments (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  workspace_id                             uuid NOT NULL,
  assigned_to_user_id                      uuid NOT NULL,
  assigned_by_user_id                      uuid NOT NULL,
  mode                                     text NOT NULL,
  goal_homes                               integer NOT NULL DEFAULT 0,
  zone_index                               integer,
  status                                   text NOT NULL DEFAULT 'assigned'::text,
  due_at                                   timestamp with time zone,
  notes                                    text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── campaign_hidden_buildings ─────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_hidden_buildings (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  public_building_id                       text NOT NULL,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── campaign_home_events ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_home_events (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  campaign_address_id                      uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  session_id                               uuid,
  action_type                              text NOT NULL,
  note                                     text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── campaign_landing_page_analytics ───────────────────
CREATE TABLE IF NOT EXISTS public.campaign_landing_page_analytics (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  landing_page_id                          uuid NOT NULL,
  views                                    integer NOT NULL DEFAULT 0,
  unique_views                             integer NOT NULL DEFAULT 0,
  cta_clicks                               integer NOT NULL DEFAULT 0,
  timestamp_bucket                         date NOT NULL DEFAULT CURRENT_DATE
);

-- ── campaign_landing_pages ────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_landing_pages (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  slug                                     text NOT NULL,
  headline                                 text,
  subheadline                              text,
  hero_url                                 text,
  cta_type                                 text,
  cta_url                                  text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── campaign_members ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_members (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  role                                     text NOT NULL DEFAULT 'member'::text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── campaign_parcels ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_parcels (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid,
  external_id                              text,
  geom                                     geometry NOT NULL,
  properties                               jsonb DEFAULT '{}'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── campaign_presence ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_presence (
  campaign_id                              uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  session_id                               uuid,
  lat                                      double precision,
  lng                                      double precision,
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  status                                   text NOT NULL DEFAULT 'active'::text
);

-- ── campaign_qr_batches [iOS-ONLY] ────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_qr_batches (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  batch_name                               text NOT NULL,
  zip_url                                  text,
  pdf_grid_url                             text,
  pdf_single_url                           text,
  csv_url                                  text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── campaign_road_metadata ────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_road_metadata (
  campaign_id                              uuid NOT NULL,
  roads_status                             text NOT NULL DEFAULT 'pending'::text,
  road_count                               integer NOT NULL DEFAULT 0,
  bounds                                   jsonb,
  cache_version                            integer NOT NULL DEFAULT 0,
  corridor_build_version                   integer NOT NULL DEFAULT 1,
  fetched_at                               timestamp with time zone,
  expires_at                               timestamp with time zone,
  last_refresh_at                          timestamp with time zone,
  last_error_message                       text,
  last_error_at                            timestamp with time zone,
  retry_count                              integer NOT NULL DEFAULT 0,
  source                                   text DEFAULT 'mapbox'::text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── campaign_roads ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_roads (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  road_id                                  text NOT NULL,
  road_name                                text,
  road_class                               text,
  geom                                     geometry NOT NULL,
  bbox_min_lat                             double precision NOT NULL,
  bbox_min_lon                             double precision NOT NULL,
  bbox_max_lat                             double precision NOT NULL,
  bbox_max_lon                             double precision NOT NULL,
  source                                   text NOT NULL DEFAULT 'mapbox'::text,
  source_version                           text,
  cache_version                            integer NOT NULL DEFAULT 1,
  corridor_build_version                   integer NOT NULL DEFAULT 1,
  properties                               jsonb DEFAULT '{}'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── campaign_routes ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_routes (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  route_data                               jsonb NOT NULL,
  created_at                               timestamp with time zone DEFAULT now(),
  updated_at                               timestamp with time zone DEFAULT now()
);

-- ── campaign_snapshots ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_snapshots (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  bucket                                   text NOT NULL,
  prefix                                   text NOT NULL,
  buildings_key                            text,
  addresses_key                            text,
  roads_key                                text,
  metadata_key                             text,
  buildings_url                            text,
  addresses_url                            text,
  roads_url                                text,
  metadata_url                             text,
  buildings_count                          integer DEFAULT 0,
  addresses_count                          integer DEFAULT 0,
  roads_count                              integer DEFAULT 0,
  overture_release                         text,
  tile_metrics                             jsonb,
  optimized_path_geometry                  jsonb,
  optimized_path_distance_km               numeric,
  optimized_path_time_minutes              integer,
  created_at                               timestamp with time zone DEFAULT now(),
  expires_at                               timestamp with time zone DEFAULT (now() + '30 days'::interval)
);

-- ── campaigns ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaigns (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id                                 uuid NOT NULL DEFAULT auth.uid(),
  title                                    text NOT NULL,
  description                              text NOT NULL,
  cover_image_url                          text,
  total_flyers                             integer NOT NULL DEFAULT 0,
  scans                                    integer NOT NULL DEFAULT 0,
  conversions                              integer NOT NULL DEFAULT 0,
  region                                   text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  total_homes                              integer,
  default_map_style                        text DEFAULT 'clean'::text,
  territory_boundary                       geometry,
  address_source                           text,
  status                                   text DEFAULT 'draft'::text,
  seed_query                               text,
  type                                     text DEFAULT 'flyer'::text,
  name                                     text NOT NULL DEFAULT ''::text,
  video_url                                text,
  bbox                                     text[],
  tags                                     text,
  snapshot_bucket                          text,
  snapshot_prefix                          text,
  snapshot_buildings_url                   text,
  snapshot_roads_url                       text,
  snapshot_metadata_url                    text,
  overture_release                         text,
  provisioned_at                           timestamp with time zone,
  provision_status                         text,
  route_snapshot                           jsonb,
  campaign_polygon_raw                     jsonb,
  campaign_polygon_snapped                 jsonb,
  is_snapped                               boolean DEFAULT false,
  workspace_id                             uuid NOT NULL,
  data_confidence_score                    double precision,
  data_confidence_label                    text,
  data_confidence_reason                   text,
  data_confidence_summary                  jsonb,
  data_confidence_updated_at               timestamp with time zone,
  parcel_enrichment_debug                  jsonb DEFAULT '{}'::jsonb,
  parcel_enrichment_status                 text DEFAULT 'not_started'::text,
  parcel_source_id                         text,
  parcel_count                             integer DEFAULT 0,
  parcel_enriched_at                       timestamp with time zone,
  parcel_enrichment_error                  text,
  link_quality_status                      text DEFAULT 'unknown'::text,
  link_quality_score                       integer DEFAULT 0,
  link_quality_reason                      text,
  link_quality_checked_at                  timestamp with time zone,
  link_quality_metrics                     jsonb DEFAULT '{}'::jsonb,
  has_parcels                              boolean NOT NULL DEFAULT false,
  building_link_confidence                 double precision,
  map_mode                                 text,
  provision_source                         text,
  provision_phase                          text DEFAULT 'created'::text,
  addresses_ready_at                       timestamp with time zone,
  map_ready_at                             timestamp with time zone,
  optimized_at                             timestamp with time zone,
  coverage_score                           integer,
  data_quality                             text,
  standard_mode_recommended                boolean NOT NULL DEFAULT true,
  data_quality_reason                      text
);

-- ── challenge_participants ────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenge_participants (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  challenge_id                             uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  participant_name                         text,
  baseline_count                           integer NOT NULL DEFAULT 0,
  progress_count                           integer NOT NULL DEFAULT 0,
  joined_at                                timestamp with time zone NOT NULL DEFAULT now(),
  accepted_at                              timestamp with time zone NOT NULL DEFAULT now(),
  completed_at                             timestamp with time zone,
  last_sync_at                             timestamp with time zone NOT NULL DEFAULT now()
);

-- ── challenge_templates ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenge_templates (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  slug                                     text NOT NULL,
  title                                    text NOT NULL,
  description                              text NOT NULL DEFAULT ''::text,
  scope                                    text NOT NULL,
  type                                     text NOT NULL,
  metric                                   text NOT NULL,
  metric_label_override                    text,
  start_date                               timestamp with time zone,
  end_date                                 timestamp with time zone,
  duration_days                            integer,
  workspace_id                             uuid,
  status                                   text NOT NULL DEFAULT 'upcoming'::text,
  visibility                               text NOT NULL DEFAULT 'public'::text,
  target_audience                          text,
  include_all_members                      boolean NOT NULL DEFAULT false,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── challenges ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenges (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  creator_id                               uuid NOT NULL,
  participant_id                           uuid,
  type                                     text NOT NULL,
  title                                    text NOT NULL,
  description                              text,
  goal_count                               integer NOT NULL,
  progress_count                           integer NOT NULL DEFAULT 0,
  time_limit_hours                         integer,
  status                                   text NOT NULL DEFAULT 'active'::text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  expires_at                               timestamp with time zone,
  completed_at                             timestamp with time zone,
  visibility                               text NOT NULL DEFAULT 'private'::text,
  creator_name                             text,
  participant_name                         text,
  invited_email                            text,
  invite_token                             text,
  baseline_count                           integer NOT NULL DEFAULT 0,
  accepted_at                              timestamp with time zone,
  invited_phone                            text,
  scoring_mode                             text NOT NULL DEFAULT 'reach_goal'::text,
  cover_image_path                         text,
  participant_count                        integer NOT NULL DEFAULT 0
);

-- ── contact_activities ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contact_activities (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  contact_id                               uuid NOT NULL,
  type                                     text NOT NULL,
  note                                     text,
  timestamp                                timestamp with time zone DEFAULT now(),
  created_at                               timestamp with time zone DEFAULT now()
);

-- ── contacts [MISSING FROM WEB MIGRATIONS] ────────────
CREATE TABLE IF NOT EXISTS public.contacts (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  full_name                                text NOT NULL,
  phone                                    text,
  email                                    text,
  address                                  text NOT NULL,
  campaign_id                              uuid,
  farm_id                                  uuid,
  status                                   text DEFAULT 'new'::text,
  last_contacted                           timestamp with time zone,
  notes                                    text,
  reminder_date                            timestamp with time zone,
  created_at                               timestamp with time zone DEFAULT now(),
  updated_at                               timestamp with time zone DEFAULT now(),
  gers_id                                  text,
  gers_id_uuid                             uuid,
  address_id                               uuid,
  workspace_id                             uuid,
  session_id                               uuid,
  qr_code                                  text,
  external_crm_id                          text,
  last_synced_at                           timestamp with time zone,
  sync_status                              text,
  follow_up_at                             timestamp with time zone,
  appointment_at                           timestamp with time zone,
  phone_e164                               text,
  phone_last_validated_at                  timestamp with time zone,
  phone_validation_error                   text
);

-- ── conversions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.conversions (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  experiment_id                            uuid,
  variant_id                               uuid,
  campaign_id                              uuid NOT NULL,
  landing_page_id                          uuid NOT NULL,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── crm_connection_secrets ────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_connection_secrets (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  connection_id                            uuid NOT NULL,
  encrypted_api_key                        text NOT NULL,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── crm_connections ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_connections (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  provider                                 text NOT NULL,
  status                                   text NOT NULL DEFAULT 'disconnected'::text,
  connected_at                             timestamp with time zone,
  last_sync_at                             timestamp with time zone,
  metadata                                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  error_reason                             text,
  api_key_encrypted                        text,
  created_at                               timestamp without time zone DEFAULT now(),
  last_tested_at                           timestamp without time zone,
  last_push_at                             timestamp without time zone,
  last_error                               text,
  workspace_id                             uuid NOT NULL
);

-- ── crm_events [iOS-ONLY] ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_events (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  crm_type                                 text NOT NULL DEFAULT 'fub'::text,
  flyr_event_id                            uuid NOT NULL,
  fub_person_id                            bigint,
  fub_note_id                              bigint,
  fub_task_id                              bigint,
  fub_appointment_id                       bigint,
  transcript                               text,
  ai_json                                  jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── crm_object_links [iOS-ONLY] ───────────────────────
CREATE TABLE IF NOT EXISTS public.crm_object_links (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  crm_type                                 text NOT NULL DEFAULT 'fub'::text,
  flyr_lead_id                             uuid,
  flyr_address_id                          uuid,
  fub_person_id                            bigint,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  remote_object_id                         text,
  remote_object_type                       text,
  remote_metadata                          jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ── daily_content_cache ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_content_cache (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  content_type                             text NOT NULL,
  quote_text                               text,
  quote_author                             text,
  quote_category                           text,
  riddle_question                          text,
  riddle_answer                            text,
  riddle_difficulty                        text,
  source                                   text,
  fetched_at                               timestamp with time zone NOT NULL DEFAULT now(),
  expires_at                               timestamp with time zone NOT NULL,
  cache_date                               text NOT NULL
);

-- ── dialer_calls ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dialer_calls (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  session_id                               uuid NOT NULL,
  session_lead_id                          uuid NOT NULL,
  contact_id                               uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  call_request_id                          text NOT NULL,
  twilio_call_sid                          text,
  twilio_parent_call_sid                   text,
  to_number_raw                            text,
  to_number_e164                           text,
  from_number_e164                         text,
  status                                   text NOT NULL DEFAULT 'pending'::text,
  direction                                text NOT NULL DEFAULT 'outbound'::text,
  answered_at                              timestamp with time zone,
  ended_at                                 timestamp with time zone,
  duration_seconds                         integer,
  disposition                              text,
  disposition_note                         text,
  follow_up_at                             timestamp with time zone,
  appointment_at                           timestamp with time zone,
  status_payload                           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── dialer_session_leads ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.dialer_session_leads (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id                               uuid NOT NULL,
  workspace_id                             uuid NOT NULL,
  contact_id                               uuid NOT NULL,
  position                                 integer NOT NULL,
  status                                   text NOT NULL DEFAULT 'pending'::text,
  attempt_count                            integer NOT NULL DEFAULT 0,
  last_call_id                             uuid,
  claimed_by_user_id                       uuid,
  claimed_at                               timestamp with time zone,
  completed_at                             timestamp with time zone,
  skip_reason                              text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── dialer_sessions ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dialer_sessions (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  name                                     text,
  status                                   text NOT NULL DEFAULT 'active'::text,
  source_filter                            jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at                               timestamp with time zone,
  ended_at                                 timestamp with time zone,
  tab_id                                   text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── dialer_sms_followups ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.dialer_sms_followups (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  call_id                                  uuid NOT NULL,
  contact_id                               uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  twilio_message_sid                       text,
  from_number_e164                         text,
  to_number_e164                           text,
  body                                     text NOT NULL,
  status                                   text NOT NULL DEFAULT 'queued'::text,
  error_code                               text,
  error_message                            text,
  sent_at                                  timestamp with time zone,
  delivered_at                             timestamp with time zone,
  status_payload                           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── durham_staging_raw [LEGACY] ───────────────────────
CREATE TABLE IF NOT EXISTS public.durham_staging_raw (
  x                                        double precision,
  y                                        double precision,
  objectid                                 text,
  region_id                                text,
  civic_num                                text,
  civic_sfx                                text,
  unit                                     text,
  unit_range                               text,
  unit_num                                 text,
  unit_type                                text,
  road_name                                text,
  road_type                                text,
  type_short                               text,
  road_dir                                 text,
  dir_short                                text,
  town                                     text,
  municipality                             text,
  postal_code                              text,
  edit_date                                text,
  globalid                                 text,
  mxaddresscode                            text,
  mxorgid                                  text,
  mxcreationstate                          text
);

-- ── editor_project ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.editor_project (
  id                                       text NOT NULL,
  name                                     text NOT NULL,
  userId                                   uuid NOT NULL,
  json                                     text NOT NULL,
  height                                   integer NOT NULL,
  width                                    integer NOT NULL,
  thumbnailUrl                             text,
  isTemplate                               boolean DEFAULT false,
  isPro                                    boolean DEFAULT false,
  createdAt                                timestamp without time zone NOT NULL DEFAULT now(),
  updatedAt                                timestamp without time zone NOT NULL DEFAULT now()
);

-- ── entitlements ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entitlements (
  user_id                                  uuid NOT NULL,
  plan                                     text NOT NULL DEFAULT 'free'::text,
  is_active                                boolean NOT NULL DEFAULT false,
  source                                   text NOT NULL DEFAULT 'none'::text,
  current_period_end                       timestamp with time zone,
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  stripe_customer_id                       text,
  stripe_subscription_id                   text
);

-- ── experiments ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.experiments (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  landing_page_id                          uuid NOT NULL,
  name                                     text NOT NULL,
  status                                   text NOT NULL DEFAULT 'draft'::text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── farm_addresses ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_addresses (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  farm_id                                  uuid NOT NULL,
  gers_id                                  text,
  formatted                                text NOT NULL,
  house_number                             text,
  street_name                              text,
  locality                                 text,
  region                                   text,
  postal_code                              text,
  source                                   text NOT NULL DEFAULT 'map'::text,
  latitude                                 double precision,
  longitude                                double precision,
  geom                                     jsonb,
  visited_count                            integer NOT NULL DEFAULT 0,
  last_visited_at                          timestamp with time zone,
  last_touch_id                            uuid,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  campaign_address_id                      uuid,
  last_outcome_status                      text
);

-- ── farm_leads ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_leads (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  farm_id                                  uuid NOT NULL,
  touch_id                                 uuid,
  lead_source                              text NOT NULL,
  name                                     text,
  phone                                    text,
  email                                    text,
  address                                  text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── farm_meta_ad_daily_metrics ────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_meta_ad_daily_metrics (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  farm_id                                  uuid NOT NULL,
  farm_meta_campaign_link_id               uuid,
  meta_campaign_id                         text NOT NULL,
  date                                     date NOT NULL,
  spend                                    numeric DEFAULT 0,
  impressions                              integer DEFAULT 0,
  reach                                    integer DEFAULT 0,
  clicks                                   integer DEFAULT 0,
  leads                                    integer DEFAULT 0,
  actions                                  jsonb,
  raw_payload                              jsonb,
  created_at                               timestamp with time zone DEFAULT now(),
  updated_at                               timestamp with time zone DEFAULT now()
);

-- ── farm_meta_campaign_links ──────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_meta_campaign_links (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  farm_id                                  uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  team_id                                  uuid,
  meta_connection_id                       uuid,
  meta_ad_account_id                       text NOT NULL,
  meta_campaign_id                         text NOT NULL,
  meta_campaign_name                       text,
  status                                   text DEFAULT 'active'::text,
  linked_at                                timestamp with time zone DEFAULT now(),
  created_at                               timestamp with time zone DEFAULT now(),
  updated_at                               timestamp with time zone DEFAULT now(),
  last_synced_at                           timestamp with time zone
);

-- ── farm_touch_addresses ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_touch_addresses (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  farm_id                                  uuid NOT NULL,
  farm_touch_id                            uuid NOT NULL,
  farm_address_id                          uuid NOT NULL,
  campaign_address_id                      uuid,
  status                                   text NOT NULL DEFAULT 'delivered'::text,
  notes                                    text,
  occurred_at                              timestamp with time zone NOT NULL DEFAULT now(),
  created_by                               uuid DEFAULT auth.uid(),
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── farm_touches ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.farm_touches (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  farm_id                                  uuid NOT NULL,
  date                                     date NOT NULL,
  type                                     text NOT NULL,
  title                                    text NOT NULL,
  notes                                    text,
  order_index                              integer,
  completed                                boolean DEFAULT false,
  campaign_id                              uuid,
  batch_id                                 uuid,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  workspace_id                             uuid,
  mode                                     text NOT NULL DEFAULT 'doorknock'::text,
  started_at                               timestamp with time zone,
  completed_date                           timestamp with time zone,
  last_completed_at                        timestamp with time zone,
  homes_target                             integer,
  homes_reached                            integer,
  updated_at                               timestamp with time zone DEFAULT now(),
  session_id                               uuid,
  completed_at                             timestamp with time zone,
  completed_by_user_id                     uuid,
  execution_metrics                        jsonb DEFAULT '{}'::jsonb,
  scheduled_date                           timestamp with time zone DEFAULT now(),
  status                                   text DEFAULT 'scheduled'::text,
  cycle_number                             integer DEFAULT 1
);

-- ── farms [MISSING FROM WEB MIGRATIONS] ───────────────
CREATE TABLE IF NOT EXISTS public.farms (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id                                 uuid NOT NULL,
  name                                     text NOT NULL,
  area_label                               text,
  frequency_days                           integer DEFAULT 30,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  polygon                                  geometry,
  start_date                               date,
  end_date                                 date,
  frequency                                integer DEFAULT 2,
  workspace_id                             uuid,
  description                              text,
  home_limit                               integer DEFAULT 5000,
  address_count                            integer DEFAULT 0,
  last_generated_at                        timestamp with time zone,
  linked_campaign_id                       uuid,
  touches_per_interval                     integer DEFAULT 2,
  touches_interval                         text DEFAULT 'month'::text,
  touch_types                              text[] DEFAULT ARRAY[]::text[],
  annual_budget_cents                      integer,
  is_active                                boolean DEFAULT true,
  goal_type                                text,
  goal_target                              integer,
  cycle_completion_window_days             integer,
  include_social_ads_in_spend              boolean NOT NULL DEFAULT false
);

-- ── feedback_items ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback_items (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  thread_id                                uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  type                                     text NOT NULL,
  title                                    text,
  body                                     text NOT NULL,
  context                                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── feedback_threads ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback_threads (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  status                                   text NOT NULL DEFAULT 'open'::text,
  last_feedback_at                         timestamp with time zone NOT NULL DEFAULT now(),
  unread_for_founder                       boolean NOT NULL DEFAULT true,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── field_leads ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_leads (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  address                                  text NOT NULL,
  name                                     text,
  phone                                    text,
  status                                   text NOT NULL DEFAULT 'not_home'::text,
  notes                                    text,
  qr_code                                  text,
  campaign_id                              uuid,
  session_id                               uuid,
  external_crm_id                          text,
  last_synced_at                           timestamp with time zone,
  sync_status                              text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  email                                    text,
  workspace_id                             uuid
);

-- ── field_sessions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.field_sessions (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  campaign_id                              uuid,
  started_at                               timestamp with time zone NOT NULL,
  ended_at                                 timestamp with time zone,
  duration_seconds                         integer,
  route                                    geometry,
  stats                                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── finance_entries ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_entries (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid,
  created_by                               uuid NOT NULL,
  campaign_id                              uuid,
  farm_id                                  uuid,
  agent_user_id                            uuid,
  category                                 text NOT NULL,
  description                              text NOT NULL DEFAULT ''::text,
  vendor                                   text,
  postal_code                              text,
  quantity                                 integer NOT NULL DEFAULT 1,
  unit_label                               text NOT NULL DEFAULT 'item'::text,
  unit_cost_cents                          integer NOT NULL DEFAULT 0,
  total_cost_cents                         integer NOT NULL DEFAULT 0,
  currency                                 text NOT NULL DEFAULT 'CAD'::text,
  incurred_on                              date NOT NULL DEFAULT CURRENT_DATE,
  notes                                    text,
  metadata                                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── flyers ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flyers (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid NOT NULL,
  name                                     text NOT NULL DEFAULT 'New Flyer'::text,
  size                                     text NOT NULL DEFAULT 'LETTER_8_5x11'::text,
  data                                     jsonb NOT NULL DEFAULT '{"elements": [], "backgroundColor": "#ffffff"}'::jsonb,
  created_at                               timestamp with time zone DEFAULT now(),
  updated_at                               timestamp with time zone DEFAULT now()
);

-- ── global_address_cache ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.global_address_cache (
  gers_id                                  text NOT NULL,
  house_number                             text,
  street_name                              text,
  postal_code                              text,
  formatted_address                        text,
  centroid                                 geometry,
  source                                   text DEFAULT 'mapbox'::text,
  created_at                               timestamp with time zone DEFAULT now()
);

-- ── gold_data_sync_log ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gold_data_sync_log (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  source_id                                text NOT NULL,
  source_type                              text NOT NULL,
  s3_bucket                                text NOT NULL,
  s3_key                                   text NOT NULL,
  records_fetched                          integer DEFAULT 0,
  records_filtered                         integer DEFAULT 0,
  records_inserted                         integer DEFAULT 0,
  records_deleted                          integer DEFAULT 0,
  sync_started_at                          timestamp with time zone DEFAULT now(),
  sync_completed_at                        timestamp with time zone,
  sync_duration_ms                         integer,
  sync_status                              text DEFAULT 'running'::text,
  error_message                            text,
  arcgis_url                               text,
  metadata                                 jsonb
);

-- ── landing_page_events ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.landing_page_events (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  landing_page_id                          uuid NOT NULL,
  event_type                               text NOT NULL,
  device                                   text,
  timestamp                                timestamp with time zone NOT NULL DEFAULT now()
);

-- ── landing_page_templates ────────────────────────────
CREATE TABLE IF NOT EXISTS public.landing_page_templates (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  name                                     text NOT NULL,
  description                              text,
  preview_image_url                        text,
  components                               jsonb DEFAULT '{}'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── landing_pages ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.landing_pages (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  name                                     text NOT NULL,
  url                                      text NOT NULL,
  type                                     text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  campaign_id                              uuid,
  address_id                               uuid,
  template_id                              uuid,
  title                                    text,
  subtitle                                 text,
  description                              text,
  cta_text                                 text,
  cta_url                                  text,
  image_url                                text,
  video_url                                text,
  dynamic_data                             jsonb DEFAULT '{}'::jsonb,
  slug                                     text
);

-- ── leaderboard_rollups ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.leaderboard_rollups (
  scope_key                                text NOT NULL,
  workspace_id                             uuid,
  user_id                                  uuid NOT NULL,
  timeframe                                text NOT NULL,
  period_start                             timestamp with time zone NOT NULL,
  doorknocks                               integer NOT NULL DEFAULT 0,
  conversations                            integer NOT NULL DEFAULT 0,
  leads                                    integer NOT NULL DEFAULT 0,
  distance_km                              double precision NOT NULL DEFAULT 0.0,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── live_session_codes ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.live_session_codes (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id                               uuid NOT NULL,
  campaign_id                              uuid NOT NULL,
  workspace_id                             uuid,
  created_by                               uuid NOT NULL,
  code_hash                                text NOT NULL,
  expires_at                               timestamp with time zone NOT NULL,
  revoked_at                               timestamp with time zone,
  last_used_at                             timestamp with time zone,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── loader_loaded_files ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.loader_loaded_files (
  s3_key                                   text NOT NULL,
  source_id                                text NOT NULL,
  status                                   text NOT NULL DEFAULT 'in_progress'::text,
  rows_loaded                              bigint NOT NULL DEFAULT 0,
  attempts                                 integer NOT NULL DEFAULT 0,
  last_error                               text,
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  loaded_at                                timestamp with time zone
);

-- ── map_buildings ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.map_buildings (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  source                                   text NOT NULL DEFAULT 'overture'::text,
  gers_id                                  text,
  geom                                     geometry NOT NULL,
  centroid                                 geometry,
  height_m                                 numeric DEFAULT 6,
  levels                                   integer DEFAULT 2,
  is_townhome_row                          boolean DEFAULT false,
  units_count                              integer DEFAULT 0,
  divider_lines                            geometry,
  unit_points                              geometry,
  address_id                               uuid,
  campaign_id                              uuid,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  gers_id_uuid                             uuid,
  house_number                             text,
  street_name                              text,
  house_name                               text
);

-- ── meta_ad_accounts ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meta_ad_accounts (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  team_id                                  uuid,
  meta_connection_id                       uuid,
  meta_ad_account_id                       text NOT NULL,
  name                                     text,
  currency                                 text,
  account_status                           text,
  created_at                               timestamp with time zone DEFAULT now(),
  updated_at                               timestamp with time zone DEFAULT now()
);

-- ── meta_connections ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meta_connections (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  team_id                                  uuid,
  meta_user_id                             text,
  access_token_encrypted                   text NOT NULL,
  token_expires_at                         timestamp with time zone,
  scopes                                   text[],
  connected_at                             timestamp with time zone DEFAULT now(),
  created_at                               timestamp with time zone DEFAULT now(),
  updated_at                               timestamp with time zone DEFAULT now()
);

-- ── meta_sync_logs ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meta_sync_logs (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  farm_id                                  uuid,
  farm_meta_campaign_link_id               uuid,
  meta_campaign_id                         text,
  user_id                                  uuid,
  team_id                                  uuid,
  status                                   text NOT NULL,
  message                                  text,
  error_code                               text,
  synced_from                              date,
  synced_to                                date,
  rows_synced                              integer DEFAULT 0,
  created_at                               timestamp with time zone DEFAULT now()
);

-- ── notifications ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  type                                     text NOT NULL,
  title                                    text NOT NULL,
  body                                     text NOT NULL,
  data                                     jsonb,
  read_at                                  timestamp with time zone,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── overture_transportation ───────────────────────────
CREATE TABLE IF NOT EXISTS public.overture_transportation (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  gers_id                                  text,
  geom                                     geometry NOT NULL,
  class                                    text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  subclass                                 text
);

-- ── partner_offers ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.partner_offers (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  token                                    text NOT NULL,
  recipient_name                           text,
  recipient_email                          text,
  partner_name                             text NOT NULL,
  offer_title                              text NOT NULL,
  offer_message                            text,
  cta_label                                text,
  cta_url                                  text,
  max_views                                integer,
  view_count                               integer NOT NULL DEFAULT 0,
  expires_at                               timestamp with time zone NOT NULL,
  last_viewed_at                           timestamp with time zone,
  created_by                               uuid,
  revoked_at                               timestamp with time zone,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  email_sent                               boolean NOT NULL DEFAULT false,
  email_sent_at                            timestamp with time zone,
  email_recipient                          text,
  resend_message_id                        text,
  email_status                             text NOT NULL DEFAULT 'not_requested'::text,
  is_draft                                 boolean NOT NULL DEFAULT false,
  vanity_slug                              text
);

-- ── profiles [LEGACY] ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id                                       uuid NOT NULL,
  email                                    text,
  full_name                                text,
  avatar_url                               text,
  phone_number                             text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  first_name                               text,
  last_name                                text,
  nickname                                 text,
  quote                                    text,
  profile_image_url                        text,
  is_support                               boolean NOT NULL DEFAULT false
);

-- ── project [LEGACY] ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project (
  id                                       text NOT NULL,
  name                                     text NOT NULL,
  userId                                   text NOT NULL,
  json                                     text NOT NULL,
  height                                   integer NOT NULL,
  width                                    integer NOT NULL,
  thumbnailUrl                             text,
  isTemplate                               boolean,
  isPro                                    boolean,
  createdAt                                timestamp without time zone NOT NULL,
  updatedAt                                timestamp without time zone NOT NULL
);

-- ── qr_code_scans ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qr_code_scans (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  qr_code_id                               uuid,
  address_id                               uuid,
  scanned_at                               timestamp with time zone NOT NULL DEFAULT now(),
  device_info                              text,
  user_agent                               text,
  ip_address                               inet,
  referrer                                 text
);

-- ── qr_codes [MISSING FROM WEB MIGRATIONS] ────────────
CREATE TABLE IF NOT EXISTS public.qr_codes (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_id                              uuid,
  farm_id                                  uuid,
  qr_url                                   text NOT NULL,
  qr_image                                 text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  metadata                                 jsonb DEFAULT '{}'::jsonb,
  address_id                               uuid,
  landing_page_id                          uuid,
  qr_variant                               text,
  slug                                     text,
  destination_type                         text,
  direct_url                               text
);

-- ── qr_scan_events ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qr_scan_events (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  experiment_id                            uuid,
  variant_id                               uuid,
  campaign_id                              uuid,
  landing_page_id                          uuid,
  device_type                              text,
  city                                     text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── qr_sets ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qr_sets (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  name                                     text NOT NULL,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  total_addresses                          integer DEFAULT 0,
  variant_count                            integer DEFAULT 0,
  qr_code_ids                              text[] DEFAULT '{}'::uuid[],
  campaign_id                              uuid,
  user_id                                  uuid NOT NULL
);

-- ── ref_addresses_gold ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ref_addresses_gold (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  source_id                                text NOT NULL,
  source_file                              text,
  source_url                               text,
  source_date                              date,
  street_number                            text NOT NULL,
  street_name                              text NOT NULL,
  unit                                     text,
  city                                     text NOT NULL,
  zip                                      text,
  province                                 text DEFAULT 'ON'::text,
  country                                  text DEFAULT 'CA'::text,
  geom                                     geometry NOT NULL,
  address_type                             text,
  precision                                text DEFAULT 'rooftop'::text,
  created_at                               timestamp with time zone DEFAULT now(),
  updated_at                               timestamp with time zone DEFAULT now(),
  street_number_normalized                 integer,
  street_name_normalized                   text,
  zip_normalized                           text
);

-- ── ref_buildings_gold ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ref_buildings_gold (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  source_id                                text NOT NULL,
  source_file                              text,
  source_url                               text,
  source_date                              date,
  external_id                              text,
  parcel_id                                text,
  geom                                     geometry NOT NULL,
  centroid                                 geometry,
  area_sqm                                 double precision,
  height_m                                 double precision,
  floors                                   integer,
  year_built                               integer,
  building_type                            text,
  subtype                                  text,
  primary_address                          text,
  primary_street_number                    text,
  primary_street_name                      text,
  created_at                               timestamp with time zone DEFAULT now(),
  updated_at                               timestamp with time zone DEFAULT now()
);

-- ── report_runs ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.report_runs (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  period                                   text NOT NULL,
  period_start                             timestamp with time zone NOT NULL,
  period_end                               timestamp with time zone NOT NULL,
  ran_at                                   timestamp with time zone NOT NULL DEFAULT now()
);

-- ── reports ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reports (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  scope                                    text NOT NULL,
  owner_user_id                            uuid,
  subject_user_id                          uuid,
  owner_user_key                           uuid,
  subject_user_key                         uuid,
  period                                   text NOT NULL,
  period_start                             timestamp with time zone NOT NULL,
  period_end                               timestamp with time zone NOT NULL,
  metrics                                  jsonb NOT NULL,
  deltas                                   jsonb NOT NULL,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── route_assignments ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.route_assignments (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  route_plan_id                            uuid NOT NULL,
  workspace_id                             uuid NOT NULL,
  assigned_to_user_id                      uuid NOT NULL,
  assigned_by_user_id                      uuid NOT NULL,
  status                                   text NOT NULL DEFAULT 'assigned'::text,
  started_at                               timestamp with time zone,
  completed_at                             timestamp with time zone,
  progress                                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  priority                                 text NOT NULL DEFAULT 'normal'::text,
  due_at                                   timestamp with time zone,
  notes                                    text,
  accepted_at                              timestamp with time zone,
  declined_at                              timestamp with time zone,
  decline_reason                           text
);

-- ── route_map_snapshots ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.route_map_snapshots (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  assignment_id                            uuid,
  route_plan_id                            uuid NOT NULL,
  campaign_id                              uuid NOT NULL,
  workspace_id                             uuid NOT NULL,
  snapshot_kind                            text NOT NULL DEFAULT 'assignment'::text,
  status                                   text NOT NULL DEFAULT 'ready'::text,
  campaign_version                         text NOT NULL,
  route_version                            integer NOT NULL DEFAULT 1,
  stops_geojson                            jsonb NOT NULL DEFAULT '{"type": "FeatureCollection", "features": []}'::jsonb,
  buildings_geojson                        jsonb NOT NULL DEFAULT '{"type": "FeatureCollection", "features": []}'::jsonb,
  addresses_geojson                        jsonb NOT NULL DEFAULT '{"type": "FeatureCollection", "features": []}'::jsonb,
  roads_geojson                            jsonb,
  bbox                                     jsonb,
  feature_counts                           jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at                             timestamp with time zone NOT NULL DEFAULT now(),
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── route_plans ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.route_plans (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  campaign_id                              uuid,
  created_by_user_id                       uuid NOT NULL,
  name                                     text NOT NULL,
  status                                   text NOT NULL DEFAULT 'draft'::text,
  total_stops                              integer NOT NULL DEFAULT 0,
  est_minutes                              integer,
  distance_meters                          integer,
  segments                                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  route_version                            integer NOT NULL DEFAULT 1
);

-- ── route_stops ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.route_stops (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  route_plan_id                            uuid NOT NULL,
  stop_order                               integer NOT NULL,
  address_id                               uuid,
  gers_id                                  text,
  lat                                      double precision,
  lng                                      double precision,
  display_address                          text,
  building_id                              uuid,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── safety_events ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_events (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id                               uuid NOT NULL,
  share_id                                 uuid,
  created_by                               uuid NOT NULL,
  event_type                               text NOT NULL,
  lat                                      double precision,
  lon                                      double precision,
  message                                  text,
  metadata                                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at                          timestamp with time zone,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── scan_events ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scan_events (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  building_id                              uuid,
  campaign_id                              uuid,
  scanned_at                               timestamp with time zone NOT NULL DEFAULT now(),
  qr_id                                    text,
  qr_code_id                               uuid,
  address_id                               uuid
);

-- ── session [LEGACY] ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session (
  sessionToken                             text NOT NULL,
  userId                                   text NOT NULL,
  expires                                  timestamp without time zone NOT NULL
);

-- ── session_checkins ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_checkins (
  session_id                               uuid NOT NULL,
  share_id                                 uuid,
  created_by                               uuid NOT NULL,
  interval_minutes                         integer NOT NULL,
  grace_period_minutes                     integer NOT NULL DEFAULT 5,
  status                                   text NOT NULL DEFAULT 'active'::text,
  next_prompt_at                           timestamp with time zone,
  last_prompted_at                         timestamp with time zone,
  last_confirmed_at                        timestamp with time zone,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── session_events [MISSING FROM WEB MIGRATIONS] ──────
CREATE TABLE IF NOT EXISTS public.session_events (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id                               uuid NOT NULL,
  address_id                               uuid NOT NULL,
  event_type                               text NOT NULL DEFAULT 'address_tap'::text,
  conversation_type                        text,
  notes                                    text,
  outcome                                  text,
  left_flyer                               boolean NOT NULL DEFAULT false,
  timestamp                                timestamp with time zone NOT NULL DEFAULT now(),
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  building_id                              uuid,
  user_id                                  uuid,
  lat                                      double precision,
  lon                                      double precision,
  event_location                           geometry,
  metadata                                 jsonb
);

-- ── session_heartbeats ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_heartbeats (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id                               uuid NOT NULL,
  share_id                                 uuid,
  lat                                      double precision NOT NULL,
  lon                                      double precision NOT NULL,
  battery_level                            double precision,
  movement_state                           text NOT NULL DEFAULT 'unknown'::text,
  device_status                            jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at                              timestamp with time zone NOT NULL DEFAULT now(),
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── session_participants ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_participants (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id                               uuid NOT NULL,
  campaign_id                              uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  role                                     text NOT NULL DEFAULT 'member'::text,
  joined_via_invite_id                     uuid,
  joined_at                                timestamp with time zone NOT NULL DEFAULT now(),
  left_at                                  timestamp with time zone,
  last_seen_at                             timestamp with time zone NOT NULL DEFAULT now()
);

-- ── session_shares ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_shares (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id                               uuid NOT NULL,
  created_by                               uuid NOT NULL,
  share_token_hash                         text NOT NULL,
  viewer_label                             text,
  expires_at                               timestamp with time zone,
  revoked_at                               timestamp with time zone,
  last_viewed_at                           timestamp with time zone,
  check_in_interval_minutes                integer,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── sessions [MISSING FROM WEB MIGRATIONS] ────────────
CREATE TABLE IF NOT EXISTS public.sessions (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  start_time                               timestamp with time zone NOT NULL,
  end_time                                 timestamp with time zone,
  distance_meters                          double precision NOT NULL DEFAULT 0.0,
  goal_type                                text NOT NULL,
  goal_amount                              integer NOT NULL DEFAULT 0,
  path_geojson                             text NOT NULL,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  campaign_id                              uuid,
  doors_hit                                integer NOT NULL DEFAULT 0,
  conversations                            integer NOT NULL DEFAULT 0,
  summary_png_url                          text,
  route_data                               jsonb,
  flyers_delivered                         integer NOT NULL DEFAULT 0,
  is_paused                                boolean NOT NULL DEFAULT false,
  active_seconds                           integer NOT NULL DEFAULT 0,
  target_building_ids                      text[],
  completed_count                          integer NOT NULL DEFAULT 0,
  auto_complete_enabled                    boolean NOT NULL DEFAULT false,
  auto_complete_threshold_m                double precision NOT NULL DEFAULT 15.0,
  auto_complete_dwell_seconds              integer NOT NULL DEFAULT 8,
  notes                                    text,
  target_count                             integer,
  workspace_id                             uuid,
  leads_created                            integer NOT NULL DEFAULT 0,
  path_geojson_normalized                  text,
  route_assignment_id                      uuid,
  farm_id                                  uuid,
  farm_touch_id                            uuid,
  session_mode                             text NOT NULL DEFAULT 'door_knocking'::text
);

-- ── spatial_ref_sys ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.spatial_ref_sys (
  srid                                     integer NOT NULL,
  auth_name                                varchar(256),
  auth_srid                                integer,
  srtext                                   varchar(2048),
  proj4text                                varchar(2048)
);

-- ── staging_addresses ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.staging_addresses (
  source_id                                text,
  source_file                              text,
  source_url                               text,
  source_date                              text,
  street_number                            text,
  street_name                              text,
  unit                                     text,
  city                                     text,
  zip                                      text,
  province                                 text,
  country                                  text,
  geom                                     text,
  address_type                             text,
  precision                                text
);

-- ── subscription [LEGACY] ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription (
  id                                       text NOT NULL,
  userId                                   text NOT NULL,
  subscriptionId                           text NOT NULL,
  customerId                               text NOT NULL,
  priceId                                  text NOT NULL,
  status                                   text NOT NULL,
  currentPeriodEnd                         timestamp without time zone,
  createdAt                                timestamp without time zone NOT NULL,
  updatedAt                                timestamp without time zone NOT NULL
);

-- ── support_messages ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_messages (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  thread_id                                uuid NOT NULL,
  sender_type                              text NOT NULL,
  sender_user_id                           uuid,
  body                                     text NOT NULL,
  created_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── support_threads ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_threads (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  status                                   text NOT NULL DEFAULT 'open'::text,
  last_message_at                          timestamp with time zone NOT NULL DEFAULT now(),
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  last_sender_type                         text,
  last_message_id                          uuid,
  last_message_preview                     text,
  needs_reply                              boolean NOT NULL DEFAULT false,
  unread_for_support                       boolean NOT NULL DEFAULT false,
  unread_for_user                          boolean NOT NULL DEFAULT false,
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── user [LEGACY] ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user (
  id                                       text NOT NULL,
  name                                     text,
  email                                    text NOT NULL,
  emailVerified                            timestamp without time zone,
  image                                    text,
  password                                 text
);

-- ── user_integrations ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_integrations (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  provider                                 text NOT NULL,
  access_token                             text,
  refresh_token                            text,
  api_key                                  text,
  webhook_url                              text,
  expires_at                               bigint,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  account_id                               text,
  account_name                             text,
  selected_board_id                        text,
  selected_board_name                      text,
  provider_config                          jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ── user_profiles ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id                                  uuid NOT NULL,
  pro_active                               boolean DEFAULT false,
  stripe_customer_id                       text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  weekly_door_goal                         integer DEFAULT 100,
  weekly_sessions_goal                     integer,
  weekly_minutes_goal                      integer,
  first_name                               text,
  last_name                                text,
  is_founder                               boolean NOT NULL DEFAULT false,
  industry                                 text,
  brokerage_name                           text,
  quote                                    text,
  avatar_url                               text,
  current_workspace_id                     uuid
);

-- ── user_settings ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id                                  uuid NOT NULL,
  exclude_weekends                         boolean NOT NULL DEFAULT false,
  dark_mode                                boolean NOT NULL DEFAULT true,
  follow_up_boss_key                       text,
  member_since                             timestamp with time zone,
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  brand_color                              text,
  logo_url                                 text,
  realtor_profile_card                     jsonb,
  default_cta_color                        text,
  font_style                               text,
  default_template_id                      uuid
);

-- ── user_stats ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_stats (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id                                  uuid NOT NULL,
  day_streak                               integer NOT NULL DEFAULT 0,
  best_streak                              integer NOT NULL DEFAULT 0,
  doors_knocked                            integer NOT NULL DEFAULT 0,
  flyers                                   integer NOT NULL DEFAULT 0,
  conversations                            integer NOT NULL DEFAULT 0,
  leads_created                            integer NOT NULL DEFAULT 0,
  qr_codes_scanned                         integer NOT NULL DEFAULT 0,
  distance_walked                          double precision NOT NULL DEFAULT 0.0,
  conversation_per_door                    double precision NOT NULL DEFAULT 0.0,
  conversation_lead_rate                   double precision NOT NULL DEFAULT 0.0,
  qr_code_scan_rate                        double precision NOT NULL DEFAULT 0.0,
  qr_code_lead_rate                        double precision NOT NULL DEFAULT 0.0,
  streak_days                              jsonb DEFAULT '[]'::jsonb,
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  time_tracked                             integer NOT NULL DEFAULT 0,
  xp                                       integer NOT NULL DEFAULT 0,
  appointments                             integer NOT NULL DEFAULT 0
);

-- ── verificationToken [LEGACY] ────────────────────────
CREATE TABLE IF NOT EXISTS public.verificationToken (
  identifier                               text NOT NULL,
  token                                    text NOT NULL,
  expires                                  timestamp without time zone NOT NULL
);

-- ── workspace_billing_addons ──────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_billing_addons (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  addon_key                                text NOT NULL,
  status                                   text NOT NULL DEFAULT 'inactive'::text,
  stripe_subscription_id                   text,
  stripe_subscription_item_id              text,
  stripe_price_id                          text,
  quantity                                 integer NOT NULL DEFAULT 1,
  amount_cents                             integer,
  currency                                 text,
  activated_at                             timestamp with time zone,
  canceled_at                              timestamp with time zone,
  metadata                                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now()
);

-- ── workspace_dialer_settings ─────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_dialer_settings (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  enabled                                  boolean NOT NULL DEFAULT true,
  default_from_number                      text,
  default_sms_from_number                  text,
  allow_sms_followup                       boolean NOT NULL DEFAULT false,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  inbound_forward_to                       text,
  twilio_incoming_phone_number_sid         text,
  number_status                            text NOT NULL DEFAULT 'unassigned'::text,
  number_assigned_at                       timestamp with time zone,
  provisioning_metadata                    jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ── workspace_invites ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  email                                    text NOT NULL,
  role                                     text NOT NULL DEFAULT 'member'::text,
  token                                    text NOT NULL,
  status                                   text NOT NULL DEFAULT 'pending'::text,
  invited_by                               uuid,
  expires_at                               timestamp with time zone NOT NULL,
  accepted_at                              timestamp with time zone,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  campaign_id                              uuid,
  created_by                               uuid,
  accepted_by                              uuid,
  invite_token                             text,
  session_id                               uuid
);

-- ── workspace_members ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id                             uuid NOT NULL,
  user_id                                  uuid NOT NULL,
  role                                     text NOT NULL DEFAULT 'member'::text,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  color                                    text
);

-- ── workspaces ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspaces (
  id                                       uuid NOT NULL DEFAULT gen_random_uuid(),
  name                                     text NOT NULL,
  owner_id                                 uuid,
  created_at                               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                               timestamp with time zone NOT NULL DEFAULT now(),
  industry                                 text,
  subscription_status                      text NOT NULL DEFAULT 'inactive'::text,
  trial_ends_at                            timestamp with time zone,
  max_seats                                integer NOT NULL DEFAULT 1,
  onboarding_completed_at                  timestamp with time zone,
  referral_code_used                       text,
  brokerage_id                             uuid,
  brokerage_name                           text,
  timezone                                 text NOT NULL DEFAULT 'UTC'::text,
  weekly_door_goal                         integer,
  weekly_sessions_goal                     integer,
  weekly_minutes_goal                      integer,
  weekly_door_goal_per_member              boolean NOT NULL DEFAULT false
);
