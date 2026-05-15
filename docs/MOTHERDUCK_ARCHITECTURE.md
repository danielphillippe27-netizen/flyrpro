# MotherDuck Unified Architecture

## Overview

This document describes the new unified architecture that uses MotherDuck as the "Master Link" to combine Overture building data with Supabase campaign data.

## Architecture Benefits

1. **Single Source of Truth**: One GeoJSON endpoint contains all building data (footprints, addresses, campaign info)
2. **Cleaner Supabase**: Supabase stays "skinny" - only stores campaign metadata and location points
3. **Official Data**: Uses Overture's official address data for building footprints
4. **Simplified Frontend**: No complex WKB/geometry parsing needed
5. **Better Performance**: Single API call instead of multiple fetches

## Current Implementation (Transition Phase)

### API Endpoint: `/api/campaigns/[campaignId]/buildings-unified`

Currently combines existing data sources:
- Fetches buildings from `BuildingService` or `MapService`
- Fetches addresses from `CampaignsService`
- Fetches campaign name from `CampaignsService`
- Combines them into unified GeoJSON format

**Expected GeoJSON Feature Properties:**
```typescript
{
  building_id: string;        // Overture building ID
  render_height: number;      // Height for fill-extrusion
  full_address: string;       // Overture address
  campaign_name: string;      // Campaign name from Supabase
  campaign_status: string;    // Campaign status
  geometry: Polygon;          // Building footprint from Overture
}
```

### Frontend: `BuildingLayers.tsx`

Simplified component that:
- Fetches from unified endpoint
- Uses `fill-extrusion` layer type
- Maps `render_height` to `fill-extrusion-height`
- Colors buildings by `campaign_name`
- Shows popups with `full_address` and `campaign_name`
- Auto-zooms to building bounds

## MotherDuck Integration (✅ Implemented)

The MotherDuck integration is now fully implemented! See `MOTHERDUCK_SETUP.md` for setup instructions.

### Implementation Details

**Service:** `lib/services/MotherDuckUnifiedService.ts`
- Handles DuckDB/MotherDuck connection
- Loads spatial and postgres extensions
- Attaches Supabase as Postgres database
- Executes unified SQL query

**API Route:** `app/api/campaigns/[campaignId]/buildings-unified/route.ts`
- Automatically tries MotherDuck first (if token and password are set)
- Falls back to existing services if MotherDuck is unavailable
- Returns unified GeoJSON in expected format

### The SQL Query

The actual query:
1. Fetches campaign addresses from Supabase (with geometry)
2. Calculates bounding box from address coordinates
3. Queries Overture buildings in that bounding box
4. Creates temporary table with address points
5. Joins buildings with addresses using `ST_Intersects` (point-in-polygon)
6. Extracts Overture addresses from nested `addresses[1].freeform`
7. Returns GeoJSON features with all unified properties

### Environment Variables Required

```bash
MOTHERDUCK_TOKEN=your-token-here
SUPABASE_DB_PASSWORD=your-database-password-here
# OR
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

## Migration Checklist

- [x] Create unified API endpoint
- [x] Refactor BuildingLayers.tsx to use unified endpoint
- [x] Remove complex WKB parsing logic
- [x] Add fill-extrusion rendering
- [x] Add campaign-based coloring
- [x] Add popups with address and campaign info
- [x] Set up MotherDuck connection service
- [x] Create MotherDuck SQL query
- [x] Update API endpoint to use MotherDuck (with fallback)
- [ ] Configure environment variables (MOTHERDUCK_TOKEN, SUPABASE_DB_PASSWORD)
- [ ] Test with production data

## Key Changes

### Removed
- Complex WKB hex parsing in frontend
- Multiple API calls (buildings + addresses separately)
- Point-to-Polygon conversion logic
- 3D model rendering (replaced with fill-extrusion)

### Added
- Unified `/api/campaigns/[campaignId]/buildings-unified` endpoint
- Campaign-based color mapping
- Popups with full address and campaign name
- Simplified BuildingLayers component

## Testing

1. Navigate to a campaign detail page
2. Verify fill-extrusion buildings appear
3. Click on a building to see popup with address and campaign name
4. Verify buildings are colored by campaign
5. Verify map auto-zooms to show all buildings
