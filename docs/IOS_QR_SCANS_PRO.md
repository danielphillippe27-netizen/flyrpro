# iOS: Showing QR Scans for Paying Users

To show QR scan data (scan count, last scanned) in the iOS app **only when the user is paying**, use these lookups.

---

## 1. Check if the user is paying (entitlement)

**Endpoint:** `GET /api/billing/entitlement`  
**Auth:** `Authorization: Bearer <Supabase access token>` (same session iOS uses for Supabase).

**Response (200):**
```json
{
  "plan": "free" | "pro" | "team",
  "is_active": true | false,
  "source": "none" | "stripe" | "apple",
  "current_period_end": "2025-03-15T00:00:00.000Z" | null
}
```

**User is “paying” (Pro) when:**
- `is_active === true` **and**
- `plan === 'pro' || plan === 'team'`

If that’s true, show QR scan data; otherwise hide it or show “Upgrade to Pro to see scan activity.”

**When to call:** Once per session (or when opening the campaign/map). Cache the result and refresh after purchase/restore.

---

## 2. Get building details (including scan data when Pro)

**Endpoint:** `GET /api/buildings/[gersId]?campaign_id=<uuid>`  
**Auth:** Same `Authorization: Bearer <Supabase access token>`.

- **`gersId`** – Overture GERS ID of the building (from the map tap).
- **`campaign_id`** (query, optional) – Campaign to resolve the address in.

**Response (200) when user is Pro:**
```json
{
  "gers_id": "uuid",
  "address_id": "uuid",
  "campaign_id": "uuid",
  "campaign_name": "Prima Run",
  "address": "123 Main St",
  "postal_code": "...",
  "status": "visited" | "not_visited",
  "visited": true | false,
  "scans": 3,
  "last_scanned_at": "2025-02-14T18:30:00.000Z",
  "created_at": "..."
}
```

**When user is not Pro:** The API still returns the same shape but with **`scans: 0`** and **`last_scanned_at: null`** so you don’t need a separate branch; just show the “QR scans” section only when `entitlement` says Pro, or when `scans > 0` / `last_scanned_at != null` if you prefer to rely on the API gating.

---

## 3. What to implement in iOS

1. **On app/session start (or when entering a campaign):**  
   Call `GET /api/billing/entitlement` with the Supabase Bearer token.  
   Compute `canShowScans = is_active && (plan == "pro" || plan == "team")` and store it (e.g. in memory or a small cache).

2. **When the user taps a building:**  
   Call `GET /api/buildings/{gersId}?campaign_id={campaignId}` with the same Bearer token.

3. **In the location/building card UI:**
   - If `canShowScans` is true: show a “QR scans” row with `scans` and `last_scanned_at` from the building response.
   - If `canShowScans` is false: hide that row or show “Upgrade to Pro to see scan activity” (and optionally deep‑link to upgrade).

**Optional:** You can also drive the “show scans” UI purely from the building response: if the API returns `scans: 0` and `last_scanned_at: null` for non‑Pro users, you can show the “QR scans” section only when `scans > 0 || last_scanned_at != null`, or still show the section but with “Upgrade to see scan activity” when the entitlement is not Pro (better for prompting upgrade).

---

## Summary table

| What to look up | Endpoint | Purpose |
|-----------------|----------|--------|
| Is user Pro? | `GET /api/billing/entitlement` | Decide whether to show QR scan section at all. |
| Scan count & last scanned for a building | `GET /api/buildings/{gersId}?campaign_id=...` | Show “Scanned 3x”, “Last scanned …” in the location card (only when user is paying; API zeros this for free users). |

Both endpoints use the same auth: **Bearer token** from the Supabase session (`session.access_token`).
