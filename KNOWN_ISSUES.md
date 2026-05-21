# Known Issues

This file documents known technical debt and deferred fixes found during smoke testing on 2026-05-20.

---

## Deferred fixes

### Sidebar stale after campaign/farm creation

The campaign and farm sidebars fetch once on mount and do not refetch after a new campaign or farm is created. Users may need to refresh before the new item appears in the sidebar.

Complexity: medium.

### Contact status shows "Not Visited" after save

The outcome RPC writes to `address_statuses`, but does not update `contacts.status`. This needs a product decision on how door-knock outcomes should map to contact statuses.

iOS-coupled tables are involved.

### Add contact form scroll bug

The add contact form can be constrained because it portals into the map shell context. This needs a portal or positioning fix so the form scrolls reliably.

---

## Needs owner decision

### `accountability_posts` table missing in production

Migration `20260408233000_challenge_badges_streaks_share_cards.sql` appears not to be applied in production. The dashboard route returns 500 when loading the latest accountability card.

Owner decision: apply the migration to fix.

### Buildings/Addresses map toggle

The campaign detail map defaults to the Buildings view, so addresses are hidden until the user clicks Addresses. This is confusing for new users.

Owner decision: choose the default map state.

### Map auto-centers to current location on campaign detail

This PR fixes the initial center for campaigns with `bbox` or `territory_boundary`, but existing campaigns without `bbox` may still default to Toronto.

Owner decision: decide whether to backfill missing campaign bounds.

### Meta ads panel not visible

The Meta ads panel is likely gated behind Meta OAuth connection.

Owner decision: confirm expected visibility before changing the UI.

### Contact save may not persist in local dev

Status can reset after navigation in local dev. This needs production verification before deeper changes.
