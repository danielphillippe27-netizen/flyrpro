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
  source_id?: string; // Overture GERS ID or other source identifier
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
  street_name?: string; // Extracted street name for block grouping
  is_oriented?: boolean; // Whether orientation has been computed
  orientation_locked?: boolean; // Prevents automatic recalculation if manually set
  // Scan tracking fields
  scans?: number; // Total number of times this address QR code has been scanned
  last_scanned_at?: string; // Timestamp of the most recent QR code scan
  // QR code fields
  qr_code_base64?: string; // Base64-encoded QR code image (data URL format)
  purl?: string; // Tracking URL for QR code scans (e.g., /api/scan?id={address_id})
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

// Stats Types
export interface UserStats {
  id: string;
  user_id: string;
  flyers: number;
  conversations: number;
  leads_created: number;
  distance_walked: number; // km
  time_tracked: number; // minutes
  day_streak: number;
  best_streak: number;
  xp: number;
  updated_at: string;
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
export type BuildingStatus = 'default' | 'not_home' | 'interested' | 'dnc';

export interface Building {
  id: string; // UUID (surrogate key)
  gers_id: string; // Overture GERS ID (unique external anchor)
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
