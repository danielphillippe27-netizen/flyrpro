# Spatial Joining System

This document describes the spatial joining system that links campaign addresses to building footprints, enriches the result with parcel boundaries, and supports downstream map rendering, review workflows, and multi-unit splitting.

## Overview

The system links three spatial layers:

- `campaign_addresses`: address points scoped to a campaign
- Buildings:
  - Gold path: `ref_buildings_gold`
  - Silver path: `buildings` plus `building_address_links`
- `campaign_parcels`: campaign-scoped parcel polygons loaded after provision

The goal is to assign each address to the most likely building, record match quality, preserve unresolved cases for manual review, and improve accuracy later when parcel data becomes available.

## Design Goals

- Prefer deterministic geometry-based matches over nearest-neighbor guesses
- Preserve confidence and provenance for every match
- Handle both Gold and Silver building stores
- Support suburban edge cases where address points do not fall inside the footprint
- Surface ambiguous and unresolved records instead of silently making bad assignments
- Feed downstream townhouse and multi-unit workflows

## High-Level Architecture

### 1. Provision-time linking

Provision inserts campaign addresses, chooses a building source, and runs linking.

- Gold path writes directly onto `campaign_addresses.building_id`
- Silver path writes rows into `building_address_links`
- Townhouse splitting runs after links are created

Main orchestration lives in:

- `app/api/campaigns/provision/route.ts`
- `lib/services/StableLinkerService.ts`
- `lib/services/TownhouseSplitterService.ts`

### 2. Parcel enrichment

After provisioning, Ontario campaigns can queue parcel enrichment in the background.

- Parcel polygons are pulled from S3
- Candidates are filtered by campaign bbox and territory polygon
- Results are stored in `campaign_parcels`
- The campaign is relinked using parcel-aware logic

Main implementation:

- `lib/services/ParcelEnrichmentService.ts`

### 3. Read-time feature retrieval

The map API reads prelinked data instead of performing expensive spatial joins at request time.

- Gold read path: `campaign_addresses.building_id -> ref_buildings_gold`
- Silver read path: `building_address_links -> buildings`
- Fallback: address points when polygon links are missing
- Self-heal path: if features are incomplete, repair RPCs rerun linking

Main implementation:

- `supabase/migrations/20260217200000_consolidated_linker_and_rpc.sql`
- `app/api/campaigns/[campaignId]/buildings/route.ts`

## Data Model

### Addresses

`campaign_addresses`

- One row per campaign-scoped address point
- Gold linking stores:
  - `building_id`
  - `match_source`
  - `confidence`

### Silver links

`building_address_links`

- One row per matched address
- `building_id` is the Overture GERS id string on the Silver path
- Stores quality and metadata:
  - `match_type`
  - `confidence`
  - `distance_meters`
  - `street_match_score`
  - `building_area_sqm`
  - `is_multi_unit`
  - `unit_count`
  - `unit_arrangement`
  - `overture_release`

Schema baseline:

- `supabase/migrations/20250208230000_enhanced_building_address_links.sql`

### Orphans

`address_orphans`

- Queue of unresolved or ambiguous addresses
- Includes nearest building context and candidate suggestions
- Supports manual assignment flow

### Parcels

`campaign_parcels`

- Campaign-scoped parcel polygons
- Used as a hard container during parcel-aware relinking

## Matching Strategy

## Gold SQL linker

The parcel-aware SQL linker uses this order:

1. Exact containment
2. Parcel bridge
3. Proximity fallback

Gold parcel-aware RPCs:

- `link_campaign_addresses_gold(uuid, jsonb)`
- `link_campaign_addresses_all(uuid)`

Source:

- `supabase/migrations/20260425133000_add_parcel_bridge_to_campaign_linkers.sql`

## StableLinkerService hierarchy

The TypeScript linker uses a more expressive 5-tier hierarchy:

1. Direct containment plus street verification
2. Point-on-surface / boundary handling
3. Parcel bridge
4. Proximity plus semantic ranking
5. Fallback nearest valid building

Additional safeguards:

- Rejects tiny noise geometries and small sheds
- Tracks street mismatch separately from clean containment
- Throws a `DataIntegrityError` on unresolved ties after tie-breakers
- Applies a density guard when an address has too many nearby candidates
- Persists unresolved cases to `address_orphans`

Source:

- `lib/services/StableLinkerService.ts`

## How Parcel Bridging Works

Parcel bridging improves cases where address points are offset from the actual building footprint.

A match is accepted when:

- the address point is covered by a parcel polygon, and
- a building centroid or point-on-surface is also covered by that same parcel

This is especially useful for:

- suburban homes with driveway-offset address points
- townhouse rows
- long or irregular lots
- footprints that do not cleanly contain the source point

## Parcel Enrichment Pipeline

