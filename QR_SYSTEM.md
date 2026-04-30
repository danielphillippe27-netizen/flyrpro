# QR System — Current State & Fix Specification

## 1. Overview

The current QR system is split across multiple partially-overlapping implementations. The active web "advanced QR" path calls `POST /api/generate-qrs`, which reads campaign address rows, generates printable PNG data URLs, and writes `campaign_addresses.qr_code_base64` plus `campaign_addresses.purl` pointing at `/api/scan?id={address_id}` (`app/api/generate-qrs/route.ts:40`, `app/api/generate-qrs/route.ts:111`, `app/api/generate-qrs/route.ts:128`). That path does not write `campaign_addresses.qr_png_url`; the route has an inline comment saying `qr_png_url` was removed in favor of base64 (`app/api/generate-qrs/route.ts:131`, `app/api/generate-qrs/route.ts:133`). The address table display works because `RecipientsTable` renders `qr_code_base64` (`components/RecipientsTable.tsx:206`), but export paths are mismatched: `zip-qrs` and `vdp-manifest` both filter addresses on non-null `qr_png_url` (`app/api/zip-qrs/route.ts:61`, `app/api/zip-qrs/route.ts:65`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:70`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:80`). The modern slug handler `/api/q/[slug]` is implemented around `qr_codes` and `qr_code_scans` (`app/api/q/[slug]/route.ts:19`, `app/api/q/[slug]/route.ts:115`), but the active web generator does not create `qr_codes` rows, so slug-based exports and analytics are disconnected from the generated address QR images.

## 2. Database schema

### 2.1 campaign_addresses — QR-related columns

`qr_png_url`

- Type: `text`; added by `supabase/migrations/20251208000004_add_qr_png_url_to_campaign_addresses.sql:5`, with a comment saying it stores "URL to the QR code PNG image stored in Supabase Storage" (`supabase/migrations/20251208000004_add_qr_png_url_to_campaign_addresses.sql:14`).
- Intended/indexed usage: migration creates `idx_campaign_addresses_qr_png_url` for campaign rows where `qr_png_url IS NOT NULL` (`supabase/migrations/20251208000004_add_qr_png_url_to_campaign_addresses.sql:8`).
- Reads: `zip-qrs` filters and reads it (`app/api/zip-qrs/route.ts:65`, `app/api/zip-qrs/route.ts:90`), `vdp-manifest` selects and filters it (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:76`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:80`), editor resources checks it (`app/api/editor/projects/[id]/resources/route.ts:95`), and `RecipientsTable` conditionally renders "View QR" from it (`components/RecipientsTable.tsx:241`, `components/RecipientsTable.tsx:247`).
- Writes: `POST /api/qr/delete` clears it to `null` (`app/api/qr/delete/route.ts:67`, `app/api/qr/delete/route.ts:72`). Current `generate-qrs` does not write it and explicitly comments that it was removed (`app/api/generate-qrs/route.ts:131`, `app/api/generate-qrs/route.ts:133`).

`qr_code_base64`

- Type: `text`; added by `supabase/migrations/20251212000000_add_qr_tracking_columns.sql:5`, with a comment saying it is a base64-encoded QR image data URL (`supabase/migrations/20251212000000_add_qr_tracking_columns.sql:22`).
- TypeScript surface: `CampaignAddress.qr_code_base64?: string` and the comment says it is a "Base64-encoded QR code image (data URL format)" (`types/database.ts:129`, `types/database.ts:130`).
- Reads: `generate-qrs` selects it to decide skip/regeneration behavior (`app/api/generate-qrs/route.ts:42`, `app/api/generate-qrs/route.ts:74`), `CampaignsService.fetchAddresses()` explicitly selects it through the `campaign_addresses_geojson` view (`lib/services/CampaignsService.ts:146`, `lib/services/CampaignsService.ts:151`), the campaign page passes it to `RecipientsTable` (`app/(main)/campaigns/[campaignId]/page.tsx:910`), and `RecipientsTable` renders and downloads from it (`components/RecipientsTable.tsx:206`, `components/RecipientsTable.tsx:209`, `components/RecipientsTable.tsx:214`).
- Writes: `generate-qrs` writes it (`app/api/generate-qrs/route.ts:128`, `app/api/generate-qrs/route.ts:131`), and `POST /api/qr/delete` clears it (`app/api/qr/delete/route.ts:67`, `app/api/qr/delete/route.ts:70`).

`purl`

- Type: `text`; added by `supabase/migrations/20251212000000_add_qr_tracking_columns.sql:9`, indexed when non-null (`supabase/migrations/20251212000000_add_qr_tracking_columns.sql:16`), and commented as a tracking URL such as `/api/scan?id={address_id}` (`supabase/migrations/20251212000000_add_qr_tracking_columns.sql:23`).
- TypeScript surface: `CampaignAddress.purl?: string`, with a comment saying it is the tracking URL for scans (`types/database.ts:129`, `types/database.ts:131`).
- Reads: `generate-qrs` selects it and uses it to decide whether to skip when `forceRegenerate === false` (`app/api/generate-qrs/route.ts:42`, `app/api/generate-qrs/route.ts:75`, `app/api/generate-qrs/route.ts:76`), and `canva/generate` selects it while trying to match an existing campaign address (`app/api/canva/generate/route.ts:287`, `app/api/canva/generate/route.ts:289`).
- Writes: `generate-qrs` writes the tracking URL to it (`app/api/generate-qrs/route.ts:128`, `app/api/generate-qrs/route.ts:132`), `canva/generate` writes an encoded scan URL to it (`app/api/canva/generate/route.ts:401`, `app/api/canva/generate/route.ts:405`), and `POST /api/qr/delete` clears it (`app/api/qr/delete/route.ts:67`, `app/api/qr/delete/route.ts:71`).

`scans`

- Type/default: migration `20251211000001_create_increment_scan_rpc.sql` updates `scans = scans + 1`, which implies the column exists before that RPC (`supabase/migrations/20251211000001_create_increment_scan_rpc.sql:10`, `supabase/migrations/20251211000001_create_increment_scan_rpc.sql:12`). `CampaignAddress.scans?: number` is documented as total QR scan count (`types/database.ts:126`, `types/database.ts:127`).
- Reads: `CampaignsService.fetchAddresses()` reads it from `campaign_addresses` (`lib/services/CampaignsService.ts:157`, `lib/services/CampaignsService.ts:160`), the campaign page computes scan counts from it (`app/(main)/campaigns/[campaignId]/page.tsx:880`, `app/(main)/campaigns/[campaignId]/page.tsx:882`), and iOS docs show Swift reads `scans` from `campaign_addresses` (`docs/IOS_LOGIC_TRANSLATION.md:145`, `docs/IOS_LOGIC_TRANSLATION.md:156`).
- Writes: `/api/scan` calls the `increment_scan` RPC (`app/api/scan/route.ts:291`, `app/api/scan/route.ts:293`), and that RPC updates `scans` (`supabase/migrations/20251211000001_create_increment_scan_rpc.sql:10`, `supabase/migrations/20251211000001_create_increment_scan_rpc.sql:12`).

`last_scanned_at`

- Type/default: `increment_scan(row_id uuid)` sets `last_scanned_at = now()` (`supabase/migrations/20251211000001_create_increment_scan_rpc.sql:10`, `supabase/migrations/20251211000001_create_increment_scan_rpc.sql:13`). `CampaignAddress.last_scanned_at?: string` is documented as most recent scan timestamp (`types/database.ts:126`, `types/database.ts:128`).
- Reads: `CampaignsService.fetchAddresses()` reads it (`lib/services/CampaignsService.ts:157`, `lib/services/CampaignsService.ts:160`), the campaign page uses it for scanned recipients (`app/(main)/campaigns/[campaignId]/page.tsx:889`, `app/(main)/campaigns/[campaignId]/page.tsx:912`), and iOS docs show Swift reads it (`docs/IOS_LOGIC_TRANSLATION.md:145`, `docs/IOS_LOGIC_TRANSLATION.md:157`).
- Writes: `/api/scan` calls `increment_scan` (`app/api/scan/route.ts:291`, `app/api/scan/route.ts:293`), and the RPC updates `last_scanned_at` (`supabase/migrations/20251211000001_create_increment_scan_rpc.sql:10`, `supabase/migrations/20251211000001_create_increment_scan_rpc.sql:13`).

`visited`

- Type: `CampaignAddress.visited?: boolean` (`types/database.ts:106`, `types/database.ts:107`).
- Reads: `CampaignsService.fetchAddresses()` reads it from `campaign_addresses` (`lib/services/CampaignsService.ts:157`, `lib/services/CampaignsService.ts:160`), `/api/q/[slug]` reads `visited` to detect first scan for an address (`app/api/q/[slug]/route.ts:101`, `app/api/q/[slug]/route.ts:104`, `app/api/q/[slug]/route.ts:109`), and the campaign page uses visited state to build status and scanned fields (`app/(main)/campaigns/[campaignId]/page.tsx:908`, `app/(main)/campaigns/[campaignId]/page.tsx:912`).
- Writes: `/api/open` sets `visited: true` (`app/api/open/route.ts:16`, `app/api/open/route.ts:19`, `app/api/open/route.ts:20`). `/api/q/[slug]` does not update `visited` directly; it delegates first-scan canonical outcome work to `record_public_qr_scan_outcome` (`app/api/q/[slug]/route.ts:128`, `app/api/q/[slug]/route.ts:129`).

### 2.2 qr_codes table

No `CREATE TABLE public.qr_codes` statement exists in `supabase/schema.sql`; that file creates `campaigns`, `campaign_recipients`, `user_profiles`, storage bucket policy rows, and `crm_connections`, but not `qr_codes` (`supabase/schema.sql:1`, `supabase/schema.sql:12`, `supabase/schema.sql:26`, `supabase/schema.sql:50`, `supabase/schema.sql:67`). The selected QR migration only alters an already-existing `public.qr_codes` table by adding `destination_type` and `direct_url` (`supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:5`, `supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:7`, `supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:10`). Therefore, in this repository, the full `qr_codes` shape must be inferred from `types/database.ts` plus the altering migration, not from a complete table-creation migration.

