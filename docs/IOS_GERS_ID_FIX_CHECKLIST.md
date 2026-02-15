# iOS Building–Address Linking Fix: GERS ID vs UUID

## Problem Summary

- **Production:** `building_address_links.building_id` stores the **Overture GERS ID string** (e.g. from `feature.properties.gers_id`), not `map_buildings.id` or `buildings.id` (UUID).
- **iOS bug:** The app looked up buildings by `gers_id`, then queried `building_address_links` with `building_id = building.id.uuidString`. That returns no rows, so the location card never shows linked addresses.
- **Additional:** Treating GERS ID as UUID (e.g. `UUID(uuidString: gersId)`) can yield `nil` for valid Overture IDs and hide the card.

## Correct Flow (matches FLYR-PRO web)

1. User taps building → read **GERS ID string** from map feature (`properties.gers_id` or feature id).
2. Query **`building_address_links`** with `campaign_id` and **`building_id` = that GERS ID string**.
3. From the link row(s), take `address_id` and load `campaign_addresses` for those IDs.
4. Show the detail panel with that address data.

**No lookup in `buildings` or `map_buildings` by UUID is required for this path.**

---

## Implementation Checklist (apply in iOS repo)

### 1. BuildingDataService.swift

- [ ] **API:** Change to `fetchBuildingData(gersId: String, campaignId: UUID, addressId: UUID?)`. Cache key: `"\(campaignId.uuidString):\(gersId)"` (use `gersId` as string).
- [ ] **Step 0 (direct address):** Unchanged when `addressId` is present.
- [ ] **Step 1 (campaign_addresses by GERS ID):** Query with `.or("gers_id.eq.\(gersId),building_gers_id.eq.\(gersId))"` using the **string** `gersId` (escape if needed for Supabase).
- [ ] **Step 2 (building_address_links):** Remove the `buildings` / `map_buildings` lookup. Query `building_address_links` directly:
  - `.eq("campaign_id", value: campaignId.uuidString)`
  - `.eq("building_id", value: gersId)` ← **string GERS ID from map**
  - Optionally `.eq("is_primary", value: true)` if the table has it.
  - Select `address_id` and nested `campaign_addresses(...)` as today.
- [ ] **clearCacheEntry:** Change to `gersId: String` (and `campaignId`).
- [ ] **toResolvedAddress:** Called with `fallbackGersId: String` (see models).

### 2. BuildingDataModels.swift

- [ ] **ResolvedAddress:** Change `gersId: UUID` → `gersId: String`. Update `CodingKeys` and encode/decode.
- [ ] **CampaignAddressResponse:** Decode `gers_id` and `building_gers_id` as `String?` (not UUID). Optional: small helper to accept UUID-shaped strings for legacy data.
- [ ] **toResolvedAddress(fallbackGersId:):** Signature `fallbackGersId: String`; body: `gersId: gersId ?? buildingGersId ?? fallbackGersId` (all strings).
- [ ] **BuildingResponse:** No change needed if Step 2 (buildings lookup) is removed.

### 3. CampaignMapView.swift (and LocationCardView)

- [ ] **LocationCardView:** Change `gersId: UUID` → `gersId: String`. Update initializer and all usages (`dataService.fetchBuildingData(gersId:...)`, `clearCacheEntry(gersId:...)`).
- [ ] **Building tap:** When showing the card for a tapped building, use `building.gersId ?? building.id` as the **string** and pass to `LocationCardView(gersId: gersIdString, ...)`. **Remove** the `if let gersId = UUID(uuidString: gersIdString)` gate so the card shows even when GERS ID is not UUID-format.
- [ ] **Address tap:** Pass string: `(address.buildingGersId ?? address.gersId) ?? ""`. Keep passing `addressId` when available for Step 0.

### 4. BuildingStatsSubscriber.swift (recommended)

- [ ] **Callback:** Change from `(UUID, String, Int, Bool)` to `(String, String, Int, Bool)` — first param is `gers_id` string.
- [ ] **BuildingStatsUpdate:** Replace `gersId: UUID` with `gersId: String`; decode `gers_id` as String from JSON.
- [ ] **CampaignMapView (subscriber):** Update callback to accept `(String, String, Int, Bool)` and pass string to `updateBuildingState(gersId: ...)`.

### 5. FlyrMapView / other tap handlers

- [ ] Confirm tap handling uses **gers_id** (or feature id) as **string** when calling visit/building APIs. Do not use `building_id` as UUID in link lookups.

### 6. AddResidentSheetView and other ResolvedAddress consumers

- [ ] Ensure no code assumes `ResolvedAddress.gersId` is a UUID. Use the string for cache keys and API params. Scan for `address.gersId` usages and keep as string.

---

## Verification

- With a provisioned campaign whose links use `building_id` = GERS ID string in `building_address_links`, tap a building on the map. The location card should open and show the linked address.
- If the backend has legacy data with UUID-shaped `gers_id` in `campaign_addresses`, decoding as string (or optional UUID fallback) keeps that working.
- Real-time `building_stats` updates should still apply to the correct map feature when `gers_id` is a string (and when the subscriber uses String, also when `gers_id` is not a valid UUID).

---

## Reference

- **FLYR-PRO technical reference:** §12.7 Building–address linking (GERS ID string in `building_address_links.building_id`).
- **This repo:** No Swift source; this checklist is for the separate iOS app repo.
