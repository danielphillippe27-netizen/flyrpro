# FLYR-PRO Technical Reference for iOS Development

> **Purpose**: This document captures the complete technical architecture, database schema, API endpoints, and business logic of the FLYR-PRO web application. Use this as context when building the iOS version.

---

## Table of Contents

1. [Tech Stack Overview](#1-tech-stack-overview)
2. [Authentication System](#2-authentication-system)
3. [Database Schema](#3-database-schema)
4. [Core Data Flows](#4-core-data-flows)
5. [API Endpoints Reference](#5-api-endpoints-reference)
6. [Supabase RPC Functions](#6-supabase-rpc-functions)
7. [Real-Time Subscriptions](#7-real-time-subscriptions)
8. [Map Visualization System](#8-map-visualization-system)
9. [QR Code System](#9-qr-code-system)
10. [Type Definitions (Swift Models)](#10-type-definitions-swift-models)
11. [Environment Variables](#11-environment-variables)
12. [iOS Implementation Notes](#12-ios-implementation-notes)

---

## 1. Tech Stack Overview

### Backend Services

| Service | Purpose | iOS SDK |
|---------|---------|---------|
| **Supabase** | PostgreSQL database, Auth, Storage, Realtime | `supabase-swift` |
| **Mapbox** | Map rendering, 3D buildings, geocoding | Mapbox Maps SDK for iOS |
| **Stripe** | Payment processing, subscriptions | `stripe-ios` |
| **Google Gemini** | AI flyer generation | Google AI SDK for Swift |
| **MotherDuck** | Overture geospatial data (DuckDB cloud) | HTTP API calls |

### Database Architecture

```
Primary Database: Supabase (PostgreSQL with PostGIS)
├── Campaigns & Addresses
├── QR Codes & Scans
├── Buildings & Map Data
├── Users & CRM
└── Real-time subscriptions enabled

Analytics Database: MotherDuck (DuckDB)
├── Overture Buildings (NA coverage)
├── Overture Addresses
└── Overture Roads/Transportation
```

### Key External APIs

- **Mapbox Geocoding**: Address autocomplete and reverse geocoding
- **Mapbox Directions**: Road geometry for house orientation
- **Overture Maps**: Building footprints and address data (via MotherDuck)
- **Stripe Checkout**: Subscription management
- **Google Gemini**: AI-powered flyer design generation

---

## 2. Authentication System

### Overview

FLYR-PRO uses Supabase Auth with two authentication methods:
1. **Magic Link** (Email OTP) - Primary method
2. **Apple OAuth** - Sign in with Apple

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION FLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User enters email on Login screen                          │
│                     │                                           │
│                     ▼                                           │
│  2. supabase.auth.signInWithOtp(email)                         │
│     - Sends magic link to email                                │
│     - redirectTo: /auth/callback?next=/home                    │
│                     │                                           │
│                     ▼                                           │
│  3. User clicks link in email                                  │
│     - Opens: /auth/callback?code=xxx                           │
│                     │                                           │
│                     ▼                                           │
│  4. exchangeCodeForSession(code)                               │
│     - Validates code                                           │
│     - Creates session                                          │
│     - Sets auth cookies                                        │
│                     │                                           │
│                     ▼                                           │
│  5. Redirect to /home (authenticated)                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Apple OAuth Flow

```swift
// iOS Implementation
let credentials = try await supabase.auth.signInWithApple()
// Session automatically managed by Supabase Swift SDK
```

### Session Management

- Sessions stored in secure cookies (web) / Keychain (iOS)
- Automatic refresh via Supabase SDK
- User ID (`user_id` / `owner_id`) used as foreign key across tables

### Row Level Security (RLS)

All tables use RLS policies:
- Users can only access their own data
- `owner_id` or `user_id` columns reference `auth.uid()`
- Admin operations use service role key (server-side only)

---

## 3. Database Schema

### 3.1 Campaigns System

#### `campaigns` Table

```sql
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('flyer', 'door_knock', 'event', 'survey', 'gift', 'pop_by', 'open_house', 'letters')),
  address_source TEXT CHECK (address_source IN ('closest_home', 'import_list', 'map', 'same_street')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'paused')),
  provision_status TEXT CHECK (provision_status IN ('pending', 'ready', 'failed')),
  
  -- Destination URLs
  destination_url TEXT,
  video_url TEXT,  -- Redirect URL for QR scans
  
  -- Location Data
  seed_query TEXT,  -- Starting address for closest_home
  bbox DOUBLE PRECISION[],  -- [min_lon, min_lat, max_lon, max_lat]
  territory_boundary GEOMETRY(Polygon, 4326),  -- User-drawn polygon
  
  -- Metrics (denormalized for performance)
  total_flyers INTEGER DEFAULT 0,
  scans INTEGER DEFAULT 0,  -- Unique homes scanned
  conversions INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_campaigns_owner ON campaigns(owner_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_territory USING GIST(territory_boundary);
```

#### `campaign_addresses` Table

```sql
CREATE TABLE campaign_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  
  -- Address Data
  address TEXT,  -- Raw address string
  formatted TEXT,  -- Formatted display address
  house_number TEXT,
  street_name TEXT,
  locality TEXT,  -- City/Town
  region TEXT,  -- State/Province
  postal_code TEXT,
  
  -- Geospatial
  coordinate JSONB,  -- {"lat": number, "lon": number}
  geom GEOMETRY(Point, 4326),
  building_outline JSONB,  -- Coordinate[][]
  
  -- Building Link
  gers_id TEXT,  -- Overture GERS ID (unique per campaign)
  building_gers_id TEXT,  -- Parent building GERS ID
  
  -- Orientation (for 3D house models)
  road_bearing DOUBLE PRECISION,  -- 0-360 degrees
  house_bearing DOUBLE PRECISION,  -- Calculated from road
  is_oriented BOOLEAN DEFAULT false,
  orientation_locked BOOLEAN DEFAULT false,
  
  -- QR Code
  qr_code_base64 TEXT,  -- Base64 QR image (legacy)
  purl TEXT,  -- Tracking URL (legacy)
  qr_png_url TEXT,  -- PNG image URL
  
  -- Scan Tracking
  visited BOOLEAN DEFAULT false,
  scans INTEGER DEFAULT 0,
  last_scanned_at TIMESTAMPTZ,
  
  -- Sequence
  seq INTEGER,  -- Order in campaign
  source TEXT CHECK (source IN ('closest_home', 'import_list', 'map', 'same_street')),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_address_per_campaign UNIQUE (campaign_id, gers_id)
);

-- Indexes
CREATE INDEX idx_addresses_campaign ON campaign_addresses(campaign_id);
CREATE INDEX idx_addresses_geom USING GIST(geom);
CREATE INDEX idx_addresses_gers ON campaign_addresses(gers_id);
CREATE INDEX idx_addresses_scans ON campaign_addresses(scans);
CREATE INDEX idx_addresses_purl ON campaign_addresses(purl);
```

### 3.2 QR Code System

#### `qr_codes` Table

```sql
CREATE TABLE qr_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Relationships
  campaign_id UUID REFERENCES campaigns(id),
  address_id UUID REFERENCES campaign_addresses(id),
  landing_page_id UUID REFERENCES campaign_landing_pages(id),
  farm_id UUID,
  batch_id UUID,
  
  -- Short URL
  slug TEXT UNIQUE NOT NULL,  -- 8-char alphanumeric (e.g., "a1b2c3d4")
  qr_url TEXT,  -- Full URL: https://flyrpro.app/q/{slug}
  qr_image TEXT,  -- Base64 or storage URL
  
  -- Destination
  destination_type TEXT CHECK (destination_type IN ('landingPage', 'directLink')),
  direct_url TEXT,  -- External URL for directLink type
  
  -- A/B Testing
  qr_variant TEXT CHECK (qr_variant IN ('A', 'B')),
  
  -- Metadata
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE UNIQUE INDEX idx_qr_slug ON qr_codes(slug);
CREATE INDEX idx_qr_campaign ON qr_codes(campaign_id);
CREATE INDEX idx_qr_address ON qr_codes(address_id);
```

#### `qr_code_scans` Table

```sql
CREATE TABLE qr_code_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qr_code_id UUID NOT NULL REFERENCES qr_codes(id) ON DELETE CASCADE,
  address_id UUID REFERENCES campaign_addresses(id) ON DELETE SET NULL,
  
  -- Scan Data
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent TEXT,
  ip_address INET,
  referrer TEXT,
  device_info TEXT,
  
  CONSTRAINT fk_qr_code FOREIGN KEY (qr_code_id) REFERENCES qr_codes(id)
);

-- Indexes
CREATE INDEX idx_scans_qr ON qr_code_scans(qr_code_id);
CREATE INDEX idx_scans_time ON qr_code_scans(qr_code_id, scanned_at DESC);
CREATE INDEX idx_scans_address ON qr_code_scans(address_id);
```

#### `qr_generation_jobs` Table

```sql
CREATE TABLE qr_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  
  -- Progress
  total_addresses INTEGER DEFAULT 0,
  processed_addresses INTEGER DEFAULT 0,
  failed_addresses INTEGER DEFAULT 0,
  
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

### 3.3 Buildings/Map System

#### `buildings` Table (Primary)

```sql
CREATE TABLE buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gers_id TEXT UNIQUE NOT NULL,  -- Overture GERS ID (stable identifier)
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  
  -- Geometry
  geom GEOMETRY(MultiPolygon, 4326) NOT NULL,
  centroid GEOMETRY(Point, 4326) NOT NULL,
  
  -- Status (for map colors)
  latest_status TEXT DEFAULT 'default' CHECK (latest_status IN ('default', 'not_home', 'interested', 'dnc', 'available')),
  is_hidden BOOLEAN DEFAULT false,
  
  -- Overture Metadata
  height NUMERIC,  -- Building height in meters
  height_m NUMERIC,
  levels INTEGER,  -- Number of floors
  house_name TEXT,
  addr_housenumber TEXT,
  addr_street TEXT,
  addr_unit TEXT,
  
  -- Map-specific
  source TEXT DEFAULT 'overture',
  is_townhome_row BOOLEAN DEFAULT false,
  units_count INTEGER DEFAULT 0,
  divider_lines GEOMETRY(MultiLineString, 4326),
  unit_points GEOMETRY(MultiPoint, 4326),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_buildings_geom USING GIST(geom);
CREATE INDEX idx_buildings_centroid USING GIST(centroid);
CREATE INDEX idx_buildings_gers ON buildings(gers_id);
CREATE INDEX idx_buildings_campaign ON buildings(campaign_id);
CREATE INDEX idx_buildings_status ON buildings(latest_status);
```

#### `map_buildings` Table (Map Visualization)

```sql
CREATE TABLE map_buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gers_id TEXT,  -- Overture GERS ID
  source TEXT DEFAULT 'overture',
  
  -- Geometry (Polygon, not MultiPolygon for fill-extrusion)
  geom GEOMETRY(Polygon, 4326) NOT NULL,
  centroid GEOMETRY(Point, 4326) GENERATED ALWAYS AS (ST_Centroid(geom)) STORED,
  
  -- 3D Properties
  height_m NUMERIC DEFAULT 6,
  levels INTEGER DEFAULT 2,
  
  -- Multi-unit Properties
  is_townhome_row BOOLEAN DEFAULT false,
  units_count INTEGER DEFAULT 0,
  divider_lines GEOMETRY(MultiLineString, 4326),
  unit_points GEOMETRY(MultiPoint, 4326),
  
  -- Links
  address_id UUID REFERENCES campaign_addresses(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  house_number TEXT,
  street_name TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_map_buildings_geom USING GIST(geom);
CREATE INDEX idx_map_buildings_gers ON map_buildings(gers_id);
CREATE INDEX idx_map_buildings_campaign ON map_buildings(campaign_id);
```

#### `building_stats` Table (Real-time Scan Stats)

```sql
CREATE TABLE building_stats (
  building_id UUID PRIMARY KEY REFERENCES map_buildings(id) ON DELETE CASCADE,
  gers_id TEXT UNIQUE,  -- For map feature matching
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  
  -- Status
  status TEXT DEFAULT 'not_visited' CHECK (status IN ('not_visited', 'visited', 'hot')),
  
  -- Scan Counts
  scans_total INTEGER DEFAULT 0,
  scans_today INTEGER DEFAULT 0,
  last_scan_at TIMESTAMPTZ,
  
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_building_stats_campaign ON building_stats(campaign_id);
CREATE INDEX idx_building_stats_status ON building_stats(status);
CREATE UNIQUE INDEX idx_building_stats_gers ON building_stats(gers_id);

-- IMPORTANT: Enable Realtime for instant map updates
ALTER PUBLICATION supabase_realtime ADD TABLE building_stats;
```

#### `building_address_links` Table (Stable Linker)

```sql
CREATE TABLE building_address_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  address_id UUID NOT NULL REFERENCES campaign_addresses(id) ON DELETE CASCADE,
  building_id UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  
  -- Matching Info
  method TEXT,  -- 'COVERS', 'BUFFER', 'NEAREST'
  confidence DOUBLE PRECISION,
  distance_m DOUBLE PRECISION,
  is_primary BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT unique_link_per_campaign UNIQUE (campaign_id, address_id)
);

-- Indexes
CREATE INDEX idx_links_campaign ON building_address_links(campaign_id);
CREATE INDEX idx_links_building ON building_address_links(building_id);
CREATE INDEX idx_links_address ON building_address_links(address_id);
```

#### `scan_events` Table (Raw Scan Log)

```sql
CREATE TABLE scan_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID REFERENCES map_buildings(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  address_id UUID REFERENCES campaign_addresses(id),
  qr_code_id UUID REFERENCES qr_codes(id) ON DELETE SET NULL,
  qr_id TEXT,  -- Optional string identifier
  
  scanned_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_scan_events_building ON scan_events(building_id);
CREATE INDEX idx_scan_events_campaign ON scan_events(campaign_id);
CREATE INDEX idx_scan_events_time ON scan_events(scanned_at DESC);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE scan_events;
```

### 3.4 User/CRM System

#### `user_profiles` Table

```sql
CREATE TABLE user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  pro_active BOOLEAN DEFAULT false,
  stripe_customer_id TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- RLS: Users can only access own profile
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = user_id);
```

#### `contacts` Table

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  
  -- Contact Info
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  
  -- Links
  campaign_id UUID REFERENCES campaigns(id),
  farm_id UUID REFERENCES farms(id),
  gers_id UUID,  -- Links to buildings
  address_id UUID REFERENCES campaign_addresses(id) ON DELETE SET NULL,
  
  -- Status
  status TEXT CHECK (status IN ('hot', 'warm', 'cold', 'new')),
  last_contacted TIMESTAMP,
  notes TEXT,
  reminder_date TIMESTAMP,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_contacts_user ON contacts(user_id);
CREATE INDEX idx_contacts_gers ON contacts(gers_id);
CREATE INDEX idx_contacts_campaign_gers ON contacts(campaign_id, gers_id);
```

#### `contact_activities` Table

```sql
CREATE TABLE contact_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  
  type TEXT CHECK (type IN ('knock', 'call', 'flyer', 'note', 'text', 'email', 'meeting')),
  note TEXT,
  timestamp TIMESTAMP,
  
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### `farms` Table

```sql
CREATE TABLE farms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  polygon TEXT,  -- GeoJSON string
  
  -- Schedule
  start_date DATE,
  end_date DATE,
  frequency INTEGER,  -- Touches per month (1-4)
  is_active BOOLEAN,
  area_label TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.5 Landing Pages

#### `campaign_landing_pages` Table

```sql
CREATE TABLE campaign_landing_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  
  slug TEXT NOT NULL,  -- URL slug
  headline TEXT,
  subheadline TEXT,
  hero_url TEXT,  -- Hero image URL
  
  -- CTA
  cta_type TEXT CHECK (cta_type IN ('book', 'home_value', 'contact', 'custom')),
  cta_url TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### 3.6 Flyers

#### `flyers` Table

```sql
CREATE TABLE flyers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  
  name TEXT DEFAULT 'New Flyer',
  size TEXT DEFAULT 'LETTER_8_5x11',
  
  -- Design Data (JSON)
  data JSONB,  -- { backgroundColor, elements: [...] }
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 4. Core Data Flows

### 4.1 Campaign Creation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                  CAMPAIGN CREATION FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User Creates Campaign                                       │
│     - Name, Type, Address Source                               │
│     - Draw territory polygon (optional)                        │
│                     │                                           │
│                     ▼                                           │
│  2. INSERT into campaigns                                       │
│     - status: 'draft'                                          │
│     - provision_status: 'pending'                              │
│                     │                                           │
│                     ▼                                           │
│  3. Address Generation (one of):                               │
│     a) Closest Homes: Query MotherDuck for nearest addresses   │
│     b) Import CSV: Parse and insert recipients                 │
│     c) Map Selection: User clicks buildings on map             │
│     d) Same Street: Query addresses on same street             │
│                     │                                           │
│                     ▼                                           │
│  4. INSERT into campaign_addresses (bulk)                      │
│     - Geocode coordinates                                      │
│     - Calculate road bearing (orientation)                     │
│     - Link to buildings via gers_id                            │
│                     │                                           │
│                     ▼                                           │
│  5. Provision Buildings                                         │
│     POST /api/campaigns/provision                              │
│     - Fetch buildings from Overture (via MotherDuck)           │
│     - INSERT into buildings / map_buildings                    │
│     - CREATE building_address_links                            │
│     - Set provision_status: 'ready'                            │
│                     │                                           │
│                     ▼                                           │
│  6. Generate QR Codes                                           │
│     POST /api/generate-qrs                                     │
│     - For each address: generate unique slug                   │
│     - Create QR image (Base64 or PNG)                          │
│     - Store in qr_codes table                                  │
│                     │                                           │
│                     ▼                                           │
│  7. Campaign Ready                                              │
│     - status: 'active'                                         │
│     - Buildings visible on map                                 │
│     - QR codes ready for printing                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 QR Scan → Map Update Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                QR SCAN TO MAP UPDATE FLOW                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User Scans QR Code                                          │
│     - Phone camera reads QR                                    │
│     - Opens URL: https://flyrpro.app/q/{slug}                  │
│                     │                                           │
│                     ▼                                           │
│  2. Server: GET /api/q/{slug}                                   │
│     - Lookup qr_codes by slug                                  │
│     - Get address_id and campaign_id                           │
│                     │                                           │
│                     ▼                                           │
│  3. Bot Detection                                               │
│     - Check user_agent for crawlers                            │
│     - If bot: skip tracking, just redirect                     │
│                     │                                           │
│                     ▼                                           │
│  4. Record Scan (if not bot)                                    │
│     INSERT INTO qr_code_scans (qr_code_id, address_id, ...)    │
│                     │                                           │
│                     ▼                                           │
│  5. Update Address Status                                       │
│     - UPDATE campaign_addresses SET visited = true             │
│     - First scan: INCREMENT campaigns.scans                    │
│                     │                                           │
│                     ▼                                           │
│  6. Find Building Link                                          │
│     - Query building_address_links for building_id             │
│     - Get building's gers_id                                   │
│                     │                                           │
│                     ▼                                           │
│  7. Update Building Stats                                       │
│     RPC: increment_building_scans(gers_id, campaign_id)        │
│     - UPSERT building_stats                                    │
│     - INCREMENT scans_total, scans_today                       │
│     - SET status = 'visited', last_scan_at = now()             │
│                     │                                           │
│                     ▼                                           │
│  8. Supabase Realtime Broadcast                                 │
│     - building_stats row changed                               │
│     - Realtime channel fires UPDATE event                      │
│                     │                                           │
│                     ▼                                           │
│  9. iOS App Receives Realtime Update                           │
│     - Subscribed to building_stats changes                     │
│     - Payload: { gers_id, status, scans_total }                │
│                     │                                           │
│                     ▼                                           │
│  10. Update Map Building Color                                  │
│      - Find feature by gers_id                                 │
│      - Update fill color to YELLOW (#facc15)                   │
│      - Instant visual feedback                                 │
│                     │                                           │
│                     ▼                                           │
│  11. Redirect User to Destination                               │
│      - landingPage: /l/{landing_page_slug}                     │
│      - directLink: external URL                                │
│      - Default: campaign.video_url or /welcome                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Building Status Color Priority

Buildings are colored based on their status. The priority order is:

| Priority | Status | Color | Hex | Condition |
|----------|--------|-------|-----|-----------|
| 1 (Highest) | QR_SCANNED | Yellow | `#facc15` | `scans_total > 0` OR `qr_scanned = true` |
| 2 | CONVERSATIONS | Blue | `#3b82f6` | `status = 'hot'` AND not scanned |
| 3 | TOUCHED | Green | `#22c55e` | `status = 'visited'` AND not scanned |
| 4 (Lowest) | UNTOUCHED | Red | `#ef4444` | Default / `status = 'not_visited'` |

**Note**: QR scans always take priority. A building that was manually marked "hot" will turn yellow when scanned.

---

## 5. API Endpoints Reference

### 5.1 QR Code APIs

#### `GET /api/q/{slug}` - QR Scan Handler

Handles QR code scans, tracks analytics, and redirects.

**Path Parameters:**
- `slug` (string): 8-character alphanumeric QR code identifier

**Response:** 302 Redirect to destination URL

**Logic:**
1. Lookup QR code by slug
2. Bot detection (skip tracking for crawlers)
3. Insert scan record
4. Update building stats
5. Redirect to destination

---

#### `POST /api/qr/create` - Create QR Code

Creates a new QR code with destination.

**Request Body:**
```json
{
  "campaignId": "uuid (optional)",
  "addressId": "uuid (optional)",
  "destinationType": "landingPage | directLink",
  "landingPageId": "uuid (required if landingPage)",
  "directUrl": "string (required if directLink)",
  "qrVariant": "A | B (optional)"
}
```

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "slug": "a1b2c3d4",
    "qr_url": "https://flyrpro.app/q/a1b2c3d4",
    "destination_type": "landingPage",
    "created_at": "timestamp"
  }
}
```

---

#### `POST /api/qr/analytics` - Get QR Analytics

**Request Body:**
```json
{
  "campaignId": "uuid (optional)",
  "qrCodeIds": ["uuid", "..."] // optional
}
```

**Response (by campaign):**
```json
{
  "data": [
    {
      "id": "uuid",
      "slug": "a1b2c3d4",
      "hasBeenScanned": true,
      "scanCount": 5
    }
  ]
}
```

---

#### `POST /api/generate-qrs` - Bulk QR Generation

Generates QR codes for all addresses in a campaign.

**Request Body:**
```json
{
  "campaignId": "uuid",
  "trackable": true,
  "baseUrl": "https://flyrpro.app" // optional
}
```

**Response:**
```json
{
  "success": true,
  "count": 150,
  "message": "Generated 150 QR codes"
}
```

---

### 5.2 Campaign APIs

#### `GET /api/campaigns/[campaignId]/addresses` - Get Campaign Addresses

Returns all addresses as GeoJSON FeatureCollection.

**Response:**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [-122.4194, 37.7749]
      },
      "properties": {
        "id": "uuid",
        "address": "123 Main St",
        "formatted": "123 Main St, San Francisco, CA 94102",
        "visited": false,
        "scans": 0,
        "qr_png_url": "https://..."
      }
    }
  ]
}
```

---

#### `GET /api/campaigns/[campaignId]/buildings` - Get Campaign Buildings

Returns all buildings as GeoJSON FeatureCollection for map rendering.

**Response:**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "gers_id_here",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[...]]]
      },
      "properties": {
        "gers_id": "string",
        "height_m": 8,
        "levels": 2,
        "status": "not_visited",
        "scans_total": 0,
        "qr_scanned": false,
        "address_text": "123 Main St",
        "feature_status": "linked | orphan_building"
      }
    }
  ]
}
```

---

#### `POST /api/campaigns/provision` - Provision Campaign

Fetches buildings and roads from Overture, links to addresses.

**Request Body:**
```json
{
  "campaign_id": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "addresses_saved": 150,
  "buildings_saved": 145,
  "roads_saved": 50,
  "links_created": 148,
  "orphan_buildings": 5
}
```

---

#### `POST /api/campaigns/generate-address-list` - Generate Addresses

Generates addresses from Overture data.

**Request Body:**
```json
{
  "campaign_id": "uuid",
  "starting_address": "123 Main St, City, State",
  "count": 50,
  "coordinates": { "lat": 37.7749, "lng": -122.4194 },
  "polygon": { "type": "Polygon", "coordinates": [...] }
}
```

---

### 5.3 Building APIs

#### `GET /api/buildings/[gersId]` - Get Building Details

**Query Parameters:**
- `campaign_id` (optional): Filter by campaign

**Response:**
```json
{
  "gers_id": "string",
  "address_id": "uuid",
  "campaign_id": "uuid",
  "campaign_name": "My Campaign",
  "address": "123 Main St",
  "postal_code": "94102",
  "status": "visited",
  "visited": true,
  "scans": 3,
  "last_scanned_at": "timestamp"
}
```

---

#### `GET /api/scan` - Legacy Scan Handler

Handles scans via address ID query parameter.

**Query Parameters:**
- `id`: Address ID

**Response:** 302 Redirect to campaign `video_url` or `/welcome`

---

### 5.4 Landing Page APIs

#### `GET /api/l/[slug]` - Render Landing Page

Renders the landing page HTML for a given slug.

#### `POST /api/landing-page/cta-click` - Track CTA Click

**Request Body:**
```json
{
  "landingPageId": "uuid"
}
```

---

### 5.5 Export APIs

#### `GET /api/zip-qrs?campaignId={id}` - Download QR ZIP

Downloads a ZIP file containing:
- PNG files for each QR code
- `vdp-manifest.csv` for Variable Data Printing
- `README.txt` with printer instructions

#### `GET /api/campaigns/[campaignId]/vdp-manifest` - VDP CSV

Returns CSV manifest for professional printing.

---

## 6. Supabase RPC Functions

### `rpc_get_campaign_full_features(campaign_id UUID)`

Returns all buildings for a campaign with status colors. Used for map rendering.

**Returns:** GeoJSON FeatureCollection

```sql
-- Call from Supabase client
const { data } = await supabase.rpc('rpc_get_campaign_full_features', {
  campaign_id: 'uuid-here'
});
```

---

### `rpc_get_buildings_in_bbox(min_lon, min_lat, max_lon, max_lat, campaign_id?)`

Returns buildings within a viewport bounding box. Used for exploration mode.

---

### `increment_building_scans(p_gers_id TEXT, p_campaign_id UUID)`

Atomically increments scan counters for a building.

```sql
-- Upserts building_stats row
-- Increments scans_total and scans_today
-- Sets status = 'visited'
-- Updates last_scan_at
```

---

### `get_campaign_stats(campaign_id UUID)`

Returns aggregated campaign metrics.

**Returns:**
```json
{
  "addresses": 150,
  "buildings": 145,
  "visited": 50,
  "scanned": 25,
  "scan_rate": 16.67,
  "progress_pct": 33.33
}
```

---

### `get_campaign_bbox(campaign_id UUID)`

Returns bounding box for campaign territory.

**Returns:** `[min_lon, min_lat, max_lon, max_lat]`

---

## 7. Real-Time Subscriptions

### Building Stats Subscription

Subscribe to `building_stats` table for instant map updates.

**Supabase Swift SDK:**
```swift
let channel = supabase.channel("building_stats_\(campaignId)")

channel
  .on("postgres_changes", 
      filter: .eq("campaign_id", campaignId),
      table: "building_stats") { payload in
    // payload.new contains updated building_stats row
    let gersId = payload.new["gers_id"] as? String
    let status = payload.new["status"] as? String
    let scansTotal = payload.new["scans_total"] as? Int
    
    // Update map feature color
    updateBuildingColor(gersId: gersId, scansTotal: scansTotal)
  }
  .subscribe()
```

**Event Payload:**
```json
{
  "table": "building_stats",
  "type": "UPDATE",
  "old": { "gers_id": "abc123", "scans_total": 0, "status": "not_visited" },
  "new": { "gers_id": "abc123", "scans_total": 1, "status": "visited" }
}
```

### Scan Events Subscription

For real-time scan notifications:

```swift
channel
  .on("postgres_changes",
      filter: .eq("campaign_id", campaignId),
      table: "scan_events") { payload in
    // New scan occurred
    showScanNotification(payload.new)
  }
  .subscribe()
```

---

## 8. Map Visualization System

### 8.1 Map Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MAP VISUALIZATION                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Data Source: GeoJSON from Supabase RPC                        │
│                     │                                           │
│                     ▼                                           │
│  Map Library: Mapbox GL (iOS: Mapbox Maps SDK)                 │
│                     │                                           │
│                     ▼                                           │
│  Layer Type: Fill-Extrusion (3D buildings)                     │
│                     │                                           │
│                     ▼                                           │
│  Color Expression: Data-driven by status/scans_total           │
│                     │                                           │
│                     ▼                                           │
│  Real-time Updates: setFeatureState() by gers_id               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Two Map Modes

#### Campaign Mode (has `campaignId`)

- **Fetch Strategy**: Load ALL buildings once via `rpc_get_campaign_full_features`
- **No viewport filtering**: All buildings loaded upfront
- **Pattern**: "Fetch once, render forever"
- **Performance**: Smooth pan/zoom, no additional API calls

#### Exploration Mode (no `campaignId`)

- **Fetch Strategy**: Load buildings in viewport via `rpc_get_buildings_in_bbox`
- **Viewport filtering**: Only visible buildings loaded
- **Debounce**: 200ms delay on map move
- **Pattern**: Viewport-based lazy loading

### 8.3 Fill-Extrusion Layer Configuration

```swift
// iOS Mapbox SDK Configuration
var layer = FillExtrusionLayer(id: "buildings-3d")
layer.source = "campaign-buildings"
layer.sourceLayer = nil  // GeoJSON source

// Height from properties
layer.fillExtrusionHeight = .expression(
  Exp(.get) { "height_m" }
)

// Base height (ground level)
layer.fillExtrusionBase = .constant(0)

// Opacity
layer.fillExtrusionOpacity = .constant(0.9)

// Color based on status
layer.fillExtrusionColor = .expression(
  Exp(.switchCase) {
    // Priority 1: QR Scanned (yellow)
    Exp(.gt) { Exp(.get) { "scans_total" }; 0 }
    UIColor(hex: "#facc15")
    
    // Priority 2: Hot/Conversations (blue)
    Exp(.eq) { Exp(.get) { "status" }; "hot" }
    UIColor(hex: "#3b82f6")
    
    // Priority 3: Visited/Touched (green)
    Exp(.eq) { Exp(.get) { "status" }; "visited" }
    UIColor(hex: "#22c55e")
    
    // Default: Not visited (red)
    UIColor(hex: "#ef4444")
  }
)
```

### 8.4 Feature State Updates

For instant color changes without re-rendering the entire layer:

```swift
// When realtime update received:
mapView.mapboxMap.setFeatureState(
  sourceId: "campaign-buildings",
  featureId: gersId,  // gers_id is the feature ID
  state: [
    "scans_total": newScansTotal,
    "status": newStatus
  ]
)
```

**Important**: Use `promoteId: "gers_id"` when adding GeoJSON source to enable feature state by `gers_id`.

### 8.5 Map Lighting for 3D Buildings

```swift
// Configure light for 3D depth perception
var light = Light()
light.anchor = .map
light.position = .constant([1.5, 90, 80])  // [radial, azimuthal, polar]
light.intensity = .constant(0.5)
light.color = .constant(StyleColor(.white))

mapView.mapboxMap.style.setLight(light)
```

---

## 9. QR Code System

### 9.1 QR Code Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                    QR CODE SYSTEM                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Short URL Format: https://flyrpro.app/q/{slug}                │
│                                                                 │
│  slug: 8-character alphanumeric (e.g., "a1b2c3d4")             │
│        - Lowercase letters and numbers                         │
│        - Unique across all QR codes                            │
│        - Generated via QRCodeService.generateUniqueSlug()      │
│                                                                 │
│  Destination Types:                                             │
│    1. landingPage → /l/{landing_page_slug}                     │
│    2. directLink → external URL                                │
│                                                                 │
│  A/B Testing:                                                   │
│    - qr_variant: 'A' or 'B'                                    │
│    - Can track which variant performs better                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 QR Generation (Server-Side)

```typescript
// Generate unique 8-char slug
function generateSlug(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let slug = '';
  for (let i = 0; i < 8; i++) {
    slug += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return slug;
}

// Check uniqueness in database
async function generateUniqueSlug(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const slug = generateSlug();
    const { data } = await supabase
      .from('qr_codes')
      .select('id')
      .eq('slug', slug)
      .single();
    
    if (!data) return slug;  // Unique!
  }
  throw new Error('Failed to generate unique slug');
}
```

### 9.3 QR Code Image Generation

Using `qrcode` library (Node.js):

```typescript
import QRCode from 'qrcode';

const qrUrl = `https://flyrpro.app/q/${slug}`;
const qrBase64 = await QRCode.toDataURL(qrUrl, {
  width: 512,
  margin: 2,
  errorCorrectionLevel: 'M'
});
```

For iOS, use Core Image:

```swift
import CoreImage.CIFilterBuiltins

func generateQRCode(from string: String) -> UIImage? {
    let context = CIContext()
    let filter = CIFilter.qrCodeGenerator()
    
    filter.message = Data(string.utf8)
    filter.correctionLevel = "M"
    
    guard let outputImage = filter.outputImage else { return nil }
    
    // Scale up for better quality
    let transform = CGAffineTransform(scaleX: 10, y: 10)
    let scaledImage = outputImage.transformed(by: transform)
    
    if let cgImage = context.createCGImage(scaledImage, from: scaledImage.extent) {
        return UIImage(cgImage: cgImage)
    }
    return nil
}
```

### 9.4 Bot Detection

Common bots to filter:

```typescript
const BOT_PATTERNS = [
  'googlebot', 'bingbot', 'slurp', 'duckduckbot',
  'baiduspider', 'yandexbot', 'facebookexternalhit',
  'twitterbot', 'linkedinbot', 'whatsapp', 'telegrambot',
  'applebot', 'crawler', 'spider', 'bot'
];

function isBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return BOT_PATTERNS.some(pattern => ua.includes(pattern));
}
```

---

## 10. Type Definitions (Swift Models)

### Campaign Models

```swift
import Foundation

struct Campaign: Codable, Identifiable {
    let id: UUID
    let ownerId: UUID
    let name: String
    let type: CampaignType?
    let addressSource: AddressSource?
    let status: CampaignStatus
    let provisionStatus: ProvisionStatus?
    let destinationUrl: String?
    let videoUrl: String?
    let seedQuery: String?
    let bbox: [Double]?  // [min_lon, min_lat, max_lon, max_lat]
    let totalFlyers: Int
    let scans: Int
    let conversions: Int
    let createdAt: Date
    
    enum CodingKeys: String, CodingKey {
        case id
        case ownerId = "owner_id"
        case name, type
        case addressSource = "address_source"
        case status
        case provisionStatus = "provision_status"
        case destinationUrl = "destination_url"
        case videoUrl = "video_url"
        case seedQuery = "seed_query"
        case bbox
        case totalFlyers = "total_flyers"
        case scans, conversions
        case createdAt = "created_at"
    }
}

enum CampaignType: String, Codable {
    case flyer, doorKnock = "door_knock", event, survey
    case gift, popBy = "pop_by", openHouse = "open_house", letters
}

enum AddressSource: String, Codable {
    case closestHome = "closest_home"
    case importList = "import_list"
    case map
    case sameStreet = "same_street"
}

enum CampaignStatus: String, Codable {
    case draft, active, completed, paused
}

enum ProvisionStatus: String, Codable {
    case pending, ready, failed
}
```

### Address Models

```swift
struct CampaignAddress: Codable, Identifiable {
    let id: UUID
    let campaignId: UUID
    let address: String?
    let formatted: String?
    let houseNumber: String?
    let streetName: String?
    let locality: String?
    let region: String?
    let postalCode: String?
    let coordinate: Coordinate?
    let gersId: String?
    let roadBearing: Double?
    let houseBearing: Double?
    let isOriented: Bool
    let visited: Bool
    let scans: Int
    let lastScannedAt: Date?
    let qrPngUrl: String?
    let seq: Int?
    let createdAt: Date
    
    enum CodingKeys: String, CodingKey {
        case id
        case campaignId = "campaign_id"
        case address, formatted
        case houseNumber = "house_number"
        case streetName = "street_name"
        case locality, region
        case postalCode = "postal_code"
        case coordinate
        case gersId = "gers_id"
        case roadBearing = "road_bearing"
        case houseBearing = "house_bearing"
        case isOriented = "is_oriented"
        case visited, scans
        case lastScannedAt = "last_scanned_at"
        case qrPngUrl = "qr_png_url"
        case seq
        case createdAt = "created_at"
    }
}

struct Coordinate: Codable {
    let lat: Double
    let lon: Double
}
```

### QR Code Models

```swift
struct QRCode: Codable, Identifiable {
    let id: UUID
    let campaignId: UUID?
    let addressId: UUID?
    let landingPageId: UUID?
    let slug: String
    let qrUrl: String?
    let qrImage: String?
    let destinationType: DestinationType?
    let directUrl: String?
    let qrVariant: String?
    let metadata: [String: AnyCodable]?
    let createdAt: Date
    let updatedAt: Date
    
    enum CodingKeys: String, CodingKey {
        case id
        case campaignId = "campaign_id"
        case addressId = "address_id"
        case landingPageId = "landing_page_id"
        case slug
        case qrUrl = "qr_url"
        case qrImage = "qr_image"
        case destinationType = "destination_type"
        case directUrl = "direct_url"
        case qrVariant = "qr_variant"
        case metadata
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

enum DestinationType: String, Codable {
    case landingPage
    case directLink
}

struct QRCodeScan: Codable, Identifiable {
    let id: UUID
    let qrCodeId: UUID
    let addressId: UUID?
    let scannedAt: Date
    let userAgent: String?
    let ipAddress: String?
    let referrer: String?
    let deviceInfo: String?
    
    enum CodingKeys: String, CodingKey {
        case id
        case qrCodeId = "qr_code_id"
        case addressId = "address_id"
        case scannedAt = "scanned_at"
        case userAgent = "user_agent"
        case ipAddress = "ip_address"
        case referrer
        case deviceInfo = "device_info"
    }
}
```

### Building Models

```swift
struct Building: Codable, Identifiable {
    let id: UUID
    let gersId: String
    let campaignId: UUID?
    let heightM: Double?
    let levels: Int?
    let latestStatus: BuildingStatus
    let isHidden: Bool
    let source: String
    let isTownhomeRow: Bool
    let unitsCount: Int
    let createdAt: Date
    let updatedAt: Date
    
    enum CodingKeys: String, CodingKey {
        case id
        case gersId = "gers_id"
        case campaignId = "campaign_id"
        case heightM = "height_m"
        case levels
        case latestStatus = "latest_status"
        case isHidden = "is_hidden"
        case source
        case isTownhomeRow = "is_townhome_row"
        case unitsCount = "units_count"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

enum BuildingStatus: String, Codable {
    case `default`
    case notHome = "not_home"
    case interested
    case dnc  // Do Not Contact
    case available
    case notVisited = "not_visited"
    case visited
    case hot
}

struct BuildingStats: Codable {
    let buildingId: UUID
    let gersId: String?
    let campaignId: UUID?
    let status: BuildingStatus
    let scansTotal: Int
    let scansToday: Int
    let lastScanAt: Date?
    let updatedAt: Date
    
    enum CodingKeys: String, CodingKey {
        case buildingId = "building_id"
        case gersId = "gers_id"
        case campaignId = "campaign_id"
        case status
        case scansTotal = "scans_total"
        case scansToday = "scans_today"
        case lastScanAt = "last_scan_at"
        case updatedAt = "updated_at"
    }
}
```

### Map Feature Model (GeoJSON)

```swift
struct MapBuildingFeature: Codable {
    let type: String  // "Feature"
    let id: String  // gers_id
    let geometry: GeoJSONGeometry
    let properties: MapBuildingProperties
}

struct MapBuildingProperties: Codable {
    let gersId: String
    let heightM: Double
    let levels: Int?
    let status: String
    let scansTotal: Int
    let qrScanned: Bool
    let addressText: String?
    let featureStatus: String  // "linked" or "orphan_building"
    
    enum CodingKeys: String, CodingKey {
        case gersId = "gers_id"
        case heightM = "height_m"
        case levels
        case status
        case scansTotal = "scans_total"
        case qrScanned = "qr_scanned"
        case addressText = "address_text"
        case featureStatus = "feature_status"
    }
}

struct GeoJSONGeometry: Codable {
    let type: String  // "Polygon"
    let coordinates: [[[Double]]]
}
```

### Contact Models

```swift
struct Contact: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let fullName: String
    let phone: String?
    let email: String?
    let address: String?
    let campaignId: UUID?
    let farmId: UUID?
    let gersId: UUID?
    let addressId: UUID?
    let status: ContactStatus?
    let lastContacted: Date?
    let notes: String?
    let reminderDate: Date?
    let createdAt: Date
    let updatedAt: Date
    
    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case fullName = "full_name"
        case phone, email, address
        case campaignId = "campaign_id"
        case farmId = "farm_id"
        case gersId = "gers_id"
        case addressId = "address_id"
        case status
        case lastContacted = "last_contacted"
        case notes
        case reminderDate = "reminder_date"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

enum ContactStatus: String, Codable {
    case hot, warm, cold, new
}

struct ContactActivity: Codable, Identifiable {
    let id: UUID
    let contactId: UUID
    let type: ActivityType
    let note: String?
    let timestamp: Date?
    let createdAt: Date
    
    enum CodingKeys: String, CodingKey {
        case id
        case contactId = "contact_id"
        case type, note, timestamp
        case createdAt = "created_at"
    }
}

enum ActivityType: String, Codable {
    case knock, call, flyer, note, text, email, meeting
}
```

### Landing Page Models

```swift
struct CampaignLandingPage: Codable, Identifiable {
    let id: UUID
    let campaignId: UUID?
    let slug: String
    let headline: String?
    let subheadline: String?
    let heroUrl: String?
    let ctaType: CTAType?
    let ctaUrl: String?
    let createdAt: Date
    let updatedAt: Date
    
    enum CodingKeys: String, CodingKey {
        case id
        case campaignId = "campaign_id"
        case slug, headline, subheadline
        case heroUrl = "hero_url"
        case ctaType = "cta_type"
        case ctaUrl = "cta_url"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

enum CTAType: String, Codable {
    case book
    case homeValue = "home_value"
    case contact
    case custom
}
```

### Farm Models

```swift
struct Farm: Codable, Identifiable {
    let id: UUID
    let ownerId: UUID
    let name: String
    let polygon: String?  // GeoJSON string
    let startDate: Date?
    let endDate: Date?
    let frequency: Int?  // Touches per month (1-4)
    let isActive: Bool?
    let areaLabel: String?
    let createdAt: Date
    
    enum CodingKeys: String, CodingKey {
        case id
        case ownerId = "owner_id"
        case name, polygon
        case startDate = "start_date"
        case endDate = "end_date"
        case frequency
        case isActive = "is_active"
        case areaLabel = "area_label"
        case createdAt = "created_at"
    }
}

struct FarmTouch: Codable, Identifiable {
    let id: UUID
    let farmId: UUID
    let scheduledDate: Date?
    let completedDate: Date?
    let status: FarmTouchStatus?
    let notes: String?
    
    enum CodingKeys: String, CodingKey {
        case id
        case farmId = "farm_id"
        case scheduledDate = "scheduled_date"
        case completedDate = "completed_date"
        case status, notes
    }
}

enum FarmTouchStatus: String, Codable {
    case scheduled, completed, skipped
}

struct FarmLead: Codable, Identifiable {
    let id: UUID
    let farmId: UUID
    let touchId: UUID?
    let leadSource: FarmLeadSource?
    let name: String?
    let phone: String?
    let email: String?
    let address: String?
    let createdAt: Date
    
    enum CodingKeys: String, CodingKey {
        case id
        case farmId = "farm_id"
        case touchId = "touch_id"
        case leadSource = "lead_source"
        case name, phone, email, address
        case createdAt = "created_at"
    }
}

enum FarmLeadSource: String, Codable {
    case qrScan = "qr_scan"
    case doorKnock = "door_knock"
    case flyer, event, newsletter, ad, custom
}
```

---

## 11. Environment Variables

### Required for iOS

```bash
# Supabase
SUPABASE_URL=https://kfnsnwqylsdsbgnwgxva.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Mapbox
MAPBOX_ACCESS_TOKEN=<your-mapbox-public-token>

# Stripe (if implementing payments)
STRIPE_PUBLISHABLE_KEY=pk_live_...
```

### Server-Side Only (Not needed in iOS)

```bash
# Supabase Admin
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Stripe Webhooks
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# AI Services
GEMINI_API_KEY=...

# MotherDuck (Overture data)
MOTHERDUCK_TOKEN=...
```

---

## 12. iOS Implementation Notes

### 12.1 Supabase Swift SDK Setup

```swift
import Supabase

let supabase = SupabaseClient(
    supabaseURL: URL(string: "https://kfnsnwqylsdsbgnwgxva.supabase.co")!,
    supabaseKey: "your-anon-key"
)
```

### 12.2 Authentication

```swift
// Magic Link
try await supabase.auth.signInWithOTP(
    email: email,
    redirectTo: URL(string: "flyrpro://auth/callback")
)

// Apple Sign In
let credentials = try await supabase.auth.signInWithApple()

// Get current user
let user = try await supabase.auth.user()
```

### 12.3 Database Queries

```swift
// Fetch campaigns
let campaigns: [Campaign] = try await supabase
    .from("campaigns")
    .select()
    .eq("owner_id", user.id)
    .order("created_at", ascending: false)
    .execute()
    .value

// Fetch campaign buildings (RPC)
let geojson = try await supabase
    .rpc("rpc_get_campaign_full_features", params: ["campaign_id": campaignId])
    .execute()
    .value
```

### 12.4 Real-time Subscriptions

```swift
let channel = supabase.channel("building-updates")

channel
    .on("postgres_changes",
        filter: .eq("campaign_id", campaignId),
        table: "building_stats",
        event: .update) { payload in
        // Handle building stat update
        let gersId = payload.new["gers_id"] as? String
        let scansTotal = payload.new["scans_total"] as? Int
        updateMapFeature(gersId: gersId, scans: scansTotal)
    }
    .subscribe()
```

### 12.5 Mapbox iOS SDK

```swift
import MapboxMaps

// Initialize map
let mapView = MapView(frame: view.bounds)
mapView.mapboxMap.loadStyleURI(.streets)

// Add GeoJSON source
var source = GeoJSONSource()
source.data = .featureCollection(featureCollection)
try mapView.mapboxMap.style.addSource(source, id: "campaign-buildings")

// Add fill-extrusion layer
var layer = FillExtrusionLayer(id: "buildings-3d")
layer.source = "campaign-buildings"
layer.fillExtrusionHeight = .expression(Exp(.get) { "height_m" })
layer.fillExtrusionColor = .expression(buildingColorExpression)
try mapView.mapboxMap.style.addLayer(layer)

// Feature state update (for real-time color changes)
mapView.mapboxMap.setFeatureState(
    sourceId: "campaign-buildings",
    featureId: gersId,
    state: ["scans_total": newScans]
)
```

### 12.6 API Calls to Web Backend

For operations not available via Supabase directly, call the web API. For Follow Up Boss integration and connecting from the iOS app, see [docs/FOLLOW_UP_BOSS_AND_IOS_GUIDE.md](docs/FOLLOW_UP_BOSS_AND_IOS_GUIDE.md).

```swift
// Example: Generate QR codes
func generateQRCodes(campaignId: String) async throws {
    let url = URL(string: "https://flyrpro.app/api/generate-qrs")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    
    let body = ["campaignId": campaignId]
    request.httpBody = try JSONEncoder().encode(body)
    
    let (data, _) = try await URLSession.shared.data(for: request)
    // Handle response
}
```

### 12.7 Building–address linking (how the web does it → iOS)

Addresses link easily because they live in `campaign_addresses` and are fetched by campaign. **Buildings** are linked to addresses only through the **`building_address_links`** table. The web uses this flow; iOS must do the same.

**Important:** In production, `building_address_links.building_id` is **TEXT** — the **Overture GERS ID string** from the map (e.g. from `feature.properties.gers_id`). It is **not** a UUID referencing `map_buildings.id`. The web never looks up `map_buildings` to resolve building → address; it queries the link table by GERS ID.

**Web flow (e.g. `useBuildingData`):**

1. User clicks a building on the map → the app has the building’s **GERS ID string** (from the map feature, e.g. `properties.gers_id`).
2. Query **`building_address_links`** with:
   - `campaign_id` = current campaign
   - `building_id` = **that GERS ID string** (same as from the map).
3. From the result, read `address_id` (and possibly multiple rows for multi-unit buildings).
4. Fetch **`campaign_addresses`** for those `address_id` values.
5. Use those addresses for the detail panel (contacts, QR status, etc.).

**Correct schema for `building_address_links` (production):**

- `building_id` **TEXT** NOT NULL — Overture GERS ID (string from the map).
- `address_id` UUID REFERENCES `campaign_addresses(id)`.
- `campaign_id` UUID REFERENCES `campaigns(id)`.
- UNIQUE(`campaign_id`, `address_id`) — one link per address.
- (Also: `match_type`, `confidence`, `distance_meters`, etc.)

**iOS translation:** See also [docs/IOS_GERS_ID_FIX_CHECKLIST.md](docs/IOS_GERS_ID_FIX_CHECKLIST.md) for a step-by-step fix checklist.

1. When the user taps a building, get the **GERS ID string** from the map feature (e.g. `feature.properties.gers_id`). Use that string as-is (do not use `map_buildings.id`).
2. **First** query `building_address_links`:
   - `campaign_id` = current campaign UUID string
   - `building_id` = GERS ID **string** (the one from the map).
3. If you get one or more rows, take their `address_id` values and fetch `campaign_addresses` for those IDs. That gives you the linked address(es).
4. **Optional fallback:** If you get no links, you can try `campaign_addresses` where `gers_id` (or `gers_id_uuid`) equals the same GERS ID; the web’s primary path is the link table, so this is only a fallback.

Do **not** on iOS:

- Query `map_buildings` by `gers_id` and then use `map_buildings.id` as `building_id` in `building_address_links`. The link table is keyed by GERS ID string, not by `map_buildings.id`.

Links are created during **provisioning** by the **Stable Linker** (Gold Standard spatial join): addresses are inserted first, then buildings are downloaded from S3 and matched to addresses in memory; the result is written into `building_address_links` with `building_id` = building’s GERS ID string. So after provision, every matched address has a row in `building_address_links` with the correct `building_id` (GERS ID string).

### 12.8 Key Differences from Web

| Feature | Web (Next.js) | iOS (Swift) |
|---------|---------------|-------------|
| Auth | Cookies | Keychain |
| Maps | Mapbox GL JS | Mapbox Maps SDK |
| State | Zustand/React Query | SwiftUI @State/ObservableObject |
| API | Server Routes | Direct Supabase + HTTP calls |
| QR Scan | Camera → URL redirect | Native QR scanner |
| Push Notifications | N/A | APNs |

---

## Summary

This document provides a complete technical reference for building the FLYR-PRO iOS app. The key systems are:

1. **Authentication**: Supabase Auth with Magic Link and Apple OAuth
2. **Database**: PostgreSQL via Supabase with PostGIS for geospatial data
3. **Campaigns**: Multi-step creation with Overture data provisioning
4. **QR Tracking**: Short URL slugs with real-time scan tracking
5. **Map Visualization**: 3D buildings with status-based colors
6. **Real-time Updates**: Supabase Realtime for instant map updates

The iOS app should use:
- `supabase-swift` for database and auth
- Mapbox Maps SDK for iOS for map rendering
- Same database tables and RPC functions
- Real-time subscriptions for live updates

All API endpoints remain accessible for operations requiring server-side processing.
