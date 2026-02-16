# Map status quick reference

Two map modes use different tables and status values. Colors are aligned with iOS (e.g. MapController.swift, BuildingLinkMapViewController).

---

## 1. Campaign address map (address-based)

| Color | Status value(s) | Meaning |
|-------|------------------|--------|
| Green | `delivered` | Flyer delivered |
| Blue  | `talked`, `appointment` | Spoke with resident / appointment set |

**Table:** `address_statuses`  
**Column:** `status` (text)

**Allowed values (DB):**  
`none`, `no_answer`, `delivered`, `talked`, `appointment`, `do_not_knock`, `future_seller`, `hot_lead`

**Defined in:**
- DB: `supabase/migrations/20260215100000_create_address_statuses.sql`
- App (iOS): `AddressStatus` in CampaignDBModels.swift
- Map (web): `lib/constants/mapStatus.ts` → `ADDRESS_STATUS_CONFIG`, address-points layer in `CampaignDetailMapView.tsx`

---

## 2. Building / session map (building-based)

| Color | Status value | Meaning |
|-------|--------------|--------|
| Green | `visited` | Touched/knocked |
| Blue  | `hot` | Conversation |

**Table:** `building_stats`  
**Column:** `status` (text)

**Allowed values (DB):**  
`not_visited` \| `visited` \| `hot`

**Defined in:**
- DB: `supabase/migrations/20251214000000_create_map_buildings_schema.sql` (building_stats status CHECK)
- App (iOS): e.g. BuildingLinkMapViewController.swift, MapLayerManager.swift
- Map (web): `lib/constants/mapStatus.ts` → `MAP_STATUS_CONFIG`, `MapBuildingsLayer.tsx`

---

## Quick reference table

| Goal           | Table             | Column   | Green      | Blue              |
|----------------|-------------------|----------|------------|-------------------|
| Address map   | `address_statuses` | `status` | `delivered`| `talked`, `appointment` |
| Building map  | `building_stats`   | `status` | `visited`  | `hot`             |

---

## Web map layers

- **Buildings** tab: uses `building_stats.status` (and QR scanned) → red / green / blue / purple.
- **Addresses** tab: uses `address_statuses.status` (or fallback from `visited`) → red / green / blue / purple (same semantics: delivered = green, talked/appointment = blue).
