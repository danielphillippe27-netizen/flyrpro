# QR Code Tracking Flow - Complete Implementation

## Overview

This document explains how the QR code tracking system works end-to-end, from generation to scan attribution. The system is designed to track **every home** and show **which homes scanned** the QR codes.

## Complete Tracking Flow

### 1. QR Code Generation

**Endpoint:** `POST /api/generate-qrs?campaignId={id}`

**Process:**
1. For each address in the campaign:
   - Generates unique 8-character slug (e.g., `a1b2c3d4`)
   - Creates entry in `qr_codes` table with:
     - `slug`: Short code
     - `address_id`: Foreign key to `campaign_addresses`
     - `campaign_id`: Foreign key to `campaigns`
     - `qr_url`: Short URL (`https://flyrpro.app/q/{slug}`)
     - `direct_url`: Points to legacy `/api/open?addressId={id}` for backward compatibility
   - Generates QR code PNG using short URL (25 chars vs 70 chars)
   - Uploads PNG to Supabase Storage
   - Stores PNG URL in `campaign_addresses.qr_png_url`

**Key Point:** Each address gets a **unique slug** that permanently links to that specific address.

---

### 2. Scan Event (The Critical Step)

**Endpoint:** `GET /api/q/{slug}`

**When user scans QR code:**

1. **Lookup:** Server receives slug (e.g., `a1b2c3d4`)
2. **Resolve:** Queries `qr_codes` table to find:
   - `address_id` → "123 Main St"
   - `campaign_id` → Campaign UUID
   - `direct_url` → Where to redirect

3. **Bot Filtering:** Checks user-agent against bot patterns:
   - Filters: `bot|crawler|spider|preview|scanner|mail|email|facebookexternalhit|linkedinbot|twitterbot|slackbot|whatsapp|telegram|skype|bingpreview|googlebot|baiduspider|yandex|sogou|exabot|facebot|ia_archiver`
   - **Bot scans are logged but NOT counted** toward scan rate

4. **Insert Scan Record** (if not a bot):
   ```sql
   INSERT INTO qr_code_scans (
     qr_code_id,
     address_id,        -- Links to specific home
     user_agent,
     ip_address,
     referrer,
     scanned_at
   )
   ```

5. **Update Address Status** (if first scan):
   ```sql
   UPDATE campaign_addresses 
   SET visited = true 
   WHERE id = {address_id}
   ```

6. **Increment Campaign Scan Count** (if first scan):
   ```sql
   UPDATE campaigns 
   SET scans = scans + 1 
   WHERE id = {campaign_id}
   ```
   - **Only increments on first scan** (unique homes, not total scans)

7. **Redirect:** User is redirected to destination URL

---

### 3. Dashboard Display

**How "Scan Rate" is Calculated:**

```typescript
// From campaigns.scans (unique homes that scanned)
const scanRate = (campaign.scans / campaign.total_flyers) * 100;

// Or from qr_code_scans table (total scans including duplicates)
const totalScans = qr_code_scans.count();
const uniqueHomes = COUNT(DISTINCT address_id);
```

**Current Implementation:**
- `campaigns.scans` = **Unique homes** (increments only on first scan)
- `qr_code_scans` table = **Total scans** (includes duplicates)

---

## Database Schema

### qr_codes Table
```sql
- id (UUID)
- slug (8-char short code) → "a1b2c3d4"
- qr_url → "https://flyrpro.app/q/a1b2c3d4"
- address_id (FK) → Links to campaign_addresses
- campaign_id (FK) → Links to campaigns
- destination_type → 'landingPage' | 'directLink'
- direct_url → Final redirect destination
```

### qr_code_scans Table
```sql
- id (UUID)
- qr_code_id (FK) → Links to qr_codes
- address_id (FK) → Links to campaign_addresses (for direct lookup)
- scanned_at (timestamp)
- user_agent
- ip_address
- referrer
```

### campaign_addresses Table
```sql
- id (UUID)
- campaign_id (FK)
- formatted → "123 Main St, City, State, ZIP"
- visited (boolean) → true if scanned at least once
- qr_png_url → PNG image URL (for backward compatibility)
```

### campaigns Table
```sql
- id (UUID)
- scans (integer) → Count of unique homes that scanned
- total_flyers (integer) → Total addresses in campaign
```

---

## Query Examples

