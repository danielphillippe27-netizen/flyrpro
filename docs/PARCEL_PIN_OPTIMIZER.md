# Parcel-first map pin placement

Implemented locally on 2026-09-15. Not deployed or released to devices.

## Shared contract

`CampaignMapBundlePrebuilder` produces the same address Point geometry and label anchors for web, Android and iOS. `pin_placement` identifies building_centroid, building_parcel_centroid or parcel_center. The original Point is retained in `properties.source_geometry`; deterministic placement does not rewrite the source database coordinate. The bundle render version and optimizer algorithm version were advanced to invalidate earlier output.

A confirmed parcel with one address and one eligible footprint receives a building centroid. A footprint crossing the parcel boundary uses the centroid of its intersection with that parcel, keeping townhouse addresses apart. Area-weighted centers outside concave polygons fall back to a point on the polygon. Sliver intersections are excluded. A confirmed parcel without an eligible building receives a parcel interior point, including a missing linked footprint when no replacement candidate is present; its existing link is preserved.

Multiple addresses sharing one parcel, multiple unclassified buildings, conflicting linked footprints, invalid geometry, and manual/adjusted points remain unchanged. Parcel ownership continues to require the existing civic-address or containment evidence; nearest-parcel guessing is not added.

## Home and garage protection

Explicit garages, sheds, carports and accessory buildings are excluded from automatic building placement and reverse geocoding. An existing home link selects that home even when another unclassified footprint shares its parcel. Other footprints on a parcel with an established linked home are skipped by reverse geocoding. An additional assignment guard prevents a reverse result from moving the address away from that home to another building on the same parcel. Unknown building roles are not guessed from size alone.

Deterministic parcel matches create normal link decisions without moving source coordinates. Reverse geocoding is reserved for remaining candidates, with six concurrent calls, batches of 24 for worker heartbeats, and a ten-second HTTP timeout. Missing reverse configuration still permits the parcel pass; unresolved results are marked for review.

## Client integration

- Web already consumes the bundle Point and label anchors.
- Android already parses Point coordinates and label anchors; its bundle regression verifies separate townhouse pins on a common building and repeat reads.
- iOS now retains `pin_placement` through decoding, offline copies and map updates. Markers and number labels honor canonical geometry instead of recomputing a whole-building center. The offline linker does not reinterpret canonical placement as new evidence, excludes garage classifications and requires a unique centroid-contained parcel candidate.

## Validation

- New server regression suite: parcel/building placement, townhouse intersections, ambiguous and missing footprints, manual protection, concave polygons, original-coordinate retention, idempotence, actual optimizer home/garage decisions, reverse-disabled parcel linking, bounded concurrency and ordered results.
- Existing bundle ownership suite: 9 passed.
- Existing reconciliation rules suite: passed.
- Android `testProductionDebugUnitTest`, CampaignBundleRepositoryParcelTest: 20 passed.
- iOS simulator (iPhone 17 Pro, iOS 26.3): BuildingDataServiceTests and ClientMapLinkerServiceTests, 60 passed. A temporary unit-only scheme bypassed an existing duplicate Info.plist error in the UI test target; the temporary scheme was removed after verification.
- Synthetic 1,500-address/parcel/building benchmark: ownership matching 568 ms before versus 14 ms after; new placement pass 107 ms. Ownership output matched the previous implementation. This does not measure live campaign/network runtime.
- Full web TypeScript checking remains blocked by existing unrelated errors; no errors were reported in the changed optimizer/placement modules on the final check.

Live campaign rendering, production runtime and physical-device behavior have not been verified. Existing cached campaigns need a rebuilt bundle; iOS needs the new client build for canonical townhouse rendering and offline protections.
