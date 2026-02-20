# Buildings Strategy Plan: Gold vs Silver

This document is the **single plan** for how the app obtains and serves **buildings** for campaigns under the **Gold** and **Silver** strategies. It covers provision, storage, linking, and read paths.

---

## 1. Strategy at a glance

| Aspect | Gold | Silver |
|--------|------|--------|
| **Building source** | Supabase `ref_buildings_gold` (reference table) | Tile Lambda → S3 snapshot (`buildings.geojson.gz`) |
| **Address source** | `ref_addresses_gold` via RPC | Lambda snapshot → insert into `campaign_addresses` (optionally merged with Gold) |
| **Link storage** | `campaign_addresses.building_id` → UUID in `ref_buildings_gold` | `building_address_links` (address_id, building_id = GERS string) |
| **Link creation** | RPC `link_campaign_addresses_gold` (exact + proximity) | `StableLinkerService.runSpatialJoin` → insert into `building_address_links` |
| **Read path** | RPC `rpc_get_campaign_full_features` → Gold path (ref_buildings_gold) | RPC Silver path if `buildings` table populated; else **S3 fallback** via `campaign_snapshots` + GetObject |

---

## 2. Gold strategy: how we get buildings

### 2.1 When we use Gold

- Provision calls **GoldAddressService.getAddressesForPolygon(campaignId, polygon, region)**.
- If Gold returns **≥ 10 addresses** and **buildings** from the same polygon, we use **Gold only** (addresses + buildings from reference tables).
- No Lambda call; no S3 snapshot for buildings at provision time.

### 2.2 Provision (Gold)

1. **Addresses**  
   - RPC **`get_gold_addresses_in_polygon_geojson`** → rows from **`ref_addresses_gold`**.  
   - Normalized and inserted into **`campaign_addresses`**.

2. **Buildings**  
   - RPC **`get_gold_buildings_in_polygon_geojson`** → rows from **`ref_buildings_gold`** (polygon GeoJSON).  
   - Passed to **BuildingAdapter.fetchAndNormalize(goldBuildings, null, …)** → in-memory normalized GeoJSON (no S3).  
   - Used for **linking only**; we do **not** write Gold building shapes to S3 or `campaign_snapshots`.

3. **Linking**  
   - RPC **`link_campaign_addresses_gold(p_campaign_id, p_polygon_geojson)`**:  
     - Exact: address point **inside** a `ref_buildings_gold` polygon → set `campaign_addresses.building_id`, `match_source = 'gold_exact'`.  
     - Proximity: remaining addresses → nearest `ref_buildings_gold` within 30 m, `match_source = 'gold_proximity'`.  
   - Result: **`campaign_addresses.building_id`** = UUID of **`ref_buildings_gold.id`**. No `building_address_links` rows.

4. **Snapshot**  
   - **No** row (or no `buildings_key`) in **`campaign_snapshots`** for Gold-only campaigns; building geometry stays in **`ref_buildings_gold`**.

### 2.3 Read (Gold)

1. Client calls **GET /api/campaigns/[campaignId]/buildings**.
2. API calls **`rpc_get_campaign_full_features(p_campaign_id)`**.
3. RPC **Gold path**:  
   - If any **`campaign_addresses.building_id`** is set for this campaign:  
     - Join **campaign_addresses** → **ref_buildings_gold** on `ref_buildings_gold.id = campaign_addresses.building_id`.  
     - **GROUP BY building** (one feature per building; multi-address buildings get `address_id = null`, `address_count > 1`).  
     - Return GeoJSON FeatureCollection with `source: 'gold'`.
4. API returns that GeoJSON; **no S3 fallback** is used for Gold.

**Summary:** Gold buildings are **always** read from the database (**`ref_buildings_gold`** + **`campaign_addresses.building_id`**). No S3, no `campaign_snapshots` for building geometry.

---

## 3. Silver strategy: how we get buildings

### 3.1 When we use Silver

