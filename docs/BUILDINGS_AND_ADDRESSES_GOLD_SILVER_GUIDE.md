# Buildings and Addresses: Gold vs Silver — Comprehensive Guide

This guide explains how the app obtains **buildings** and **addresses** from **Gold** and **Silver** (and Lambda) sources, and how they are **linked** so the map and CRM can show “this building has these addresses.”

**→ For a concise plan of how we *get buildings* for each strategy (provision + read), see [BUILDINGS_STRATEGY_PLAN.md](./BUILDINGS_STRATEGY_PLAN.md).**

---

## 1. Terminology

| Term | Meaning in this codebase |
|------|--------------------------|
| **Gold** | Authoritative reference data in Supabase: `ref_addresses_gold` (address points) and `ref_buildings_gold` (building polygons). Loaded from municipal/open data (e.g. Toronto CKAN, Durham ArcGIS) via the “claw” and sync scripts. |
| **Silver** | In **provision/address context**: hybrid result when we merge Gold addresses with **Lambda** addresses (so “silver” = some Gold + some Lambda). In **building/read context**: Overture/Lambda building footprints and the link table `building_address_links` (and optionally the `buildings` table). |
| **Lambda** | Tile Lambda (AWS): reads from extract bucket (Overture parquet, StatCan/ODA CSVs), writes campaign-specific GeoJSON to the **snapshot bucket** (S3). Returns presigned URLs for buildings, addresses, roads. |

So:

- **Addresses**: Gold = DB tables `ref_addresses_gold`; Silver/Lambda = addresses from Lambda (S3) or merged Gold+Lambda.
- **Buildings**: Gold = DB table `ref_buildings_gold`; Silver = Overture building footprints from Lambda (S3) and/or `building_address_links` (+ `buildings` table when used).

---

## 2. Where buildings and addresses come from

### 2.1 Gold — reference tables

- **Addresses**: `ref_addresses_gold`  
  - Point geometry, street number/name, city, province, postal code, source metadata.  
  - Populated by: `scripts/ingest_municipal_data.ts` (“the claw”) → S3 under `gold-standard/...` → e.g. `scripts/load_gold_direct.ts` or `scripts/sync-gold-addresses-from-s3.ts` into the DB.

- **Buildings**: `ref_buildings_gold`  
  - Polygon geometry, centroid, area, building type.  
  - Same pipeline: claw/sync from S3 `gold-standard/.../buildings.geojson` into `ref_buildings_gold`.

Relevant migrations: `20260217000000_cascading_geocoder_schema.sql` (ref_addresses_gold), `20260217000004_gold_polygon_queries.sql` and `20260217000006_gold_geojson_rpc.sql` (queries), plus any migration that defines `ref_buildings_gold`.

### 2.2 Silver / Lambda — Tile Lambda + S3

- **Addresses**: Lambda returns a presigned URL to `addresses.geojson.gz` in the snapshot bucket. Provision (or generate-address-list) **downloads** that file and **inserts** normalized rows into `campaign_addresses` (no separate “silver addresses table” for campaigns; Silver here = source of the data, not a DB table name).

- **Buildings**: Lambda returns a presigned URL to `buildings.geojson.gz`. Building **polygons** are either:  
  - Served to the map by **fetching that GeoJSON from S3** (GET buildings API falls back to S3 when the unified RPC returns nothing), or  
  - Used in memory during **provision** for the **Silver linker** (see below). Optionally, a separate sync path can persist Overture buildings into the `buildings` table (e.g. for `rpc_get_campaign_full_features` Silver path).

So:

- **Gold**: addresses and buildings both come from **DB** (`ref_addresses_gold`, `ref_buildings_gold`).
- **Silver/Lambda**: addresses come from **Lambda → S3 → insert into `campaign_addresses`**; buildings come from **Lambda → S3** (and optionally into `buildings` table).

---

## 3. How we get them at provision time

Entry point: **POST /api/campaigns/provision** with `campaign_id`. The campaign has a `territory_boundary` (polygon) and `region` (e.g. `ON`).

### 3.1 Addresses

1. **GoldAddressService.getAddressesForPolygon(campaignId, polygon, regionCode)**  
   - Calls Supabase RPC **`get_gold_addresses_in_polygon_geojson`** with the polygon → returns rows from **`ref_addresses_gold`** (points with `geom_geojson`).  
   - If **Gold count ≥ 10**: we use **Gold only** (addresses + buildings from Gold; see below).  
   - If **Gold count &lt; 10**: we call **TileLambdaService.generateSnapshots(...)** (polygon, region, limits). Lambda writes to S3 and returns `urls.addresses`, `urls.buildings`, etc. We **download addresses** from the presigned URL, convert to campaign format, and optionally **merge** with any Gold addresses (dedupe by house number + street; Gold overwrites Lambda).  
   - Returned `source`: `'gold'` (all from Gold), `'silver'` (merged Gold + Lambda), or `'lambda'` (only Lambda).

