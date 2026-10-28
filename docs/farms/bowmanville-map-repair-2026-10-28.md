Bowmanville farm map repair — 2026-10-28

Farm 2eeb10b8-483e-4785-b83d-0f5cae0bf43f, linked campaign db9b700a-a575-44b9-9ad5-bbe4ab13b57c.

The farm imported 13,327 homes but its linked campaign had zero addresses, no snapshot and no canonical bundle. The tile-only client therefore waited for a build that had never been queued. Added a service-only, batched RPC that mirrors included farm homes and attaches campaign IDs without replacing farm IDs or visit history. Imports now prepare the static source snapshot and canonical bundle after responding; the existing AWS worker builds the PMTiles archive.

The first tile publication failed at the database gateway when both 27 MB manifests were sent in one request. Publication now inserts the valid v2 manifest and updates the compact v3 manifest separately. v3 readers remain pending until the final update. Immutable archives are uploaded before either manifest becomes visible. The AWS worker was updated using the previous immutable image as its base and only replacing its bundled application files.

Worker image: 203802643441.dkr.ecr.us-east-2.amazonaws.com/wolfgrid-canonical-tiles@sha256:e506274f61b58bb8755a587582ed15da0fe47fdf8d3f10e93a2a2192b7e7452f
Previous image: sha256:7bcad6462f6e8d664cd8110d03fdf21a9af50438b922b1882ee1f2c48d5c6a18
Lambda: wolfgrid-canonical-tiles, us-east-2. Update status Successful. Existing rate(1 minute) rule remains enabled.

Published archive: 101,876,967 bytes, 13,327 addresses, 10,280 renderable buildings. Canonical signature: 501e7cc9e466ccf14d28f696397cf5581f614477d60cb8c326f6e872deceb078.

Verified: all 234 active exclusions absent from map addresses; retry adds no duplicates and preserves visit history in a 250-row sample; synthetic full worker/compiler/publication test; worker revision/retry tests; relevant lint (no new errors); production build; authenticated browser map-bundle response 200; map visibly renders Bowmanville footprints and pins. Screenshot /tmp/wolfgrid-bowmanville-map-repaired.png.

Farm page now releases its loading screen after core farm/campaign metadata loads, rather than waiting for the duplicate bulk address download used by QR statistics. Those statistics finish loading afterward.

Source changes remain uncommitted in the shared dirty checkout. Production was deployed from the isolated current-source release, preserving unrelated live changes.

Follow-up performance fix: individual MVT reads selected the entire artifact row, including both ~27 MB manifests. readCanonicalTileArtifact now selects only storage metadata (1,074 bytes for Bowmanville; a direct check measured 137 ms) and coalesces concurrent lookups by campaign/revision. Regression coverage verifies that manifests are excluded and concurrent/subsequent reads use one database lookup. The running browser's map style confirmed campaign-canonical-tiles is the active vector source, with canonical buildings and address layers attached. Full map latency is separate from the metadata measurement.

The same release includes the simpler Notes copy, legacy marker hidden from the notes editor while retained on legacy saves, and Finance mode buttons (Postal drop / Social ad / Other expense) preserving form drafts. Social-spend summary is shown only when recorded spend is above zero. Live source commit 23651c28f70fc275f33357c14f4854f869247c4e was inspected before release; runtime differences are limited to these four intended files.

Close-zoom follow-up: at zoom 14.13, canonical-buildings had visibility=none and all canonical source caches had used=false, even though isSourceLoaded returned true. Base-map zoom cleanup was classifying canonical building/selection layers as base decoration. isPreservedLayer now always protects the reserved canonical- prefix. Regression checks run visual cleanup and base-building/address-label hiding against canonical buildings, selections and labels, verifying that they remain untouched while true base buildings are hidden. A loaded-source flag alone is insufficient verification; inspect actual rendered building features after zooming.

Released zoom preservation as dpl_5odantaCVdoP7KzUbBonpPicuLcw. Fresh production reload, Map tab, two Zoom in actions: zoom 14.1258, canonical-buildings visibility=visible, 6,561 rendered building tile fragments, 15 loaded extrusion tiles, sourceLoaded=true. The same test before the fix had visibility=none, zero rendered buildings and zero used source tiles. Screenshot /tmp/wolfgrid-pmtiles-performance-fixed.png. Finance mode switching/draft preservation and hidden zero social-spend summary were verified live; Notes text and hidden marker were verified live. No test expense was saved.
