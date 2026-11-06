# Reverse-geocoded homes on the web map

Local changes, not deployed. No production records were modified.

## Findings

Read-only inspection of Bowmanville Farm found today's saved visit outcomes, but its newest campaign address was created November 2. This does not prove the user's specific missing home is queued; a house number/street or phone sync inspection is still needed.

The iOS automatic building-location flow supplies a stable address UUID and uses three provenance values: field_building_location, field_building_reverse_geocode, and field_building_location_unresolved. It rejects a server response that substitutes another UUID, because queued outcomes refer to the original UUID. The web manual-address endpoint previously reserved its stable-ID/idempotent RPC path for field_manual_pin and routed these automatic values through a legacy insert/deduplication path. It also required a legacy buildings row even for tiled municipal buildings.

Canonical web feature state used frozen links and did not incorporate explicit building links on newly synced addresses.

## Changes

- Route automatic locations through the existing authenticated, idempotent manual-pin RPC with the supplied UUID required.
- Resolve missing legacy building rows against exact, unambiguous IDs in the authorized campaign's current iOS tile bundle. Unknown IDs remain rejected.
- Persist the public building link through the RPC; skip legacy row-link insertion for tile-only buildings.
- Preserve immutable map geometry for these live additions.
- Join live explicit building identities into canonical feature state, respecting deletions and reassignment. Do not mistake an address-source gers_id for a building ID.

## Validation and remaining work

Focused canonical state, field-building identity, and manual address identity tests pass. Changed files pass ESLint. Repository-wide TypeScript checking reports errors elsewhere; see /tmp/wolfgrid-reverse-geocode-tsc-final.log.

Still required: deployment, retry of an affected phone's queued creation/visit, and confirmation of the same home and visit on web. No authenticated production mutation or device sync was performed during this fix.
