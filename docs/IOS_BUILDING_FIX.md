# iOS Integration: Gold Building Fix

## Problem

Tapping a building on the map showed **"Unlinked Building"** instead of the address for Gold campaigns.

## Root Cause

Two issues working together:

1. **Missing RPC call** — The API route called `get_gold_buildings_for_campaign` which never existed. This caused Gold building polygons to never load, falling back to address dots (Points) with no `gers_id`.
2. **Missing linker data** — The `campaign_addresses.building_id` column was `NULL` for all campaigns because the spatial linker (`link_campaign_addresses_all`) had never been run. Without this, the RPC can't join addresses to building polygons.

## Code Fixes

### `app/api/campaigns/[campaignId]/buildings/route.ts`

Changed RPC call from `get_gold_buildings_for_campaign` to `rpc_get_campaign_full_features` — this handles Gold, Silver, and fallback in one function.

### `components/map/MapBuildingsLayer.tsx`

- Added click + cursor handlers on the **circle layer** so Point-based fallback features are also tappable.
- Fixed the catch block to pass `props.address_id` (was being dropped on error).

### `lib/hooks/useBuildingData.ts`

- Added fallback: if `gersId` matches a `campaign_addresses.id` directly, resolve it (handles address-point features).
- Fixed the `gers_id` / `building_gers_id` query that could throw on missing columns.

### `supabase/migrations/20260217200000_consolidated_linker_and_rpc.sql`

- Gold path: `feature_id` now uses `ca.id` (unique per address) instead of `b.id` (duplicated across addresses sharing one building).
- Added `house_number` and `street_name` to both Gold and Silver feature properties.

### Database Fix

Ran `link_campaign_addresses_all()` for all campaigns to populate `campaign_addresses.building_id` via spatial join against `ref_buildings_gold`.

---

## For iOS

### If you hit the same API endpoint

If your iOS app hits the same `/api/campaigns/{id}/buildings` endpoint, **no iOS changes needed** — the API fix covers it.

### Building-click-to-address resolution

If the iOS app has its own building-click-to-address resolution (like `useBuildingData`), the lookup chain should be tried in this order:

1. `building_address_links.building_id = gers_id` — **Silver** path
2. `campaign_addresses.building_id = gers_id` — **Gold** path
3. `campaign_addresses.id = gers_id` — **Fallback**: feature ID is the address ID itself
4. `campaign_addresses.gers_id = gers_id` — **Legacy**

### Feature properties now available

The feature properties from the API now include everything needed to display the address **directly from the feature properties without a second lookup**:

| Property | Type | Description |
|---|---|---|
| `gers_id` | `string` | Gold building UUID or GERS ID |
| `address_id` | `string` | `campaign_addresses` UUID |
| `address_text` | `string` | Full formatted address |
| `house_number` | `string` | House/unit number |
| `street_name` | `string` | Street name |
| `height_m` | `number` | Building height in meters (default 10) |
| `status` | `string` | `visited` or `not_visited` |
| `scans_total` | `number` | QR scan count |
| `qr_scanned` | `boolean` | Whether QR was scanned |
| `match_method` | `string` | `gold_exact`, `gold_proximity`, `containment_verified`, `proximity_verified` |
| `confidence` | `number` | Match confidence (0.5–1.0) |
| `source` | `string` | `gold`, `silver`, or `address_point` |

### Status coloring (priority order)

| Priority | Status | Color | Condition |
|---|---|---|---|
| 1 | QR Scanned | Purple `#8B5CF6` | `qr_scanned == true` or `scans_total > 0` |
| 2 | Conversations | Blue `#3B82F6` | `status == "hot"` |
| 3 | Touched | Green `#22C55E` | `status == "visited"` |
| 4 | Untouched | Red `#EF4444` | `status == "not_visited"` |

### Rendering by geometry type

- **Polygon** features (gold/silver) → render as 3D extruded buildings using `height_m`
- **Point** features (fallback) → render as colored circles/pins