1. Provision marks the campaign as `parcel_enrichment_status = queued`
2. Background enrichment starts for supported Ontario campaigns
3. A parcel source is inferred from address localities
4. The latest parcel NDJSON is found in S3
5. Parcel geometries are normalized from GeoJSON or WKT
6. Records are filtered by bbox, then by polygon intersection
7. Filtered parcels are inserted into `campaign_parcels`
8. The campaign is relinked
9. Multi-unit flags and townhouse units are refreshed

Supported source mapping currently includes:

- Toronto
- Ajax
- Pickering
- Oshawa
- Clarington-area localities

Operational status is written back to the campaign:

- `not_started`
- `queued`
- `processing`
- `ready`
- `failed`
- `skipped`

## Multi-Unit and Townhouse Handling

After linking:

- multiple addresses attached to the same building are marked `is_multi_unit = true`
- `unit_count` is set
- a simple arrangement hint is assigned:
  - `single`
  - `horizontal`
  - `vertical`

Then the townhouse splitter can:

- classify multi-unit buildings
- split townhouse-like footprints into unit geometries
- persist units when feature flags allow it

This gives the system a useful progression:

- first: find the correct parent building
- second: decide whether that parent is really multi-unit
- third: split geometry if unit persistence is enabled

## Quality Signals

The system records enough metadata to evaluate link quality later:

- confidence score
- match type
- street match score
- distance to selected building
- building area
- orphan suggestions
- conflict count
- density warning count
- coverage percent

`StableLinkerService` also returns telemetry such as:

- execution time
- average precision in meters for proximity matches
- street mismatch count
- conflict count
- density warning count

## Read Path and Self-Healing

The feature API is optimized to read already-linked polygons, not spatially join on demand.

When the read path finds only points or mixed results, it can attempt repair by rerunning:

- `link_campaign_addresses_gold`
- `link_campaign_addresses_all`

and then fetching features again.

This is a pragmatic self-healing mechanism that helps campaigns recover from mixed or partial states.

## Strengths

- Clear quality ladder from deterministic to fallback matching
- Strong parcel-bridge improvement for real-world suburban data
- Good operational telemetry and orphan capture
- Supports both Gold and Silver ecosystems instead of forcing one source of truth
- Manual review and manual assignment are first-class concepts
- Multi-unit detection is built into the pipeline rather than bolted on later
- Read path avoids expensive live spatial joins

## Known Tradeoffs and Limitations

- There are two link engines with overlapping responsibilities:
  - SQL RPC linker
  - TypeScript `StableLinkerService`
- Match labels are not perfectly unified across both paths
- Parcel enrichment is asynchronous, so first-pass results may be weaker than final results
- Parcel enrichment is region-limited today
- Self-heal at read time is useful, but it also signals that persistent state can drift
- Multi-unit arrangement inference is intentionally simple in the linker and refined later
- The historical migration trail shows the system has evolved a lot, which increases maintenance overhead

## Recommended Mental Model

Think of the system as a layered join pipeline:

1. Get addresses into campaign scope
2. Link them to the best available building source
3. Persist quality, ambiguity, and orphans
4. Enrich with parcels when available
5. Refresh downstream multi-unit artifacts
6. Serve prebuilt map features quickly

## Suggested Future Improvements

- Consolidate the SQL and TypeScript ranking models into one canonical matching spec
- Normalize match type naming between Gold and Silver paths
- Make parcel-aware linking part of the earliest viable pass where data availability allows
- Add campaign-level QA dashboards for:
  - coverage percent
  - orphan rate
  - parcel bridge usage
  - suspect match rate
- Add regression fixtures for tricky cases:
  - cross-street proximity traps
  - townhouse rows
  - big suburban lots
  - dense downtown overlaps

## File Guide

- `app/api/campaigns/provision/route.ts`
  - Provision orchestration and parcel-enrichment queueing
- `lib/services/StableLinkerService.ts`
  - Rich TypeScript spatial joiner, telemetry, orphan persistence
- `lib/services/ParcelEnrichmentService.ts`
  - Parcel ingestion, filtering, relinking, status tracking
- `lib/services/TownhouseSplitterService.ts`
  - Multi-unit analysis and optional unit geometry persistence
- `supabase/migrations/20260217200000_consolidated_linker_and_rpc.sql`
  - Consolidated SQL linker and read RPC
- `supabase/migrations/20260425133000_add_parcel_bridge_to_campaign_linkers.sql`
  - Parcel-aware SQL linker updates
- `supabase/migrations/20250208230000_enhanced_building_address_links.sql`
  - Link and orphan schema

## Bottom Line

This is a strong applied spatial joining system for campaign operations, especially because it does more than just match points to polygons. It captures confidence, supports review, handles multiple building sources, and meaningfully improves itself with parcels and multi-unit workflows.

Its next step is not invention. It is consolidation: fewer overlapping link paths, more unified semantics, and tighter guarantees that the first persisted state is already the final best state.
