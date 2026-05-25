# Known Issues

Technical debt and deferred fixes. Updated 2026-05-20 after smoke testing.

---

## Deferred fixes (require engineering work)

### Sidebar stale after campaign/farm creation
Campaign and farm sidebars fetch once on mount and do not refetch after 
creation. Users must refresh to see the new item in the sidebar.
Complexity: medium. No iOS coupling.

### Contact status shows "Not Visited" after save
The outcome RPC writes to address_statuses but does not update 
contacts.status. Needs a product decision on how door-knock outcomes 
map to contact statuses before fixing.
iOS-coupled tables involved: campaign_addresses, address_statuses, 
contacts, session_events.

### Add contact form scroll bug
The add contact form portals into the map shell context and scroll 
is constrained when the form opens near the top of the viewport. 
Needs portal or positioning fix.

### QR generation has no true progress indicator
The generate QRs button shows a static progress message while 
generating. An unused qr_generation_jobs table/route exists but 
is not wired up. True async progress requires streaming or polling 
integration.
Complexity: medium to large.

### QR generation has no concurrent generation guard
Two simultaneous generate-qrs calls for the same campaign race row-by-row.
The final QR data is whichever request writes last.

### generate-qrs invalid domain handling
An invalid domain in the URL constructor fails every address in the loop 
but the route still returns success: true with count: 0.

### Assignment notifications not deduplicated
Repeated campaign assignment creation inserts repeated notification rows.
No idempotency guard or dedup check exists in the assignments route.

### notifications table has no FK on user_id
The notifications table enforces workspace_id via FK but not user_id.
The DB does not prevent notifications being created for non-existent users.

### map-bundle: NULL provision_source skips Gold RPC silently
In rpc_get_campaign_map_bundle, the building block is guarded by
provision_source NOT IN (...). In PL/pgSQL, NULL NOT IN (...) evaluates
to null, not true, so a never-provisioned campaign (provision_source = null)
silently skips the Gold RPC and returns empty buildings with no error.

### bundle.parcels unguarded if parcel view enabled
In CampaignDetailMapView.tsx, bundle.parcels is accessed directly after
response.json() without null/shape validation. SHOW_PARCEL_VIEW is
currently false so this path is inactive, but enabling it could throw
if the API returns null or a non-object.

### useBuildingData: no dedup on repeated fallback queries
If multiple fallback paths in useBuildingData return overlapping address
IDs, the final address list may contain duplicates. No dedup step exists
after the fallback chain resolves.

### resolveDashboardAccessLevel sequential auth gate
Home page server component makes 4-5 sequential Supabase round trips in
resolveDashboardAccessLevel() before rendering anything. Parallelizing
would yield ~300-500ms improvement. Requires careful testing — touches
auth gate.

### MapBuildingsLayer unguarded source/layer reads
Lines ~1869, 1870, 2615 have map.getLayer()/map.getSource() reads without
local try/catch. Not in event handlers so crash risk is low, but weaker
than the hardened pattern. Do not touch while Daniel is actively working
on this file.

### fetchAddresses() waterfall
CampaignsService.fetchAddresses() performs sequential paginated reads
against three tables. Main remaining bottleneck on campaign detail for
large campaigns. Consider parallelizing or combining into a single query.

### No client-side caching
No SWR, React Query, or Next.js cache anywhere. Every navigation refetches
all data from scratch. High-value target for back-navigation performance.

### Campaign detail entirely client-side
All data fetching via useEffect with no server prefetch. Converting campaign
row fetch to server component would improve Time to First Byte.

### Large QR base64 payload
QR PNGs stored as base64 inline in campaign page payload. For large
campaigns this inflates memory and API response size significantly.
Consider S3 URLs instead.

---

## Needs owner decision

### accountability_posts table missing in production
Migration 20260408233000_challenge_badges_streaks_share_cards.sql 
has not been applied to production. The dashboard accountability 
card widget returns 500 on every load.
Action: Daniel to apply the migration.

### Buildings/Addresses map toggle default
Campaign detail map defaults to Buildings tab — addresses are hidden 
until the user clicks Addresses. Confusing for new users who expect 
to see their campaign addresses on load.
Action: Daniel to decide default map state.

### campaign territory_boundary not validated as valid Polygon
The provision route checks if (!polygon) but does not validate that
territory_boundary is actually a valid GeoJSON Polygon before passing
it to Turf/PMTiles logic. A malformed non-null territory can pass
validation and cause a cryptic failure inside Turf.
Action: add explicit GeoJSON Polygon validation at the route boundary.

### Nav cleanup (decided — pending implementation)
- Remove flyer editor from nav (export 501, persistence TODO-backed)
- Remove partner offers from nav
- Remove landing pages create link (routes to non-existent page)
- Enforce canonical domain flyrpro.app via middleware redirect

### Farms removal
Daniel handling. Campaign features that were farm-only need to be absorbed
into campaigns. Do not touch farm-related code until Daniel is done.

### Team leader / field agent mod actions
Greenlit. Needs scoping — actions, permissions, UI surfaces.

### Audit log for destructive actions
Greenlit. Needs scoping — which actions, where stored, who can view.

---

## Notes
- QR ZIP campaign_id filter: confirmed already present, not a bug.
- Map initial center: fixed in PR 19 for campaigns with bbox/territory_boundary.
- Notification insert schema mismatch (message vs body): fixed in PR 19.
- View QR blank tab: fixed in PR 17/19.
- isConnectionError timeout retry bug: fixed in PR 20. withTimeout()
  rejection message 'exceeded' was not matched by the old check for
  'timeout'. Timeout errors were never retried.
- Building ID double-encoding bug: fixed in PR 20. IDs were only decoded
  once, leaving double-encoded Bedrock IDs unresolved.
- generate-qrs auth hole: fixed in PR 20. Route had no workspace check.
- useBuildingData AbortController: fixed in PR 20.
- Meta ads panel not visible: resolved. Farms are being removed, so this
  farm detail visibility issue is moot.
- Contact save may not persist in local dev: resolved. address_statuses is
  the source of truth per Daniel.
- GeoJSON audit 2026-05-21: Daniel's 12 commits audited, no conflicts
  with our fixes, retry cap preserved, no new layer-scoped listeners,
  minor unguarded reads at lines ~1869/1870/2615 noted.
- Dashboard perf PR 23: 37% faster (1214ms → 762ms). Remaining bottleneck
  is sequential server auth gate.
- Campaign detail perf PR 23: progressive rendering implemented, shell
  renders after campaign fetch, addresses/contacts lazy-load in parallel.
