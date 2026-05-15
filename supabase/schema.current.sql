-- -----------------------------------------------------------------------------
-- Schema export: exported via information_schema queries on 2026-05-15
-- Project: kfnsnwqylsdsbgnwgxva
-- Schema: public
-- Tables: 134
-- Source artifacts: ColumnDefinitions.csv, ForeignKeys.csv, FunctionsRPCs.csv, Indexes.csv, PrimaryKeys.csv
-- -----------------------------------------------------------------------------

CREATE TABLE public."account" (
  "userId" text NOT NULL,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "providerAccountId" text NOT NULL,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text,
  CONSTRAINT "account_pkey" PRIMARY KEY ("provider", "providerAccountId")
);

CREATE TABLE public."activity_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "event_time" timestamp with time zone NOT NULL,
  "ref_id" uuid,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."address_content" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "address_id" uuid NOT NULL,
  "title" text DEFAULT ''::text NOT NULL,
  "videos" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "images" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "forms" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "address_content_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."address_orphans" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid,
  "address_id" uuid,
  "nearest_building_id" text,
  "nearest_distance" double precision,
  "nearest_building_street" text,
  "address_street" text,
  "street_match_score" double precision,
  "suggested_buildings" jsonb DEFAULT '[]'::jsonb,
  "status" text DEFAULT 'pending'::text,
  "assigned_building_id" text,
  "assigned_by" uuid,
  "assigned_at" timestamp without time zone,
  "created_at" timestamp without time zone DEFAULT now(),
  "coordinate" geometry,
  "suggested_street" text,
  CONSTRAINT "address_orphans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."address_statuses" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_address_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "status" text DEFAULT 'none'::text NOT NULL,
  "last_visited_at" timestamp with time zone,
  "notes" text,
  "visit_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_action_by" uuid,
  "last_session_id" uuid,
  "last_home_event_id" uuid,
  CONSTRAINT "address_statuses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."ambassador_applications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text,
  "city" text,
  "primary_niche" text NOT NULL,
  "primary_platform" text NOT NULL,
  "audience_size" text,
  "instagram_handle" text,
  "tiktok_handle" text,
  "youtube_handle" text,
  "website_url" text,
  "audience_summary" text,
  "why_flyr" text NOT NULL,
  "promotion_plan" text,
  "status" text DEFAULT 'applied'::text NOT NULL,
  "review_notes" text,
  "approved_at" timestamp with time zone,
  "rejected_at" timestamp with time zone,
  "stripe_connect_account_id" text,
  "stripe_onboarding_completed" boolean DEFAULT false NOT NULL,
  "stripe_details_submitted" boolean DEFAULT false NOT NULL,
  "stripe_charges_enabled" boolean DEFAULT false NOT NULL,
  "stripe_payouts_enabled" boolean DEFAULT false NOT NULL,
  "referral_code" text,
  "commission_rate_bps" integer DEFAULT 2500 NOT NULL,
  "commission_duration_months" integer DEFAULT 12 NOT NULL,
  "referral_code_max_uses" integer,
  "stripe_promotion_code_id" text,
  CONSTRAINT "ambassador_applications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."ambassador_commissions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ambassador_referral_id" uuid NOT NULL,
  "ambassador_application_id" uuid NOT NULL,
  "referred_user_id" uuid NOT NULL,
  "referred_workspace_id" uuid NOT NULL,
  "stripe_customer_id" text,
  "stripe_subscription_id" text NOT NULL,
  "stripe_invoice_id" text NOT NULL,
  "revenue_amount_cents" integer NOT NULL,
  "commission_rate_bps" integer NOT NULL,
  "commission_amount_cents" integer NOT NULL,
  "currency" text NOT NULL,
  "earned_at" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "paid_out_at" timestamp with time zone,
  "payout_batch_id" uuid,
  "stripe_transfer_id" text,
  CONSTRAINT "ambassador_commissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."ambassador_payout_batch_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payout_batch_id" uuid NOT NULL,
  "ambassador_commission_id" uuid NOT NULL,
  "amount_cents" integer NOT NULL,
  CONSTRAINT "ambassador_payout_batch_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."ambassador_payout_batches" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_user_id" uuid,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "currency" text NOT NULL,
  "total_commission_cents" integer DEFAULT 0 NOT NULL,
  "note" text,
  "paid_at" timestamp with time zone,
  "ambassador_application_id" uuid,
  "stripe_connect_account_id" text,
  "stripe_transfer_id" text,
  "transfer_group" text,
  "commission_snapshot_hash" text,
  "failure_reason" text,
  "processed_at" timestamp with time zone,
  CONSTRAINT "ambassador_payout_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."ambassador_referrals" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ambassador_application_id" uuid NOT NULL,
  "referred_user_id" uuid NOT NULL,
  "referred_workspace_id" uuid NOT NULL,
  "referral_code" text NOT NULL,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "stripe_subscription_status" text,
  "commission_rate_bps" integer DEFAULT 2500 NOT NULL,
  "commission_duration_months" integer DEFAULT 12 NOT NULL,
  "first_paid_at" timestamp with time zone,
  "eligible_until" timestamp with time zone,
  "last_paid_at" timestamp with time zone,
  "status" text DEFAULT 'attributed'::text NOT NULL,
  CONSTRAINT "ambassador_referrals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."auth_handoff_codes" (
  "code" text NOT NULL,
  "user_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "used_at" timestamp with time zone,
  CONSTRAINT "auth_handoff_codes_pkey" PRIMARY KEY ("code")
);

CREATE TABLE public."auth_handoffs" (
  "code" text NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "user_agent" text,
  "ip" text,
  CONSTRAINT "auth_handoffs_pkey" PRIMARY KEY ("code")
);

CREATE TABLE public."authenticator" (
  "credentialID" text NOT NULL,
  "userId" text NOT NULL,
  "providerAccountId" text NOT NULL,
  "credentialPublicKey" text NOT NULL,
  "counter" integer NOT NULL,
  "credentialDeviceType" text NOT NULL,
  "credentialBackedUp" boolean NOT NULL,
  "transports" text,
  CONSTRAINT "authenticator_pkey" PRIMARY KEY ("userId", "credentialID")
);

CREATE TABLE public."batches" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "qr_type" text NOT NULL,
  "landing_page_id" uuid,
  "custom_url" text,
  "export_format" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."brokerages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text,
  "logo_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "brokerages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."building_address_links" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid,
  "building_id" text NOT NULL,
  "address_id" uuid,
  "match_type" text,
  "confidence" double precision,
  "distance_meters" double precision,
  "street_match_score" double precision,
  "building_area_sqm" double precision,
  "building_class" text,
  "building_height" double precision,
  "is_multi_unit" boolean DEFAULT false,
  "unit_count" integer DEFAULT 1,
  "unit_arrangement" text,
  "overture_release" text,
  "matched_at" timestamp without time zone DEFAULT now(),
  "modified_at" timestamp without time zone,
  "linker_version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "building_address_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."building_slices" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "address_id" uuid NOT NULL,
  "building_id" uuid NOT NULL,
  "geom" geometry NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "building_slices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."building_split_errors" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "building_id" text NOT NULL,
  "building_geometry" jsonb,
  "error_type" text NOT NULL,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "address_count" integer,
  "address_ids" uuid[],
  "building_area" double precision,
  "original_building_geojson" jsonb,
  "address_positions" jsonb,
  "suggested_action" text,
  CONSTRAINT "building_split_errors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."building_stats" (
  "gers_id" text NOT NULL,
  "status" text DEFAULT 'not_visited'::text,
  "scans_today" integer DEFAULT 0,
  "scans_total" integer DEFAULT 0,
  "last_scan_at" timestamp with time zone,
  "campaign_id" uuid,
  CONSTRAINT "building_stats_pkey" PRIMARY KEY ("gers_id")
);

CREATE TABLE public."building_touches" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "address_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "building_id" text,
  "session_id" uuid,
  "touched_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "building_touches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."building_units" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "parent_building_id" text NOT NULL,
  "address_id" uuid,
  "unit_number" text NOT NULL,
  "unit_geometry" geometry NOT NULL,
  "split_method" text DEFAULT 'obb_linear'::text,
  "parent_type" text DEFAULT 'townhouse'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "parent_building_area" double precision,
  "validation_status" text DEFAULT 'passed'::text,
  CONSTRAINT "building_units_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."buildings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gers_id" text NOT NULL,
  "geom" geometry NOT NULL,
  "centroid" geometry NOT NULL,
  "latest_status" text DEFAULT 'default'::text,
  "is_hidden" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "campaign_id" uuid,
  "gers_id_uuid" uuid,
  "addr_housenumber" text,
  "addr_street" text,
  "addr_unit" text,
  "height" numeric,
  "house_name" text,
  "height_m" numeric,
  "address_id" uuid,
  "is_townhome_row" boolean DEFAULT false,
  "units_count" integer DEFAULT 1,
  "workspace_id" uuid NOT NULL,
  CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_addresses" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "formatted" text NOT NULL,
  "postal_code" text,
  "source" text DEFAULT 'mapbox'::text NOT NULL,
  "geom" geometry NOT NULL,
  "seq" integer NOT NULL,
  "visited" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "road_bearing" double precision,
  "house_bearing" double precision,
  "street_name" text,
  "is_oriented" boolean DEFAULT false,
  "orientation_locked" boolean DEFAULT false,
  "gers_id" text,
  "qr_code_base64" text,
  "purl" text,
  "gers_id_uuid" uuid,
  "house_number" text,
  "locality" text,
  "region" text,
  "building_gers_id" text,
  "scans" integer DEFAULT 0,
  "last_scanned_at" timestamp with time zone,
  "source_id" text,
  "coordinate" jsonb,
  "building_outline" jsonb,
  "contact_name" text,
  "lead_status" text DEFAULT 'new'::text,
  "product_interest" text,
  "follow_up_date" timestamp with time zone,
  "raw_transcript" text,
  "ai_summary" text,
  "status" text DEFAULT 'pending'::text,
  "cluster_id" integer,
  "sequence" integer,
  "walk_time_sec" integer,
  "distance_m" integer,
  "route_polyline" text,
  "building_id" uuid,
  "match_source" text,
  "confidence" double precision,
  "street_number" text,
  "address" text,
  CONSTRAINT "campaign_addresses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_addresses_geojson" (
  "id" uuid,
  "campaign_id" uuid,
  "address" text,
  "formatted" text,
  "postal_code" text,
  "source" text,
  "source_id" text,
  "seq" integer,
  "visited" boolean,
  "coordinate" jsonb,
  "geom" geometry,
  "building_outline" jsonb,
  "road_bearing" double precision,
  "house_bearing" double precision,
  "street_name" text,
  "house_number" text,
  "is_oriented" boolean,
  "orientation_locked" boolean,
  "scans" integer,
  "last_scanned_at" timestamp with time zone,
  "qr_code_base64" text,
  "purl" text,
  "created_at" timestamp with time zone,
  "cluster_id" integer,
  "sequence" integer,
  "walk_time_sec" integer,
  "distance_m" integer,
  "geom_json" jsonb
);

CREATE TABLE public."campaign_addresses_v" (
  "id" uuid,
  "campaign_id" uuid,
  "formatted" text,
  "postal_code" text,
  "source" text,
  "seq" integer,
  "visited" boolean,
  "created_at" timestamp with time zone,
  "geom_json" jsonb
);

CREATE TABLE public."campaign_assignment_homes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "assignment_id" uuid NOT NULL,
  "campaign_address_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_assignment_homes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_assignments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "assigned_to_user_id" uuid NOT NULL,
  "assigned_by_user_id" uuid NOT NULL,
  "mode" text NOT NULL,
  "goal_homes" integer DEFAULT 0 NOT NULL,
  "zone_index" integer,
  "status" text DEFAULT 'assigned'::text NOT NULL,
  "due_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_contacts" (
  "id" uuid,
  "campaign_id" uuid,
  "address_id" uuid,
  "name" text,
  "phone" text,
  "email" text,
  "address" text,
  "last_contacted_at" timestamp with time zone,
  "interest_level" text,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone
);

CREATE TABLE public."campaign_hidden_buildings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "public_building_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_hidden_buildings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_home_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "campaign_address_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "session_id" uuid,
  "action_type" text NOT NULL,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_home_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_landing_page_analytics" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "landing_page_id" uuid NOT NULL,
  "views" integer DEFAULT 0 NOT NULL,
  "unique_views" integer DEFAULT 0 NOT NULL,
  "cta_clicks" integer DEFAULT 0 NOT NULL,
  "timestamp_bucket" date DEFAULT CURRENT_DATE NOT NULL,
  CONSTRAINT "campaign_landing_page_analytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_landing_pages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "slug" text NOT NULL,
  "headline" text,
  "subheadline" text,
  "hero_url" text,
  "cta_type" text,
  "cta_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_landing_pages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_link_quality_dashboard" (
  "campaign_id" uuid,
  "name" text,
  "workspace_id" uuid,
  "owner_id" uuid,
  "provision_status" text,
  "parcel_enrichment_status" text,
  "parcel_source_id" text,
  "parcel_count" integer,
  "link_quality_status" text,
  "link_quality_score" integer,
  "link_quality_reason" text,
  "link_quality_checked_at" timestamp with time zone,
  "total_addresses" integer,
  "total_links" integer,
  "open_orphans" integer,
  "suspect_links" integer,
  "parcel_bridge_links" integer,
  "coverage_percent" numeric,
  "orphan_rate_percent" numeric,
  "suspect_rate_percent" numeric,
  "parcel_bridge_usage_percent" numeric,
  "link_quality_metrics" jsonb
);

CREATE TABLE public."campaign_match_quality" (
  "campaign_id" uuid,
  "containment_verified" bigint,
  "containment_suspect" bigint,
  "point_on_surface" bigint,
  "proximity_verified" bigint,
  "proximity_fallback" bigint,
  "manual" bigint,
  "orphan" bigint,
  "total" bigint,
  "avg_confidence" double precision,
  "avg_distance" double precision,
  "parcel_verified" bigint
);

CREATE TABLE public."campaign_members" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text DEFAULT 'member'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_parcels" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid,
  "external_id" text,
  "geom" geometry NOT NULL,
  "properties" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_parcels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_polished_building_features" (
  "campaign_id" uuid NOT NULL,
  "source" text NOT NULL,
  "feature_count" integer DEFAULT 0 NOT NULL,
  "feature_collection" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_polished_building_features_pkey" PRIMARY KEY ("campaign_id")
);

CREATE TABLE public."campaign_presence" (
  "campaign_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "session_id" uuid,
  "lat" double precision,
  "lng" double precision,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  CONSTRAINT "campaign_presence_pkey" PRIMARY KEY ("campaign_id", "user_id")
);

CREATE TABLE public."campaign_qr_batches" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "batch_name" text NOT NULL,
  "zip_url" text,
  "pdf_grid_url" text,
  "pdf_single_url" text,
  "csv_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_qr_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_road_metadata" (
  "campaign_id" uuid NOT NULL,
  "roads_status" text DEFAULT 'pending'::text NOT NULL,
  "road_count" integer DEFAULT 0 NOT NULL,
  "bounds" jsonb,
  "cache_version" integer DEFAULT 0 NOT NULL,
  "corridor_build_version" integer DEFAULT 1 NOT NULL,
  "fetched_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "last_refresh_at" timestamp with time zone,
  "last_error_message" text,
  "last_error_at" timestamp with time zone,
  "retry_count" integer DEFAULT 0 NOT NULL,
  "source" text DEFAULT 'mapbox'::text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_road_metadata_pkey" PRIMARY KEY ("campaign_id")
);

CREATE TABLE public."campaign_roads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "road_id" text NOT NULL,
  "road_name" text,
  "road_class" text,
  "geom" geometry NOT NULL,
  "bbox_min_lat" double precision NOT NULL,
  "bbox_min_lon" double precision NOT NULL,
  "bbox_max_lat" double precision NOT NULL,
  "bbox_max_lon" double precision NOT NULL,
  "source" text DEFAULT 'mapbox'::text NOT NULL,
  "source_version" text,
  "cache_version" integer DEFAULT 1 NOT NULL,
  "corridor_build_version" integer DEFAULT 1 NOT NULL,
  "properties" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_roads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_route_clusters" (
  "campaign_id" uuid,
  "cluster_id" integer,
  "n_addresses" bigint,
  "start_sequence" integer,
  "end_sequence" integer,
  "total_distance_m" bigint,
  "total_walk_time_sec" integer,
  "addresses" jsonb[]
);

CREATE TABLE public."campaign_routes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "route_data" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "campaign_routes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaign_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "bucket" text NOT NULL,
  "prefix" text NOT NULL,
  "buildings_key" text,
  "addresses_key" text,
  "roads_key" text,
  "metadata_key" text,
  "buildings_url" text,
  "addresses_url" text,
  "roads_url" text,
  "metadata_url" text,
  "buildings_count" integer DEFAULT 0,
  "addresses_count" integer DEFAULT 0,
  "roads_count" integer DEFAULT 0,
  "overture_release" text,
  "tile_metrics" jsonb,
  "optimized_path_geometry" jsonb,
  "optimized_path_distance_km" numeric(10,3),
  "optimized_path_time_minutes" integer,
  "created_at" timestamp with time zone DEFAULT now(),
  "expires_at" timestamp with time zone DEFAULT (now() + '30 days'::interval),
  CONSTRAINT "campaign_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."campaigns" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid DEFAULT auth.uid() NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "cover_image_url" text,
  "total_flyers" integer DEFAULT 0 NOT NULL,
  "scans" integer DEFAULT 0 NOT NULL,
  "conversions" integer DEFAULT 0 NOT NULL,
  "region" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "total_homes" integer,
  "default_map_style" text DEFAULT 'clean'::text,
  "territory_boundary" geometry,
  "address_source" text,
  "status" text DEFAULT 'draft'::text,
  "seed_query" text,
  "type" text DEFAULT 'flyer'::text,
  "name" text DEFAULT ''::text NOT NULL,
  "video_url" text,
  "bbox" float8[],
  "tags" text,
  "snapshot_bucket" text,
  "snapshot_prefix" text,
  "snapshot_buildings_url" text,
  "snapshot_roads_url" text,
  "snapshot_metadata_url" text,
  "overture_release" text,
  "provisioned_at" timestamp with time zone,
  "provision_status" text,
  "route_snapshot" jsonb,
  "campaign_polygon_raw" jsonb,
  "campaign_polygon_snapped" jsonb,
  "is_snapped" boolean DEFAULT false,
  "workspace_id" uuid NOT NULL,
  "data_confidence_score" double precision,
  "data_confidence_label" text,
  "data_confidence_reason" text,
  "data_confidence_summary" jsonb,
  "data_confidence_updated_at" timestamp with time zone,
  "parcel_enrichment_debug" jsonb DEFAULT '{}'::jsonb,
  "parcel_enrichment_status" text DEFAULT 'not_started'::text,
  "parcel_source_id" text,
  "parcel_count" integer DEFAULT 0,
  "parcel_enriched_at" timestamp with time zone,
  "parcel_enrichment_error" text,
  "link_quality_status" text DEFAULT 'unknown'::text,
  "link_quality_score" integer DEFAULT 0,
  "link_quality_reason" text,
  "link_quality_checked_at" timestamp with time zone,
  "link_quality_metrics" jsonb DEFAULT '{}'::jsonb,
  "has_parcels" boolean DEFAULT false NOT NULL,
  "building_link_confidence" double precision,
  "map_mode" text,
  "provision_source" text,
  "provision_phase" text DEFAULT 'created'::text,
  "addresses_ready_at" timestamp with time zone,
  "map_ready_at" timestamp with time zone,
  "optimized_at" timestamp with time zone,
  "coverage_score" integer,
  "data_quality" text,
  "standard_mode_recommended" boolean DEFAULT true NOT NULL,
  "data_quality_reason" text,
  CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."challenge_participants" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "challenge_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "participant_name" text,
  "baseline_count" integer DEFAULT 0 NOT NULL,
  "progress_count" integer DEFAULT 0 NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "last_sync_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "challenge_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."challenge_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "description" text DEFAULT ''::text NOT NULL,
  "scope" text NOT NULL,
  "type" text NOT NULL,
  "metric" text NOT NULL,
  "metric_label_override" text,
  "start_date" timestamp with time zone,
  "end_date" timestamp with time zone,
  "duration_days" integer,
  "workspace_id" uuid,
  "status" text DEFAULT 'upcoming'::text NOT NULL,
  "visibility" text DEFAULT 'public'::text NOT NULL,
  "target_audience" text,
  "include_all_members" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "challenge_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."challenges" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "creator_id" uuid NOT NULL,
  "participant_id" uuid,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "goal_count" integer NOT NULL,
  "progress_count" integer DEFAULT 0 NOT NULL,
  "time_limit_hours" integer,
  "status" text DEFAULT 'active'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "visibility" text DEFAULT 'private'::text NOT NULL,
  "creator_name" text,
  "participant_name" text,
  "invited_email" text,
  "invite_token" text,
  "baseline_count" integer DEFAULT 0 NOT NULL,
  "accepted_at" timestamp with time zone,
  "invited_phone" text,
  "scoring_mode" text DEFAULT 'reach_goal'::text NOT NULL,
  "cover_image_path" text,
  "participant_count" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."contact_activities" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "contact_id" uuid NOT NULL,
  "type" text NOT NULL,
  "note" text,
  "timestamp" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "contact_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."contacts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "phone" text,
  "email" text,
  "address" text NOT NULL,
  "campaign_id" uuid,
  "farm_id" uuid,
  "status" text DEFAULT 'new'::text,
  "last_contacted" timestamp with time zone,
  "notes" text,
  "reminder_date" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "gers_id" text,
  "gers_id_uuid" uuid,
  "address_id" uuid,
  "workspace_id" uuid,
  "session_id" uuid,
  "qr_code" text,
  "external_crm_id" text,
  "last_synced_at" timestamp with time zone,
  "sync_status" text,
  "follow_up_at" timestamp with time zone,
  "appointment_at" timestamp with time zone,
  "phone_e164" text,
  "phone_last_validated_at" timestamp with time zone,
  "phone_validation_error" text,
  CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."conversions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "experiment_id" uuid,
  "variant_id" uuid,
  "campaign_id" uuid NOT NULL,
  "landing_page_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."crm_connection_secrets" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "connection_id" uuid NOT NULL,
  "encrypted_api_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "crm_connection_secrets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."crm_connections" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "status" text DEFAULT 'disconnected'::text NOT NULL,
  "connected_at" timestamp with time zone,
  "last_sync_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "error_reason" text,
  "api_key_encrypted" text,
  "created_at" timestamp without time zone DEFAULT now(),
  "last_tested_at" timestamp without time zone,
  "last_push_at" timestamp without time zone,
  "last_error" text,
  "workspace_id" uuid NOT NULL,
  CONSTRAINT "crm_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."crm_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "crm_type" text DEFAULT 'fub'::text NOT NULL,
  "flyr_event_id" uuid NOT NULL,
  "fub_person_id" bigint,
  "fub_note_id" bigint,
  "fub_task_id" bigint,
  "fub_appointment_id" bigint,
  "transcript" text,
  "ai_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "crm_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."crm_object_links" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "crm_type" text DEFAULT 'fub'::text NOT NULL,
  "flyr_lead_id" uuid,
  "flyr_address_id" uuid,
  "fub_person_id" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "remote_object_id" text,
  "remote_object_type" text,
  "remote_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "crm_object_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."daily_content_cache" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "content_type" text NOT NULL,
  "quote_text" text,
  "quote_author" text,
  "quote_category" text,
  "riddle_question" text,
  "riddle_answer" text,
  "riddle_difficulty" text,
  "source" text,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "cache_date" text NOT NULL,
  CONSTRAINT "daily_content_cache_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."dialer_calls" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "session_id" uuid NOT NULL,
  "session_lead_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "call_request_id" text NOT NULL,
  "twilio_call_sid" text,
  "twilio_parent_call_sid" text,
  "to_number_raw" text,
  "to_number_e164" text,
  "from_number_e164" text,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "direction" text DEFAULT 'outbound'::text NOT NULL,
  "answered_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "duration_seconds" integer,
  "disposition" text,
  "disposition_note" text,
  "follow_up_at" timestamp with time zone,
  "appointment_at" timestamp with time zone,
  "status_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dialer_calls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."dialer_session_leads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_call_id" uuid,
  "claimed_by_user_id" uuid,
  "claimed_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "skip_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dialer_session_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."dialer_sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text,
  "status" text DEFAULT 'active'::text NOT NULL,
  "source_filter" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "tab_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dialer_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."dialer_sms_followups" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "call_id" uuid NOT NULL,
  "contact_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "twilio_message_sid" text,
  "from_number_e164" text,
  "to_number_e164" text,
  "body" text NOT NULL,
  "status" text DEFAULT 'queued'::text NOT NULL,
  "error_code" text,
  "error_message" text,
  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "status_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dialer_sms_followups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."durham_staging_raw" (
  "x" double precision,
  "y" double precision,
  "objectid" text,
  "region_id" text,
  "civic_num" text,
  "civic_sfx" text,
  "unit" text,
  "unit_range" text,
  "unit_num" text,
  "unit_type" text,
  "road_name" text,
  "road_type" text,
  "type_short" text,
  "road_dir" text,
  "dir_short" text,
  "town" text,
  "municipality" text,
  "postal_code" text,
  "edit_date" text,
  "globalid" text,
  "mxaddresscode" text,
  "mxorgid" text,
  "mxcreationstate" text
);

CREATE TABLE public."editor_project" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "userId" uuid NOT NULL,
  "json" text NOT NULL,
  "height" integer NOT NULL,
  "width" integer NOT NULL,
  "thumbnailUrl" text,
  "isTemplate" boolean DEFAULT false,
  "isPro" boolean DEFAULT false,
  "createdAt" timestamp without time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp without time zone DEFAULT now() NOT NULL,
  CONSTRAINT "editor_project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."entitlements" (
  "user_id" uuid NOT NULL,
  "plan" text DEFAULT 'free'::text NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL,
  "source" text DEFAULT 'none'::text NOT NULL,
  "current_period_end" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  CONSTRAINT "entitlements_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE public."experiments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "landing_page_id" uuid NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."farm_addresses" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "farm_id" uuid NOT NULL,
  "gers_id" text,
  "formatted" text NOT NULL,
  "house_number" text,
  "street_name" text,
  "locality" text,
  "region" text,
  "postal_code" text,
  "source" text DEFAULT 'map'::text NOT NULL,
  "latitude" double precision,
  "longitude" double precision,
  "geom" jsonb,
  "visited_count" integer DEFAULT 0 NOT NULL,
  "last_visited_at" timestamp with time zone,
  "last_touch_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "campaign_address_id" uuid,
  "last_outcome_status" text,
  CONSTRAINT "farm_addresses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."farm_leads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "farm_id" uuid NOT NULL,
  "touch_id" uuid,
  "lead_source" text NOT NULL,
  "name" text,
  "phone" text,
  "email" text,
  "address" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "farm_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."farm_meta_ad_daily_metrics" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "farm_id" uuid NOT NULL,
  "farm_meta_campaign_link_id" uuid,
  "meta_campaign_id" text NOT NULL,
  "date" date NOT NULL,
  "spend" numeric DEFAULT 0,
  "impressions" integer DEFAULT 0,
  "reach" integer DEFAULT 0,
  "clicks" integer DEFAULT 0,
  "leads" integer DEFAULT 0,
  "actions" jsonb,
  "raw_payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "farm_meta_ad_daily_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."farm_meta_campaign_links" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "farm_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "team_id" uuid,
  "meta_connection_id" uuid,
  "meta_ad_account_id" text NOT NULL,
  "meta_campaign_id" text NOT NULL,
  "meta_campaign_name" text,
  "status" text DEFAULT 'active'::text,
  "linked_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "last_synced_at" timestamp with time zone,
  CONSTRAINT "farm_meta_campaign_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."farm_touch_addresses" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "farm_id" uuid NOT NULL,
  "farm_touch_id" uuid NOT NULL,
  "farm_address_id" uuid NOT NULL,
  "campaign_address_id" uuid,
  "status" text DEFAULT 'delivered'::text NOT NULL,
  "notes" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid DEFAULT auth.uid(),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "farm_touch_addresses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."farm_touches" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "farm_id" uuid NOT NULL,
  "date" date NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "notes" text,
  "order_index" integer,
  "completed" boolean DEFAULT false,
  "campaign_id" uuid,
  "batch_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "workspace_id" uuid,
  "mode" text DEFAULT 'doorknock'::text NOT NULL,
  "started_at" timestamp with time zone,
  "completed_date" timestamp with time zone,
  "last_completed_at" timestamp with time zone,
  "homes_target" integer,
  "homes_reached" integer,
  "updated_at" timestamp with time zone DEFAULT now(),
  "session_id" uuid,
  "completed_at" timestamp with time zone,
  "completed_by_user_id" uuid,
  "execution_metrics" jsonb DEFAULT '{}'::jsonb,
  "scheduled_date" timestamp with time zone DEFAULT now(),
  "status" text DEFAULT 'scheduled'::text,
  "cycle_number" integer DEFAULT 1,
  CONSTRAINT "farm_touches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."farms" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "owner_id" uuid NOT NULL,
  "name" text NOT NULL,
  "area_label" text,
  "frequency_days" integer DEFAULT 30,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "polygon" geometry,
  "start_date" date,
  "end_date" date,
  "frequency" integer DEFAULT 2,
  "workspace_id" uuid,
  "description" text,
  "home_limit" integer DEFAULT 5000,
  "address_count" integer DEFAULT 0,
  "last_generated_at" timestamp with time zone,
  "linked_campaign_id" uuid,
  "touches_per_interval" integer DEFAULT 2,
  "touches_interval" text DEFAULT 'month'::text,
  "touch_types" text[] DEFAULT ARRAY[]::text[],
  "annual_budget_cents" integer,
  "is_active" boolean DEFAULT true,
  "goal_type" text,
  "goal_target" integer,
  "cycle_completion_window_days" integer,
  "include_social_ads_in_spend" boolean DEFAULT false NOT NULL,
  CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."farms_with_geojson" (
  "id" uuid,
  "owner_id" uuid,
  "workspace_id" uuid,
  "name" text,
  "description" text,
  "polygon" text,
  "start_date" date,
  "end_date" date,
  "frequency" integer,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "area_label" text,
  "is_active" boolean,
  "touches_per_interval" integer,
  "touches_interval" text,
  "goal_type" text,
  "goal_target" integer,
  "cycle_completion_window_days" integer,
  "touch_types" text[],
  "annual_budget_cents" integer,
  "home_limit" integer,
  "address_count" integer,
  "last_generated_at" timestamp with time zone
);

CREATE TABLE public."feedback_items" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "type" text NOT NULL,
  "title" text,
  "body" text NOT NULL,
  "context" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feedback_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."feedback_threads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "status" text DEFAULT 'open'::text NOT NULL,
  "last_feedback_at" timestamp with time zone DEFAULT now() NOT NULL,
  "unread_for_founder" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feedback_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."field_leads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "address" text NOT NULL,
  "name" text,
  "phone" text,
  "status" text DEFAULT 'not_home'::text NOT NULL,
  "notes" text,
  "qr_code" text,
  "campaign_id" uuid,
  "session_id" uuid,
  "external_crm_id" text,
  "last_synced_at" timestamp with time zone,
  "sync_status" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "email" text,
  "workspace_id" uuid,
  CONSTRAINT "field_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."field_sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "campaign_id" uuid,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "duration_seconds" integer,
  "route" geometry,
  "stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "field_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."finance_entries" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid,
  "created_by" uuid NOT NULL,
  "campaign_id" uuid,
  "farm_id" uuid,
  "agent_user_id" uuid,
  "category" text NOT NULL,
  "description" text DEFAULT ''::text NOT NULL,
  "vendor" text,
  "postal_code" text,
  "quantity" integer DEFAULT 1 NOT NULL,
  "unit_label" text DEFAULT 'item'::text NOT NULL,
  "unit_cost_cents" integer DEFAULT 0 NOT NULL,
  "total_cost_cents" integer DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'CAD'::text NOT NULL,
  "incurred_on" date DEFAULT CURRENT_DATE NOT NULL,
  "notes" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "finance_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."flyers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid NOT NULL,
  "name" text DEFAULT 'New Flyer'::text NOT NULL,
  "size" text DEFAULT 'LETTER_8_5x11'::text NOT NULL,
  "data" jsonb DEFAULT '{"elements": [], "backgroundColor": "#ffffff"}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "flyers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."global_address_cache" (
  "gers_id" text NOT NULL,
  "house_number" text,
  "street_name" text,
  "postal_code" text,
  "formatted_address" text,
  "centroid" geometry,
  "source" text DEFAULT 'mapbox'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "global_address_cache_pkey" PRIMARY KEY ("gers_id")
);

CREATE TABLE public."gold_data_sync_log" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "source_id" text NOT NULL,
  "source_type" text NOT NULL,
  "s3_bucket" text NOT NULL,
  "s3_key" text NOT NULL,
  "records_fetched" integer DEFAULT 0,
  "records_filtered" integer DEFAULT 0,
  "records_inserted" integer DEFAULT 0,
  "records_deleted" integer DEFAULT 0,
  "sync_started_at" timestamp with time zone DEFAULT now(),
  "sync_completed_at" timestamp with time zone,
  "sync_duration_ms" integer,
  "sync_status" text DEFAULT 'running'::text,
  "error_message" text,
  "arcgis_url" text,
  "metadata" jsonb,
  CONSTRAINT "gold_data_sync_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."landing_page_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "landing_page_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "device" text,
  "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "landing_page_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."landing_page_templates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "preview_image_url" text,
  "components" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "landing_page_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."landing_pages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "type" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "campaign_id" uuid,
  "address_id" uuid,
  "template_id" uuid,
  "title" text,
  "subtitle" text,
  "description" text,
  "cta_text" text,
  "cta_url" text,
  "image_url" text,
  "video_url" text,
  "dynamic_data" jsonb DEFAULT '{}'::jsonb,
  "slug" text,
  CONSTRAINT "landing_pages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."leaderboard" (
  "id" uuid,
  "user_id" uuid,
  "user_email" character varying,
  "flyers" integer,
  "conversations" integer,
  "leads" integer,
  "distance" double precision,
  "time_minutes" integer,
  "day_streak" integer,
  "best_streak" integer,
  "updated_at" timestamp with time zone,
  "created_at" timestamp with time zone,
  "rank_by_flyers" bigint,
  "rank_by_conversations" bigint,
  "rank_by_leads" bigint,
  "rank_by_distance" bigint,
  "rank_by_time" bigint
);

CREATE TABLE public."leaderboard_rollups" (
  "scope_key" text NOT NULL,
  "workspace_id" uuid,
  "user_id" uuid NOT NULL,
  "timeframe" text NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "doorknocks" integer DEFAULT 0 NOT NULL,
  "conversations" integer DEFAULT 0 NOT NULL,
  "leads" integer DEFAULT 0 NOT NULL,
  "distance_km" double precision DEFAULT 0.0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "leaderboard_rollups_pkey" PRIMARY KEY ("scope_key", "user_id", "timeframe", "period_start")
);

CREATE TABLE public."live_session_codes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "workspace_id" uuid,
  "created_by" uuid NOT NULL,
  "code_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "live_session_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."map_buildings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "source" text DEFAULT 'overture'::text NOT NULL,
  "gers_id" text,
  "geom" geometry NOT NULL,
  "centroid" geometry,
  "height_m" numeric DEFAULT 6,
  "levels" integer DEFAULT 2,
  "is_townhome_row" boolean DEFAULT false,
  "units_count" integer DEFAULT 0,
  "divider_lines" geometry,
  "unit_points" geometry,
  "address_id" uuid,
  "campaign_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "gers_id_uuid" uuid,
  "house_number" text,
  "street_name" text,
  "house_name" text,
  CONSTRAINT "map_buildings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."meta_ad_accounts" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "team_id" uuid,
  "meta_connection_id" uuid,
  "meta_ad_account_id" text NOT NULL,
  "name" text,
  "currency" text,
  "account_status" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "meta_ad_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."meta_connections" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "team_id" uuid,
  "meta_user_id" text,
  "access_token_encrypted" text NOT NULL,
  "token_expires_at" timestamp with time zone,
  "scopes" text[],
  "connected_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "meta_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."meta_sync_logs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "farm_id" uuid,
  "farm_meta_campaign_link_id" uuid,
  "meta_campaign_id" text,
  "user_id" uuid,
  "team_id" uuid,
  "status" text NOT NULL,
  "message" text,
  "error_code" text,
  "synced_from" date,
  "synced_to" date,
  "rows_synced" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "meta_sync_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."notifications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "data" jsonb,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."overture_transportation" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "gers_id" text,
  "geom" geometry NOT NULL,
  "class" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "subclass" text,
  CONSTRAINT "overture_transportation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."partner_offers" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "token" text NOT NULL,
  "recipient_name" text,
  "recipient_email" text,
  "partner_name" text NOT NULL,
  "offer_title" text NOT NULL,
  "offer_message" text,
  "cta_label" text,
  "cta_url" text,
  "max_views" integer,
  "view_count" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_viewed_at" timestamp with time zone,
  "created_by" uuid,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "email_sent" boolean DEFAULT false NOT NULL,
  "email_sent_at" timestamp with time zone,
  "email_recipient" text,
  "resend_message_id" text,
  "email_status" text DEFAULT 'not_requested'::text NOT NULL,
  "is_draft" boolean DEFAULT false NOT NULL,
  "vanity_slug" text,
  CONSTRAINT "partner_offers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."profiles" (
  "id" uuid NOT NULL,
  "email" text,
  "full_name" text,
  "avatar_url" text,
  "phone_number" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "first_name" text,
  "last_name" text,
  "nickname" text,
  "quote" text,
  "profile_image_url" text,
  "is_support" boolean DEFAULT false NOT NULL,
  "country_code" text,
  CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."project" (
  "id" text NOT NULL,
  "name" text NOT NULL,
  "userId" text NOT NULL,
  "json" text NOT NULL,
  "height" integer NOT NULL,
  "width" integer NOT NULL,
  "thumbnailUrl" text,
  "isTemplate" boolean,
  "isPro" boolean,
  "createdAt" timestamp without time zone NOT NULL,
  "updatedAt" timestamp without time zone NOT NULL,
  CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."qr_code_scans" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "qr_code_id" uuid,
  "address_id" uuid,
  "scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "device_info" text,
  "user_agent" text,
  "ip_address" inet,
  "referrer" text,
  CONSTRAINT "qr_code_scans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."qr_codes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" uuid,
  "farm_id" uuid,
  "qr_url" text NOT NULL,
  "qr_image" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "address_id" uuid,
  "landing_page_id" uuid,
  "qr_variant" text,
  "slug" text,
  "destination_type" text,
  "direct_url" text,
  CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."qr_scan_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "experiment_id" uuid,
  "variant_id" uuid,
  "campaign_id" uuid,
  "landing_page_id" uuid,
  "device_type" text,
  "city" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "qr_scan_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."qr_sets" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "total_addresses" integer DEFAULT 0,
  "variant_count" integer DEFAULT 0,
  "qr_code_ids" uuid[] DEFAULT '{}'::uuid[],
  "campaign_id" uuid,
  "user_id" uuid NOT NULL,
  CONSTRAINT "qr_sets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."ref_addresses_gold" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "source_id" text NOT NULL,
  "source_file" text,
  "source_url" text,
  "source_date" date,
  "street_number" text NOT NULL,
  "street_name" text NOT NULL,
  "unit" text,
  "city" text NOT NULL,
  "zip" text,
  "province" text DEFAULT 'ON'::text,
  "country" text DEFAULT 'CA'::text,
  "geom" geometry NOT NULL,
  "address_type" text,
  "precision" text DEFAULT 'rooftop'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "street_number_normalized" integer,
  "street_name_normalized" text,
  "zip_normalized" text,
  CONSTRAINT "ref_addresses_gold_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."ref_buildings_gold" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "source_id" text NOT NULL,
  "source_file" text,
  "source_url" text,
  "source_date" date,
  "external_id" text,
  "parcel_id" text,
  "geom" geometry NOT NULL,
  "centroid" geometry,
  "area_sqm" double precision,
  "height_m" double precision,
  "floors" integer,
  "year_built" integer,
  "building_type" text,
  "subtype" text,
  "primary_address" text,
  "primary_street_number" text,
  "primary_street_name" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "ref_buildings_gold_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."report_runs" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "period" text NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "ran_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."reports" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "scope" text NOT NULL,
  "owner_user_id" uuid,
  "subject_user_id" uuid,
  "owner_user_key" uuid,
  "subject_user_key" uuid,
  "period" text NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "metrics" jsonb NOT NULL,
  "deltas" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."route_assignments" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "route_plan_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "assigned_to_user_id" uuid NOT NULL,
  "assigned_by_user_id" uuid NOT NULL,
  "status" text DEFAULT 'assigned'::text NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "priority" text DEFAULT 'normal'::text NOT NULL,
  "due_at" timestamp with time zone,
  "notes" text,
  "accepted_at" timestamp with time zone,
  "declined_at" timestamp with time zone,
  "decline_reason" text,
  CONSTRAINT "route_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."route_map_snapshots" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "assignment_id" uuid,
  "route_plan_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "snapshot_kind" text DEFAULT 'assignment'::text NOT NULL,
  "status" text DEFAULT 'ready'::text NOT NULL,
  "campaign_version" text NOT NULL,
  "route_version" integer DEFAULT 1 NOT NULL,
  "stops_geojson" jsonb DEFAULT '{"type": "FeatureCollection", "features": []}'::jsonb NOT NULL,
  "buildings_geojson" jsonb DEFAULT '{"type": "FeatureCollection", "features": []}'::jsonb NOT NULL,
  "addresses_geojson" jsonb DEFAULT '{"type": "FeatureCollection", "features": []}'::jsonb NOT NULL,
  "roads_geojson" jsonb,
  "bbox" jsonb,
  "feature_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "route_map_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."route_plans" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "campaign_id" uuid,
  "created_by_user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft'::text NOT NULL,
  "total_stops" integer DEFAULT 0 NOT NULL,
  "est_minutes" integer,
  "distance_meters" integer,
  "segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "route_version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "route_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."route_stops" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "route_plan_id" uuid NOT NULL,
  "stop_order" integer NOT NULL,
  "address_id" uuid,
  "gers_id" text,
  "lat" double precision,
  "lng" double precision,
  "display_address" text,
  "building_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."safety_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "share_id" uuid,
  "created_by" uuid NOT NULL,
  "event_type" text NOT NULL,
  "lat" double precision,
  "lon" double precision,
  "message" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "acknowledged_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "safety_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."scan_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "building_id" uuid,
  "campaign_id" uuid,
  "scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
  "qr_id" text,
  "qr_code_id" uuid,
  "address_id" uuid,
  CONSTRAINT "scan_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."session" (
  "sessionToken" text NOT NULL,
  "userId" text NOT NULL,
  "expires" timestamp without time zone NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sessionToken")
);

CREATE TABLE public."session_analytics" (
  "id" uuid,
  "user_id" uuid,
  "start_time" timestamp with time zone,
  "end_time" timestamp with time zone,
  "distance_meters" double precision,
  "goal_type" text,
  "goal_amount" integer,
  "path_geojson" text,
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "campaign_id" uuid,
  "doors_hit" integer,
  "conversations" integer,
  "summary_png_url" text,
  "route_data" jsonb,
  "flyers_delivered" integer,
  "is_paused" boolean,
  "active_seconds" integer,
  "target_building_ids" text[],
  "completed_count" integer,
  "auto_complete_enabled" boolean,
  "auto_complete_threshold_m" double precision,
  "auto_complete_dwell_seconds" integer,
  "notes" text,
  "target_count" integer,
  "workspace_id" uuid,
  "leads_created" integer,
  "doors_per_hour" double precision,
  "conversations_per_hour" double precision,
  "completions_per_km" double precision,
  "conversations_per_door" double precision,
  "leads_per_conversation" double precision,
  "appointments_count" integer,
  "appointments_per_conversation" double precision
);

CREATE TABLE public."session_checkins" (
  "session_id" uuid NOT NULL,
  "share_id" uuid,
  "created_by" uuid NOT NULL,
  "interval_minutes" integer NOT NULL,
  "grace_period_minutes" integer DEFAULT 5 NOT NULL,
  "status" text DEFAULT 'active'::text NOT NULL,
  "next_prompt_at" timestamp with time zone,
  "last_prompted_at" timestamp with time zone,
  "last_confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "session_checkins_pkey" PRIMARY KEY ("session_id")
);

CREATE TABLE public."session_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "address_id" uuid NOT NULL,
  "event_type" text DEFAULT 'address_tap'::text NOT NULL,
  "conversation_type" text,
  "notes" text,
  "outcome" text,
  "left_flyer" boolean DEFAULT false NOT NULL,
  "timestamp" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "building_id" uuid,
  "user_id" uuid,
  "lat" double precision,
  "lon" double precision,
  "event_location" geography,
  "metadata" jsonb,
  CONSTRAINT "session_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."session_heartbeats" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "share_id" uuid,
  "lat" double precision NOT NULL,
  "lon" double precision NOT NULL,
  "battery_level" double precision,
  "movement_state" text DEFAULT 'unknown'::text NOT NULL,
  "device_status" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "session_heartbeats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."session_participants" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text DEFAULT 'member'::text NOT NULL,
  "joined_via_invite_id" uuid,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "left_at" timestamp with time zone,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "session_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."session_shares" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "created_by" uuid NOT NULL,
  "share_token_hash" text NOT NULL,
  "viewer_label" text,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "last_viewed_at" timestamp with time zone,
  "check_in_interval_minutes" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "session_shares_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "start_time" timestamp with time zone NOT NULL,
  "end_time" timestamp with time zone,
  "distance_meters" double precision DEFAULT 0.0 NOT NULL,
  "goal_type" text NOT NULL,
  "goal_amount" integer DEFAULT 0 NOT NULL,
  "path_geojson" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "campaign_id" uuid,
  "doors_hit" integer DEFAULT 0 NOT NULL,
  "conversations" integer DEFAULT 0 NOT NULL,
  "summary_png_url" text,
  "route_data" jsonb,
  "flyers_delivered" integer DEFAULT 0 NOT NULL,
  "is_paused" boolean DEFAULT false NOT NULL,
  "active_seconds" integer DEFAULT 0 NOT NULL,
  "target_building_ids" text[],
  "completed_count" integer DEFAULT 0 NOT NULL,
  "auto_complete_enabled" boolean DEFAULT false NOT NULL,
  "auto_complete_threshold_m" double precision DEFAULT 15.0 NOT NULL,
  "auto_complete_dwell_seconds" integer DEFAULT 8 NOT NULL,
  "notes" text,
  "target_count" integer,
  "workspace_id" uuid,
  "leads_created" integer DEFAULT 0 NOT NULL,
  "path_geojson_normalized" text,
  "route_assignment_id" uuid,
  "farm_id" uuid,
  "farm_touch_id" uuid,
  "session_mode" text DEFAULT 'door_knocking'::text NOT NULL,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."staging_addresses" (
  "source_id" text,
  "source_file" text,
  "source_url" text,
  "source_date" text,
  "street_number" text,
  "street_name" text,
  "unit" text,
  "city" text,
  "zip" text,
  "province" text,
  "country" text,
  "geom" text,
  "address_type" text,
  "precision" text
);

CREATE TABLE public."subscription" (
  "id" text NOT NULL,
  "userId" text NOT NULL,
  "subscriptionId" text NOT NULL,
  "customerId" text NOT NULL,
  "priceId" text NOT NULL,
  "status" text NOT NULL,
  "currentPeriodEnd" timestamp without time zone,
  "createdAt" timestamp without time zone NOT NULL,
  "updatedAt" timestamp without time zone NOT NULL,
  CONSTRAINT "subscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."support_messages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL,
  "sender_type" text NOT NULL,
  "sender_user_id" uuid,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."support_threads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "status" text DEFAULT 'open'::text NOT NULL,
  "last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_sender_type" text,
  "last_message_id" uuid,
  "last_message_preview" text,
  "needs_reply" boolean DEFAULT false NOT NULL,
  "unread_for_support" boolean DEFAULT false NOT NULL,
  "unread_for_user" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "support_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."user" (
  "id" text NOT NULL,
  "name" text,
  "email" text NOT NULL,
  "emailVerified" timestamp without time zone,
  "image" text,
  "password" text,
  CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."user_integrations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "access_token" text,
  "refresh_token" text,
  "api_key" text,
  "webhook_url" text,
  "expires_at" bigint,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "account_id" text,
  "account_name" text,
  "selected_board_id" text,
  "selected_board_name" text,
  "provider_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "user_integrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."user_profiles" (
  "user_id" uuid NOT NULL,
  "pro_active" boolean DEFAULT false,
  "stripe_customer_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "weekly_door_goal" integer DEFAULT 100,
  "weekly_sessions_goal" integer,
  "weekly_minutes_goal" integer,
  "first_name" text,
  "last_name" text,
  "is_founder" boolean DEFAULT false NOT NULL,
  "industry" text,
  "brokerage_name" text,
  "quote" text,
  "avatar_url" text,
  "current_workspace_id" uuid,
  "country_code" text,
  CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE public."user_settings" (
  "user_id" uuid NOT NULL,
  "exclude_weekends" boolean DEFAULT false NOT NULL,
  "dark_mode" boolean DEFAULT true NOT NULL,
  "follow_up_boss_key" text,
  "member_since" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "brand_color" text,
  "logo_url" text,
  "realtor_profile_card" jsonb,
  "default_cta_color" text,
  "font_style" text,
  "default_template_id" uuid,
  CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE public."user_stats" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "day_streak" integer DEFAULT 0 NOT NULL,
  "best_streak" integer DEFAULT 0 NOT NULL,
  "doors_knocked" integer DEFAULT 0 NOT NULL,
  "flyers" integer DEFAULT 0 NOT NULL,
  "conversations" integer DEFAULT 0 NOT NULL,
  "leads_created" integer DEFAULT 0 NOT NULL,
  "qr_codes_scanned" integer DEFAULT 0 NOT NULL,
  "distance_walked" double precision DEFAULT 0.0 NOT NULL,
  "conversation_per_door" double precision DEFAULT 0.0 NOT NULL,
  "conversation_lead_rate" double precision DEFAULT 0.0 NOT NULL,
  "qr_code_scan_rate" double precision DEFAULT 0.0 NOT NULL,
  "qr_code_lead_rate" double precision DEFAULT 0.0 NOT NULL,
  "streak_days" jsonb DEFAULT '[]'::jsonb,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "time_tracked" integer DEFAULT 0 NOT NULL,
  "xp" integer DEFAULT 0 NOT NULL,
  "appointments" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "user_stats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."v_campaign_addresses" (
  "id" uuid,
  "campaign_id" uuid,
  "formatted" text,
  "postal_code" text,
  "source" text,
  "seq" integer,
  "visited" boolean,
  "geom" jsonb,
  "created_at" timestamp with time zone
);

CREATE TABLE public."v_gold_data_stats" (
  "data_type" text,
  "source_id" text,
  "record_count" bigint,
  "cities" bigint,
  "zip_codes" bigint,
  "bbox" box2d,
  "latest_source_date" date,
  "last_sync_date" timestamp with time zone
);

CREATE TABLE public."verificationToken" (
  "identifier" text NOT NULL,
  "token" text NOT NULL,
  "expires" timestamp without time zone NOT NULL,
  CONSTRAINT "verificationToken_pkey" PRIMARY KEY ("identifier", "token")
);

CREATE TABLE public."workspace_billing_addons" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "addon_key" text NOT NULL,
  "status" text DEFAULT 'inactive'::text NOT NULL,
  "stripe_subscription_id" text,
  "stripe_subscription_item_id" text,
  "stripe_price_id" text,
  "quantity" integer DEFAULT 1 NOT NULL,
  "amount_cents" integer,
  "currency" text,
  "activated_at" timestamp with time zone,
  "canceled_at" timestamp with time zone,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_billing_addons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."workspace_dialer_settings" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "default_from_number" text,
  "default_sms_from_number" text,
  "allow_sms_followup" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "inbound_forward_to" text,
  "twilio_incoming_phone_number_sid" text,
  "number_status" text DEFAULT 'unassigned'::text NOT NULL,
  "number_assigned_at" timestamp with time zone,
  "provisioning_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "workspace_dialer_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."workspace_invites" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "email" text NOT NULL,
  "role" text DEFAULT 'member'::text NOT NULL,
  "token" text NOT NULL,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "invited_by" uuid,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "campaign_id" uuid,
  "created_by" uuid,
  "accepted_by" uuid,
  "invite_token" text,
  "session_id" uuid,
  CONSTRAINT "workspace_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."workspace_members" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text DEFAULT 'member'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "color" text,
  CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE public."workspaces" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "owner_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "industry" text,
  "subscription_status" text DEFAULT 'inactive'::text NOT NULL,
  "trial_ends_at" timestamp with time zone,
  "max_seats" integer DEFAULT 1 NOT NULL,
  "onboarding_completed_at" timestamp with time zone,
  "referral_code_used" text,
  "brokerage_id" uuid,
  "brokerage_name" text,
  "timezone" text DEFAULT 'UTC'::text NOT NULL,
  "weekly_door_goal" integer,
  "weekly_sessions_goal" integer,
  "weekly_minutes_goal" integer,
  "weekly_door_goal_per_member" boolean DEFAULT false NOT NULL,
  CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

ALTER TABLE public."account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user" ("id");
ALTER TABLE public."activity_events" ADD CONSTRAINT "activity_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."address_content" ADD CONSTRAINT "address_content_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."address_orphans" ADD CONSTRAINT "address_orphans_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."address_orphans" ADD CONSTRAINT "address_orphans_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."address_statuses" ADD CONSTRAINT "address_statuses_address_id_fkey" FOREIGN KEY ("campaign_address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."address_statuses" ADD CONSTRAINT "address_statuses_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."address_statuses" ADD CONSTRAINT "address_statuses_last_home_event_id_fkey" FOREIGN KEY ("last_home_event_id") REFERENCES public."campaign_home_events" ("id");
ALTER TABLE public."address_statuses" ADD CONSTRAINT "address_statuses_last_session_id_fkey" FOREIGN KEY ("last_session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."ambassador_commissions" ADD CONSTRAINT "ambassador_commissions_ambassador_application_id_fkey" FOREIGN KEY ("ambassador_application_id") REFERENCES public."ambassador_applications" ("id");
ALTER TABLE public."ambassador_commissions" ADD CONSTRAINT "ambassador_commissions_ambassador_referral_id_fkey" FOREIGN KEY ("ambassador_referral_id") REFERENCES public."ambassador_referrals" ("id");
ALTER TABLE public."ambassador_commissions" ADD CONSTRAINT "ambassador_commissions_payout_batch_id_fkey" FOREIGN KEY ("payout_batch_id") REFERENCES public."ambassador_payout_batches" ("id");
ALTER TABLE public."ambassador_commissions" ADD CONSTRAINT "ambassador_commissions_referred_workspace_id_fkey" FOREIGN KEY ("referred_workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."ambassador_payout_batch_items" ADD CONSTRAINT "ambassador_payout_batch_items_ambassador_commission_id_fkey" FOREIGN KEY ("ambassador_commission_id") REFERENCES public."ambassador_commissions" ("id");
ALTER TABLE public."ambassador_payout_batch_items" ADD CONSTRAINT "ambassador_payout_batch_items_payout_batch_id_fkey" FOREIGN KEY ("payout_batch_id") REFERENCES public."ambassador_payout_batches" ("id");
ALTER TABLE public."ambassador_payout_batches" ADD CONSTRAINT "ambassador_payout_batches_ambassador_application_id_fkey" FOREIGN KEY ("ambassador_application_id") REFERENCES public."ambassador_applications" ("id");
ALTER TABLE public."ambassador_referrals" ADD CONSTRAINT "ambassador_referrals_ambassador_application_id_fkey" FOREIGN KEY ("ambassador_application_id") REFERENCES public."ambassador_applications" ("id");
ALTER TABLE public."ambassador_referrals" ADD CONSTRAINT "ambassador_referrals_referred_workspace_id_fkey" FOREIGN KEY ("referred_workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."authenticator" ADD CONSTRAINT "authenticator_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user" ("id");
ALTER TABLE public."batches" ADD CONSTRAINT "batches_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES public."landing_pages" ("id");
ALTER TABLE public."building_address_links" ADD CONSTRAINT "building_address_links_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."building_address_links" ADD CONSTRAINT "building_address_links_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."building_slices" ADD CONSTRAINT "building_slices_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."building_slices" ADD CONSTRAINT "building_slices_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES public."buildings" ("id");
ALTER TABLE public."building_slices" ADD CONSTRAINT "building_slices_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."building_split_errors" ADD CONSTRAINT "building_split_errors_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."building_stats" ADD CONSTRAINT "building_stats_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."building_touches" ADD CONSTRAINT "building_touches_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."building_touches" ADD CONSTRAINT "building_touches_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."building_touches" ADD CONSTRAINT "building_touches_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."building_units" ADD CONSTRAINT "building_units_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."building_units" ADD CONSTRAINT "building_units_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."buildings" ADD CONSTRAINT "buildings_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."buildings" ADD CONSTRAINT "buildings_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."buildings" ADD CONSTRAINT "buildings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."campaign_addresses" ADD CONSTRAINT "campaign_addresses_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_assignment_homes" ADD CONSTRAINT "campaign_assignment_homes_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES public."campaign_assignments" ("id");
ALTER TABLE public."campaign_assignment_homes" ADD CONSTRAINT "campaign_assignment_homes_campaign_address_id_fkey" FOREIGN KEY ("campaign_address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."campaign_assignments" ADD CONSTRAINT "campaign_assignments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_assignments" ADD CONSTRAINT "campaign_assignments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."campaign_hidden_buildings" ADD CONSTRAINT "campaign_hidden_buildings_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_home_events" ADD CONSTRAINT "campaign_home_events_campaign_address_id_fkey" FOREIGN KEY ("campaign_address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."campaign_home_events" ADD CONSTRAINT "campaign_home_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_home_events" ADD CONSTRAINT "campaign_home_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."campaign_landing_page_analytics" ADD CONSTRAINT "campaign_landing_page_analytics_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES public."campaign_landing_pages" ("id");
ALTER TABLE public."campaign_landing_pages" ADD CONSTRAINT "campaign_landing_pages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_members" ADD CONSTRAINT "campaign_members_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_parcels" ADD CONSTRAINT "campaign_parcels_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_polished_building_features" ADD CONSTRAINT "campaign_polished_building_features_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_presence" ADD CONSTRAINT "campaign_presence_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_presence" ADD CONSTRAINT "campaign_presence_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."campaign_qr_batches" ADD CONSTRAINT "campaign_qr_batches_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_road_metadata" ADD CONSTRAINT "campaign_road_metadata_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_roads" ADD CONSTRAINT "campaign_roads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_routes" ADD CONSTRAINT "campaign_routes_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaign_snapshots" ADD CONSTRAINT "campaign_snapshots_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."campaigns" ADD CONSTRAINT "campaigns_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."challenge_participants" ADD CONSTRAINT "challenge_participants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES public."challenges" ("id");
ALTER TABLE public."challenge_templates" ADD CONSTRAINT "challenge_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."contact_activities" ADD CONSTRAINT "contact_activities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES public."contacts" ("id");
ALTER TABLE public."contacts" ADD CONSTRAINT "contacts_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."contacts" ADD CONSTRAINT "contacts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."contacts" ADD CONSTRAINT "contacts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."contacts" ADD CONSTRAINT "contacts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."conversions" ADD CONSTRAINT "conversions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."conversions" ADD CONSTRAINT "conversions_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES public."experiments" ("id");
ALTER TABLE public."conversions" ADD CONSTRAINT "conversions_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES public."landing_pages" ("id");
ALTER TABLE public."crm_connection_secrets" ADD CONSTRAINT "crm_connection_secrets_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES public."crm_connections" ("id");
ALTER TABLE public."crm_connections" ADD CONSTRAINT "crm_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."dialer_calls" ADD CONSTRAINT "dialer_calls_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES public."contacts" ("id");
ALTER TABLE public."dialer_calls" ADD CONSTRAINT "dialer_calls_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."dialer_sessions" ("id");
ALTER TABLE public."dialer_calls" ADD CONSTRAINT "dialer_calls_session_lead_id_fkey" FOREIGN KEY ("session_lead_id") REFERENCES public."dialer_session_leads" ("id");
ALTER TABLE public."dialer_calls" ADD CONSTRAINT "dialer_calls_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."dialer_session_leads" ADD CONSTRAINT "dialer_session_leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES public."contacts" ("id");
ALTER TABLE public."dialer_session_leads" ADD CONSTRAINT "dialer_session_leads_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."dialer_sessions" ("id");
ALTER TABLE public."dialer_session_leads" ADD CONSTRAINT "dialer_session_leads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."dialer_sessions" ADD CONSTRAINT "dialer_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."dialer_sms_followups" ADD CONSTRAINT "dialer_sms_followups_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES public."dialer_calls" ("id");
ALTER TABLE public."dialer_sms_followups" ADD CONSTRAINT "dialer_sms_followups_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES public."contacts" ("id");
ALTER TABLE public."dialer_sms_followups" ADD CONSTRAINT "dialer_sms_followups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."experiments" ADD CONSTRAINT "experiments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."experiments" ADD CONSTRAINT "experiments_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES public."landing_pages" ("id");
ALTER TABLE public."farm_addresses" ADD CONSTRAINT "farm_addresses_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES public."farms" ("id");
ALTER TABLE public."farm_addresses" ADD CONSTRAINT "farm_addresses_last_touch_id_fkey" FOREIGN KEY ("last_touch_id") REFERENCES public."farm_touches" ("id");
ALTER TABLE public."farm_leads" ADD CONSTRAINT "farm_leads_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES public."farms" ("id");
ALTER TABLE public."farm_leads" ADD CONSTRAINT "farm_leads_touch_id_fkey" FOREIGN KEY ("touch_id") REFERENCES public."farm_touches" ("id");
ALTER TABLE public."farm_meta_ad_daily_metrics" ADD CONSTRAINT "farm_meta_ad_daily_metrics_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES public."farms" ("id");
ALTER TABLE public."farm_meta_ad_daily_metrics" ADD CONSTRAINT "farm_meta_ad_daily_metrics_farm_meta_campaign_link_id_fkey" FOREIGN KEY ("farm_meta_campaign_link_id") REFERENCES public."farm_meta_campaign_links" ("id");
ALTER TABLE public."farm_meta_campaign_links" ADD CONSTRAINT "farm_meta_campaign_links_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES public."farms" ("id");
ALTER TABLE public."farm_meta_campaign_links" ADD CONSTRAINT "farm_meta_campaign_links_meta_connection_id_fkey" FOREIGN KEY ("meta_connection_id") REFERENCES public."meta_connections" ("id");
ALTER TABLE public."farm_touch_addresses" ADD CONSTRAINT "farm_touch_addresses_farm_address_id_fkey" FOREIGN KEY ("farm_address_id") REFERENCES public."farm_addresses" ("id");
ALTER TABLE public."farm_touch_addresses" ADD CONSTRAINT "farm_touch_addresses_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES public."farms" ("id");
ALTER TABLE public."farm_touch_addresses" ADD CONSTRAINT "farm_touch_addresses_farm_touch_id_fkey" FOREIGN KEY ("farm_touch_id") REFERENCES public."farm_touches" ("id");
ALTER TABLE public."farm_touches" ADD CONSTRAINT "farm_touches_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES public."batches" ("id");
ALTER TABLE public."farm_touches" ADD CONSTRAINT "farm_touches_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."farm_touches" ADD CONSTRAINT "farm_touches_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES public."farms" ("id");
ALTER TABLE public."farm_touches" ADD CONSTRAINT "farm_touches_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."farms" ADD CONSTRAINT "farms_linked_campaign_id_fkey" FOREIGN KEY ("linked_campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."feedback_items" ADD CONSTRAINT "feedback_items_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES public."feedback_threads" ("id");
ALTER TABLE public."field_leads" ADD CONSTRAINT "field_leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."field_leads" ADD CONSTRAINT "field_leads_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."field_leads" ADD CONSTRAINT "field_leads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."field_sessions" ADD CONSTRAINT "field_sessions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."field_sessions" ADD CONSTRAINT "field_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."finance_entries" ADD CONSTRAINT "finance_entries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."finance_entries" ADD CONSTRAINT "finance_entries_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES public."farms" ("id");
ALTER TABLE public."flyers" ADD CONSTRAINT "flyers_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."landing_page_events" ADD CONSTRAINT "landing_page_events_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES public."landing_pages" ("id");
ALTER TABLE public."landing_pages" ADD CONSTRAINT "landing_pages_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."landing_pages" ADD CONSTRAINT "landing_pages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."landing_pages" ADD CONSTRAINT "landing_pages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES public."landing_page_templates" ("id");
ALTER TABLE public."leaderboard_rollups" ADD CONSTRAINT "leaderboard_rollups_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."live_session_codes" ADD CONSTRAINT "live_session_codes_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."live_session_codes" ADD CONSTRAINT "live_session_codes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."live_session_codes" ADD CONSTRAINT "live_session_codes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."map_buildings" ADD CONSTRAINT "map_buildings_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."map_buildings" ADD CONSTRAINT "map_buildings_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."meta_ad_accounts" ADD CONSTRAINT "meta_ad_accounts_meta_connection_id_fkey" FOREIGN KEY ("meta_connection_id") REFERENCES public."meta_connections" ("id");
ALTER TABLE public."meta_sync_logs" ADD CONSTRAINT "meta_sync_logs_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES public."farms" ("id");
ALTER TABLE public."meta_sync_logs" ADD CONSTRAINT "meta_sync_logs_farm_meta_campaign_link_id_fkey" FOREIGN KEY ("farm_meta_campaign_link_id") REFERENCES public."farm_meta_campaign_links" ("id");
ALTER TABLE public."notifications" ADD CONSTRAINT "notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."project" ADD CONSTRAINT "project_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user" ("id");
ALTER TABLE public."qr_code_scans" ADD CONSTRAINT "qr_code_scans_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."qr_code_scans" ADD CONSTRAINT "qr_code_scans_qr_code_id_fkey" FOREIGN KEY ("qr_code_id") REFERENCES public."qr_codes" ("id");
ALTER TABLE public."qr_codes" ADD CONSTRAINT "qr_codes_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."qr_codes" ADD CONSTRAINT "qr_codes_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."qr_codes" ADD CONSTRAINT "qr_codes_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES public."farms" ("id");
ALTER TABLE public."qr_codes" ADD CONSTRAINT "qr_codes_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES public."campaign_landing_pages" ("id");
ALTER TABLE public."qr_scan_events" ADD CONSTRAINT "qr_scan_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."qr_scan_events" ADD CONSTRAINT "qr_scan_events_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES public."experiments" ("id");
ALTER TABLE public."qr_scan_events" ADD CONSTRAINT "qr_scan_events_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES public."landing_pages" ("id");
ALTER TABLE public."qr_sets" ADD CONSTRAINT "qr_sets_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."report_runs" ADD CONSTRAINT "report_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."reports" ADD CONSTRAINT "reports_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."route_assignments" ADD CONSTRAINT "route_assignments_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES public."profiles" ("id");
ALTER TABLE public."route_assignments" ADD CONSTRAINT "route_assignments_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES public."profiles" ("id");
ALTER TABLE public."route_assignments" ADD CONSTRAINT "route_assignments_route_plan_id_fkey" FOREIGN KEY ("route_plan_id") REFERENCES public."route_plans" ("id");
ALTER TABLE public."route_assignments" ADD CONSTRAINT "route_assignments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."route_map_snapshots" ADD CONSTRAINT "route_map_snapshots_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES public."route_assignments" ("id");
ALTER TABLE public."route_map_snapshots" ADD CONSTRAINT "route_map_snapshots_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."route_map_snapshots" ADD CONSTRAINT "route_map_snapshots_route_plan_id_fkey" FOREIGN KEY ("route_plan_id") REFERENCES public."route_plans" ("id");
ALTER TABLE public."route_map_snapshots" ADD CONSTRAINT "route_map_snapshots_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."route_plans" ADD CONSTRAINT "route_plans_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."route_plans" ADD CONSTRAINT "route_plans_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES public."profiles" ("id");
ALTER TABLE public."route_plans" ADD CONSTRAINT "route_plans_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."route_stops" ADD CONSTRAINT "route_stops_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."route_stops" ADD CONSTRAINT "route_stops_route_plan_id_fkey" FOREIGN KEY ("route_plan_id") REFERENCES public."route_plans" ("id");
ALTER TABLE public."safety_events" ADD CONSTRAINT "safety_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."safety_events" ADD CONSTRAINT "safety_events_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES public."session_shares" ("id");
ALTER TABLE public."scan_events" ADD CONSTRAINT "scan_events_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."scan_events" ADD CONSTRAINT "scan_events_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES public."map_buildings" ("id");
ALTER TABLE public."scan_events" ADD CONSTRAINT "scan_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."scan_events" ADD CONSTRAINT "scan_events_qr_code_id_fkey" FOREIGN KEY ("qr_code_id") REFERENCES public."qr_codes" ("id");
ALTER TABLE public."session_checkins" ADD CONSTRAINT "session_checkins_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."session_checkins" ADD CONSTRAINT "session_checkins_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES public."session_shares" ("id");
ALTER TABLE public."session_events" ADD CONSTRAINT "session_events_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES public."campaign_addresses" ("id");
ALTER TABLE public."session_events" ADD CONSTRAINT "session_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."session_heartbeats" ADD CONSTRAINT "session_heartbeats_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."session_heartbeats" ADD CONSTRAINT "session_heartbeats_share_id_fkey" FOREIGN KEY ("share_id") REFERENCES public."session_shares" ("id");
ALTER TABLE public."session_participants" ADD CONSTRAINT "session_participants_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."session_participants" ADD CONSTRAINT "session_participants_joined_via_invite_id_fkey" FOREIGN KEY ("joined_via_invite_id") REFERENCES public."workspace_invites" ("id");
ALTER TABLE public."session_participants" ADD CONSTRAINT "session_participants_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."session_shares" ADD CONSTRAINT "session_shares_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user" ("id");
ALTER TABLE public."sessions" ADD CONSTRAINT "sessions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."sessions" ADD CONSTRAINT "sessions_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES public."farms" ("id");
ALTER TABLE public."sessions" ADD CONSTRAINT "sessions_farm_touch_id_fkey" FOREIGN KEY ("farm_touch_id") REFERENCES public."farm_touches" ("id");
ALTER TABLE public."sessions" ADD CONSTRAINT "sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."subscription" ADD CONSTRAINT "subscription_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user" ("id");
ALTER TABLE public."support_messages" ADD CONSTRAINT "support_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES public."profiles" ("id");
ALTER TABLE public."support_messages" ADD CONSTRAINT "support_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES public."support_threads" ("id");
ALTER TABLE public."support_threads" ADD CONSTRAINT "support_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES public."profiles" ("id");
ALTER TABLE public."user_profiles" ADD CONSTRAINT "user_profiles_current_workspace_id_fkey" FOREIGN KEY ("current_workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."user_settings" ADD CONSTRAINT "user_settings_default_template_id_fkey" FOREIGN KEY ("default_template_id") REFERENCES public."landing_page_templates" ("id");
ALTER TABLE public."workspace_billing_addons" ADD CONSTRAINT "workspace_billing_addons_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."workspace_dialer_settings" ADD CONSTRAINT "workspace_dialer_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."workspace_invites" ADD CONSTRAINT "workspace_invites_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES public."campaigns" ("id");
ALTER TABLE public."workspace_invites" ADD CONSTRAINT "workspace_invites_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES public."sessions" ("id");
ALTER TABLE public."workspace_invites" ADD CONSTRAINT "workspace_invites_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES public."workspaces" ("id");
ALTER TABLE public."workspaces" ADD CONSTRAINT "workspaces_brokerage_id_fkey" FOREIGN KEY ("brokerage_id") REFERENCES public."brokerages" ("id");

CREATE INDEX idx_activity_events_event_time ON public.activity_events USING btree (event_time DESC);
CREATE INDEX idx_activity_events_event_type ON public.activity_events USING btree (workspace_id, event_type);
CREATE INDEX idx_activity_events_user_id ON public.activity_events USING btree (user_id);
CREATE INDEX idx_activity_events_workspace_id ON public.activity_events USING btree (workspace_id);
CREATE INDEX idx_activity_events_workspace_time ON public.activity_events USING btree (workspace_id, event_time DESC);
CREATE INDEX idx_address_content_address_id ON public.address_content USING btree (address_id);
CREATE INDEX idx_address_content_updated_at ON public.address_content USING btree (updated_at DESC);
CREATE UNIQUE INDEX address_orphans_address_id_key ON public.address_orphans USING btree (address_id);
CREATE INDEX idx_orphans_address ON public.address_orphans USING btree (address_id);
CREATE INDEX idx_orphans_campaign ON public.address_orphans USING btree (campaign_id, status);
CREATE INDEX idx_address_statuses_address_id ON public.address_statuses USING btree (campaign_address_id);
CREATE UNIQUE INDEX idx_address_statuses_campaign_address_id_unique ON public.address_statuses USING btree (campaign_address_id);
CREATE INDEX idx_address_statuses_campaign_id ON public.address_statuses USING btree (campaign_id);
CREATE INDEX idx_address_statuses_campaign_status ON public.address_statuses USING btree (campaign_id, status);
CREATE INDEX idx_address_statuses_last_visited ON public.address_statuses USING btree (last_visited_at DESC) WHERE (last_visited_at IS NOT NULL);
CREATE INDEX idx_address_statuses_status ON public.address_statuses USING btree (status);
CREATE UNIQUE INDEX unique_address_campaign_status ON public.address_statuses USING btree (campaign_address_id, campaign_id);
CREATE INDEX ambassador_applications_created_at_idx ON public.ambassador_applications USING btree (created_at DESC);
CREATE INDEX ambassador_applications_email_lower_idx ON public.ambassador_applications USING btree (lower(email));
CREATE UNIQUE INDEX ambassador_applications_referral_code_lower_idx ON public.ambassador_applications USING btree (lower(referral_code)) WHERE (referral_code IS NOT NULL);
CREATE INDEX ambassador_applications_status_idx ON public.ambassador_applications USING btree (status, created_at DESC);
CREATE INDEX ambassador_commissions_ambassador_status_idx ON public.ambassador_commissions USING btree (ambassador_application_id, status, earned_at DESC);
CREATE UNIQUE INDEX ambassador_commissions_invoice_unique_idx ON public.ambassador_commissions USING btree (stripe_invoice_id);
CREATE INDEX ambassador_commissions_payout_batch_idx ON public.ambassador_commissions USING btree (payout_batch_id, earned_at DESC);
CREATE INDEX ambassador_commissions_referral_idx ON public.ambassador_commissions USING btree (ambassador_referral_id, earned_at DESC);
CREATE INDEX ambassador_payout_batch_items_batch_idx ON public.ambassador_payout_batch_items USING btree (payout_batch_id);
CREATE UNIQUE INDEX ambassador_payout_batch_items_commission_unique_idx ON public.ambassador_payout_batch_items USING btree (ambassador_commission_id);
CREATE INDEX ambassador_payout_batches_ambassador_status_idx ON public.ambassador_payout_batches USING btree (ambassador_application_id, status, created_at DESC);
CREATE UNIQUE INDEX ambassador_payout_batches_snapshot_unique_idx ON public.ambassador_payout_batches USING btree (ambassador_application_id, currency, commission_snapshot_hash) WHERE (commission_snapshot_hash IS NOT NULL);
CREATE INDEX ambassador_payout_batches_status_idx ON public.ambassador_payout_batches USING btree (status, created_at DESC);
CREATE INDEX ambassador_referrals_ambassador_idx ON public.ambassador_referrals USING btree (ambassador_application_id, created_at DESC);
CREATE INDEX ambassador_referrals_subscription_idx ON public.ambassador_referrals USING btree (stripe_subscription_id);
CREATE UNIQUE INDEX ambassador_referrals_workspace_unique_idx ON public.ambassador_referrals USING btree (referred_workspace_id);
CREATE INDEX idx_auth_handoff_codes_expires_at ON public.auth_handoff_codes USING btree (expires_at);
CREATE INDEX idx_auth_handoff_codes_user_id ON public.auth_handoff_codes USING btree (user_id);
CREATE INDEX auth_handoffs_expires_at_idx ON public.auth_handoffs USING btree (expires_at);
CREATE INDEX auth_handoffs_user_id_idx ON public.auth_handoffs USING btree (user_id);
CREATE UNIQUE INDEX "authenticator_credentialID_unique" ON public.authenticator USING btree ("credentialID");
CREATE INDEX idx_batches_created_at ON public.batches USING btree (created_at DESC);
CREATE INDEX idx_batches_landing_page_id ON public.batches USING btree (landing_page_id) WHERE (landing_page_id IS NOT NULL);
CREATE INDEX idx_batches_qr_type ON public.batches USING btree (qr_type);
CREATE INDEX idx_batches_user_id ON public.batches USING btree (user_id);
CREATE UNIQUE INDEX brokerages_name_key ON public.brokerages USING btree (name);
CREATE INDEX idx_brokerages_name_lower ON public.brokerages USING btree (lower(name));
CREATE INDEX idx_brokerages_name_trgm ON public.brokerages USING gin (name gin_trgm_ops);
CREATE UNIQUE INDEX building_address_links_campaign_id_address_id_key ON public.building_address_links USING btree (campaign_id, address_id);
CREATE INDEX idx_building_address_links_building_id ON public.building_address_links USING btree (building_id);
CREATE UNIQUE INDEX idx_building_address_links_campaign_address_unique ON public.building_address_links USING btree (campaign_id, address_id);
CREATE INDEX idx_building_address_links_campaign_id ON public.building_address_links USING btree (campaign_id);
CREATE INDEX idx_building_address_links_campaign_linker_version ON public.building_address_links USING btree (campaign_id, linker_version);
CREATE INDEX idx_links_address ON public.building_address_links USING btree (address_id);
CREATE INDEX idx_links_building ON public.building_address_links USING btree (building_id);
CREATE INDEX idx_links_campaign ON public.building_address_links USING btree (campaign_id);
CREATE INDEX idx_links_confidence ON public.building_address_links USING btree (confidence);
CREATE INDEX idx_links_match_type ON public.building_address_links USING btree (match_type);
CREATE INDEX idx_slices_address ON public.building_slices USING btree (address_id);
CREATE INDEX idx_slices_building ON public.building_slices USING btree (building_id);
CREATE INDEX idx_slices_campaign ON public.building_slices USING btree (campaign_id);
CREATE INDEX idx_slices_campaign_building_address ON public.building_slices USING btree (campaign_id, building_id, address_id);
CREATE INDEX idx_slices_geom ON public.building_slices USING gist (geom);
CREATE INDEX idx_split_errors_campaign ON public.building_split_errors USING btree (campaign_id);
CREATE INDEX idx_building_stats_gers_id_lower ON public.building_stats USING btree (lower(gers_id)) WHERE (gers_id IS NOT NULL);
CREATE UNIQUE INDEX idx_building_stats_gers_id_unique ON public.building_stats USING btree (gers_id) WHERE (gers_id IS NOT NULL);
CREATE INDEX idx_building_touches_address_id ON public.building_touches USING btree (address_id);
CREATE INDEX idx_building_touches_campaign_id ON public.building_touches USING btree (campaign_id);
CREATE INDEX idx_building_touches_touched_at ON public.building_touches USING btree (touched_at DESC);
CREATE INDEX idx_building_touches_user_id ON public.building_touches USING btree (user_id);
CREATE INDEX idx_units_campaign ON public.building_units USING btree (campaign_id);
CREATE UNIQUE INDEX buildings_gers_id_key ON public.buildings USING btree (gers_id);
CREATE INDEX idx_buildings_addr_street ON public.buildings USING btree (addr_street) WHERE (addr_street IS NOT NULL);
CREATE INDEX idx_buildings_address_id ON public.buildings USING btree (address_id);
CREATE INDEX idx_buildings_campaign_id ON public.buildings USING btree (campaign_id);
CREATE INDEX idx_buildings_centroid ON public.buildings USING gist (centroid);
CREATE INDEX idx_buildings_geom ON public.buildings USING gist (geom);
CREATE INDEX idx_buildings_gers_id ON public.buildings USING btree (gers_id);
CREATE INDEX idx_buildings_gers_id_uuid ON public.buildings USING btree (gers_id_uuid) WHERE (gers_id_uuid IS NOT NULL);
CREATE UNIQUE INDEX idx_buildings_gers_id_uuid_unique ON public.buildings USING btree (gers_id_uuid) WHERE (gers_id_uuid IS NOT NULL);
CREATE INDEX idx_buildings_is_hidden ON public.buildings USING btree (is_hidden);
CREATE INDEX idx_buildings_latest_status ON public.buildings USING btree (latest_status);
CREATE INDEX idx_buildings_workspace_id ON public.buildings USING btree (workspace_id);
CREATE INDEX campaign_addresses_campaign_id_idx ON public.campaign_addresses USING btree (campaign_id);
CREATE UNIQUE INDEX campaign_addresses_campaign_source_id_unique ON public.campaign_addresses USING btree (campaign_id, gers_id);
CREATE INDEX campaign_addresses_geom_idx ON public.campaign_addresses USING gist (geom);
CREATE INDEX campaign_addresses_visited_idx ON public.campaign_addresses USING btree (visited);
CREATE INDEX idx_campaign_addresses_building_gers_id ON public.campaign_addresses USING btree (building_gers_id) WHERE (building_gers_id IS NOT NULL);
CREATE INDEX idx_campaign_addresses_building_id ON public.campaign_addresses USING btree (campaign_id, building_id);
CREATE INDEX idx_campaign_addresses_campaign_id ON public.campaign_addresses USING btree (campaign_id);
CREATE INDEX idx_campaign_addresses_campaign_id_address ON public.campaign_addresses USING btree (campaign_id, address) WHERE (address IS NOT NULL);
CREATE UNIQUE INDEX idx_campaign_addresses_campaign_source_id ON public.campaign_addresses USING btree (campaign_id, gers_id) WHERE (gers_id IS NOT NULL);
CREATE INDEX idx_campaign_addresses_cluster ON public.campaign_addresses USING btree (campaign_id, cluster_id, sequence);
CREATE INDEX idx_campaign_addresses_geom ON public.campaign_addresses USING gist (geom);
CREATE INDEX idx_campaign_addresses_gers_id ON public.campaign_addresses USING btree (gers_id) WHERE (gers_id IS NOT NULL);
CREATE INDEX idx_campaign_addresses_house_number ON public.campaign_addresses USING btree (campaign_id, house_number) WHERE (house_number IS NOT NULL);
CREATE INDEX idx_campaign_addresses_is_oriented ON public.campaign_addresses USING btree (campaign_id, is_oriented) WHERE (is_oriented = false);
CREATE INDEX idx_campaign_addresses_locality ON public.campaign_addresses USING btree (campaign_id, locality) WHERE (locality IS NOT NULL);
CREATE INDEX idx_campaign_addresses_region ON public.campaign_addresses USING btree (campaign_id, region) WHERE (region IS NOT NULL);
CREATE INDEX idx_campaign_addresses_source_id ON public.campaign_addresses USING btree (gers_id) WHERE (gers_id IS NOT NULL);
CREATE INDEX idx_campaign_addresses_source_id_uuid ON public.campaign_addresses USING btree (gers_id_uuid) WHERE (gers_id_uuid IS NOT NULL);
CREATE INDEX idx_campaign_addresses_street_name ON public.campaign_addresses USING btree (campaign_id, street_name) WHERE (street_name IS NOT NULL);
CREATE UNIQUE INDEX unique_campaign_source ON public.campaign_addresses USING btree (campaign_id, gers_id);
CREATE UNIQUE INDEX campaign_assignment_homes_assignment_address_unique ON public.campaign_assignment_homes USING btree (assignment_id, campaign_address_id);
CREATE INDEX idx_campaign_assignment_homes_address ON public.campaign_assignment_homes USING btree (campaign_address_id);
CREATE INDEX idx_campaign_assignment_homes_assignment ON public.campaign_assignment_homes USING btree (assignment_id, sequence);
CREATE INDEX idx_campaign_assignments_assignee_status ON public.campaign_assignments USING btree (assigned_to_user_id, status, updated_at DESC);
CREATE INDEX idx_campaign_assignments_campaign_status ON public.campaign_assignments USING btree (campaign_id, status);
CREATE UNIQUE INDEX idx_campaign_assignments_one_active_member ON public.campaign_assignments USING btree (campaign_id, assigned_to_user_id) WHERE (status = ANY (ARRAY['assigned'::text, 'in_progress'::text]));
CREATE INDEX idx_campaign_assignments_workspace_status ON public.campaign_assignments USING btree (workspace_id, status, updated_at DESC);
CREATE INDEX idx_campaign_hidden_buildings_campaign_id ON public.campaign_hidden_buildings USING btree (campaign_id);
CREATE INDEX idx_campaign_hidden_buildings_public_building_id ON public.campaign_hidden_buildings USING btree (public_building_id);
CREATE UNIQUE INDEX unique_campaign_hidden_building ON public.campaign_hidden_buildings USING btree (campaign_id, public_building_id);
CREATE INDEX idx_campaign_home_events_campaign_address_created ON public.campaign_home_events USING btree (campaign_address_id, created_at DESC);
CREATE INDEX idx_campaign_home_events_campaign_created ON public.campaign_home_events USING btree (campaign_id, created_at DESC);
CREATE INDEX idx_campaign_landing_page_analytics_landing_page_id ON public.campaign_landing_page_analytics USING btree (landing_page_id);
CREATE INDEX idx_campaign_landing_page_analytics_landing_page_timestamp ON public.campaign_landing_page_analytics USING btree (landing_page_id, timestamp_bucket DESC);
CREATE INDEX idx_campaign_landing_page_analytics_timestamp ON public.campaign_landing_page_analytics USING btree (timestamp_bucket DESC);
CREATE UNIQUE INDEX unique_landing_page_date ON public.campaign_landing_page_analytics USING btree (landing_page_id, timestamp_bucket);
CREATE UNIQUE INDEX campaign_landing_pages_slug_key ON public.campaign_landing_pages USING btree (slug);
CREATE INDEX idx_campaign_landing_pages_campaign_id ON public.campaign_landing_pages USING btree (campaign_id);
CREATE INDEX idx_campaign_landing_pages_slug ON public.campaign_landing_pages USING btree (slug);
CREATE UNIQUE INDEX unique_campaign_landing_page ON public.campaign_landing_pages USING btree (campaign_id);
CREATE UNIQUE INDEX campaign_members_campaign_id_user_id_key ON public.campaign_members USING btree (campaign_id, user_id);
CREATE INDEX idx_campaign_members_campaign_id ON public.campaign_members USING btree (campaign_id);
CREATE INDEX idx_campaign_members_user_id ON public.campaign_members USING btree (user_id);
CREATE INDEX idx_campaign_parcels_cmp ON public.campaign_parcels USING btree (campaign_id);
CREATE INDEX idx_campaign_parcels_external ON public.campaign_parcels USING btree (external_id);
CREATE INDEX idx_campaign_parcels_geom ON public.campaign_parcels USING gist (geom);
CREATE INDEX idx_campaign_polished_building_features_updated_at ON public.campaign_polished_building_features USING btree (updated_at DESC);
CREATE INDEX idx_campaign_presence_campaign_updated ON public.campaign_presence USING btree (campaign_id, updated_at DESC);
CREATE INDEX idx_campaign_qr_batches_campaign_id ON public.campaign_qr_batches USING btree (campaign_id);
CREATE INDEX idx_campaign_qr_batches_created_at ON public.campaign_qr_batches USING btree (created_at DESC);
CREATE UNIQUE INDEX uq_campaign_qr_batches_campaign_id_batch_name ON public.campaign_qr_batches USING btree (campaign_id, batch_name);
CREATE INDEX idx_campaign_road_metadata_expires ON public.campaign_road_metadata USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX idx_campaign_road_metadata_status ON public.campaign_road_metadata USING btree (roads_status);
CREATE INDEX idx_campaign_roads_bbox ON public.campaign_roads USING btree (campaign_id, bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon);
CREATE INDEX idx_campaign_roads_campaign_id ON public.campaign_roads USING btree (campaign_id);
CREATE INDEX idx_campaign_roads_geom ON public.campaign_roads USING gist (geom);
CREATE INDEX idx_campaign_roads_road_id ON public.campaign_roads USING btree (campaign_id, road_id);
CREATE UNIQUE INDEX idx_campaign_roads_unique ON public.campaign_roads USING btree (campaign_id, road_id);
CREATE INDEX idx_campaign_routes_campaign_id ON public.campaign_routes USING btree (campaign_id);
CREATE UNIQUE INDEX unique_campaign_route ON public.campaign_routes USING btree (campaign_id);
CREATE INDEX idx_campaign_snapshots_campaign_id ON public.campaign_snapshots USING btree (campaign_id);
CREATE INDEX idx_campaign_snapshots_expires_at ON public.campaign_snapshots USING btree (expires_at);
CREATE UNIQUE INDEX unique_campaign_snapshot ON public.campaign_snapshots USING btree (campaign_id);
CREATE INDEX campaigns_created_at_idx ON public.campaigns USING btree (created_at);
CREATE INDEX campaigns_owner_id_idx ON public.campaigns USING btree (owner_id);
CREATE INDEX idx_campaigns_boundary ON public.campaigns USING gist (territory_boundary);
CREATE INDEX idx_campaigns_created_at ON public.campaigns USING btree (created_at);
CREATE INDEX idx_campaigns_link_quality_status ON public.campaigns USING btree (link_quality_status) WHERE (link_quality_status IS NOT NULL);
CREATE INDEX idx_campaigns_owner_id ON public.campaigns USING btree (owner_id);
CREATE INDEX idx_campaigns_parcel_enrichment_status ON public.campaigns USING btree (parcel_enrichment_status) WHERE (parcel_enrichment_status IS NOT NULL);
CREATE INDEX idx_campaigns_workspace_id ON public.campaigns USING btree (workspace_id);
CREATE UNIQUE INDEX challenge_participants_unique_member ON public.challenge_participants USING btree (challenge_id, user_id);
CREATE INDEX idx_challenge_participants_challenge_id ON public.challenge_participants USING btree (challenge_id);
CREATE INDEX idx_challenge_participants_progress ON public.challenge_participants USING btree (challenge_id, progress_count DESC);
CREATE INDEX idx_challenge_participants_user_id ON public.challenge_participants USING btree (user_id);
CREATE UNIQUE INDEX challenge_templates_slug_unique ON public.challenge_templates USING btree (slug);
CREATE INDEX idx_challenge_templates_scope_status ON public.challenge_templates USING btree (scope, status);
CREATE INDEX idx_challenges_creator_id ON public.challenges USING btree (creator_id);
CREATE INDEX idx_challenges_expires_at ON public.challenges USING btree (expires_at);
CREATE UNIQUE INDEX idx_challenges_invite_token_unique ON public.challenges USING btree (invite_token) WHERE (invite_token IS NOT NULL);
CREATE INDEX idx_challenges_participant_id ON public.challenges USING btree (participant_id);
CREATE INDEX idx_challenges_status ON public.challenges USING btree (status);
CREATE INDEX idx_challenges_type ON public.challenges USING btree (type);
CREATE INDEX idx_challenges_visibility ON public.challenges USING btree (visibility);
CREATE INDEX idx_contact_activities_contact_id ON public.contact_activities USING btree (contact_id);
CREATE INDEX idx_contacts_address_id ON public.contacts USING btree (address_id) WHERE (address_id IS NOT NULL);
CREATE INDEX idx_contacts_appointment_at ON public.contacts USING btree (appointment_at) WHERE (appointment_at IS NOT NULL);
CREATE INDEX idx_contacts_campaign_id ON public.contacts USING btree (campaign_id);
CREATE INDEX idx_contacts_farm_id ON public.contacts USING btree (farm_id);
CREATE INDEX idx_contacts_follow_up_at ON public.contacts USING btree (follow_up_at) WHERE (follow_up_at IS NOT NULL);
CREATE INDEX idx_contacts_phone_e164 ON public.contacts USING btree (phone_e164);
CREATE INDEX idx_contacts_session_id ON public.contacts USING btree (session_id);
CREATE INDEX idx_contacts_status ON public.contacts USING btree (status);
CREATE INDEX idx_contacts_user_id ON public.contacts USING btree (user_id);
CREATE INDEX idx_contacts_workspace_id ON public.contacts USING btree (workspace_id);
CREATE INDEX idx_contacts_workspace_phone_e164 ON public.contacts USING btree (workspace_id, phone_e164);
CREATE INDEX idx_conversions_campaign_id ON public.conversions USING btree (campaign_id);
CREATE INDEX idx_conversions_created_at ON public.conversions USING btree (created_at DESC);
CREATE INDEX idx_conversions_experiment_id ON public.conversions USING btree (experiment_id) WHERE (experiment_id IS NOT NULL);
CREATE INDEX idx_conversions_experiment_variant ON public.conversions USING btree (experiment_id, variant_id) WHERE ((experiment_id IS NOT NULL) AND (variant_id IS NOT NULL));
CREATE INDEX idx_conversions_landing_page_id ON public.conversions USING btree (landing_page_id);
CREATE INDEX idx_conversions_variant_id ON public.conversions USING btree (variant_id) WHERE (variant_id IS NOT NULL);
CREATE UNIQUE INDEX crm_connection_secrets_connection_id_key ON public.crm_connection_secrets USING btree (connection_id);
CREATE INDEX idx_crm_connection_secrets_connection_id ON public.crm_connection_secrets USING btree (connection_id);
CREATE UNIQUE INDEX crm_connections_user_id_provider_key ON public.crm_connections USING btree (user_id, provider);
CREATE INDEX idx_crm_connections_provider ON public.crm_connections USING btree (provider);
CREATE INDEX idx_crm_connections_user_id ON public.crm_connections USING btree (user_id);
CREATE INDEX idx_crm_connections_user_provider ON public.crm_connections USING btree (user_id, provider);
CREATE INDEX idx_crm_connections_workspace_id ON public.crm_connections USING btree (workspace_id);
CREATE INDEX idx_crm_events_user_event ON public.crm_events USING btree (user_id, flyr_event_id);
CREATE INDEX idx_crm_events_user_id ON public.crm_events USING btree (user_id);
CREATE UNIQUE INDEX uq_crm_events_user_event ON public.crm_events USING btree (user_id, flyr_event_id);
CREATE INDEX idx_crm_object_links_remote_object_id ON public.crm_object_links USING btree (crm_type, remote_object_id) WHERE (remote_object_id IS NOT NULL);
CREATE UNIQUE INDEX idx_crm_object_links_user_crm_address ON public.crm_object_links USING btree (user_id, crm_type, flyr_address_id) WHERE (flyr_address_id IS NOT NULL);
CREATE UNIQUE INDEX idx_crm_object_links_user_crm_lead ON public.crm_object_links USING btree (user_id, crm_type, flyr_lead_id) WHERE (flyr_lead_id IS NOT NULL);
CREATE INDEX idx_crm_object_links_user_id ON public.crm_object_links USING btree (user_id);
CREATE UNIQUE INDEX daily_content_cache_content_type_cache_date_key ON public.daily_content_cache USING btree (content_type, cache_date);
CREATE INDEX idx_daily_content_date ON public.daily_content_cache USING btree (cache_date);
CREATE INDEX idx_daily_content_expires ON public.daily_content_cache USING btree (expires_at);
CREATE UNIQUE INDEX dialer_calls_call_request_id_key ON public.dialer_calls USING btree (call_request_id);
CREATE UNIQUE INDEX dialer_calls_twilio_call_sid_key ON public.dialer_calls USING btree (twilio_call_sid);
CREATE INDEX idx_dialer_calls_session_created ON public.dialer_calls USING btree (session_id, created_at DESC);
CREATE INDEX idx_dialer_calls_workspace_contact_created ON public.dialer_calls USING btree (workspace_id, contact_id, created_at DESC);
CREATE INDEX idx_dialer_calls_workspace_twilio_sid ON public.dialer_calls USING btree (workspace_id, twilio_call_sid);
CREATE UNIQUE INDEX dialer_session_leads_session_id_contact_id_key ON public.dialer_session_leads USING btree (session_id, contact_id);
CREATE INDEX idx_dialer_session_leads_session_position ON public.dialer_session_leads USING btree (session_id, "position");
CREATE INDEX idx_dialer_session_leads_session_status_position ON public.dialer_session_leads USING btree (session_id, status, "position");
CREATE INDEX idx_dialer_sessions_workspace_status_created ON public.dialer_sessions USING btree (workspace_id, status, created_at DESC);
CREATE INDEX idx_dialer_sessions_workspace_user_created ON public.dialer_sessions USING btree (workspace_id, user_id, created_at DESC);
CREATE UNIQUE INDEX dialer_sms_followups_twilio_message_sid_key ON public.dialer_sms_followups USING btree (twilio_message_sid);
CREATE INDEX idx_dialer_sms_followups_workspace_contact_created ON public.dialer_sms_followups USING btree (workspace_id, contact_id, created_at DESC);
CREATE INDEX idx_entitlements_user_id ON public.entitlements USING btree (user_id);
CREATE INDEX idx_experiments_campaign_id ON public.experiments USING btree (campaign_id);
CREATE INDEX idx_experiments_created_at ON public.experiments USING btree (created_at DESC);
CREATE INDEX idx_experiments_landing_page_id ON public.experiments USING btree (landing_page_id);
CREATE INDEX idx_experiments_status ON public.experiments USING btree (status);
CREATE INDEX idx_farm_addresses_campaign_address_id ON public.farm_addresses USING btree (campaign_address_id);
CREATE INDEX idx_farm_addresses_farm_campaign_address ON public.farm_addresses USING btree (farm_id, campaign_address_id);
CREATE INDEX idx_farm_addresses_farm_id ON public.farm_addresses USING btree (farm_id);
CREATE INDEX idx_farm_addresses_farm_street ON public.farm_addresses USING btree (farm_id, street_name, house_number);
CREATE INDEX idx_farm_leads_created_at ON public.farm_leads USING btree (created_at DESC);
CREATE INDEX idx_farm_leads_farm_created ON public.farm_leads USING btree (farm_id, created_at DESC);
CREATE INDEX idx_farm_leads_farm_id ON public.farm_leads USING btree (farm_id);
CREATE INDEX idx_farm_leads_lead_source ON public.farm_leads USING btree (lead_source);
CREATE INDEX idx_farm_leads_touch_id ON public.farm_leads USING btree (touch_id) WHERE (touch_id IS NOT NULL);
CREATE UNIQUE INDEX farm_meta_ad_daily_metrics_farm_meta_campaign_link_id_date_key ON public.farm_meta_ad_daily_metrics USING btree (farm_meta_campaign_link_id, date);
CREATE INDEX idx_farm_meta_ad_daily_metrics_farm_id ON public.farm_meta_ad_daily_metrics USING btree (farm_id);
CREATE UNIQUE INDEX idx_farm_meta_campaign_links_farm_campaign ON public.farm_meta_campaign_links USING btree (farm_id, meta_campaign_id);
CREATE INDEX idx_farm_meta_campaign_links_farm_id ON public.farm_meta_campaign_links USING btree (farm_id);
CREATE INDEX idx_farm_meta_campaign_links_last_synced_at ON public.farm_meta_campaign_links USING btree (last_synced_at);
CREATE UNIQUE INDEX farm_touch_addresses_touch_address_unique ON public.farm_touch_addresses USING btree (farm_touch_id, farm_address_id);
CREATE INDEX idx_farm_touch_addresses_address_id ON public.farm_touch_addresses USING btree (farm_address_id);
CREATE INDEX idx_farm_touch_addresses_farm_id ON public.farm_touch_addresses USING btree (farm_id);
CREATE INDEX idx_farm_touch_addresses_touch_id ON public.farm_touch_addresses USING btree (farm_touch_id);
CREATE INDEX idx_farm_touches_batch_id ON public.farm_touches USING btree (batch_id) WHERE (batch_id IS NOT NULL);
CREATE INDEX idx_farm_touches_campaign_id ON public.farm_touches USING btree (campaign_id) WHERE (campaign_id IS NOT NULL);
CREATE INDEX idx_farm_touches_completed ON public.farm_touches USING btree (completed);
CREATE INDEX idx_farm_touches_completed_at ON public.farm_touches USING btree (completed_at DESC) WHERE (completed_at IS NOT NULL);
CREATE INDEX idx_farm_touches_date ON public.farm_touches USING btree (date);
CREATE INDEX idx_farm_touches_farm_cycle_number ON public.farm_touches USING btree (farm_id, cycle_number DESC, date DESC);
CREATE INDEX idx_farm_touches_farm_date ON public.farm_touches USING btree (farm_id, date);
CREATE INDEX idx_farm_touches_farm_id ON public.farm_touches USING btree (farm_id);
CREATE INDEX idx_farm_touches_session_id ON public.farm_touches USING btree (session_id) WHERE (session_id IS NOT NULL);
CREATE INDEX idx_farms_created_at ON public.farms USING btree (created_at DESC);
CREATE INDEX idx_farms_end_date ON public.farms USING btree (end_date);
CREATE INDEX idx_farms_linked_campaign_id ON public.farms USING btree (linked_campaign_id);
CREATE INDEX idx_farms_owner_id ON public.farms USING btree (owner_id);
CREATE INDEX idx_farms_polygon ON public.farms USING gist (polygon);
CREATE INDEX idx_farms_start_date ON public.farms USING btree (start_date);
CREATE INDEX idx_farms_workspace_id ON public.farms USING btree (workspace_id);
CREATE INDEX idx_feedback_items_thread_created ON public.feedback_items USING btree (thread_id, created_at DESC);
CREATE INDEX idx_feedback_threads_last_feedback_at ON public.feedback_threads USING btree (last_feedback_at DESC);
CREATE INDEX idx_feedback_threads_unread_for_founder ON public.feedback_threads USING btree (unread_for_founder) WHERE (unread_for_founder = true);
CREATE INDEX idx_feedback_threads_user_id ON public.feedback_threads USING btree (user_id);
CREATE INDEX idx_field_leads_campaign_id ON public.field_leads USING btree (campaign_id);
CREATE INDEX idx_field_leads_created_at ON public.field_leads USING btree (created_at DESC);
CREATE INDEX idx_field_leads_session_id ON public.field_leads USING btree (session_id);
CREATE INDEX idx_field_leads_user_id ON public.field_leads USING btree (user_id);
CREATE INDEX idx_field_leads_workspace_id ON public.field_leads USING btree (workspace_id);
CREATE INDEX idx_field_sessions_started_at ON public.field_sessions USING btree (started_at DESC);
CREATE INDEX idx_field_sessions_user_id ON public.field_sessions USING btree (user_id);
CREATE INDEX idx_field_sessions_workspace_id ON public.field_sessions USING btree (workspace_id);
CREATE INDEX idx_field_sessions_workspace_started ON public.field_sessions USING btree (workspace_id, started_at DESC);
CREATE INDEX idx_finance_entries_agent_user_id ON public.finance_entries USING btree (agent_user_id);
CREATE INDEX idx_finance_entries_campaign_id ON public.finance_entries USING btree (campaign_id);
CREATE INDEX idx_finance_entries_farm_id ON public.finance_entries USING btree (farm_id);
CREATE INDEX idx_finance_entries_incurred_on ON public.finance_entries USING btree (incurred_on DESC);
CREATE INDEX idx_finance_entries_workspace_id ON public.finance_entries USING btree (workspace_id);
CREATE INDEX idx_flyers_campaign_id ON public.flyers USING btree (campaign_id);
CREATE INDEX idx_global_address_cache_centroid ON public.global_address_cache USING gist (centroid);
CREATE INDEX idx_gold_sync_log_source ON public.gold_data_sync_log USING btree (source_id, sync_completed_at DESC);
CREATE INDEX idx_gold_sync_log_status ON public.gold_data_sync_log USING btree (sync_status, sync_started_at DESC);
CREATE INDEX idx_landing_page_events_event_type ON public.landing_page_events USING btree (event_type);
CREATE INDEX idx_landing_page_events_landing_page_id ON public.landing_page_events USING btree (landing_page_id);
CREATE INDEX idx_landing_page_events_page_type_timestamp ON public.landing_page_events USING btree (landing_page_id, event_type, "timestamp" DESC);
CREATE INDEX idx_landing_page_events_timestamp ON public.landing_page_events USING btree ("timestamp" DESC);
CREATE INDEX idx_landing_page_templates_created_at ON public.landing_page_templates USING btree (created_at DESC);
CREATE INDEX idx_landing_page_templates_name ON public.landing_page_templates USING btree (name);
CREATE INDEX idx_landing_pages_address_id ON public.landing_pages USING btree (address_id) WHERE (address_id IS NOT NULL);
CREATE INDEX idx_landing_pages_campaign_address ON public.landing_pages USING btree (campaign_id, address_id) WHERE ((campaign_id IS NOT NULL) AND (address_id IS NOT NULL));
CREATE INDEX idx_landing_pages_campaign_id ON public.landing_pages USING btree (campaign_id) WHERE (campaign_id IS NOT NULL);
CREATE INDEX idx_landing_pages_created_at ON public.landing_pages USING btree (created_at DESC);
CREATE UNIQUE INDEX idx_landing_pages_slug_unique ON public.landing_pages USING btree (slug) WHERE (slug IS NOT NULL);
CREATE INDEX idx_landing_pages_template_id ON public.landing_pages USING btree (template_id) WHERE (template_id IS NOT NULL);
CREATE INDEX idx_landing_pages_type ON public.landing_pages USING btree (type) WHERE (type IS NOT NULL);
CREATE INDEX idx_landing_pages_user_id ON public.landing_pages USING btree (user_id);
CREATE INDEX idx_leaderboard_rollups_scope_period ON public.leaderboard_rollups USING btree (scope_key, timeframe, period_start);
CREATE INDEX idx_leaderboard_rollups_workspace_period ON public.leaderboard_rollups USING btree (workspace_id, timeframe, period_start) WHERE (workspace_id IS NOT NULL);
CREATE INDEX idx_live_session_codes_campaign_active ON public.live_session_codes USING btree (campaign_id, expires_at DESC) WHERE (revoked_at IS NULL);
CREATE INDEX idx_live_session_codes_session_active ON public.live_session_codes USING btree (session_id, expires_at DESC) WHERE (revoked_at IS NULL);
CREATE UNIQUE INDEX live_session_codes_code_hash_key ON public.live_session_codes USING btree (code_hash);
CREATE INDEX idx_map_buildings_address_id ON public.map_buildings USING btree (address_id);
CREATE INDEX idx_map_buildings_campaign_id ON public.map_buildings USING btree (campaign_id);
CREATE INDEX idx_map_buildings_centroid ON public.map_buildings USING gist (centroid);
CREATE INDEX idx_map_buildings_geom ON public.map_buildings USING gist (geom);
CREATE INDEX idx_map_buildings_is_townhome ON public.map_buildings USING btree (is_townhome_row);
CREATE UNIQUE INDEX idx_map_buildings_source_campaign_unique ON public.map_buildings USING btree (gers_id, campaign_id) WHERE ((gers_id IS NOT NULL) AND (campaign_id IS NOT NULL));
CREATE INDEX idx_map_buildings_source_id ON public.map_buildings USING btree (gers_id);
CREATE INDEX idx_map_buildings_source_id_uuid ON public.map_buildings USING btree (gers_id_uuid) WHERE (gers_id_uuid IS NOT NULL);
CREATE INDEX idx_map_buildings_street_name ON public.map_buildings USING btree (street_name) WHERE (street_name IS NOT NULL);
CREATE UNIQUE INDEX map_buildings_source_campaign_unique ON public.map_buildings USING btree (gers_id, campaign_id);
CREATE UNIQUE INDEX idx_meta_ad_accounts_user_account ON public.meta_ad_accounts USING btree (user_id, meta_ad_account_id);
CREATE UNIQUE INDEX idx_meta_connections_user_id ON public.meta_connections USING btree (user_id);
CREATE INDEX idx_meta_sync_logs_created_at ON public.meta_sync_logs USING btree (created_at DESC);
CREATE INDEX idx_meta_sync_logs_link_id ON public.meta_sync_logs USING btree (farm_meta_campaign_link_id);
CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, created_at DESC) WHERE (read_at IS NULL);
CREATE INDEX idx_transport_class ON public.overture_transportation USING btree (class);
CREATE INDEX idx_transport_geom ON public.overture_transportation USING gist (geom);
CREATE INDEX idx_transport_gers_id ON public.overture_transportation USING btree (gers_id);
CREATE INDEX idx_transport_subclass ON public.overture_transportation USING btree (subclass);
CREATE UNIQUE INDEX overture_transportation_gers_id_key ON public.overture_transportation USING btree (gers_id);
CREATE INDEX idx_partner_offers_created_at ON public.partner_offers USING btree (created_at DESC);
CREATE INDEX idx_partner_offers_email_status ON public.partner_offers USING btree (email_status);
CREATE INDEX idx_partner_offers_expires_at ON public.partner_offers USING btree (expires_at);
CREATE INDEX idx_partner_offers_is_draft ON public.partner_offers USING btree (is_draft, created_at DESC);
CREATE UNIQUE INDEX idx_partner_offers_vanity_slug ON public.partner_offers USING btree (vanity_slug) WHERE (vanity_slug IS NOT NULL);
CREATE UNIQUE INDEX partner_offers_token_key ON public.partner_offers USING btree (token);
CREATE INDEX idx_profiles_email ON public.profiles USING btree (email) WHERE (email IS NOT NULL);
CREATE INDEX idx_qr_code_scans_address_id ON public.qr_code_scans USING btree (address_id) WHERE (address_id IS NOT NULL);
CREATE INDEX idx_qr_code_scans_qr_code_id ON public.qr_code_scans USING btree (qr_code_id) WHERE (qr_code_id IS NOT NULL);
CREATE INDEX idx_qr_code_scans_qr_code_time ON public.qr_code_scans USING btree (qr_code_id, scanned_at DESC) WHERE (qr_code_id IS NOT NULL);
CREATE INDEX idx_qr_codes_address_id ON public.qr_codes USING btree (address_id);
CREATE UNIQUE INDEX idx_qr_codes_address_id_unique ON public.qr_codes USING btree (address_id) WHERE (address_id IS NOT NULL);
CREATE INDEX idx_qr_codes_campaign_id ON public.qr_codes USING btree (campaign_id);
CREATE INDEX idx_qr_codes_created_at ON public.qr_codes USING btree (created_at DESC);
CREATE INDEX idx_qr_codes_farm_id ON public.qr_codes USING btree (farm_id);
CREATE INDEX idx_qr_codes_landing_page_id ON public.qr_codes USING btree (landing_page_id) WHERE (landing_page_id IS NOT NULL);
CREATE INDEX idx_qr_codes_slug ON public.qr_codes USING btree (slug) WHERE (slug IS NOT NULL);
CREATE UNIQUE INDEX idx_qr_codes_slug_unique ON public.qr_codes USING btree (slug) WHERE (slug IS NOT NULL);
CREATE INDEX idx_qr_codes_variant ON public.qr_codes USING btree (qr_variant) WHERE (qr_variant IS NOT NULL);
CREATE UNIQUE INDEX qr_codes_slug_key ON public.qr_codes USING btree (slug);
CREATE INDEX idx_qr_scan_events_campaign_id ON public.qr_scan_events USING btree (campaign_id) WHERE (campaign_id IS NOT NULL);
CREATE INDEX idx_qr_scan_events_created_at ON public.qr_scan_events USING btree (created_at DESC);
CREATE INDEX idx_qr_scan_events_experiment_id ON public.qr_scan_events USING btree (experiment_id) WHERE (experiment_id IS NOT NULL);
CREATE INDEX idx_qr_scan_events_experiment_variant ON public.qr_scan_events USING btree (experiment_id, variant_id) WHERE ((experiment_id IS NOT NULL) AND (variant_id IS NOT NULL));
CREATE INDEX idx_qr_scan_events_landing_page_id ON public.qr_scan_events USING btree (landing_page_id) WHERE (landing_page_id IS NOT NULL);
CREATE INDEX idx_qr_scan_events_variant_id ON public.qr_scan_events USING btree (variant_id) WHERE (variant_id IS NOT NULL);
CREATE INDEX idx_qr_sets_campaign_id ON public.qr_sets USING btree (campaign_id);
CREATE INDEX idx_qr_sets_created_at ON public.qr_sets USING btree (created_at DESC);
CREATE INDEX idx_qr_sets_user_id ON public.qr_sets USING btree (user_id);
CREATE UNIQUE INDEX idx_ranking_brokerages_all_time_key ON public.ranking_brokerages_all_time USING btree (brokerage_key);
CREATE UNIQUE INDEX idx_ranking_brokerages_month_key ON public.ranking_brokerages_month USING btree (brokerage_key);
CREATE INDEX idx_ref_addr_gold_geom ON public.ref_addresses_gold USING gist (geom);
CREATE INDEX idx_ref_addr_gold_lookup ON public.ref_addresses_gold USING btree (street_number, street_name, city);
CREATE INDEX idx_ref_addr_gold_lookup_norm ON public.ref_addresses_gold USING btree (street_number_normalized, street_name_normalized, city);
CREATE INDEX idx_ref_addr_gold_province_source ON public.ref_addresses_gold USING btree (province, source_id);
CREATE INDEX idx_ref_addr_gold_source ON public.ref_addresses_gold USING btree (source_id);
CREATE INDEX idx_ref_addr_gold_street ON public.ref_addresses_gold USING btree (street_name);
CREATE INDEX idx_ref_addr_gold_street_norm ON public.ref_addresses_gold USING btree (street_name_normalized);
CREATE INDEX idx_ref_addr_gold_street_trgm ON public.ref_addresses_gold USING gin (street_name_normalized gin_trgm_ops);
CREATE INDEX idx_ref_addr_gold_zip ON public.ref_addresses_gold USING btree (zip);
CREATE INDEX idx_ref_addresses_gold_province ON public.ref_addresses_gold USING btree (province);
CREATE INDEX idx_ref_addresses_gold_street ON public.ref_addresses_gold USING btree (street_name_normalized, street_number_normalized);
CREATE INDEX ref_addresses_gold_geom_idx ON public.ref_addresses_gold USING gist (geom);
CREATE UNIQUE INDEX uniq_ref_addr_source_norm_city_unit ON public.ref_addresses_gold USING btree (source_id, street_number_normalized, street_name_normalized, city, unit);
CREATE INDEX idx_ref_bldg_gold_centroid ON public.ref_buildings_gold USING gist (centroid);
CREATE INDEX idx_ref_bldg_gold_external_id ON public.ref_buildings_gold USING btree (external_id) WHERE (external_id IS NOT NULL);
CREATE INDEX idx_ref_bldg_gold_geom ON public.ref_buildings_gold USING gist (geom);
CREATE INDEX idx_ref_bldg_gold_source ON public.ref_buildings_gold USING btree (source_id);
CREATE INDEX idx_ref_bldg_gold_type ON public.ref_buildings_gold USING btree (building_type, subtype) WHERE (building_type IS NOT NULL);
CREATE INDEX ref_buildings_gold_geom_idx ON public.ref_buildings_gold USING gist (geom);
CREATE UNIQUE INDEX uniq_ref_buildings_source_external ON public.ref_buildings_gold USING btree (source_id, external_id);
CREATE INDEX idx_report_runs_workspace_ran_at ON public.report_runs USING btree (workspace_id, ran_at DESC);
CREATE UNIQUE INDEX report_runs_unique_period ON public.report_runs USING btree (workspace_id, period, period_start, period_end);
CREATE INDEX idx_reports_owner_created ON public.reports USING btree (owner_user_id, created_at DESC) WHERE (owner_user_id IS NOT NULL);
CREATE INDEX idx_reports_subject_created ON public.reports USING btree (subject_user_id, created_at DESC) WHERE (subject_user_id IS NOT NULL);
CREATE INDEX idx_reports_workspace_period_start ON public.reports USING btree (workspace_id, period, period_start DESC);
CREATE UNIQUE INDEX reports_unique_scope_period ON public.reports USING btree (workspace_id, scope, owner_user_key, subject_user_key, period, period_start, period_end);
CREATE INDEX idx_route_assignments_assignee_status ON public.route_assignments USING btree (assigned_to_user_id, status);
CREATE UNIQUE INDEX idx_route_assignments_one_active_per_plan ON public.route_assignments USING btree (route_plan_id) WHERE (status = ANY (ARRAY['assigned'::text, 'accepted'::text, 'in_progress'::text]));
CREATE INDEX idx_route_assignments_route_plan_id ON public.route_assignments USING btree (route_plan_id);
CREATE INDEX idx_route_assignments_workspace_id ON public.route_assignments USING btree (workspace_id);
CREATE UNIQUE INDEX idx_route_map_snapshots_assignment_unique ON public.route_map_snapshots USING btree (assignment_id) WHERE (assignment_id IS NOT NULL);
CREATE INDEX idx_route_map_snapshots_campaign ON public.route_map_snapshots USING btree (campaign_id, generated_at DESC);
CREATE INDEX idx_route_map_snapshots_route_plan ON public.route_map_snapshots USING btree (route_plan_id, generated_at DESC);
CREATE INDEX idx_route_plans_campaign_id ON public.route_plans USING btree (campaign_id);
CREATE INDEX idx_route_plans_created_at ON public.route_plans USING btree (created_at DESC);
CREATE INDEX idx_route_plans_workspace_id ON public.route_plans USING btree (workspace_id);
CREATE INDEX idx_route_stops_route_plan_order ON public.route_stops USING btree (route_plan_id, stop_order);
CREATE INDEX idx_safety_events_session_created ON public.safety_events USING btree (session_id, created_at DESC);
CREATE INDEX idx_safety_events_share_id ON public.safety_events USING btree (share_id);
CREATE INDEX idx_scan_events_building_id ON public.scan_events USING btree (building_id);
CREATE INDEX idx_scan_events_campaign_id ON public.scan_events USING btree (campaign_id);
CREATE INDEX idx_scan_events_lookup ON public.scan_events USING btree (building_id, scanned_at DESC);
CREATE INDEX idx_scan_events_scanned_at ON public.scan_events USING btree (scanned_at DESC);
CREATE INDEX idx_session_checkins_share_id ON public.session_checkins USING btree (share_id);
CREATE INDEX idx_session_events_address_id ON public.session_events USING btree (address_id);
CREATE INDEX idx_session_events_building_id ON public.session_events USING btree (building_id);
CREATE INDEX idx_session_events_created_at ON public.session_events USING btree (created_at DESC);
CREATE INDEX idx_session_events_event_type ON public.session_events USING btree (event_type);
CREATE INDEX idx_session_events_session_id ON public.session_events USING btree (session_id);
CREATE INDEX idx_session_events_timestamp ON public.session_events USING btree ("timestamp" DESC);
CREATE INDEX idx_session_heartbeats_session_recorded ON public.session_heartbeats USING btree (session_id, recorded_at DESC);
CREATE INDEX idx_session_heartbeats_share_id ON public.session_heartbeats USING btree (share_id);
CREATE INDEX idx_session_participants_campaign_active ON public.session_participants USING btree (campaign_id, left_at);
CREATE INDEX idx_session_participants_session_active ON public.session_participants USING btree (session_id, left_at);
CREATE INDEX idx_session_participants_user_active ON public.session_participants USING btree (user_id, left_at);
CREATE UNIQUE INDEX session_participants_session_id_user_id_key ON public.session_participants USING btree (session_id, user_id);
CREATE INDEX idx_session_shares_created_by ON public.session_shares USING btree (created_by);
CREATE UNIQUE INDEX idx_session_shares_one_active_per_session ON public.session_shares USING btree (session_id) WHERE (revoked_at IS NULL);
CREATE INDEX idx_session_shares_session_id ON public.session_shares USING btree (session_id);
CREATE UNIQUE INDEX session_shares_share_token_hash_key ON public.session_shares USING btree (share_token_hash);
CREATE INDEX idx_sessions_campaign_id ON public.sessions USING btree (campaign_id);
CREATE INDEX idx_sessions_conversations ON public.sessions USING btree (conversations DESC);
CREATE INDEX idx_sessions_doors_hit ON public.sessions USING btree (doors_hit DESC);
CREATE INDEX idx_sessions_farm_id ON public.sessions USING btree (farm_id) WHERE (farm_id IS NOT NULL);
CREATE INDEX idx_sessions_farm_touch_id ON public.sessions USING btree (farm_touch_id) WHERE (farm_touch_id IS NOT NULL);
CREATE INDEX idx_sessions_flyers ON public.sessions USING btree (flyers_delivered DESC);
CREATE INDEX idx_sessions_goal_type ON public.sessions USING btree (goal_type);
CREATE INDEX idx_sessions_route_assignment_id ON public.sessions USING btree (route_assignment_id) WHERE (route_assignment_id IS NOT NULL);
CREATE INDEX idx_sessions_route_data ON public.sessions USING gin (route_data);
CREATE INDEX idx_sessions_session_mode ON public.sessions USING btree (session_mode);
CREATE INDEX idx_sessions_start_time ON public.sessions USING btree (start_time DESC);
CREATE INDEX idx_sessions_started_at ON public.sessions USING btree (start_time DESC);
CREATE INDEX idx_sessions_started_user ON public.sessions USING btree (start_time DESC, user_id);
CREATE INDEX idx_sessions_user_id ON public.sessions USING btree (user_id);
CREATE INDEX idx_sessions_workspace_id ON public.sessions USING btree (workspace_id);
CREATE INDEX idx_sessions_workspace_leads_created ON public.sessions USING btree (workspace_id, leads_created);
CREATE INDEX idx_sessions_workspace_started_user ON public.sessions USING btree (workspace_id, start_time DESC, user_id);
CREATE INDEX idx_support_messages_thread_created ON public.support_messages USING btree (thread_id, created_at);
CREATE INDEX idx_support_messages_thread_created_at ON public.support_messages USING btree (thread_id, created_at DESC);
CREATE INDEX idx_support_threads_last_message_at ON public.support_threads USING btree (last_message_at DESC);
CREATE INDEX idx_support_threads_needs_reply ON public.support_threads USING btree (needs_reply) WHERE (needs_reply = true);
CREATE INDEX idx_support_threads_unread_for_support ON public.support_threads USING btree (unread_for_support) WHERE (unread_for_support = true);
CREATE INDEX idx_support_threads_unread_for_user ON public.support_threads USING btree (unread_for_user) WHERE (unread_for_user = true);
CREATE INDEX idx_support_threads_user_id ON public.support_threads USING btree (user_id);
CREATE INDEX idx_user_integrations_provider ON public.user_integrations USING btree (provider);
CREATE INDEX idx_user_integrations_user_id ON public.user_integrations USING btree (user_id);
CREATE INDEX idx_user_integrations_user_provider ON public.user_integrations USING btree (user_id, provider);
CREATE UNIQUE INDEX user_integrations_user_id_provider_key ON public.user_integrations USING btree (user_id, provider);
CREATE INDEX idx_user_profiles_current_workspace_id ON public.user_profiles USING btree (current_workspace_id);
CREATE INDEX idx_user_settings_default_template_id ON public.user_settings USING btree (default_template_id) WHERE (default_template_id IS NOT NULL);
CREATE INDEX idx_user_stats_conversations ON public.user_stats USING btree (conversations DESC);
CREATE INDEX idx_user_stats_distance ON public.user_stats USING btree (distance_walked DESC);
CREATE INDEX idx_user_stats_flyers ON public.user_stats USING btree (flyers DESC);
CREATE INDEX idx_user_stats_leaderboard ON public.user_stats USING btree (flyers DESC, conversations DESC, leads_created DESC, distance_walked DESC, time_tracked DESC);
CREATE INDEX idx_user_stats_leads ON public.user_stats USING btree (leads_created DESC);
CREATE INDEX idx_user_stats_time ON public.user_stats USING btree (time_tracked DESC);
CREATE INDEX idx_user_stats_updated_at ON public.user_stats USING btree (updated_at DESC);
CREATE INDEX idx_user_stats_user_id ON public.user_stats USING btree (user_id);
CREATE INDEX idx_user_stats_xp ON public.user_stats USING btree (xp DESC);
CREATE UNIQUE INDEX user_stats_user_id_key ON public.user_stats USING btree (user_id);
CREATE INDEX idx_workspace_billing_addons_workspace_status ON public.workspace_billing_addons USING btree (workspace_id, status);
CREATE UNIQUE INDEX workspace_billing_addons_workspace_id_addon_key_key ON public.workspace_billing_addons USING btree (workspace_id, addon_key);
CREATE UNIQUE INDEX workspace_dialer_settings_workspace_id_key ON public.workspace_dialer_settings USING btree (workspace_id);
CREATE INDEX idx_workspace_invites_campaign_id ON public.workspace_invites USING btree (campaign_id) WHERE (campaign_id IS NOT NULL);
CREATE INDEX idx_workspace_invites_email ON public.workspace_invites USING btree (email);
CREATE INDEX idx_workspace_invites_expires_at ON public.workspace_invites USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX idx_workspace_invites_session_id ON public.workspace_invites USING btree (session_id) WHERE (session_id IS NOT NULL);
CREATE INDEX idx_workspace_invites_token ON public.workspace_invites USING btree (token) WHERE (status = 'pending'::text);
CREATE UNIQUE INDEX idx_workspace_invites_token_unique ON public.workspace_invites USING btree (invite_token) WHERE (invite_token IS NOT NULL);
CREATE INDEX idx_workspace_invites_workspace_id ON public.workspace_invites USING btree (workspace_id);
CREATE UNIQUE INDEX workspace_invites_token_key ON public.workspace_invites USING btree (token);
CREATE INDEX idx_workspace_members_user_id ON public.workspace_members USING btree (user_id);
CREATE INDEX idx_workspace_members_workspace_id ON public.workspace_members USING btree (workspace_id);
CREATE UNIQUE INDEX workspace_members_workspace_id_user_id_key ON public.workspace_members USING btree (workspace_id, user_id);
CREATE INDEX idx_workspaces_brokerage_id ON public.workspaces USING btree (brokerage_id);
CREATE INDEX idx_workspaces_owner_id ON public.workspaces USING btree (owner_id);
CREATE INDEX idx_workspaces_subscription_status ON public.workspaces USING btree (subscription_status);

CREATE OR REPLACE FUNCTION public."accept_challenge_invite"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  v_uid UUID := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_email TEXT := lower(trim(COALESCE(p_participant_email, '')));
  v_phone TEXT := public.normalize_challenge_phone(p_participant_phone);
  v_invited_phone TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges
  WHERE invite_token = NULLIF(trim(p_token), '')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge invite not found.';
  END IF;

  v_invited_phone := public.normalize_challenge_phone(v_challenge.invited_phone);

  IF v_challenge.status <> 'active' THEN
    RAISE EXCEPTION 'This challenge is no longer active.';
  END IF;

  IF v_challenge.creator_id = v_uid THEN
    RAISE EXCEPTION 'You cannot accept your own challenge.';
  END IF;

  IF v_challenge.expires_at IS NOT NULL
     AND v_challenge.expires_at <= now()
     AND v_challenge.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This challenge has already ended.';
  END IF;

  IF v_invited_phone IS NOT NULL THEN
    IF v_phone IS NULL OR v_phone <> v_invited_phone THEN
      RAISE EXCEPTION 'This invite was sent to a different phone number.';
    END IF;
  ELSIF v_challenge.invited_email IS NOT NULL
     AND lower(trim(v_challenge.invited_email)) <> v_email THEN
    RAISE EXCEPTION 'This invite was sent to a different email address.';
  END IF;

  INSERT INTO public.challenge_participants (
    challenge_id,
    user_id,
    participant_name,
    baseline_count,
    progress_count,
    joined_at,
    accepted_at,
    last_sync_at
  )
  VALUES (
    v_challenge.id,
    v_uid,
    NULLIF(trim(COALESCE(p_participant_name, '')), ''),
    GREATEST(COALESCE(p_baseline_count, 0), 0),
    0,
    now(),
    now(),
    now()
  )
  ON CONFLICT (challenge_id, user_id)
  DO UPDATE
    SET participant_name = COALESCE(
          public.challenge_participants.participant_name,
          EXCLUDED.participant_name
        )
  ;

  UPDATE public.challenges
  SET accepted_at = COALESCE(accepted_at, now()),
      expires_at = CASE
        WHEN expires_at IS NULL AND time_limit_hours IS NOT NULL
          THEN now() + make_interval(hours => time_limit_hours)
        ELSE expires_at
      END
  WHERE id = v_challenge.id;

  RETURN public.refresh_challenge_participant_snapshot(v_challenge.id);
END;
$function$; -- overload 1

CREATE OR REPLACE FUNCTION public."accept_challenge_invite"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  v_uid UUID := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_email TEXT := lower(trim(COALESCE(p_participant_email, '')));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges
  WHERE invite_token = NULLIF(trim(p_token), '')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge invite not found.';
  END IF;

  IF v_challenge.status <> 'active' THEN
    RAISE EXCEPTION 'This challenge is no longer active.';
  END IF;

  IF v_challenge.creator_id = v_uid THEN
    RAISE EXCEPTION 'You cannot accept your own challenge.';
  END IF;

  IF v_challenge.participant_id IS NOT NULL THEN
    IF v_challenge.participant_id = v_uid THEN
      RETURN v_challenge;
    END IF;

    RAISE EXCEPTION 'This challenge has already been accepted.';
  END IF;

  IF v_challenge.invited_email IS NOT NULL
     AND lower(trim(v_challenge.invited_email)) <> v_email THEN
    RAISE EXCEPTION 'This invite was sent to a different email address.';
  END IF;

  UPDATE public.challenges
  SET participant_id = v_uid,
      participant_name = NULLIF(trim(COALESCE(p_participant_name, '')), ''),
      accepted_at = now(),
      baseline_count = GREATEST(COALESCE(p_baseline_count, 0), 0),
      progress_count = 0,
      expires_at = CASE
        WHEN v_challenge.time_limit_hours IS NULL THEN v_challenge.expires_at
        ELSE now() + make_interval(hours => v_challenge.time_limit_hours)
      END
  WHERE id = v_challenge.id
  RETURNING * INTO v_challenge;

  RETURN v_challenge;
END;
$function$; -- overload 2

CREATE OR REPLACE FUNCTION public."add_campaign_addresses"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
    INSERT INTO public.campaign_addresses (
        campaign_id,
        address,
        formatted,
        house_number,
        street_name,
        locality,
        region,
        postal_code,
        source,
        gers_id,
        visited,
        coordinate,
        geom,
        created_at
    )
    SELECT
        p_campaign_id,
        NULLIF(addr->>'formatted', ''),
        NULLIF(addr->>'formatted', ''),
        NULLIF(addr->>'house_number', ''),
        NULLIF(addr->>'street_name', ''),
        NULLIF(COALESCE(addr->>'locality', addr->>'city'), ''),
        NULLIF(UPPER(TRIM(COALESCE(addr->>'region', addr->>'state', ''))), ''),
        NULLIF(addr->>'postal_code', ''),
        COALESCE(NULLIF(addr->>'source', ''), 'lambda'),
        NULLIF(addr->>'gers_id', ''),
        COALESCE((addr->>'visited')::boolean, false),
        COALESCE(
            addr->'coordinate',
            jsonb_build_object(
                'lat', COALESCE(addr->>'lat', addr #>> '{coordinate,lat}', addr #>> '{geom,coordinates,1}')::double precision,
                'lon', COALESCE(addr->>'lon', addr #>> '{coordinate,lon}', addr #>> '{geom,coordinates,0}')::double precision
            )
        ),
        CASE
            WHEN addr ? 'geom' AND addr->>'geom' IS NOT NULL AND addr->>'geom' <> ''
                THEN ST_SetSRID(ST_GeomFromGeoJSON(addr->>'geom'), 4326)::geometry(Point, 4326)
            ELSE ST_SetSRID(
                ST_MakePoint(
                    COALESCE(addr->>'lon', addr #>> '{coordinate,lon}', addr #>> '{geom,coordinates,0}')::double precision,
                    COALESCE(addr->>'lat', addr #>> '{coordinate,lat}', addr #>> '{geom,coordinates,1}')::double precision
                ),
                4326
            )::geometry(Point, 4326)
        END,
        NOW()
    FROM jsonb_array_elements(p_addresses) AS addr
    WHERE COALESCE(addr->>'lat', addr #>> '{coordinate,lat}', addr #>> '{geom,coordinates,1}') IS NOT NULL
      AND COALESCE(addr->>'lon', addr #>> '{coordinate,lon}', addr #>> '{geom,coordinates,0}') IS NOT NULL
    ON CONFLICT (campaign_id, gers_id)
    DO UPDATE SET
        formatted = COALESCE(EXCLUDED.formatted, public.campaign_addresses.formatted),
        address = COALESCE(EXCLUDED.address, public.campaign_addresses.address),
        house_number = COALESCE(EXCLUDED.house_number, public.campaign_addresses.house_number),
        street_name = COALESCE(EXCLUDED.street_name, public.campaign_addresses.street_name),
        locality = COALESCE(EXCLUDED.locality, public.campaign_addresses.locality),
        region = COALESCE(EXCLUDED.region, public.campaign_addresses.region),
        postal_code = COALESCE(EXCLUDED.postal_code, public.campaign_addresses.postal_code),
        source = COALESCE(EXCLUDED.source, public.campaign_addresses.source),
        coordinate = COALESCE(EXCLUDED.coordinate, public.campaign_addresses.coordinate),
        geom = COALESCE(EXCLUDED.geom, public.campaign_addresses.geom);
END;
$function$;

CREATE OR REPLACE FUNCTION public."addr_key"()
RETURNS text
LANGUAGE sql
AS $function$

  SELECT md5(
    regexp_replace(lower(coalesce(p_formatted,'')), '\s+', ' ', 'g') || '|' ||
    regexp_replace(upper(coalesce(p_postal,'')), '\s+', '', 'g')
  );
$function$;

CREATE OR REPLACE FUNCTION public."ambassador_applications_set_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."ambassador_commissions_set_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."ambassador_payout_batches_set_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."ambassador_referrals_set_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."api_get_buildings_by_address_ids"()
RETURNS jsonb
LANGUAGE sql
AS $function$

  SELECT public.get_buildings_by_address_ids(p_address_ids);
$function$;

CREATE OR REPLACE FUNCTION public."assign_address_to_building_manual"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_previous_building_ids UUID[] := ARRAY[]::UUID[];
  v_building_id UUID;
  v_linked_address_ids UUID[] := ARRAY[]::UUID[];
  v_unit_count INTEGER := 1;
BEGIN
  PERFORM 1
  FROM public.campaign_addresses
  WHERE campaign_id = p_campaign_id
    AND id = p_address_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Address % not found in campaign %', p_address_id, p_campaign_id;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT building_id), ARRAY[]::UUID[])
  INTO v_previous_building_ids
  FROM public.building_address_links
  WHERE campaign_id = p_campaign_id
    AND address_id = p_address_id;

  INSERT INTO public.building_address_links (
    campaign_id,
    building_id,
    address_id,
    match_type,
    confidence,
    distance_meters,
    street_match_score,
    is_multi_unit,
    unit_count,
    unit_arrangement
  )
  VALUES (
    p_campaign_id,
    p_building_row_id,
    p_address_id,
    'manual',
    1,
    0,
    1,
    false,
    1,
    'single'
  )
  ON CONFLICT (campaign_id, address_id) DO UPDATE
  SET building_id = EXCLUDED.building_id,
      match_type = EXCLUDED.match_type,
      confidence = EXCLUDED.confidence,
      distance_meters = EXCLUDED.distance_meters,
      street_match_score = EXCLUDED.street_match_score,
      unit_arrangement = EXCLUDED.unit_arrangement;

  UPDATE public.campaign_addresses
  SET building_id = p_building_row_id,
      building_gers_id = p_building_public_id,
      match_source = 'manual',
      confidence = 1,
      geom = CASE
        WHEN p_lon IS NOT NULL AND p_lat IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
        ELSE geom
      END
  WHERE campaign_id = p_campaign_id
    AND id = p_address_id;

  IF to_regclass('public.address_orphans') IS NOT NULL THEN
    UPDATE public.address_orphans
    SET status = 'assigned',
        assigned_building_id = p_building_row_id,
        assigned_by = p_assigned_by,
        assigned_at = NOW()
    WHERE campaign_id = p_campaign_id
      AND address_id = p_address_id;
  END IF;

  FOREACH v_building_id IN ARRAY array_append(v_previous_building_ids, p_building_row_id)
  LOOP
    WITH linked AS (
      SELECT address_id
      FROM public.building_address_links
      WHERE campaign_id = p_campaign_id
        AND building_id = v_building_id
    ),
    counts AS (
      SELECT GREATEST(COUNT(*), 1)::INTEGER AS unit_count FROM linked
    )
    UPDATE public.building_address_links bal
    SET is_multi_unit = counts.unit_count > 1,
        unit_count = counts.unit_count,
        unit_arrangement = CASE WHEN counts.unit_count > 1 THEN 'horizontal' ELSE 'single' END
    FROM counts
    WHERE bal.campaign_id = p_campaign_id
      AND bal.building_id = v_building_id;
  END LOOP;

  SELECT COALESCE(array_agg(address_id ORDER BY address_id), ARRAY[]::UUID[])
  INTO v_linked_address_ids
  FROM public.building_address_links
  WHERE campaign_id = p_campaign_id
    AND building_id = p_building_row_id;

  v_unit_count := GREATEST(array_length(v_linked_address_ids, 1), 1);

  RETURN jsonb_build_object(
    'linked_address_ids', COALESCE(to_jsonb(v_linked_address_ids), '[]'::jsonb),
    'unit_count', v_unit_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."assign_route_plan"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  v_plan public.route_plans%ROWTYPE;
  v_assignment public.route_assignments%ROWTYPE;
BEGIN
  SELECT rp.*
  INTO v_plan
  FROM public.route_plans rp
  WHERE rp.id = p_route_plan_id;

  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'route plan not found';
  END IF;

  IF NOT public.has_workspace_role(v_plan.workspace_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF NOT public.is_workspace_member(v_plan.workspace_id)
     OR NOT public.has_workspace_role(v_plan.workspace_id, p_assigned_to_user_id, ARRAY['owner', 'admin', 'member']) THEN
    RAISE EXCEPTION 'assigned user is not in this workspace';
  END IF;

  INSERT INTO public.route_assignments (
    route_plan_id,
    workspace_id,
    assigned_to_user_id,
    assigned_by_user_id,
    status,
    progress
  )
  VALUES (
    v_plan.id,
    v_plan.workspace_id,
    p_assigned_to_user_id,
    auth.uid(),
    'assigned',
    '{}'::jsonb
  )
  RETURNING *
  INTO v_assignment;

  RETURN v_assignment;
END;
$function$;

CREATE OR REPLACE FUNCTION public."backfill_address_buildings_front_bearing"()
RETURNS void
LANGUAGE plpgsql
AS $function$

DECLARE
    rec record;
    v_count integer := 0;
    v_building_id uuid;
BEGIN
    FOR rec IN
        SELECT address_id
        FROM public.address_buildings
        WHERE front_bearing IS NULL OR front_bearing = 0
    LOOP
        -- Get the building id from address_id
        SELECT id INTO v_building_id
        FROM public.address_buildings
        WHERE address_id = rec.address_id
        LIMIT 1;
        
        IF v_building_id IS NOT NULL THEN
            PERFORM public.compute_front_bearing_for_address_building(v_building_id);
            v_count := v_count + 1;
            
            -- Log progress every 100 records
            IF v_count % 100 = 0 THEN
                RAISE NOTICE 'Processed % address_buildings...', v_count;
            END IF;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Backfill complete. Processed % address_buildings.', v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public."batch_insert_map_buildings_from_wkb"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
    building jsonb;
    v_geom geometry(MultiPolygon, 4326);
    v_source_id text;
    v_height_m numeric;
    v_levels int;
    v_campaign_id uuid;
    v_created int := 0;
    v_updated int := 0;
    v_errors int := 0;
    v_is_new boolean;
BEGIN
    -- Process each building in the JSON array
    FOR building IN SELECT * FROM jsonb_array_elements(p_buildings)
    LOOP
        BEGIN
            v_source_id := building->>'source_id';
            v_height_m := COALESCE((building->>'height_m')::numeric, 6);
            v_levels := COALESCE((building->>'levels')::int, 2);
            v_campaign_id := CASE 
                WHEN building->>'campaign_id' IS NOT NULL 
                THEN (building->>'campaign_id')::uuid 
                ELSE NULL 
            END;
            
            -- Convert hex string to WKB and then to geometry
            v_geom := ST_GeomFromWKB(
                decode(building->>'geom_wkb_hex', 'hex'), 
                4326
            )::geometry(MultiPolygon, 4326);
            
            -- Validate and fix geometry if needed
            IF NOT ST_IsValid(v_geom) THEN
                v_geom := ST_MakeValid(v_geom)::geometry(MultiPolygon, 4326);
            END IF;
            
            -- Ensure it's still MultiPolygon after validation
            IF ST_GeometryType(v_geom) NOT IN ('ST_MultiPolygon', 'ST_Polygon') THEN
                -- Skip invalid geometry types
                v_errors := v_errors + 1;
                RAISE WARNING 'Invalid geometry type for building %: %', v_source_id, ST_GeometryType(v_geom);
                CONTINUE;
            END IF;
            
            -- Convert Polygon to MultiPolygon if needed
            IF ST_GeometryType(v_geom) = 'ST_Polygon' THEN
                v_geom := ST_Multi(v_geom)::geometry(MultiPolygon, 4326);
            END IF;
            
            -- Check if building exists to track created vs updated
            SELECT EXISTS(SELECT 1 FROM public.map_buildings WHERE source_id = v_source_id) INTO v_is_new;
            v_is_new := NOT v_is_new;
            
            -- Atomic upsert using INSERT ... ON CONFLICT
            INSERT INTO public.map_buildings (
                source_id,
                geom,
                height_m,
                levels,
                campaign_id
            )
            VALUES (
                v_source_id,
                v_geom,
                v_height_m,
                v_levels,
                v_campaign_id
            )
            ON CONFLICT (source_id) DO UPDATE SET
                geom = EXCLUDED.geom,
                height_m = EXCLUDED.height_m,
                levels = EXCLUDED.levels,
                campaign_id = COALESCE(EXCLUDED.campaign_id, map_buildings.campaign_id),
                updated_at = now();
            
            -- Track created vs updated
            IF v_is_new THEN
                v_created := v_created + 1;
            ELSE
                v_updated := v_updated + 1;
            END IF;
            
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            -- Log error but continue processing
            RAISE WARNING 'Error processing building %: %', v_source_id, SQLERRM;
        END;
    END LOOP;
    
    RETURN jsonb_build_object(
        'created', v_created,
        'updated', v_updated,
        'errors', v_errors,
        'total', jsonb_array_length(p_buildings)
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public."bump_route_plan_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  UPDATE public.route_plans
  SET route_version = COALESCE(route_version, 1) + 1,
      updated_at = now()
  WHERE id = COALESCE(NEW.route_plan_id, OLD.route_plan_id);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public."calculate_townhome_geometry"()
RETURNS void
LANGUAGE plpgsql
AS $function$

DECLARE
    v_units int;
    v_geom geometry;
    v_centroid geometry;
    v_points geometry[];
    i int;
    step float;
    angle float;
BEGIN
    -- Get geometry and unit count
    SELECT geom, units_count, centroid INTO v_geom, v_units, v_centroid
    FROM public.map_buildings WHERE id = b_id;

    IF v_units < 2 OR v_geom IS NULL THEN 
        RETURN; 
    END IF;

    -- Simplified approach: Create points along the longest axis of the building
    -- For MVP, we'll create evenly spaced points along a line through the centroid
    -- In production, this would use proper OBB (Oriented Bounding Box) calculation
    
    -- Get the longest line through the polygon (simplified)
    -- This is a placeholder - full implementation would use OBB
    v_points := ARRAY[]::geometry[];
    
    -- Create unit points along the centroid (simplified for MVP)
    -- In production, calculate proper orientation and spacing
    FOR i IN 1..v_units LOOP
        step := (i::float / (v_units + 1)::float) - 0.5;
        -- Simple offset along a line (this is simplified - real version would use proper geometry)
        -- For now, just place points at centroid (will be enhanced later)
        v_points := array_append(v_points, v_centroid);
    END LOOP;
    
    -- Update building with unit points
    UPDATE public.map_buildings 
    SET unit_points = st_collect(v_points)
    WHERE id = b_id;

    -- Note: Divider lines would be calculated here in full implementation
    -- For MVP, we skip this complex geometry calculation
END;
$function$;

CREATE OR REPLACE FUNCTION public."campaign_assignment_touch_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."campaign_contacts_view_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

DECLARE
  v_row record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.contacts (
      id,
      user_id,
      campaign_id,
      address_id,
      full_name,
      phone,
      email,
      address,
      last_contacted,
      status,
      created_at,
      updated_at,
      workspace_id
    )
    VALUES (
      COALESCE(NEW.id, gen_random_uuid()),
      auth.uid(),
      NEW.campaign_id,
      NEW.address_id,
      COALESCE(NEW.name, 'Lead'),
      NEW.phone,
      NEW.email,
      COALESCE(NEW.address, ''),
      NEW.last_contacted_at,
      COALESCE(NEW.interest_level, 'new'),
      COALESCE(NEW.created_at, now()),
      COALESCE(NEW.updated_at, now()),
      (
        SELECT c.workspace_id
        FROM public.campaigns c
        WHERE c.id = NEW.campaign_id
      )
    )
    RETURNING
      id, campaign_id, address_id, full_name, phone, email, address, last_contacted, status, created_at, updated_at
    INTO v_row;

    NEW.id := v_row.id;
    NEW.campaign_id := v_row.campaign_id;
    NEW.address_id := v_row.address_id;
    NEW.name := v_row.full_name;
    NEW.phone := v_row.phone;
    NEW.email := v_row.email;
    NEW.address := v_row.address;
    NEW.last_contacted_at := v_row.last_contacted;
    NEW.interest_level := v_row.status;
    NEW.created_at := v_row.created_at;
    NEW.updated_at := v_row.updated_at;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.contacts c
    SET
      campaign_id = NEW.campaign_id,
      address_id = NEW.address_id,
      full_name = COALESCE(NEW.name, c.full_name),
      phone = NEW.phone,
      email = NEW.email,
      address = COALESCE(NEW.address, c.address),
      last_contacted = NEW.last_contacted_at,
      status = COALESCE(NEW.interest_level, c.status),
      updated_at = COALESCE(NEW.updated_at, now()),
      workspace_id = (
        SELECT cp.workspace_id
        FROM public.campaigns cp
        WHERE cp.id = NEW.campaign_id
      )
    WHERE c.id = OLD.id
    RETURNING
      c.id, c.campaign_id, c.address_id, c.full_name, c.phone, c.email, c.address, c.last_contacted, c.status, c.created_at, c.updated_at
    INTO v_row;

    NEW.id := v_row.id;
    NEW.campaign_id := v_row.campaign_id;
    NEW.address_id := v_row.address_id;
    NEW.name := v_row.full_name;
    NEW.phone := v_row.phone;
    NEW.email := v_row.email;
    NEW.address := v_row.address;
    NEW.last_contacted_at := v_row.last_contacted;
    NEW.interest_level := v_row.status;
    NEW.created_at := v_row.created_at;
    NEW.updated_at := v_row.updated_at;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.contacts c
    WHERE c.id = OLD.id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public."can_access_route_plan"()
RETURNS boolean
LANGUAGE sql
AS $function$

  SELECT EXISTS (
    SELECT 1
    FROM public.route_plans rp
    WHERE rp.id = p_route_plan_id
      AND (
        public.has_workspace_role(rp.workspace_id, p_user_id, ARRAY['owner', 'admin'])
        OR rp.created_by_user_id = p_user_id
        OR EXISTS (
          SELECT 1
          FROM public.route_assignments ra
          WHERE ra.route_plan_id = rp.id
            AND ra.assigned_to_user_id = p_user_id
        )
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public."can_select_challenge"()
RETURNS boolean
LANGUAGE sql
AS $function$

  SELECT
    p_user_id = p_creator_id
    OR p_visibility = 'searchable'
    OR public.is_challenge_participant(p_challenge_id, p_user_id);
$function$;

CREATE OR REPLACE FUNCTION public."check_campaign_building_links"()
RETURNS record
LANGUAGE plpgsql
AS $function$

BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total_addresses,
        COUNT(ca.building_id)::BIGINT as linked_addresses,
        (COUNT(*) - COUNT(ca.building_id))::BIGINT as unlinked_addresses,
        (COUNT(ca.building_id) < COUNT(*)) as needs_linking
    FROM campaign_addresses ca
    WHERE ca.campaign_id = p_campaign_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public."check_gold_coverage"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_polygon GEOMETRY;
    v_address_count BIGINT;
    v_building_count BIGINT;
BEGIN
    v_polygon := ST_GeomFromGeoJSON(p_polygon_geojson)::GEOMETRY(Polygon, 4326);
    
    -- Count addresses
    SELECT COUNT(*) INTO v_address_count
    FROM ref_addresses_gold a
    WHERE ST_Within(a.geom, v_polygon);
    
    -- Count buildings
    SELECT COUNT(*) INTO v_building_count
    FROM ref_buildings_gold b
    WHERE ST_Intersects(b.geom, v_polygon);
    
    RETURN QUERY
    SELECT 
        v_address_count >= 10,  -- Threshold for "good coverage"
        v_address_count,
        v_building_count,
        CASE 
            WHEN v_address_count >= 100 THEN 100.0
            WHEN v_address_count >= 50 THEN 80.0
            WHEN v_address_count >= 20 THEN 60.0
            WHEN v_address_count >= 10 THEN 40.0
            ELSE (v_address_count::FLOAT / 10.0) * 40.0
        END;
END;
$function$;

CREATE OR REPLACE FUNCTION public."claim_next_dialer_session_lead"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  v_row public.dialer_session_leads;
BEGIN
  WITH next_row AS (
    SELECT dsl.id
    FROM public.dialer_session_leads dsl
    WHERE dsl.session_id = p_session_id
      AND dsl.workspace_id = p_workspace_id
      AND dsl.status = 'pending'
    ORDER BY dsl.position ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.dialer_session_leads dsl
  SET
    status = 'claimed',
    claimed_by_user_id = p_user_id,
    claimed_at = now(),
    updated_at = now()
  FROM next_row
  WHERE dsl.id = next_row.id
  RETURNING dsl.* INTO v_row;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public."clear_campaign_building_links"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
    DELETE FROM public.building_address_links
    WHERE campaign_id = p_campaign_id;

    DELETE FROM public.building_slices
    WHERE campaign_id = p_campaign_id;

    UPDATE public.campaign_addresses
    SET building_id = NULL,
        building_gers_id = NULL,
        match_source = NULL,
        confidence = NULL
    WHERE campaign_id = p_campaign_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public."clear_campaign_routes"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
    UPDATE campaign_addresses
    SET cluster_id = NULL,
        sequence = NULL,
        walk_time_sec = NULL,
        distance_m = NULL,
        route_polyline = NULL
    WHERE campaign_id = p_campaign_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public."close_stale_open_sessions"()
RETURNS integer
LANGUAGE plpgsql
AS $function$

DECLARE
    v_count integer;
    v_idle integer;
    v_max_open integer;
BEGIN
    v_idle := GREATEST(COALESCE(p_idle_hours, 8), 1);
    v_max_open := GREATEST(COALESCE(p_max_open_hours, 48), 1);

    UPDATE public.sessions s
    SET
        end_time = now(),
        doors_hit = GREATEST(COALESCE(s.doors_hit, s.completed_count, s.flyers_delivered, 0), 0)::integer,
        flyers_delivered = GREATEST(COALESCE(s.flyers_delivered, s.completed_count, 0), 0)::integer
    WHERE s.end_time IS NULL
      AND (
          s.updated_at < now() - make_interval(hours => v_idle)
          OR s.start_time < now() - make_interval(hours => v_max_open)
      );

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public."compute_deltas"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_key text;
  v_keys text[] := public.report_metric_keys();
  v_curr numeric;
  v_prev numeric;
  v_abs numeric;
  v_pct numeric;
  v_trend text;
  v_result jsonb := '{}'::jsonb;
BEGIN
  FOREACH v_key IN ARRAY v_keys LOOP
    v_curr := COALESCE((p_curr ->> v_key)::numeric, 0);
    v_prev := COALESCE((p_prev ->> v_key)::numeric, 0);
    v_abs := v_curr - v_prev;

    IF v_prev = 0 THEN
      v_pct := NULL;
    ELSE
      v_pct := round((v_abs / v_prev) * 100.0, 2);
    END IF;

    v_trend := CASE
      WHEN v_abs > 0 THEN 'up'
      WHEN v_abs < 0 THEN 'down'
      ELSE 'flat'
    END;

    v_result := v_result || jsonb_build_object(
      v_key,
      jsonb_build_object(
        'abs', v_abs,
        'pct', v_pct,
        'trend', v_trend
      )
    );
  END LOOP;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public."compute_front_bearing_for_address_building"()
RETURNS double precision
LANGUAGE plpgsql
AS $function$

DECLARE
    v_building_geom geometry;
    v_road_geom geometry;
    v_closest_point_on_road geometry;
    v_bearing double precision;
    v_road_exists boolean;
BEGIN
    -- Check if roads table exists
    SELECT EXISTS (
        SELECT 1 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'roads'
    ) INTO v_road_exists;

    IF NOT v_road_exists THEN
        -- Roads table doesn't exist, return 0 (no rotation)
        RAISE WARNING 'roads table does not exist, returning 0 for front_bearing';
        RETURN 0;
    END IF;

    -- Get building geometry
    SELECT geom
    INTO v_building_geom
    FROM public.address_buildings
    WHERE id = p_building_id;

    IF v_building_geom IS NULL THEN
        RETURN 0;
    END IF;

    -- Find nearest road to the building centroid
    SELECT r.geom
    INTO v_road_geom
    FROM public.roads r
    ORDER BY r.geom <-> ST_Centroid(v_building_geom)
    LIMIT 1;

    IF v_road_geom IS NULL THEN
        RETURN 0;
    END IF;

    -- Find closest point on the road to the building
    SELECT ST_ClosestPoint(v_road_geom, ST_Centroid(v_building_geom))
    INTO v_closest_point_on_road;

    -- Take a small segment of the road around that closest point for direction
    -- If the road is a LineString, we can interpolate a point slightly "ahead"
    -- along the line and compute the azimuth between them.
    v_bearing := degrees(
        ST_Azimuth(
            v_closest_point_on_road,
            ST_LineInterpolatePoint(
                v_road_geom,
                LEAST(1.0, GREATEST(0.0, ST_LineLocatePoint(v_road_geom, v_closest_point_on_road) + 0.001))
            )
        )
    );

    -- Normalize to 0–360
    IF v_bearing < 0 THEN
        v_bearing := v_bearing + 360;
    END IF;

    -- Persist on address_buildings
    UPDATE public.address_buildings
    SET front_bearing = v_bearing
    WHERE id = p_building_id;

    RETURN v_bearing;
END;
$function$;

CREATE OR REPLACE FUNCTION public."compute_team_metrics"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_doors_knocked bigint := 0;
  v_flyers_delivered bigint := 0;
  v_conversations bigint := 0;
  v_leads_created bigint := 0;
  v_appointments_set bigint := 0;
  v_time_spent_seconds bigint := 0;
  v_sessions_count bigint := 0;
BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT
          COALESCE(SUM(COALESCE(ss.doors_hit, 0)), 0)::bigint,
          COALESCE(SUM(COALESCE(ss.flyers_delivered, 0)), 0)::bigint,
          COALESCE(SUM(COALESCE(ss.conversations, 0)), 0)::bigint,
          COALESCE(SUM(COALESCE(ss.active_seconds, 0)), 0)::bigint,
          COUNT(ss.id)::bigint
        FROM public.sessions ss
        WHERE ss.workspace_id = $1
          AND ss.start_time >= $2
          AND ss.start_time < $3
      $q$
      INTO
        v_doors_knocked,
        v_flyers_delivered,
        v_conversations,
        v_time_spent_seconds,
        v_sessions_count
      USING p_workspace_id, p_start_ts, p_end_ts;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
    END;
  ELSIF to_regclass('public.field_sessions') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT
          COALESCE(SUM(COALESCE((fs.stats ->> 'doors_knocked')::int, 0)), 0)::bigint,
          COALESCE(SUM(COALESCE((fs.stats ->> 'flyers_delivered')::int, 0)), 0)::bigint,
          COALESCE(SUM(COALESCE((fs.stats ->> 'conversations')::int, 0)), 0)::bigint,
          COALESCE(SUM(COALESCE(fs.duration_seconds, 0)), 0)::bigint,
          COUNT(fs.id)::bigint
        FROM public.field_sessions fs
        WHERE fs.workspace_id = $1
          AND fs.started_at >= $2
          AND fs.started_at < $3
      $q$
      INTO
        v_doors_knocked,
        v_flyers_delivered,
        v_conversations,
        v_time_spent_seconds,
        v_sessions_count
      USING p_workspace_id, p_start_ts, p_end_ts;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
    END;
  END IF;

  IF to_regclass('public.contacts') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT COUNT(*)::bigint
        FROM public.contacts c
        WHERE c.workspace_id = $1
          AND c.created_at >= $2
          AND c.created_at < $3
      $q$
      INTO v_leads_created
      USING p_workspace_id, p_start_ts, p_end_ts;

      EXECUTE $q$
        SELECT COUNT(*)::bigint
        FROM public.contacts c
        WHERE c.workspace_id = $1
          AND c.created_at >= $2
          AND c.created_at < $3
          AND lower(COALESCE(c.status, '')) IN ('appointment', 'appointments_set', 'appointment_set')
      $q$
      INTO v_appointments_set
      USING p_workspace_id, p_start_ts, p_end_ts;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
    END;
  ELSIF to_regclass('public.field_leads') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT COUNT(*)::bigint
        FROM public.field_leads fl
        WHERE fl.workspace_id = $1
          AND fl.created_at >= $2
          AND fl.created_at < $3
      $q$
      INTO v_leads_created
      USING p_workspace_id, p_start_ts, p_end_ts;

      EXECUTE $q$
        SELECT COUNT(*)::bigint
        FROM public.field_leads fl
        WHERE fl.workspace_id = $1
          AND fl.created_at >= $2
          AND fl.created_at < $3
          AND lower(COALESCE(fl.status, '')) IN ('appointment', 'appointments_set', 'appointment_set')
      $q$
      INTO v_appointments_set
      USING p_workspace_id, p_start_ts, p_end_ts;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
    END;
  ELSIF to_regclass('public.campaign_contacts') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT COUNT(*)::bigint
        FROM public.campaign_contacts cc
        JOIN public.campaigns c ON c.id = cc.campaign_id
        WHERE c.workspace_id = $1
          AND cc.created_at >= $2
          AND cc.created_at < $3
      $q$
      INTO v_leads_created
      USING p_workspace_id, p_start_ts, p_end_ts;

      EXECUTE $q$
        SELECT COUNT(*)::bigint
        FROM public.campaign_contacts cc
        JOIN public.campaigns c ON c.id = cc.campaign_id
        WHERE c.workspace_id = $1
          AND cc.created_at >= $2
          AND cc.created_at < $3
          AND lower(COALESCE(cc.interest_level, '')) IN ('appointment', 'appointments_set', 'appointment_set')
      $q$
      INTO v_appointments_set
      USING p_workspace_id, p_start_ts, p_end_ts;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
    END;
  END IF;

  IF v_appointments_set = 0 AND to_regclass('public.session_events') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT COUNT(*)::bigint
        FROM public.session_events se
        WHERE se.workspace_id = $1
          AND se.event_time >= $2
          AND se.event_time < $3
          AND lower(COALESCE(se.event_type, '')) IN ('appointment', 'appointment_set', 'appointments_set')
      $q$
      INTO v_appointments_set
      USING p_workspace_id, p_start_ts, p_end_ts;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'doors_knocked', COALESCE(v_doors_knocked, 0),
    'flyers_delivered', COALESCE(v_flyers_delivered, 0),
    'conversations', COALESCE(v_conversations, 0),
    'leads_created', COALESCE(v_leads_created, 0),
    'appointments_set', COALESCE(v_appointments_set, 0),
    'time_spent_seconds', COALESCE(v_time_spent_seconds, 0),
    'sessions_count', COALESCE(v_sessions_count, 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."compute_user_metrics"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_doors_knocked bigint := 0;
  v_flyers_delivered bigint := 0;
  v_conversations bigint := 0;
  v_leads_created bigint := 0;
  v_appointments_set bigint := 0;
  v_time_spent_seconds bigint := 0;
  v_sessions_count bigint := 0;
BEGIN
  IF to_regclass('public.sessions') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT
          COALESCE(SUM(COALESCE(ss.doors_hit, 0)), 0)::bigint,
          COALESCE(SUM(COALESCE(ss.flyers_delivered, 0)), 0)::bigint,
          COALESCE(SUM(COALESCE(ss.conversations, 0)), 0)::bigint,
          COALESCE(SUM(COALESCE(ss.active_seconds, 0)), 0)::bigint,
          COUNT(ss.id)::bigint
        FROM public.sessions ss
        WHERE ss.workspace_id = $1
          AND ss.user_id = $2
          AND ss.start_time >= $3
          AND ss.start_time < $4
      $q$
      INTO
        v_doors_knocked,
        v_flyers_delivered,
        v_conversations,
        v_time_spent_seconds,
        v_sessions_count
      USING p_workspace_id, p_user_id, p_start_ts, p_end_ts;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
    END;
  ELSIF to_regclass('public.field_sessions') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT
          COALESCE(SUM(COALESCE((fs.stats ->> 'doors_knocked')::int, 0)), 0)::bigint,
          COALESCE(SUM(COALESCE((fs.stats ->> 'flyers_delivered')::int, 0)), 0)::bigint,
          COALESCE(SUM(COALESCE((fs.stats ->> 'conversations')::int, 0)), 0)::bigint,
          COALESCE(SUM(COALESCE(fs.duration_seconds, 0)), 0)::bigint,
          COUNT(fs.id)::bigint
        FROM public.field_sessions fs
        WHERE fs.workspace_id = $1
          AND fs.user_id = $2
          AND fs.started_at >= $3
          AND fs.started_at < $4
      $q$
      INTO
        v_doors_knocked,
        v_flyers_delivered,
        v_conversations,
        v_time_spent_seconds,
        v_sessions_count
      USING p_workspace_id, p_user_id, p_start_ts, p_end_ts;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
    END;
  END IF;

  IF to_regclass('public.contacts') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT COUNT(*)::bigint
        FROM public.contacts c
        WHERE c.workspace_id = $1
          AND c.user_id = $2
          AND c.created_at >= $3
          AND c.created_at < $4
      $q$
      INTO v_leads_created
      USING p_workspace_id, p_user_id, p_start_ts, p_end_ts;

      EXECUTE $q$
        SELECT COUNT(*)::bigint
        FROM public.contacts c
        WHERE c.workspace_id = $1
          AND c.user_id = $2
          AND c.created_at >= $3
          AND c.created_at < $4
          AND lower(COALESCE(c.status, '')) IN ('appointment', 'appointments_set', 'appointment_set')
      $q$
      INTO v_appointments_set
      USING p_workspace_id, p_user_id, p_start_ts, p_end_ts;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
    END;
  ELSIF to_regclass('public.field_leads') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT COUNT(*)::bigint
        FROM public.field_leads fl
        WHERE fl.workspace_id = $1
          AND fl.user_id = $2
          AND fl.created_at >= $3
          AND fl.created_at < $4
      $q$
      INTO v_leads_created
      USING p_workspace_id, p_user_id, p_start_ts, p_end_ts;

      EXECUTE $q$
        SELECT COUNT(*)::bigint
        FROM public.field_leads fl
        WHERE fl.workspace_id = $1
          AND fl.user_id = $2
          AND fl.created_at >= $3
          AND fl.created_at < $4
          AND lower(COALESCE(fl.status, '')) IN ('appointment', 'appointments_set', 'appointment_set')
      $q$
      INTO v_appointments_set
      USING p_workspace_id, p_user_id, p_start_ts, p_end_ts;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
    END;
  END IF;

  IF v_appointments_set = 0 AND to_regclass('public.session_events') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT COUNT(*)::bigint
        FROM public.session_events se
        WHERE se.workspace_id = $1
          AND se.user_id = $2
          AND se.event_time >= $3
          AND se.event_time < $4
          AND lower(COALESCE(se.event_type, '')) IN ('appointment', 'appointment_set', 'appointments_set')
      $q$
      INTO v_appointments_set
      USING p_workspace_id, p_user_id, p_start_ts, p_end_ts;
    EXCEPTION
      WHEN undefined_column THEN
        NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'doors_knocked', COALESCE(v_doors_knocked, 0),
    'flyers_delivered', COALESCE(v_flyers_delivered, 0),
    'conversations', COALESCE(v_conversations, 0),
    'leads_created', COALESCE(v_leads_created, 0),
    'appointments_set', COALESCE(v_appointments_set, 0),
    'time_spent_seconds', COALESCE(v_time_spent_seconds, 0),
    'sessions_count', COALESCE(v_sessions_count, 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."count_challenge_rolling_participants"()
RETURNS integer
LANGUAGE sql
AS $function$

    SELECT COUNT(*)::integer
    FROM (
        SELECT s.user_id
        FROM public.sessions s
        WHERE s.end_time IS NOT NULL
          AND s.start_time >= now() - interval '30 days'
        GROUP BY s.user_id
        HAVING SUM(GREATEST(COALESCE(s.doors_hit, s.completed_count, s.flyers_delivered, 0), 0)) > 0
    ) t;
$function$;

CREATE OR REPLACE FUNCTION public."current_user_workspace_ids"()
RETURNS ARRAY
LANGUAGE sql
AS $function$

  SELECT COALESCE(array_agg(wm.workspace_id), '{}'::uuid[])
  FROM public.workspace_members wm
  WHERE wm.user_id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public."debug_building_data"()
RETURNS record
LANGUAGE plpgsql
AS $function$

BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::bigint as total_buildings,
        COUNT(b.gers_id)::bigint as buildings_with_gers_id,
        COUNT(l.id)::bigint as buildings_with_links,
        COUNT(s.building_id)::bigint as buildings_with_stats,
        ARRAY_AGG(DISTINCT b.gers_id::text) FILTER (WHERE b.gers_id IS NOT NULL) as sample_gers_ids
    FROM public.buildings b
    LEFT JOIN public.building_address_links l ON b.id = l.building_id
    LEFT JOIN public.building_stats s ON LOWER(b.gers_id::text) = LOWER(s.gers_id::text)
    WHERE b.campaign_id = p_campaign_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public."ensure_farm_touch_for_cycle"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_result public.farm_touches%ROWTYPE;
    v_order_index integer := 0;
    v_touch_type text := COALESCE(NULLIF(trim(p_touch_type), ''), 'flyer');
    v_touch_title text := COALESCE(NULLIF(trim(p_touch_title), ''), format('Cycle %s', p_cycle_number));
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_farm_id IS NULL OR p_cycle_number IS NULL OR p_campaign_id IS NULL THEN
        RAISE EXCEPTION 'farm id, cycle number, and campaign id are required';
    END IF;

    IF v_touch_type NOT IN ('flyer', 'door_knock', 'event', 'newsletter', 'ad', 'custom') THEN
        RAISE EXCEPTION 'Unsupported touch type: %', v_touch_type;
    END IF;

    PERFORM 1
    FROM public.farms f
    WHERE f.id = p_farm_id
      AND (
          f.owner_id = auth.uid()
          OR (f.workspace_id IS NOT NULL AND public.is_workspace_member(f.workspace_id))
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Farm not found or access denied';
    END IF;

    SELECT ft.*
    INTO v_result
    FROM public.farm_touches ft
    WHERE ft.farm_id = p_farm_id
      AND ft.cycle_number = p_cycle_number
      AND ft.campaign_id = p_campaign_id
    ORDER BY ft.date ASC, ft.created_at ASC, ft.id ASC
    LIMIT 1;

    IF FOUND THEN
        RETURN v_result;
    END IF;

    WITH reusable_touch AS (
        SELECT ft.id
        FROM public.farm_touches ft
        WHERE ft.farm_id = p_farm_id
          AND ft.cycle_number = p_cycle_number
          AND ft.campaign_id IS NULL
        ORDER BY ft.date ASC, ft.created_at ASC, ft.id ASC
        LIMIT 1
        FOR UPDATE
    )
    UPDATE public.farm_touches ft
    SET campaign_id = p_campaign_id
    FROM reusable_touch
    WHERE ft.id = reusable_touch.id
    RETURNING ft.* INTO v_result;

    IF FOUND THEN
        RETURN v_result;
    END IF;

    SELECT COALESCE(MAX(ft.order_index), -1) + 1
    INTO v_order_index
    FROM public.farm_touches ft
    WHERE ft.farm_id = p_farm_id
      AND ft.cycle_number = p_cycle_number;

    INSERT INTO public.farm_touches (
        farm_id,
        cycle_number,
        date,
        type,
        title,
        order_index,
        completed,
        campaign_id
    )
    VALUES (
        p_farm_id,
        p_cycle_number,
        COALESCE(p_touch_date, CURRENT_DATE),
        v_touch_type,
        v_touch_title,
        v_order_index,
        false,
        p_campaign_id
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public."feedback_mark_read"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
  IF NOT public.is_founder() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.feedback_threads
  SET unread_for_founder = false,
      updated_at = now()
  WHERE id = p_thread_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public."feedback_on_item_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  UPDATE public.feedback_threads
  SET
    last_feedback_at = COALESCE(NEW.created_at, now()),
    unread_for_founder = true,
    updated_at = now()
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."find_nearest_street_segment_with_geom"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT
    ST_X(ST_StartPoint(t.geom))::double precision AS lon1,
    ST_Y(ST_StartPoint(t.geom))::double precision AS lat1,
    ST_X(ST_EndPoint(t.geom))::double precision AS lon2,
    ST_Y(ST_EndPoint(t.geom))::double precision AS lat2,
    ST_Distance(t.geom::geography, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography)::double precision AS distance_m,
    t.id AS segment_id,
    t.class,
    t.subclass,
    ST_AsGeoJSON(t.geom)::jsonb AS geom_geojson
  FROM public.overture_transportation t
  WHERE t.class IN ('residential', 'tertiary', 'secondary', 'primary', 'unclassified')
    AND ST_DWithin(
      t.geom::geography,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
      p_radius_m
    )
  ORDER BY
    (CASE t.class
      WHEN 'residential' THEN 0
      WHEN 'tertiary' THEN 1
      WHEN 'secondary' THEN 2
      WHEN 'primary' THEN 3
      WHEN 'unclassified' THEN 4
      ELSE 5
    END),
    ST_Distance(t.geom::geography, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography)
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public."find_nearest_transportation"()
RETURNS record
LANGUAGE plpgsql
AS $function$

BEGIN
  RETURN QUERY
  SELECT 
    t.gers_id,
    t.geom,
    t.class,
    ST_Distance(
      t.geom::geography,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
    ) as distance
  FROM public.overture_transportation t
  WHERE ST_DWithin(
    t.geom::geography,
    ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
    p_radius
  )
  ORDER BY distance
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public."find_nearest_walkway_segment_with_geom"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT
    ST_X(ST_StartPoint(t.geom))::double precision AS lon1,
    ST_Y(ST_StartPoint(t.geom))::double precision AS lat1,
    ST_X(ST_EndPoint(t.geom))::double precision AS lon2,
    ST_Y(ST_EndPoint(t.geom))::double precision AS lat2,
    ST_Distance(t.geom::geography, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography)::double precision AS distance_m,
    t.id AS segment_id,
    t.class,
    t.subclass,
    ST_AsGeoJSON(t.geom)::jsonb AS geom_geojson
  FROM public.overture_transportation t
  WHERE t.class IN ('footway', 'path', 'pedestrian', 'steps')
    AND ST_DWithin(
      t.geom::geography,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
      p_radius_m
    )
  ORDER BY
    (CASE WHEN t.subclass IN ('sidewalk', 'crosswalk') THEN 0 ELSE 1 END),
    ST_Distance(t.geom::geography, ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography)
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public."fn_addr_nearest"()
RETURNS record
LANGUAGE sql
AS $function$

  select
    full_address, street_number, street_name, city, province, postal_code, source,
    ST_AsGeoJSON(geom)::text
  from public.addresses_best
  where geom is not null
    and (p_province is null or province = p_province)
  order by geom <-> ST_SetSRID(ST_MakePoint(p_lon, p_lat),4326)
  limit greatest(1,p_limit);
$function$;

CREATE OR REPLACE FUNCTION public."fn_addr_nearest_v2"()
RETURNS record
LANGUAGE plpgsql
AS $function$

begin
  perform set_config('statement_timeout','5000', true);

  return query
  with origin as (
    select 
      st_setsrid(st_makepoint(p_lon, p_lat), 4326)            as g4326,
      st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography as geog
  )
  select
    u.address_id,
    u.full_address,
    u.street_number::text as street_no,
    u.street_name::text   as street_name,
    u.city::text          as city,
    u.province,
    u.postal_code::text   as postal_code,
    st_distance(u.geom::geography, o.geog) as distance_m,
    st_y(u.geom) as lat,
    st_x(u.geom) as lon
  from public.addresses_unified u
  cross join origin o
  where (p_province is null or u.province = p_province)
    and st_srid(u.geom) in (0,4326)
  order by u.geom <-> o.g4326
  limit greatest(1, p_limit);
end;
$function$;

CREATE OR REPLACE FUNCTION public."fn_addr_nearest_v3"()
RETURNS record
LANGUAGE sql
AS $function$

  WITH origin AS (
    SELECT ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326) AS g4326
  )
  SELECT
    u.address_id,
    u.full_address,
    u.street_number::text AS street_no,
    u.street_name::text   AS street_name,
    u.city::text          AS city,
    u.province,
    u.postal_code::text   AS postal_code,
    -- compute distance AFTER limit using geometry, not geography
    ST_Distance(u.geom, o.g4326) * 111320 AS distance_m,
    ST_Y(u.geom) AS lat,
    ST_X(u.geom) AS lon
  FROM public.addresses_unified u
  CROSS JOIN origin o
  WHERE (p_province IS NULL OR u.province = p_province)
    AND ST_SRID(u.geom) = 4326
  ORDER BY u.geom <-> o.g4326
  LIMIT GREATEST(1, p_limit);
$function$;

CREATE OR REPLACE FUNCTION public."fn_addr_same_street"()
RETURNS record
LANGUAGE sql
AS $function$

  select
    full_address, street_number, street_name, city, province, postal_code, source,
    ST_AsGeoJSON(geom)::text
  from public.addresses_best
  where geom is not null
    and upper(street_name) = upper(p_street)
    and (p_city is null or upper(city) = upper(p_city))
    and (p_province is null or province = p_province)
  order by geom <-> ST_SetSRID(ST_MakePoint(p_lon, p_lat),4326)
  limit greatest(1,p_limit);
$function$;

CREATE OR REPLACE FUNCTION public."fn_oda_on_nearest"()
RETURNS record
LANGUAGE sql
AS $function$

  select
    full_address, street_number, street_name, city, postal_code,
    ST_AsGeoJSON(geom)::text
  from public.oda_addresses
  where province='ON' and geom is not null
  order by geom <-> ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
  limit greatest(1,p_limit);
$function$;

CREATE OR REPLACE FUNCTION public."fn_oda_on_same_street"()
RETURNS record
LANGUAGE sql
AS $function$

  select
    full_address, street_number, street_name, city, postal_code,
    ST_AsGeoJSON(geom)::text
  from public.oda_addresses
  where province='ON'
    and geom is not null
    and upper(street_name)=upper(p_street)
    and (p_city is null or upper(city)=upper(p_city))
  order by geom <-> ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
  limit greatest(1,p_limit);
$function$;

CREATE OR REPLACE FUNCTION public."fn_upsert_building_polygon"()
RETURNS void
LANGUAGE sql
AS $function$

  INSERT INTO building_polygons (address_id, geom, geom_geom, area_m2, source)
  VALUES (
    p_address_id,
    p_geom_json,
    ST_Force2D(ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(p_geom_json->>'geometry'), 4326))),
    COALESCE(
      (p_geom_json->'properties'->>'area_m2')::double precision,
      (SELECT ST_Area(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(p_geom_json->>'geometry'), 4326), 3857)))
    ),
    COALESCE((p_geom_json->'properties'->>'source')::text, 'mapbox_mvt')
  )
  ON CONFLICT (address_id) DO UPDATE
  SET 
    geom = excluded.geom,
    geom_geom = excluded.geom_geom,
    area_m2 = excluded.area_m2,
    source = excluded.source,
    updated_at = now();
$function$;

CREATE OR REPLACE FUNCTION public."fn_upsert_campaign_building"()
RETURNS void
LANGUAGE plpgsql
AS $function$

DECLARE
    v_geometry GEOMETRY(Polygon, 4326);
BEGIN
    -- Validate source parameter
    IF p_source NOT IN ('mapbox', 'split-generated') THEN
        RAISE EXCEPTION 'Invalid source value: %. Must be ''mapbox'' or ''split-generated''', p_source;
    END IF;

    -- Convert GeoJSON geometry to PostGIS geometry
    -- Handle both Polygon and MultiPolygon (take first polygon from MultiPolygon)
    IF p_geom_json->>'type' = 'Polygon' THEN
        v_geometry := ST_SetSRID(ST_GeomFromGeoJSON(p_geom_json::text), 4326);
    ELSIF p_geom_json->>'type' = 'MultiPolygon' THEN
        -- Extract first polygon from MultiPolygon
        v_geometry := ST_SetSRID(
            ST_GeomFromGeoJSON(
                jsonb_build_object(
                    'type', 'Polygon',
                    'coordinates', (p_geom_json->'coordinates'->0)
                )::text
            ),
            4326
        );
    ELSE
        RAISE EXCEPTION 'Unsupported geometry type: %', p_geom_json->>'type';
    END IF;

    -- Ensure it's a Polygon (not MultiPolygon)
    IF ST_GeometryType(v_geometry) != 'ST_Polygon' THEN
        RAISE EXCEPTION 'Geometry must be a Polygon, got: %', ST_GeometryType(v_geometry);
    END IF;

    -- Upsert into campaign_buildings
    INSERT INTO public.campaign_buildings (
        campaign_id,
        address_id,
        building_id,
        geometry,
        height_m,
        min_height_m,
        source
    )
    VALUES (
        p_campaign_id,
        p_address_id,
        p_building_id,
        v_geometry,
        p_height_m,
        p_min_height_m,
        p_source
    )
    ON CONFLICT (address_id) DO UPDATE
    SET
        building_id = EXCLUDED.building_id,
        geometry = EXCLUDED.geometry,
        height_m = EXCLUDED.height_m,
        min_height_m = EXCLUDED.min_height_m,
        source = EXCLUDED.source,
        updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public."generate_due_reports"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_workspace record;
  v_window record;
  v_run_id uuid;
  v_workspace_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_workspaces_scanned int := 0;
  v_windows_due int := 0;
  v_windows_run int := 0;
BEGIN
  FOR v_workspace IN
    SELECT w.id, COALESCE(NULLIF(btrim(w.timezone), ''), 'UTC') AS timezone
    FROM public.workspaces w
  LOOP
    v_workspaces_scanned := v_workspaces_scanned + 1;

    FOR v_window IN
      SELECT *
      FROM public.get_reporting_windows(v_workspace.timezone, p_now)
    LOOP
      IF NOT COALESCE(v_window.is_due, false) THEN
        CONTINUE;
      END IF;

      v_windows_due := v_windows_due + 1;

      v_run_id := NULL;

      INSERT INTO public.report_runs (
        workspace_id,
        period,
        period_start,
        period_end
      )
      VALUES (
        v_workspace.id,
        v_window.period,
        v_window.period_start,
        v_window.period_end
      )
      ON CONFLICT (workspace_id, period, period_start, period_end)
      DO NOTHING
      RETURNING id INTO v_run_id;

      IF v_run_id IS NULL THEN
        CONTINUE;
      END IF;

      v_windows_run := v_windows_run + 1;

      BEGIN
        v_workspace_result := public.generate_workspace_reports(
          v_workspace.id,
          v_window.period,
          v_window.period_start,
          v_window.period_end,
          v_window.previous_period_start,
          v_window.previous_period_end
        );

        v_results := v_results || jsonb_build_array(v_workspace_result);
      EXCEPTION
        WHEN OTHERS THEN
          DELETE FROM public.report_runs rr
          WHERE rr.id = v_run_id;

          v_results := v_results || jsonb_build_array(
            jsonb_build_object(
              'workspace_id', v_workspace.id,
              'period', v_window.period,
              'period_start', v_window.period_start,
              'period_end', v_window.period_end,
              'error', SQLERRM
            )
          );
      END;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'workspaces_scanned', v_workspaces_scanned,
    'windows_due', v_windows_due,
    'windows_run', v_windows_run,
    'results', v_results
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."generate_workspace_reports"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_member record;
  v_owner record;
  v_curr jsonb;
  v_prev jsonb;
  v_deltas jsonb;
  v_report_id uuid;
  v_member_reports_created int := 0;
  v_team_reports_created int := 0;
  v_notifications_created int := 0;
  v_title text := format('Your %s report is ready', p_period);
BEGIN
  -- Member reports + member notifications
  FOR v_member IN
    SELECT wm.user_id
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
  LOOP
    v_report_id := NULL;
    v_curr := public.compute_user_metrics(p_workspace_id, v_member.user_id, p_period_start, p_period_end);
    v_prev := public.compute_user_metrics(p_workspace_id, v_member.user_id, p_prev_start, p_prev_end);
    v_deltas := public.compute_deltas(v_curr, v_prev);

    INSERT INTO public.reports (
      workspace_id,
      scope,
      owner_user_id,
      subject_user_id,
      period,
      period_start,
      period_end,
      metrics,
      deltas
    )
    VALUES (
      p_workspace_id,
      'member',
      NULL,
      v_member.user_id,
      p_period,
      p_period_start,
      p_period_end,
      v_curr,
      v_deltas
    )
    ON CONFLICT (workspace_id, scope, owner_user_key, subject_user_key, period, period_start, period_end)
    DO NOTHING
    RETURNING id INTO v_report_id;

    IF v_report_id IS NOT NULL THEN
      v_member_reports_created := v_member_reports_created + 1;

      INSERT INTO public.notifications (
        workspace_id,
        user_id,
        type,
        title,
        body,
        data
      )
      VALUES (
        p_workspace_id,
        v_member.user_id,
        'report_ready',
        v_title,
        v_title,
        jsonb_build_object(
          'report_id', v_report_id,
          'period', p_period,
          'scope', 'member'
        )
      );

      v_notifications_created := v_notifications_created + 1;
    END IF;
  END LOOP;

  -- Team report per owner + owner notifications
  FOR v_owner IN
    SELECT wm.user_id
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.role = 'owner'
  LOOP
    v_report_id := NULL;
    v_curr := public.compute_team_metrics(p_workspace_id, p_period_start, p_period_end);
    v_prev := public.compute_team_metrics(p_workspace_id, p_prev_start, p_prev_end);
    v_deltas := public.compute_deltas(v_curr, v_prev);

    INSERT INTO public.reports (
      workspace_id,
      scope,
      owner_user_id,
      subject_user_id,
      period,
      period_start,
      period_end,
      metrics,
      deltas
    )
    VALUES (
      p_workspace_id,
      'team',
      v_owner.user_id,
      NULL,
      p_period,
      p_period_start,
      p_period_end,
      v_curr,
      v_deltas
    )
    ON CONFLICT (workspace_id, scope, owner_user_key, subject_user_key, period, period_start, period_end)
    DO NOTHING
    RETURNING id INTO v_report_id;

    IF v_report_id IS NOT NULL THEN
      v_team_reports_created := v_team_reports_created + 1;

      INSERT INTO public.notifications (
        workspace_id,
        user_id,
        type,
        title,
        body,
        data
      )
      VALUES (
        p_workspace_id,
        v_owner.user_id,
        'report_ready',
        v_title,
        format('Your team''s %s report is ready', p_period),
        jsonb_build_object(
          'report_id', v_report_id,
          'period', p_period,
          'scope', 'team'
        )
      );

      v_notifications_created := v_notifications_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'workspace_id', p_workspace_id,
    'period', p_period,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'member_reports_created', v_member_reports_created,
    'team_reports_created', v_team_reports_created,
    'notifications_created', v_notifications_created
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_address_scan_count"()
RETURNS bigint
LANGUAGE plpgsql
AS $function$

begin
  return (
    select count(*)::bigint
    from public.qr_code_scans
    where address_id = p_address_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public."get_addresses_in_polygon"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_polygon geometry;
BEGIN
    v_polygon := ST_SetSRID(ST_GeomFromGeoJSON(p_polygon_geojson), 4326);

    RETURN QUERY
    SELECT
        ca.id,
        ca.campaign_id,
        ca.formatted,
        ca.postal_code,
        ca.source,
        ca.seq,
        ca.visited,
        ST_AsGeoJSON(ca.geom, 6)::jsonb AS geom_json,
        ca.created_at
    FROM public.campaign_addresses ca
    WHERE ca.geom IS NOT NULL
      AND ST_Covers(v_polygon, ca.geom)
    ORDER BY ca.seq NULLS LAST, ca.created_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_agent_report"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_start timestamptz;
  v_end timestamptz := now();
  v_knocks int := 0;
  v_convos int := 0;
  v_followups int := 0;
  v_appointments int := 0;
  v_sessions_count int := 0;
  v_active_days int := 0;
  v_result jsonb;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) AND p_user_id != auth.uid() THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  IF p_workspace_id != ANY(public.current_user_workspace_ids()) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_start := CASE p_period
    WHEN 'weekly'  THEN date_trunc('week', v_end)
    WHEN 'monthly' THEN date_trunc('month', v_end)
    WHEN 'yearly'  THEN date_trunc('year', v_end)
    ELSE date_trunc('week', v_end)
  END;

  SELECT
    COALESCE(SUM((fs.stats->>'doors_knocked')::int), 0),
    COALESCE(SUM((fs.stats->>'conversations')::int), 0),
    COALESCE(SUM((fs.stats->>'followups')::int), 0),
    COALESCE(SUM((fs.stats->>'appointments')::int), 0),
    COUNT(fs.id),
    COUNT(DISTINCT date_trunc('day', fs.started_at)::date)
  INTO v_knocks, v_convos, v_followups, v_appointments, v_sessions_count, v_active_days
  FROM public.field_sessions fs
  WHERE fs.workspace_id = p_workspace_id
    AND fs.user_id = p_user_id
    AND fs.started_at >= v_start
    AND fs.started_at <= v_end;

  v_result := jsonb_build_object(
    'knocks', v_knocks,
    'conversations', v_convos,
    'followups', v_followups,
    'appointments', v_appointments,
    'sessions_count', v_sessions_count,
    'avg_knocks_per_session', CASE WHEN v_sessions_count > 0 THEN round(v_knocks::numeric / v_sessions_count, 1) ELSE 0 END,
    'active_days', v_active_days,
    'period_start', v_start,
    'period_end', v_end
  );
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_blender_addresses"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT
    a.id,
    a.formatted::text,
    a.street_name::text,
    a.house_number::text,
    'none'::text AS lead_status,
    a.visited,
    a.building_id,
    a.seq::integer,
    ST_AsGeoJSON(a.geom)::text AS geom_geojson
  FROM public.campaign_addresses a
  WHERE a.campaign_id = p_campaign_id
    AND a.geom IS NOT NULL
  ORDER BY a.seq ASC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public."get_blender_context_buildings"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT DISTINCT ON (b.id)
    b.id,
    b.external_id::text,
    ST_AsGeoJSON(ST_SimplifyPreserveTopology(b.geom, p_simplify_tolerance))::text AS geom_geojson,
    b.height_m::double precision,
    b.floors::integer,
    b.building_type::text
  FROM public.ref_buildings_gold b
  INNER JOIN public.campaigns c ON c.id = p_campaign_id
  WHERE ST_Intersects(
    b.geom,
    ST_Buffer(c.territory_boundary::geography, p_padding_meters)::geometry
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.campaign_addresses ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id = b.id
  )
  ORDER BY b.id
  LIMIT 2000;
$function$;

CREATE OR REPLACE FUNCTION public."get_blender_roads"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT
    COALESCE(r.road_id::text, r.id::text)::text AS road_id,
    COALESCE(r.road_name, '')::text AS road_name,
    COALESCE(NULLIF(BTRIM(COALESCE(r.road_class::text, '')), ''), 'street')::text AS road_class,
    ST_AsGeoJSON(r.geom)::text AS geom_geojson
  FROM public.campaign_roads r
  WHERE r.campaign_id = p_campaign_id;
$function$;

CREATE OR REPLACE FUNCTION public."get_blender_target_buildings"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT DISTINCT ON (b.id)
    b.id,
    b.external_id::text,
    ST_AsGeoJSON(b.geom)::text AS geom_geojson,
    ca.formatted::text AS address,
    ca.street_name::text,
    ca.house_number::text,
    -- lead_status: use literal until address_statuses FK matches repo (campaign_address_id vs address_id, etc.)
    'none'::text AS lead_status,
    ca.visited,
    b.height_m::double precision,
    b.floors::integer,
    b.building_type::text
  FROM public.campaign_addresses ca
  INNER JOIN public.ref_buildings_gold b ON ca.building_id = b.id
  WHERE ca.campaign_id = p_campaign_id
    AND ca.building_id IS NOT NULL
  ORDER BY b.id, ca.seq NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public."get_brokerage_leaderboard"()
RETURNS record
LANGUAGE plpgsql
AS $function$

BEGIN
  IF timeframe = 'month' THEN
    RETURN QUERY
    SELECT
      r.brokerage_key,
      r.display_name,
      r.flyers,
      r.conversations,
      r.leads,
      r.distance,
      r.time_minutes,
      r.day_streak,
      r.best_streak,
      r.agent_count,
      (ROW_NUMBER() OVER (
        ORDER BY
          CASE sort_by
            WHEN 'flyers'        THEN r.flyers::NUMERIC
            WHEN 'conversations' THEN r.conversations::NUMERIC
            WHEN 'leads'         THEN r.leads::NUMERIC
            WHEN 'distance'     THEN r.distance::NUMERIC
            WHEN 'time'         THEN r.time_minutes::NUMERIC
            WHEN 'day_streak'   THEN r.day_streak::NUMERIC
            WHEN 'best_streak'  THEN r.best_streak::NUMERIC
            ELSE                     r.flyers::NUMERIC
          END DESC NULLS LAST
      ))::INTEGER AS rank,
      r.updated_at
    FROM public.ranking_brokerages_month r
    ORDER BY
      CASE sort_by
        WHEN 'flyers'        THEN r.flyers::NUMERIC
        WHEN 'conversations' THEN r.conversations::NUMERIC
        WHEN 'leads'         THEN r.leads::NUMERIC
        WHEN 'distance'     THEN r.distance::NUMERIC
        WHEN 'time'         THEN r.time_minutes::NUMERIC
        WHEN 'day_streak'   THEN r.day_streak::NUMERIC
        WHEN 'best_streak'  THEN r.best_streak::NUMERIC
        ELSE                     r.flyers::NUMERIC
      END DESC NULLS LAST
    LIMIT limit_count
    OFFSET offset_count;
  ELSE
    RETURN QUERY
    SELECT
      r.brokerage_key,
      r.display_name,
      r.flyers,
      r.conversations,
      r.leads,
      r.distance,
      r.time_minutes,
      r.day_streak,
      r.best_streak,
      r.agent_count,
      (ROW_NUMBER() OVER (
        ORDER BY
          CASE sort_by
            WHEN 'flyers'        THEN r.flyers::NUMERIC
            WHEN 'conversations' THEN r.conversations::NUMERIC
            WHEN 'leads'         THEN r.leads::NUMERIC
            WHEN 'distance'     THEN r.distance::NUMERIC
            WHEN 'time'         THEN r.time_minutes::NUMERIC
            WHEN 'day_streak'   THEN r.day_streak::NUMERIC
            WHEN 'best_streak'  THEN r.best_streak::NUMERIC
            ELSE                     r.flyers::NUMERIC
          END DESC NULLS LAST
      ))::INTEGER AS rank,
      r.updated_at
    FROM public.ranking_brokerages_all_time r
    ORDER BY
      CASE sort_by
        WHEN 'flyers'        THEN r.flyers::NUMERIC
        WHEN 'conversations' THEN r.conversations::NUMERIC
        WHEN 'leads'         THEN r.leads::NUMERIC
        WHEN 'distance'     THEN r.distance::NUMERIC
        WHEN 'time'         THEN r.time_minutes::NUMERIC
        WHEN 'day_streak'   THEN r.day_streak::NUMERIC
        WHEN 'best_streak'  THEN r.best_streak::NUMERIC
        ELSE                     r.flyers::NUMERIC
      END DESC NULLS LAST
    LIMIT limit_count
    OFFSET offset_count;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_buildings_by_address_ids"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT
    b.address_id,
    b.geom::geometry(MultiPolygon, 4326),
    ST_AsGeoJSON(b.geom)::jsonb
  FROM buildings b
  WHERE b.address_id = ANY(p_address_ids)
    AND b.geom IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public."get_campaign_address_counts"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT ca.campaign_id, count(*)::bigint
  FROM public.campaign_addresses ca
  GROUP BY ca.campaign_id;
$function$;

CREATE OR REPLACE FUNCTION public."get_campaign_addresses_geojson"()
RETURNS record
LANGUAGE plpgsql
AS $function$

  BEGIN
      RETURN QUERY
      SELECT
          a.id,
          a.gers_id,
          a.formatted,
          a.house_number,
          a.street_name,
          a.locality,
          a.region,
          a.postal_code,
          ST_AsGeoJSON(a.geom)::JSONB AS geom
      FROM campaign_addresses a
      WHERE a.campaign_id = p_campaign_id;
  END;
$function$;

CREATE OR REPLACE FUNCTION public."get_campaign_addresses_in_polygon"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_polygon geometry;
BEGIN
    v_polygon := ST_SetSRID(ST_GeomFromGeoJSON(p_polygon_geojson), 4326);

    RETURN QUERY
    SELECT
        ca.id,
        ca.campaign_id,
        ca.formatted,
        ca.postal_code,
        ca.source,
        ca.seq,
        ca.visited,
        ST_AsGeoJSON(ca.geom, 6)::jsonb AS geom_json,
        ca.created_at
    FROM public.campaign_addresses ca
    WHERE ca.geom IS NOT NULL
      AND ca.campaign_id = p_campaign_id
      AND ST_Covers(v_polygon, ca.geom)
    ORDER BY ca.seq NULLS LAST, ca.created_at ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_campaign_bbox"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT
    ST_XMin(ext)::float8 AS min_lon,
    ST_YMin(ext)::float8 AS min_lat,
    ST_XMax(ext)::float8 AS max_lon,
    ST_YMax(ext)::float8 AS max_lat
  FROM (
    -- FIX: Cast geography to geometry here
    SELECT ST_Extent(geom::geometry) AS ext
    FROM public.campaign_addresses
    WHERE campaign_id = c_id
      AND geom IS NOT NULL
  ) s
  WHERE ext IS NOT NULL;
$function$;

CREATE OR REPLACE FUNCTION public."get_campaign_buildings_geojson"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

BEGIN
    RETURN public.rpc_get_campaign_full_features(p_campaign_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_campaign_confidence_hotspots"()
RETURNS record
LANGUAGE sql
AS $function$

WITH campaign_centers AS (
    SELECT
        c.id,
        c.workspace_id,
        c.data_confidence_score,
        c.data_confidence_label,
        c.data_confidence_summary,
        COALESCE(
            ST_Centroid(c.territory_boundary::geometry),
            addr.center_geom
        ) AS center_geom
    FROM public.campaigns c
    LEFT JOIN LATERAL (
        SELECT ST_Centroid(ST_Collect(ca.geom::geometry)) AS center_geom
        FROM public.campaign_addresses ca
        WHERE ca.campaign_id = c.id
          AND ca.geom IS NOT NULL
    ) addr ON TRUE
    WHERE c.data_confidence_score IS NOT NULL
      AND (p_workspace_id IS NULL OR c.workspace_id = p_workspace_id)
),
bucketed AS (
    SELECT
        ST_GeoHash(center_geom, GREATEST(1, LEAST(COALESCE(p_precision, 5), 12))) AS geohash,
        center_geom,
        data_confidence_score,
        data_confidence_label,
        data_confidence_summary
    FROM campaign_centers
    WHERE center_geom IS NOT NULL
)
SELECT
    b.geohash,
    ST_Y(ST_Centroid(ST_Collect(b.center_geom)))::double precision AS center_lat,
    ST_X(ST_Centroid(ST_Collect(b.center_geom)))::double precision AS center_lon,
    COUNT(*)::bigint AS campaigns_count,
    AVG(b.data_confidence_score)::double precision AS avg_confidence_score,
    AVG(COALESCE((b.data_confidence_summary -> 'metrics' ->> 'linked_coverage')::double precision, 0))::double precision AS avg_linked_coverage,
    COUNT(*) FILTER (WHERE b.data_confidence_label = 'low')::bigint AS low_count,
    COUNT(*) FILTER (WHERE b.data_confidence_label = 'medium')::bigint AS medium_count,
    COUNT(*) FILTER (WHERE b.data_confidence_label = 'high')::bigint AS high_count,
    COALESCE(SUM((b.data_confidence_summary -> 'metrics' ->> 'gold_exact_count')::bigint), 0)::bigint AS gold_exact_total,
    COALESCE(SUM((b.data_confidence_summary -> 'metrics' ->> 'silver_count')::bigint), 0)::bigint AS silver_total,
    COALESCE(SUM((b.data_confidence_summary -> 'metrics' ->> 'bronze_count')::bigint), 0)::bigint AS bronze_total,
    COALESCE(SUM((b.data_confidence_summary -> 'metrics' ->> 'lambda_count')::bigint), 0)::bigint AS lambda_total,
    (
        COUNT(*)::double precision *
        (1 - AVG(b.data_confidence_score))
    )::double precision AS priority_score
FROM bucketed b
GROUP BY b.geohash
ORDER BY priority_score DESC, campaigns_count DESC, geohash ASC;
$function$;

CREATE OR REPLACE FUNCTION public."get_campaign_geometry_meta"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT
    ST_X(ST_Centroid(c.territory_boundary))::double precision AS centroid_lng,
    ST_Y(ST_Centroid(c.territory_boundary))::double precision AS centroid_lat,
    ST_AsGeoJSON(c.territory_boundary)::text AS boundary_geojson
  FROM public.campaigns c
  WHERE c.id = p_campaign_id;
$function$;

CREATE OR REPLACE FUNCTION public."get_campaign_matches"()
RETURNS record
LANGUAGE plpgsql
AS $function$

BEGIN
  RETURN QUERY
  SELECT 
    l.id,
    l.address_id,
    l.building_id,
    l.match_type,
    l.confidence,
    l.distance_meters,
    l.building_area_sqm,
    l.is_multi_unit,
    l.unit_count
  FROM building_address_links l
  WHERE l.campaign_id = p_campaign_id
  ORDER BY l.confidence DESC, l.distance_meters ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_campaign_orphans"()
RETURNS record
LANGUAGE plpgsql
AS $function$

BEGIN
  RETURN QUERY
  SELECT 
    o.id,
    o.address_id,
    o.nearest_building_id,
    o.nearest_distance,
    o.street_match_score,
    o.suggested_buildings,
    o.status
  FROM address_orphans o
  WHERE o.campaign_id = p_campaign_id
    AND o.status = 'pending'
  ORDER BY o.nearest_distance ASC NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_campaign_scan_count"()
RETURNS bigint
LANGUAGE plpgsql
AS $function$

begin
  return (
    select count(*)::bigint
    from public.qr_code_scans qcs
    join public.campaign_addresses ca on ca.id = qcs.address_id
    where ca.campaign_id = p_campaign_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public."get_challenge_rolling_leaderboard"()
RETURNS record
LANGUAGE sql
AS $function$

    WITH door_rows AS (
        SELECT
            s.user_id AS uid,
            s.id AS session_id,
            s.end_time AS ended_at,
            GREATEST(COALESCE(s.doors_hit, s.completed_count, s.flyers_delivered, 0), 0)::bigint AS doors
        FROM public.sessions s
        WHERE s.end_time IS NOT NULL
          AND s.start_time >= now() - interval '30 days'
    ),
    agg AS (
        SELECT
            dr.uid AS agg_uid,
            SUM(dr.doors)::bigint AS agg_score
        FROM door_rows dr
        GROUP BY dr.uid
        HAVING SUM(dr.doors) > 0
    ),
    with_latest AS (
        SELECT
            a.agg_uid,
            a.agg_score,
            (
                SELECT s2.id
                FROM public.sessions s2
                WHERE s2.user_id = a.agg_uid
                  AND s2.end_time IS NOT NULL
                  AND s2.start_time >= now() - interval '30 days'
                ORDER BY s2.end_time DESC NULLS LAST
                LIMIT 1
            ) AS latest_sid
        FROM agg a
    ),
    ranked AS (
        SELECT
            wl.agg_uid,
            wl.agg_score,
            wl.latest_sid,
            ROW_NUMBER() OVER (ORDER BY wl.agg_score DESC, wl.agg_uid ASC)::bigint AS user_rank
        FROM with_latest wl
    )
    SELECT
        r.agg_uid AS user_id,
        COALESCE(
            NULLIF(
                BTRIM(CONCAT_WS(
                    ' ',
                    NULLIF(BTRIM(p.first_name), ''),
                    NULLIF(BTRIM(p.last_name), '')
                )),
                ''
            ),
            NULLIF(BTRIM(p.full_name), ''),
            NULLIF(BTRIM(au.raw_user_meta_data->>'full_name'), ''),
            NULLIF(BTRIM(SPLIT_PART(au.email, '@', 1)), ''),
            'Member'
        ) AS display_name,
        r.agg_score AS score,
        r.user_rank AS "rank",
        '[]'::jsonb AS active_badges,
        0::integer AS current_streak,
        false AS accountability_posted,
        r.latest_sid AS latest_session_id
    FROM ranked r
    INNER JOIN auth.users au ON au.id = r.agg_uid
    LEFT JOIN public.profiles p ON p.id = r.agg_uid
    ORDER BY r.user_rank ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
$function$;

CREATE OR REPLACE FUNCTION public."get_cluster_route"()
RETURNS record
LANGUAGE plpgsql
AS $function$

BEGIN
    RETURN QUERY
    SELECT 
        ca.id,
        ca.sequence,
        ca.formatted,
        ca.house_number,
        ca.street_name,
        ca.walk_time_sec,
        ca.distance_m
    FROM campaign_addresses ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.cluster_id = p_cluster_id
    ORDER BY ca.sequence;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_daily_quote"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  today text := to_char(now(), 'YYYYMMDD');
  cached record;
BEGIN
  -- Check for valid cached quote
  SELECT * INTO cached
  FROM daily_content_cache
  WHERE content_type = 'quote'
    AND cache_date = today
    AND expires_at > now();
  
  IF FOUND THEN
    RETURN QUERY
    SELECT 
      cached.quote_text,
      cached.quote_author,
      cached.quote_category,
      cached.source,
      false as is_fresh;
    RETURN;
  END IF;
  
  -- Return empty if no cache (API route should fetch and populate)
  RETURN QUERY
  SELECT 
    null::text,
    null::text,
    null::text,
    null::text,
    true as is_fresh;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_daily_riddle"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  today text := to_char(now(), 'YYYYMMDD');
  cached record;
BEGIN
  -- Check for valid cached riddle
  SELECT * INTO cached
  FROM daily_content_cache
  WHERE content_type = 'riddle'
    AND cache_date = today
    AND expires_at > now();
  
  IF FOUND THEN
    RETURN QUERY
    SELECT 
      cached.riddle_question,
      cached.riddle_answer,
      cached.riddle_difficulty,
      cached.source,
      false as is_fresh;
    RETURN;
  END IF;
  
  -- Return empty if no cache (API route should fetch and populate)
  RETURN QUERY
  SELECT 
    null::text,
    null::text,
    null::text,
    null::text,
    true as is_fresh;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_gold_addresses_in_polygon"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_polygon GEOMETRY;
BEGIN
    -- Parse the GeoJSON polygon
    v_polygon := ST_GeomFromGeoJSON(p_polygon_geojson)::GEOMETRY(Polygon, 4326);
    
    RETURN QUERY
    SELECT 
        a.id,
        a.source_id,
        a.street_number,
        a.street_name,
        a.unit,
        a.city,
        a.zip,
        a.province,
        a.country,
        ST_Y(a.geom::GEOMETRY) AS lat,
        ST_X(a.geom::GEOMETRY) AS lon,
        a.geom
    FROM ref_addresses_gold a
    WHERE ST_Within(a.geom, v_polygon)
    ORDER BY a.street_name, a.street_number::INTEGER NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_gold_addresses_in_polygon_geojson"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_polygon GEOMETRY;
    v_province TEXT;
BEGIN
    v_polygon := ST_GeomFromGeoJSON(p_polygon_geojson)::GEOMETRY(Polygon, 4326);
    v_province := NULLIF(UPPER(TRIM(p_province)), '');

    RETURN QUERY
    SELECT
        a.id,
        a.source_id,
        a.street_number,
        a.street_name,
        a.unit,
        a.city,
        a.zip,
        a.province,
        a.country,
        ST_Y(a.geom::GEOMETRY) AS lat,
        ST_X(a.geom::GEOMETRY) AS lon,
        ST_AsGeoJSON(a.geom)::TEXT AS geom_geojson
    FROM ref_addresses_gold a
    WHERE ST_Within(a.geom, v_polygon)
      AND (v_province IS NULL OR UPPER(a.province) = v_province)
    ORDER BY a.street_name, a.street_number_normalized NULLS LAST, a.street_number
    LIMIT 2500;
END;
$function$; -- overload 1

CREATE OR REPLACE FUNCTION public."get_gold_addresses_in_polygon_geojson"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_polygon GEOMETRY;
BEGIN
    v_polygon := ST_GeomFromGeoJSON(p_polygon_geojson)::GEOMETRY(Polygon, 4326);

    RETURN QUERY
    SELECT
        a.id,
        a.source_id,
        a.street_number,
        a.street_name,
        a.unit,
        a.city,
        a.zip,
        a.province,
        a.country,
        ST_Y(a.geom::GEOMETRY) AS lat,
        ST_X(a.geom::GEOMETRY) AS lon,
        ST_AsGeoJSON(a.geom)::TEXT AS geom_geojson
    FROM ref_addresses_gold a
    WHERE ST_Within(a.geom, v_polygon)
    ORDER BY a.street_name, a.street_number_normalized NULLS LAST, a.street_number
    LIMIT 2500;
END;
$function$; -- overload 2

CREATE OR REPLACE FUNCTION public."get_gold_buildings_for_campaign"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

  DECLARE
      v_campaign_poly GEOMETRY;
      result JSONB;
  BEGIN
      -- Get campaign polygon
      SELECT COALESCE(
          territory_boundary,
          ST_GeomFromGeoJSON(campaign_polygon_snapped::text),
          ST_GeomFromGeoJSON(campaign_polygon_raw::text)
      ) INTO v_campaign_poly
      FROM campaigns
      WHERE id = p_campaign_id;

      -- Fallback: derive from addresses
      IF v_campaign_poly IS NULL THEN
          SELECT ST_ConvexHull(ST_Collect(geom)) INTO v_campaign_poly
          FROM campaign_addresses
          WHERE campaign_id = p_campaign_id AND geom IS NOT NULL;
      END IF;

      IF v_campaign_poly IS NULL THEN
          RETURN jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb)
  ;
      END IF;

      -- Return ALL Gold buildings in polygon
      SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(jsonb_agg(jsonb_build_object(
              'type', 'Feature',
              'id', b.id,
              'geometry', ST_AsGeoJSON(b.geom)::jsonb,
              'properties', jsonb_build_object(
                  'id', b.id,
                  'feature_id', b.id,
                  'address_text', b.primary_address,
                  'height', COALESCE(b.height_m, 10),
                  'source', 'gold'
              )
          )), '[]'::jsonb)
      ) INTO result
      FROM ref_buildings_gold b
      WHERE ST_Intersects(b.geom, v_campaign_poly);

      RETURN result;
  END;
$function$;

CREATE OR REPLACE FUNCTION public."get_gold_buildings_in_polygon"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_polygon GEOMETRY;
BEGIN
    v_polygon := ST_GeomFromGeoJSON(p_polygon_geojson)::GEOMETRY(Polygon, 4326);
    
    RETURN QUERY
    SELECT 
        b.id,
        b.source_id,
        b.external_id,
        b.area_sqm,
        ST_AsGeoJSON(b.geom)::TEXT AS geom_geojson,
        ST_AsGeoJSON(b.centroid)::TEXT AS centroid_geojson,
        b.building_type
    FROM ref_buildings_gold b
    WHERE ST_Intersects(b.geom, v_polygon)
    ORDER BY b.area_sqm DESC NULLS LAST;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_gold_buildings_in_polygon_geojson"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
    v_polygon GEOMETRY;
    v_result  JSONB;
BEGIN
    v_polygon := ST_GeomFromGeoJSON(p_polygon_geojson);

    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
    )
    INTO v_result
    FROM (
        SELECT jsonb_build_object(
            'type',       'Feature',
            'id',         b.id,
            'geometry',   ST_AsGeoJSON(b.geom)::jsonb,
            'properties', jsonb_build_object(
                'id',                    b.id,
                'source_id',             b.source_id,
                'external_id',           b.external_id,
                'area_sqm',              b.area_sqm,
                'height_m',              b.height_m,
                'floors',                b.floors,
                'year_built',            b.year_built,
                'building_type',         b.building_type,
                'subtype',               b.subtype,
                'primary_address',       b.primary_address,
                'primary_street_number', b.primary_street_number,
                'primary_street_name',   b.primary_street_name,
                'source',                'gold'
            )
        ) AS feature
        FROM public.ref_buildings_gold b
        WHERE ST_Intersects(b.geom, v_polygon)
    ) f;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_leaderboard"()
RETURNS record
LANGUAGE plpgsql
AS $function$

BEGIN
  RETURN QUERY
  SELECT
    us.id::TEXT,
    us.user_id::TEXT,
    COALESCE(u.email, '')::TEXT                                     AS user_email,
    COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'User')::TEXT AS name,
    COALESCE(u.raw_user_meta_data->>'avatar_url', '')::TEXT         AS avatar_url,
    COALESCE(us.flyers, 0)::INTEGER                                AS flyers,
    COALESCE(us.conversations, 0)::INTEGER                         AS conversations,
    COALESCE(us.leads_created, 0)::INTEGER                         AS leads,
    COALESCE(us.distance_walked, 0)::DOUBLE PRECISION              AS distance,
    COALESCE(us.time_tracked, 0)::DOUBLE PRECISION                 AS time_minutes,
    COALESCE(us.day_streak, 0)::INTEGER                            AS day_streak,
    COALESCE(us.best_streak, 0)::INTEGER                           AS best_streak,
    (ROW_NUMBER() OVER (
      ORDER BY
        CASE sort_by
          WHEN 'flyers'        THEN COALESCE(us.flyers, 0)::NUMERIC
          WHEN 'conversations' THEN COALESCE(us.conversations, 0)::NUMERIC
          WHEN 'leads'         THEN COALESCE(us.leads_created, 0)::NUMERIC
          WHEN 'distance'      THEN COALESCE(us.distance_walked, 0)::NUMERIC
          WHEN 'time'          THEN COALESCE(us.time_tracked, 0)::NUMERIC
          WHEN 'day_streak'    THEN COALESCE(us.day_streak, 0)::NUMERIC
          WHEN 'best_streak'   THEN COALESCE(us.best_streak, 0)::NUMERIC
          ELSE                      COALESCE(us.flyers, 0)::NUMERIC
        END DESC
    ))::INTEGER AS rank,
    us.updated_at
  FROM public.user_stats us
  LEFT JOIN auth.users u ON u.id = us.user_id
  ORDER BY
    CASE sort_by
      WHEN 'flyers'        THEN COALESCE(us.flyers, 0)::NUMERIC
      WHEN 'conversations' THEN COALESCE(us.conversations, 0)::NUMERIC
      WHEN 'leads'         THEN COALESCE(us.leads_created, 0)::NUMERIC
      WHEN 'distance'      THEN COALESCE(us.distance_walked, 0)::NUMERIC
      WHEN 'time'          THEN COALESCE(us.time_tracked, 0)::NUMERIC
      WHEN 'day_streak'    THEN COALESCE(us.day_streak, 0)::NUMERIC
      WHEN 'best_streak'   THEN COALESCE(us.best_streak, 0)::NUMERIC
      ELSE                      COALESCE(us.flyers, 0)::NUMERIC
    END DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$function$; -- overload 1

CREATE OR REPLACE FUNCTION public."get_leaderboard"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_scope_key TEXT;
    v_current_period TIMESTAMPTZ;
BEGIN
    IF p_timeframe NOT IN ('daily', 'weekly', 'monthly', 'all_time') THEN
        p_timeframe := 'weekly';
    END IF;

    IF p_metric NOT IN ('doorknocks', 'conversations', 'distance', 'leads') THEN
        p_metric := 'doorknocks';
    END IF;

    IF p_workspace_id IS NOT NULL THEN
        IF NOT public.is_workspace_member(p_workspace_id) THEN
            RAISE EXCEPTION 'Workspace access denied';
        END IF;
        v_scope_key := 'workspace:' || p_workspace_id::TEXT;
    ELSE
        v_scope_key := 'global';
    END IF;

    v_current_period := public.leaderboard_period_start(p_timeframe, NOW());

    RETURN QUERY
    WITH current_period AS (
        SELECT lr.user_id, lr.doorknocks, lr.conversations, lr.leads, lr.distance_km
        FROM public.leaderboard_rollups lr
        WHERE lr.scope_key = v_scope_key
          AND lr.timeframe = p_timeframe
          AND lr.period_start = v_current_period
          AND (lr.doorknocks > 0 OR lr.conversations > 0 OR lr.leads > 0 OR lr.distance_km > 0)
    ),
    daily_stats AS (
        SELECT *
        FROM public.leaderboard_rollups lr
        WHERE lr.scope_key = v_scope_key
          AND lr.timeframe = 'daily'
          AND lr.period_start = public.leaderboard_period_start('daily', NOW())
    ),
    weekly_stats AS (
        SELECT *
        FROM public.leaderboard_rollups lr
        WHERE lr.scope_key = v_scope_key
          AND lr.timeframe = 'weekly'
          AND lr.period_start = public.leaderboard_period_start('weekly', NOW())
    ),
    monthly_stats AS (
        SELECT *
        FROM public.leaderboard_rollups lr
        WHERE lr.scope_key = v_scope_key
          AND lr.timeframe = 'monthly'
          AND lr.period_start = public.leaderboard_period_start('monthly', NOW())
    ),
    all_time_stats AS (
        SELECT *
        FROM public.leaderboard_rollups lr
        WHERE lr.scope_key = v_scope_key
          AND lr.timeframe = 'all_time'
          AND lr.period_start = public.leaderboard_period_start('all_time', NOW())
    ),
    ranked_users AS (
        SELECT
            cp.user_id::TEXT AS user_id,
            COALESCE(
                NULLIF(BTRIM(CONCAT_WS(' ', NULLIF(BTRIM(p.first_name), ''), NULLIF(BTRIM(p.last_name), ''))), ''),
                NULLIF(BTRIM(p.full_name), ''),
                NULLIF(BTRIM(au.raw_user_meta_data->>'full_name'), ''),
                NULLIF(BTRIM(SPLIT_PART(au.email, '@', 1)), ''),
                'Agent'
            ) AS display_name,
            COALESCE(
                NULLIF(BTRIM(p.avatar_url), ''),
                NULLIF(BTRIM(au.raw_user_meta_data->>'avatar_url'), '')
            )::TEXT AS user_avatar,
            COALESCE(
                NULLIF(BTRIM(UPPER(p.country_code)), ''),
                NULLIF(BTRIM(UPPER(au.raw_user_meta_data->>'country_code')), '')
            )::TEXT AS user_country_code,
            NULLIF(BTRIM(COALESCE(au.raw_user_meta_data->>'brokerage', '')), '')::TEXT AS user_brokerage,
            COALESCE(cp.doorknocks, 0)::INTEGER AS user_doorknocks,
            COALESCE(cp.conversations, 0)::INTEGER AS user_conversations,
            COALESCE(cp.leads, 0)::INTEGER AS user_leads,
            COALESCE(cp.distance_km, 0.0)::DOUBLE PRECISION AS user_distance,
            jsonb_build_object('doorknocks', COALESCE(ds.doorknocks, 0), 'conversations', COALESCE(ds.conversations, 0), 'distance', COALESCE(ds.distance_km, 0.0), 'leads', COALESCE(ds.leads, 0)) AS daily_snapshot,
            jsonb_build_object('doorknocks', COALESCE(ws.doorknocks, 0), 'conversations', COALESCE(ws.conversations, 0), 'distance', COALESCE(ws.distance_km, 0.0), 'leads', COALESCE(ws.leads, 0)) AS weekly_snapshot,
            jsonb_build_object('doorknocks', COALESCE(ms.doorknocks, 0), 'conversations', COALESCE(ms.conversations, 0), 'distance', COALESCE(ms.distance_km, 0.0), 'leads', COALESCE(ms.leads, 0)) AS monthly_snapshot,
            jsonb_build_object('doorknocks', COALESCE(ats.doorknocks, 0), 'conversations', COALESCE(ats.conversations, 0), 'distance', COALESCE(ats.distance_km, 0.0), 'leads', COALESCE(ats.leads, 0)) AS all_time_snapshot
        FROM current_period cp
        INNER JOIN auth.users au ON au.id = cp.user_id
        LEFT JOIN public.profiles p ON p.id = cp.user_id
        LEFT JOIN daily_stats ds ON ds.user_id = cp.user_id
        LEFT JOIN weekly_stats ws ON ws.user_id = cp.user_id
        LEFT JOIN monthly_stats ms ON ms.user_id = cp.user_id
        LEFT JOIN all_time_stats ats ON ats.user_id = cp.user_id
    ),
    ranked AS (
        SELECT
            ru.*,
            (ROW_NUMBER() OVER (
                ORDER BY
                    CASE p_metric
                        WHEN 'doorknocks' THEN ru.user_doorknocks::DOUBLE PRECISION
                        WHEN 'conversations' THEN ru.user_conversations::DOUBLE PRECISION
                        WHEN 'distance' THEN ru.user_distance
                        WHEN 'leads' THEN ru.user_leads::DOUBLE PRECISION
                        ELSE ru.user_doorknocks::DOUBLE PRECISION
                    END DESC,
                    ru.user_doorknocks DESC,
                    ru.user_conversations DESC,
                    ru.user_distance DESC,
                    ru.user_id ASC
            ))::INTEGER AS user_rank
        FROM ranked_users ru
    )
    SELECT
        r.user_id,
        r.display_name,
        r.user_avatar,
        r.user_country_code,
        r.user_brokerage,
        r.user_rank,
        r.user_doorknocks,
        r.user_leads,
        r.user_conversations,
        r.user_distance,
        r.daily_snapshot,
        r.weekly_snapshot,
        r.monthly_snapshot,
        r.all_time_snapshot
    FROM ranked r
    ORDER BY r.user_rank
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$function$; -- overload 2

CREATE OR REPLACE FUNCTION public."get_leaderboard"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  v_cutoff TIMESTAMPTZ;
BEGIN
  -- For all_time, use pre-aggregated user_stats
  IF timeframe = 'all_time' OR timeframe IS NULL THEN
    RETURN QUERY
    SELECT
      us.id::TEXT,
      us.user_id::TEXT,
      COALESCE(u.email, '')::TEXT                                       AS user_email,
      COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'User')::TEXT AS name,
      COALESCE(u.raw_user_meta_data->>'avatar_url', '')::TEXT           AS avatar_url,
      COALESCE(us.flyers, 0)::INTEGER                                  AS flyers,
      COALESCE(us.conversations, 0)::INTEGER                           AS conversations,
      COALESCE(us.leads_created, 0)::INTEGER                           AS leads,
      COALESCE(us.distance_walked, 0)::DOUBLE PRECISION                AS distance,
      COALESCE(us.time_tracked, 0)::DOUBLE PRECISION                   AS time_minutes,
      COALESCE(us.day_streak, 0)::INTEGER                              AS day_streak,
      COALESCE(us.best_streak, 0)::INTEGER                             AS best_streak,
      (ROW_NUMBER() OVER (
        ORDER BY
          CASE sort_by
            WHEN 'flyers'        THEN COALESCE(us.flyers, 0)::NUMERIC
            WHEN 'conversations' THEN COALESCE(us.conversations, 0)::NUMERIC
            WHEN 'leads'         THEN COALESCE(us.leads_created, 0)::NUMERIC
            WHEN 'distance'      THEN COALESCE(us.distance_walked, 0)::NUMERIC
            WHEN 'time'          THEN COALESCE(us.time_tracked, 0)::NUMERIC
            WHEN 'day_streak'    THEN COALESCE(us.day_streak, 0)::NUMERIC
            WHEN 'best_streak'   THEN COALESCE(us.best_streak, 0)::NUMERIC
            ELSE                      COALESCE(us.flyers, 0)::NUMERIC
          END DESC
      ))::INTEGER AS rank,
      us.updated_at
    FROM public.user_stats us
    LEFT JOIN auth.users u ON u.id = us.user_id
    ORDER BY
      CASE sort_by
        WHEN 'flyers'        THEN COALESCE(us.flyers, 0)::NUMERIC
        WHEN 'conversations' THEN COALESCE(us.conversations, 0)::NUMERIC
        WHEN 'leads'         THEN COALESCE(us.leads_created, 0)::NUMERIC
        WHEN 'distance'      THEN COALESCE(us.distance_walked, 0)::NUMERIC
        WHEN 'time'          THEN COALESCE(us.time_tracked, 0)::NUMERIC
        WHEN 'day_streak'    THEN COALESCE(us.day_streak, 0)::NUMERIC
        WHEN 'best_streak'   THEN COALESCE(us.best_streak, 0)::NUMERIC
        ELSE                      COALESCE(us.flyers, 0)::NUMERIC
      END DESC
    LIMIT limit_count
    OFFSET offset_count;

    RETURN;
  END IF;

  -- Compute cutoff for time-filtered queries
  v_cutoff := CASE timeframe
    WHEN 'day'   THEN date_trunc('day',   now())
    WHEN 'week'  THEN date_trunc('week',  now())
    WHEN 'month' THEN date_trunc('month', now())
    WHEN 'year'  THEN date_trunc('year',  now())
    ELSE              date_trunc('week',  now())
  END;

  -- Aggregate from sessions table for the chosen timeframe
  RETURN QUERY
  SELECT
    s.user_id::TEXT                                                     AS id,
    s.user_id::TEXT                                                     AS user_id,
    COALESCE(u.email, '')::TEXT                                         AS user_email,
    COALESCE(u.raw_user_meta_data->>'full_name', u.email, 'User')::TEXT AS name,
    COALESCE(u.raw_user_meta_data->>'avatar_url', '')::TEXT             AS avatar_url,
    COALESCE(SUM(s.flyers_delivered), 0)::INTEGER                       AS flyers,
    COALESCE(SUM(s.conversations), 0)::INTEGER                          AS conversations,
    0::INTEGER                                                          AS leads,
    COALESCE(SUM(s.distance_meters) / 1000.0, 0)::DOUBLE PRECISION     AS distance,
    COALESCE(SUM(s.active_seconds) / 60.0, 0)::DOUBLE PRECISION        AS time_minutes,
    COALESCE(us.day_streak, 0)::INTEGER                                 AS day_streak,
    COALESCE(us.best_streak, 0)::INTEGER                                AS best_streak,
    (ROW_NUMBER() OVER (
      ORDER BY
        CASE sort_by
          WHEN 'flyers'        THEN COALESCE(SUM(s.flyers_delivered), 0)::NUMERIC
          WHEN 'conversations' THEN COALESCE(SUM(s.conversations), 0)::NUMERIC
          WHEN 'distance'      THEN COALESCE(SUM(s.distance_meters) / 1000.0, 0)::NUMERIC
          WHEN 'time'          THEN COALESCE(SUM(s.active_seconds) / 60.0, 0)::NUMERIC
          WHEN 'day_streak'    THEN COALESCE(us.day_streak, 0)::NUMERIC
          WHEN 'best_streak'   THEN COALESCE(us.best_streak, 0)::NUMERIC
          ELSE                      COALESCE(SUM(s.flyers_delivered), 0)::NUMERIC
        END DESC
    ))::INTEGER AS rank,
    MAX(s.start_time)                                                   AS updated_at
  FROM public.sessions s
  LEFT JOIN auth.users u ON u.id = s.user_id
  LEFT JOIN public.user_stats us ON us.user_id = s.user_id
  WHERE s.start_time >= v_cutoff
    AND s.end_time IS NOT NULL
  GROUP BY s.user_id, u.email, u.raw_user_meta_data, us.day_streak, us.best_streak
  ORDER BY
    CASE sort_by
      WHEN 'flyers'        THEN COALESCE(SUM(s.flyers_delivered), 0)::NUMERIC
      WHEN 'conversations' THEN COALESCE(SUM(s.conversations), 0)::NUMERIC
      WHEN 'distance'      THEN COALESCE(SUM(s.distance_meters) / 1000.0, 0)::NUMERIC
      WHEN 'time'          THEN COALESCE(SUM(s.active_seconds) / 60.0, 0)::NUMERIC
      WHEN 'day_streak'    THEN COALESCE(us.day_streak, 0)::NUMERIC
      WHEN 'best_streak'   THEN COALESCE(us.best_streak, 0)::NUMERIC
      ELSE                      COALESCE(SUM(s.flyers_delivered), 0)::NUMERIC
    END DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$function$; -- overload 3

CREATE OR REPLACE FUNCTION public."get_leaderboard_base"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_scope_key TEXT;
    v_current_period TIMESTAMPTZ;
BEGIN
    IF p_timeframe NOT IN ('daily', 'weekly', 'monthly', 'all_time') THEN
        p_timeframe := 'weekly';
    END IF;

    IF p_metric NOT IN ('doorknocks', 'flyers', 'conversations', 'distance', 'leads') THEN
        p_metric := 'doorknocks';
    END IF;

    IF p_workspace_id IS NOT NULL THEN
        IF NOT public.is_workspace_member(p_workspace_id) THEN
            RAISE EXCEPTION 'Workspace access denied';
        END IF;
        v_scope_key := 'workspace:' || p_workspace_id::TEXT;
    ELSE
        v_scope_key := 'global';
    END IF;

    v_current_period := public.leaderboard_period_start(p_timeframe, NOW());

    RETURN QUERY
    WITH current_period AS (
        SELECT
            lr.user_id,
            lr.doorknocks,
            lr.conversations,
            lr.leads,
            lr.distance_km
        FROM public.leaderboard_rollups lr
        WHERE lr.scope_key = v_scope_key
          AND lr.timeframe = p_timeframe
          AND lr.period_start = v_current_period
          AND (
              lr.doorknocks > 0
              OR lr.conversations > 0
              OR lr.leads > 0
              OR lr.distance_km > 0
          )
    ),
    daily_stats AS (
        SELECT *
        FROM public.leaderboard_rollups lr
        WHERE lr.scope_key = v_scope_key
          AND lr.timeframe = 'daily'
          AND lr.period_start = public.leaderboard_period_start('daily', NOW())
    ),
    weekly_stats AS (
        SELECT *
        FROM public.leaderboard_rollups lr
        WHERE lr.scope_key = v_scope_key
          AND lr.timeframe = 'weekly'
          AND lr.period_start = public.leaderboard_period_start('weekly', NOW())
    ),
    monthly_stats AS (
        SELECT *
        FROM public.leaderboard_rollups lr
        WHERE lr.scope_key = v_scope_key
          AND lr.timeframe = 'monthly'
          AND lr.period_start = public.leaderboard_period_start('monthly', NOW())
    ),
    all_time_stats AS (
        SELECT *
        FROM public.leaderboard_rollups lr
        WHERE lr.scope_key = v_scope_key
          AND lr.timeframe = 'all_time'
          AND lr.period_start = public.leaderboard_period_start('all_time', NOW())
    ),
    ranked_users AS (
        SELECT
            cp.user_id::TEXT AS user_id,
            COALESCE(
                NULLIF(BTRIM(CONCAT_WS(
                    ' ',
                    NULLIF(BTRIM(p.first_name), ''),
                    NULLIF(BTRIM(p.last_name), '')
                )), ''),
                NULLIF(BTRIM(p.full_name), ''),
                NULLIF(BTRIM(au.raw_user_meta_data->>'full_name'), ''),
                NULLIF(BTRIM(SPLIT_PART(au.email, '@', 1)), ''),
                'Agent'
            ) AS display_name,
            COALESCE(
                NULLIF(BTRIM(p.avatar_url), ''),
                NULLIF(BTRIM(au.raw_user_meta_data->>'avatar_url'), '')
            )::TEXT AS user_avatar,
            NULLIF(BTRIM(COALESCE(au.raw_user_meta_data->>'brokerage', '')), '') AS user_brokerage,
            COALESCE(cp.doorknocks, 0) AS user_doorknocks,
            COALESCE(cp.conversations, 0) AS user_conversations,
            COALESCE(cp.leads, 0) AS user_leads,
            COALESCE(cp.distance_km, 0.0) AS user_distance,
            jsonb_build_object(
                'doorknocks', COALESCE(ds.doorknocks, 0),
                'flyers', COALESCE(ds.doorknocks, 0),
                'conversations', COALESCE(ds.conversations, 0),
                'distance', COALESCE(ds.distance_km, 0.0),
                'leads', COALESCE(ds.leads, 0)
            ) AS daily_snapshot,
            jsonb_build_object(
                'doorknocks', COALESCE(ws.doorknocks, 0),
                'flyers', COALESCE(ws.doorknocks, 0),
                'conversations', COALESCE(ws.conversations, 0),
                'distance', COALESCE(ws.distance_km, 0.0),
                'leads', COALESCE(ws.leads, 0)
            ) AS weekly_snapshot,
            jsonb_build_object(
                'doorknocks', COALESCE(ms.doorknocks, 0),
                'flyers', COALESCE(ms.doorknocks, 0),
                'conversations', COALESCE(ms.conversations, 0),
                'distance', COALESCE(ms.distance_km, 0.0),
                'leads', COALESCE(ms.leads, 0)
            ) AS monthly_snapshot,
            jsonb_build_object(
                'doorknocks', COALESCE(ats.doorknocks, 0),
                'flyers', COALESCE(ats.doorknocks, 0),
                'conversations', COALESCE(ats.conversations, 0),
                'distance', COALESCE(ats.distance_km, 0.0),
                'leads', COALESCE(ats.leads, 0)
            ) AS all_time_snapshot
        FROM current_period cp
        INNER JOIN auth.users au ON au.id = cp.user_id
        LEFT JOIN public.profiles p ON p.id = cp.user_id
        LEFT JOIN daily_stats ds ON ds.user_id = cp.user_id
        LEFT JOIN weekly_stats ws ON ws.user_id = cp.user_id
        LEFT JOIN monthly_stats ms ON ms.user_id = cp.user_id
        LEFT JOIN all_time_stats ats ON ats.user_id = cp.user_id
    )
    SELECT
        ru.user_id,
        ru.display_name,
        ru.user_avatar,
        ru.user_brokerage,
        (
            ROW_NUMBER() OVER (
                ORDER BY
                    CASE p_metric
                        WHEN 'doorknocks' THEN ru.user_doorknocks::DOUBLE PRECISION
                        WHEN 'flyers' THEN ru.user_doorknocks::DOUBLE PRECISION
                        WHEN 'conversations' THEN ru.user_conversations::DOUBLE PRECISION
                        WHEN 'distance' THEN ru.user_distance
                        WHEN 'leads' THEN ru.user_leads::DOUBLE PRECISION
                        ELSE ru.user_doorknocks::DOUBLE PRECISION
                    END DESC,
                    ru.user_doorknocks DESC,
                    ru.user_conversations DESC,
                    ru.user_distance DESC,
                    ru.user_id ASC
            )
        )::INTEGER AS user_rank,
        ru.user_doorknocks,
        ru.user_doorknocks AS legacy_flyers,
        ru.user_leads,
        ru.user_conversations,
        ru.user_distance,
        ru.daily_snapshot,
        ru.weekly_snapshot,
        ru.monthly_snapshot,
        ru.all_time_snapshot
    FROM ranked_users ru
    ORDER BY user_rank
    LIMIT 100;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_my_assigned_routes"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT
    ra.id AS assignment_id,
    rp.id AS route_plan_id,
    rp.name,
    ra.status,
    rp.total_stops,
    rp.est_minutes,
    rp.distance_meters,
    ra.updated_at,
    ra.progress
  FROM public.route_assignments ra
  JOIN public.route_plans rp ON rp.id = ra.route_plan_id
  WHERE ra.workspace_id = p_workspace_id
    AND ra.assigned_to_user_id = auth.uid()
    AND public.is_workspace_member(p_workspace_id)
  ORDER BY ra.updated_at DESC
$function$;

CREATE OR REPLACE FUNCTION public."get_or_create_support_thread"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  uid uuid;
  row_count int;
  out_row public.support_threads;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Ensure profile exists (support_threads.user_id FK references profiles.id)
  INSERT INTO public.profiles (id, email, full_name, avatar_url, created_at, updated_at)
  SELECT
    uid,
    COALESCE(au.email, ''),
    COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name'),
    au.raw_user_meta_data->>'avatar_url',
    now(),
    now()
  FROM auth.users au
  WHERE au.id = uid
  ON CONFLICT (id) DO NOTHING;

  -- Return existing thread if any
  SELECT t.* INTO out_row
  FROM public.support_threads t
  WHERE t.user_id = uid
  LIMIT 1;

  IF FOUND THEN
    RETURN out_row;
  END IF;

  -- Insert new thread (we are SECURITY DEFINER so RLS does not apply)
  INSERT INTO public.support_threads (id, user_id, status, last_message_at, created_at)
  VALUES (gen_random_uuid(), uid, 'open', now(), now())
  RETURNING * INTO out_row;

  RETURN out_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_reporting_windows"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  v_tz text := COALESCE(NULLIF(btrim(p_timezone), ''), 'UTC');
  v_local_now timestamp;
  v_local_curr_start timestamp;
  v_local_prev_start timestamp;
  v_local_prev_prev_start timestamp;
  v_local_release timestamp;
BEGIN
  BEGIN
    v_local_now := p_now AT TIME ZONE v_tz;
  EXCEPTION
    WHEN invalid_parameter_value THEN
      v_tz := 'UTC';
      v_local_now := p_now AT TIME ZONE v_tz;
  END;

  -- Weekly: previous ISO week, due Monday 06:00 local.
  v_local_curr_start := date_trunc('week', v_local_now);
  v_local_prev_start := v_local_curr_start - interval '1 week';
  v_local_prev_prev_start := v_local_prev_start - interval '1 week';
  v_local_release := v_local_curr_start + interval '6 hours';

  period := 'weekly';
  period_start := v_local_prev_start AT TIME ZONE v_tz;
  period_end := v_local_curr_start AT TIME ZONE v_tz;
  previous_period_start := v_local_prev_prev_start AT TIME ZONE v_tz;
  previous_period_end := v_local_prev_start AT TIME ZONE v_tz;
  is_due := v_local_now >= v_local_release;
  RETURN NEXT;

  -- Monthly: previous month, due 1st 06:00 local.
  v_local_curr_start := date_trunc('month', v_local_now);
  v_local_prev_start := v_local_curr_start - interval '1 month';
  v_local_prev_prev_start := v_local_prev_start - interval '1 month';
  v_local_release := v_local_curr_start + interval '6 hours';

  period := 'monthly';
  period_start := v_local_prev_start AT TIME ZONE v_tz;
  period_end := v_local_curr_start AT TIME ZONE v_tz;
  previous_period_start := v_local_prev_prev_start AT TIME ZONE v_tz;
  previous_period_end := v_local_prev_start AT TIME ZONE v_tz;
  is_due := v_local_now >= v_local_release;
  RETURN NEXT;

  -- Yearly: previous year, due Jan 1 06:00 local.
  v_local_curr_start := date_trunc('year', v_local_now);
  v_local_prev_start := v_local_curr_start - interval '1 year';
  v_local_prev_prev_start := v_local_prev_start - interval '1 year';
  v_local_release := v_local_curr_start + interval '6 hours';

  period := 'yearly';
  period_start := v_local_prev_start AT TIME ZONE v_tz;
  period_end := v_local_curr_start AT TIME ZONE v_tz;
  previous_period_start := v_local_prev_prev_start AT TIME ZONE v_tz;
  previous_period_end := v_local_prev_start AT TIME ZONE v_tz;
  is_due := v_local_now >= v_local_release;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_roads_in_bbox"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  bbox_geom geometry(Polygon, 4326);
  bbox_geog geography;
  buffered geography;
BEGIN
  -- Validate inputs
  IF min_lon IS NULL OR min_lat IS NULL OR max_lon IS NULL OR max_lat IS NULL THEN
    RAISE EXCEPTION 'All bbox parameters are required';
  END IF;
  
  IF min_lon >= max_lon OR min_lat >= max_lat THEN
    RAISE EXCEPTION 'Invalid bbox: min must be less than max (got lon: % to %, lat: % to %)', 
      min_lon, max_lon, min_lat, max_lat;
  END IF;

  -- Bbox as polygon (closed ring)
  BEGIN
    bbox_geom := ST_SetSRID(
      ST_MakePolygon(ST_GeomFromText(
        'LINESTRING(' || 
        min_lon || ' ' || min_lat || ',' ||
        max_lon || ' ' || min_lat || ',' ||
        max_lon || ' ' || max_lat || ',' ||
        min_lon || ' ' || max_lat || ',' ||
        min_lon || ' ' || min_lat || ')'
      )),
      4326
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to create bbox geometry: %', SQLERRM;
  END;
  
  bbox_geog := bbox_geom::geography;
  buffered := ST_Buffer(bbox_geog, 100);

  RETURN QUERY
  SELECT
    t.gers_id,
    ST_AsGeoJSON(t.geom)::jsonb AS geojson
  FROM public.overture_transportation t
  WHERE ST_Intersects(t.geom::geography, buffered)
    AND (t.class IS NULL OR t.class NOT IN ('footway', 'cycleway', 'track', 'bridleway', 'path'));
    
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'get_roads_in_bbox error: %', SQLERRM;
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_route_plan_detail"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_plan public.route_plans%ROWTYPE;
  v_stops jsonb;
BEGIN
  SELECT rp.*
  INTO v_plan
  FROM public.route_plans rp
  WHERE rp.id = p_route_plan_id;

  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'route plan not found';
  END IF;

  IF NOT public.can_access_route_plan(p_route_plan_id, auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', rs.id,
        'route_plan_id', rs.route_plan_id,
        'stop_order', rs.stop_order,
        'address_id', rs.address_id,
        'gers_id', rs.gers_id,
        'lat', rs.lat,
        'lng', rs.lng,
        'display_address', rs.display_address,
        'building_id', rs.building_id,
        'created_at', rs.created_at
      )
      ORDER BY rs.stop_order
    ),
    '[]'::jsonb
  )
  INTO v_stops
  FROM public.route_stops rs
  WHERE rs.route_plan_id = p_route_plan_id;

  RETURN jsonb_build_object(
    'plan', to_jsonb(v_plan),
    'segments', COALESCE(v_plan.segments, '[]'::jsonb),
    'stops', COALESCE(v_stops, '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_team_activity_feed"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_rows jsonb;
  v_total bigint;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) AND NOT (
    p_workspace_id = ANY(public.current_user_workspace_ids())
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.activity_events ae
  WHERE ae.workspace_id = p_workspace_id
    AND ae.event_time >= p_start_ts
    AND ae.event_time <= p_end_ts
    AND (p_type_filter IS NULL OR ae.event_type = p_type_filter)
    AND (public.is_workspace_owner_or_admin(p_workspace_id) OR ae.user_id = auth.uid());

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT
      ae.id,
      ae.user_id,
      ae.event_type,
      ae.event_time,
      ae.ref_id,
      ae.payload,
      ae.created_at,
      COALESCE(
        trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
        u.raw_user_meta_data->>'full_name',
        split_part(u.email, '@', 1),
        'Member'
      ) AS display_name
    FROM public.activity_events ae
    LEFT JOIN auth.users u ON u.id = ae.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = ae.user_id
    WHERE ae.workspace_id = p_workspace_id
      AND ae.event_time >= p_start_ts
      AND ae.event_time <= p_end_ts
      AND (p_type_filter IS NULL OR ae.event_type = p_type_filter)
      AND (public.is_workspace_owner_or_admin(p_workspace_id) OR ae.user_id = auth.uid())
    ORDER BY ae.event_time DESC
    LIMIT p_limit_count
    OFFSET p_offset_count
  ) t;

  RETURN jsonb_build_object(
    'events', COALESCE(v_rows, '[]'::jsonb),
    'total', v_total
  );
END;
$function$; -- overload 1

CREATE OR REPLACE FUNCTION public."get_team_activity_feed"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_source text;
  v_workspace_predicate text;
  v_ref_expr text;
  v_rows jsonb;
  v_total bigint := 0;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit_count, 50), 1), 500);
  v_offset integer := GREATEST(COALESCE(p_offset_count, 0), 0);
  v_has_session_events_workspace_id boolean := false;
  v_has_activity_events_workspace_id boolean := false;
  v_has_session_events_session_id boolean := false;
  v_has_activity_events_ref_id boolean := false;
  v_has_sessions_workspace_id boolean := false;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'workspace_id'
  ) INTO v_has_session_events_workspace_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activity_events' AND column_name = 'workspace_id'
  ) INTO v_has_activity_events_workspace_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'session_id'
  ) INTO v_has_session_events_session_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'activity_events' AND column_name = 'ref_id'
  ) INTO v_has_activity_events_ref_id;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'workspace_id'
  ) INTO v_has_sessions_workspace_id;

  IF to_regclass('public.session_events') IS NOT NULL AND v_has_session_events_workspace_id THEN
    v_source := 'session_events';
    v_workspace_predicate := 'e.workspace_id = $1';
    v_ref_expr := 'NULL::uuid';
  ELSIF to_regclass('public.activity_events') IS NOT NULL AND v_has_activity_events_workspace_id THEN
    v_source := 'activity_events';
    v_workspace_predicate := 'e.workspace_id = $1';
    v_ref_expr := CASE WHEN v_has_activity_events_ref_id THEN 'e.ref_id' ELSE 'NULL::uuid' END;
  ELSIF
    to_regclass('public.session_events') IS NOT NULL
    AND v_has_session_events_session_id
    AND to_regclass('public.sessions') IS NOT NULL
    AND v_has_sessions_workspace_id
  THEN
    v_source := 'session_events';
    v_workspace_predicate := 'EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = e.session_id AND s.workspace_id = $1)';
    v_ref_expr := 'NULL::uuid';
  ELSE
    RETURN jsonb_build_object('events', '[]'::jsonb, 'total', 0);
  END IF;

  EXECUTE format(
    'SELECT COUNT(*)
     FROM public.%I e
     WHERE %s
       AND e.event_time >= $2
       AND e.event_time <= $3
       AND ($4 IS NULL OR e.event_type = $4)
       AND ($5 IS NULL OR e.user_id = $5)',
    v_source,
    v_workspace_predicate
  )
  INTO v_total
  USING p_workspace_id, p_start_ts, p_end_ts, p_type_filter, p_user_id;

  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), ''[]''::jsonb)
     FROM (
       SELECT
         e.id,
         e.user_id,
         e.event_type,
         e.event_time,
         %s AS ref_id,
         e.payload,
         e.created_at,
         COALESCE(
           NULLIF(trim(COALESCE(up.first_name, '''') || '' '' || COALESCE(up.last_name, '''')), ''''),
           ''Member''
         ) AS display_name
       FROM public.%I e
       LEFT JOIN public.user_profiles up ON up.user_id = e.user_id
       WHERE %s
         AND e.event_time >= $2
         AND e.event_time <= $3
         AND ($4 IS NULL OR e.event_type = $4)
         AND ($5 IS NULL OR e.user_id = $5)
       ORDER BY e.event_time DESC
       LIMIT $6
       OFFSET $7
     ) t',
    v_ref_expr,
    v_source,
    v_workspace_predicate
  )
  INTO v_rows
  USING p_workspace_id, p_start_ts, p_end_ts, p_type_filter, p_user_id, v_limit, v_offset;

  RETURN jsonb_build_object(
    'events', COALESCE(v_rows, '[]'::jsonb),
    'total', COALESCE(v_total, 0)
  );
END;
$function$; -- overload 2

CREATE OR REPLACE FUNCTION public."get_team_dashboard_summary"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_cur_doors int := 0;
  v_cur_convos int := 0;
  v_cur_flyers int := 0;
  v_cur_sessions int := 0;
  v_cur_duration int := 0;
  v_prev_doors int := 0;
  v_prev_convos int := 0;
  v_prev_flyers int := 0;
  v_prev_sessions int := 0;
  v_prev_duration int := 0;
  v_doors_by_day jsonb;
  v_interval interval;
  v_prev_start timestamptz;
  v_prev_end timestamptz;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  v_interval := p_end_ts - p_start_ts;
  v_prev_end := p_start_ts;
  v_prev_start := p_start_ts - v_interval;

  SELECT
    COALESCE(SUM(ss.doors_hit), 0)::int,
    COALESCE(SUM(ss.conversations), 0)::int,
    COALESCE(SUM(ss.flyers_delivered), 0)::int,
    COUNT(ss.id)::int,
    COALESCE(SUM(ss.active_seconds), 0)::int
  INTO v_cur_doors, v_cur_convos, v_cur_flyers, v_cur_sessions, v_cur_duration
  FROM public.sessions ss
  WHERE ss.workspace_id = p_workspace_id
    AND ss.start_time >= p_start_ts
    AND ss.start_time <= p_end_ts;

  SELECT
    COALESCE(SUM(ss.doors_hit), 0)::int,
    COALESCE(SUM(ss.conversations), 0)::int,
    COALESCE(SUM(ss.flyers_delivered), 0)::int,
    COUNT(ss.id)::int,
    COALESCE(SUM(ss.active_seconds), 0)::int
  INTO v_prev_doors, v_prev_convos, v_prev_flyers, v_prev_sessions, v_prev_duration
  FROM public.sessions ss
  WHERE ss.workspace_id = p_workspace_id
    AND ss.start_time >= v_prev_start
    AND ss.start_time < v_prev_end;

  SELECT COALESCE(jsonb_agg(row_to_json(d)::jsonb ORDER BY d.day_date), '[]'::jsonb) INTO v_doors_by_day
  FROM (
    SELECT
      date_trunc('day', ss.start_time)::date AS day_date,
      COALESCE(SUM(ss.doors_hit), 0)::int AS doors
    FROM public.sessions ss
    WHERE ss.workspace_id = p_workspace_id
      AND ss.start_time >= p_start_ts
      AND ss.start_time <= p_end_ts
    GROUP BY date_trunc('day', ss.start_time)::date
  ) d;

  RETURN jsonb_build_object(
    'totals', jsonb_build_object(
      'doors', v_cur_doors,
      'convos', v_cur_convos,
      'flyers', v_cur_flyers,
      'followups', 0,
      'appointments', 0,
      'sessions_count', v_cur_sessions,
      'total_duration_seconds', v_cur_duration
    ),
    'previousTotals', jsonb_build_object(
      'doors', v_prev_doors,
      'convos', v_prev_convos,
      'flyers', v_prev_flyers,
      'followups', 0,
      'appointments', 0,
      'sessions_count', v_prev_sessions,
      'total_duration_seconds', v_prev_duration
    ),
    'deltas', jsonb_build_object(
      'doors', v_cur_doors - v_prev_doors,
      'convos', v_cur_convos - v_prev_convos,
      'flyers', v_cur_flyers - v_prev_flyers,
      'followups', 0,
      'appointments', 0,
      'sessions_count', v_cur_sessions - v_prev_sessions,
      'total_duration_seconds', v_cur_duration - v_prev_duration
    ),
    'doorsByDay', COALESCE(v_doors_by_day, '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_team_leaderboard"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      wm.user_id,
      COALESCE(
        trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
        u.raw_user_meta_data->>'full_name',
        split_part(u.email, '@', 1),
        'Member'
      ) AS display_name,
      COALESCE(wm.color, '#3B82F6') AS color,
      COALESCE(SUM((fs.stats->>'doors_knocked')::int), 0)::int AS doors_knocked,
      COALESCE(SUM((fs.stats->>'conversations')::int), 0)::int AS conversations,
      COALESCE(SUM((fs.stats->>'followups')::int), 0)::int AS followups,
      COALESCE(SUM((fs.stats->>'appointments')::int), 0)::int AS appointments,
      COUNT(fs.id)::int AS sessions_count
    FROM public.workspace_members wm
    LEFT JOIN auth.users u ON u.id = wm.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = wm.user_id
    LEFT JOIN public.field_sessions fs ON fs.workspace_id = wm.workspace_id AND fs.user_id = wm.user_id
      AND fs.started_at >= p_start_ts AND fs.started_at <= p_end_ts
    WHERE wm.workspace_id = p_workspace_id
    GROUP BY wm.user_id, wm.color, up.first_name, up.last_name, u.raw_user_meta_data, u.email
    ORDER BY COALESCE(SUM((fs.stats->>'doors_knocked')::int), 0) DESC,
             COALESCE(SUM((fs.stats->>'conversations')::int), 0) DESC
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public."get_team_map_data"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_members jsonb := '[]'::jsonb;
  v_sessions jsonb := '[]'::jsonb;
  v_knock_points jsonb := '[]'::jsonb;
  v_has_sessions_workspace_id boolean := false;
  v_has_session_events_workspace_id boolean := false;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.display_name), '[]'::jsonb) INTO v_members
  FROM (
    SELECT
      wm.user_id,
      COALESCE(
        NULLIF(trim(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''),
        'Member'
      ) AS display_name,
      COALESCE(wm.color, '#3B82F6') AS color
    FROM public.workspace_members wm
    LEFT JOIN public.user_profiles up ON up.user_id = wm.user_id
    WHERE wm.workspace_id = p_workspace_id
    ORDER BY 2
  ) t;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions' AND column_name = 'workspace_id'
  ) INTO v_has_sessions_workspace_id;

  IF to_regclass('public.sessions') IS NOT NULL AND v_has_sessions_workspace_id THEN
    SELECT COALESCE(jsonb_agg(row_to_json(s)::jsonb ORDER BY s.started_at DESC), '[]'::jsonb) INTO v_sessions
    FROM (
      SELECT
        ss.id AS session_id,
        ss.user_id,
        ss.start_time AS started_at,
        ss.end_time AS ended_at,
        COALESCE(ss.active_seconds, 0)::int AS duration_seconds,
        COALESCE(ss.distance_meters, 0)::int AS distance_meters,
        COALESCE(ss.doors_hit, 0)::int AS doors_hit,
        COALESCE(ss.conversations, 0)::int AS conversations,
        COALESCE(ss.flyers_delivered, 0)::int AS flyers_delivered,
        ss.path_geojson
      FROM public.sessions ss
      WHERE ss.workspace_id = p_workspace_id
        AND ss.start_time >= p_start_ts
        AND ss.start_time <= p_end_ts
      ORDER BY ss.start_time DESC
      LIMIT LEAST(GREATEST(COALESCE(p_limit_sessions, 500), 1), 2000)
    ) s;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'session_events' AND column_name = 'workspace_id'
  ) INTO v_has_session_events_workspace_id;

  IF to_regclass('public.session_events') IS NOT NULL AND v_has_session_events_workspace_id THEN
    SELECT COALESCE(jsonb_agg(row_to_json(k)::jsonb ORDER BY k.event_time DESC), '[]'::jsonb) INTO v_knock_points
    FROM (
      SELECT
        se.id,
        se.user_id,
        se.event_time,
        se.event_type,
        se.payload,
        COALESCE(
          NULLIF(trim(COALESCE(up.first_name, '') || ' ' || COALESCE(up.last_name, '')), ''),
          'Member'
        ) AS display_name
      FROM public.session_events se
      LEFT JOIN public.user_profiles up ON up.user_id = se.user_id
      WHERE se.workspace_id = p_workspace_id
        AND se.event_time >= p_start_ts
        AND se.event_time <= p_end_ts
        AND se.event_type = 'knock'
        AND jsonb_typeof(se.payload) = 'object'
        AND (se.payload ? 'lat')
        AND (se.payload ? 'lng')
      ORDER BY se.event_time DESC
    ) k;
  END IF;

  RETURN jsonb_build_object(
    'members', COALESCE(v_members, '[]'::jsonb),
    'sessions', COALESCE(v_sessions, '[]'::jsonb),
    'knockPoints', COALESCE(v_knock_points, '[]'::jsonb)
  );
END;
$function$; -- overload 1

CREATE OR REPLACE FUNCTION public."get_team_map_data"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_members jsonb;
  v_sessions jsonb;
  v_result jsonb;
BEGIN
  IF NOT public.is_workspace_owner_or_admin(p_workspace_id) AND NOT (
    p_workspace_id = ANY(public.current_user_workspace_ids())
  ) THEN
    RETURN jsonb_build_object('error', 'forbidden');
  END IF;

  -- Members with display name and color (owner/admin see all; member sees self only)
  SELECT COALESCE(jsonb_agg(m), '[]'::jsonb) INTO v_members
  FROM (
    SELECT
      wm.user_id,
      COALESCE(
        trim(up.first_name || ' ' || COALESCE(up.last_name, '')),
        u.raw_user_meta_data->>'full_name',
        split_part(u.email, '@', 1),
        'Member'
      ) AS display_name,
      COALESCE(wm.color, '#3B82F6') AS color
    FROM public.workspace_members wm
    LEFT JOIN auth.users u ON u.id = wm.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = wm.user_id
    WHERE wm.workspace_id = p_workspace_id
      AND (
        public.is_workspace_owner_or_admin(p_workspace_id)
        OR wm.user_id = auth.uid()
      )
  ) m;

  -- Sessions in range with route as GeoJSON and stats
  SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) INTO v_sessions
  FROM (
    SELECT
      fs.id AS session_id,
      fs.user_id,
      fs.started_at,
      fs.ended_at,
      fs.duration_seconds,
      fs.stats,
      CASE WHEN fs.route IS NOT NULL THEN ST_AsGeoJSON(fs.route)::jsonb ELSE NULL END AS route_geojson
    FROM public.field_sessions fs
    WHERE fs.workspace_id = p_workspace_id
      AND fs.started_at >= p_start_ts
      AND fs.started_at <= p_end_ts
      AND (public.is_workspace_owner_or_admin(p_workspace_id) OR fs.user_id = auth.uid())
    ORDER BY fs.started_at DESC
    LIMIT p_limit_sessions
  ) s;

  v_result := jsonb_build_object(
    'members', COALESCE(v_members, '[]'::jsonb),
    'sessions', COALESCE(v_sessions, '[]'::jsonb)
  );
  RETURN v_result;
END;
$function$; -- overload 2

CREATE OR REPLACE FUNCTION public."get_user_stats_for_period"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  v_start timestamptz;
  v_end   timestamptz := now();
  v_qr   integer;
BEGIN
  IF p_period = 'lifetime' THEN
    -- Return existing user_stats row
    RETURN QUERY
    SELECT
      us.id,
      us.user_id,
      COALESCE(us.day_streak, 0)::integer,
      COALESCE(us.best_streak, 0)::integer,
      COALESCE(us.doors_knocked, 0)::integer,
      COALESCE(us.flyers, 0)::integer,
      COALESCE(us.conversations, 0)::integer,
      COALESCE(us.leads_created, 0)::integer,
      COALESCE(us.qr_codes_scanned, 0)::integer,
      COALESCE(us.distance_walked, 0)::numeric,
      COALESCE(us.time_tracked, 0)::numeric,
      COALESCE(us.conversation_per_door, 0)::numeric,
      COALESCE(us.conversation_lead_rate, 0)::numeric,
      COALESCE(us.qr_code_scan_rate, 0)::numeric,
      COALESCE(us.qr_code_lead_rate, 0)::numeric,
      us.streak_days,
      COALESCE(us.xp, 0)::integer,
      COALESCE(us.routes_walked, 0)::integer,
      us.updated_at,
      us.created_at
    FROM public.user_stats us
    WHERE us.user_id = p_user_id
    LIMIT 1;
    RETURN;
  END IF;

  -- Date range for daily / weekly / monthly
  v_start := CASE p_period
    WHEN 'daily'   THEN date_trunc('day', v_end)
    WHEN 'weekly'  THEN date_trunc('week', v_end)
    WHEN 'monthly' THEN date_trunc('month', v_end)
    ELSE date_trunc('day', v_end)
  END;

  -- QR scans in period: scan_events for campaigns owned by user
  SELECT COUNT(*)::integer INTO v_qr
  FROM public.scan_events se
  JOIN public.campaigns c ON c.id = se.campaign_id AND c.owner_id = p_user_id
  WHERE se.scanned_at >= v_start AND se.scanned_at < v_end;

  -- Return one row with period stats (qr from scan_events; rest 0; streaks/updated_at from user_stats if row exists)
  RETURN QUERY
  SELECT
    gen_random_uuid(),
    p_user_id,
    COALESCE(us.day_streak, 0)::integer,
    COALESCE(us.best_streak, 0)::integer,
    0::integer,
    0::integer,
    0::integer,
    0::integer,
    COALESCE(v_qr, 0),
    0::numeric,
    0::numeric,
    0::numeric,
    0::numeric,
    0::numeric,
    0::numeric,
    us.streak_days,
    0::integer,
    0::integer,
    COALESCE(us.updated_at, now()),
    us.created_at
  FROM (SELECT 1) dummy
  LEFT JOIN public.user_stats us ON us.user_id = p_user_id
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public."handle_new_scan"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  -- Update the building status so the map changes color
  UPDATE public.buildings
  SET latest_status = 'visited' -- or 'scanned'
  WHERE gers_id = NEW.gers_id;
  
  -- Update the contact status if a contact is linked to this building
  UPDATE public.contacts
  SET status = 'scanned'
  WHERE gers_id = NEW.gers_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."handle_new_user"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, created_at, updated_at)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url',
    now(),
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."has_workspace_role"()
RETURNS boolean
LANGUAGE sql
AS $function$

  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.user_id = p_user_id
      AND wm.role = ANY(p_roles)
  )
$function$;

CREATE OR REPLACE FUNCTION public."hex_to_uuid"()
RETURNS uuid
LANGUAGE plpgsql
AS $function$

BEGIN
  -- Handle NULL input
  IF hex_str IS NULL OR trim(hex_str) = '' THEN
    RETURN NULL;
  END IF;
  
  -- If already in UUID format (with hyphens), cast directly
  IF hex_str ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN hex_str::uuid;
  -- If pure hex (32 chars), format as UUID (8-4-4-4-12)
  ELSIF length(hex_str) = 32 AND hex_str ~ '^[0-9a-fA-F]+$' THEN
    RETURN (
      lower(substring(hex_str from 1 for 8)) || '-' ||
      lower(substring(hex_str from 9 for 4)) || '-' ||
      lower(substring(hex_str from 13 for 4)) || '-' ||
      lower(substring(hex_str from 17 for 4)) || '-' ||
      lower(substring(hex_str from 21 for 12))
    )::uuid;
  -- If longer hex string (might be 36+ chars with dashes but wrong format), try to extract
  ELSIF length(hex_str) >= 32 THEN
    -- Try to extract first 32 hex characters
    DECLARE
      clean_hex text;
    BEGIN
      clean_hex := regexp_replace(hex_str, '[^0-9a-fA-F]', '', 'g');
      IF length(clean_hex) >= 32 THEN
        RETURN (
          lower(substring(clean_hex from 1 for 8)) || '-' ||
          lower(substring(clean_hex from 9 for 4)) || '-' ||
          lower(substring(clean_hex from 13 for 4)) || '-' ||
          lower(substring(clean_hex from 17 for 4)) || '-' ||
          lower(substring(clean_hex from 21 for 12))
        )::uuid;
      END IF;
    END;
  END IF;
  
  -- Invalid format
  RETURN NULL;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but return NULL (validation script will catch these)
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public."homes_nearby"()
RETURNS record
LANGUAGE sql
AS $function$

    WITH args AS (
        SELECT
            ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography AS center_geog,
            GREATEST(COALESCE(radius_m, 500), 1)::DOUBLE PRECISION AS radius_limit,
            LEAST(GREATEST(COALESCE(limit_n, 300), 1), 1000)::INTEGER AS row_limit
    )
    SELECT
        a.id AS address_id,
        ST_Y(a.geom::geometry) AS lat,
        ST_X(a.geom::geometry) AS lng,
        COALESCE(
            NULLIF(
                concat_ws(', ',
                    NULLIF(trim(concat_ws(' ',
                        NULLIF(a.street_number, ''),
                        NULLIF(a.street_name, ''),
                        NULLIF(a.unit, '')
                    )), ''),
                    NULLIF(a.city, ''),
                    NULLIF(a.province, ''),
                    NULLIF(a.country, '')
                ),
                ''
            ),
            a.source_id,
            a.id::text
        ) AS display_address,
        ST_Distance(a.geom::geography, args.center_geog) AS distance_m
    FROM public.ref_addresses_gold a
    CROSS JOIN args
    WHERE auth.uid() IS NOT NULL
      AND (p_workspace_id IS NULL OR public.is_workspace_member(p_workspace_id))
      AND a.geom IS NOT NULL
      AND ST_DWithin(a.geom::geography, args.center_geog, args.radius_limit)
    ORDER BY distance_m ASC, a.id
    LIMIT (SELECT row_limit FROM args);
$function$;

CREATE OR REPLACE FUNCTION public."increment_building_scans"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
    -- First try to update existing record
    UPDATE public.building_stats
    SET 
        scans_total = scans_total + 1,
        scans_today = CASE 
            WHEN date_trunc('day', last_scan_at) = date_trunc('day', now())
            THEN scans_today + 1
            ELSE 1
        END,
        last_scan_at = now(),
        status = 'visited',
        updated_at = now()
    WHERE gers_id = p_gers_id;
    
    -- If no row was updated, insert new record
    IF NOT FOUND THEN
        INSERT INTO public.building_stats (
            gers_id,
            campaign_id,
            scans_total,
            scans_today,
            last_scan_at,
            status,
            updated_at
        ) VALUES (
            p_gers_id,
            p_campaign_id,
            1,
            1,
            now(),
            'visited',
            now()
        )
        ON CONFLICT (gers_id) DO UPDATE SET
            scans_total = building_stats.scans_total + 1,
            scans_today = CASE 
                WHEN date_trunc('day', building_stats.last_scan_at) = date_trunc('day', now())
                THEN building_stats.scans_today + 1
                ELSE 1
            END,
            last_scan_at = now(),
            status = 'visited',
            updated_at = now();
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public."increment_scan"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
  UPDATE campaign_addresses 
  SET visited = true, 
      scans = COALESCE(scans, 0) + 1,
      last_scanned_at = NOW()
  WHERE id = row_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public."increment_user_stats"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
    INSERT INTO public.user_stats (
        user_id,
        flyers,
        conversations,
        leads_created,
        distance_walked,
        time_tracked
    )
    VALUES (
        p_user_id,
        p_flyers,
        p_conversations,
        p_leads,
        p_distance_km,
        p_time_minutes
    )
    ON CONFLICT (user_id) DO UPDATE SET
        flyers = user_stats.flyers + EXCLUDED.flyers,
        conversations = user_stats.conversations + EXCLUDED.conversations,
        leads_created = user_stats.leads_created + EXCLUDED.leads_created,
        distance_walked = user_stats.distance_walked + EXCLUDED.distance_walked,
        time_tracked = user_stats.time_tracked + EXCLUDED.time_tracked,
        updated_at = NOW();
END;
$function$;

CREATE OR REPLACE FUNCTION public."ingest_campaign_raw_data"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_addresses_array JSONB;
  v_buildings_array JSONB;
  v_roads_array JSONB;
  v_addr_count INTEGER := 0;
  v_build_count INTEGER := 0;
  v_roads_count INTEGER := 0;
BEGIN
  -- Normalize scalar string to array
  IF jsonb_typeof(p_addresses) = 'string' THEN
    v_addresses_array := (p_addresses#>>'{}')::jsonb;
  ELSE
    v_addresses_array := p_addresses;
  END IF;
  IF jsonb_typeof(p_buildings) = 'string' THEN
    v_buildings_array := (p_buildings#>>'{}')::jsonb;
  ELSE
    v_buildings_array := p_buildings;
  END IF;
  IF jsonb_typeof(p_roads) = 'string' THEN
    v_roads_array := (p_roads#>>'{}')::jsonb;
  ELSE
    v_roads_array := p_roads;
  END IF;
  IF v_addresses_array IS NULL OR jsonb_typeof(v_addresses_array) != 'array' THEN
    v_addresses_array := '[]'::jsonb;
  END IF;
  IF v_buildings_array IS NULL OR jsonb_typeof(v_buildings_array) != 'array' THEN
    v_buildings_array := '[]'::jsonb;
  END IF;
  IF v_roads_array IS NULL OR jsonb_typeof(v_roads_array) != 'array' THEN
    v_roads_array := '[]'::jsonb;
  END IF;

  -- 1. Wipe links and slices for this campaign
  DELETE FROM public.building_slices WHERE campaign_id = p_campaign_id;
  DELETE FROM public.building_address_links WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_addresses WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_roads WHERE campaign_id = p_campaign_id;

  -- 2. Ingest Roads (with DISTINCT ON to prevent duplicate gers_id)
  INSERT INTO public.campaign_roads (campaign_id, gers_id, geom)
  SELECT DISTINCT ON (r->>'gers_id')
    p_campaign_id,
    r->>'gers_id',
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(r->>'geometry'), 4326))
  FROM jsonb_array_elements(v_roads_array) AS r
  WHERE r->>'geometry' IS NOT NULL
  ORDER BY r->>'gers_id';

  GET DIAGNOSTICS v_roads_count = ROW_COUNT;

  -- 3. Ingest Addresses (with DISTINCT ON to prevent duplicate gers_id)
  INSERT INTO public.campaign_addresses (campaign_id, gers_id, house_number, street_name, postal_code, formatted, geom)
  SELECT DISTINCT ON (addr->>'gers_id')
    p_campaign_id,
    addr->>'gers_id',
    addr->>'house_number',
    addr->>'street_name',
    addr->>'postal_code',
    COALESCE(addr->>'formatted', trim(concat_ws(' ', addr->>'house_number', addr->>'street_name', nullif(concat(', ', addr->>'postal_code'), ', ')))),
    ST_SetSRID(ST_GeomFromGeoJSON(addr->>'geometry'), 4326)
  FROM jsonb_array_elements(v_addresses_array) AS addr
  WHERE addr->>'geometry' IS NOT NULL
  ORDER BY addr->>'gers_id';

  GET DIAGNOSTICS v_addr_count = ROW_COUNT;

  -- 4. Ingest Buildings with addr_street from Overture for better matching
  INSERT INTO public.buildings (
    gers_id, 
    geom, 
    centroid, 
    height_m, 
    campaign_id, 
    latest_status,
    addr_street  -- Store Overture street name for matching
  )
  SELECT DISTINCT ON (b->>'gers_id')
    b->>'gers_id',
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
    ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
    COALESCE((b->>'height')::numeric, 8),
    p_campaign_id,
    'default',
    b->>'addr_street'  -- Capture Overture address street if available
  FROM jsonb_array_elements(v_buildings_array) AS b
  WHERE b->>'geometry' IS NOT NULL AND b->>'gers_id' IS NOT NULL
  ORDER BY b->>'gers_id'
  ON CONFLICT (gers_id) DO UPDATE SET
    campaign_id = p_campaign_id,
    latest_status = 'default',
    geom = EXCLUDED.geom,
    centroid = EXCLUDED.centroid,
    height_m = EXCLUDED.height_m,
    addr_street = EXCLUDED.addr_street;  -- Update street name on conflict

  GET DIAGNOSTICS v_build_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'success',
    'addresses_saved', v_addr_count,
    'buildings_saved', v_build_count,
    'roads_saved', v_roads_count
  );
END;
$function$; -- overload 1

CREATE OR REPLACE FUNCTION public."ingest_campaign_raw_data"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_addresses_array JSONB;
  v_buildings_array JSONB;
  v_roads_array JSONB;
  v_parcels_array JSONB;
  v_addr_count INTEGER := 0;
  v_build_count INTEGER := 0;
  v_roads_count INTEGER := 0;
  v_parcels_count INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_addresses) = 'string' THEN
    v_addresses_array := (p_addresses#>>'{}')::jsonb;
  ELSE
    v_addresses_array := p_addresses;
  END IF;
  IF jsonb_typeof(p_buildings) = 'string' THEN
    v_buildings_array := (p_buildings#>>'{}')::jsonb;
  ELSE
    v_buildings_array := p_buildings;
  END IF;
  IF jsonb_typeof(p_roads) = 'string' THEN
    v_roads_array := (p_roads#>>'{}')::jsonb;
  ELSE
    v_roads_array := p_roads;
  END IF;
  IF p_parcels IS NOT NULL THEN
    IF jsonb_typeof(p_parcels) = 'string' THEN
      v_parcels_array := (p_parcels#>>'{}')::jsonb;
    ELSE
      v_parcels_array := p_parcels;
    END IF;
  END IF;
  
  IF v_addresses_array IS NULL OR jsonb_typeof(v_addresses_array) != 'array' THEN
    v_addresses_array := '[]'::jsonb;
  END IF;
  IF v_buildings_array IS NULL OR jsonb_typeof(v_buildings_array) != 'array' THEN
    v_buildings_array := '[]'::jsonb;
  END IF;
  IF v_roads_array IS NULL OR jsonb_typeof(v_roads_array) != 'array' THEN
    v_roads_array := '[]'::jsonb;
  END IF;
  IF v_parcels_array IS NULL OR jsonb_typeof(v_parcels_array) != 'array' THEN
    v_parcels_array := '[]'::jsonb;
  END IF;

  DELETE FROM public.building_slices WHERE campaign_id = p_campaign_id;
  DELETE FROM public.building_address_links WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_parcels WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_addresses WHERE campaign_id = p_campaign_id;
  DELETE FROM public.campaign_roads WHERE campaign_id = p_campaign_id;

  INSERT INTO public.campaign_roads (campaign_id, gers_id, geom)
  SELECT DISTINCT ON (r->>'gers_id')
    p_campaign_id,
    r->>'gers_id',
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(r->>'geometry'), 4326))
  FROM jsonb_array_elements(v_roads_array) AS r
  WHERE r->>'geometry' IS NOT NULL
  ORDER BY r->>'gers_id';
  GET DIAGNOSTICS v_roads_count = ROW_COUNT;

  INSERT INTO public.campaign_parcels (campaign_id, external_id, geom, properties)
  SELECT DISTINCT ON (p->>'PARCELID')
    p_campaign_id,
    p->>'PARCELID',
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(p->>'geometry'), 4326)),
    p - 'geometry'
  FROM jsonb_array_elements(v_parcels_array) AS p
  WHERE p->>'geometry' IS NOT NULL
  ORDER BY p->>'PARCELID';
  GET DIAGNOSTICS v_parcels_count = ROW_COUNT;

  INSERT INTO public.campaign_addresses (campaign_id, gers_id, house_number, street_name, postal_code, formatted, geom)
  SELECT DISTINCT ON (addr->>'gers_id')
    p_campaign_id,
    addr->>'gers_id',
    addr->>'house_number',
    addr->>'street_name',
    addr->>'postal_code',
    COALESCE(addr->>'formatted', trim(concat_ws(' ', addr->>'house_number', addr->>'street_name', nullif(concat(', ', addr->>'postal_code'), ', ')))),
    ST_SetSRID(ST_GeomFromGeoJSON(addr->>'geometry'), 4326)
  FROM jsonb_array_elements(v_addresses_array) AS addr
  WHERE addr->>'geometry' IS NOT NULL
  ORDER BY addr->>'gers_id';
  GET DIAGNOSTICS v_addr_count = ROW_COUNT;

  INSERT INTO public.buildings (
    gers_id, geom, centroid, height_m, campaign_id, latest_status, addr_street
  )
  SELECT DISTINCT ON (b->>'gers_id')
    b->>'gers_id',
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
    ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)),
    COALESCE((b->>'height')::numeric, 8),
    p_campaign_id,
    'default',
    b->>'addr_street'
  FROM jsonb_array_elements(v_buildings_array) AS b
  WHERE b->>'geometry' IS NOT NULL AND b->>'gers_id' IS NOT NULL
  ORDER BY b->>'gers_id'
  ON CONFLICT (gers_id) DO UPDATE SET
    campaign_id = p_campaign_id,
    latest_status = 'default',
    geom = EXCLUDED.geom,
    centroid = EXCLUDED.centroid,
    height_m = EXCLUDED.height_m,
    addr_street = EXCLUDED.addr_street;
  GET DIAGNOSTICS v_build_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'success',
    'addresses_saved', v_addr_count,
    'buildings_saved', v_build_count,
    'roads_saved', v_roads_count,
    'parcels_saved', v_parcels_count
  );
END;
$function$; -- overload 2

CREATE OR REPLACE FUNCTION public."insert_address_orphans_batch"()
RETURNS void
LANGUAGE plpgsql
AS $function$

DECLARE
  r jsonb;
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    INSERT INTO public.address_orphans (
      campaign_id,
      address_id,
      nearest_building_id,
      nearest_distance,
      nearest_building_street,
      address_street,
      street_match_score,
      suggested_buildings,
      status,
      suggested_street,
      coordinate
    )
    VALUES (
      p_campaign_id,
      (r->>'address_id')::uuid,
      nullif(r->>'nearest_building_id', ''),
      (r->>'nearest_distance')::float,
      nullif(r->>'nearest_building_street', ''),
      nullif(r->>'address_street', ''),
      (r->>'street_match_score')::float,
      COALESCE(r->'suggested_buildings', '[]'::jsonb),
      COALESCE(nullif(r->>'status', ''), 'pending_review'),
      nullif(r->>'suggested_street', ''),
      CASE
        WHEN r ? 'lon' AND r ? 'lat' THEN ST_SetSRID(ST_MakePoint((r->>'lon')::double precision, (r->>'lat')::double precision), 4326)
        ELSE NULL
      END
    );
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public."insert_manual_address"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_id UUID;
BEGIN
    INSERT INTO campaign_addresses (
        campaign_id,
        address,
        formatted,
        house_number,
        street_name,
        locality,
        region,
        postal_code,
        source,
        building_gers_id,
        geom,
        coordinate,
        visited
    )
    VALUES (
        p_campaign_id,
        p_address,
        p_formatted,
        p_house_number,
        p_street_name,
        p_locality,
        p_region,
        p_postal_code,
        p_source,
        p_building_gers_id,
        CASE
            WHEN p_geom_json IS NOT NULL THEN ST_GeomFromGeoJSON(p_geom_json)::geometry(Point, 4326)
            ELSE NULL
        END,
        p_coordinate,
        p_visited
    )
    RETURNING campaign_addresses.id INTO v_id;

    RETURN QUERY
    SELECT
        ca.id,
        ca.address,
        ca.formatted,
        ca.house_number,
        ca.street_name,
        ca.locality,
        ca.region,
        ca.postal_code,
        ca.building_gers_id,
        ca.source
    FROM campaign_addresses ca
    WHERE ca.id = v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public."invalidate_campaign_polished_building_features"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

DECLARE
  v_campaign_id UUID;
BEGIN
  v_campaign_id := COALESCE(NEW.campaign_id, OLD.campaign_id);
  IF v_campaign_id IS NOT NULL THEN
    DELETE FROM public.campaign_polished_building_features
    WHERE campaign_id = v_campaign_id;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."invalidate_campaign_polished_building_features_from_campaign"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  DELETE FROM public.campaign_polished_building_features
  WHERE campaign_id = NEW.id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."is_campaign_member"()
RETURNS boolean
LANGUAGE sql
AS $function$

    SELECT EXISTS (
        SELECT 1
        FROM public.campaigns c
        WHERE c.id = p_campaign_id
          AND (
              (c.owner_id::text) = (p_user_id::text)
              OR (c.workspace_id IS NOT NULL AND EXISTS (
                  SELECT 1
                  FROM public.workspaces w
                  WHERE w.id = c.workspace_id
                    AND (w.owner_id::text) = (p_user_id::text)
              ))
              OR (c.workspace_id IS NOT NULL AND EXISTS (
                  SELECT 1
                  FROM public.workspace_members wm
                  WHERE wm.workspace_id = c.workspace_id
                    AND (wm.user_id::text) = (p_user_id::text)
              ))
              OR EXISTS (
                  SELECT 1
                  FROM public.campaign_members cm
                  WHERE cm.campaign_id = p_campaign_id
                    AND (cm.user_id::text) = (p_user_id::text)
              )
          )
    );
$function$;

CREATE OR REPLACE FUNCTION public."is_challenge_participant"()
RETURNS boolean
LANGUAGE sql
AS $function$

  SELECT EXISTS (
    SELECT 1
    FROM public.challenge_participants cp
    WHERE cp.challenge_id = p_challenge_id
      AND cp.user_id = p_user_id
  );
$function$;

CREATE OR REPLACE FUNCTION public."is_founder"()
RETURNS boolean
LANGUAGE sql
AS $function$

  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles p
    WHERE p.user_id = auth.uid() AND p.is_founder = true
  );
$function$;

CREATE OR REPLACE FUNCTION public."is_linkable_building_footprint"()
RETURNS boolean
LANGUAGE sql
AS $function$

    SELECT p_geom IS NOT NULL
       AND ST_Area(p_geom::geography) >= 30
       AND LOWER(COALESCE(p_building_type, '')) NOT IN (
           'shed',
           'garage',
           'garages',
           'carport',
           'parking',
           'parking_garage',
           'outbuilding',
           'accessory',
           'ancillary'
       );
$function$;

CREATE OR REPLACE FUNCTION public."is_session_participant"()
RETURNS boolean
LANGUAGE sql
AS $function$

    SELECT EXISTS (
        SELECT 1
        FROM public.session_participants sp
        WHERE sp.session_id = p_session_id
          AND (sp.user_id::text) = (p_user_id::text)
          AND sp.left_at IS NULL
    );
$function$;

CREATE OR REPLACE FUNCTION public."is_support"()
RETURNS boolean
LANGUAGE sql
AS $function$

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_support = true
  );
$function$;

CREATE OR REPLACE FUNCTION public."is_workspace_member"()
RETURNS boolean
LANGUAGE sql
AS $function$

    SELECT EXISTS (
        SELECT 1 FROM public.workspaces w WHERE w.id = ws_id AND w.owner_id = auth.uid()
    ) OR EXISTS (
        SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = ws_id AND wm.user_id = auth.uid()
    );
$function$;

CREATE OR REPLACE FUNCTION public."is_workspace_owner"()
RETURNS boolean
LANGUAGE sql
AS $function$

  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = ws_id
      AND wm.user_id = auth.uid()
      AND wm.role = 'owner'
  )
$function$;

CREATE OR REPLACE FUNCTION public."is_workspace_owner_or_admin"()
RETURNS boolean
LANGUAGE sql
AS $function$

  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = ws_id
      AND wm.user_id = auth.uid()
      AND wm.role IN ('owner', 'admin')
  )
$function$;

CREATE OR REPLACE FUNCTION public."join_searchable_challenge"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  v_uid UUID := auth.uid();
  v_challenge public.challenges%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges
  WHERE id = p_challenge_id
    AND visibility = 'searchable'
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found.';
  END IF;

  IF v_challenge.creator_id = v_uid THEN
    RAISE EXCEPTION 'You cannot join your own challenge.';
  END IF;

  IF v_challenge.expires_at IS NOT NULL
     AND v_challenge.expires_at <= now()
     AND v_challenge.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This challenge has already ended.';
  END IF;

  INSERT INTO public.challenge_participants (
    challenge_id,
    user_id,
    participant_name,
    baseline_count,
    progress_count,
    joined_at,
    accepted_at,
    last_sync_at
  )
  VALUES (
    v_challenge.id,
    v_uid,
    NULLIF(trim(COALESCE(p_participant_name, '')), ''),
    GREATEST(COALESCE(p_baseline_count, 0), 0),
    0,
    now(),
    now(),
    now()
  )
  ON CONFLICT (challenge_id, user_id)
  DO UPDATE
    SET participant_name = COALESCE(
          public.challenge_participants.participant_name,
          EXCLUDED.participant_name
        )
  ;

  UPDATE public.challenges
  SET accepted_at = COALESCE(accepted_at, now()),
      expires_at = CASE
        WHEN expires_at IS NULL AND time_limit_hours IS NOT NULL
          THEN now() + make_interval(hours => time_limit_hours)
        ELSE expires_at
      END
  WHERE id = v_challenge.id;

  RETURN public.refresh_challenge_participant_snapshot(v_challenge.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public."leaderboard_period_start"()
RETURNS timestamp with time zone
LANGUAGE plpgsql
AS $function$

BEGIN
    CASE p_timeframe
        WHEN 'daily' THEN
            RETURN date_trunc('day', p_reference);
        WHEN 'weekly' THEN
            RETURN date_trunc('week', p_reference);
        WHEN 'monthly' THEN
            RETURN date_trunc('month', p_reference);
        WHEN 'all_time' THEN
            RETURN '1970-01-01 00:00:00+00'::TIMESTAMPTZ;
        ELSE
            RETURN date_trunc('week', p_reference);
    END CASE;
END;
$function$;

CREATE OR REPLACE FUNCTION public."link_and_return_stats"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_exact BIGINT;
    v_proximity BIGINT;
    v_total BIGINT;
    v_remaining BIGINT;
BEGIN
    -- Run the linker
    SELECT * INTO v_exact, v_proximity, v_total
    FROM public.link_campaign_addresses_gold(p_campaign_id, p_polygon_geojson);
    
    -- Count remaining unlinked
    SELECT COUNT(*) INTO v_remaining
    FROM campaign_addresses ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL;
    
    RETURN QUERY SELECT v_exact, v_proximity, v_total, v_remaining;
END;
$function$;

CREATE OR REPLACE FUNCTION public."link_buildings_to_addresses"()
RETURNS integer
LANGUAGE plpgsql
AS $function$

declare v_updated int;
begin
  update public.ref_buildings_gold b
  set
    primary_address = a.street_number || ' ' || a.street_name,
    primary_street_number = a.street_number,
    primary_street_name = a.street_name,
    updated_at = now()
  from (
    select distinct on (b.id)
      b.id as building_id,
      a.street_number,
      a.street_name
    from public.ref_buildings_gold b
    join public.ref_addresses_gold a
      on a.source_id = p_addresses_source
     and st_dwithin(b.centroid::geography, a.geom::geography, p_max_distance_meters)
    where b.source_id = p_buildings_source
      and b.centroid is not null
      and b.primary_address is null
    order by b.id, st_distance(b.centroid::geography, a.geom::geography)
  ) a
  where b.id = a.building_id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$function$;

CREATE OR REPLACE FUNCTION public."link_campaign_addresses_all"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
    v_gold_exact    BIGINT := 0;
    v_gold_parcel   BIGINT := 0;
    v_gold_prox     BIGINT := 0;
    v_silver_exact  BIGINT := 0;
    v_silver_parcel BIGINT := 0;
    v_silver_prox   BIGINT := 0;
    v_poly          GEOMETRY;
BEGIN
    PERFORM public.clear_campaign_building_links(p_campaign_id);

    SELECT COALESCE(
        territory_boundary,
        ST_GeomFromGeoJSON(campaign_polygon_snapped::text)::GEOMETRY,
        ST_GeomFromGeoJSON(campaign_polygon_raw::text)::GEOMETRY
    ) INTO v_poly
    FROM public.campaigns WHERE id = p_campaign_id;

    IF v_poly IS NULL THEN
        SELECT ST_ConvexHull(ST_Collect(ca.geom)) INTO v_poly
        FROM public.campaign_addresses ca
        WHERE ca.campaign_id = p_campaign_id AND ca.geom IS NOT NULL;
    END IF;

    IF v_poly IS NULL THEN
        RETURN QUERY SELECT 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT, 0::BIGINT;
        RETURN;
    END IF;

    v_poly := ST_Buffer(v_poly::GEOGRAPHY, 100)::GEOMETRY;

    -- Gold exact.
    UPDATE public.campaign_addresses ca
    SET building_id = b.id,
        match_source = 'gold_exact',
        confidence = 1.0
    FROM public.ref_buildings_gold b
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
      AND public.is_linkable_building_footprint(b.geom, b.building_type)
      AND b.geom && v_poly
      AND b.geom && ca.geom
      AND ST_Covers(b.geom, ca.geom);

    GET DIAGNOSTICS v_gold_exact = ROW_COUNT;

    -- Gold parcel: best building per address.
    WITH candidates AS (
        SELECT
            ca.id AS address_id,
            b.id AS building_id,
            COALESCE(b.area_sqm, ST_Area(b.geom::geography)) AS area_sqm,
            ST_Distance(ca.geom::geography, b.geom::geography) AS dist
        FROM public.campaign_addresses ca
        JOIN public.campaign_parcels p
          ON p.campaign_id = p_campaign_id
         AND ST_Covers(p.geom, ca.geom)
        JOIN public.ref_buildings_gold b
          ON b.geom && p.geom
         AND public.is_linkable_building_footprint(b.geom, b.building_type)
         AND ST_Covers(p.geom, COALESCE(b.centroid, ST_PointOnSurface(b.geom)))
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
    ),
    ranked AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY address_id ORDER BY area_sqm DESC, dist ASC, building_id) AS address_rank
        FROM candidates
    )
    UPDATE public.campaign_addresses ca
    SET building_id = ranked.building_id,
        match_source = 'gold_parcel',
        confidence = 0.95
    FROM ranked
    WHERE ca.id = ranked.address_id
      AND ranked.address_rank = 1;

    GET DIAGNOSTICS v_gold_parcel = ROW_COUNT;

    -- Gold proximity: nearest valid building per address.
    WITH candidates AS (
        SELECT
            ca.id AS address_id,
            b.id AS building_id,
            ST_Distance(ca.geom::geography, b.geom::geography) AS dist
        FROM public.campaign_addresses ca
        JOIN public.ref_buildings_gold b
          ON b.geom && v_poly
         AND b.geom && ST_Expand(ca.geom, 0.0003)
         AND public.is_linkable_building_footprint(b.geom, b.building_type)
         AND ST_DWithin(b.geom::geography, ca.geom::geography, 30)
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
    ),
    ranked AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY address_id ORDER BY dist ASC, building_id) AS address_rank
        FROM candidates
    )
    UPDATE public.campaign_addresses ca
    SET building_id = ranked.building_id,
        match_source = 'gold_proximity',
        confidence = GREATEST(0.5, 1.0 - (ranked.dist / 60.0))
    FROM ranked
    WHERE ca.id = ranked.address_id
      AND ranked.address_rank = 1;

    GET DIAGNOSTICS v_gold_prox = ROW_COUNT;

    -- Silver exact.
    INSERT INTO public.building_address_links (campaign_id, address_id, building_id, match_type, confidence, distance_meters)
    SELECT
        p_campaign_id,
        ca.id,
        b.gers_id,
        'containment_verified',
        1.0,
        0
    FROM public.campaign_addresses ca
    JOIN public.buildings b
      ON b.geom && v_poly
     AND b.geom && ca.geom
     AND public.is_linkable_building_footprint(b.geom)
     AND ST_Covers(b.geom, ca.geom)
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
    ON CONFLICT (campaign_id, address_id) DO NOTHING;

    GET DIAGNOSTICS v_silver_exact = ROW_COUNT;

    -- Silver parcel: best building per address.
    WITH candidates AS (
        SELECT
            ca.id AS address_id,
            b.gers_id AS building_id,
            ST_Area(b.geom::geography) AS area_sqm,
            ST_Distance(ca.geom::geography, b.geom::geography) AS dist
        FROM public.campaign_addresses ca
        JOIN public.campaign_parcels p
          ON p.campaign_id = p_campaign_id
         AND ST_Covers(p.geom, ca.geom)
        JOIN public.buildings b
          ON b.geom && p.geom
         AND public.is_linkable_building_footprint(b.geom)
         AND ST_Covers(p.geom, COALESCE(b.centroid, ST_PointOnSurface(b.geom)))
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.building_address_links bal
              WHERE bal.campaign_id = p_campaign_id AND bal.address_id = ca.id
          )
    ),
    ranked AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY address_id ORDER BY area_sqm DESC, dist ASC, building_id) AS address_rank
        FROM candidates
    )
    INSERT INTO public.building_address_links (campaign_id, address_id, building_id, match_type, confidence, distance_meters)
    SELECT
        p_campaign_id,
        address_id,
        building_id,
        'parcel_verified',
        0.95,
        ROUND(dist::numeric, 2)
    FROM ranked
    WHERE address_rank = 1
    ON CONFLICT (campaign_id, address_id) DO NOTHING;

    GET DIAGNOSTICS v_silver_parcel = ROW_COUNT;

    -- Silver proximity: nearest valid building per address.
    WITH candidates AS (
        SELECT
            ca.id AS address_id,
            b.gers_id AS building_id,
            ST_Distance(ca.geom::geography, b.geom::geography) AS dist
        FROM public.campaign_addresses ca
        JOIN public.buildings b
          ON b.geom && v_poly
         AND b.geom && ST_Expand(ca.geom, 0.0003)
         AND public.is_linkable_building_footprint(b.geom)
         AND ST_DWithin(b.geom::geography, ca.geom::geography, 30)
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.building_address_links bal
              WHERE bal.campaign_id = p_campaign_id AND bal.address_id = ca.id
          )
    ),
    ranked AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY address_id ORDER BY dist ASC, building_id) AS address_rank
        FROM candidates
    )
    INSERT INTO public.building_address_links (campaign_id, address_id, building_id, match_type, confidence, distance_meters)
    SELECT
        p_campaign_id,
        address_id,
        building_id,
        'proximity_verified',
        GREATEST(0.5, 1.0 - (dist / 60.0)),
        dist
    FROM ranked
    WHERE address_rank = 1
    ON CONFLICT (campaign_id, address_id) DO NOTHING;

    GET DIAGNOSTICS v_silver_prox = ROW_COUNT;

    RETURN QUERY SELECT
        v_gold_exact,
        v_gold_parcel + v_gold_prox,
        v_silver_exact,
        v_silver_parcel + v_silver_prox,
        v_gold_exact + v_gold_parcel + v_gold_prox + v_silver_exact + v_silver_parcel + v_silver_prox;
END;
$function$;

CREATE OR REPLACE FUNCTION public."link_campaign_addresses_gold"()
RETURNS void
LANGUAGE plpgsql
AS $function$

DECLARE
    v_campaign_poly geometry;
BEGIN
    PERFORM public.clear_campaign_building_links(p_campaign_id);

    v_campaign_poly := ST_SetSRID(ST_GeomFromGeoJSON(p_polygon_geojson), 4326);
    v_campaign_poly := ST_Buffer(v_campaign_poly::geography, 100)::geometry;

    -- Exact containment: address point inside a linkable municipal building.
    UPDATE public.campaign_addresses ca
    SET building_id = b.id,
        match_source = 'gold_exact',
        confidence = 1.0
    FROM public.ref_buildings_gold b
    WHERE ca.campaign_id = p_campaign_id
      AND ca.building_id IS NULL
      AND ca.geom IS NOT NULL
      AND public.is_linkable_building_footprint(b.geom, b.building_type)
      AND b.geom && v_campaign_poly
      AND b.geom && ca.geom
      AND ST_Covers(b.geom, ca.geom);

    -- Parcel bridge: best building for each address inside the same parcel.
    WITH candidates AS (
        SELECT
            ca.id AS address_id,
            b.id AS building_id,
            COALESCE(b.area_sqm, ST_Area(b.geom::geography)) AS area_sqm,
            ST_Distance(ca.geom::geography, b.geom::geography) AS dist
        FROM public.campaign_addresses ca
        JOIN public.campaign_parcels p
          ON p.campaign_id = p_campaign_id
         AND ST_Covers(p.geom, ca.geom)
        JOIN public.ref_buildings_gold b
          ON b.geom && p.geom
         AND public.is_linkable_building_footprint(b.geom, b.building_type)
         AND ST_Covers(p.geom, COALESCE(b.centroid, ST_PointOnSurface(b.geom)))
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
    ),
    ranked AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY address_id ORDER BY area_sqm DESC, dist ASC, building_id) AS address_rank
        FROM candidates
    )
    UPDATE public.campaign_addresses ca
    SET building_id = ranked.building_id,
        match_source = 'gold_parcel',
        confidence = 0.95
    FROM ranked
    WHERE ca.id = ranked.address_id
      AND ranked.address_rank = 1;

    -- Proximity fallback: nearest valid building per address.
    WITH candidates AS (
        SELECT
            ca.id AS address_id,
            b.id AS building_id,
            ST_Distance(ca.geom::geography, b.geom::geography) AS dist
        FROM public.campaign_addresses ca
        JOIN public.ref_buildings_gold b
          ON b.geom && v_campaign_poly
         AND b.geom && ST_Expand(ca.geom, 0.0003)
         AND public.is_linkable_building_footprint(b.geom, b.building_type)
         AND ST_DWithin(b.geom::geography, ca.geom::geography, 30)
        WHERE ca.campaign_id = p_campaign_id
          AND ca.building_id IS NULL
          AND ca.geom IS NOT NULL
    ),
    ranked AS (
        SELECT
            *,
            row_number() OVER (PARTITION BY address_id ORDER BY dist ASC, building_id) AS address_rank
        FROM candidates
    )
    UPDATE public.campaign_addresses ca
    SET building_id = ranked.building_id,
        match_source = 'gold_proximity',
        confidence = GREATEST(0.5, 1.0 - (ranked.dist / 60.0))
    FROM ranked
    WHERE ca.id = ranked.address_id
      AND ranked.address_rank = 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public."link_campaign_data"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_link_count INTEGER;
  v_slice_count INTEGER;
  v_covers_count INTEGER;
  v_parcel_count INTEGER;
  v_nearest_count INTEGER;
BEGIN
  -- ========================================================================
  -- PASS 1: ST_Covers (Highest Confidence - Point inside footprint)
  -- ========================================================================
  INSERT INTO public.building_address_links (campaign_id, address_id, building_id, method, confidence, distance_m)
  SELECT 
    p_campaign_id, 
    ca.id, 
    b.id, 
    'COVERS', 
    1.0, 
    0
  FROM public.campaign_addresses ca
  JOIN public.buildings b ON ST_Covers(b.geom, ca.geom)
  WHERE ca.campaign_id = p_campaign_id 
    AND b.campaign_id = p_campaign_id
  ON CONFLICT (campaign_id, address_id) DO UPDATE 
  SET building_id = EXCLUDED.building_id, method = 'COVERS', confidence = 1.0;

  GET DIAGNOSTICS v_covers_count = ROW_COUNT;

  -- ========================================================================
  -- PASS 2: PARCEL MATCH (The Golden Key for Accuracy)
  -- ========================================================================
  INSERT INTO public.building_address_links (
    campaign_id, 
    address_id, 
    building_id, 
    method, 
    confidence, 
    distance_m
  )
  SELECT DISTINCT ON (ca.id)
    ca.campaign_id,
    ca.id AS address_id,
    b.id AS building_id,
    'PARCEL' AS method,
    0.95 AS confidence,
    ROUND(ST_Distance(ca.geom::geography, b.geom::geography)::numeric, 2) AS distance_m
  FROM public.campaign_addresses ca
  JOIN public.campaign_parcels p 
    ON p.campaign_id = ca.campaign_id 
    AND ST_Covers(p.geom, ca.geom)
  JOIN public.buildings b 
    ON b.campaign_id = ca.campaign_id 
    AND ST_Covers(p.geom, b.centroid)
  WHERE 
    ca.campaign_id = p_campaign_id
    AND NOT EXISTS (
      SELECT 1 
      FROM public.building_address_links existing 
      WHERE existing.address_id = ca.id 
        AND existing.campaign_id = p_campaign_id
    )
  ORDER BY 
    ca.id, 
    ST_Area(b.geom) DESC;

  GET DIAGNOSTICS v_parcel_count = ROW_COUNT;

  -- ========================================================================
  -- PASS 3: Weighted Nearest Neighbor (Fallback)
  -- ========================================================================
  INSERT INTO public.building_address_links (
    campaign_id, 
    address_id, 
    building_id, 
    method, 
    confidence, 
    distance_m
  )
  SELECT 
    p_campaign_id,
    ca.id AS address_id,
    best_match.id AS building_id,
    'NEAREST' AS method,
    CASE 
      WHEN best_match.names_match AND best_match.dist < 20 THEN 0.9 
      WHEN best_match.names_match THEN 0.7 
      ELSE 0.4 
    END AS confidence,
    ROUND(best_match.dist::numeric, 2) AS distance_m
  FROM public.campaign_addresses ca
  CROSS JOIN LATERAL (
    SELECT 
      b.id,
      ST_Distance(ca.geom::geography, b.geom::geography) AS dist,
      LOWER(TRIM(ca.street_name)) = LOWER(TRIM(b.addr_street)) AS names_match
    FROM public.buildings b
    WHERE b.campaign_id = p_campaign_id
      AND ST_DWithin(ca.geom::geography, b.geom::geography, 80)
    ORDER BY 
      (
        ST_Distance(ca.geom::geography, b.geom::geography) + 
        CASE 
          WHEN LOWER(TRIM(ca.street_name)) = LOWER(TRIM(b.addr_street)) 
               OR NULLIF(TRIM(ca.street_name), '') IS NULL 
          THEN 0 
          ELSE 50 
        END
      ) ASC
    LIMIT 1
  ) best_match
  WHERE ca.campaign_id = p_campaign_id
    AND NOT EXISTS (
      SELECT 1 
      FROM public.building_address_links existing 
      WHERE existing.address_id = ca.id 
        AND existing.campaign_id = p_campaign_id
    )
  ON CONFLICT (campaign_id, address_id) DO UPDATE 
  SET 
    building_id = EXCLUDED.building_id, 
    method = 'NEAREST', 
    confidence = EXCLUDED.confidence,
    distance_m = EXCLUDED.distance_m;

  GET DIAGNOSTICS v_nearest_count = ROW_COUNT;

  -- ========================================================================
  -- PASS 4: THE PURGE
  -- ========================================================================
  DELETE FROM public.buildings b
  WHERE b.campaign_id = p_campaign_id
    AND NOT EXISTS (
      SELECT 1 
      FROM public.building_address_links l 
      WHERE l.building_id = b.id 
        AND l.campaign_id = p_campaign_id
    );

  UPDATE public.buildings 
  SET latest_status = 'available' 
  WHERE campaign_id = p_campaign_id;

  -- ========================================================================
  -- PASS 5: THE SLICER
  -- ========================================================================
  DELETE FROM public.building_slices 
  WHERE campaign_id = p_campaign_id;

  WITH multi_unit_buildings AS (
    SELECT building_id, count(*) as unit_count
    FROM public.building_address_links
    WHERE campaign_id = p_campaign_id
    GROUP BY building_id
    HAVING count(*) > 1
  ),
  building_points AS (
    SELECT 
      m.building_id,
      b.geom::geometry as building_geom,
      ca.id as address_id,
      ca.geom::geometry as address_geom
    FROM multi_unit_buildings m
    JOIN public.buildings b ON m.building_id = b.id
    JOIN public.building_address_links l ON l.building_id = b.id AND l.campaign_id = p_campaign_id
    JOIN public.campaign_addresses ca ON l.address_id = ca.id
  ),
  voronoi_per_building AS (
    SELECT 
      building_id,
      building_geom,
      (ST_Dump(ST_VoronoiPolygons(ST_Collect(address_geom::geometry), 0.0, building_geom))).geom as cell_geom
    FROM building_points
    GROUP BY building_id, building_geom
  ),
  matched_slices AS (
    SELECT 
      v.building_id,
      v.building_geom,
      bp.address_id,
      ST_Multi(ST_Intersection(v.building_geom, v.cell_geom)) as unit_geom
    FROM voronoi_per_building v
    JOIN building_points bp ON v.building_id = bp.building_id 
      AND ST_Contains(v.cell_geom, bp.address_geom)
  )
  INSERT INTO public.building_slices (campaign_id, address_id, building_id, geom)
  SELECT 
    p_campaign_id,
    address_id,
    building_id,
    unit_geom
  FROM matched_slices
  WHERE ST_GeometryType(unit_geom) IN ('ST_Polygon', 'ST_MultiPolygon')
    AND NOT ST_IsEmpty(unit_geom);

  GET DIAGNOSTICS v_slice_count = ROW_COUNT;

  -- Return summary
  SELECT count(*) INTO v_link_count 
  FROM public.building_address_links 
  WHERE campaign_id = p_campaign_id;
  
  RETURN jsonb_build_object(
    'links_created', v_link_count,
    'covers_count', v_covers_count,
    'parcel_count', v_parcel_count,
    'nearest_count', v_nearest_count,
    'slices_created', v_slice_count,
    'method', 'parcel_bridge_weighted_nearest'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."mark_route_assignment_status"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  v_assignment public.route_assignments%ROWTYPE;
BEGIN
  IF p_status NOT IN ('assigned', 'in_progress', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  SELECT ra.*
  INTO v_assignment
  FROM public.route_assignments ra
  WHERE ra.id = p_assignment_id;

  IF v_assignment.id IS NULL THEN
    RAISE EXCEPTION 'assignment not found';
  END IF;

  IF v_assignment.assigned_to_user_id <> auth.uid()
     AND NOT public.has_workspace_role(v_assignment.workspace_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.route_assignments ra
  SET
    status = p_status,
    progress = COALESCE(p_progress, '{}'::jsonb),
    started_at = CASE
      WHEN p_status = 'in_progress' AND ra.started_at IS NULL THEN now()
      ELSE ra.started_at
    END,
    completed_at = CASE
      WHEN p_status = 'completed' THEN now()
      WHEN p_status <> 'completed' THEN NULL
      ELSE ra.completed_at
    END,
    updated_at = now()
  WHERE ra.id = p_assignment_id
  RETURNING *
  INTO v_assignment;

  RETURN v_assignment;
END;
$function$;

CREATE OR REPLACE FUNCTION public."normalize_challenge_phone"()
RETURNS text
LANGUAGE sql
AS $function$

  SELECT NULLIF(regexp_replace(COALESCE(p, ''), '\D', '', 'g'), '');
$function$;

CREATE OR REPLACE FUNCTION public."on_qr_code_scan"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

DECLARE
    v_building_id uuid;
    v_campaign_id uuid;
BEGIN
    -- Get campaign_id from qr_code or address
    SELECT 
        COALESCE(q.campaign_id, ca.campaign_id)
    INTO v_campaign_id
    FROM public.qr_codes q
    LEFT JOIN public.campaign_addresses ca ON ca.id = NEW.address_id
    WHERE q.id = NEW.qr_code_id
    LIMIT 1;
    
    -- Find associated map_building via address_id
    -- Try direct link first, then via campaign_addresses
    SELECT mb.id INTO v_building_id
    FROM public.map_buildings mb
    WHERE mb.address_id = NEW.address_id
    LIMIT 1;
    
    -- If no direct link, try to find via campaign_addresses.source_id matching map_buildings.source_id
    IF v_building_id IS NULL AND NEW.address_id IS NOT NULL THEN
        SELECT mb.id INTO v_building_id
        FROM public.map_buildings mb
        INNER JOIN public.campaign_addresses ca ON ca.id = NEW.address_id
        WHERE mb.source_id = ca.source_id
          AND mb.campaign_id = COALESCE(v_campaign_id, ca.campaign_id)
        LIMIT 1;
    END IF;
    
    -- Only create scan_event if we found a building
    IF v_building_id IS NOT NULL THEN
        INSERT INTO public.scan_events (
            building_id,
            campaign_id,
            scanned_at,
            qr_id,
            qr_code_id,
            address_id
        )
        VALUES (
            v_building_id,
            v_campaign_id,
            NEW.scanned_at,
            NULL, -- qr_id can be derived from qr_code_id if needed
            NEW.qr_code_id,
            NEW.address_id
        )
        ON CONFLICT DO NOTHING; -- Prevent duplicates
    END IF;
    
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."on_scan_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    INSERT INTO public.building_stats (
        building_id, 
        campaign_id, 
        scans_total, 
        scans_today, 
        last_scan_at, 
        status, 
        updated_at
    )
    VALUES (
        NEW.building_id, 
        NEW.campaign_id, 
        1, 
        1, 
        NEW.scanned_at, 
        'visited',
        now()
    )
    ON CONFLICT (building_id) DO UPDATE SET
        scans_total = building_stats.scans_total + 1,
        scans_today = CASE 
            WHEN date_trunc('day', building_stats.last_scan_at) = date_trunc('day', NEW.scanned_at)
            THEN building_stats.scans_today + 1
            ELSE 1
        END,
        last_scan_at = EXCLUDED.last_scan_at,
        status = 'visited', -- Simple logic, can be enhanced later
        updated_at = now();
    
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."order_homes_along_road"()
RETURNS record
LANGUAGE sql
AS $function$

  WITH merged AS (
    SELECT ST_LineMerge(ST_CollectionExtract(road_geom, 2)) AS geom
  ),
  picked_line AS (
    SELECT
      CASE
        WHEN GeometryType(geom) = 'LINESTRING' THEN geom
        WHEN GeometryType(geom) = 'MULTILINESTRING' THEN (
          SELECT dumped.geom
          FROM ST_Dump(geom) AS dumped
          ORDER BY ST_Length(dumped.geom::geography) DESC
          LIMIT 1
        )
        ELSE NULL
      END AS geom
    FROM merged
  ),
  input_homes AS (
    SELECT
      h->>'id' AS home_id,
      NULLIF(h->>'lng', '')::double precision AS lng,
      NULLIF(h->>'lat', '')::double precision AS lat
    FROM jsonb_array_elements(COALESCE(homes, '[]'::jsonb)) AS h
  )
  SELECT
    i.home_id,
    ST_LineLocatePoint(
      line.geom,
      ST_SetSRID(ST_MakePoint(i.lng, i.lat), 4326)
    ) AS locate
  FROM input_homes i
  CROSS JOIN picked_line line
  WHERE line.geom IS NOT NULL
    AND i.home_id IS NOT NULL
    AND i.lng IS NOT NULL
    AND i.lat IS NOT NULL
  ORDER BY locate ASC, i.home_id ASC;
$function$;

CREATE OR REPLACE FUNCTION public."order_homes_along_road_geojson"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT *
  FROM public.order_homes_along_road(
    ST_SetSRID(ST_GeomFromGeoJSON(road_geom_json::text), 4326),
    homes
  );
$function$;

CREATE OR REPLACE FUNCTION public."partner_offers_set_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."primary_workspace_id"()
RETURNS uuid
LANGUAGE sql
AS $function$

    SELECT COALESCE(
        (SELECT id FROM public.workspaces WHERE owner_id = p_user_id ORDER BY created_at ASC LIMIT 1),
        (SELECT workspace_id FROM public.workspace_members WHERE user_id = p_user_id ORDER BY created_at ASC LIMIT 1)
    );
$function$;

CREATE OR REPLACE FUNCTION public."rebuild_leaderboard_rollups"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
    TRUNCATE TABLE public.leaderboard_rollups;

    WITH completed_sessions AS (
        SELECT
            s.user_id,
            s.workspace_id,
            s.start_time,
            GREATEST(COALESCE(s.doors_hit, s.completed_count, s.flyers_delivered, 0), 0)::INTEGER AS doorknocks,
            GREATEST(COALESCE(s.conversations, 0), 0)::INTEGER AS conversations,
            GREATEST(COALESCE(s.leads_created, 0), 0)::INTEGER AS leads,
            GREATEST(COALESCE(s.distance_meters, 0), 0)::DOUBLE PRECISION / 1000.0 AS distance_km
        FROM public.sessions s
        WHERE s.end_time IS NOT NULL
    ),
    scoped_sessions AS (
        SELECT
            'global'::TEXT AS scope_key,
            NULL::UUID AS workspace_id,
            cs.user_id,
            cs.start_time,
            cs.doorknocks,
            cs.conversations,
            cs.leads,
            cs.distance_km
        FROM completed_sessions cs
        UNION ALL
        SELECT
            'workspace:' || cs.workspace_id::TEXT AS scope_key,
            cs.workspace_id,
            cs.user_id,
            cs.start_time,
            cs.doorknocks,
            cs.conversations,
            cs.leads,
            cs.distance_km
        FROM completed_sessions cs
        WHERE cs.workspace_id IS NOT NULL
    ),
    expanded AS (
        SELECT
            ss.scope_key,
            ss.workspace_id,
            ss.user_id,
            tf.timeframe,
            public.leaderboard_period_start(tf.timeframe, ss.start_time) AS period_start,
            ss.doorknocks,
            ss.conversations,
            ss.leads,
            ss.distance_km
        FROM scoped_sessions ss
        CROSS JOIN (
            VALUES ('daily'), ('weekly'), ('monthly'), ('all_time')
        ) AS tf(timeframe)
    )
    INSERT INTO public.leaderboard_rollups (
        scope_key,
        workspace_id,
        user_id,
        timeframe,
        period_start,
        doorknocks,
        conversations,
        leads,
        distance_km
    )
    SELECT
        e.scope_key,
        e.workspace_id,
        e.user_id,
        e.timeframe,
        e.period_start,
        SUM(e.doorknocks)::INTEGER,
        SUM(e.conversations)::INTEGER,
        SUM(e.leads)::INTEGER,
        SUM(e.distance_km)::DOUBLE PRECISION
    FROM expanded e
    GROUP BY
        e.scope_key,
        e.workspace_id,
        e.user_id,
        e.timeframe,
        e.period_start;
END;
$function$;

CREATE OR REPLACE FUNCTION public."record_campaign_address_outcome"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

declare
  v_actor_user_id uuid := auth.uid();
  v_campaign_address_id uuid := coalesce(p_campaign_address_id, p_address_id);
  v_status text := lower(trim(coalesce(p_status, 'none')));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_visited boolean;
  v_session_user_id uuid;
  v_session_campaign_id uuid;
  v_session_event_id uuid;
  v_session_event_building_id uuid;
  v_home_event_id uuid;
  v_has_campaign_address_fk boolean;
  v_has_address_id_fk boolean;
  v_has_campaign_id_fk boolean;
  v_result jsonb;
begin
  if v_actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_campaign_address_id is null then
    raise exception 'campaign address id is required';
  end if;

  if v_status not in (
    'none',
    'no_answer',
    'delivered',
    'talked',
    'appointment',
    'do_not_knock',
    'future_seller',
    'hot_lead'
  ) then
    raise exception 'Unsupported address status: %', v_status;
  end if;

  if p_session_event_type is not null and p_session_event_type not in (
    'flyer_left',
    'conversation',
    'address_tap',
    'completed_manual',
    'completed_auto',
    'completion_undone'
  ) then
    raise exception 'Unsupported session event type: %', p_session_event_type;
  end if;

  perform 1
  from public.campaign_addresses ca
  where ca.id = v_campaign_address_id
    and ca.campaign_id = p_campaign_id
    and public.is_campaign_member(ca.campaign_id, v_actor_user_id);

  if not found then
    raise exception 'Campaign address not found or access denied';
  end if;

  if p_session_id is not null then
    select user_id, campaign_id
    into v_session_user_id, v_session_campaign_id
    from public.sessions
    where id = p_session_id;

    if v_session_user_id is null or (v_session_user_id::text) is distinct from (v_actor_user_id::text) then
      raise exception 'Session not found or access denied';
    end if;

    if v_session_campaign_id is distinct from p_campaign_id then
      raise exception 'Session campaign does not match campaign address outcome campaign';
    end if;
  end if;

  insert into public.campaign_home_events (
    campaign_id,
    campaign_address_id,
    user_id,
    session_id,
    action_type,
    note,
    created_at
  ) values (
    p_campaign_id,
    v_campaign_address_id,
    v_actor_user_id,
    p_session_id,
    v_status,
    v_notes,
    p_occurred_at
  )
  returning id into v_home_event_id;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'address_statuses'
      and column_name = 'campaign_address_id'
  ) into v_has_campaign_address_fk;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'address_statuses'
      and column_name = 'address_id'
  ) into v_has_address_id_fk;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'address_statuses'
      and column_name = 'campaign_id'
  ) into v_has_campaign_id_fk;

  if not v_has_campaign_address_fk and not (v_has_address_id_fk and v_has_campaign_id_fk) then
    raise exception 'address_statuses is missing a supported address foreign key shape';
  end if;

  v_visited := v_status <> 'none';

  if v_has_campaign_address_fk then
    if v_has_campaign_id_fk then
      execute $sql$
        insert into public.address_statuses (
          campaign_address_id,
          campaign_id,
          status,
          notes,
          last_visited_at,
          visit_count,
          last_action_by,
          last_session_id,
          last_home_event_id,
          updated_at
        ) values (
          $1,
          $2,
          $3,
          $4,
          case when $5 then $6 else null end,
          case when $5 then 1 else 0 end,
          $7,
          $8,
          $9,
          now()
        )
        on conflict (campaign_address_id)
        do update set
          campaign_id = excluded.campaign_id,
          status = excluded.status,
          notes = case when excluded.status = 'none'::text then excluded.notes else coalesce(excluded.notes, public.address_statuses.notes) end,
          last_visited_at = case
            when excluded.status = 'none' then public.address_statuses.last_visited_at
            else excluded.last_visited_at
          end,
          visit_count = case
            when excluded.status = 'none' then public.address_statuses.visit_count
            else public.address_statuses.visit_count + 1
          end,
          last_action_by = excluded.last_action_by,
          last_session_id = excluded.last_session_id,
          last_home_event_id = excluded.last_home_event_id,
          updated_at = now()
        returning jsonb_build_object(
          'campaign_address_id', campaign_address_id,
          'campaign_id', campaign_id,
          'status', status,
          'notes', notes,
          'visit_count', visit_count,
          'last_visited_at', last_visited_at,
          'updated_at', updated_at,
          'last_action_by', last_action_by,
          'last_session_id', last_session_id,
          'last_home_event_id', last_home_event_id
        )
      $sql$
      into v_result
      using
        v_campaign_address_id,
        p_campaign_id,
        v_status,
        v_notes,
        v_visited,
        p_occurred_at,
        v_actor_user_id,
        p_session_id,
        v_home_event_id;
    else
      execute $sql$
        insert into public.address_statuses (
          campaign_address_id,
          status,
          notes,
          last_visited_at,
          visit_count,
          last_action_by,
          last_session_id,
          last_home_event_id,
          updated_at
        ) values (
          $1,
          $2,
          $3,
          case when $4 then $5 else null end,
          case when $4 then 1 else 0 end,
          $6,
          $7,
          $8,
          now()
        )
        on conflict (campaign_address_id)
        do update set
          status = excluded.status,
          notes = case when excluded.status = 'none'::text then excluded.notes else coalesce(excluded.notes, public.address_statuses.notes) end,
          last_visited_at = case
            when excluded.status = 'none' then public.address_statuses.last_visited_at
            else excluded.last_visited_at
          end,
          visit_count = case
            when excluded.status = 'none' then public.address_statuses.visit_count
            else public.address_statuses.visit_count + 1
          end,
          last_action_by = excluded.last_action_by,
          last_session_id = excluded.last_session_id,
          last_home_event_id = excluded.last_home_event_id,
          updated_at = now()
        returning jsonb_build_object(
          'campaign_address_id', campaign_address_id,
          'status', status,
          'notes', notes,
          'visit_count', visit_count,
          'last_visited_at', last_visited_at,
          'updated_at', updated_at,
          'last_action_by', last_action_by,
          'last_session_id', last_session_id,
          'last_home_event_id', last_home_event_id
        )
      $sql$
      into v_result
      using
        v_campaign_address_id,
        v_status,
        v_notes,
        v_visited,
        p_occurred_at,
        v_actor_user_id,
        p_session_id,
        v_home_event_id;
    end if;
  else
    execute $sql$
      insert into public.address_statuses (
        address_id,
        campaign_id,
        status,
        notes,
        last_visited_at,
        visit_count,
        last_action_by,
        last_session_id,
        last_home_event_id,
        updated_at
      ) values (
        $1,
        $2,
        $3,
        $4,
        case when $5 then $6 else null end,
        case when $5 then 1 else 0 end,
        $7,
        $8,
        $9,
        now()
      )
      on conflict (address_id, campaign_id)
      do update set
        status = excluded.status,
        notes = case when excluded.status = 'none'::text then excluded.notes else coalesce(excluded.notes, public.address_statuses.notes) end,
        last_visited_at = case
          when excluded.status = 'none' then public.address_statuses.last_visited_at
          else excluded.last_visited_at
        end,
        visit_count = case
          when excluded.status = 'none' then public.address_statuses.visit_count
          else public.address_statuses.visit_count + 1
        end,
        last_action_by = excluded.last_action_by,
        last_session_id = excluded.last_session_id,
        last_home_event_id = excluded.last_home_event_id,
        updated_at = now()
      returning jsonb_build_object(
        'address_id', address_id,
        'campaign_id', campaign_id,
        'status', status,
        'notes', notes,
        'visit_count', visit_count,
        'last_visited_at', last_visited_at,
        'updated_at', updated_at,
        'last_action_by', last_action_by,
        'last_session_id', last_session_id,
        'last_home_event_id', last_home_event_id
      )
    $sql$
    into v_result
    using
      v_campaign_address_id,
      p_campaign_id,
      v_status,
      v_notes,
      v_visited,
      p_occurred_at,
      v_actor_user_id,
      p_session_id,
      v_home_event_id;
  end if;

  update public.campaign_addresses
  set visited = v_visited
  where id = v_campaign_address_id;

  if p_session_id is not null and p_session_event_type is not null then
    v_session_event_building_id := null;
    if nullif(trim(coalesce(p_session_target_id, '')), '') is not null then
      begin
        v_session_event_building_id := nullif(trim(coalesce(p_session_target_id, '')), '')::uuid;
      exception when invalid_text_representation then
        v_session_event_building_id := null;
      end;
    end if;

    insert into public.session_events (
      session_id,
      building_id,
      address_id,
      event_type,
      created_at,
      lat,
      lon,
      event_location,
      metadata,
      user_id
    ) values (
      p_session_id,
      v_session_event_building_id,
      v_campaign_address_id,
      p_session_event_type,
      p_occurred_at,
      p_lat,
      p_lon,
      case
        when p_lon is not null and p_lat is not null
          then st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography
        else null
      end,
      jsonb_build_object(
        'address_status', v_status,
        'source', 'record_campaign_address_outcome'
      ),
      v_session_user_id
    )
    returning id into v_session_event_id;

    if p_session_event_type in (
      'flyer_left',
      'conversation',
      'completed_manual',
      'completed_auto'
    ) then
      update public.sessions
      set completed_count = completed_count + 1,
          updated_at = now()
      where id = p_session_id;
    elsif p_session_event_type = 'completion_undone' then
      update public.sessions
      set completed_count = greatest(0, completed_count - 1),
          updated_at = now()
      where id = p_session_id;
    end if;
  end if;

  return v_result || jsonb_build_object(
    'visited', v_visited,
    'session_event_id', v_session_event_id,
    'campaign_home_event_id', v_home_event_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public."record_campaign_target_outcome"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

declare
  v_actor_user_id uuid := auth.uid();
  v_campaign_address_ids uuid[];
  v_campaign_address_id uuid;
  v_status text := lower(trim(coalesce(p_status, 'none')));
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
  v_visited boolean;
  v_session_user_id uuid;
  v_session_campaign_id uuid;
  v_session_event_id uuid;
  v_session_event_building_id uuid;
  v_validated_count integer;
  v_address_outcomes jsonb := '[]'::jsonb;
begin
  if v_actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select coalesce(array_agg(address_id order by first_ordinal), array[]::uuid[])
  into v_campaign_address_ids
  from (
    select address_id, min(ordinality) as first_ordinal
    from unnest(coalesce(p_campaign_address_ids, array[]::uuid[])) with ordinality as input(address_id, ordinality)
    where address_id is not null
    group by address_id
  ) deduped;

  if coalesce(array_length(v_campaign_address_ids, 1), 0) = 0 then
    raise exception 'campaign address ids are required';
  end if;

  if v_status not in (
    'none',
    'no_answer',
    'delivered',
    'talked',
    'appointment',
    'do_not_knock',
    'future_seller',
    'hot_lead'
  ) then
    raise exception 'Unsupported address status: %', v_status;
  end if;

  if p_session_event_type is not null and p_session_event_type not in (
    'flyer_left',
    'conversation',
    'address_tap',
    'completed_manual',
    'completed_auto',
    'completion_undone'
  ) then
    raise exception 'Unsupported session event type: %', p_session_event_type;
  end if;

  select count(*)
  into v_validated_count
  from public.campaign_addresses ca
  where ca.id = any(v_campaign_address_ids)
    and ca.campaign_id = p_campaign_id
    and public.is_campaign_member(ca.campaign_id, v_actor_user_id);

  if v_validated_count <> coalesce(array_length(v_campaign_address_ids, 1), 0) then
    raise exception 'One or more campaign addresses were not found or access was denied';
  end if;

  if p_session_id is not null then
    select user_id, campaign_id
    into v_session_user_id, v_session_campaign_id
    from public.sessions
    where id = p_session_id;

    if v_session_user_id is null or (v_session_user_id::text) is distinct from (v_actor_user_id::text) then
      raise exception 'Session not found or access denied';
    end if;

    if v_session_campaign_id is distinct from p_campaign_id then
      raise exception 'Session campaign does not match campaign address outcome campaign';
    end if;
  end if;

  foreach v_campaign_address_id in array v_campaign_address_ids loop
    v_address_outcomes := v_address_outcomes || jsonb_build_array(
      public.record_campaign_address_outcome(
        p_campaign_id => p_campaign_id,
        p_campaign_address_id => v_campaign_address_id,
        p_status => v_status,
        p_notes => v_notes,
        p_occurred_at => p_occurred_at,
        p_session_id => p_session_id,
        p_session_target_id => p_session_target_id,
        p_session_event_type => null,
        p_lat => p_lat,
        p_lon => p_lon
      )
    );
  end loop;

  v_visited := v_status <> 'none';

  if p_session_id is not null and p_session_event_type is not null then
    v_session_event_building_id := null;
    if nullif(trim(coalesce(p_session_target_id, '')), '') is not null then
      begin
        v_session_event_building_id := nullif(trim(coalesce(p_session_target_id, '')), '')::uuid;
      exception when invalid_text_representation then
        v_session_event_building_id := null;
      end;
    end if;

    insert into public.session_events (
      session_id,
      building_id,
      address_id,
      event_type,
      created_at,
      lat,
      lon,
      event_location,
      metadata,
      user_id
    ) values (
      p_session_id,
      v_session_event_building_id,
      v_campaign_address_ids[1],
      p_session_event_type,
      p_occurred_at,
      p_lat,
      p_lon,
      case
        when p_lon is not null and p_lat is not null
          then st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography
        else null
      end,
      jsonb_build_object(
        'address_status', v_status,
        'source', 'record_campaign_target_outcome',
        'campaign_address_ids', to_jsonb(v_campaign_address_ids),
        'address_count', coalesce(array_length(v_campaign_address_ids, 1), 0)
      ),
      v_session_user_id
    )
    returning id into v_session_event_id;

    if p_session_event_type in (
      'flyer_left',
      'conversation',
      'completed_manual',
      'completed_auto'
    ) then
      update public.sessions
      set completed_count = completed_count + 1,
          updated_at = now()
      where id = p_session_id;
    elsif p_session_event_type = 'completion_undone' then
      update public.sessions
      set completed_count = greatest(0, completed_count - 1),
          updated_at = now()
      where id = p_session_id;
    end if;
  end if;

  return jsonb_build_object(
    'campaign_address_ids', to_jsonb(v_campaign_address_ids),
    'status', v_status,
    'visited', v_visited,
    'affected_count', coalesce(array_length(v_campaign_address_ids, 1), 0),
    'address_outcomes', v_address_outcomes,
    'session_event_id', v_session_event_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public."record_farm_address_outcome"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
    v_status text := lower(trim(coalesce(p_status, 'delivered')));
    v_notes text := nullif(trim(coalesce(p_notes, '')), '');
    v_farm_address_id uuid := p_farm_address_id;
    v_visit_count integer := 0;
    v_latest_visit record;
    v_touch_farm_id uuid;
    v_address_farm_id uuid;
    v_touch_homes_reached integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF p_farm_id IS NULL OR p_farm_touch_id IS NULL THEN
        RAISE EXCEPTION 'farm id and farm touch id are required';
    END IF;

    IF v_status NOT IN (
        'none',
        'no_answer',
        'delivered',
        'talked',
        'appointment',
        'do_not_knock',
        'future_seller',
        'hot_lead'
    ) THEN
        RAISE EXCEPTION 'Unsupported farm address status: %', v_status;
    END IF;

    PERFORM 1
    FROM public.farms f
    WHERE f.id = p_farm_id
      AND (
          f.owner_id = auth.uid()
          OR (f.workspace_id IS NOT NULL AND public.is_workspace_member(f.workspace_id))
      );

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Farm not found or access denied';
    END IF;

    SELECT farm_id
    INTO v_touch_farm_id
    FROM public.farm_touches
    WHERE id = p_farm_touch_id;

    IF v_touch_farm_id IS NULL OR v_touch_farm_id IS DISTINCT FROM p_farm_id THEN
        RAISE EXCEPTION 'Farm touch not found or does not belong to the farm';
    END IF;

    IF v_farm_address_id IS NULL AND p_campaign_address_id IS NOT NULL THEN
        SELECT id
        INTO v_farm_address_id
        FROM public.farm_addresses
        WHERE farm_id = p_farm_id
          AND campaign_address_id = p_campaign_address_id
        ORDER BY created_at DESC
        LIMIT 1;
    END IF;

    IF v_farm_address_id IS NULL AND p_campaign_address_id IS NOT NULL THEN
        INSERT INTO public.farm_addresses (
            farm_id,
            campaign_address_id,
            gers_id,
            formatted,
            house_number,
            street_name,
            locality,
            region,
            postal_code,
            source,
            latitude,
            longitude,
            geom
        )
        SELECT
            p_farm_id,
            ca.id,
            ca.gers_id::text,
            COALESCE(
                NULLIF(trim(ca.formatted), ''),
                NULLIF(trim(concat_ws(' ', ca.house_number, ca.street_name)), ''),
                'Unknown address'
            ),
            ca.house_number,
            ca.street_name,
            ca.locality,
            ca.region,
            ca.postal_code,
            'campaign',
            CASE WHEN ca.geom IS NOT NULL THEN ST_Y(ca.geom::geometry) ELSE NULL END,
            CASE WHEN ca.geom IS NOT NULL THEN ST_X(ca.geom::geometry) ELSE NULL END,
            CASE WHEN ca.geom IS NOT NULL THEN ST_AsGeoJSON(ca.geom::geometry)::jsonb ELSE NULL END
        FROM public.campaign_addresses ca
        WHERE ca.id = p_campaign_address_id
        RETURNING id INTO v_farm_address_id;
    END IF;

    IF v_farm_address_id IS NULL THEN
        RAISE EXCEPTION 'farm address id or campaign address id is required';
    END IF;

    SELECT farm_id
    INTO v_address_farm_id
    FROM public.farm_addresses
    WHERE id = v_farm_address_id;

    IF v_address_farm_id IS NULL OR v_address_farm_id IS DISTINCT FROM p_farm_id THEN
        RAISE EXCEPTION 'Farm address not found or does not belong to the farm';
    END IF;

    INSERT INTO public.farm_touch_addresses (
        farm_id,
        farm_touch_id,
        farm_address_id,
        campaign_address_id,
        status,
        notes,
        occurred_at,
        created_by,
        updated_at
    )
    SELECT
        p_farm_id,
        p_farm_touch_id,
        fa.id,
        COALESCE(p_campaign_address_id, fa.campaign_address_id),
        v_status,
        v_notes,
        p_occurred_at,
        auth.uid(),
        now()
    FROM public.farm_addresses fa
    WHERE fa.id = v_farm_address_id
    ON CONFLICT (farm_touch_id, farm_address_id)
    DO UPDATE SET
        status = EXCLUDED.status,
        notes = COALESCE(EXCLUDED.notes, public.farm_touch_addresses.notes),
        occurred_at = EXCLUDED.occurred_at,
        campaign_address_id = COALESCE(EXCLUDED.campaign_address_id, public.farm_touch_addresses.campaign_address_id),
        updated_at = now();

    SELECT COUNT(*)
    INTO v_visit_count
    FROM public.farm_touch_addresses fta
    WHERE fta.farm_address_id = v_farm_address_id
      AND fta.status <> 'none';

    SELECT
        fta.occurred_at,
        fta.farm_touch_id,
        fta.status
    INTO v_latest_visit
    FROM public.farm_touch_addresses fta
    WHERE fta.farm_address_id = v_farm_address_id
      AND fta.status <> 'none'
    ORDER BY fta.occurred_at DESC, fta.updated_at DESC
    LIMIT 1;

    UPDATE public.farm_addresses
    SET
        visited_count = COALESCE(v_visit_count, 0),
        last_visited_at = CASE
            WHEN v_visit_count > 0 THEN v_latest_visit.occurred_at
            ELSE NULL
        END,
        last_touch_id = CASE
            WHEN v_visit_count > 0 THEN v_latest_visit.farm_touch_id
            ELSE NULL
        END,
        last_outcome_status = CASE
            WHEN v_visit_count > 0 THEN v_latest_visit.status
            ELSE NULL
        END
    WHERE id = v_farm_address_id;

    SELECT COUNT(*)
    INTO v_touch_homes_reached
    FROM public.farm_touch_addresses fta
    WHERE fta.farm_touch_id = p_farm_touch_id
      AND fta.status <> 'none';

    RETURN jsonb_build_object(
        'farm_id', p_farm_id,
        'farm_touch_id', p_farm_touch_id,
        'farm_address_id', v_farm_address_id,
        'status', v_status,
        'visited_count', v_visit_count,
        'homes_reached', v_touch_homes_reached,
        'last_touch_id', CASE
            WHEN v_visit_count > 0 THEN v_latest_visit.farm_touch_id
            ELSE NULL
        END,
        'last_outcome_status', CASE
            WHEN v_visit_count > 0 THEN v_latest_visit.status
            ELSE NULL
        END
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public."record_public_qr_scan_outcome"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_campaign_id UUID;
  v_owner_id UUID;
  v_result JSONB;
BEGIN
  SELECT ca.campaign_id, c.owner_id
  INTO v_campaign_id, v_owner_id
  FROM public.campaign_addresses ca
  JOIN public.campaigns c ON c.id = ca.campaign_id
  WHERE ca.id = p_campaign_address_id;

  IF v_campaign_id IS NULL OR v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Campaign address not found';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', v_owner_id,
      'role', 'authenticated'
    )::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT public.record_campaign_address_outcome(
    p_campaign_id => v_campaign_id,
    p_campaign_address_id => p_campaign_address_id,
    p_status => p_status,
    p_notes => p_notes,
    p_occurred_at => p_occurred_at
  )
  INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public."refresh_brokerage_leaderboards"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.ranking_brokerages_all_time;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.ranking_brokerages_month;
END;
$function$;

CREATE OR REPLACE FUNCTION public."refresh_campaign_snapshot_urls"()
RETURNS record
LANGUAGE plpgsql
AS $function$

BEGIN
    -- Return the stored URLs (caller should check if expired and regenerate)
    RETURN QUERY
    SELECT 
        cs.buildings_url,
        cs.addresses_url,
        cs.roads_url,
        cs.metadata_url
    FROM public.campaign_snapshots cs
    WHERE cs.campaign_id = p_campaign_id
    AND cs.expires_at > NOW();
END;
$function$;

CREATE OR REPLACE FUNCTION public."refresh_challenge_participant_snapshot"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  v_challenge public.challenges%ROWTYPE;
  v_participant_count INTEGER := 0;
  v_first_accepted_at TIMESTAMPTZ;
  v_leader_user_id UUID;
  v_leader_name TEXT;
  v_leader_baseline INTEGER;
  v_leader_progress INTEGER;
  v_next_status TEXT;
BEGIN
  SELECT *
  INTO v_challenge
  FROM public.challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found.';
  END IF;

  SELECT
    COUNT(*)::INTEGER,
    MIN(cp.accepted_at)
  INTO
    v_participant_count,
    v_first_accepted_at
  FROM public.challenge_participants cp
  WHERE cp.challenge_id = p_challenge_id;

  SELECT
    cp.user_id,
    NULLIF(trim(COALESCE(cp.participant_name, '')), ''),
    cp.baseline_count,
    cp.progress_count
  INTO
    v_leader_user_id,
    v_leader_name,
    v_leader_baseline,
    v_leader_progress
  FROM public.challenge_participants cp
  WHERE cp.challenge_id = p_challenge_id
  ORDER BY cp.progress_count DESC, cp.accepted_at ASC NULLS LAST, cp.joined_at ASC, cp.user_id ASC
  LIMIT 1;

  IF v_challenge.scoring_mode = 'reach_goal' THEN
    IF EXISTS (
      SELECT 1
      FROM public.challenge_participants cp
      WHERE cp.challenge_id = p_challenge_id
        AND cp.progress_count >= v_challenge.goal_count
    ) THEN
      v_next_status := 'completed';
    ELSIF v_challenge.expires_at IS NOT NULL AND v_challenge.expires_at < now() THEN
      v_next_status := 'failed';
    ELSE
      v_next_status := 'active';
    END IF;
  ELSE
    IF v_challenge.expires_at IS NOT NULL AND v_challenge.expires_at < now() THEN
      v_next_status := 'completed';
    ELSE
      v_next_status := 'active';
    END IF;
  END IF;

  UPDATE public.challenges c
  SET participant_count = COALESCE(v_participant_count, 0),
      participant_id = v_leader_user_id,
      participant_name = v_leader_name,
      baseline_count = COALESCE(v_leader_baseline, 0),
      progress_count = COALESCE(v_leader_progress, 0),
      accepted_at = v_first_accepted_at,
      status = v_next_status,
      completed_at = CASE
        WHEN v_next_status = 'completed' THEN COALESCE(c.completed_at, now())
        WHEN v_next_status = 'active' THEN NULL
        ELSE c.completed_at
      END
  WHERE c.id = p_challenge_id
  RETURNING * INTO v_challenge;

  RETURN v_challenge;
END;
$function$;

CREATE OR REPLACE FUNCTION public."refresh_user_stats_from_sessions"()
RETURNS void
LANGUAGE plpgsql
AS $function$

DECLARE
    v_doors_knocked INTEGER := 0;
    v_flyers INTEGER := 0;
    v_conversations INTEGER := 0;
    v_leads_created INTEGER := 0;
    v_appointments INTEGER := 0;
    v_distance_walked DOUBLE PRECISION := 0.0;
    v_time_tracked INTEGER := 0;
    v_day_streak INTEGER := 0;
    v_best_streak INTEGER := 0;
    v_streak_days JSONB := '[]'::JSONB;
    v_exclude_weekends BOOLEAN := FALSE;
    v_current_streak_threshold DATE := CURRENT_DATE - 1;
BEGIN
    SELECT COALESCE(us.exclude_weekends, FALSE)
    INTO v_exclude_weekends
    FROM public.user_settings us
    WHERE us.user_id = p_user_id;

    IF v_exclude_weekends THEN
        v_current_streak_threshold := CASE EXTRACT(ISODOW FROM CURRENT_DATE)::INTEGER
            WHEN 1 THEN CURRENT_DATE - 3
            WHEN 7 THEN CURRENT_DATE - 2
            WHEN 6 THEN CURRENT_DATE - 1
            ELSE CURRENT_DATE - 1
        END;
    END IF;

    WITH session_metrics AS (
        SELECT
            s.id,
            s.user_id,
            (s.start_time AT TIME ZONE 'UTC')::DATE AS session_day,
            GREATEST(COALESCE(s.doors_hit, s.completed_count, s.flyers_delivered, 0), 0)::INTEGER AS doors_knocked,
            GREATEST(COALESCE(s.flyers_delivered, s.completed_count, 0), 0)::INTEGER AS flyers,
            GREATEST(COALESCE(s.conversations, 0), 0)::INTEGER AS conversations,
            GREATEST(COALESCE(s.leads_created, 0), 0)::INTEGER AS leads_created,
            GREATEST(COALESCE(s.distance_meters, 0), 0)::DOUBLE PRECISION / 1000.0 AS distance_walked,
            GREATEST(
                COALESCE(
                    FLOOR(COALESCE(s.active_seconds, EXTRACT(EPOCH FROM (s.end_time - s.start_time))) / 60.0)::INTEGER,
                    0
                ),
                0
            ) AS time_tracked,
            COALESCE(appts.appointments_count, 0)::INTEGER AS appointments
        FROM public.sessions s
        LEFT JOIN LATERAL (
            SELECT COUNT(*)::INTEGER AS appointments_count
            FROM public.crm_events ce
            WHERE ce.user_id = s.user_id
              AND ce.fub_appointment_id IS NOT NULL
              AND ce.created_at >= s.start_time
              AND ce.created_at < s.end_time
        ) appts ON TRUE
        WHERE s.user_id = p_user_id
          AND s.end_time IS NOT NULL
    ),
    totals AS (
        SELECT
            COALESCE(SUM(sm.doors_knocked), 0)::INTEGER AS doors_knocked,
            COALESCE(SUM(sm.flyers), 0)::INTEGER AS flyers,
            COALESCE(SUM(sm.conversations), 0)::INTEGER AS conversations,
            COALESCE(SUM(sm.leads_created), 0)::INTEGER AS leads_created,
            COALESCE(SUM(sm.appointments), 0)::INTEGER AS appointments,
            COALESCE(SUM(sm.distance_walked), 0.0)::DOUBLE PRECISION AS distance_walked,
            COALESCE(SUM(sm.time_tracked), 0)::INTEGER AS time_tracked
        FROM session_metrics sm
    ),
    distinct_days AS (
        SELECT DISTINCT sm.session_day
        FROM session_metrics sm
        WHERE NOT v_exclude_weekends
           OR EXTRACT(ISODOW FROM sm.session_day) < 6
    ),
    streak_base AS (
        SELECT
            dd.session_day,
            LAG(dd.session_day) OVER (ORDER BY dd.session_day) AS previous_session_day
        FROM distinct_days dd
    ),
    streak_markers AS (
        SELECT
            sb.session_day,
            CASE
                WHEN sb.previous_session_day IS NULL THEN 1
                WHEN v_exclude_weekends
                    AND sb.session_day = (
                        sb.previous_session_day
                        + CASE
                            WHEN EXTRACT(ISODOW FROM sb.previous_session_day) = 5
                                THEN INTERVAL '3 days'
                            ELSE INTERVAL '1 day'
                        END
                    )::DATE THEN 0
                WHEN NOT v_exclude_weekends
                    AND sb.session_day = (sb.previous_session_day + INTERVAL '1 day')::DATE THEN 0
                ELSE 1
            END AS starts_new_group
        FROM streak_base sb
    ),
    streak_groups AS (
        SELECT
            MIN(sgm.session_day) AS streak_start,
            MAX(sgm.session_day) AS streak_end,
            COUNT(*)::INTEGER AS streak_length
        FROM (
            SELECT
                sm.session_day,
                SUM(sm.starts_new_group) OVER (ORDER BY sm.session_day) AS streak_group
            FROM streak_markers sm
        ) sgm
        GROUP BY sgm.streak_group
    ),
    streak_summary AS (
        SELECT
            COALESCE(MAX(sg.streak_length), 0)::INTEGER AS best_streak,
            COALESCE(
                MAX(
                    CASE
                        WHEN sg.streak_end >= v_current_streak_threshold THEN sg.streak_length
                        ELSE 0
                    END
                ),
                0
            )::INTEGER AS day_streak
        FROM streak_groups sg
    ),
    streak_days AS (
        SELECT COALESCE(
            jsonb_agg(to_char(dd.session_day, 'YYYY-MM-DD') ORDER BY dd.session_day DESC),
            '[]'::JSONB
        ) AS days
        FROM distinct_days dd
    )
    SELECT
        t.doors_knocked,
        t.flyers,
        t.conversations,
        t.leads_created,
        t.appointments,
        t.distance_walked,
        t.time_tracked,
        ss.day_streak,
        ss.best_streak,
        sd.days
    INTO
        v_doors_knocked,
        v_flyers,
        v_conversations,
        v_leads_created,
        v_appointments,
        v_distance_walked,
        v_time_tracked,
        v_day_streak,
        v_best_streak,
        v_streak_days
    FROM totals t
    CROSS JOIN streak_summary ss
    CROSS JOIN streak_days sd;

    INSERT INTO public.user_stats (
        user_id,
        day_streak,
        best_streak,
        streak_days,
        doors_knocked,
        flyers,
        conversations,
        leads_created,
        appointments,
        distance_walked,
        time_tracked,
        conversation_per_door,
        conversation_lead_rate,
        qr_code_scan_rate,
        qr_code_lead_rate
    )
    VALUES (
        p_user_id,
        v_day_streak,
        v_best_streak,
        v_streak_days,
        v_doors_knocked,
        v_flyers,
        v_conversations,
        v_leads_created,
        v_appointments,
        v_distance_walked,
        v_time_tracked,
        CASE
            WHEN v_doors_knocked > 0 THEN v_conversations::DOUBLE PRECISION / v_doors_knocked::DOUBLE PRECISION
            ELSE 0.0
        END,
        CASE
            WHEN v_conversations > 0 THEN v_leads_created::DOUBLE PRECISION / v_conversations::DOUBLE PRECISION
            ELSE 0.0
        END,
        0.0,
        0.0
    )
    ON CONFLICT (user_id) DO UPDATE SET
        day_streak = EXCLUDED.day_streak,
        best_streak = EXCLUDED.best_streak,
        streak_days = EXCLUDED.streak_days,
        doors_knocked = EXCLUDED.doors_knocked,
        flyers = EXCLUDED.flyers,
        conversations = EXCLUDED.conversations,
        leads_created = EXCLUDED.leads_created,
        appointments = EXCLUDED.appointments,
        distance_walked = EXCLUDED.distance_walked,
        time_tracked = EXCLUDED.time_tracked,
        conversation_per_door = EXCLUDED.conversation_per_door,
        conversation_lead_rate = EXCLUDED.conversation_lead_rate,
        qr_code_scan_rate = CASE
            WHEN EXCLUDED.flyers > 0 THEN public.user_stats.qr_codes_scanned::DOUBLE PRECISION / EXCLUDED.flyers::DOUBLE PRECISION
            ELSE 0.0
        END,
        qr_code_lead_rate = CASE
            WHEN public.user_stats.qr_codes_scanned > 0 THEN EXCLUDED.leads_created::DOUBLE PRECISION / public.user_stats.qr_codes_scanned::DOUBLE PRECISION
            ELSE 0.0
        END,
        updated_at = NOW();
END;
$function$;

CREATE OR REPLACE FUNCTION public."refresh_user_stats_from_settings"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    PERFORM public.refresh_user_stats_from_sessions(NEW.user_id);
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."report_metric_keys"()
RETURNS ARRAY
LANGUAGE sql
AS $function$

  SELECT ARRAY[
    'doors_knocked',
    'flyers_delivered',
    'conversations',
    'leads_created',
    'appointments_set',
    'time_spent_seconds',
    'sessions_count'
  ]::text[]
$function$;

CREATE OR REPLACE FUNCTION public."report_zero_metrics"()
RETURNS jsonb
LANGUAGE sql
AS $function$

  SELECT jsonb_build_object(
    'doors_knocked', 0,
    'flyers_delivered', 0,
    'conversations', 0,
    'leads_created', 0,
    'appointments_set', 0,
    'time_spent_seconds', 0,
    'sessions_count', 0
  )
$function$;

CREATE OR REPLACE FUNCTION public."reset_daily_building_scan_counts"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
    -- Reset scans_today to 0 for all buildings
    UPDATE public.building_stats
    SET scans_today = 0,
        updated_at = NOW()
    WHERE scans_today > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public."route_assignment_member_update_guard"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  IF NEW.assigned_to_user_id = auth.uid()
     AND NOT public.has_workspace_role(NEW.workspace_id, auth.uid(), ARRAY['owner', 'admin']) THEN
    IF NEW.route_plan_id <> OLD.route_plan_id
       OR NEW.workspace_id <> OLD.workspace_id
       OR NEW.assigned_to_user_id <> OLD.assigned_to_user_id
       OR NEW.assigned_by_user_id <> OLD.assigned_by_user_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'assigned users cannot change assignment ownership fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."route_touch_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_complete_building_in_session"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
    v_address_id UUID;
    v_campaign_id UUID;
    v_user_id UUID;
    v_event_id UUID;
    v_building_id UUID;
BEGIN
    SELECT campaign_id, user_id INTO v_campaign_id, v_user_id
    FROM public.sessions WHERE id = p_session_id;
    IF v_user_id IS NULL OR (v_user_id::text) IS DISTINCT FROM (auth.uid()::text) THEN
        RAISE EXCEPTION 'Session not found or access denied';
    END IF;

    SELECT b.id INTO v_building_id
    FROM public.buildings b
    WHERE LOWER(b.gers_id::text) = LOWER(p_building_id)
    LIMIT 1;

    IF v_campaign_id IS NOT NULL THEN
        SELECT bal.address_id INTO v_address_id
        FROM public.building_address_links bal
        WHERE bal.building_id = v_building_id
          AND bal.campaign_id = v_campaign_id
        LIMIT 1;
    END IF;

    INSERT INTO public.session_events (
        session_id, building_id, address_id, event_type,
        lat, lon, event_location, metadata, user_id
    ) VALUES (
        p_session_id,
        v_building_id,
        v_address_id,
        p_event_type,
        p_lat,
        p_lon,
        CASE WHEN p_lon IS NOT NULL AND p_lat IS NOT NULL
             THEN ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
             ELSE NULL END,
        p_metadata,
        v_user_id
    )
    RETURNING id INTO v_event_id;

    IF p_event_type IN ('completed_manual', 'completed_auto', 'flyer_left', 'conversation') THEN
        UPDATE public.sessions
        SET completed_count = completed_count + 1, updated_at = now()
        WHERE id = p_session_id;
    ELSIF p_event_type = 'completion_undone' THEN
        UPDATE public.sessions
        SET completed_count = GREATEST(0, completed_count - 1), updated_at = now()
        WHERE id = p_session_id;
    END IF;

    IF p_event_type IN ('completed_manual', 'completed_auto', 'flyer_left', 'conversation')
       AND v_campaign_id IS NOT NULL AND NULLIF(TRIM(p_building_id), '') IS NOT NULL THEN
        UPDATE public.building_stats
        SET status = 'visited', last_scan_at = now(), updated_at = now()
        WHERE LOWER(TRIM(gers_id::text)) = LOWER(TRIM(p_building_id)) AND campaign_id = v_campaign_id;

        IF NOT FOUND AND v_building_id IS NOT NULL THEN
            INSERT INTO public.building_stats (building_id, gers_id, campaign_id, status, scans_total, scans_today, last_scan_at)
            SELECT
                v_building_id,
                b.gers_id,
                v_campaign_id,
                'visited',
                0,
                0,
                now()
            FROM public.buildings b
            WHERE b.id = v_building_id;
        END IF;

        IF v_address_id IS NOT NULL THEN
            UPDATE public.campaign_addresses
            SET visited = true
            WHERE id = v_address_id;
        END IF;
    END IF;

    RETURN jsonb_build_object('event_id', v_event_id, 'address_id', v_address_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_buildings_in_bbox"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(features.feature), '[]'::jsonb)
    ) INTO result
    FROM (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', b.id,
            'geometry', ST_AsGeoJSON(b.geom)::jsonb,
            'properties', jsonb_build_object(
                'id', b.id,
                'gers_id', b.gers_id,
                'height', COALESCE(b.height_m, b.height, 10),
                'height_m', COALESCE(b.height_m, b.height, 10),
                'min_height', 0,
                'status', COALESCE(s.status, 'not_visited'),
                'scans_today', COALESCE(s.scans_today, 0),
                'scans_total', COALESCE(s.scans_total, 0),
                'qr_scanned', COALESCE(s.scans_total, 0) > 0
            )
        ) AS feature
        FROM public.buildings b
        LEFT JOIN public.building_stats s ON b.gers_id = s.gers_id
        WHERE ST_Intersects(
            b.geom,
            ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
        )
        LIMIT 2000
    ) features;

    RETURN result;
END;
$function$; -- overload 1

CREATE OR REPLACE FUNCTION public."rpc_get_buildings_in_bbox"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
    bbox geometry;
    result jsonb;
BEGIN
    bbox := ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326);

    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(features.feature), '[]'::jsonb)
    ) INTO result
    FROM (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', b.id::text,
            'geometry', ST_AsGeoJSON(b.geom)::jsonb,
            'properties', jsonb_build_object(
                'id', b.id::text,
                'building_id', b.id::text,
                'gers_id', COALESCE(b.gers_id::text, NULL),
                'height', COALESCE(b.height_m, b.height, 10),
                'height_m', COALESCE(b.height_m, b.height, 10),
                'min_height', 0,
                'is_townhome', COALESCE(b.is_townhome_row, false),
                'units_count', COALESCE(b.units_count, 1),
                'address_text', ca.formatted,
                'match_method', l.method,
                'feature_status', CASE WHEN l.id IS NOT NULL THEN 'matched' ELSE 'orphan_building' END,
                'status', COALESCE(
                    s.status,
                    CASE b.latest_status
                        WHEN 'interested' THEN 'visited'
                        WHEN 'default' THEN 'not_visited'
                        ELSE 'not_visited'
                    END
                ),
                'scans_today', COALESCE(s.scans_today, 0),
                'scans_total', COALESCE(s.scans_total, 0),
                'last_scan_seconds_ago', CASE
                    WHEN s.last_scan_at IS NOT NULL THEN extract(epoch from (now() - s.last_scan_at))
                    ELSE NULL
                END
            )
        ) AS feature
        FROM public.buildings b
        LEFT JOIN public.building_address_links l ON b.id = l.building_id AND l.campaign_id = b.campaign_id
        LEFT JOIN public.campaign_addresses ca ON l.address_id = ca.id
        LEFT JOIN public.building_stats s ON LOWER(b.gers_id::text) = LOWER(s.gers_id::text)
        WHERE b.geom && bbox
          AND ST_Intersects(b.geom, bbox)
          AND (p_campaign_id IS NULL OR b.campaign_id = p_campaign_id)
        LIMIT 2000
    ) features;

    RETURN result;
END;
$function$; -- overload 2

CREATE OR REPLACE FUNCTION public."rpc_get_campaign_address_status_rows_for_farm_cycle"()
RETURNS record
LANGUAGE sql
AS $function$

WITH scoped_session_events AS (
    SELECT
        se.id,
        se.address_id AS campaign_address_id,
        s.campaign_id,
        COALESCE(NULLIF(TRIM(se.metadata ->> 'address_status'), ''), 'none') AS status,
        se.created_at,
        NULLIF(TRIM(se.metadata ->> 'notes'), '') AS notes,
        se.user_id AS last_action_by,
        se.session_id AS last_session_id,
        se.id AS last_home_event_id
    FROM public.session_events se
    JOIN public.sessions s
        ON s.id = se.session_id
    JOIN public.farm_touches ft
        ON ft.id = s.farm_touch_id
    WHERE s.campaign_id = p_campaign_id
      AND ft.cycle_number = p_cycle_number
      AND se.address_id IS NOT NULL
      AND COALESCE(NULLIF(TRIM(se.metadata ->> 'address_status'), ''), '') <> ''
),
scoped_farm_outcomes AS (
    SELECT
        fta.id,
        ca.id AS campaign_address_id,
        ca.campaign_id,
        fta.status,
        fta.occurred_at AS created_at,
        NULLIF(TRIM(fta.notes), '') AS notes,
        fta.created_by AS last_action_by,
        ft.session_id AS last_session_id,
        NULL::uuid AS last_home_event_id
    FROM public.farm_touch_addresses fta
    JOIN public.farm_touches ft
        ON ft.id = fta.farm_touch_id
    JOIN public.farm_addresses fa
        ON fa.id = fta.farm_address_id
    JOIN public.campaign_addresses ca
        ON ca.id = COALESCE(fta.campaign_address_id, fa.campaign_address_id)
    WHERE ft.cycle_number = p_cycle_number
      AND ca.campaign_id = p_campaign_id
      AND fta.status <> 'none'
),
scoped_events AS (
    SELECT * FROM scoped_session_events
    UNION ALL
    SELECT * FROM scoped_farm_outcomes
),
latest AS (
    SELECT DISTINCT ON (campaign_address_id)
        id,
        campaign_address_id,
        campaign_id,
        status,
        created_at AS last_visited_at,
        notes,
        last_action_by,
        last_session_id,
        last_home_event_id,
        created_at,
        created_at AS updated_at
    FROM scoped_events
    ORDER BY campaign_address_id, created_at DESC, id DESC
),
counts AS (
    SELECT
        campaign_address_id,
        COUNT(*) FILTER (WHERE status <> 'none') AS visit_count
    FROM scoped_events
    GROUP BY campaign_address_id
)
SELECT
    COALESCE(latest.id, latest.campaign_address_id) AS id,
    latest.campaign_address_id,
    latest.campaign_id,
    latest.status,
    latest.last_visited_at,
    latest.notes,
    COALESCE(counts.visit_count, 0) AS visit_count,
    latest.last_action_by,
    latest.last_session_id,
    latest.last_home_event_id,
    latest.created_at,
    latest.updated_at
FROM latest
LEFT JOIN counts
    ON counts.campaign_address_id = latest.campaign_address_id;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_campaign_addresses"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
    result jsonb;
BEGIN
    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(features.feature), '[]'::jsonb)
    ) INTO result
    FROM (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', a.id,
            'geometry', ST_AsGeoJSON(a.geom)::jsonb,
            'properties', jsonb_build_object(
                'id', a.id,
                'gers_id', a.gers_id,
                'building_gers_id', COALESCE(a.building_id::text, a.building_gers_id),
                'house_number', a.house_number,
                'street_name', a.street_name,
                'postal_code', a.postal_code,
                'locality', a.locality,
                'formatted', a.formatted,
                'source', a.source
            )
        ) AS feature
        FROM public.campaign_addresses a
        WHERE a.campaign_id = p_campaign_id
    ) features;

    RETURN COALESCE(result, '{"type":"FeatureCollection","features":[]}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_campaign_full_features"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_buildings jsonb := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  v_building_count integer := 0;
  v_result jsonb;
BEGIN
  v_buildings := COALESCE(public.rpc_get_campaign_renderable_buildings(p_campaign_id), v_buildings);
  v_building_count := COALESCE(jsonb_array_length(v_buildings->'features'), 0);

  IF v_building_count > 0 THEN
    RETURN v_buildings;
  END IF;

  SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
  )
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'type', 'Feature',
      'id', ca.id::text,
      'geometry', ST_AsGeoJSON(ca.geom, 6)::jsonb,
      'properties', jsonb_build_object(
        'id', ca.id::text,
        'address_id', ca.id::text,
        'source', 'address_point',
        'feature_type', 'address_point',
        'feature_status', 'address_point',
        'address_text', ca.formatted,
        'house_number', ca.house_number,
        'street_name', ca.street_name,
        'height', 5,
        'height_m', 5,
        'min_height', 0,
        'status', 'not_visited',
        'scans_today', 0,
        'scans_total', 0
      )
    ) AS feature
    FROM public.campaign_addresses ca
    WHERE ca.campaign_id = p_campaign_id
      AND ca.geom IS NOT NULL
  ) f;

  RETURN COALESCE(v_result, jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_campaign_map_bundle"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_campaign record;
  v_addresses jsonb := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  v_buildings jsonb := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  v_parcels jsonb := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  v_roads jsonb := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  v_address_count integer := 0;
  v_building_count integer := 0;
  v_parcel_count integer := 0;
  v_road_count integer := 0;
  v_updated_at timestamptz;
BEGIN
  SELECT
    c.id,
    c.provision_status,
    c.provision_phase,
    c.provision_source,
    c.region,
    c.updated_at,
    c.addresses_ready_at,
    c.map_ready_at,
    c.optimized_at
  INTO v_campaign
  FROM public.campaigns c
  WHERE c.id = p_campaign_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'campaign_id', p_campaign_id,
      'status', 'not_found',
      'phase', 'not_found',
      'map_ready', false,
      'addresses', v_addresses,
      'buildings', v_buildings,
      'parcels', v_parcels,
      'roads', v_roads,
      'counts', jsonb_build_object('addresses', 0, 'buildings', 0, 'parcels', 0, 'roads', 0),
      'updated_at', now()
    );
  END IF;

  BEGIN
    v_addresses := COALESCE(public.rpc_get_campaign_addresses(p_campaign_id), v_addresses);
  EXCEPTION WHEN OTHERS THEN
    v_addresses := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  END;

  IF v_campaign.provision_source NOT IN (
    'diamond', 'bedrock_ca', 'bedrock_us', 'bedrock_au',
    'bedrock_nz', 'bedrock_za', 'bedrock_uk'
  ) THEN
    -- Only run Gold building RPC for legacy provision sources.
    BEGIN
      v_buildings := COALESCE(
        public.rpc_get_campaign_full_features(p_campaign_id),
        v_buildings
      );
      IF v_buildings IS NULL THEN
        v_buildings := COALESCE(
          public.get_campaign_buildings_geojson(p_campaign_id),
          v_buildings
        );
      END IF;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        v_buildings := COALESCE(
          public.get_campaign_buildings_geojson(p_campaign_id),
          v_buildings
        );
      EXCEPTION WHEN OTHERS THEN
        v_buildings := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
      END;
    END;
  END IF;
  -- For diamond/bedrock_* campaigns, buildings come from PMTiles artifacts
  -- via the frontend fallback (MapBuildingsLayer manifest path). Skipping the
  -- Gold building RPC here prevents statement timeouts on
  -- rpc_get_campaign_full_features for these campaigns.

  BEGIN
    v_parcels := COALESCE(public.rpc_get_campaign_parcels(p_campaign_id), v_parcels);
  EXCEPTION WHEN OTHERS THEN
    v_parcels := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  END;

  BEGIN
    v_roads := COALESCE(public.rpc_get_campaign_roads_v2(p_campaign_id), v_roads);
  EXCEPTION WHEN OTHERS THEN
    v_roads := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
  END;

  v_address_count := COALESCE(jsonb_array_length(v_addresses->'features'), 0);
  v_building_count := COALESCE(jsonb_array_length(v_buildings->'features'), 0);
  v_parcel_count := COALESCE(jsonb_array_length(v_parcels->'features'), 0);
  v_road_count := COALESCE(jsonb_array_length(v_roads->'features'), 0);

  SELECT GREATEST(
    COALESCE(v_campaign.updated_at, '-infinity'::timestamptz),
    COALESCE(v_campaign.addresses_ready_at, '-infinity'::timestamptz),
    COALESCE(v_campaign.map_ready_at, '-infinity'::timestamptz),
    COALESCE(v_campaign.optimized_at, '-infinity'::timestamptz),
    COALESCE((SELECT max(ca.created_at) FROM public.campaign_addresses ca WHERE ca.campaign_id = p_campaign_id), '-infinity'::timestamptz),
    COALESCE((SELECT max(cp.created_at) FROM public.campaign_parcels cp WHERE cp.campaign_id = p_campaign_id), '-infinity'::timestamptz)
  )
  INTO v_updated_at;

  IF v_updated_at = '-infinity'::timestamptz THEN
    v_updated_at := now();
  END IF;

  RETURN jsonb_build_object(
    'campaign_id', p_campaign_id,
    'status', COALESCE(v_campaign.provision_status::text, 'pending'),
    'phase', COALESCE(v_campaign.provision_phase::text, v_campaign.provision_status::text, 'pending'),
    'source', COALESCE(v_campaign.provision_source::text, 'unknown'),
    'region', v_campaign.region,
    'map_ready', v_address_count > 0 AND (v_building_count > 0 OR v_parcel_count > 0 OR COALESCE(v_campaign.map_ready_at, v_campaign.optimized_at) IS NOT NULL),
    'addresses', v_addresses,
    'buildings', v_buildings,
    'parcels', v_parcels,
    'roads', v_roads,
    'counts', jsonb_build_object(
      'addresses', v_address_count,
      'buildings', v_building_count,
      'parcels', v_parcel_count,
      'roads', v_road_count
    ),
    'updated_at', v_updated_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_campaign_map_features"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
    bbox geometry;
    result jsonb;
BEGIN
    bbox := ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326);

    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(features.feature), '[]'::jsonb)
    ) INTO result
    FROM (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', COALESCE(slice.id, b.id),
            'geometry', ST_AsGeoJSON(COALESCE(slice.geom, b.geom))::jsonb,
            'properties', jsonb_build_object(
                'id', COALESCE(slice.id, b.id),
                'building_id', b.id,
                'address_id', ca.id,
                'gers_id', b.gers_id,
                'height', COALESCE(b.height_m, b.height, 10),
                'height_m', COALESCE(b.height_m, b.height, 10),
                'min_height', 0,
                'is_townhome', false, -- buildings table may not have is_townhome_row column
                'units_count', 0, -- buildings table may not have units_count column
                'address_text', ca.formatted,
                'match_method', l.method,
                'feature_status', CASE WHEN l.id IS NOT NULL THEN 'matched' ELSE 'orphan_building' END,
                'feature_type', CASE
                    WHEN slice.id IS NOT NULL THEN 'unit_slice'
                    WHEN l.id IS NOT NULL THEN 'matched_house'
                    ELSE 'orphan'
                END,
                'status', COALESCE(
                    s.status,
                    CASE b.latest_status
                        WHEN 'interested' THEN 'visited'
                        WHEN 'default' THEN 'not_visited'
                        WHEN 'not_home' THEN 'not_visited'
                        WHEN 'dnc' THEN 'not_visited'
                        WHEN 'available' THEN 'not_visited'
                        ELSE 'not_visited'
                    END
                ),
                'scans_today', COALESCE(s.scans_today, 0),
                'scans_total', COALESCE(s.scans_total, 0),
                'last_scan_seconds_ago', CASE
                    WHEN s.last_scan_at IS NOT NULL THEN extract(epoch from (now() - s.last_scan_at))
                    ELSE NULL
                END,
                'unit_points', NULL, -- buildings table may not have unit_points column
                'divider_lines', NULL -- buildings table may not have divider_lines column
            )
        ) AS feature
        FROM public.buildings b
        LEFT JOIN public.building_address_links l ON b.id = l.building_id AND l.campaign_id = b.campaign_id
        LEFT JOIN public.campaign_addresses ca ON l.address_id = ca.id
        LEFT JOIN public.building_slices slice ON slice.address_id = ca.id AND slice.building_id = b.id AND slice.campaign_id = b.campaign_id
        LEFT JOIN public.building_stats s ON b.gers_id = s.gers_id
        WHERE b.campaign_id = p_campaign_id
          AND COALESCE(slice.geom, b.geom) && bbox
          AND ST_Intersects(COALESCE(slice.geom, b.geom), bbox)
        LIMIT 1000
    ) features;

    RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_campaign_member_directory"()
RETURNS record
LANGUAGE sql
AS $function$

    SELECT
        cm.user_id,
        cm.role,
        COALESCE(
            NULLIF(TRIM(COALESCE(p.nickname, '')), ''),
            NULLIF(TRIM(COALESCE(p.full_name, '')), ''),
            NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
            NULLIF(SPLIT_PART(COALESCE(p.email, ''), '@', 1), ''),
            LEFT(cm.user_id::text, 8)
        ) AS display_name,
        p.email,
        COALESCE(NULLIF(TRIM(COALESCE(p.profile_image_url, '')), ''), p.avatar_url) AS avatar_url,
        cm.created_at
    FROM public.campaign_members cm
    LEFT JOIN public.profiles p
        ON p.id = cm.user_id
    WHERE cm.campaign_id = p_campaign_id
      AND public.is_campaign_member(p_campaign_id)
    ORDER BY
        CASE cm.role
            WHEN 'owner' THEN 0
            WHEN 'admin' THEN 1
            ELSE 2
        END,
        lower(
            COALESCE(
                NULLIF(TRIM(COALESCE(p.nickname, '')), ''),
                NULLIF(TRIM(COALESCE(p.full_name, '')), ''),
                NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''),
                NULLIF(SPLIT_PART(COALESCE(p.email, ''), '@', 1), ''),
                cm.user_id::text
            )
        );
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_campaign_parcels"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_boundary geometry;
BEGIN
  SELECT ST_SetSRID(ST_MakeValid(c.territory_boundary), 4326)
  INTO v_boundary
  FROM public.campaigns c
  WHERE c.id = p_campaign_id
    AND c.territory_boundary IS NOT NULL;

  RETURN (
    WITH scoped AS (
      SELECT
        p.id,
        p.external_id,
        p.properties,
        CASE
          WHEN v_boundary IS NULL THEN p.geom
          ELSE ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Intersection(p.geom, v_boundary)), 3))
        END AS geom
      FROM public.campaign_parcels p
      WHERE p.campaign_id = p_campaign_id
        AND (v_boundary IS NULL OR ST_Intersects(p.geom, v_boundary))
    ),
    renderable AS (
      SELECT *
      FROM scoped
      WHERE geom IS NOT NULL
        AND NOT ST_IsEmpty(geom)
        AND ST_Area(geom::geography) > 0
    )
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', id,
            'type', 'Feature',
            'geometry', ST_AsGeoJSON(geom)::jsonb,
            'properties', jsonb_build_object(
              'id', id,
              'parcel_id', COALESCE(NULLIF(external_id, ''), id::text),
              'external_id', external_id,
              'source', COALESCE(properties->>'source', 'campaign_parcels'),
              'area_sqm', ROUND(ST_Area(geom::geography)::numeric, 2)
            )
          )
          ORDER BY ST_Area(geom::geography) DESC
        ),
        '[]'::jsonb
      )
    )
    FROM renderable
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_campaign_renderable_buildings"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_has_gold boolean := false;
  v_has_silver boolean := false;
  v_result jsonb := jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb);
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.campaign_addresses ca
    JOIN public.ref_buildings_gold b
      ON b.id::text = COALESCE(ca.building_id::text, ca.building_gers_id::text)
    WHERE ca.campaign_id = p_campaign_id
    LIMIT 1
  )
  INTO v_has_gold;

  IF v_has_gold THEN
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
    )
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'type', 'Feature',
        'id', b.id::text,
        'geometry', ST_AsGeoJSON(b.geom, 6)::jsonb,
        'properties', jsonb_build_object(
          'id', b.id::text,
          'building_id', b.id::text,
          'gers_id', b.id::text,
          'source', 'gold',
          'address_count', COUNT(ca.id),
          'address_id', CASE WHEN COUNT(ca.id) = 1 THEN MIN(ca.id)::text ELSE NULL END,
          'address_text', CASE WHEN COUNT(ca.id) = 1 THEN MIN(ca.formatted) ELSE NULL END,
          'house_number', CASE WHEN COUNT(ca.id) = 1 THEN MIN(ca.house_number) ELSE NULL END,
          'street_name', CASE WHEN COUNT(ca.id) = 1 THEN MIN(ca.street_name) ELSE NULL END,
          'height', COALESCE(b.height_m, 10),
          'height_m', COALESCE(b.height_m, 10),
          'min_height', 0,
          'area_sqm', CASE
            WHEN b.area_sqm IS NULL OR b.area_sqm < 30
              THEN ROUND(ST_Area(b.geom::geography)::numeric, 2)
            ELSE b.area_sqm
          END,
          'building_type', b.building_type,
          'feature_type', 'matched_house',
          'feature_status', 'matched',
          'is_linked', true,
          'status', COALESCE(MIN(s.status), 'not_visited'),
          'scans_today', COALESCE(SUM(s.scans_today), 0),
          'scans_total', COALESCE(SUM(s.scans_total), 0)
        )
      ) AS feature
      FROM public.campaign_addresses ca
      JOIN public.ref_buildings_gold b
        ON b.id::text = COALESCE(ca.building_id::text, ca.building_gers_id::text)
      LEFT JOIN public.building_stats s
        ON s.gers_id = b.id::text
      WHERE ca.campaign_id = p_campaign_id
      GROUP BY b.id, b.geom, b.height_m, b.area_sqm, b.building_type
    ) f;

    RETURN COALESCE(v_result, jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb));
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.building_address_links l
    JOIN public.buildings b
      ON b.gers_id = l.building_id
     AND b.campaign_id = p_campaign_id
    WHERE l.campaign_id = p_campaign_id
    LIMIT 1
  )
  INTO v_has_silver;

  IF v_has_silver THEN
    SELECT jsonb_build_object(
      'type', 'FeatureCollection',
      'features', COALESCE(jsonb_agg(f.feature), '[]'::jsonb)
    )
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'type', 'Feature',
        'id', l.building_id,
        'geometry', ST_AsGeoJSON(b.geom, 6)::jsonb,
        'properties', jsonb_build_object(
          'id', l.building_id,
          'building_id', l.building_id,
          'gers_id', l.building_id,
          'source', 'silver',
          'address_id', ca.id::text,
          'address_text', ca.formatted,
          'house_number', ca.house_number,
          'street_name', ca.street_name,
          'height', COALESCE(b.height_m, b.height, 10),
          'height_m', COALESCE(b.height_m, b.height, 10),
          'min_height', 0,
          'is_townhome', COALESCE(b.is_townhome_row, false),
          'units_count', COALESCE(b.units_count, 1),
          'match_method', l.match_type,
          'feature_type', 'matched_house',
          'feature_status', 'matched',
          'is_linked', true,
          'status', COALESCE(
            s.status,
            CASE b.latest_status
              WHEN 'interested' THEN 'visited'
              WHEN 'default' THEN 'not_visited'
              ELSE 'not_visited'
            END
          ),
          'scans_today', COALESCE(s.scans_today, 0),
          'scans_total', COALESCE(s.scans_total, 0)
        )
      ) AS feature
      FROM public.building_address_links l
      JOIN public.campaign_addresses ca
        ON ca.id = l.address_id
      JOIN public.buildings b
        ON b.gers_id = l.building_id
       AND b.campaign_id = p_campaign_id
      LEFT JOIN public.building_stats s
        ON s.gers_id = l.building_id
      WHERE l.campaign_id = p_campaign_id
    ) f;
  END IF;

  RETURN COALESCE(v_result, jsonb_build_object('type', 'FeatureCollection', 'features', '[]'::jsonb));
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_campaign_road_metadata"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
    v_metadata RECORD;
    v_age_days NUMERIC;
BEGIN
    SELECT * INTO v_metadata
    FROM public.campaign_road_metadata
    WHERE campaign_id = p_campaign_id;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'campaign_id', p_campaign_id,
            'roads_status', 'pending',
            'road_count', 0,
            'cache_version', 0,
            'corridor_build_version', 1,
            'fetched_at', NULL,
            'expires_at', NULL,
            'last_refresh_at', NULL,
            'age_days', NULL,
            'is_stale', false,
            'last_error_message', NULL,
            'source', 'mapbox'
        );
    END IF;
    
    v_age_days := NULL;
    IF v_metadata.fetched_at IS NOT NULL THEN
        v_age_days := EXTRACT(EPOCH FROM (NOW() - v_metadata.fetched_at)) / 86400;
    END IF;
    
    RETURN jsonb_build_object(
        'campaign_id', p_campaign_id,
        'roads_status', COALESCE(v_metadata.roads_status, 'pending'),
        'road_count', COALESCE(v_metadata.road_count, 0),
        'cache_version', COALESCE(v_metadata.cache_version, 0),
        'corridor_build_version', COALESCE(v_metadata.corridor_build_version, 1),
        'fetched_at', v_metadata.fetched_at,
        'expires_at', v_metadata.expires_at,
        'last_refresh_at', v_metadata.last_refresh_at,
        'age_days', v_age_days,
        'is_stale', v_age_days IS NOT NULL AND v_age_days >= 30,
        'last_error_message', v_metadata.last_error_message,
        'source', COALESCE(v_metadata.source, 'mapbox')
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_campaign_roads"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

BEGIN
    RETURN jsonb_build_object(
        'type', 'FeatureCollection',
        'features', '[]'::jsonb
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_campaign_roads_v2"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'type', 'FeatureCollection',
        'features', COALESCE(jsonb_agg(features.feature ORDER BY features.road_name), '[]'::jsonb)
    ) INTO result
    FROM (
        SELECT jsonb_build_object(
            'type', 'Feature',
            'id', r.road_id,
            'geometry', ST_AsGeoJSON(r.geom)::jsonb,
            'properties', jsonb_build_object(
                'id', r.road_id,
                'name', r.road_name,
                'class', r.road_class,
                'cache_version', r.cache_version,
                'corridor_build_version', r.corridor_build_version
            )
        ) AS feature,
            r.road_name
        FROM public.campaign_roads r
        WHERE r.campaign_id = p_campaign_id
    ) features;
    RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_campaign_stats"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_addr_count INTEGER;
  v_build_count INTEGER;
  v_visited_count INTEGER;
  v_scanned_count INTEGER;
BEGIN
  SELECT count(*) INTO v_addr_count 
  FROM public.campaign_addresses WHERE campaign_id = p_campaign_id;
  
  SELECT count(*) INTO v_build_count 
  FROM public.buildings WHERE campaign_id = p_campaign_id;
  
  SELECT count(*) INTO v_visited_count 
  FROM public.buildings 
  WHERE campaign_id = p_campaign_id AND latest_status NOT IN ('available', 'default');
  
  SELECT count(*) INTO v_scanned_count 
  FROM public.campaign_addresses 
  WHERE campaign_id = p_campaign_id AND scans > 0;

  RETURN jsonb_build_object(
    'addresses', v_addr_count,
    'buildings', v_build_count,
    'visited', v_visited_count,
    'scanned', v_scanned_count,
    'scan_rate', CASE WHEN v_addr_count > 0 
      THEN round((v_scanned_count::numeric / v_addr_count::numeric) * 100, 1) ELSE 0 END,
    'progress_pct', CASE WHEN v_build_count > 0 
      THEN round((v_visited_count::numeric / v_build_count::numeric) * 100, 1) ELSE 0 END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_public_session_beacon"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
    v_share public.session_shares%ROWTYPE;
    v_result JSONB;
BEGIN
    SELECT ss.*
    INTO v_share
    FROM public.session_shares ss
    INNER JOIN public.sessions s ON s.id = ss.session_id
    WHERE ss.share_token_hash = md5(COALESCE(p_share_token, ''))
      AND ss.revoked_at IS NULL
      AND (ss.expires_at IS NULL OR ss.expires_at > now())
      AND s.end_time IS NULL
    ORDER BY ss.created_at DESC
    LIMIT 1;

    IF v_share.id IS NULL THEN
        RETURN jsonb_build_object(
            'active', false,
            'reason', 'expired'
        );
    END IF;

    UPDATE public.session_shares
    SET last_viewed_at = now()
    WHERE id = v_share.id;

    WITH session_row AS (
        SELECT
            s.id,
            s.start_time,
            s.end_time,
            s.goal_type,
            s.goal_amount,
            s.completed_count,
            s.flyers_delivered,
            s.conversations,
            s.distance_meters,
            s.is_paused,
            s.campaign_id,
            s.farm_phase_id
        FROM public.sessions s
        WHERE s.id = v_share.session_id
    ),
    latest_heartbeat AS (
        SELECT
            h.lat,
            h.lon,
            h.battery_level,
            h.movement_state,
            h.device_status,
            h.recorded_at
        FROM public.session_heartbeats h
        WHERE h.session_id = v_share.session_id
        ORDER BY h.recorded_at DESC
        LIMIT 1
    ),
    fallback_location AS (
        SELECT
            se.lat,
            se.lon,
            se.created_at AS recorded_at,
            se.event_type
        FROM public.session_events se
        WHERE se.session_id = v_share.session_id
          AND se.event_type IN ('session_started', 'session_resumed', 'session_paused')
          AND se.lat IS NOT NULL
          AND se.lon IS NOT NULL
          AND se.lat BETWEEN -90 AND 90
          AND se.lon BETWEEN -180 AND 180
          AND NOT (ABS(se.lat) < 0.000001 AND ABS(se.lon) < 0.000001)
        ORDER BY se.created_at DESC, se.id DESC
        LIMIT 1
    ),
    breadcrumb_rows AS (
        SELECT jsonb_build_object(
            'lat', h.lat,
            'lon', h.lon,
            'battery_level', h.battery_level,
            'movement_state', h.movement_state,
            'recorded_at', h.recorded_at
        ) AS item
        FROM public.session_heartbeats h
        WHERE h.session_id = v_share.session_id
          AND h.recorded_at >= GREATEST(
              now() - INTERVAL '12 hours',
              v_share.created_at - INTERVAL '15 minutes'
          )
        ORDER BY h.recorded_at ASC
        LIMIT 500
    ),
    session_door_events AS (
        SELECT DISTINCT ON (se.address_id)
            se.address_id,
            se.event_type,
            COALESCE(se.metadata ->> 'address_status', 'none') AS address_status,
            se.created_at
        FROM public.session_events se
        WHERE se.session_id = v_share.session_id
          AND se.address_id IS NOT NULL
          AND se.event_type IN ('completed_manual', 'completed_auto', 'completion_undone')
        ORDER BY se.address_id, se.created_at DESC, se.id DESC
    ),
    session_doors AS (
        SELECT
            sde.created_at,
            jsonb_build_object(
                'address_id', ca.id,
                'formatted', ca.formatted,
                'house_number', ca.house_number,
                'street_name', ca.street_name,
                'lat', ST_Y(ca.geom::geometry),
                'lon', ST_X(ca.geom::geometry),
                'status', sde.address_status,
                'map_status', CASE
                    WHEN sde.address_status IN ('talked', 'appointment', 'hot_lead') THEN 'hot'
                    WHEN sde.address_status = 'do_not_knock' THEN 'do_not_knock'
                    WHEN sde.address_status = 'no_answer' THEN 'no_answer'
                    WHEN sde.address_status IN ('delivered', 'future_seller') THEN 'visited'
                    ELSE 'not_visited'
                END,
                'event_type', sde.event_type,
                'created_at', sde.created_at
            ) AS item
        FROM session_door_events sde
        JOIN public.campaign_addresses ca ON ca.id = sde.address_id
        WHERE sde.event_type <> 'completion_undone'
          AND ca.geom IS NOT NULL
        ORDER BY sde.created_at DESC
        LIMIT 300
    ),
    active_events AS (
        SELECT jsonb_build_object(
            'id', se.id,
            'event_type', se.event_type,
            'message', se.message,
            'lat', se.lat,
            'lon', se.lon,
            'created_at', se.created_at
        ) AS item
        FROM public.safety_events se
        WHERE se.session_id = v_share.session_id
          AND se.acknowledged_at IS NULL
          AND se.created_at >= now() - INTERVAL '24 hours'
        ORDER BY se.created_at DESC
        LIMIT 20
    )
    SELECT jsonb_build_object(
        'active', true,
        'share', jsonb_build_object(
            'id', v_share.id,
            'viewer_label', v_share.viewer_label,
            'created_at', v_share.created_at,
            'check_in_interval_minutes', v_share.check_in_interval_minutes,
            'last_viewed_at', now()
        ),
        'session', COALESCE((SELECT to_jsonb(sr) FROM session_row sr), '{}'::jsonb),
        'latest_heartbeat', COALESCE((SELECT to_jsonb(lh) FROM latest_heartbeat lh), 'null'::jsonb),
        'fallback_location', COALESCE(
            (
                SELECT jsonb_build_object(
                    'lat', fl.lat,
                    'lon', fl.lon,
                    'recorded_at', fl.recorded_at,
                    'event_type', fl.event_type
                )
                FROM fallback_location fl
            ),
            'null'::jsonb
        ),
        'breadcrumbs', COALESCE((SELECT jsonb_agg(br.item) FROM breadcrumb_rows br), '[]'::jsonb),
        'session_doors', COALESCE((SELECT jsonb_agg(sd.item ORDER BY sd.created_at DESC) FROM session_doors sd), '[]'::jsonb),
        'safety_events', COALESCE((SELECT jsonb_agg(ae.item) FROM active_events ae), '[]'::jsonb)
    )
    INTO v_result;

    RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_get_session_with_events"()
RETURNS jsonb
LANGUAGE sql
AS $function$

    SELECT jsonb_build_object(
        'session', to_jsonb(s),
        'events', COALESCE(
            (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at)
             FROM public.session_events e WHERE e.session_id = p_session_id),
            '[]'::jsonb
        )
    )
    FROM public.sessions s
    WHERE s.id = p_session_id AND (s.user_id::text) = (auth.uid()::text);
$function$;

CREATE OR REPLACE FUNCTION public."rpc_update_road_preparation_status"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
    INSERT INTO public.campaign_road_metadata (campaign_id, roads_status, last_error_message, last_error_at, retry_count)
    VALUES (p_campaign_id, p_status, p_error_message, CASE WHEN p_error_message IS NOT NULL THEN NOW() END, 0)
    ON CONFLICT (campaign_id) DO UPDATE SET
        roads_status = p_status,
        last_error_message = COALESCE(p_error_message, campaign_road_metadata.last_error_message),
        last_error_at = CASE WHEN p_error_message IS NOT NULL THEN NOW() ELSE campaign_road_metadata.last_error_at END,
        retry_count = CASE WHEN p_status = 'failed' THEN campaign_road_metadata.retry_count + 1 ELSE campaign_road_metadata.retry_count END,
        updated_at = NOW();
END;
$function$;

CREATE OR REPLACE FUNCTION public."rpc_upsert_campaign_roads"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
    v_road JSONB;
    v_count INTEGER := 0;
    v_cache_version INTEGER;
BEGIN
    SELECT COALESCE(MAX(cache_version), 0) + 1 INTO v_cache_version
    FROM public.campaign_roads
    WHERE campaign_id = p_campaign_id;
    
    DELETE FROM public.campaign_roads WHERE campaign_id = p_campaign_id;
    
    FOR v_road IN SELECT * FROM jsonb_array_elements(p_roads)
    LOOP
        INSERT INTO public.campaign_roads (
            campaign_id, road_id, road_name, road_class, geom,
            bbox_min_lat, bbox_min_lon, bbox_max_lat, bbox_max_lon,
            source, source_version, cache_version, properties
        ) VALUES (
            p_campaign_id,
            v_road->>'road_id',
            v_road->>'road_name',
            v_road->>'road_class',
            ST_SetSRID(ST_GeomFromGeoJSON(v_road->'geom'), 4326),
            (v_road->>'bbox_min_lat')::DOUBLE PRECISION,
            (v_road->>'bbox_min_lon')::DOUBLE PRECISION,
            (v_road->>'bbox_max_lat')::DOUBLE PRECISION,
            (v_road->>'bbox_max_lon')::DOUBLE PRECISION,
            COALESCE(v_road->>'source', 'mapbox'),
            v_road->>'source_version',
            v_cache_version,
            COALESCE(v_road->'properties', '{}'::jsonb)
        );
        v_count := v_count + 1;
    END LOOP;
    
    INSERT INTO public.campaign_road_metadata (
        campaign_id, roads_status, road_count, bounds, cache_version, corridor_build_version,
        fetched_at, expires_at, last_refresh_at, source, last_error_message, last_error_at, retry_count
    ) VALUES (
        p_campaign_id, 'ready', v_count, p_metadata->'bounds', v_cache_version,
        COALESCE((p_metadata->>'corridor_build_version')::INTEGER, 1),
        NOW(), NOW() + INTERVAL '30 days', NOW(),
        COALESCE(p_metadata->>'source', 'mapbox'), NULL, NULL, 0
    )
    ON CONFLICT (campaign_id) DO UPDATE SET
        roads_status = 'ready',
        road_count = v_count,
        bounds = EXCLUDED.bounds,
        cache_version = v_cache_version,
        corridor_build_version = EXCLUDED.corridor_build_version,
        fetched_at = NOW(),
        expires_at = NOW() + INTERVAL '30 days',
        last_refresh_at = NOW(),
        source = EXCLUDED.source,
        last_error_message = NULL,
        last_error_at = NULL,
        retry_count = 0,
        updated_at = NOW();
    
    RETURN jsonb_build_object('success', true, 'road_count', v_count, 'cache_version', v_cache_version);
END;
$function$;

CREATE OR REPLACE FUNCTION public."search_brokerages"()
RETURNS record
LANGUAGE sql
AS $function$

  SELECT *
  FROM public.brokerages
  WHERE query IS NOT NULL
    AND length(trim(query)) > 0
    AND (name ILIKE trim(query) || '%' OR name ILIKE '%' || trim(query) || '%')
  ORDER BY
    CASE WHEN name ILIKE trim(query) || '%' THEN 0 ELSE 1 END,
    name ASC
  LIMIT greatest(1, least(max_results, 50));
$function$;

CREATE OR REPLACE FUNCTION public."set_address_content_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public."set_building_status"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
    -- Validate status
    IF p_status NOT IN ('not_visited', 'visited', 'hot') THEN
        RAISE EXCEPTION 'Invalid status: %. Must be one of: not_visited, visited, hot', p_status;
    END IF;
    
    -- Update building stats
    INSERT INTO public.building_stats (building_id, status)
    VALUES (p_building_id, p_status)
    ON CONFLICT (building_id) DO UPDATE SET
        status = p_status,
        updated_at = NOW();
END;
$function$;

CREATE OR REPLACE FUNCTION public."set_meta_ads_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."support_mark_thread_read_for_support"()
RETURNS void
LANGUAGE plpgsql
AS $function$

DECLARE
  v_is_support boolean := false;
BEGIN
  SELECT COALESCE(p.is_support, false)
  INTO v_is_support
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF NOT public.is_founder() AND NOT v_is_support THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.support_threads
  SET unread_for_support = false,
      updated_at = now()
  WHERE id = p_thread_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public."support_mark_thread_read_for_user"()
RETURNS void
LANGUAGE plpgsql
AS $function$

DECLARE
  v_owner_id uuid;
BEGIN
  SELECT st.user_id
  INTO v_owner_id
  FROM public.support_threads st
  WHERE st.id = p_thread_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'thread not found';
  END IF;

  IF v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.support_threads
  SET unread_for_user = false,
      updated_at = now()
  WHERE id = p_thread_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public."support_on_message_insert"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  UPDATE public.support_threads
  SET
    last_message_at = COALESCE(NEW.created_at, now()),
    last_sender_type = NEW.sender_type,
    last_message_id = NEW.id,
    last_message_preview = left(COALESCE(NEW.body, ''), 120),
    needs_reply = CASE
      WHEN NEW.sender_type = 'user' THEN true
      WHEN NEW.sender_type = 'support' THEN false
      ELSE needs_reply
    END,
    unread_for_support = CASE
      WHEN NEW.sender_type = 'user' THEN true
      ELSE unread_for_support
    END,
    unread_for_user = CASE
      WHEN NEW.sender_type = 'support' THEN true
      ELSE unread_for_user
    END,
    updated_at = now()
  WHERE id = NEW.thread_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."support_thread_last_message_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  UPDATE public.support_threads
  SET last_message_at = NEW.created_at
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."sync_bbox_data"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_addr_count INTEGER;
  v_bldg_count INTEGER;
BEGIN
  -- 1. Wipe old data
  DELETE FROM public.campaign_addresses WHERE campaign_id = p_campaign_id;
  DELETE FROM public.buildings WHERE campaign_id = p_campaign_id;
  
  -- 2. Insert Addresses
  WITH inserted_addresses AS (
    INSERT INTO public.campaign_addresses (
      campaign_id, gers_id, house_number, street_name, postal_code, formatted, geom
    )
    SELECT 
      p_campaign_id, 
      addr->>'gers_id', 
      addr->>'house_number', 
      addr->>'street_name', 
      addr->>'postal_code',
      trim(concat_ws(' ', addr->>'house_number', addr->>'street_name', nullif(concat(', ', addr->>'postal_code'), ', '))),
      ST_SetSRID(ST_GeomFromGeoJSON(addr->>'geometry'), 4326)
    FROM jsonb_array_elements(p_addresses) AS addr
    RETURNING id, geom
  ),
  -- 3. Prepare Buildings
  building_input AS (
    SELECT 
      (b->>'gers_id') as g_id,
      ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)) as g_geom,
      (b->>'height')::numeric as g_height
    FROM jsonb_array_elements(p_buildings) AS b
  ),
  -- 4. Match and Insert
  matched_buildings AS (
    INSERT INTO public.buildings (
      gers_id, geom, centroid, height_m, campaign_id, address_id, latest_status
    )
    SELECT DISTINCT ON (bi.g_id)
      bi.g_id, bi.g_geom, ST_Centroid(bi.g_geom), bi.g_height, 
      p_campaign_id, ia.id, 'default'
    FROM inserted_addresses ia
    CROSS JOIN LATERAL (
      SELECT * FROM building_input b
      WHERE ST_DWithin(ia.geom::geography, b.g_geom::geography, 50)
      ORDER BY 
        ST_Intersects(b.g_geom, ia.geom) DESC,
        ia.geom <-> b.g_geom ASC
      LIMIT 1
    ) bi
    ON CONFLICT (gers_id) DO UPDATE SET 
      latest_status = 'default', 
      campaign_id = EXCLUDED.campaign_id,
      address_id = EXCLUDED.address_id
    RETURNING gers_id
  )
  SELECT count(*) INTO v_bldg_count FROM matched_buildings;

  -- 5. Return final stats
  SELECT count(*) INTO v_addr_count FROM public.campaign_addresses WHERE campaign_id = p_campaign_id;
  
  RETURN jsonb_build_object(
    'addresses_saved', v_addr_count,
    'buildings_matched', v_bldg_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."sync_buildings_pro"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_overture_linked int := 0;
  v_synthetic_created int := 0;
  v_buildings_array jsonb;
BEGIN
  -- 1. SAFETY CHECK: Convert scalar string back to array if needed
  -- This prevents the "cannot extract elements from a scalar" error
  -- If TypeScript sends array: Postgres sees array → skips to ELSE
  -- If TypeScript sends stringified: Postgres sees string → #>>'{}' extracts content, ::jsonb turns it back into array
  IF jsonb_typeof(p_buildings) = 'string' THEN
    -- Extract text value from jsonb string container and cast to jsonb
    v_buildings_array := (p_buildings#>>'{}')::jsonb;
  ELSE
    v_buildings_array := p_buildings;
  END IF;

  -- If it's still not an array or is empty, skip to synthetic creation
  IF v_buildings_array IS NULL OR jsonb_typeof(v_buildings_array) != 'array' THEN
    v_buildings_array := '[]'::jsonb;
  END IF;

  -- 2. CLEANUP
  DELETE FROM public.buildings WHERE campaign_id = p_campaign_id;
  UPDATE public.campaign_addresses SET gers_id = NULL WHERE campaign_id = p_campaign_id;

  -- 3. THE SURGICAL MATCH (Spatial Handshake with Pro Logic)
  -- We take the broad list from MotherDuck and match them to our addresses here
  -- The "Pro" Matching Logic:
  -- 1. Cast a 25m net (ST_DWithin) - catches addresses on sidewalk/curb vs building footprint
  -- 2. Sort by Distance FIRST (closest building wins) - avoids matching distant sheds
  -- 3. Sort by Area SECOND (largest building wins) - avoids matching small garages
  -- Result: The building that is both close AND large is almost certainly the primary residence
  WITH building_input AS (
    SELECT 
      (b->>'gers_id') as g_id,
      ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(b->>'geometry'), 4326)) as g_geom,
      COALESCE((b->>'height')::numeric, 8) as g_height
    FROM jsonb_array_elements(v_buildings_array) AS b
  ),
  ranked_matches AS (
    SELECT DISTINCT ON (ca.id)
      ca.id as address_id,
      bi.g_id as building_gers_id,
      bi.g_geom,
      bi.g_height,
      ST_Distance(ca.geom::geography, bi.g_geom::geography) as distance_m
    FROM public.campaign_addresses ca
    JOIN building_input bi ON ST_DWithin(ca.geom::geography, bi.g_geom::geography, 25)
    WHERE ca.campaign_id = p_campaign_id
    ORDER BY 
      ca.id, 
      ST_Distance(ca.geom::geography, bi.g_geom::geography) ASC,  -- Closest first (tie-breaker #1)
      ST_Area(bi.g_geom) DESC  -- Then largest (tie-breaker #2)
  )
  INSERT INTO public.buildings (gers_id, geom, centroid, height_m, campaign_id, address_id, latest_status)
  SELECT building_gers_id, g_geom, ST_Centroid(g_geom), g_height, p_campaign_id, address_id, 'default'
  FROM ranked_matches
  ON CONFLICT (gers_id) DO UPDATE SET geom = EXCLUDED.geom, centroid = EXCLUDED.centroid;

  GET DIAGNOSTICS v_overture_linked = ROW_COUNT;

  -- 4. SAFETY NET: Create synthetic boxes for missing houses
  INSERT INTO public.buildings (gers_id, geom, centroid, height_m, campaign_id, address_id, latest_status)
  SELECT 
    'synthetic-' || ca.id::text,
    ST_Multi(ST_Buffer(ca.geom::geography, 6)::geometry),
    ca.geom::geometry as centroid,
    8,
    p_campaign_id,
    ca.id,
    'default'
  FROM public.campaign_addresses ca
  WHERE ca.campaign_id = p_campaign_id 
    AND NOT EXISTS (SELECT 1 FROM public.buildings b WHERE b.address_id = ca.id);

  GET DIAGNOSTICS v_synthetic_created = ROW_COUNT;

  -- 5. FINAL HANDSHAKE (Step 2 of Two-Way Link): Link addresses to the buildings we just created/matched
  -- Step 1 (above, line 60): Building → Address (stores address_id in buildings table)
  -- Step 2 (here): Address → Building (stores gers_id in campaign_addresses table)
  -- This enables both workflows:
  --   - Building-First: Click house → building.address_id → show contact instantly
  --   - Address-First: Scan QR → address.gers_id → highlight building on map instantly
  UPDATE public.campaign_addresses ca
  SET gers_id = b.gers_id
  FROM public.buildings b
  WHERE b.address_id = ca.id AND ca.campaign_id = p_campaign_id;

  RETURN jsonb_build_object(
    'overture_linked', v_overture_linked,
    'synthetic_created', v_synthetic_created
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."sync_buildings_to_addresses"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
    v_inserted_count int := 0;
    v_updated_addresses int := 0;
BEGIN
    -- 1. Safety Check: If p_buildings is null or not an array, just return zero
    IF p_buildings IS NULL OR jsonb_typeof(p_buildings) != 'array' THEN
        RETURN jsonb_build_object('inserted', 0, 'updated', 0, 'error', 'Invalid input format');
    END IF;

    -- 2. Insert buildings that touch our selected addresses
    INSERT INTO buildings (gers_id, geom, height_m, campaign_id, latest_status)
    SELECT 
        (b->>'gers_id'), 
        ST_Multi(ST_GeomFromGeoJSON(b->>'geometry')), 
        COALESCE((b->>'height')::numeric, 10), -- Default height if missing
        p_campaign_id,
        'available'
    FROM jsonb_array_elements(p_buildings) AS b
    WHERE EXISTS (
        SELECT 1 FROM campaign_addresses ca 
        WHERE ca.campaign_id = p_campaign_id 
        AND ST_Intersects(ca.geom::geometry, ST_GeomFromGeoJSON(b->>'geometry'))
    )
    ON CONFLICT (gers_id) DO UPDATE SET 
        geom = EXCLUDED.geom,
        height_m = EXCLUDED.height_m;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    -- 3. The Handshake: Link address GERS to building GERS
    UPDATE campaign_addresses ca
    SET gers_id = b.gers_id
    FROM buildings b
    WHERE ca.campaign_id = p_campaign_id
    AND b.campaign_id = p_campaign_id
    AND ST_Intersects(ca.geom::geometry, b.geom);

    GET DIAGNOSTICS v_updated_addresses = ROW_COUNT;

    RETURN jsonb_build_object(
        'inserted', v_inserted_count,
        'updated', v_updated_addresses
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public."sync_campaign_building_front_bearing"()
RETURNS void
LANGUAGE plpgsql
AS $function$

DECLARE
    v_address_id uuid;
    v_address_building_id uuid;
    v_bearing double precision;
BEGIN
    -- Get address_id from campaign_buildings
    SELECT address_id
    INTO v_address_id
    FROM public.campaign_buildings
    WHERE id = p_campaign_building_id;

    IF v_address_id IS NULL THEN
        RETURN;
    END IF;

    -- Get address_building_id from address_buildings
    SELECT id
    INTO v_address_building_id
    FROM public.address_buildings
    WHERE address_id = v_address_id
    LIMIT 1;

    IF v_address_building_id IS NULL THEN
        RETURN;
    END IF;

    -- Get bearing from address_buildings
    SELECT front_bearing
    INTO v_bearing
    FROM public.address_buildings
    WHERE id = v_address_building_id;

    -- If bearing is NULL or 0, try to compute it
    IF v_bearing IS NULL OR v_bearing = 0 THEN
        v_bearing := public.compute_front_bearing_for_address_building(v_address_building_id);
    END IF;

    -- Update campaign_buildings with the bearing
    UPDATE public.campaign_buildings
    SET front_bearing = v_bearing
    WHERE id = p_campaign_building_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public."sync_campaign_members_from_campaign"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    IF NEW.owner_id IS NOT NULL
       AND EXISTS (
           SELECT 1
           FROM auth.users au
           WHERE au.id = NEW.owner_id
       ) THEN
        INSERT INTO public.campaign_members (campaign_id, user_id, role)
        VALUES (NEW.id, NEW.owner_id, 'owner')
        ON CONFLICT (campaign_id, user_id) DO UPDATE
        SET role = 'owner';
    END IF;

    IF NEW.workspace_id IS NOT NULL THEN
        INSERT INTO public.campaign_members (campaign_id, user_id, role)
        SELECT
            NEW.id,
            wm.user_id,
            CASE
                WHEN wm.role = 'owner' THEN 'owner'
                WHEN wm.role = 'admin' THEN 'admin'
                ELSE 'member'
            END
        FROM public.workspace_members wm
        JOIN auth.users au
            ON au.id = wm.user_id
        WHERE wm.workspace_id = NEW.workspace_id
        ON CONFLICT (campaign_id, user_id) DO UPDATE
        SET role = CASE
            WHEN public.campaign_members.role = 'owner' THEN public.campaign_members.role
            ELSE EXCLUDED.role
        END;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."sync_campaign_members_from_workspace_member"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    IF EXISTS (
        SELECT 1
        FROM auth.users au
        WHERE au.id = NEW.user_id
    ) THEN
        INSERT INTO public.campaign_members (campaign_id, user_id, role)
        SELECT
            c.id,
            NEW.user_id,
            CASE
                WHEN NEW.role = 'owner' THEN 'owner'
                WHEN NEW.role = 'admin' THEN 'admin'
                ELSE 'member'
            END
        FROM public.campaigns c
        WHERE c.workspace_id = NEW.workspace_id
        ON CONFLICT (campaign_id, user_id) DO UPDATE
        SET role = CASE
            WHEN public.campaign_members.role = 'owner' THEN public.campaign_members.role
            ELSE EXCLUDED.role
        END;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."sync_challenge_progress"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  v_uid UUID := auth.uid();
  v_challenge public.challenges%ROWTYPE;
  v_normalized_progress INTEGER := GREATEST(COALESCE(p_progress_count, 0), 0);
  v_next_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT *
  INTO v_challenge
  FROM public.challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Challenge not found.';
  END IF;

  IF v_challenge.title = '30 Day Challenge' AND v_challenge.goal_count = 30 THEN
    IF v_normalized_progress >= v_challenge.goal_count THEN
      v_next_status := 'completed';
    ELSIF v_challenge.expires_at IS NOT NULL AND v_challenge.expires_at < now() THEN
      v_next_status := 'failed';
    ELSE
      v_next_status := 'active';
    END IF;

    UPDATE public.challenges c
    SET progress_count = v_normalized_progress,
        status = v_next_status,
        completed_at = CASE
          WHEN v_next_status = 'completed' THEN COALESCE(c.completed_at, now())
          WHEN v_next_status = 'active' THEN NULL
          ELSE c.completed_at
        END
    WHERE c.id = p_challenge_id
    RETURNING * INTO v_challenge;

    RETURN v_challenge;
  END IF;

  UPDATE public.challenge_participants cp
  SET progress_count = v_normalized_progress,
      last_sync_at = now(),
      completed_at = CASE
        WHEN v_normalized_progress >= v_challenge.goal_count THEN COALESCE(cp.completed_at, now())
        ELSE NULL
      END
  WHERE cp.challenge_id = p_challenge_id
    AND cp.user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You have not joined this challenge.';
  END IF;

  RETURN public.refresh_challenge_participant_snapshot(p_challenge_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public."sync_workspace_scoped_record_from_campaign"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

DECLARE
    v_campaign_workspace_id uuid;
BEGIN
    IF NEW.campaign_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT c.workspace_id
    INTO v_campaign_workspace_id
    FROM public.campaigns c
    WHERE c.id = NEW.campaign_id;

    NEW.workspace_id := v_campaign_workspace_id;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."touch_campaign_polished_building_features_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."unassign_address_from_building_manual"()
RETURNS jsonb
LANGUAGE plpgsql
AS $function$

DECLARE
  v_address_source TEXT;
  v_linked_address_ids UUID[] := ARRAY[]::UUID[];
  v_unit_count INTEGER := 1;
BEGIN
  SELECT source
  INTO v_address_source
  FROM public.campaign_addresses
  WHERE campaign_id = p_campaign_id
    AND id = p_address_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Address % not found in campaign %', p_address_id, p_campaign_id;
  END IF;

  DELETE FROM public.building_address_links
  WHERE campaign_id = p_campaign_id
    AND address_id = p_address_id
    AND building_id = p_building_row_id;

  IF p_delete_manual_address THEN
    IF COALESCE(v_address_source, '') <> 'manual' THEN
      RAISE EXCEPTION 'Only manual addresses can be deleted as units';
    END IF;

    DELETE FROM public.campaign_addresses
    WHERE campaign_id = p_campaign_id
      AND id = p_address_id
      AND source = 'manual';
  ELSE
    UPDATE public.campaign_addresses
    SET building_id = NULL,
        building_gers_id = NULL,
        match_source = NULL,
        confidence = NULL
    WHERE campaign_id = p_campaign_id
      AND id = p_address_id;

    IF to_regclass('public.address_orphans') IS NOT NULL THEN
      UPDATE public.address_orphans
      SET status = 'pending_review',
          assigned_building_id = NULL,
          assigned_by = NULL,
          assigned_at = NULL
      WHERE campaign_id = p_campaign_id
        AND address_id = p_address_id;
    END IF;
  END IF;

  WITH linked AS (
    SELECT address_id
    FROM public.building_address_links
    WHERE campaign_id = p_campaign_id
      AND building_id = p_building_row_id
  ),
  counts AS (
    SELECT GREATEST(COUNT(*), 1)::INTEGER AS unit_count FROM linked
  )
  UPDATE public.building_address_links bal
  SET is_multi_unit = counts.unit_count > 1,
      unit_count = counts.unit_count,
      unit_arrangement = CASE WHEN counts.unit_count > 1 THEN 'horizontal' ELSE 'single' END
  FROM counts
  WHERE bal.campaign_id = p_campaign_id
    AND bal.building_id = p_building_row_id;

  SELECT COALESCE(array_agg(address_id ORDER BY address_id), ARRAY[]::UUID[])
  INTO v_linked_address_ids
  FROM public.building_address_links
  WHERE campaign_id = p_campaign_id
    AND building_id = p_building_row_id;

  v_unit_count := GREATEST(array_length(v_linked_address_ids, 1), 1);

  RETURN jsonb_build_object(
    'linked_address_ids', COALESCE(to_jsonb(v_linked_address_ids), '[]'::jsonb),
    'unit_count', v_unit_count,
    'deleted_address_id', CASE WHEN p_delete_manual_address THEN p_address_id::TEXT ELSE NULL::TEXT END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_address_statuses_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_building_latest_status"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  -- Update the latest_status in the buildings table with the most recent interaction status
  UPDATE public.buildings
  SET latest_status = NEW.status,
      updated_at = now()
  WHERE id = NEW.building_id;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_building_stats_on_scan"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    -- Update building_stats when a QR code scan is recorded
    -- Find the building via building_address_links and update its stats
    INSERT INTO public.building_stats (building_id, campaign_id, gers_id, status, scans_total, scans_today, last_scan_at)
    SELECT 
        b.id, 
        NEW.campaign_id, 
        b.gers_id,
        'visited',
        1,
        1,
        NEW.scanned_at
    FROM public.buildings b
    JOIN public.building_address_links l ON b.id = l.building_id
    WHERE l.address_id = NEW.address_id
        AND l.campaign_id = NEW.campaign_id
        AND l.is_primary = true
    ON CONFLICT (building_id) DO UPDATE SET
        scans_total = public.building_stats.scans_total + 1,
        scans_today = CASE 
            WHEN DATE(public.building_stats.last_scan_at) = CURRENT_DATE 
            THEN public.building_stats.scans_today + 1 
            ELSE 1 
        END,
        last_scan_at = NEW.scanned_at,
        status = 'visited',
        updated_at = NOW();
    
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_building_stats_on_touch"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    -- Update building_stats when a building touch/visit is logged
    INSERT INTO public.building_stats (building_id, campaign_id, gers_id, status, scans_total, scans_today, last_scan_at)
    SELECT 
        NEW.building_id,
        NEW.campaign_id,
        b.gers_id,
        'visited',
        0,
        0,
        NULL
    FROM public.buildings b
    WHERE b.id = NEW.building_id
    ON CONFLICT (building_id) DO UPDATE SET
        status = CASE 
            WHEN public.building_stats.status = 'not_visited' THEN 'visited'
            ELSE public.building_stats.status
        END,
        updated_at = NOW();
    
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_campaign_bbox"()
RETURNS ARRAY
LANGUAGE plpgsql
AS $function$

DECLARE
  v_bbox float8[];
BEGIN
  SELECT ARRAY[
    ST_XMin(extent), ST_YMin(extent), ST_XMax(extent), ST_YMax(extent)
  ] INTO v_bbox
  FROM (
    SELECT ST_Extent(geom::geometry) as extent
    FROM public.campaign_addresses
    WHERE campaign_id = p_campaign_id
  ) sub;

  UPDATE public.campaigns SET bbox = v_bbox WHERE id = p_campaign_id;
  RETURN v_bbox;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_campaign_boundary"()
RETURNS record
LANGUAGE plpgsql
AS $function$

DECLARE
  v_boundary_geom geometry(Polygon, 4326);
  v_territory_boundary geometry;
  v_raw jsonb;
  v_snapped jsonb;
  v_is_snapped boolean;
BEGIN
  v_boundary_geom := ST_GeomFromGeoJSON(p_boundary_geojson::text)::geometry(Polygon, 4326);

  UPDATE public.campaigns AS c
  SET
    territory_boundary = v_boundary_geom,
    campaign_polygon_raw = p_raw_geojson,
    campaign_polygon_snapped = CASE WHEN p_is_snapped THEN p_boundary_geojson ELSE c.campaign_polygon_snapped END,
    is_snapped = p_is_snapped
  WHERE c.id = p_campaign_id
  RETURNING 
    c.territory_boundary,
    c.campaign_polygon_raw,
    c.campaign_polygon_snapped,
    c.is_snapped
  INTO 
    v_territory_boundary,
    v_raw,
    v_snapped,
    v_is_snapped;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  territory_boundary_geojson := ST_AsGeoJSON(v_territory_boundary)::jsonb;
  campaign_polygon_raw := v_raw;
  campaign_polygon_snapped := v_snapped;
  is_snapped := v_is_snapped;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_campaign_roads_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_campaign_routes_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_contacts_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public."update_farm_polygon"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
    UPDATE public.farms
    SET polygon = ST_SetSRID(ST_GeomFromGeoJSON(p_polygon_geojson), 4326)::geometry(Polygon, 4326)
    WHERE id = p_farm_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_field_leads_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_flyers_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public."update_landing_page_templates_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_landing_pages_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_link_modified_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  NEW.modified_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_sessions_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_updated_at_column"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."update_user_stats_from_session"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
    IF NEW.end_time IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM public.refresh_user_stats_from_sessions(NEW.user_id);
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."upsert_address_building"()
RETURNS void
LANGUAGE plpgsql
AS $function$

begin
  insert into public.address_buildings(address_id, building_id, building_source, building_geom)
  values (
    p_address_id,
    p_building_id,
    coalesce(p_building_source, 'mapbox.buildings'),
    ST_SetSRID(ST_GeomFromGeoJSON(p_geojson->>'geometry'), 4326)
  )
  on conflict (address_id) do update
    set building_id     = excluded.building_id,
        building_source = excluded.building_source,
        building_geom   = excluded.building_geom,
        updated_at      = now();
end
$function$;

CREATE OR REPLACE FUNCTION public."upsert_address_building_by_formatted"()
RETURNS void
LANGUAGE plpgsql
AS $function$

DECLARE
  k TEXT := public.addr_key(p_formatted, p_postal);
BEGIN
  INSERT INTO public.address_buildings(address_key, building_id, building_source, building_geom)
  VALUES (
    k, 
    p_building_id, 
    COALESCE(p_building_source, 'mapbox.buildings'),
    ST_SetSRID(ST_GeomFromGeoJSON(p_geojson->>'geometry'), 4326)
  )
  ON CONFLICT(address_key) DO UPDATE
    SET building_id = EXCLUDED.building_id,
        building_source = EXCLUDED.building_source,
        building_geom = EXCLUDED.building_geom,
        updated_at = now();
END
$function$;

CREATE OR REPLACE FUNCTION public."upsert_address_status"()
RETURNS void
LANGUAGE plpgsql
AS $function$

BEGIN
  INSERT INTO address_statuses (
    address_id,
    campaign_id,
    status,
    notes,
    last_visited_at,
    visit_count
  ) VALUES (
    p_address_id,
    p_campaign_id,
    p_status,
    p_notes,
    p_last_visited_at,
    1
  )
  ON CONFLICT (address_id, campaign_id)
  DO UPDATE SET
    status = EXCLUDED.status,
    notes = EXCLUDED.notes,
    last_visited_at = EXCLUDED.last_visited_at,
    visit_count = address_statuses.visit_count + 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public."upsert_leaderboard_rollup_rows"()
RETURNS void
LANGUAGE sql
AS $function$

    INSERT INTO public.leaderboard_rollups (
        scope_key,
        workspace_id,
        user_id,
        timeframe,
        period_start,
        doorknocks,
        conversations,
        leads,
        distance_km
    )
    SELECT
        p_scope_key,
        p_workspace_id,
        p_user_id,
        tf.timeframe,
        public.leaderboard_period_start(tf.timeframe, p_reference),
        GREATEST(COALESCE(p_doorknocks, 0), 0),
        GREATEST(COALESCE(p_conversations, 0), 0),
        GREATEST(COALESCE(p_leads, 0), 0),
        GREATEST(COALESCE(p_distance_km, 0.0), 0.0)
    FROM (
        VALUES ('daily'), ('weekly'), ('monthly'), ('all_time')
    ) AS tf(timeframe)
    ON CONFLICT (scope_key, user_id, timeframe, period_start)
    DO UPDATE SET
        doorknocks = public.leaderboard_rollups.doorknocks + EXCLUDED.doorknocks,
        conversations = public.leaderboard_rollups.conversations + EXCLUDED.conversations,
        leads = public.leaderboard_rollups.leads + EXCLUDED.leads,
        distance_km = public.leaderboard_rollups.distance_km + EXCLUDED.distance_km,
        updated_at = NOW();
$function$;

CREATE OR REPLACE FUNCTION public."uuid_lower"()
RETURNS uuid
LANGUAGE sql
AS $function$

    SELECT LOWER(input_uuid::text)::uuid;
$function$;

CREATE OR REPLACE FUNCTION public."v_gold_coverage_stats"()
RETURNS record
LANGUAGE plpgsql
AS $function$

BEGIN
    RETURN QUERY
    SELECT 
        a.source_id,
        COUNT(DISTINCT a.id) AS address_count,
        (SELECT COUNT(*) FROM ref_buildings_gold b WHERE b.source_id = a.source_id) AS building_count,
        ST_Extent(a.geom)::GEOMETRY AS bbox
    FROM ref_addresses_gold a
    GROUP BY a.source_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public."validate_challenge_invite"()
RETURNS record
LANGUAGE plpgsql
AS $function$

BEGIN
  RETURN QUERY
  SELECT
    TRUE AS valid,
    c.id,
    c.title,
    c.description,
    c.creator_name,
    c.invited_email,
    c.invited_phone,
    c.visibility,
    c.type,
    c.goal_count,
    c.time_limit_hours,
    c.scoring_mode,
    c.cover_image_path,
    c.expires_at,
    COALESCE(c.participant_count, 0) AS participant_count,
    EXISTS (
      SELECT 1
      FROM public.challenge_participants cp
      WHERE cp.challenge_id = c.id
        AND cp.user_id = auth.uid()
    ) AS already_joined
  FROM public.challenges c
  WHERE c.invite_token = NULLIF(trim(p_token), '')
    AND c.status = 'active'
    AND (
      c.expires_at IS NULL
      OR c.expires_at > now()
      OR c.accepted_at IS NULL
    )
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public."workspace_has_dashboard_access"()
RETURNS boolean
LANGUAGE sql
AS $function$

  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = ws_id
      AND (
        w.subscription_status = 'active'
        OR (w.subscription_status = 'trialing' AND (w.trial_ends_at IS NULL OR w.trial_ends_at > now()))
      )
  )
$function$;

CREATE OR REPLACE FUNCTION public."workspace_invites_on_accept"()
RETURNS trigger
LANGUAGE plpgsql
AS $function$

BEGIN
  IF NEW.status = 'accepted' AND (OLD.status IS NULL OR OLD.status <> 'accepted') THEN
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (NEW.workspace_id, auth.uid(), NEW.role)
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = NEW.role, updated_at = now();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public."workspace_subscription_active"()
RETURNS boolean
LANGUAGE sql
AS $function$

  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    WHERE w.id = ws_id
      AND w.subscription_status IN ('active', 'trialing')
      AND (w.trial_ends_at IS NULL OR w.trial_ends_at > now())
  )
$function$;
