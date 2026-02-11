# Campaign Polygon & MotherDuck Reference (for iOS)

Reference for drawing polygons and what gets sent to MotherDuck when creating campaigns. Use this to mirror behavior in the iOS app.

---

## 1. Polygon format (GeoJSON)

The app uses **GeoJSON Polygon** for the drawn territory. This is the single source of truth.

### Structure

```json
{
  "type": "Polygon",
  "coordinates": [
    [
      [lng1, lat1],
      [lng2, lat2],
      [lng3, lat3],
      [lng1, lat1]
    ]
  ]
}
```

- **`type`**: Always `"Polygon"`.
- **`coordinates`**: Array of **rings**.
  - **First ring**: outer boundary (required).
  - **Further rings**: holes (optional; iOS can ignore for v1).
- **Ring**: Array of `[longitude, latitude]` pairs.
  - **Order**: longitude first, then latitude (e.g. `[-79.35, 43.65]`).
  - **Closed**: first and last point must be the same.
  - **Minimum**: 4 points (e.g. 3 corners + closing point).

### TypeScript type (for reference)

```ts
territory_boundary: {
  type: 'Polygon';
  coordinates: number[][][];  // [ring][point][lng, lat]
}
```

---

## 2. How the web app draws polygons

- **Library**: [Mapbox GL Draw](https://github.com/mapbox/mapbox-gl-draw) (`@mapbox/mapbox-gl-draw`).
- **Mode**: `draw_polygon` (user clicks to add vertices, double-click or click first point to close).
- **Getting the polygon**: After the user finishes drawing:
  - `draw.getAll()` → GeoJSON FeatureCollection.
  - First feature’s `geometry` is the Polygon (same structure as above).

Relevant code (web):

```ts
// app/campaigns/create/page.tsx
const features = drawRef.current?.getAll();
if (!features?.features?.length) { /* require polygon */ }
const polygon = features.features[0].geometry as { type: 'Polygon'; coordinates: number[][][] };
```

**iOS equivalent**: Use Mapbox Maps SDK drawing (e.g. `MGLPolygon` / annotation) or any polygon drawing UX, then build the same JSON: `{ type: "Polygon", coordinates: [[[lng, lat], ...]] }` with ring closed.

---

## 3. What we send to MotherDuck

MotherDuck **does not** get a separate “polygon API”; the polygon is used **inside** the backend when provisioning.

### Where the polygon comes from

1. **Create campaign**: Client (web or iOS) sends `territory_boundary` (the GeoJSON Polygon) to **Supabase** when creating the campaign row.
2. **Provision**: Client calls `POST /api/campaigns/provision` with only `{ "campaign_id": "<uuid>" }`. The **server** loads `territory_boundary` from the `campaigns` row and passes that object to MotherDuck (Overture) services.

So “what we send to MotherDuck” is: **the same GeoJSON Polygon** stored in `campaigns.territory_boundary`.

### Accepted polygon shapes (server-side)

The backend normalizes input before calling MotherDuck:

- **Plain Polygon** (what we use): `{ type: "Polygon", coordinates: number[][][] }` → used as-is.
- **GeoJSON Feature**: `{ type: "Feature", geometry: { type: "Polygon", coordinates: ... } }` → backend uses `geometry`.
- **GeoJSON FeatureCollection**: `{ type: "FeatureCollection", features: [{ geometry: ... }] }` → backend uses `features[0].geometry`.

For iOS, sending a **plain Polygon** in `territory_boundary` is enough.

---

## 4. Create campaign payload (for iOS)

Campaigns are created via **Supabase** (insert into `campaigns`), not a custom “create campaign” HTTP API. The web app uses `CampaignsService.createV2()` which does a Supabase insert.

### Supabase insert (campaigns table)

| Column             | Value / notes |
|--------------------|----------------|
| `owner_id`         | Authenticated user UUID |
| `name`             | Campaign name string |
| `title`            | Same as `name` |
| `description`     | `""` |
| `type`             | e.g. `"flyer"` |
| `address_source`   | `"map"` for polygon-drawn territory |
| `seed_query`       | `null` when `address_source === "map"` |
| **`bbox`**         | Optional `[min_lon, min_lat, max_lon, max_lat]` (WGS84) |
| **`territory_boundary`** | **The GeoJSON Polygon** (see §1). Required for “map” territory so provision can run. |
| `total_flyers`     | `0` |
| `scans`            | `0` |
| `conversions`      | `0` |
| `status`           | `"draft"` |

**Critical for “draw on map” flow**:  
`address_source === "map"` and `territory_boundary` must be set. Provision and address generation both depend on `territory_boundary`.

### Optional: bbox

The web app derives bbox from the polygon (e.g. with Turf’s `bbox(polygon)`):  
`bbox = [min_lon, min_lat, max_lon, max_lat]`.  
Use the same order on iOS if you store bbox; it’s not sent to MotherDuck (only the polygon is).

---

## 5. Provision flow (what hits MotherDuck)

1. **Client**: `POST /api/campaigns/provision`  
   Body: `{ "campaign_id": "<campaign_uuid>" }`  
   (No polygon in the request.)

2. **Server**:
   - Loads `territory_boundary` from `campaigns` for that `campaign_id`.
   - If missing → 400: “No territory boundary defined…”
   - Calls:
     - `OvertureService.getAddressesInPolygon(polygon)`
     - `OvertureService.getBuildingsInPolygon(polygon)`
     - `OvertureService.getRoadsInPolygon(polygon)`  
   Those use **MotherDuckHttpService** (or equivalent) with the **same polygon object** (GeoJSON Polygon).

3. **MotherDuck**: Uses the polygon to:
   - Compute a bounding box for the DB query.
   - Optionally refine results with a point-in-polygon check on coordinates.

So “what we send to MotherDuck” is exactly the **GeoJSON Polygon** stored in `territory_boundary`.

---

## 6. Generate address list (map territory)

For “map” campaigns, the web app also calls generate-address-list with the polygon (before or in parallel with provision, depending on flow):

- **Endpoint**: `POST /api/campaigns/generate-address-list`
- **Body** (when using polygon):
  - `campaign_id`: UUID
  - `polygon`: same GeoJSON Polygon `{ type: "Polygon", coordinates: number[][][] }`

The server calls `OvertureService.getAddressesInPolygon(polygon)` (MotherDuck) and then inserts results into `campaign_addresses`. iOS should send the same `polygon` shape if it uses this endpoint.

---

## 7. Summary for iOS

| Step | Action | Polygon / payload |
|------|--------|--------------------|
| Draw | User draws a closed polygon on the map | — |
| Encode | Build GeoJSON Polygon: `type: "Polygon"`, `coordinates: [[[lng, lat], ...]]` (ring closed) | Same format as §1 |
| Create campaign | Supabase insert into `campaigns` | Set `territory_boundary` = that Polygon; `address_source` = `"map"`; optionally `bbox` |
| Generate addresses | `POST /api/campaigns/generate-address-list` | Body: `{ campaign_id, polygon }` (same Polygon) |
| Provision | `POST /api/campaigns/provision` | Body: `{ campaign_id }` only; server uses DB `territory_boundary` for MotherDuck |

**Polygon rules**:  
Longitude first, latitude second; closed ring (first point = last point); at least 4 points per ring.  
That’s what we draw, store, and send to MotherDuck (via the backend).