- Gold returns **< 10 addresses** (so we call Lambda for addresses), or  
- Gold has addresses but **no buildings** (so we call Lambda for building footprints), or  
- We **reuse** an existing **campaign_snapshots** row (e.g. from generate-address-list or previous provision) and use Lambda snapshot URLs for both addresses and buildings.

In all these cases, **building shapes** come from **Lambda → S3** (snapshot bucket). Addresses are (or include) Lambda output inserted into **`campaign_addresses`**.

### 3.2 Provision (Silver)

1. **Addresses**  
   - From Lambda snapshot and/or merge with Gold: download addresses GeoJSON, normalize, insert into **`campaign_addresses`**.

2. **Buildings**  
   - **TileLambdaService.generateSnapshots(...)** (or reuse from **campaign_snapshots**): Lambda writes **buildings.geojson.gz** to S3 and returns presigned URL (and keys).  
   - **BuildingAdapter.fetchAndNormalize(null, snapshot, preFetchedBuildingsGeo)** downloads (if needed) and normalizes Lambda GeoJSON.  
   - Normalized buildings are passed to **StableLinkerService.runSpatialJoin(campaignId, normalizedBuildingsGeoJSON, overtureRelease)**.  
   - **StableLinkerService** does **not** insert into **`buildings`**; it only writes **`building_address_links`** (and **`address_orphans`** for unlinked addresses).

3. **Linking**  
   - **StableLinkerService**:  
     - Load **campaign_addresses** for the campaign.  
     - For each address, 4-tier matching (containment → point-on-surface → proximity with street match → proximity fallback).  
     - **saveMatches()**: insert **`building_address_links`** (campaign_id, **building_id** = GERS id string, address_id, match_type, confidence, …).  
   - Result: **`building_address_links`** links **address_id** → **building_id** (GERS string).  
   - **Optional:** A separate sync can persist Overture buildings into **`buildings`** (campaign_id, gers_id, geom, …). **Current provision does not do this**; so for Silver we usually have links but no `buildings` rows.

4. **Snapshot**  
   - Provision **upserts** **`campaign_snapshots`** with **bucket**, **buildings_key**, **addresses_key**, **buildings_count**, **buildings_url**, etc. (when we have a full Lambda response).  
   - So **building geometry** for Silver lives in **S3** at **bucket/buildings_key** (gzipped GeoJSON).

### 3.3 Read (Silver)

Two possible read paths:

**Path A – RPC Silver path (only if `buildings` table is populated)**  
- **`rpc_get_campaign_full_features`** checks **building_address_links** for this campaign.  
- If count > 0, it joins **building_address_links** → **buildings** (on `buildings.gers_id = building_address_links.building_id`) → **campaign_addresses**.  
- Returns one feature per link, `source: 'silver'`.  
- **Today:** Provision does **not** insert into **`buildings`**, so this path usually returns **0 features** for a freshly provisioned Silver campaign.

**Path B – S3 fallback (primary Silver read path)**  
- **GET /api/campaigns/[campaignId]/buildings** first calls **`rpc_get_campaign_full_features`**.  
- If that returns **0 building features** (no Gold links, and Silver path has no rows because **buildings** is empty or no links):  
  1. API loads **campaign_snapshots** for this **campaign_id** (bucket, **buildings_key**).  
  2. Uses **AWS S3 GetObjectCommand** with **bucket** + **buildings_key**.  
  3. **gunzip** + JSON parse → GeoJSON FeatureCollection.  
  4. Returns that as the response body.  
- So **Silver buildings are served from S3** via **campaign_snapshots** when the RPC cannot return polygon features.

**Summary:** Silver building **sources** are Lambda → S3. At **read** time we either use the **RPC Silver path** (if **buildings** table is populated and linked) or, in practice, the **S3 fallback** using **campaign_snapshots.buildings_key**.

---

## 4. End-to-end decision flow