2. **Insert into `campaign_addresses`**  
   - AddressAdapter.normalizeArray(...) then batch insert. So **addresses** in the app always live in **`campaign_addresses`**; the difference is whether they were sourced from Gold, Lambda, or both.

### 3.2 Buildings

1. **Gold path (when Gold has enough addresses and buildings)**  
   - Same polygon is passed to RPC **`get_gold_buildings_in_polygon_geojson`** → returns rows from **`ref_buildings_gold`** (polygons as GeoJSON text).  
   - Those rows are passed to **BuildingAdapter.fetchAndNormalize(goldBuildings, null, ...)** → normalized GeoJSON feature collection, `source: 'gold'`.

2. **Silver/Lambda path**  
   - If we called Lambda for addresses, we **reuse the same snapshot** (no second Lambda call). We either use **pre-fetched** buildings GeoJSON (from the snapshot URLs) or fetch from `snapshot.urls.buildings`.  
   - **BuildingAdapter.fetchAndNormalize(null, snapshot, preFetchedBuildingsGeo)** downloads (if needed) and normalizes Lambda GeoJSON → `source: 'lambda'`.

So at provision we have:

- **Addresses**: always in `campaign_addresses` (from Gold, Lambda, or merge).
- **Building shapes**: either from **Gold** (DB → in-memory GeoJSON) or **Lambda** (S3 → in-memory GeoJSON). They are **not** re-fetched from Gold/Lambda on every map load; linking and optional persistence are the next step.

---

## 4. How we link addresses to buildings

Linking means: for each campaign address we decide “which building (if any) this address belongs to,” and store that so the map and APIs can show building → addresses and address → building.

There are **two linking mechanisms**:

- **Gold linker**: writes **`campaign_addresses.building_id`** → UUID of a row in **`ref_buildings_gold`**.
- **Silver linker**: writes **`building_address_links`** (campaign_id, **building_id** = Overture GERS id string, **address_id** = `campaign_addresses.id`).

The provision route runs **one** of them depending on whether we have Gold buildings.

### 4.1 Gold linker (SQL, in-DB)

- **When**: Provision has **Gold buildings** (i.e. we got building rows from `get_gold_buildings_in_polygon_geojson`).  
- **What**: Supabase RPC **`link_campaign_addresses_gold(p_campaign_id, p_polygon_geojson)`** (see `supabase/migrations/20260217210000_gold_linker_two_arg.sql`).  
- **How**:  
  1. Buffer campaign polygon (e.g. 100 m).  
  2. **Exact**: `UPDATE campaign_addresses` SET `building_id = b.id`, `match_source = 'gold_exact'`, `confidence = 1.0` where address point is **inside** a `ref_buildings_gold` polygon (and in polygon).  
  3. **Proximity**: For addresses still without `building_id`, set `building_id` to the **nearest** `ref_buildings_gold` building within 30 m, with `match_source = 'gold_proximity'` and confidence from distance.  
- **Result**: Rows in **`campaign_addresses`** have **`building_id`** (UUID) pointing to **`ref_buildings_gold.id`**. No `building_address_links` rows are created for this path.

### 4.2 Silver linker (JavaScript, in-memory then DB)

- **When**: Provision has **no** Gold buildings (only Lambda/S3 building GeoJSON).  
- **What**: **StableLinkerService.runSpatialJoin(campaignId, normalizedBuildingsGeoJSON, overtureRelease)**.  
- **How**:  
  1. Load **campaign_addresses** for the campaign (id, geom, house_number, street_name, …).  
  2. Filter building features (e.g. drop &lt; 5 m², &lt; 30 m² sheds).  
  3. For each address, run a **4-tier matching** (containment → point-on-surface → proximity with street match → proximity fallback); tie-breaks by area/distance; can mark “orphan” or “ambiguous.”  
  4. **saveMatches()**: insert into **`building_address_links`** one row per match: `campaign_id`, `building_id` = **GERS id string** from the building feature, `address_id`, `match_type`, `confidence`, `distance_meters`, `street_match_score`, building metadata, `overture_release`.  
  5. Orphans are written to **`address_orphans`** (via RPC `insert_address_orphans_batch`).  
- **Result**: **`building_address_links`** links **address_id** (campaign_addresses.id) to **building_id** (Overture GERS string). The **`buildings`** table may be populated by a **separate** sync (e.g. from the same GeoJSON) so that later the unified RPC can join `building_address_links` → `buildings` on `buildings.gers_id = building_address_links.building_id`. StableLinkerService itself does **not** insert into `buildings`.

So:

- **Gold**: link = **`campaign_addresses.building_id`** → **`ref_buildings_gold.id`**.  
- **Silver**: link = **`building_address_links`** (address_id → building_id as GERS string); optionally **`buildings`** holds the polygon rows keyed by `gers_id`.

---

## 5. How the app reads “buildings + addresses” (map/API)

