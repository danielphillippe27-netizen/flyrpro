# Platform feature parity: QR scans & door knocks

## Why iOS doesn’t show “QR scans” like the web

**How QR scans work**

- QR scans are **not** something the canvasser does inside the FLYR app.
- They happen when a **homeowner** scans the printed QR code on the flyer with their phone camera. That opens a short URL (e.g. `flyrpro.app/q/xxx`). The backend records the scan and updates which address/building was scanned.
- So there is no in-app “QR scanner” in FLYR by design; the system tracks scans when anyone opens that URL.

**What each platform has**

- **Web**
  - **QR Codes** tab: generate QRs, set destination URL, download/export, and see which addresses have scans (and scan analytics).
  - **Map**: buildings that have been QR-scanned show as purple (QR Code Scanned).
  - **Addresses** tab: “scanned” vs “pending” reflects visit/scan state.

- **iOS**
  - The same scan data is in the backend. When you tap a building, the **Building Data** flow (see `docs/IOS_IMPLEMENTATION_GUIDE.md`) can show **QR status** for that building: e.g. “QR Scanned 3x”, “Last scanned at …”.
  - If the iOS app doesn’t show that, it’s a UI gap: the **data and APIs exist** (e.g. `GET /api/buildings/[gersId]` and the building card data from Supabase). To “have QR scans” on iOS you can:
    1. Show scan count and last scanned in the **building/location card** when the user taps a building.
    2. Optionally add a dedicated “QR scans” or “Homes that scanned” list/tab that uses the same data as the web (e.g. addresses/buildings with `scans > 0` or from `qr_code_scans`).

So: iOS doesn’t lack the *data* for QR scans; it’s about surfacing it in the building card and/or a list like the web’s QR Codes tab.

---

## Why the web didn’t have a “Door knocks / Conversations” tab

**What the web already had**

- **Map**: Door-knock and conversation state are already reflected on the map:
  - **Red** = Untouched  
  - **Green** = Touched (visited)  
  - **Blue** = Conversations (status `hot`)  
  - **Purple** = QR Code Scanned  
- **Addresses** tab: “scanned”/“pending” reflects visited state (door knocked vs not).
- Backend has `building_stats.status` (`not_visited` | `visited` | `hot`) and `building_interactions` / `buildings.latest_status` that drive these colors. The iOS app uses the same data for the colored pins (e.g. green/blue for visited/conversations).

**What was missing**

- There was **no dedicated tab** on the campaign page called “Door knocks” or “Conversations” that listed those activities in one place. So it felt like “the web doesn’t have door knocks/conversations” even though they were visible only on the map and in the Addresses list.

**What we added**

- A **Door knocks** tab on the campaign detail page that:
  - Lists addresses you’ve marked as **Visited** (door knocked).
  - Explains that **Conversations** (hot) are shown on the **Map** as blue pins and can be reviewed there (and in the building card when you click a pin). This keeps parity with the mental model of the iOS map (colored pins = door knocks and conversations).

If you later want a separate “Conversations” list (addresses/buildings with `status = 'hot'`), that can be added by querying `building_stats` (and optionally joining to addresses via `building_address_links`) and exposing that in this tab or a sub-section.