```
Provision:
  GoldAddressService.getAddressesForPolygon(...)
  ├─ Gold ≥ 10 addrs + Gold buildings?
  │  └─ YES → Gold path: ref_* tables, link_campaign_addresses_gold, no snapshot
  └─ NO  → Lambda snapshot (or reuse campaign_snapshots)
            → addresses into campaign_addresses
            → buildings GeoJSON from S3 (in-memory for linker)
            → StableLinkerService → building_address_links
            → upsert campaign_snapshots (bucket, buildings_key, ...)

Read (GET /api/campaigns/[id]/buildings):
  rpc_get_campaign_full_features(campaign_id)
  ├─ Any campaign_addresses.building_id set? → Gold path → ref_buildings_gold → return
  ├─ Any building_address_links + buildings rows? → Silver RPC path → return
  └─ Else (0 features) → Load campaign_snapshots → S3 GetObject(bucket, buildings_key) → gunzip → return
```

---

## 5. What must be true for each strategy to work

### Gold

- **Ref tables** **`ref_addresses_gold`** and **`ref_buildings_gold`** exist and are loaded (e.g. claw + sync from `gold-standard/.../buildings.geojson`).
- **RPCs** **`get_gold_addresses_in_polygon_geojson`**, **`get_gold_buildings_in_polygon_geojson`**, **`link_campaign_addresses_gold`** exist and are callable.
- **Read:** No dependency on **campaign_snapshots** or S3 for building geometry.

### Silver

- **Lambda + S3:** Tile Lambda writes **buildings.geojson.gz** to the snapshot bucket; provision has **AWS credentials** and **campaign_snapshots** is upserted with **bucket** and **buildings_key**.
- **Read:**  
  - Either **buildings** table is populated (e.g. by a separate sync from the same GeoJSON) so the RPC Silver path can join **building_address_links** → **buildings**,  
  - Or (current norm) **GET buildings** uses **campaign_snapshots** + S3 GetObject + gunzip to return the same GeoJSON.  
- **API** must use **service role** (or equivalent) when reading **campaign_snapshots** so the row is visible; and **S3 GetObject** must succeed (region, credentials, key).

---

## 6. Key files and RPCs

| Purpose | Gold | Silver |
|---------|------|--------|
| **Addresses + buildings at provision** | `lib/services/GoldAddressService.ts` (`getAddressesForPolygon`, `get_gold_buildings_in_polygon_geojson`) | `lib/services/TileLambdaService.ts`, `lib/services/BuildingAdapter.ts` |
| **Linking** | `link_campaign_addresses_gold` (e.g. `supabase/migrations/20260217210000_gold_linker_two_arg.sql`) | `lib/services/StableLinkerService.ts` → `building_address_links` |
| **Provision orchestration** | `app/api/campaigns/provision/route.ts` (Gold branch) | Same file (Lambda/snapshot branch, upsert **campaign_snapshots**) |
| **Unified read RPC** | `rpc_get_campaign_full_features` Gold path (e.g. `supabase/migrations/20260217500000_gold_dedup_multi_address.sql`) | Same RPC Silver path (building_address_links → buildings); fallback = API |
| **Buildings API** | `app/api/campaigns/[campaignId]/buildings/route.ts` (returns RPC result when features &gt; 0) | Same route: S3 fallback when RPC returns 0 features (campaign_snapshots + GetObject + gunzip) |

---

## 7. Optional: Populating `buildings` for Silver (RPC path)

If you want the **RPC Silver path** to return polygon features (so the API does not need to hit S3 on every request):

1. During or after provision, **persist** the normalized (or raw) building GeoJSON from the snapshot into **`buildings`**: one row per feature with **campaign_id**, **gers_id**, **geom**, etc.
2. **building_address_links** already references **building_id** = GERS string; so **buildings.gers_id** must match.
3. Then **rpc_get_campaign_full_features** will return features from **building_address_links** JOIN **buildings**, and the API will not need the S3 fallback for that campaign.

Current design prefers the **S3 fallback** for Silver (single source of truth in S3, no duplicate storage in **buildings**). The plan above covers both options.

---

*See also: [BUILDINGS_AND_ADDRESSES_GOLD_SILVER_GUIDE.md](./BUILDINGS_AND_ADDRESSES_GOLD_SILVER_GUIDE.md) for terminology, linking details, and loading Gold data.*
