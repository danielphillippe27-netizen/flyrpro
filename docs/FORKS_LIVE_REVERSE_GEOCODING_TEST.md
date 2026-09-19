# Forks live reverse-geocoding test — 2026-09-19

Boundary: west -124.398, south 47.946, east -124.390, north 47.952.
This reproduces the earlier 100-building diagnostic rectangle. The user's screenshot did not include a drawn boundary, so this is not verified as the original campaign extent.

## Actual results

- Source address pins: 0
- Source building footprints: 111
- Source parcels: 88
- Eligible building targets: 100
- Real Mapbox v6 permanent reverse requests: 100
- Provider responses containing addresses: 100
- Distinct returned civic identities: 47
- Accepted by current worker: 36
- Unresolved: 64

Of the rejected matches, 34 provider points were outside the building but inside a parcel containing the building, 27 were outside both the building and its containing parcel(s), and 3 had `point` accuracy rather than rooftop/parcel accuracy. Shared-parcel matches are not evidence of separate unit numbers.

Repeated returned addresses include 293 Founders Way (18 queries), 505 Bogachiel Way (10), and 351 Bogachiel Way (7). Building count must not be described as a count of independently addressable homes. Additional property and unit reconciliation is needed before claiming complete coverage.

## Execution and persistence boundaries

The actual CampaignAddressEnrichmentService.processBatch implementation executed the live provider calls in five batches (24,24,24,24,4), with six concurrent calls per batch. Test-only environment flags enabled permanent geocoding for this process. No configuration file or production flags changed.

The queue adapter was isolated and in memory; this was not a deployed cron/provision/map-bundle end-to-end run. The resulting accepted/null payloads were separately replayed through the actual migration and finish_campaign_address_enrichment function in a disposable Postgres 17/PostGIS 3.5 database. The SQL assertion verified 36 confirmed, 64 unresolved, and 100 retained rows. The disposable database was stopped and removed after verification.

No production migration, deployment, campaign creation, or campaign updates occurred. The production app and user's phone remain unverified for this flow.

## Visual inspection

An interactive Mapbox diagnostic map shows the boundary, source footprints, parcels, accepted house numbers, unresolved stops, and selected provider result locations. Basemap, data layers, and an accepted-address popup were visually checked in the Codex browser. This is a diagnostic map, not the campaign's native optimizer UI.

Local viewer: http://127.0.0.1:8769 (while the test server runs).
Saved evidence: /Users/danielphillippe/.codex/visualizations/2026/09/19/01a0bad9-26ae-7102-b1c0-ed8cf2006ee6/forks/results.json
Test logs and harness: /tmp/wolfgrid-forks-audit/

## Conclusion

Reverse geocoding can recover useful address coverage in this area, but the current strict building pass does not create 100 distinct verified addresses. A next pass needs parcel ownership and multi-unit handling, with ambiguous/shared addresses held for review rather than copied onto neighboring buildings.
