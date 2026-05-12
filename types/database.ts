// Core Database Types - Matching iOS Supabase Schema

export interface Campaign {
  id: string;
  user_id: string;
  name: string;
  type: 'letters' | 'flyers';
  destination_url: string;
  video_url?: string; // Optional video URL to redirect to when QR code is scanned
  created_at: string;
}

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  address_line: string;
  city: string;
  region: string;
  postal_code: string;
  status: 'pending' | 'sent' | 'scanned';
  sent_at: string | null;
  scanned_at: string | null;
  qr_png_url: string | null;
}

export interface UserProfile {
  user_id: string;
  pro_active: boolean;
  stripe_customer_id: string | null;
  created_at: string;
  /** Weekly doors goal for Home dashboard */
  weekly_door_goal?: number | null;
  /** Optional weekly sessions goal */
  weekly_sessions_goal?: number | null;
  /** Optional weekly minutes doorknocking goal */
  weekly_minutes_goal?: number | null;
}

/** Entitlements: source of truth for plan/status (web + iOS). */
export type EntitlementPlan = 'free' | 'pro' | 'team';
export type EntitlementSource = 'none' | 'stripe' | 'apple';
export type WorkspaceBillingAddonStatus = 'inactive' | 'active' | 'past_due' | 'canceled';
export type WorkspaceDialerNumberStatus = 'unassigned' | 'active' | 'released';

export interface Entitlement {
  user_id: string;
  plan: EntitlementPlan;
  is_active: boolean;
  source: EntitlementSource;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  updated_at: string;
}

/** Public snapshot returned by GET /api/billing/entitlement (no internal IDs). */
export interface EntitlementSnapshot {
  plan: EntitlementPlan;
  is_active: boolean;
  source: EntitlementSource;
  current_period_end: string | null;
  dialer_offer?: {
    price_id?: string | null;
    amount: string;
    currency: 'USD' | 'CAD';
    period: string;
  };
  dialer_addon?: {
    status: WorkspaceBillingAddonStatus;
    is_active: boolean;
    price_id?: string | null;
    amount_cents?: number | null;
    currency?: string | null;
  };
  dialer_number?: string | null;
  dialer_number_status?: WorkspaceDialerNumberStatus | null;
  dialer_uses_shared_default?: boolean;
}

export type AmbassadorApplicationStatus = 'applied' | 'approved' | 'rejected' | 'paused';
export type AmbassadorReferralStatus = 'attributed' | 'active' | 'expired' | 'canceled';
export type AmbassadorCommissionStatus = 'pending' | 'paid' | 'voided';
export type AmbassadorPayoutBatchStatus = 'draft' | 'processing' | 'paid' | 'failed';

export interface AmbassadorApplication {
  id: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  email: string;
  phone: string | null;
  city: string | null;
  primary_niche: string;
  primary_platform: string;
  audience_size: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  youtube_handle: string | null;
  website_url: string | null;
  audience_summary: string | null;
  why_flyr: string;
  promotion_plan: string | null;
  status: AmbassadorApplicationStatus;
  review_notes: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  stripe_connect_account_id: string | null;
  stripe_onboarding_completed: boolean;
  stripe_details_submitted: boolean;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  referral_code: string | null;
  referral_code_max_uses: number | null;
  stripe_promotion_code_id: string | null;
  commission_rate_bps: number;
  commission_duration_months: number;
}

export interface AmbassadorReferral {
  id: string;
  created_at: string;
  updated_at: string;
  ambassador_application_id: string;
  referred_user_id: string;
  referred_workspace_id: string;
  referral_code: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  commission_rate_bps: number;
  commission_duration_months: number;
  first_paid_at: string | null;
  eligible_until: string | null;
  last_paid_at: string | null;
  status: AmbassadorReferralStatus;
}

export interface AmbassadorCommission {
  id: string;
  created_at: string;
  updated_at: string;
  ambassador_referral_id: string;
  ambassador_application_id: string;
  referred_user_id: string;
  referred_workspace_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string;
  stripe_invoice_id: string;
  revenue_amount_cents: number;
  commission_rate_bps: number;
  commission_amount_cents: number;
  currency: string;
  earned_at: string;
  status: AmbassadorCommissionStatus;
  paid_out_at?: string | null;
  payout_batch_id?: string | null;
  stripe_transfer_id?: string | null;
}

