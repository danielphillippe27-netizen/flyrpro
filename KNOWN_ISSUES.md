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

### Meta ads panel not visible
Meta ads tab does not appear on farm detail pages. Likely gated 
behind Meta OAuth connection.
Action: Daniel to confirm expected visibility behavior.

### Contact save may not persist in local dev
Contact status resets after navigation in local dev. Needs 
production verification before investigating further.

---

## Notes
- QR ZIP campaign_id filter: confirmed already present, not a bug.
- Map initial center: fixed in PR 19 for campaigns with bbox/territory_boundary.
- Notification insert schema mismatch (message vs body): fixed in PR 19.
- View QR blank tab: fixed in PR 17/19.