- **Unified feature RPC**: **`rpc_get_campaign_full_features(p_campaign_id)`** (see `20260217500000_gold_dedup_multi_address.sql`) returns one GeoJSON FeatureCollection.  
  - **Gold path**: If the campaign has any **`campaign_addresses.building_id`** set, we build features from **`ref_buildings_gold`**: one feature **per building** (grouped by building_id), with properties like `address_id`, `address_count`, `source: 'gold'`. Multi-address buildings have `address_id = null` and `address_count > 1`.  
  - **Silver path**: If no Gold links but there are **`building_address_links`** rows, we join **building_address_links** → **buildings** (on `buildings.gers_id = building_address_links.building_id`) and → **campaign_addresses**, and emit one feature per link (Silver path in RPC).  
  - **Fallback**: If no building links, we emit **address points** as features (`source: 'address_point'`).

- **GET /api/campaigns/[campaignId]/buildings**  
  - Calls **`rpc_get_campaign_full_features(campaignId)`** first.  
  - If that returns features, the API returns that GeoJSON.  
  - If it doesn’t (e.g. no links or no `buildings` rows for Silver), the API **falls back** to fetching **buildings GeoJSON from S3** (campaign_snapshots.buildings_key) and returns that raw Silver/Lambda GeoJSON.

So:

- **Gold**: buildings and their link to addresses are read from **DB** (ref_buildings_gold + campaign_addresses.building_id).  
- **Silver**: either from **DB** (building_address_links + buildings) or from **S3** (snapshot buildings GeoJSON).

---

## 6. End-to-end flow summary

| Step | Gold | Silver / Lambda |
|------|------|------------------|
| **Address source** | `ref_addresses_gold` via `get_gold_addresses_in_polygon_geojson` | Lambda snapshot → download addresses → insert into `campaign_addresses` (optionally merged with Gold) |
| **Building source** | `ref_buildings_gold` via `get_gold_buildings_in_polygon_geojson` | Lambda snapshot → buildings GeoJSON from S3 (in-memory for linker; optionally stored in `buildings` by another sync) |
| **Link storage** | `campaign_addresses.building_id` → `ref_buildings_gold.id` | `building_address_links` (address_id, building_id = GERS string) |
| **Link creation** | RPC `link_campaign_addresses_gold(campaign_id, polygon)` | StableLinkerService.runSpatialJoin(...) → insert into `building_address_links` |
| **Map/read** | `rpc_get_campaign_full_features` Gold path: ref_buildings_gold + campaign_addresses | Same RPC Silver path: building_address_links + buildings; or fallback S3 buildings GeoJSON |

---

## 7. Key files and RPCs

- **Addresses (Gold)**: `lib/services/GoldAddressService.ts`; RPCs `get_gold_addresses_in_polygon_geojson`, `get_gold_buildings_in_polygon_geojson` (migrations `20260217000004_*`, `20260217000006_*`, `20260218100000_fix_gold_rpc_order_by_integer.sql`).  
- **Buildings (normalize)**: `lib/services/BuildingAdapter.ts` (fromGoldRows / fromLambdaGeoJSON, fetchAndNormalize).  
- **Provision**: `app/api/campaigns/provision/route.ts` (orchestrates Gold vs Lambda, insert addresses, normalize buildings, run Gold or Silver linker, townhouse splitting).  
- **Gold linker**: `supabase/migrations/20260217210000_gold_linker_two_arg.sql` (`link_campaign_addresses_gold`).  
- **Silver linker**: `lib/services/StableLinkerService.ts` (runSpatialJoin, saveMatches → `building_address_links`).  
- **Unified read**: `supabase/migrations/20260217500000_gold_dedup_multi_address.sql` (`rpc_get_campaign_full_features`).  
- **Buildings API**: `app/api/campaigns/[campaignId]/buildings/route.ts` (RPC first, then S3 fallback).  
- **Building ↔ addresses API**: `app/api/campaigns/[campaignId]/buildings/[buildingId]/addresses/route.ts` (Gold: filter `campaign_addresses` by `building_id`; Silver: filter by `building_address_links`).

---

## 8. Loading Gold data into the DB

- **Ref tables**: Ensure migrations are applied so **`ref_addresses_gold`** and **`ref_buildings_gold`** exist.  
- **Ingest**:  
  - **Addresses**: e.g. `scripts/ingest_municipal_data.ts` (writes to S3) then load into DB via `scripts/load_gold_direct.ts` or `scripts/sync-gold-addresses-from-s3.ts`.  
  - **Buildings**: Same scripts with building sources/keys (e.g. `gold-standard/.../buildings.geojson`).  
- **Schema**: Gold address table has at least `street_number`, `street_name`, `city`, `geom` (and optional `source_id`, etc.); Gold building table has `id`, `geom`, `centroid`, etc. See migrations under `supabase/migrations/` for exact columns and RPCs.

This is the full picture of where buildings and addresses come from (Gold vs Silver/Lambda) and how they are linked for campaigns.