### "Which homes scanned?"
```sql
SELECT 
  ca.formatted,
  ca.id,
  COUNT(qcs.id) as scan_count,
  MIN(qcs.scanned_at) as first_scan,
  MAX(qcs.scanned_at) as last_scan
FROM campaign_addresses ca
JOIN qr_codes qc ON qc.address_id = ca.id
LEFT JOIN qr_code_scans qcs ON qcs.address_id = ca.id
WHERE ca.campaign_id = '{campaign_id}'
  AND ca.visited = true
GROUP BY ca.id, ca.formatted
ORDER BY scan_count DESC;
```

### "Scan rate by neighborhood" (using Overture polygons)
```sql
-- Requires joining with Overture building data
SELECT 
  b.neighborhood,  -- From Overture data
  COUNT(DISTINCT ca.id) as homes_scanned,
  COUNT(DISTINCT ca2.id) as total_homes,
  (COUNT(DISTINCT ca.id)::float / COUNT(DISTINCT ca2.id)::float * 100) as scan_rate
FROM campaigns c
JOIN campaign_addresses ca2 ON ca2.campaign_id = c.id
LEFT JOIN campaign_addresses ca ON ca.campaign_id = c.id AND ca.visited = true
-- Join with buildings/neighborhoods from Overture
GROUP BY b.neighborhood;
```

---

## Key Features

### ✅ Bot Filtering
- Automatically filters out mail preview bots, QR scanner app previews, and crawlers
- Prevents fake scan inflation
- Bot scans are logged but not counted

### ✅ Unique vs Total Scans
- **Unique Homes:** `campaigns.scans` (increments once per address)
- **Total Scans:** `COUNT(*) FROM qr_code_scans` (includes all scans, even duplicates)
- Dashboard can show both metrics

### ✅ Granular Attribution
- Every scan is linked to:
  - Specific address (which home)
  - Specific QR code (which slug)
  - Campaign (which campaign)
  - Timestamp, device, location data

### ✅ Remote Control
- `qr_codes.direct_url` can be updated after printing
- Allows changing landing page destination without reprinting
- Useful for A/B testing or campaign updates

---

## CSV Manifest for Printers

**Endpoint:** `GET /api/campaigns/{id}/vdp-manifest`

**Format:**
```csv
reference_id,address_line,city,region,postal_code,qr_url,campaign_id,campaign_name,print_quantity
REF-000001,123 Main St,Springfield,IL,62701,https://flyrpro.app/q/a1b2c3d4,campaign-uuid,Summer Campaign,1
REF-000002,456 Oak Ave,Chicago,IL,60601,https://flyrpro.app/q/e5f6g7h8,campaign-uuid,Summer Campaign,1
```

**Professional printers use this to:**
1. Import CSV into VDP software (XMPie, FusionPro, etc.)
2. Map `qr_url` column to QR code variable field
3. Machine generates QR code on-the-fly as paper moves through press
4. Ensures correct QR code is printed on correct address flyer

---

## Scalability

### Batch Processing
- Processes 50 addresses at a time to prevent timeouts
- Creates job records for batches of 100+ addresses
- Tracks progress via `qr_generation_jobs` table

### Performance
- Short URLs (25 chars) = simpler QR codes = faster scanning
- Indexed lookups on `slug`, `address_id`, `campaign_id`
- Non-blocking scan recording (doesn't slow down redirect)

### Analytics at Scale
- All scan data stored in `qr_code_scans` table
- Can be queried with MotherDuck for large-scale analytics
- Supports geographic analysis, time-series, conversion funnels

---

## Testing the Flow

1. **Generate QR codes:**
   ```bash
   POST /api/generate-qrs?campaignId={id}
   ```

2. **Simulate scan:**
   ```bash
   GET /api/q/{slug}
   # Should redirect and create entry in qr_code_scans
   ```

3. **Check scan attribution:**
   ```sql
   SELECT * FROM qr_code_scans WHERE address_id = '{address_id}';
   SELECT * FROM campaign_addresses WHERE id = '{address_id}'; -- visited should be true
   SELECT scans FROM campaigns WHERE id = '{campaign_id}'; -- should increment
   ```

4. **Verify bot filtering:**
   ```bash
   curl -H "User-Agent: Googlebot" https://flyrpro.app/q/{slug}
   # Should redirect but NOT increment scan count
   ```

---

## Conclusion

The system now provides **complete home-level attribution**:

✅ Every QR code is uniquely linked to an address  
✅ Every scan is recorded with address attribution  
✅ Bot scans are filtered out  
✅ Unique homes are tracked separately from total scans  
✅ Dashboard shows accurate scan rates  
✅ CSV manifest enables professional printing workflows  

**You can now see exactly which homes scanned your QR codes.**
