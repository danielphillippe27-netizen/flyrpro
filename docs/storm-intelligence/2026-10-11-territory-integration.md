# Storm Intelligence — implementation and release gates

## Verified on 2026-10-11

- The existing configured Xweather account successfully retrieved a historical hail point query for 2025-03-03. This verifies API access, not regional swaths or export rights.
- Production REST exposes approximately 5.87 million reference addresses and 4.36 million reference buildings (estimated table counts).
- Existing PostGIS polygon-address and polygon-building RPCs executed successfully. Empty sample results do not establish regional coverage.
- Direct DATABASE_URL connections failed with PostgreSQL 28P01. Supabase CLI Management API access succeeded; migration 20261011210000 was applied and recorded in production on October 11. PostGIS is installed in public.
- The user confirmed Xweather permits storing historical swaths. The retrieval endpoint/data format remains unconfirmed; storage permission does not provide the export itself.

## Implemented in this change

- Automatic report discovery, location search inside Find storm, 7/30/90/year/custom filters and seven-day provider pagination with explicit partial results.
- Hail filters 25.4 / 44.45 / 63.5 mm, clearly labelled as reported observations when footprints are unavailable.
- Polygon/MultiPolygon validation, disconnected neighbourhood editing using existing Mapbox Draw, 500 ms address-count debounce, shared saved overlays and legacy context compatibility.
- Territory rename/duplicate/delete, creator/admin edit permissions, optimistic revisions and revision-aware campaign validation.
- Spatial migration: normalized event/zone metadata, source resolution, validation/licensing gates, indexed zones, verified address coverage, territory revisions and cumulative unique-address exposure RPC.
- Workspace capability gates on geometry/exposure APIs. Absent migration or disabled flags returns unavailable, never a zero exposure count.

## Gates remain closed

Migration `20261011210000_storm_intelligence_geometry.sql` is applied and recorded. It first passed a rollback dry run. The production reference table has spatial indexes. A rollback-only validation compared all three exposure counts with an independent ST_Covers query, checked missing coverage stays unavailable, checked RPC grants, and verified territory revision/snapshot recording. No temporary test records remain. See `supabase/tests/storm_intelligence_geometry_validation.sql`.

Before enabling geometry: obtain the licensed provider export contract, establish a real ingestion adapter, verify source coordinate reference system/time aggregation/resolution and source-event matching, and independently validate historical sample geometries. Point reports must never be joined into fabricated swaths.

Before enabling exposure: establish verified coverage geometries and dataset versions, validate unique source identifiers and residential classifications, independently compare counts and latency, and add aggregate caching/invalidation. Reference-table visibility alone is insufficient evidence of coverage.

Validated-zone clicking, connected-area black outlines, selected-boundary cumulative counts, and server-validated territory creation are wired. Production geometry tables now exist, but there are zero validated zones and no verified coverage records; real source ingestion remains unavailable. Outside-zone opt-in, paginated target review and exact campaign-address selection remain unimplemented. Do not enable targeting flags with the current interim implementation. Campaigns from custom report territories continue through the existing geographically bounded builder; they do not claim storm-qualified targets or new duplicate prevention.

Native applications are out of the first release. Live browser visual verification remains blocked by the browser tool security check in this session.