Column list based on `types/database.ts` and migrations:

- `id`: `string` in `QRCode` (`types/database.ts:183`, `types/database.ts:185`). Read by `/api/q/[slug]` (`app/api/q/[slug]/route.ts:19`, `app/api/q/[slug]/route.ts:21`), `zip-qrs` (`app/api/zip-qrs/route.ts:75`, `app/api/zip-qrs/route.ts:77`), `vdp-manifest` (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:101`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:103`), `QRCodeService` (`lib/services/QRCodeService.ts:120`, `lib/services/QRCodeService.ts:122`), and QR delete (`app/api/qr/delete/route.ts:55`, `app/api/qr/delete/route.ts:59`).
- `address_id`: optional `string` in `QRCode` (`types/database.ts:185`, `types/database.ts:186`). Written by `QRCodeService.createQRCodeWithDestination()` (`lib/services/QRCodeService.ts:309`, `lib/services/QRCodeService.ts:319`), read by `/api/q/[slug]` (`app/api/q/[slug]/route.ts:21`, `app/api/q/[slug]/route.ts:94`), `zip-qrs` (`app/api/zip-qrs/route.ts:75`, `app/api/zip-qrs/route.ts:78`), and `vdp-manifest` (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:101`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:104`).
- `campaign_id`: optional `string` in `QRCode` (`types/database.ts:185`, `types/database.ts:187`). Written by `QRCodeService.createQRCodeWithDestination()` (`lib/services/QRCodeService.ts:309`, `lib/services/QRCodeService.ts:318`), read by `/api/q/[slug]` (`app/api/q/[slug]/route.ts:21`, `app/api/q/[slug]/route.ts:112`), `CampaignsService.fetchCampaignQRCodes()` (`lib/services/CampaignsService.ts:328`, `lib/services/CampaignsService.ts:332`), and QR delete (`app/api/qr/delete/route.ts:55`, `app/api/qr/delete/route.ts:58`).
- `farm_id`: optional `string` in `QRCode` (`types/database.ts:187`, `types/database.ts:188`). Written by the older `QRCodeService.createQRCode()` helper (`lib/services/QRCodeService.ts:83`, `lib/services/QRCodeService.ts:87`); the server `createQRCodeWithDestination()` does not write `farm_id` (`lib/services/QRCodeService.ts:309`, `lib/services/QRCodeService.ts:320`).
- `batch_id`: optional `string` in `QRCode` (`types/database.ts:188`, `types/database.ts:189`). Written by `QRCodeService.createQRCode()` (`lib/services/QRCodeService.ts:83`, `lib/services/QRCodeService.ts:89`); not written by `createQRCodeWithDestination()` (`lib/services/QRCodeService.ts:309`, `lib/services/QRCodeService.ts:320`).
- `landing_page_id`: optional `string` in `QRCode` (`types/database.ts:189`, `types/database.ts:190`). Written by `QRCodeService.createQRCodeWithDestination()` when `destination_type` is `landingPage` (`lib/services/QRCodeService.ts:314`, `lib/services/QRCodeService.ts:315`), read by `/api/q/[slug]` to fetch `campaign_landing_pages` (`app/api/q/[slug]/route.ts:35`, `app/api/q/[slug]/route.ts:45`, `app/api/q/[slug]/route.ts:48`).
- `qr_variant`: optional `'A' | 'B'` in `QRCode` (`types/database.ts:190`, `types/database.ts:191`). Written by `QRCodeService.createQRCodeWithDestination()` (`lib/services/QRCodeService.ts:317`) and `QRCodeService.createQRCode()` (`lib/services/QRCodeService.ts:91`).
- `slug`: optional `string` in `QRCode` (`types/database.ts:191`, `types/database.ts:192`). Generated by `QRCodeService.generateUniqueSlugServer()` (`lib/services/QRCodeService.ts:259`, `lib/services/QRCodeService.ts:265`) and written by `createQRCodeWithDestination()` (`lib/services/QRCodeService.ts:305`, `lib/services/QRCodeService.ts:312`). Read by `/api/q/[slug]` (`app/api/q/[slug]/route.ts:19`, `app/api/q/[slug]/route.ts:22`) and export routes (`app/api/zip-qrs/route.ts:75`, `app/api/zip-qrs/route.ts:77`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:101`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:103`).
- `qr_url`: required `string` in `QRCode` (`types/database.ts:192`, `types/database.ts:193`). `createQRCodeWithDestination()` builds it as `${NEXT_PUBLIC_APP_URL ?? 'https://flyrpro.app'}/q/${slug}` and writes it (`lib/services/QRCodeService.ts:305`, `lib/services/QRCodeService.ts:307`, `lib/services/QRCodeService.ts:313`). `zip-qrs` and `vdp-manifest` prefer it when present (`app/api/zip-qrs/route.ts:177`, `app/api/zip-qrs/route.ts:178`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:155`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:157`).
- `qr_image`: optional `string` in `QRCode` (`types/database.ts:193`, `types/database.ts:194`). Written only by the older `QRCodeService.createQRCode()` helper (`lib/services/QRCodeService.ts:83`, `lib/services/QRCodeService.ts:94`) in the searched code.
- `created_at`: `string` in `QRCode` (`types/database.ts:194`, `types/database.ts:195`).
- `updated_at`: `string` in `QRCode` (`types/database.ts:195`, `types/database.ts:196`).
- `metadata`: optional `QRCodeMetadata` (`types/database.ts:196`, `types/database.ts:197`), written by `QRCodeService.createQRCode()` (`lib/services/QRCodeService.ts:83`, `lib/services/QRCodeService.ts:95`).
- `destination_type`: optional `'landingPage' | 'directLink' | null` in `QRCode` (`types/database.ts:197`, `types/database.ts:198`), added by migration with a check constraint (`supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:7`, `supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:8`), written by `createQRCodeWithDestination()` (`lib/services/QRCodeService.ts:314`), and read by `/api/q/[slug]` (`app/api/q/[slug]/route.ts:31`, `app/api/q/[slug]/route.ts:32`).
- `direct_url`: optional `string | null` in `QRCode` (`types/database.ts:198`, `types/database.ts:199`), added by migration (`supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:10`, `supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:11`), written by `createQRCodeWithDestination()` for `directLink` destinations (`lib/services/QRCodeService.ts:316`), and used by `/api/q/[slug]` for direct redirects (`app/api/q/[slug]/route.ts:72`, `app/api/q/[slug]/route.ts:74`, `app/api/q/[slug]/route.ts:80`).

### 2.3 qr_code_scans table

`qr_code_scans` is created by `supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:21`. Columns are:

