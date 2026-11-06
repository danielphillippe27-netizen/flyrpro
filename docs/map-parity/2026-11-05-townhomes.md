# Townhome map behavior — web alignment with iOS

Scope: automatic townhome splitting, orientation, individual unit selection, and parcel alignment. Reference: local iOS `MapLayerManager.buildTownhomeStatusOverlayGeoJSON`, `townhomeSliceAxis`, address resolution, and townhome layer setup.

## Behavior

- Rows with two or more explicitly linked addresses receive per-address slices clipped to the exact building footprint. No proximity-based links or database edits are created.
- A metric principal axis determines the split direction. Address positions determine physical unit order; missing coordinates fall back to deterministic house-number order, with directional reversal when supported by available coordinates.
- Slice and label identity remain attached to the address when status, selection, or input ordering changes. Polygon holes and disconnected parts remain intact. Failed clipping leaves the existing map available instead of publishing a partial row.
- Canonical tile maps fetch only the needed exact building footprints from their authorized immutable geometry package. Legacy maps use their supplied building geometry. Clipped tile-query polygons are never used for splitting.
- Each unit has independent status/QR colour and selection. Clicking a unit or label takes precedence over the shared building and parcel. Existing detail-card and additive selection flows are reused.
- Existing canonical unit/number overlays are suppressed only after replacement slices are available. Source/style replacement replays geometry and state. Status changes do not rebuild the split or download geometry again.
- Parcel fills/lines/labels stay below homes, including late-loaded layers. Unit selection also highlights explicitly linked legacy parcels without changing their geometry or ownership.

## Web renderer adaptations

Mapbox GL JS generated long bevel spikes on clipped acute-angle slices at the native 0.12 m edge radius. Unit slices therefore use square edges while the existing main building renderer retains its rounding. A Chrome screenshot verified the correction. Labels use automatic rooftop elevation plus 0.05 m clearance; adding the roof height twice caused misplaced labels and was corrected during browser testing.

## Validation

Passed geometry fixtures: reversed numbering, rotated row, shuffled input, duplicate identity, full footprint area, courtyard holes, missing coordinates, single-home exclusion, explicit-link resolution, live reassignment, and label containment.

Passed component checks: real Mapbox style validation, independent unit status/selection, stable geometry on status updates, exact-unit clicks, mode switching, style reload, source cleanup, and coverage reset. Passed exact WGP footprint extraction, namespace isolation, unit-hit priority, late parcel ordering and reentrant style-event protection. Existing canonical lifecycle/state and townhouse identity regression tests also passed.

Chrome fixture: `npx tsx scripts/test-townhome-map-browser.ts`. Uses synthetic geometry and local Mapbox credentials; requires installed Chrome. The three rooftop label hit tests passed with no Mapbox errors; screenshot inspected at `/tmp/wolfgrid-townhome-parity/map.png`.

Focused lint passes. Repository-wide TypeScript still reports unrelated existing errors; changed production files have no reported type errors. No commit, push, deployment, database migration or customer-record modification was performed. An authenticated live campaign / physical iPhone side-by-side walkthrough has not been performed.
