# Gold Standard Townhouse Splitting Implementation

Complete production-grade townhouse detection and geometric splitting system with robust error handling and manual review fallbacks.

## Overview

This implementation provides:
- **Townhouse Detection**: Identify row houses (2-6 units) using aspect ratio and unit count
- **Geometric Splitting**: OBB-based linear slicing for precise unit boundaries
- **Apartment Handling**: Circle placeholders for buildings with 7+ units
- **Error Recovery**: Manual review queue for failed splits
- **Quality Assurance**: Validation checks and coverage reporting

## Architecture

### 1. Database Schema

**building_units** - Individual unit geometries
- `id`, `campaign_id`, `parent_building_id`
- `address_id`, `unit_number`
- `unit_geometry` (GeoJSON Polygon)
- `split_method`: 'obb_linear', 'weighted', 'manual', 'apartment_placeholder'
- `validation_status`: 'passed', 'warning', 'failed', 'manual_override'
- `parent_type`: 'townhouse', 'apartment', 'duplex', 'triplex'
- `status`: 'not_visited', 'visited', 'not_home', etc.

**building_split_errors** - Manual review queue
- Error types: 'validation_failed', 'geometry_complex', 'address_mismatch', 'split_failed'
- Suggested actions for each error
- Resolution tracking

### 2. Detection Algorithm

Townhouse candidates are identified by:
- Unit count: 2-6 addresses linked to building
- Aspect ratio: Length/width > 1.5 (approximation)
- Not L-shaped (vertex count ≤ 6)

Apartments (7+ units) are skipped from splitting and get placeholder circles.

### 3. Splitting Algorithm (OBB Linear)

1. **Find Street Edge**: Detect edge with most addresses nearby
2. **Order Addresses**: Sort by projection onto street edge
3. **Create Cutting Planes**: Perpendicular lines between address midpoints
4. **Split Polygon**: Divide building into unit geometries
5. **Validate**: Each unit must contain its assigned address

### 4. API Endpoints

**Provision Integration**
```typescript
POST /api/campaigns/provision
// Automatically runs townhouse splitting after spatial join
```

**Unit Management**
```typescript
GET  /api/campaigns/[campaignId]/units
// Returns GeoJSON FeatureCollection of all units

POST /api/campaigns/[campaignId]/units
// Update unit status or notes
```

**Split Error Management**
```typescript
GET  /api/campaigns/[campaignId]/split-errors
// Returns errors requiring manual review

POST /api/campaigns/[campaignId]/split-errors/[errorId]/resolve
// Manually resolve with custom unit geometries
```

### 5. Response Format

Provision API now returns:
```json
{
  "success": true,
  "addresses_saved": 24,
  "buildings_saved": 8,
  "units_created": 24,
  "spatial_join": {
    "matched": 24,
    "orphans": 0,
    "suspect": 0,
    "avgConfidence": 0.92
  },
  "townhouse_split": {
    "total_buildings": 3,
    "townhouses_detected": 2,
    "apartments_skipped": 1,
    "units_created": 24,
    "errors_logged": 0,
    "avg_units_per_townhouse": 4
  }
}
```

## Usage

### 1. Apply Migration

Run in Supabase SQL Editor:
```sql
-- File: supabase/migrations/20250209000000_building_units_and_split_errors.sql
```

### 2. Create Campaign

Normal campaign creation flow - townhouse splitting runs automatically during provisioning.

### 3. Load Units on Map

```typescript
// Fetch units as GeoJSON
const response = await fetch(`/api/campaigns/${campaignId}/units`);
const geojson = await response.json();

// Add to Mapbox
map.addSource('units', {
  type: 'geojson',
  data: geojson
});

map.addLayer({
  id: 'units-fill',
  source: 'units',
  type: 'fill',
  paint: {
    'fill-color': [
      'match', ['get', 'status'],
      'visited', '#22c55e',
      'not_home', '#ef4444',
      '#3b82f6'
    ],
    'fill-opacity': 0.7
  }
});
```

### 4. Handle Split Errors

```typescript
// Get errors requiring review
const errors = await fetch(`/api/campaigns/${campaignId}/split-errors`);

// Resolve with manual split
await fetch(`/api/campaigns/${campaignId}/split-errors/${errorId}/resolve`, {
  method: 'POST',
  body: JSON.stringify({
    units: [
      {
        address_id: '...',
        unit_geometry: { type: 'Polygon', coordinates: [...] },
        unit_number: '1'
      }
    ],
    notes: 'Manual split for L-shaped building'
  })
});
```

## Target Metrics

- **95%** of townhouses split automatically
- **100%** address coverage (no orphans)
- **<2 seconds** processing per building
- **<5%** manual review queue

## Implementation Files

1. **Migration**: `supabase/migrations/20250209000000_building_units_and_split_errors.sql`
2. **Service**: `lib/services/TownhouseSplitterService.ts`
3. **Provision Route**: `app/api/campaigns/provision/route.ts`
4. **Units API**: `app/api/campaigns/[campaignId]/units/route.ts`
5. **Split Errors API**: `app/api/campaigns/[campaignId]/split-errors/route.ts`
6. **Resolve API**: `app/api/campaigns/[campaignId]/split-errors/[errorId]/resolve/route.ts`

## Future Enhancements (S-Tier)

1. **CRS Math**: Project to meter-based CRS (EPSG:3857) before splitting
2. **Self-Intersection Fix**: Add `building.buffer(0)` to clean topology
3. **Weighted Centroids**: Use address density for uneven distributions
4. **Shapely Integration**: Move splitting to Python Lambda for complex geometries
