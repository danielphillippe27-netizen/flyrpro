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
}

// Enhanced Campaign Types (iOS Schema)
export type CampaignType = 'flyer' | 'door_knock' | 'event' | 'survey' | 'gift' | 'pop_by' | 'open_house';
export type AddressSource = 'closest_home' | 'import_list' | 'map' | 'same_street';
export type CampaignStatus = 'draft' | 'active' | 'completed' | 'paused';

export interface CampaignV2 {
  id: string;
  owner_id: string;
  name: string;
  type: CampaignType;
  address_source: AddressSource;
  total_flyers: number;
  scans: number;
  conversions: number;
  created_at: string;
  status: CampaignStatus;
  seed_query?: string;
  video_url?: string; // Optional video URL to redirect to when QR code is scanned
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
  building_gers_id?: string; // Parent building GERS ID from Overture (parent_id) for handshake optimization
  // Scan tracking fields
  scans?: number; // Total number of times this address QR code has been scanned
  last_scanned_at?: string; // Timestamp of the most recent QR code scan
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
export type LandingPageTemplate = 'minimal_black' | 'luxe_card' | 'spotlight';

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
  dynamic_data?: Record<string, any>;
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
  components: Record<string, any>;
}

// Farm Types
export interface Farm {
  id: string;
  owner_id: string;
  name: string;
  polygon?: string; // GeoJSON string
  start_date: string;
  end_date: string;
  frequency: number; // Touches per month (1-4)
  created_at: string;
  area_label?: string;
  polygon_coordinates?: Coordinate[];
  is_active: boolean;
  progress?: number;
}

export type FarmLeadSource = 'qr_scan' | 'door_knock' | 'flyer' | 'event' | 'newsletter' | 'ad' | 'custom';

export interface FarmTouch {
  id: string;
  farm_id: string;
  scheduled_date: string;
  completed_date?: string;
  status: 'scheduled' | 'completed' | 'skipped';
  notes?: string;
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

// Contact Types
export type ContactStatus = 'hot' | 'warm' | 'cold' | 'new';
export type ActivityType = 'knock' | 'call' | 'flyer' | 'note' | 'text' | 'email' | 'meeting';

export interface Contact {
  id: string;
  user_id: string;
  full_name: string;
  phone?: string;
  email?: string;
  address: string;
  campaign_id?: string;
  farm_id?: string;
  status: ContactStatus;
  last_contacted?: string;
  notes?: string;
  reminder_date?: string;
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

export type LeaderboardSortBy = 'flyers' | 'conversations' | 'leads' | 'distance' | 'time';

export interface LeaderboardEntry {
  id: string;
  user_id: string;
  user_email: string;
  flyers: number;
  conversations: number;
  leads: number;
  distance: number;
  time_minutes: number;
  day_streak: number;
  best_streak: number;
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