- `id uuid primary key default gen_random_uuid()` (`supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:21`, `supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:22`).
- `qr_code_id uuid references public.qr_codes(id) on delete cascade` (`supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:23`). `/api/q/[slug]` writes it (`app/api/q/[slug]/route.ts:115`, `app/api/q/[slug]/route.ts:118`); `QRCodeService` counts by it (`lib/services/QRCodeService.ts:337`, `lib/services/QRCodeService.ts:340`).
- `address_id uuid references public.campaign_addresses(id) on delete set null` (`supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:24`). `/api/q/[slug]` writes it (`app/api/q/[slug]/route.ts:115`, `app/api/q/[slug]/route.ts:119`), and the iOS helper RPCs count by it (`supabase/migrations/20260307000000_ios_schema_alignment.sql:127`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:130`).
- `scanned_at timestamptz not null default now()` (`supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:25`). `/api/q/[slug]` writes an explicit timestamp (`app/api/q/[slug]/route.ts:115`, `app/api/q/[slug]/route.ts:123`).
- `device_info text`, `user_agent text`, `ip_address inet`, `referrer text` (`supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:26`, `supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:29`). `/api/q/[slug]` writes `user_agent`, `ip_address`, and `referrer` (`app/api/q/[slug]/route.ts:96`, `app/api/q/[slug]/route.ts:120`, `app/api/q/[slug]/route.ts:121`, `app/api/q/[slug]/route.ts:122`).

Indexes exist for `qr_code_id`, `(qr_code_id, scanned_at desc)`, and `address_id` (`supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:34`, `supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:38`, `supabase/migrations/20251205221730_enhance_qr_codes_and_scans.sql:42`). `/api/q/[slug]` is the only API route found that writes this table (`app/api/q/[slug]/route.ts:115`). `QRCodeService.getScanCountForQRCode()` and `QRCodeService.fetchQRCodesWithScanStatusForCampaign()` read it (`lib/services/QRCodeService.ts:337`, `lib/services/QRCodeService.ts:338`, `lib/services/QRCodeService.ts:373`, `lib/services/QRCodeService.ts:374`).

### 2.4 scan_events table

`scan_events` is created in `supabase/migrations/20251214000000_create_map_buildings_schema.sql:55`. Columns are:

- `id uuid primary key default gen_random_uuid()` (`supabase/migrations/20251214000000_create_map_buildings_schema.sql:55`, `supabase/migrations/20251214000000_create_map_buildings_schema.sql:56`).
- `building_id uuid references public.map_buildings(id) on delete cascade` (`supabase/migrations/20251214000000_create_map_buildings_schema.sql:57`).
- `campaign_id uuid references public.campaigns(id) on delete set null` (`supabase/migrations/20251214000000_create_map_buildings_schema.sql:58`).
- `scanned_at timestamptz default now() not null` (`supabase/migrations/20251214000000_create_map_buildings_schema.sql:59`).
- `qr_id text` (`supabase/migrations/20251214000000_create_map_buildings_schema.sql:60`).
- `qr_code_id uuid references public.qr_codes(id) on delete set null` (`supabase/migrations/20251214000000_create_map_buildings_schema.sql:61`).
- `address_id uuid references public.campaign_addresses(id) on delete set null` (`supabase/migrations/20251214000000_create_map_buildings_schema.sql:62`).

The migration enables RLS on `scan_events` and adds a select policy for authenticated users (`supabase/migrations/20251214000000_create_map_buildings_schema.sql:300`, `supabase/migrations/20251214000000_create_map_buildings_schema.sql:315`, `supabase/migrations/20251214000000_create_map_buildings_schema.sql:317`). It also creates a trigger from `qr_code_scans` into `scan_events` (`supabase/migrations/20251214000000_create_map_buildings_schema.sql:114`, `supabase/migrations/20251214000000_create_map_buildings_schema.sql:173`, `supabase/migrations/20251214000000_create_map_buildings_schema.sql:176`) and a trigger to update `building_stats` on scan event insert (`supabase/migrations/20251214000000_create_map_buildings_schema.sql:70`, `supabase/migrations/20251214000000_create_map_buildings_schema.sql:108`).

The earlier cleanup migration drops `scan_events`, but the later map-buildings migration recreates it (`supabase/migrations/20250131000020_cleanup_redundant_tables.sql:14`, `supabase/migrations/20251214000000_create_map_buildings_schema.sql:55`). This table is iOS-coupled in documentation: iOS implementation docs list `scan_events` as a table with `qr_code_id` referencing `qr_codes` (`docs/IOS_IMPLEMENTATION_GUIDE.md:138`, `docs/IOS_IMPLEMENTATION_GUIDE.md:146`), and the iOS data-flow diagram includes `scan_events` among backend data entities (`docs/IOS_DATA_FLOW_DIAGRAM.md:139`).

Writes: `/api/scan` inserts basic campaign-level rows with `campaign_id`, null `address_id`, null `building_id`, and `scanned_at` (`app/api/scan/route.ts:152`, `app/api/scan/route.ts:162`, `app/api/scan/route.ts:163`, `app/api/scan/route.ts:166`), and address scans with `building_id`, `campaign_id`, `address_id`, and `scanned_at` (`app/api/scan/route.ts:234`, `app/api/scan/route.ts:236`, `app/api/scan/route.ts:239`, `app/api/scan/route.ts:242`). Reads include campaign page count (`app/(main)/campaigns/[campaignId]/page.tsx:423`, `app/(main)/campaigns/[campaignId]/page.tsx:426`), farm page linked campaign count (`app/farms/[id]/page.tsx:339`, `app/farms/[id]/page.tsx:345`), home dashboard weekly and latest scan queries (`app/api/home/dashboard/route.ts:392`, `app/api/home/dashboard/route.ts:400`, `app/api/home/dashboard/route.ts:405`), and map realtime subscription (`components/map/MapBuildingsLayer.tsx:1446`, `components/map/MapBuildingsLayer.tsx:1460`).

### 2.5 qr_scan_events table

`qr_scan_events` is not created in the selected migrations or `supabase/schema.sql`. The cleanup migration explicitly drops `public.qr_scan_events` (`supabase/migrations/20250131000020_cleanup_redundant_tables.sql:6`, `supabase/migrations/20250131000020_cleanup_redundant_tables.sql:8`, `supabase/migrations/20250131000020_cleanup_redundant_tables.sql:15`). Despite that, legacy code still references it: `QRCodeService.fetchAnalytics()` queries `qr_scan_events` (`lib/services/QRCodeService.ts:195`, `lib/services/QRCodeService.ts:197`, `lib/services/QRCodeService.ts:205`), and `ExperimentsService.recordScan()` inserts into it (`lib/services/ExperimentsService.ts:61`, `lib/services/ExperimentsService.ts:63`, `lib/services/ExperimentsService.ts:64`). `types/database.ts` still contains a `QRScanEvent` interface (`types/database.ts:556`, `types/database.ts:564`). Based on the provided source, any path that relies on `qr_scan_events` is schema-inconsistent unless an out-of-repo production object exists.

## 3. Generation systems

### 3.1 System A — Web (generate-qrs)

Step-by-step behavior:

1. The route reads JSON body fields `campaignId`, `trackable`, `baseUrl`, and `forceRegenerate` (`app/api/generate-qrs/route.ts:20`, `app/api/generate-qrs/route.ts:21`). `trackable` is read into `trackableParam` but not used after destructuring (`app/api/generate-qrs/route.ts:21`).
2. It requires `campaignId`; missing `campaignId` returns 400 (`app/api/generate-qrs/route.ts:26`, `app/api/generate-qrs/route.ts:28`).
3. It uses the Supabase admin client (`app/api/generate-qrs/route.ts:31`, `app/api/generate-qrs/route.ts:32`).
4. It fetches all `campaign_addresses` for the campaign, selecting `id`, `qr_code_base64`, `purl`, `address`, `formatted`, `house_number`, and `street_name` (`app/api/generate-qrs/route.ts:39`, `app/api/generate-qrs/route.ts:42`, `app/api/generate-qrs/route.ts:43`).
5. It returns success with count `0` if no addresses exist (`app/api/generate-qrs/route.ts:60`, `app/api/generate-qrs/route.ts:65`).
6. It regenerates all addresses by default because `shouldRegenerateAll = forceRegenerate !== false` (`app/api/generate-qrs/route.ts:68`, `app/api/generate-qrs/route.ts:70`). If `forceRegenerate === false`, it only processes rows missing `qr_code_base64`, missing `purl`, or whose `purl` is localhost (`app/api/generate-qrs/route.ts:71`, `app/api/generate-qrs/route.ts:76`).
7. It chooses a QR domain from non-local `baseUrl`, then `NEXT_PUBLIC_APP_URL`, then request origin, then `https://flyrpro.vercel.app` (`app/api/generate-qrs/route.ts:94`, `app/api/generate-qrs/route.ts:101`).
8. For each address, it formats an address label and slug-like `addr` tag (`app/api/generate-qrs/route.ts:107`, `app/api/generate-qrs/route.ts:108`).
9. It constructs a tracking URL as `new URL('/api/scan', domain)`, sets `id` to the address id, and optionally sets `addr` to the address tag (`app/api/generate-qrs/route.ts:110`, `app/api/generate-qrs/route.ts:111`, `app/api/generate-qrs/route.ts:112`, `app/api/generate-qrs/route.ts:114`). The encoded QR URL format is therefore `{domain}/api/scan?id={address_id}&addr={address-tag}` (`app/api/generate-qrs/route.ts:111`, `app/api/generate-qrs/route.ts:112`, `app/api/generate-qrs/route.ts:114`, `app/api/generate-qrs/route.ts:116`).
10. It generates a base QR PNG with the `qrcode` package via `QRCode.toBuffer(trackingUrl, { type: 'image/png', width: 512, margin: 2 })` (`app/api/generate-qrs/route.ts:2`, `app/api/generate-qrs/route.ts:119`, `app/api/generate-qrs/route.ts:123`).
11. It passes the QR buffer through `createPrintableQrPng()` to add a printable center label (`app/api/generate-qrs/route.ts:4`, `app/api/generate-qrs/route.ts:124`). `createPrintableQrPng()` normalizes to 512px, builds a center overlay, composites it with Sharp, and returns a PNG buffer (`lib/utils/qr-print.ts:159`, `lib/utils/qr-print.ts:161`, `lib/utils/qr-print.ts:166`, `lib/utils/qr-print.ts:168`).
12. It converts the printable PNG to a data URL: `data:image/png;base64,...` (`app/api/generate-qrs/route.ts:125`).
13. It writes `qr_code_base64` and `purl` back to `campaign_addresses` where `id` equals the address id (`app/api/generate-qrs/route.ts:127`, `app/api/generate-qrs/route.ts:131`, `app/api/generate-qrs/route.ts:132`, `app/api/generate-qrs/route.ts:135`).
14. It does not write `qr_png_url`; the inline comment says "`Removed qr_png_url - using base64 instead`" (`app/api/generate-qrs/route.ts:131`, `app/api/generate-qrs/route.ts:133`).
15. It does not insert `qr_codes` rows; the only Supabase update in the loop targets `campaign_addresses` (`app/api/generate-qrs/route.ts:128`, `app/api/generate-qrs/route.ts:129`).
16. If one address fails, the route logs the error and continues (`app/api/generate-qrs/route.ts:137`, `app/api/generate-qrs/route.ts:145`).

Callers:

- The campaign page calls `/api/generate-qrs` with `campaignId`, `trackable`, `baseUrl`, and `forceRegenerate: true` (`app/(main)/campaigns/[campaignId]/page.tsx:592`, `app/(main)/campaigns/[campaignId]/page.tsx:595`, `app/(main)/campaigns/[campaignId]/page.tsx:599`, `app/(main)/campaigns/[campaignId]/page.tsx:603`).
- After `generate-qrs` succeeds, the campaign page also builds Canva rows from current addresses and calls `/api/canva/generate` (`app/(main)/campaigns/[campaignId]/page.tsx:619`, `app/(main)/campaigns/[campaignId]/page.tsx:631`, `app/(main)/campaigns/[campaignId]/page.tsx:635`, `app/(main)/campaigns/[campaignId]/page.tsx:638`).
- The farm page calls `/api/generate-qrs` with the linked campaign id, `trackable: true`, `baseUrl`, and `forceRegenerate: true` (`app/farms/[id]/page.tsx:1104`, `app/farms/[id]/page.tsx:1114`, `app/farms/[id]/page.tsx:1118`, `app/farms/[id]/page.tsx:1122`).
- After farm advanced QR generation succeeds, the farm page also calls `/api/canva/generate` with rows derived from linked campaign addresses (`app/farms/[id]/page.tsx:1139`, `app/farms/[id]/page.tsx:1149`, `app/farms/[id]/page.tsx:1153`, `app/farms/[id]/page.tsx:1156`).

### 3.2 System B — iOS (direct Supabase writes)

This repository does not contain Swift source; `docs/IOS_GERS_ID_FIX_CHECKLIST.md` explicitly says "No Swift source; this checklist is for the separate iOS app repo" (`docs/IOS_GERS_ID_FIX_CHECKLIST.md:72`, `docs/IOS_GERS_ID_FIX_CHECKLIST.md:75`). Therefore this repository cannot prove which Swift files generate QR codes or whether iOS directly writes `qr_codes`.

What this repository does prove about iOS QR coupling:

- iOS docs show Swift reads `campaign_addresses` fields including `scans`, `last_scanned_at`, and `qr_code_base64` (`docs/IOS_LOGIC_TRANSLATION.md:145`, `docs/IOS_LOGIC_TRANSLATION.md:158`).
- iOS docs compute QR status as `hasFlyer: !!(addressData.qr_code_base64 || addressData.scans > 0)`, `totalScans: addressData.scans || 0`, and `lastScannedAt` from `last_scanned_at` (`docs/IOS_LOGIC_TRANSLATION.md:76`, `docs/IOS_LOGIC_TRANSLATION.md:81`).
- iOS QR scan docs call `GET /api/billing/entitlement` with a Supabase bearer token to decide whether a user can see scan data (`docs/IOS_QR_SCANS_PRO.md:7`, `docs/IOS_QR_SCANS_PRO.md:10`, `docs/IOS_QR_SCANS_PRO.md:22`, `docs/IOS_QR_SCANS_PRO.md:24`).
- iOS QR scan docs call `GET /api/buildings/[gersId]?campaign_id=<uuid>` with bearer auth for building scan data (`docs/IOS_QR_SCANS_PRO.md:32`, `docs/IOS_QR_SCANS_PRO.md:35`, `docs/IOS_QR_SCANS_PRO.md:51`, `docs/IOS_QR_SCANS_PRO.md:57`).
- The platform parity doc describes printed QR scans as opening a short URL like `flyrpro.app/q/xxx`, and says the backend records the scan (`docs/PLATFORM_FEATURE_PARITY.md:7`, `docs/PLATFORM_FEATURE_PARITY.md:8`).
- The iOS schema alignment migration creates `get_address_scan_count()` and `get_campaign_scan_count()` RPCs that count rows from `qr_code_scans` (`supabase/migrations/20260307000000_ios_schema_alignment.sql:118`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:129`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:135`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:146`).

Unknown from this repo:

- The Swift file names involved in QR generation are not present in this repository (`docs/IOS_GERS_ID_FIX_CHECKLIST.md:75`).
- The exact iOS-generated QR URL format is not proven by Swift source here; the only repo evidence for a short QR URL is the documentation example `flyrpro.app/q/xxx` (`docs/PLATFORM_FEATURE_PARITY.md:7`, `docs/PLATFORM_FEATURE_PARITY.md:8`).
- The exact iOS write payload into `qr_codes` is not present in this repository. Any fix must preserve `qr_codes`, `qr_code_scans`, `campaign_addresses.qr_code_base64`, `campaign_addresses.scans`, and `campaign_addresses.last_scanned_at` because repo docs and migrations prove iOS reads/counts those surfaces (`docs/IOS_LOGIC_TRANSLATION.md:145`, `docs/IOS_LOGIC_TRANSLATION.md:158`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:120`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:146`).

### 3.3 System C — Canva-style (generate-basic-qr + canva/generate)

`POST /api/campaigns/[campaignId]/generate-basic-qr`

- Reads `campaignId` from path params and optional `baseUrl` from the JSON body (`app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:14`, `app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:20`, `app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:21`).
- Checks that the campaign exists by querying `campaigns` for `id` (`app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:32`, `app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:34`, `app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:36`).
- Encodes one campaign-level tracking URL: `{safeBaseUrl}/api/scan?campaignId={campaignId}&basic=true` (`app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:43`).
- Generates a 512px PNG data URL with `QRCode.toDataURL()` (`app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:45`, `app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:49`) and returns `{ qrBase64, trackingUrl }` (`app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:51`).
- The farm page calls it and downloads the returned PNG (`app/farms/[id]/page.tsx:1062`, `app/farms/[id]/page.tsx:1069`, `app/farms/[id]/page.tsx:1080`, `app/farms/[id]/page.tsx:1086`). The campaign page also calls it (`app/(main)/campaigns/[campaignId]/page.tsx:721`).

`POST /api/canva/generate`

- The route declares that it generates QR codes for Canva Bulk Create, uploads to S3, persists to DB, and returns a downloadable CSV with `ImageURL` (`app/api/canva/generate/route.ts:1`, `app/api/canva/generate/route.ts:6`, `app/api/canva/generate/route.ts:22`).
- It resolves scan base URLs to `/api/scan` if the supplied base URL lacks a path, or falls back to `NEXT_PUBLIC_APP_URL/api/scan` or request-origin `/api/scan` (`app/api/canva/generate/route.ts:54`, `app/api/canva/generate/route.ts:63`, `app/api/canva/generate/route.ts:70`, `app/api/canva/generate/route.ts:73`).
- For each row, it looks up an existing address in `campaign_addresses_geojson` by formatted/address matches (`app/api/canva/generate/route.ts:286`, `app/api/canva/generate/route.ts:289`, `app/api/canva/generate/route.ts:291`), then by house/street (`app/api/canva/generate/route.ts:299`, `app/api/canva/generate/route.ts:305`, `app/api/canva/generate/route.ts:309`), then by postal/house (`app/api/canva/generate/route.ts:318`, `app/api/canva/generate/route.ts:321`, `app/api/canva/generate/route.ts:325`).
- It builds an encoded scan URL by starting from `baseUrl`, then setting `id`, `campaignId`, and `address` query params (`app/api/canva/generate/route.ts:381`, `app/api/canva/generate/route.ts:383`, `app/api/canva/generate/route.ts:384`, `app/api/canva/generate/route.ts:385`).
- It generates a printable QR PNG with `QRCode.toBuffer()` and `createPrintableQrPng()` (`app/api/canva/generate/route.ts:197`, `app/api/canva/generate/route.ts:198`, `app/api/canva/generate/route.ts:207`).
- It uploads QR PNG bytes to S3 and builds public S3 URLs (`app/api/canva/generate/route.ts:213`, `app/api/canva/generate/route.ts:228`, `app/api/canva/generate/route.ts:239`).
- It writes only `campaign_addresses.purl` for the matched address; it does not write `qr_png_url` despite producing an S3 public URL (`app/api/canva/generate/route.ts:398`, `app/api/canva/generate/route.ts:401`, `app/api/canva/generate/route.ts:405`, `app/api/canva/generate/route.ts:407`).
- It returns a ZIP containing a Canva CSV, a `qr-images` folder, and a README (`app/api/canva/generate/route.ts:768`, `app/api/canva/generate/route.ts:774`, `app/api/canva/generate/route.ts:777`, `app/api/canva/generate/route.ts:785`, `app/api/canva/generate/route.ts:794`).

These are different systems: `generate-basic-qr` returns one campaign-level QR image encoded to `/api/scan?campaignId=...&basic=true` (`app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:43`, `app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:51`), while `canva/generate` generates per-row address QRs encoded to `/api/scan` with address/campaign parameters and returns a ZIP package (`app/api/canva/generate/route.ts:381`, `app/api/canva/generate/route.ts:385`, `app/api/canva/generate/route.ts:794`).

### 3.4 QRCodeService.createQRCodeWithDestination()

- This method is a server-side helper requiring a passed Supabase client (`lib/services/QRCodeService.ts:279`, `lib/services/QRCodeService.ts:284`, `lib/services/QRCodeService.ts:285`).
- It accepts `campaignId`, `addressId`, `destinationType`, `landingPageId`, `directUrl`, and `qrVariant` (`lib/services/QRCodeService.ts:289`, `lib/services/QRCodeService.ts:296`).
- It throws if `destinationType === 'landingPage'` without `landingPageId`, or `destinationType === 'directLink'` without `directUrl` (`lib/services/QRCodeService.ts:298`, `lib/services/QRCodeService.ts:302`).
- It generates a unique slug using `generateUniqueSlugServer()` (`lib/services/QRCodeService.ts:305`), and that helper checks `qr_codes` for slug collisions (`lib/services/QRCodeService.ts:259`, `lib/services/QRCodeService.ts:267`, `lib/services/QRCodeService.ts:269`).
- It builds `qr_url` as `${NEXT_PUBLIC_APP_URL ?? 'https://flyrpro.app'}/q/${slug}` (`lib/services/QRCodeService.ts:306`, `lib/services/QRCodeService.ts:307`).
- It inserts into `qr_codes` the columns `slug`, `qr_url`, `destination_type`, `landing_page_id`, `direct_url`, `qr_variant`, `campaign_id`, and `address_id` (`lib/services/QRCodeService.ts:309`, `lib/services/QRCodeService.ts:320`).
- It is currently called by `POST /api/qr/create` only in the searched generation code (`app/api/qr/create/route.ts:59`, `app/api/qr/create/route.ts:69`). Search results show `QRCodeService.createQRCodeWithDestination()` is not called from `generate-qrs` or `canva/generate`; `/api/generate-qrs` contains only a `campaign_addresses` update (`app/api/generate-qrs/route.ts:128`, `app/api/generate-qrs/route.ts:135`).
- To wire it into System A, `generate-qrs` would need to call it for each address with `campaignId`, `addressId`, `destinationType: 'directLink'`, and `directUrl` set to the same `/api/scan?id={address_id}` tracking URL if the QR image URL format is kept unchanged (`app/api/generate-qrs/route.ts:111`, `app/api/generate-qrs/route.ts:116`, `lib/services/QRCodeService.ts:301`, `lib/services/QRCodeService.ts:316`).

## 4. Scan tracking systems

### 4.1 /api/scan (System A handler)

Request parameters:

- `/api/scan` reads `id`, `campaignId`, `basic`, `address`/`AddressLine`, `city`/`City`, `province`/`Province`, and `postalCode`/`PostalCode` (`app/api/scan/route.ts:5`, `app/api/scan/route.ts:14`).
- It initializes `addressId` from the raw `id` parameter (`app/api/scan/route.ts:26`, `app/api/scan/route.ts:27`).

Address resolution strategies for Canva-style scans:

1. Direct address id: `addressId` starts as `searchParams.get('id')`, so any URL with `?id=` bypasses the Canva string matching (`app/api/scan/route.ts:8`, `app/api/scan/route.ts:27`, `app/api/scan/route.ts:31`).
2. Strategy 1, exact-ish address/formatted match: when no id but `campaignId` and `addressLine` exist, it queries `campaign_addresses_geojson` for the campaign and `address.ilike`/`formatted.ilike` of the street part, then prefers a full normalized exact match (`app/api/scan/route.ts:31`, `app/api/scan/route.ts:45`, `app/api/scan/route.ts:54`, `app/api/scan/route.ts:63`).
3. Strategy 2, contains full normalized string: it searches `address` or `formatted` containing the normalized full address line and scores candidates using exact/contains/city/postal matches (`app/api/scan/route.ts:67`, `app/api/scan/route.ts:70`, `app/api/scan/route.ts:72`, `app/api/scan/route.ts:83`).
4. Strategy 3, street-only match: it searches `address` or `formatted` containing the street part, preferring rows whose address/formatted starts with that street part (`app/api/scan/route.ts:88`, `app/api/scan/route.ts:91`, `app/api/scan/route.ts:93`, `app/api/scan/route.ts:99`).
5. Strategy 4, house number plus postal code: it extracts the leading house number and searches `house_number` plus `postal_code` (`app/api/scan/route.ts:104`, `app/api/scan/route.ts:106`, `app/api/scan/route.ts:108`, `app/api/scan/route.ts:112`).
6. Strategy 5, last-resort in-memory scan: it loads up to 500 campaign addresses and matches street part or postal/house in JavaScript (`app/api/scan/route.ts:118`, `app/api/scan/route.ts:120`, `app/api/scan/route.ts:124`, `app/api/scan/route.ts:133`, `app/api/scan/route.ts:138`).

Tracking behavior:

- Basic campaign-level QR: if no address is resolved and `campaignId` plus `basic=true` are present, the route loads the campaign, inserts a `scan_events` row with `campaign_id`, `address_id: null`, `building_id: null`, and `scanned_at`, increments `campaigns.scans`, and redirects to `campaign.video_url` or app origin (`app/api/scan/route.ts:152`, `app/api/scan/route.ts:162`, `app/api/scan/route.ts:173`, `app/api/scan/route.ts:177`, `app/api/scan/route.ts:178`).
- Address scan: after resolving an address, it reads `campaign_addresses_geojson` for `id`, `campaign_id`, `address`, and `formatted` (`app/api/scan/route.ts:195`, `app/api/scan/route.ts:198`, `app/api/scan/route.ts:199`).
- It attempts to find a building through `building_address_links` joined to `buildings` (`app/api/scan/route.ts:210`, `app/api/scan/route.ts:216`, `app/api/scan/route.ts:217`, `app/api/scan/route.ts:223`).
- It inserts a `scan_events` row with `building_id`, `campaign_id`, `address_id`, and `scanned_at` (`app/api/scan/route.ts:234`, `app/api/scan/route.ts:237`, `app/api/scan/route.ts:239`, `app/api/scan/route.ts:242`).
- It calls `increment_building_scans(p_gers_id, p_campaign_id)` when a building GERS id exists, with a direct `building_stats` upsert fallback if the RPC fails (`app/api/scan/route.ts:254`, `app/api/scan/route.ts:257`, `app/api/scan/route.ts:266`, `app/api/scan/route.ts:278`).
- It calls `increment_scan(row_id: addressId)` to update legacy per-address scan counters (`app/api/scan/route.ts:291`, `app/api/scan/route.ts:293`, `app/api/scan/route.ts:294`). The RPC increments `campaign_addresses.scans` and updates `last_scanned_at` (`supabase/migrations/20251211000001_create_increment_scan_rpc.sql:4`, `supabase/migrations/20251211000001_create_increment_scan_rpc.sql:13`).
- It does not write `qr_code_scans`; the file contains no `.from('qr_code_scans')` call, while the actual scan inserts target `scan_events` (`app/api/scan/route.ts:162`, `app/api/scan/route.ts:237`).
- It redirects to `campaign.video_url` if present, otherwise to `NEXT_PUBLIC_APP_URL` or request origin (`app/api/scan/route.ts:306`, `app/api/scan/route.ts:318`, `app/api/scan/route.ts:323`, `app/api/scan/route.ts:325`). On unresolved address and no campaign URL, it redirects to the same fallback without tracking (`app/api/scan/route.ts:182`, `app/api/scan/route.ts:192`).

### 4.2 /api/q/[slug] (System B handler)

- The route receives `slug` from path params and returns 400 if missing (`app/api/q/[slug]/route.ts:4`, `app/api/q/[slug]/route.ts:9`, `app/api/q/[slug]/route.ts:11`).
- It uses the admin client because it is a public redirect route (`app/api/q/[slug]/route.ts:15`, `app/api/q/[slug]/route.ts:16`).
- It looks up `qr_codes` by `slug`, selecting `id`, `slug`, `destination_type`, `direct_url`, `landing_page_id`, `address_id`, and `campaign_id` (`app/api/q/[slug]/route.ts:18`, `app/api/q/[slug]/route.ts:21`, `app/api/q/[slug]/route.ts:22`).
- Destination type `landingPage`: it requires `landing_page_id`, fetches `campaign_landing_pages(id, slug)`, and redirects to `${NEXT_PUBLIC_APP_URL || 'https://flyrpro.app'}/l/{landingPage.slug}` (`app/api/q/[slug]/route.ts:35`, `app/api/q/[slug]/route.ts:45`, `app/api/q/[slug]/route.ts:58`, `app/api/q/[slug]/route.ts:59`).
- Destination type `directLink`: it requires `direct_url` and redirects to it (`app/api/q/[slug]/route.ts:72`, `app/api/q/[slug]/route.ts:74`, `app/api/q/[slug]/route.ts:80`).
- It returns 500 for invalid/missing destination data (`app/api/q/[slug]/route.ts:81`, `app/api/q/[slug]/route.ts:84`).
- Bot detection uses a user-agent regex matching bots, crawlers, preview scanners, mail/email clients, social link preview bots, and major search bots (`app/api/q/[slug]/route.ts:88`, `app/api/q/[slug]/route.ts:90`).
- If not a bot and `address_id` exists, it reads forwarded IP/referrer headers, reads `campaign_addresses(visited, campaign_id)`, determines first scan from `!address.visited`, and inserts into `qr_code_scans` (`app/api/q/[slug]/route.ts:92`, `app/api/q/[slug]/route.ts:101`, `app/api/q/[slug]/route.ts:109`, `app/api/q/[slug]/route.ts:115`).
- The `qr_code_scans` insert writes `qr_code_id`, `address_id`, `user_agent`, `ip_address`, `referrer`, and `scanned_at` (`app/api/q/[slug]/route.ts:115`, `app/api/q/[slug]/route.ts:124`).
- On first scan, it calls `record_public_qr_scan_outcome` with the address id, status `delivered`, notes `public qr scan`, and timestamp (`app/api/q/[slug]/route.ts:128`, `app/api/q/[slug]/route.ts:134`). That RPC loads the campaign and owner for the address, impersonates the owner via JWT claims, and delegates to `record_campaign_address_outcome` (`supabase/migrations/20260325134500_record_public_qr_scan_outcome.sql:21`, `supabase/migrations/20260325134500_record_public_qr_scan_outcome.sql:39`, `supabase/migrations/20260325134500_record_public_qr_scan_outcome.sql:42`, `supabase/migrations/20260325134500_record_public_qr_scan_outcome.sql:48`).
- On first scan, it also increments `campaigns.scans` by reading current `scans` and updating the campaign (`app/api/q/[slug]/route.ts:141`, `app/api/q/[slug]/route.ts:145`, `app/api/q/[slug]/route.ts:149`, `app/api/q/[slug]/route.ts:152`).
- It redirects to the computed destination whether scan recording succeeds or fails (`app/api/q/[slug]/route.ts:156`, `app/api/q/[slug]/route.ts:158`, `app/api/q/[slug]/route.ts:165`, `app/api/q/[slug]/route.ts:166`).

### 4.3 /api/open (legacy handler)

- `/api/open` supports both `addressId` and legacy `id` query parameters (`app/api/open/route.ts:6`, `app/api/open/route.ts:8`).
- If no id is present, it redirects to `/thank-you` (`app/api/open/route.ts:10`, `app/api/open/route.ts:11`).
- It sets `campaign_addresses.visited = true` for the address (`app/api/open/route.ts:16`, `app/api/open/route.ts:20`, `app/api/open/route.ts:22`).
- It then reads the address campaign id, fetches `campaigns.destination_url`, redirects to that URL if present, and otherwise redirects to `/thank-you` (`app/api/open/route.ts:28`, `app/api/open/route.ts:31`, `app/api/open/route.ts:36`, `app/api/open/route.ts:43`, `app/api/open/route.ts:47`).
- It is not safe to remove based only on source evidence because `zip-qrs` and `vdp-manifest` still use `/api/open?addressId={address.id}` as a fallback QR URL when no `qr_codes` slug is found (`app/api/zip-qrs/route.ts:181`, `app/api/zip-qrs/route.ts:182`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:161`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:163`).

### 4.4 Analytics — what reads scan data

- Campaign page scan counts: `loadData()` queries `scan_events` with `count: 'exact'` for the campaign (`app/(main)/campaigns/[campaignId]/page.tsx:419`, `app/(main)/campaigns/[campaignId]/page.tsx:423`, `app/(main)/campaigns/[campaignId]/page.tsx:426`) and also computes fallback scan totals from `campaign_addresses.scans` and `campaign.scans` (`app/(main)/campaigns/[campaignId]/page.tsx:880`, `app/(main)/campaigns/[campaignId]/page.tsx:885`).
- Farm linked campaign scan counts: the farm page queries `scan_events` by linked campaign id (`app/farms/[id]/page.tsx:339`, `app/farms/[id]/page.tsx:343`, `app/farms/[id]/page.tsx:345`).
- QR analytics view/API: `/api/qr/analytics` calls `QRCodeService.fetchQRCodesWithScanStatusForCampaign()` for a campaign or `QRCodeService.getScanCountForQRCode()` for specific QR ids (`app/api/qr/analytics/route.ts:18`, `app/api/qr/analytics/route.ts:23`, `app/api/qr/analytics/route.ts:32`). Those service methods read `qr_codes` and `qr_code_scans` (`lib/services/QRCodeService.ts:358`, `lib/services/QRCodeService.ts:360`, `lib/services/QRCodeService.ts:373`, `lib/services/QRCodeService.ts:374`).
- Building heat map/realtime: `MapBuildingsLayer` subscribes to `scan_events` inserts and sets the building feature state to visited/QR scanned (`components/map/MapBuildingsLayer.tsx:1446`, `components/map/MapBuildingsLayer.tsx:1460`, `components/map/MapBuildingsLayer.tsx:1482`, `components/map/MapBuildingsLayer.tsx:1486`).
- Home dashboard/team-adjacent stats: `app/api/home/dashboard` reads `scan_events` for weekly QR scan count and latest scan time (`app/api/home/dashboard/route.ts:392`, `app/api/home/dashboard/route.ts:400`, `app/api/home/dashboard/route.ts:405`, `app/api/home/dashboard/route.ts:417`).
- Legacy experiment analytics: `ExperimentsService` writes and reads `qr_scan_events` (`lib/services/ExperimentsService.ts:61`, `lib/services/ExperimentsService.ts:63`, `lib/services/ExperimentsService.ts:87`, `lib/services/ExperimentsService.ts:94`), but the cleanup migration drops that table (`supabase/migrations/20250131000020_cleanup_redundant_tables.sql:14`, `supabase/migrations/20250131000020_cleanup_redundant_tables.sql:15`).

## 5. Export and display systems

### 5.1 /api/zip-qrs

- Auth and entitlement: the route requires `campaignId` query param (`app/api/zip-qrs/route.ts:12`, `app/api/zip-qrs/route.ts:16`), requires an authenticated Supabase user (`app/api/zip-qrs/route.ts:39`, `app/api/zip-qrs/route.ts:41`), and returns 402 when `canUsePro(entitlement)` is false (`app/api/zip-qrs/route.ts:44`, `app/api/zip-qrs/route.ts:48`).
- Campaign metadata: it fetches the campaign via `CampaignsService.fetchCampaign()` and 404s if missing (`app/api/zip-qrs/route.ts:54`, `app/api/zip-qrs/route.ts:57`).
- Buggy filter: it fetches `campaign_addresses` for the campaign where `qr_png_url IS NOT NULL` (`app/api/zip-qrs/route.ts:60`, `app/api/zip-qrs/route.ts:65`). Current `generate-qrs` writes `qr_code_base64` and `purl`, not `qr_png_url` (`app/api/generate-qrs/route.ts:131`, `app/api/generate-qrs/route.ts:133`).
- Current user-visible broken state: if no rows pass the `qr_png_url` filter, the API returns `404` JSON `{ error: 'No QR codes found' }` (`app/api/zip-qrs/route.ts:69`, `app/api/zip-qrs/route.ts:70`).
- What it expects in `qr_png_url`: it parses the value as a URL, extracts the path segment after `/storage/v1/object/public/qr/`, and downloads that file from Supabase Storage bucket `qr` (`app/api/zip-qrs/route.ts:89`, `app/api/zip-qrs/route.ts:91`, `app/api/zip-qrs/route.ts:94`, `app/api/zip-qrs/route.ts:95`).
- ZIP contents: it adds individual QR PNG files to the ZIP (`app/api/zip-qrs/route.ts:103`, `app/api/zip-qrs/route.ts:106`), adds `vdp-manifest.csv` (`app/api/zip-qrs/route.ts:208`, `app/api/zip-qrs/route.ts:209`), adds `README.txt` (`app/api/zip-qrs/route.ts:211`, `app/api/zip-qrs/route.ts:241`), and returns `application/zip` (`app/api/zip-qrs/route.ts:243`, `app/api/zip-qrs/route.ts:247`).
- CSV manifest columns are `reference_id`, `address_line`, `city`, `region`, `postal_code`, `qr_url`, `campaign_id`, `campaign_name`, and `print_quantity` (`app/api/zip-qrs/route.ts:159`, `app/api/zip-qrs/route.ts:170`).
- CSV URL fallback logic prefers `qr_codes.qr_url`, then `${baseUrl}/q/${slug}`, then `${baseUrl}/api/open?addressId=${address.id}` (`app/api/zip-qrs/route.ts:172`, `app/api/zip-qrs/route.ts:182`).

### 5.2 /api/campaigns/[campaignId]/vdp-manifest

- Auth: it uses `getSupabaseServerClient()`, requires an authenticated user, fetches the campaign, and verifies ownership (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:33`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:41`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:49`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:58`).
- Buggy filter: it selects address fields including `qr_png_url`, filters `qr_png_url IS NOT NULL`, and orders by `seq` then `id` (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:68`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:76`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:80`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:82`).
- Current broken state: if no rows pass that filter, it returns `404` JSON `{ error: 'No addresses with QR codes found for this campaign' }` (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:92`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:95`).
- It fetches `qr_codes(id, slug, qr_url, address_id)` for the selected address ids (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:99`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:104`).
- CSV columns are `reference_id`, `address_line`, `city`, `region`, `postal_code`, `qr_url`, `campaign_id`, `campaign_name`, and `print_quantity` (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:182`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:193`).
- QR URL fallback logic is already slug-aware: use `qrCode.qr_url`, else `${baseUrl}/q/${qrCode.slug}`, else `${baseUrl}/api/open?addressId=${address.id}` (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:153`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:164`).

### 5.3 RecipientsTable display

- The table prop type includes both `qr_png_url: string | null` and optional `qr_code_base64?: string | null` (`components/RecipientsTable.tsx:20`, `components/RecipientsTable.tsx:33`).
- The campaign page gets addresses via `CampaignsService.fetchAddresses(campaignId)` inside `loadData()` (`app/(main)/campaigns/[campaignId]/page.tsx:416`, `app/(main)/campaigns/[campaignId]/page.tsx:421`). `CampaignsService.fetchAddresses()` reads `campaign_addresses_geojson` with `*, qr_code_base64` and separately reads `campaign_addresses` state fields (`lib/services/CampaignsService.ts:146`, `lib/services/CampaignsService.ts:151`, `lib/services/CampaignsService.ts:157`, `lib/services/CampaignsService.ts:160`).
- The exact recipient object built by the campaign page includes `id`, `address_line`, `city`, `region`, `postal_code`, `status`, `statusLabel`, `canMarkVisited`, `qr_png_url: null`, `qr_code_base64: addr.qr_code_base64 || null`, `sent_at`, `scanned_at`, `street_name`, `house_number`, `locality`, `seq`, and `contacts` (`app/(main)/campaigns/[campaignId]/page.tsx:896`, `app/(main)/campaigns/[campaignId]/page.tsx:920`).
- The campaign page passes `formattedRecipients` to `RecipientsTable` (`app/(main)/campaigns/[campaignId]/page.tsx:992`, `app/(main)/campaigns/[campaignId]/page.tsx:995`).
- `RecipientsTable` renders a QR image from `recipient.qr_code_base64` and provides a download anchor whose `href` is the same data URL (`components/RecipientsTable.tsx:205`, `components/RecipientsTable.tsx:214`).
- If `qr_code_base64` is missing, the QR column displays `Not generated` (`components/RecipientsTable.tsx:221`, `components/RecipientsTable.tsx:222`).
- The "View QR" button is controlled by `recipient.qr_png_url` and links to `recipient.qr_png_url` (`components/RecipientsTable.tsx:241`, `components/RecipientsTable.tsx:247`). On the campaign page it never appears for generated web QRs because that page hard-codes `qr_png_url: null` for every recipient (`app/(main)/campaigns/[campaignId]/page.tsx:909`).
- The per-row download link for `qr_code_base64` works as a browser data URL download if the base64 data exists because the link `href` is the data URL and `download` is set (`components/RecipientsTable.tsx:213`, `components/RecipientsTable.tsx:219`).

## 6. The mismatch — exact diagnosis

- `generate-qrs` writes `campaign_addresses.qr_code_base64` and `campaign_addresses.purl` (`app/api/generate-qrs/route.ts:128`, `app/api/generate-qrs/route.ts:132`).
- `generate-qrs` does not write `campaign_addresses.qr_png_url`; the inline comment says `Removed qr_png_url - using base64 instead` (`app/api/generate-qrs/route.ts:131`, `app/api/generate-qrs/route.ts:133`).
- `zip-qrs` filters addresses on `qr_png_url IS NOT NULL` (`app/api/zip-qrs/route.ts:61`, `app/api/zip-qrs/route.ts:65`).
- `vdp-manifest` filters addresses on `qr_png_url IS NOT NULL` (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:70`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:80`).
- Therefore: campaigns generated only by current `generate-qrs` can display address QR images but are excluded from `zip-qrs` and `vdp-manifest` because those export routes look for `qr_png_url`, not `qr_code_base64`.
- `RecipientsTable` displays the QR image from `recipient.qr_code_base64` (`components/RecipientsTable.tsx:206`, `components/RecipientsTable.tsx:209`).
- The "View QR" button reads `recipient.qr_png_url` (`components/RecipientsTable.tsx:241`, `components/RecipientsTable.tsx:247`).
- The campaign page passes `qr_png_url` as `null` and `qr_code_base64` from `addr.qr_code_base64 || null` (`app/(main)/campaigns/[campaignId]/page.tsx:909`, `app/(main)/campaigns/[campaignId]/page.tsx:910`).
- Therefore: the QR thumbnail/download arrow can work after `generate-qrs`, but the "View QR" button cannot appear on the campaign page for those recipients.

## 7. iOS coupling constraints

- Do not structurally alter `campaign_addresses.qr_code_base64`, `scans`, or `last_scanned_at`: iOS docs show Swift reads all three from `campaign_addresses` (`docs/IOS_LOGIC_TRANSLATION.md:145`, `docs/IOS_LOGIC_TRANSLATION.md:158`) and computes QR status from `qr_code_base64`, `scans`, and `last_scanned_at` (`docs/IOS_LOGIC_TRANSLATION.md:76`, `docs/IOS_LOGIC_TRANSLATION.md:81`).
- Do not break `GET /api/billing/entitlement` or `GET /api/buildings/[gersId]?campaign_id=<uuid>` for iOS scan display: iOS QR docs require those routes with Supabase bearer tokens (`docs/IOS_QR_SCANS_PRO.md:7`, `docs/IOS_QR_SCANS_PRO.md:10`, `docs/IOS_QR_SCANS_PRO.md:32`, `docs/IOS_QR_SCANS_PRO.md:35`).
- Do not break `qr_code_scans`: iOS schema alignment adds `get_address_scan_count()` and `get_campaign_scan_count()` that count from `qr_code_scans` (`supabase/migrations/20260307000000_ios_schema_alignment.sql:120`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:130`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:135`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:146`).
- Do not remove `/api/scan`: current web-generated QR codes encode `/api/scan?id={address_id}` (`app/api/generate-qrs/route.ts:111`, `app/api/generate-qrs/route.ts:112`) and Canva/basic QR paths also encode `/api/scan` (`app/api/campaigns/[campaignId]/generate-basic-qr/route.ts:43`, `app/api/canva/generate/route.ts:383`).
- Do not remove `/api/open`: export fallback URL logic still constructs `/api/open?addressId={address.id}` (`app/api/zip-qrs/route.ts:181`, `app/api/zip-qrs/route.ts:182`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:161`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:163`).
- Do not assume Swift source exists in this repo; the repo states the iOS app is separate (`docs/IOS_GERS_ID_FIX_CHECKLIST.md:75`).
- The exact iOS direct write payload to `qr_codes` cannot be proven from this repo; preserve the table columns represented in `types/database.ts` and the `destination_type`/`direct_url` additions because `/api/q/[slug]` and iOS helper RPCs rely on that model (`types/database.ts:183`, `types/database.ts:199`, `app/api/q/[slug]/route.ts:19`, `app/api/q/[slug]/route.ts:21`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:129`).

## 8. The fix — specification

### 8.1 generate-qrs/route.ts changes

Keep exactly as-is:

- Keep request body compatibility with `campaignId`, `trackable`, `baseUrl`, and `forceRegenerate` because current callers send those fields (`app/(main)/campaigns/[campaignId]/page.tsx:598`, `app/(main)/campaigns/[campaignId]/page.tsx:603`, `app/farms/[id]/page.tsx:1117`, `app/farms/[id]/page.tsx:1122`).
- Keep current address fetch and regeneration semantics unless intentionally changing behavior: the route currently selects `id`, `qr_code_base64`, `purl`, `address`, `formatted`, `house_number`, and `street_name`, and defaults to regenerating all rows (`app/api/generate-qrs/route.ts:40`, `app/api/generate-qrs/route.ts:43`, `app/api/generate-qrs/route.ts:68`, `app/api/generate-qrs/route.ts:76`).
- Keep current QR image generation path and printable overlay unless replacing the visual format intentionally (`app/api/generate-qrs/route.ts:119`, `app/api/generate-qrs/route.ts:125`, `lib/utils/qr-print.ts:159`, `lib/utils/qr-print.ts:171`).
- Keep writing `campaign_addresses.qr_code_base64` and `campaign_addresses.purl` so the current campaign address table and existing iOS read paths continue to work (`app/api/generate-qrs/route.ts:131`, `app/api/generate-qrs/route.ts:132`, `components/RecipientsTable.tsx:206`, `docs/IOS_LOGIC_TRANSLATION.md:76`).

Add:

- For each processed address, create or upsert a corresponding `qr_codes` row. The row should include `slug`, `qr_url`, `destination_type`, `direct_url`, `campaign_id`, and `address_id`, matching what `QRCodeService.createQRCodeWithDestination()` already inserts (`lib/services/QRCodeService.ts:309`, `lib/services/QRCodeService.ts:320`).
- Use `QRCodeService.generateUniqueSlugServer()` or equivalent collision checking against `qr_codes.slug`; the helper already checks slug availability via `.from('qr_codes').select('id').eq('slug', slug).maybeSingle()` (`lib/services/QRCodeService.ts:259`, `lib/services/QRCodeService.ts:270`).
- Set `destination_type` to `directLink` and `direct_url` to the same tracking URL currently stored in `purl` if the QR image should continue encoding `/api/scan?id={address_id}` for backwards-compatible scan behavior (`app/api/generate-qrs/route.ts:111`, `app/api/generate-qrs/route.ts:116`, `lib/services/QRCodeService.ts:301`, `lib/services/QRCodeService.ts:316`).
- Set `qr_url` to `${NEXT_PUBLIC_APP_URL ?? 'https://flyrpro.app'}/q/${slug}` or the same configured base behavior used by `QRCodeService.createQRCodeWithDestination()` (`lib/services/QRCodeService.ts:306`, `lib/services/QRCodeService.ts:307`, `lib/services/QRCodeService.ts:313`).

Whether to change the URL encoded in the QR image:

- Lowest-risk Phase 3 fix: do not change the QR image encoded URL yet. Keep encoding `/api/scan?id={address_id}` while adding `qr_codes` rows for exports/analytics. This preserves current scan behavior proven by `generate-qrs` and `/api/scan` (`app/api/generate-qrs/route.ts:111`, `app/api/scan/route.ts:291`, `app/api/scan/route.ts:325`).
- If the QR image is changed to encode `/q/{slug}`, then scans will use `/api/q/[slug]`, write `qr_code_scans`, and rely on `destination_type`/`direct_url` redirect behavior (`app/api/q/[slug]/route.ts:19`, `app/api/q/[slug]/route.ts:72`, `app/api/q/[slug]/route.ts:115`). That is a larger behavioral change and must preserve `/api/scan` for existing printed QRs.

Rollback safety:

- Do not clear or overwrite `qr_code_base64` until after the QR image is generated; current working display depends on this column (`app/api/generate-qrs/route.ts:125`, `app/api/generate-qrs/route.ts:131`, `components/RecipientsTable.tsx:206`).
- If inserting/upserting `qr_codes` fails for a row, the safest rollback behavior is to keep the existing `qr_code_base64`/`purl` write and include the row in an error count, because current display and `/api/scan` tracking work from those fields (`app/api/generate-qrs/route.ts:131`, `app/api/generate-qrs/route.ts:132`, `app/api/scan/route.ts:293`). This preserves the current working QR display even if the new slug table path fails.

### 8.2 zip-qrs/route.ts changes

- Change the address filter from `qr_png_url IS NOT NULL` to a filter compatible with current generated data, such as `qr_code_base64 IS NOT NULL`, because `generate-qrs` writes `qr_code_base64` and not `qr_png_url` (`app/api/zip-qrs/route.ts:65`, `app/api/generate-qrs/route.ts:131`, `app/api/generate-qrs/route.ts:133`).
- Stop assuming `qr_png_url` is a Supabase Storage public URL. Current code parses `/storage/v1/object/public/qr/` from `address.qr_png_url` and downloads from bucket `qr` (`app/api/zip-qrs/route.ts:89`, `app/api/zip-qrs/route.ts:96`), but the current generator stores a data URL in `qr_code_base64` (`app/api/generate-qrs/route.ts:125`, `app/api/generate-qrs/route.ts:131`).
- Get PNG bytes by stripping the `data:image/png;base64,` prefix from `qr_code_base64` and decoding the base64 to a buffer. This follows the actual data URL format generated by `generate-qrs` (`app/api/generate-qrs/route.ts:125`) and displayed by `RecipientsTable` (`components/RecipientsTable.tsx:209`).
- Keep CSV manifest logic mostly unchanged because it already prefers `qr_codes.qr_url`, then slug URL, then `/api/open` fallback (`app/api/zip-qrs/route.ts:172`, `app/api/zip-qrs/route.ts:182`). Once `generate-qrs` creates `qr_codes` rows, this logic can emit slug URLs without further structural changes.

### 8.3 vdp-manifest/route.ts changes

- Change the address filter from `qr_png_url IS NOT NULL` to `qr_code_base64 IS NOT NULL` or to existence of matching `qr_codes` rows, because current generation writes `qr_code_base64` and not `qr_png_url` (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:80`, `app/api/generate-qrs/route.ts:131`, `app/api/generate-qrs/route.ts:133`).
- Include whatever address fields are necessary after changing the select list; current select list includes `id`, `formatted`, `postal_code`, `qr_png_url`, and `seq` (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:72`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:78`).
- The QR URL fallback logic is already correct once `qr_codes` rows exist because it prefers `qrCode.qr_url`, then `${baseUrl}/q/${qrCode.slug}`, then `/api/open?addressId=` (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:153`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:164`).

### 8.4 RecipientsTable.tsx changes

- Remove or replace the dead "View QR" button path based on `recipient.qr_png_url`, because the campaign page always passes `qr_png_url: null` and the active generator does not write that column (`components/RecipientsTable.tsx:241`, `components/RecipientsTable.tsx:247`, `app/(main)/campaigns/[campaignId]/page.tsx:909`, `app/api/generate-qrs/route.ts:133`).
- Keep the base64 thumbnail/download UI because it is the current working display path (`components/RecipientsTable.tsx:206`, `components/RecipientsTable.tsx:214`).

### 8.5 What NOT to change

- Do not remove `/api/scan` or change existing `/api/scan?id={address_id}` handling; active web QRs encode that URL (`app/api/generate-qrs/route.ts:111`, `app/api/generate-qrs/route.ts:112`) and `/api/scan` updates `scan_events`, `building_stats`, and `campaign_addresses.scans` (`app/api/scan/route.ts:237`, `app/api/scan/route.ts:257`, `app/api/scan/route.ts:293`).
- Do not remove `/api/q/[slug]`; it is the implemented slug handler for `qr_codes` and `qr_code_scans` (`app/api/q/[slug]/route.ts:19`, `app/api/q/[slug]/route.ts:115`).
- Do not remove `/api/open`; export fallback logic still points at it (`app/api/zip-qrs/route.ts:181`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:163`).
- Do not drop or rename `campaign_addresses.qr_code_base64`, `purl`, `scans`, or `last_scanned_at`; web display and iOS docs read these fields (`components/RecipientsTable.tsx:206`, `types/database.ts:130`, `types/database.ts:131`, `docs/IOS_LOGIC_TRANSLATION.md:145`, `docs/IOS_LOGIC_TRANSLATION.md:158`).
- Do not drop or rename `qr_code_scans`; `/api/q/[slug]` writes it and iOS helper RPCs count it (`app/api/q/[slug]/route.ts:115`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:129`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:144`).
- Do not rely on `qr_scan_events` for the fix; it is dropped by migration while legacy service code still references it (`supabase/migrations/20250131000020_cleanup_redundant_tables.sql:15`, `lib/services/QRCodeService.ts:197`, `lib/services/ExperimentsService.ts:63`).
- Do not require Supabase Storage bucket `qr` for the fixed web export path if decoding `qr_code_base64`; the current `qr` bucket is configured in `schema.sql` (`supabase/schema.sql:50`, `supabase/schema.sql:62`), but current generation does not upload QR PNGs there (`app/api/generate-qrs/route.ts:128`, `app/api/generate-qrs/route.ts:133`).

## 9. Open questions

- Should newly generated web QR images continue encoding `/api/scan?id={address_id}` for maximum compatibility, or should they switch to `/q/{slug}` immediately? The code supports both handlers, but the product decision is not encoded in source (`app/api/generate-qrs/route.ts:111`, `app/api/q/[slug]/route.ts:19`).
- If `/q/{slug}` becomes the encoded URL, should the QR destination `direct_url` point to the old `/api/scan?id={address_id}` handler or directly to campaign `video_url`? `createQRCodeWithDestination()` supports `directLink`, but `generate-qrs` currently only knows the scan URL, not a desired destination URL (`lib/services/QRCodeService.ts:301`, `lib/services/QRCodeService.ts:316`, `app/api/generate-qrs/route.ts:111`).
- Does production already contain `qr_codes` rows or `qr_png_url` rows created outside this repo? This repo has code that reads them, but current `generate-qrs` does not create either `qr_codes` rows or `qr_png_url` values (`app/api/zip-qrs/route.ts:76`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:102`, `app/api/generate-qrs/route.ts:128`).
- What is the canonical production base URL for generated `qr_url`: `NEXT_PUBLIC_APP_URL`, `APP_BASE_URL`, `flyrpro.app`, or `www.flyrpro.app`? Current code uses different fallbacks: `generate-qrs` can fall back to `https://flyrpro.vercel.app`, while `QRCodeService` falls back to `https://flyrpro.app` (`app/api/generate-qrs/route.ts:101`, `lib/services/QRCodeService.ts:306`).
- Should `canva/generate` persist its S3 `publicUrl` anywhere? It currently uploads QR images and returns `ImageURL`, but only writes `purl` to `campaign_addresses` (`app/api/canva/generate/route.ts:398`, `app/api/canva/generate/route.ts:405`, `app/api/canva/generate/route.ts:725`).
- Should legacy `qr_scan_events` code be removed or migrated to `qr_code_scans`? The table is dropped by migration, but `QRCodeService.fetchAnalytics()` and `ExperimentsService` still query it (`supabase/migrations/20250131000020_cleanup_redundant_tables.sql:15`, `lib/services/QRCodeService.ts:197`, `lib/services/ExperimentsService.ts:63`).
- What exact behavior does the separate iOS app use for QR generation or direct `qr_codes` writes? This repo has no Swift source (`docs/IOS_GERS_ID_FIX_CHECKLIST.md:75`).

## 10. Testing checklist

1. Choose a test campaign with at least two `campaign_addresses` rows and record its id as `X`.

2. Before generation, inspect current QR state:

```sql
select id, qr_code_base64 is not null as has_base64, purl, qr_png_url, scans, last_scanned_at
from campaign_addresses
where campaign_id = 'X'
order by id;
```

This verifies the columns used by `generate-qrs`, `RecipientsTable`, `zip-qrs`, and `vdp-manifest` (`app/api/generate-qrs/route.ts:42`, `components/RecipientsTable.tsx:206`, `app/api/zip-qrs/route.ts:65`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:80`).

3. Generate QRs using the existing UI or call:

```bash
curl -X POST http://localhost:3000/api/generate-qrs \
  -H 'Content-Type: application/json' \
  -d '{"campaignId":"X","forceRegenerate":true,"baseUrl":"https://flyrpro.app"}'
```

Expected current response shape is `{ success, count, message }` (`app/api/generate-qrs/route.ts:149`, `app/api/generate-qrs/route.ts:153`).

4. Verify address QR fields are still populated:

```sql
select id, left(qr_code_base64, 22) as prefix, purl
from campaign_addresses
where campaign_id = 'X'
order by id;
```

Expected: `qr_code_base64` begins with `data:image/png;base64,` because `generate-qrs` creates that prefix (`app/api/generate-qrs/route.ts:125`), and `purl` contains `/api/scan?id=` because `generate-qrs` builds that URL (`app/api/generate-qrs/route.ts:111`, `app/api/generate-qrs/route.ts:112`).

5. After the Phase 3 fix, verify `qr_codes` rows exist:

```sql
select id, slug, qr_url, destination_type, direct_url, campaign_id, address_id
from qr_codes
where campaign_id = 'X'
order by address_id;
```

Expected after fix: one row per generated address, `slug` and `qr_url` non-null, `destination_type = 'directLink'`, `direct_url` equal to that address `purl` if keeping `/api/scan` as the encoded/ultimate scan path (`lib/services/QRCodeService.ts:309`, `lib/services/QRCodeService.ts:320`).

6. Verify the campaign Addresses tab still shows QR thumbnails and download arrows. That UI reads `qr_code_base64`, not `qr_codes` (`app/(main)/campaigns/[campaignId]/page.tsx:910`, `components/RecipientsTable.tsx:206`, `components/RecipientsTable.tsx:214`).

7. Verify the old scan URL still works by opening one `purl` from `campaign_addresses`. It should redirect to campaign `video_url` or fallback origin and update scan tracking through `/api/scan` (`app/api/scan/route.ts:291`, `app/api/scan/route.ts:318`, `app/api/scan/route.ts:325`).

8. After scanning a `purl`, verify legacy counters:

```sql
select id, scans, last_scanned_at
from campaign_addresses
where campaign_id = 'X'
order by id;
```

Expected: scanned address increments because `/api/scan` calls `increment_scan` (`app/api/scan/route.ts:293`, `supabase/migrations/20251211000001_create_increment_scan_rpc.sql:12`, `supabase/migrations/20251211000001_create_increment_scan_rpc.sql:13`).

9. Verify `scan_events` for `/api/scan`:

```sql
select id, building_id, campaign_id, address_id, scanned_at
from scan_events
where campaign_id = 'X'
order by scanned_at desc;
```

Expected: rows exist for address scans because `/api/scan` inserts into `scan_events` (`app/api/scan/route.ts:234`, `app/api/scan/route.ts:242`).

10. If the fix changes the encoded image URL to `/q/{slug}`, scan a generated `qr_url` and verify `qr_code_scans`:

```sql
select id, qr_code_id, address_id, scanned_at, user_agent, ip_address, referrer
from qr_code_scans
where address_id in (select id from campaign_addresses where campaign_id = 'X')
order by scanned_at desc;
```

Expected: `/api/q/[slug]` inserts rows into `qr_code_scans` for non-bot scans with address ids (`app/api/q/[slug]/route.ts:92`, `app/api/q/[slug]/route.ts:115`, `app/api/q/[slug]/route.ts:124`).

11. Verify `/api/qr/analytics` after `qr_codes` rows exist:

```bash
curl -X POST http://localhost:3000/api/qr/analytics \
  -H 'Content-Type: application/json' \
  -d '{"campaignId":"X"}'
```

Expected: API returns `{ data: [...] }` from `QRCodeService.fetchQRCodesWithScanStatusForCampaign()` (`app/api/qr/analytics/route.ts:21`, `app/api/qr/analytics/route.ts:24`, `lib/services/QRCodeService.ts:353`, `lib/services/QRCodeService.ts:399`).

12. Verify `zip-qrs` no longer returns `404 No QR codes found` for a campaign generated by `generate-qrs`. Current broken behavior comes from filtering `qr_png_url` (`app/api/zip-qrs/route.ts:65`, `app/api/zip-qrs/route.ts:70`); fixed behavior should include PNG files decoded from `qr_code_base64` plus `vdp-manifest.csv` and `README.txt` (`app/api/zip-qrs/route.ts:106`, `app/api/zip-qrs/route.ts:209`, `app/api/zip-qrs/route.ts:241`).

13. Verify `vdp-manifest` no longer returns `404 No addresses with QR codes found for this campaign`. Current broken behavior comes from filtering `qr_png_url` (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:80`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:92`); fixed behavior should return CSV with `qr_url` values from `qr_codes.qr_url` or slug fallback (`app/api/campaigns/[campaignId]/vdp-manifest/route.ts:155`, `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:160`).

14. Verify iOS-facing scan count RPCs still work:

```sql
select public.get_address_scan_count('<address_uuid>');
select public.get_campaign_scan_count('X');
```

Expected: functions exist and count from `qr_code_scans` (`supabase/migrations/20260307000000_ios_schema_alignment.sql:120`, `supabase/migrations/20260307000000_ios_schema_alignment.sql:146`).

15. Verify no test depends on `qr_scan_events`; if any route or UI calls `QRCodeService.fetchAnalytics()` or `ExperimentsService.recordScan()`, confirm whether it fails because `qr_scan_events` is dropped by migration (`supabase/migrations/20250131000020_cleanup_redundant_tables.sql:15`, `lib/services/QRCodeService.ts:197`, `lib/services/ExperimentsService.ts:63`).