export interface AmbassadorPayoutBatch {
  id: string;
  created_at: string;
  updated_at: string;
  ambassador_application_id?: string | null;
  created_by_user_id: string | null;
  status: AmbassadorPayoutBatchStatus;
  currency: string;
  total_commission_cents: number;
  note: string | null;
  stripe_connect_account_id?: string | null;
  stripe_transfer_id?: string | null;
  transfer_group?: string | null;
  commission_snapshot_hash?: string | null;
  failure_reason?: string | null;
  processed_at?: string | null;
  paid_at: string | null;
}

// Enhanced Campaign Types (iOS Schema)
export type CampaignType = 'flyer' | 'door_knock' | 'event' | 'survey' | 'gift' | 'pop_by' | 'open_house';
export type AddressSource = 'closest_home' | 'import_list' | 'map' | 'same_street';
export type CampaignStatus = 'draft' | 'active' | 'completed' | 'paused';
export type CampaignProvisionStatus = 'pending' | 'ready' | 'failed';
export type CampaignProvisionSource = 'diamond' | 'bedrock_ca' | 'bedrock_us' | 'bedrock_au' | 'bedrock_nz';
export type CampaignProvisionPhase =
  | 'created'
  | 'source_probed'
  | 'addresses_loading'
  | 'addresses_ready'
  | 'map_ready'
  | 'optimizing'
  | 'optimized'
  | 'failed';
export type ParcelEnrichmentStatus = 'not_started' | 'queued' | 'processing' | 'ready' | 'failed' | 'skipped';
export type LinkQualityStatus = 'unknown' | 'healthy' | 'degraded' | 'repairing' | 'failed';

export interface CampaignV2 {
  id: string;
  owner_id: string;
  workspace_id?: string | null;
  name: string;
  type: CampaignType;
  address_source: AddressSource;
  total_flyers: number;
  scans: number;
  conversions: number;
  created_at: string;
  status: CampaignStatus;
  provision_status?: CampaignProvisionStatus | null;
  provision_source?: CampaignProvisionSource | null;
  provision_phase?: CampaignProvisionPhase | null;
  addresses_ready_at?: string | null;
  map_ready_at?: string | null;
  optimized_at?: string | null;
  has_parcels?: boolean | null;
  building_link_confidence?: number | null;
  map_mode?: 'smart_buildings' | 'hybrid' | 'standard_pins' | null;
  parcel_enrichment_status?: ParcelEnrichmentStatus | null;
  parcel_source_id?: string | null;
  parcel_count?: number | null;
  parcel_enriched_at?: string | null;
  parcel_enrichment_error?: string | null;
  parcel_enrichment_debug?: Record<string, unknown> | null;
  link_quality_status?: LinkQualityStatus | null;
  link_quality_score?: number | null;
  link_quality_reason?: string | null;
  link_quality_checked_at?: string | null;
  link_quality_metrics?: Record<string, unknown> | null;
  seed_query?: string;
  description?: string;
  video_url?: string; // Optional video URL to redirect to when QR code is scanned
  notes?: string;
  scripts?: string;
  flyer_url?: string; // URL of uploaded flyer image/PDF
  territory_boundary?: {
    type: 'Polygon';
    coordinates: number[][][];
  };
  campaign_polygon_raw?: { type: 'Polygon'; coordinates: number[][][] };
  campaign_polygon_snapped?: { type: 'Polygon'; coordinates: number[][][] };
  is_snapped?: boolean;
  bbox?: number[]; // Bounding box: [min_lon, min_lat, max_lon, max_lat]
  // Computed
  progress?: number;
  progress_pct?: number;
}

