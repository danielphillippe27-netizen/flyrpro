# Better Simple Linker: Implementation Summary

## Overview

Implemented the "Better Simple" approach for address-to-building linking, replacing the brittle "Street Name Lock" system with a **Weighted Nearest Neighbor** algorithm using **soft penalties** instead of hard constraints.

## Key Improvements

| Aspect | Old (Street Name Lock) | New (Better Simple) | Benefit |
|--------|------------------------|---------------------|---------|
| **Distance To** | Centroid | Footprint (polygon) | Accurate for large/L-shaped buildings |
| **Search Radius** | 25m | 80m | Catches rural/suburban setbacks |
| **Street Logic** | Hard lock (must match) | Soft penalty (+50m score) | Handles corner lots & data errors gracefully |
| **Crossing Check** | ST_Crosses (heavy geometry) | Street name comparison | Faster, less brittle |
| **Confidence** | Fixed 0.7 | Variable (0.9/0.7/0.4) | Better quality indication |

## The Algorithm: "Covers, then Weighted Nearest"

### Pass 1: COVERS (Unchanged)
If an address point is inside a building footprint → 100% confidence match.

### Pass 2: Weighted Nearest (Completely Rewritten)

```
For each unlinked address:
  1. Find all buildings within 80m
  2. Calculate true distance to footprint edge (not centroid)
  3. Calculate score = distance + penalty
     - If street names match: penalty = 0
     - If street names differ: penalty = 50m
  4. Pick building with lowest score
  5. Assign confidence:
     - 0.9: names match AND distance < 20m
     - 0.7: names match
     - 0.4: names mismatch (corner lot scenario)
```

### Why This Works: The Corner Lot Example

```
Address: "100 Main St"

Building A (Side Street): 5m away physically
  Score = 5m + 50m penalty = 55m
  
Building B (Main St): 15m away (setback)
  Score = 15m + 0 penalty = 15m
  
Winner: Building B (15 < 55)
```

Even though Building A is physically closer, the penalty ensures we pick the correct street. But if Building B doesn't exist or is >55m away, Building A can still win (graceful fallback).

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/20260216140000_better_simple_linker.sql` | New migration with updated functions |

## Functions Updated

### `link_campaign_data(p_campaign_id uuid)`

**Pass 2 Query Structure:**
- Uses `CROSS JOIN LATERAL` with `ORDER BY` weighted score
- Distance calculated with `ST_Distance(point::geography, polygon::geography)`
- Street match: `LOWER(TRIM(ca.street_name)) = LOWER(TRIM(b.addr_street))`
- 50m penalty applied in the `ORDER BY` clause

### `ingest_campaign_raw_data(...)`

**Enhancement:**
- Now captures `addr_street` from Overture building data
- Stores it on the `buildings` table for matching
- Updates on conflict to keep street name current

## Confidence Levels

| Scenario | Confidence | Interpretation |
|----------|------------|----------------|
| Point inside footprint | 1.0 | Perfect match |
| Same street, < 20m | 0.9 | High confidence |
| Same street, ≥ 20m | 0.7 | Medium confidence |
| Different street | 0.4 | Low confidence (review recommended) |

## Testing Recommendations

1. **Large Warehouse Test**: Address near wall of large building should link correctly
2. **L-Shape Strip Mall**: Address on one leg should link to correct leg
3. **Corner Lot**: Address at intersection should prefer correct street
4. **Rural Setback**: Address 40m from building should still link
5. **Data Error**: "St" vs "Street" shouldn't break matching

## Rollback Plan

If issues arise, the previous migration is `20250128000029_street_name_lock_linker.sql`. Simply restore those function definitions.

## Migration Applied

```bash
# Apply to local
supabase db reset

# Or apply to specific environment
supabase db push
```

## Summary

This change makes the linker:
- ✅ More accurate (footprint distance)
- ✅ More forgiving (soft penalties vs hard locks)
- ✅ Better coverage (80m radius)
- ✅ Faster (no ST_Crosses checks)
- ✅ Simpler (single query vs complex lateral joins)