export interface CampaignAddress {
  id: string;
  campaign_id: string;
  address: string;
  formatted?: string;
  postal_code?: string;
  source: AddressSource;
  gers_id?: string; // Overture GERS ID or other source identifier - UUID v4 format (128-bit)
  seq?: number; // Sequence number for ordering
  visited?: boolean;
  coordinate?: {
    lat: number;
    lon: number;
  };
  geometry?: unknown;
  geom_json?: unknown;
  geom?: string; // PostGIS geometry
  created_at: string;
  building_outline?: Coordinate[][];
  // Street orientation fields
  road_bearing?: number; // 0-360 degree angle of the road
  house_bearing?: number; // Final calculated bearing for house model (road_bearing ± 90)
  street_name?: string; // Street name from Overture address data (also used for block grouping)
  is_oriented?: boolean; // Whether orientation has been computed
  orientation_locked?: boolean; // Prevents automatic recalculation if manually set
  // Structured address components from Overture
  house_number?: string; // House/unit number from Overture address data
  locality?: string; // Town/City from Overture address data
  region?: string; // Province/State from Overture address data
  building_id?: string | null; // Linked building UUID
  building_gers_id?: string; // Parent building GERS ID from Overture (parent_id) for handshake optimization
  // Scan tracking fields
  scans?: number; // Total number of times this address QR code has been scanned
  last_scanned_at?: string | null; // Timestamp of the most recent QR code scan
  // QR code fields
  qr_code_base64?: string; // Base64-encoded QR code image (data URL format)
  purl?: string; // Tracking URL for QR code scans (e.g., /api/scan?id={address_id})
  // Route optimization fields (CVRP)
  cluster_id?: number | null; // CVRP cluster assignment (agent_id)
  sequence?: number | null; // Stop sequence within cluster route
  walk_time_sec?: number | null; // Walking time from depot to this stop
  distance_m?: number | null; // Walking distance from depot to this stop
  // Address map status (from address_statuses): none | no_answer | delivered | talked | appointment | do_not_knock | future_seller | hot_lead
  address_status?: string;
}

export interface CampaignContact {
  id: string;
  campaign_id: string;
  address_id?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  last_contacted_at?: string | null;
  interest_level?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Coordinate {
  lat: number;
  lon: number;
}

export interface BuildingPolygon {
  id: string;
  address_id: string;
  source: string;
  geom: string; // PostGIS geometry
  area_m2?: number;
  created_at: string;
}

/** 
 * Campaign Parcel - Land parcel boundaries for Golden Key linking.
 * Acts as a "hard container" to link addresses to buildings regardless of distance.
 * Essential for suburban areas and townhomes.
 */
export interface CampaignParcel {
  id: string;
  campaign_id: string;
  external_id?: string; // "PARCELID" from source data (e.g., PCL030544)
  geom: string; // PostGIS MultiPolygon geometry
  properties?: Record<string, unknown>; // OBJECTID, SHAPE_Area, etc.
  created_at: string;
}

// QR Code Types
export interface QRCode {
  id: string;
  address_id?: string;
  campaign_id?: string;
  farm_id?: string;
  batch_id?: string;
  landing_page_id?: string;
  qr_variant?: 'A' | 'B';
  slug?: string;
  qr_url: string;
  qr_image?: string;
  created_at: string;
  updated_at: string;
  metadata?: QRCodeMetadata;
  destination_type?: 'landingPage' | 'directLink' | null;
  direct_url?: string | null;
}

export interface QRCodeScan {
  id: string;
  qr_code_id: string | null;
  address_id: string | null;
  scanned_at: string; // ISO timestamp
  device_info?: string | null;
  user_agent?: string | null;
  ip_address?: string | null;
  referrer?: string | null;
}

export interface QRCodeMetadata {
  address_count?: number;
  entity_name?: string;
  device_info?: string;
  name?: string;
  is_printed?: boolean;
  batch_name?: string;
}

export interface QRSet {
  id: string;
  name: string;
  total_addresses: number;
  variant_count: number;
  qr_code_ids: string[];
  campaign_id?: string;
  user_id: string;
}

export interface Batch {
  id: string;
  name: string;
  campaign_id?: string;
  user_id: string;
  created_at: string;
}

// Landing Page Types
export type LandingPageTemplateVariant = 'minimal_black' | 'luxe_card' | 'spotlight';

// Legacy landing_pages table (for backward compatibility)
export interface LandingPageData {
  id: string;
  user_id: string;
  campaign_id?: string;
  address_id?: string;
  template_id?: string;
  title: string;
  subtitle: string;
  description?: string;
  cta_text: string;
  cta_url: string;
  image_url?: string;
  video_url?: string;
  dynamic_data?: Record<string, unknown>;
  slug?: string;
  created_at: string;
  updated_at: string;
}

// Campaign Landing Pages (documented schema - campaign_landing_pages table)
export interface CampaignLandingPage {
  id: string;
  campaign_id: string;
  slug: string;
  headline?: string;
  subheadline?: string;
  hero_url?: string;
  cta_type?: string; // "book", "home_value", "contact", "custom", etc.
  cta_url?: string;
  created_at: string;
  updated_at: string;
}

// Campaign Landing Page Analytics
export interface CampaignLandingPageAnalytics {
  id: string;
  landing_page_id: string;
  views: number;
  unique_views: number;
  cta_clicks: number;
  timestamp_bucket: string; // DATE
}

export interface LandingPageTemplate {
  id: string;
  name: string;
  description?: string;
  components: Record<string, unknown>;
}

// Farm Types
export interface Farm {
  id: string;
  owner_id: string;
  workspace_id?: string | null;
  linked_campaign_id?: string | null;
  name: string;
  description?: string | null;
  polygon?: string; // GeoJSON string
  start_date: string;
  end_date: string;
  frequency: number; // Legacy cadence field retained for compatibility
  created_at: string;
  updated_at?: string;
  area_label?: string;
  polygon_coordinates?: Coordinate[];
  is_active: boolean;
  touches_per_interval?: number | null;
  touches_interval?: FarmTouchInterval | null;
  goal_type?: FarmGoalType | null;
  goal_target?: number | null;
  cycle_completion_window_days?: number | null;
  touch_types?: FarmTouchType[] | null;
  annual_budget_cents?: number | null;
  progress?: number;
  home_limit?: number;
  address_count?: number;
  last_generated_at?: string | null;
}

export type FarmSessionMode = 'doorknock' | 'flyer' | 'canada_post' | 'pop_by' | 'letter';
export type FarmTouchInterval = 'month' | 'year';
export type FarmGoalType = 'touches_per_year' | 'touches_per_cycle' | 'homes_per_cycle';
export type FarmTouchType = 'doorknock' | 'flyer' | 'canada_post' | 'pop_by' | 'letter';
export type FarmLeadSource = 'qr_scan' | 'door_knock' | 'flyer' | 'event' | 'newsletter' | 'ad' | 'custom';
export type FarmAddressOutcomeStatus =
  | 'none'
  | 'no_answer'
  | 'delivered'
  | 'talked'
  | 'appointment'
  | 'do_not_knock'
  | 'future_seller'
  | 'hot_lead';

export interface FarmTouch {
  id: string;
  farm_id: string;
  workspace_id?: string | null;
  cycle_number?: number | null;
  mode?: FarmSessionMode;
  title?: string | null;
  scheduled_date: string;
  started_at?: string | null;
  completed_date?: string;
  last_completed_at?: string | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'skipped';
  notes?: string;
  homes_target?: number | null;
  homes_reached?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface FarmLead {
  id: string;
  farm_id: string;
  touch_id?: string;
  lead_source: FarmLeadSource;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  created_at: string;
}

export interface FarmAddress {
  id: string;
  farm_id: string;
  campaign_address_id?: string | null;
  formatted: string;
  postal_code?: string | null;
  source: string;
  gers_id?: string | null;
  house_number?: string | null;
  street_name?: string | null;
  locality?: string | null;
  region?: string | null;
  coordinate?: {
    lat: number;
    lon: number;
  } | null;
  geom?: string | null;
  visited_count?: number;
  last_visited_at?: string | null;
  last_touch_id?: string | null;
  last_outcome_status?: FarmAddressOutcomeStatus | null;
  created_at: string;
}

export interface FarmTouchAddress {
  id: string;
  farm_id: string;
  farm_touch_id: string;
  farm_address_id: string;
  campaign_address_id?: string | null;
  status: FarmAddressOutcomeStatus;
  notes?: string | null;
  occurred_at: string;
  created_by?: string | null;
  created_at: string;
  updated_at?: string | null;
}

export type FinanceEntryCategory =
  | 'postal_drop'
  | 'printing'
  | 'delivery'
  | 'materials'
  | 'fuel'
  | 'meals'
  | 'software'
  | 'ads'
  | 'other';

export interface FinanceEntry {
  id: string;
  workspace_id?: string | null;
  created_by: string;
  campaign_id?: string | null;
  farm_id?: string | null;
  agent_user_id?: string | null;
  category: FinanceEntryCategory;
  description: string;
  vendor?: string | null;
  postal_code?: string | null;
  quantity: number;
  unit_label: string;
  unit_cost_cents: number;
  total_cost_cents: number;
  currency: 'CAD';
  incurred_on: string;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
}

// Contact Types
export type ContactStatus = 'hot' | 'warm' | 'cold' | 'new';
export type ActivityType = 'knock' | 'call' | 'flyer' | 'note' | 'text' | 'email' | 'meeting';
export type DialerSessionStatus = 'draft' | 'active' | 'paused' | 'completed';
export type DialerSessionLeadStatus = 'pending' | 'claimed' | 'calling' | 'completed' | 'skipped' | 'invalid';
export type DialerCallStatus =
  | 'pending'
  | 'initiated'
  | 'ringing'
  | 'in-progress'
  | 'answered'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled';
export type DialerCallDisposition =
  | 'connected'
  | 'no_answer'
  | 'left_voicemail'
  | 'callback_requested'
  | 'follow_up'
  | 'appointment_set'
  | 'do_not_call'
  | 'bad_number'
  | 'not_interested';

export interface Contact {
  id: string;
  user_id: string;
  full_name: string;
  phone?: string;
  phone_e164?: string;
  phone_last_validated_at?: string;
  phone_validation_error?: string;
  email?: string;
  address: string;
  workspace_id?: string | null;
  campaign_id?: string;
  farm_id?: string;
  status: ContactStatus;
  source?: string;
  last_contacted?: string;
  notes?: string;
  reminder_date?: string;
  follow_up_at?: string;
  appointment_at?: string;
  gers_id?: string; // Overture GERS ID linking to map_buildings.gers_id
  address_id?: string; // FK to campaign_addresses.id
  tags?: string; // Comma-separated or single tag
  created_at: string;
  updated_at: string;
}

export interface ContactActivity {
  id: string;
  contact_id: string;
  type: ActivityType;
  note?: string;
  timestamp: string;
  created_at: string;
}

export interface WorkspaceDialerSettings {
  id: string;
  workspace_id: string;
  enabled: boolean;
  default_from_number?: string | null;
  default_sms_from_number?: string | null;
  inbound_forward_to?: string | null;
  allow_sms_followup: boolean;
  twilio_incoming_phone_number_sid?: string | null;
  number_status: WorkspaceDialerNumberStatus;
  number_assigned_at?: string | null;
  provisioning_metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceBillingAddon {
  id: string;
  workspace_id: string;
  addon_key: 'power_dialer';
  status: WorkspaceBillingAddonStatus;
  stripe_subscription_id?: string | null;
  stripe_subscription_item_id?: string | null;
  stripe_price_id?: string | null;
  quantity: number;
  amount_cents?: number | null;
  currency?: string | null;
  activated_at?: string | null;
  canceled_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface DialerSession {
  id: string;
  workspace_id: string;
  user_id: string;
  name?: string | null;
  status: DialerSessionStatus;
  source_filter?: Record<string, unknown> | null;
  started_at?: string | null;
  ended_at?: string | null;
  tab_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DialerSessionLead {
  id: string;
  session_id: string;
  workspace_id: string;
  contact_id: string;
  position: number;
  status: DialerSessionLeadStatus;
  attempt_count: number;
  last_call_id?: string | null;
  claimed_by_user_id?: string | null;
  claimed_at?: string | null;
  completed_at?: string | null;
  skip_reason?: string | null;
  created_at: string;
  updated_at: string;
  contact?: Contact;
}

export interface DialerCall {
  id: string;
  workspace_id: string;
  session_id: string;
  session_lead_id: string;
  contact_id: string;
  user_id: string;
  call_request_id: string;
  twilio_call_sid?: string | null;
  twilio_parent_call_sid?: string | null;
  to_number_raw?: string | null;
  to_number_e164?: string | null;
  from_number_e164?: string | null;
  status: DialerCallStatus;
  direction: 'outbound';
  answered_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  disposition?: DialerCallDisposition | null;
  disposition_note?: string | null;
  follow_up_at?: string | null;
  appointment_at?: string | null;
  status_payload?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface DialerSmsFollowup {
  id: string;
  workspace_id: string;
  call_id: string;
  contact_id: string;
  user_id: string;
  twilio_message_sid?: string | null;
  from_number_e164?: string | null;
  to_number_e164?: string | null;
  body: string;
  status: string;
  error_code?: string | null;
  error_message?: string | null;
  sent_at?: string | null;
  delivered_at?: string | null;
  status_payload?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// Stats Types (public.user_stats)
export interface UserStats {
  id: string;
  user_id: string;
  day_streak: number;
  best_streak: number;
  doors_knocked: number;
  flyers: number;
  conversations: number;
  leads_created: number;
  qr_codes_scanned: number;
  distance_walked: number; // km
  time_tracked: number; // minutes
  conversation_per_door: number;
  conversation_lead_rate: number;
  qr_code_scan_rate: number;
  qr_code_lead_rate: number;
  streak_days: string[] | null;
  xp: number;
  routes_walked?: number;
  updated_at: string;
  created_at: string | null;
}

export type LeaderboardSortBy = 'doorknocks' | 'conversations' | 'leads' | 'distance';
export type LeaderboardTimeframe = 'daily' | 'weekly' | 'monthly' | 'all_time';

export interface LeaderboardEntry {
  id: string;
  user_id: string;
  user_email: string;
  name: string;
  avatar_url: string | null;
  brokerage?: string | null;
  doorknocks: number;
  conversations: number;
  leads: number;
  distance: number;
  rank: number;
  updated_at?: string;
}

/** Brokerage leaderboard: only all_time and month MVs supported */
export type BrokerageLeaderboardTimeframe = 'all_time' | 'month';

export interface BrokerageLeaderboardEntry {
  brokerage_key: string;
  display_name: string;
  doorknocks: number;
  conversations: number;
  leads: number;
  distance: number;
  time_minutes: number;
  day_streak: number;
  best_streak: number;
  agent_count: number;
  rank: number;
  updated_at: string;
}

// A/B Testing Types
export interface Experiment {
  id: string;
  campaign_id?: string;
  landing_page_id?: string;
  name: string;
  status: 'active' | 'completed' | 'paused';
  created_at: string;
}

export interface ExperimentVariant {
  id: string;
  experiment_id: string;
  key: 'A' | 'B';
  url_slug: string;
}

export interface QRScanEvent {
  id: string;
  experiment_id?: string;
  variant_id?: string;
  campaign_id?: string;
  landing_page_id?: string;
  device_type?: string;
  city?: string;
  created_at: string;
}

// Gold Standard GERS Building Types
export type BuildingStatus = 'default' | 'not_home' | 'interested' | 'dnc' | 'available';

export interface Building {
  id: string; // UUID (surrogate key)
  gers_id: string; // Overture GERS ID (unique external anchor) - UUID v4 format (128-bit)
  campaign_id: string; // Campaign ID that owns this building
  geom: string; // PostGIS MultiPolygon geometry (GeoJSON string)
  centroid: string; // PostGIS Point geometry (GeoJSON string)
  latest_status: BuildingStatus; // Cached status from trigger
  is_hidden: boolean;
  // Overture metadata (optional, stored in JSONB or separate columns)
  height?: number; // Building height in meters
  house_name?: string; // Building name from Overture
  addr_housenumber?: string; // House number from Overture address
  addr_street?: string; // Street name from Overture address
  addr_unit?: string; // Unit number from Overture address
  source?: string;
  created_at: string;
  updated_at: string;
}

export interface BuildingInteraction {
  id: string;
  building_id: string;
  status: BuildingStatus;
  notes?: string;
  user_id?: string;
  created_at: string;
}
