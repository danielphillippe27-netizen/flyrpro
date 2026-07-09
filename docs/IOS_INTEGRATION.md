# iOS Integration Guide

> This document describes the coupling between the FLYR iOS app
> and the flyrpro web app. Read this before modifying any shared
> API route, database table, or RPC function.

## 1. Overview

The FLYR iOS app is a native client for campaign creation, territory mapping, field sessions, QR code generation, billing entitlement checks, CRM pushes, invites, and team/workspace access. It is coupled to the flyrpro web app in two ways: it reads and writes the same Supabase database directly, and it calls Next.js API routes hosted under `https://www.flyrpro.app/api/...` or the configured `FLYR_PRO_API_URL`. The key rule is that web developers must treat shared database objects, RPC functions, and API request/response contracts as mobile contracts, not web-only implementation details.

## 2. Shared infrastructure

### 2.1 Database

The iOS app reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from the app bundle in `FLYR/Config/SupabaseManager.swift:10` and `FLYR/Config/SupabaseManager.swift:12`, then initializes `SupabaseClient` with those values at `FLYR/Config/SupabaseManager.swift:25`. The checked-in `Config.xcconfig:2` points iOS at `https://kfnsnwqylsdsbgnwgxva.supabase.co`.

The sibling `../flyrpro` repo appears to use the same Supabase project in scripts and docs, including `../flyrpro/scripts/get-campaigns-via-db.ts:14` and `../flyrpro/FLYR_PRO_TECHNICAL_REFERENCE.md:1826`, both referencing `https://kfnsnwqylsdsbgnwgxva.supabase.co`. The live web deployment still depends on environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`), so final production equality should be verified in deployment config.

### 2.2 Authentication

iOS authenticates directly to Supabase through the Supabase Swift client initialized with the anon key (`FLYR/Config/SupabaseManager.swift:25`). For web API routes, iOS usually sends the Supabase access token as `Authorization: Bearer <token>` after reading `SupabaseManager.shared.client.auth.session`, for example `FLYR/Features/Auth/Services/AccessAPI.swift:44`, `FLYR/Features/Billing/EntitlementsService.swift:166`, and `FLYR/Features/Integrations/Services/FUBPushLeadAPI.swift:91`.

Some web calls also bridge into cookie auth. `FLYR/Services/OvertureAddressService.swift:337` describes creating a short-lived web session cookie, then calls `/api/auth/handoff` with a bearer token at `FLYR/Services/OvertureAddressService.swift:344` and `/api/auth/redeem-handoff` at `FLYR/Services/OvertureAddressService.swift:359`. iOS therefore depends on both bearer-token web API auth and cookie handoff behavior.

## 3. Web API routes called by iOS

| Route | Method | iOS caller (file:line) | Notes |
|---|---:|---|---|
| `/api/access/redirect` | GET | `FLYR/Features/Auth/Services/AccessAPI.swift:95` | Resolves post-auth app route. |
| `/api/access/state` | GET | `FLYR/Features/Auth/Services/AccessAPI.swift:121` | Resolves workspace/access state. |
| `/api/account/delete` | DELETE | `FLYR/Features/Auth/Services/AccessAPI.swift:245` | Deletes authenticated account. |
| `/api/addresses-same-street` | POST | `FLYR/Services/OvertureAddressService.swift:277` | Finds nearby/same-street addresses. |
| `/api/auth/handoff` | POST | `FLYR/Services/OvertureAddressService.swift:344` | Converts mobile bearer auth into web handoff token/cookie flow. |
| `/api/auth/redeem-handoff` | POST | `FLYR/Services/OvertureAddressService.swift:359` | Redeems handoff token for web session cookie. |
| `/api/billing/apple/verify` | POST | `FLYR/Features/Billing/EntitlementsService.swift:144` | Verifies App Store transaction and refreshes entitlements. |
| `/api/billing/entitlement` | GET | `FLYR/Features/Billing/EntitlementsService.swift:82` | Reads mobile entitlement. |
| `/api/billing/stripe/checkout` | POST | `FLYR/Features/Auth/Services/AccessAPI.swift:211` | Starts Stripe checkout from iOS. |
| `/api/brokerages/search` | GET | `FLYR/Features/Auth/Services/AccessAPI.swift:178` | Brokerage lookup for onboarding/workspace setup. |
| `/api/buildings/{gersId}` | GET | `FLYR/Features/Buildings/API/BuildingDetailsAPI.swift:75` | Building detail, with scan data gated by entitlement. |
| `/api/campaigns/{campaignId}/addresses/{addressId}/manual` | DELETE | `FLYR/Features/Buildings/Services/BuildingLinkService.swift:204` | Deletes manually linked address. |
| `/api/campaigns/{campaignId}/addresses/manual` | POST | `FLYR/Features/Buildings/Services/BuildingLinkService.swift:150` | Creates manual campaign address. |
| `/api/campaigns/{campaignId}/buildings` | GET | `FLYR/Feautures/Campaigns/API/BuildingsAPI.swift:586`, `FLYR/Features/Buildings/Services/BuildingLinkService.swift:28` | Reads campaign building snapshot/link data. |
| `/api/campaigns/{campaignId}/buildings/{buildingId}/addresses` | GET/POST/DELETE | `FLYR/Features/Buildings/Services/BuildingLinkService.swift:124` | Reads or mutates building-address links. |
| `/api/campaigns/{campaignId}/buildings/{buildingId}/manual` | DELETE | `FLYR/Features/Buildings/Services/BuildingLinkService.swift:212` | Deletes manual building. |
| `/api/campaigns/{campaignId}/buildings/manual` | POST | `FLYR/Features/Buildings/Services/BuildingLinkService.swift:179` | Creates manual building. |
| `/api/campaigns/generate-address-list` | POST | `FLYR/Services/OvertureAddressService.swift:185`, `FLYR/Services/OvertureAddressService.swift:203` | Generates and inserts address lists. |
| `/api/campaigns/provision` | POST | `FLYR/Feautures/Campaigns/CampaignsAPI.swift:555` | Provisions campaign snapshots and server-side campaign assets. |
| `/api/daily-content` | GET | `FLYR/Feautures/Home/Services/DailyContentService.swift:63` | Daily content for home screen. |
| `/api/farms` | POST | `FLYR/Features/Farm/Services/FarmService.swift:174` | Creates farm through backend. |
| `/api/integrations/boldtrail/connect` | POST | `FLYR/Features/Integrations/Services/BoldTrailConnectAPI.swift:45` | Connects BoldTrail. |
| `/api/integrations/boldtrail/disconnect` | POST/DELETE | `FLYR/Features/Integrations/Services/BoldTrailConnectAPI.swift:128` | Disconnects BoldTrail. |
| `/api/integrations/boldtrail/push-lead` | POST | `FLYR/Features/Integrations/Services/BoldTrailPushLeadAPI.swift:42` | Pushes one lead to BoldTrail. |
| `/api/integrations/boldtrail/status` | GET | `FLYR/Features/Integrations/Services/BoldTrailConnectAPI.swift:72` | Reads BoldTrail connection status. |
| `/api/integrations/boldtrail/test` | POST | `FLYR/Features/Integrations/Services/BoldTrailConnectAPI.swift:24` | Tests BoldTrail credentials. |
| `/api/integrations/fub/connect` | POST | `FLYR/Features/Integrations/Services/FUBConnectAPI.swift:33` | Alias route for iOS compatibility with Follow Up Boss. |
| `/api/integrations/fub/disconnect` | POST/DELETE | `FLYR/Features/Integrations/Services/FUBConnectAPI.swift:97` | Alias route for iOS compatibility with Follow Up Boss. |
| `/api/integrations/fub/oauth/start` | GET | `FLYR/Features/Integrations/Services/FUBOAuthAPI.swift:25` | Alias OAuth route for iOS compatibility. |
| `/api/integrations/fub/push-lead` | POST | `FLYR/Features/Integrations/Services/FUBPushLeadAPI.swift:92` | Alias route for iOS compatibility; pushes a lead to Follow Up Boss. |
| `/api/integrations/fub/status` | GET | `FLYR/Features/Integrations/Services/FUBPushLeadAPI.swift:157` | Alias route for iOS compatibility. |
| `/api/integrations/fub/test` | POST | `FLYR/Features/Integrations/Services/FUBPushLeadAPI.swift:173` | Alias route for iOS compatibility. |
| `/api/integrations/fub/test-push` | POST | `FLYR/Features/Integrations/Services/FUBPushLeadAPI.swift:190` | Alias route for iOS compatibility. |
| `/api/integrations/fub/voice-log` | POST | `FLYR/Features/Integrations/Services/VoiceLogAPI.swift:35` | Alias route for iOS voice-log upload and CRM push. |
| `/api/integrations/hubspot/disconnect` | POST/DELETE | `FLYR/Features/Integrations/Services/CRMIntegrationManager.swift:512` | Disconnects HubSpot. |
| `/api/integrations/hubspot/oauth/start` | GET | `FLYR/Features/Integrations/Views/OAuthView.swift:110` | Starts HubSpot OAuth. |
| `/api/integrations/hubspot/push-lead` | POST | `FLYR/Features/Integrations/Services/HubSpotPushLeadAPI.swift:74` | Pushes one lead to HubSpot. |
| `/api/integrations/hubspot/test` | POST | `FLYR/Features/Integrations/Services/CRMIntegrationManager.swift:468` | Tests HubSpot connection. |
| `/api/integrations/monday/boards` | GET | `FLYR/Features/Integrations/Services/CRMIntegrationManager.swift:316` | Fetches Monday boards. |
| `/api/integrations/monday/disconnect` | POST/DELETE | `FLYR/Features/Integrations/Services/CRMIntegrationManager.swift:498` | Disconnects Monday. |
| `/api/integrations/monday/oauth/start` | GET | `FLYR/Features/Integrations/Views/OAuthView.swift:173` | Starts Monday OAuth. |
| `/api/integrations/monday/select-board` | POST | `FLYR/Features/Integrations/Services/CRMIntegrationManager.swift:352` | Stores selected Monday board. |
| `/api/integrations/monday/status` | GET | `FLYR/Features/Integrations/Services/CRMIntegrationManager.swift:330` | Reads Monday status. |
| `/api/invites/accept` | POST | `FLYR/Features/Invites/Services/InviteService.swift:65` | Accepts team/workspace invite. |
| `/api/invites/validate` | GET | `FLYR/Features/Invites/Services/InviteService.swift:32` | Validates invite token without auth. |
| `/api/leads/sync-crm` | POST | `FLYR/Features/Integrations/Services/FUBPushLeadAPI.swift:207` | Bulk syncs contacts/leads to CRM. |
| `/api/onboarding/complete` | POST | `FLYR/Features/Auth/Services/AccessAPI.swift:147` | Completes workspace onboarding. |
| `/api/routes/assignments` | GET | `FLYR/Features/Routes/Services/RouteAssignmentsAPI.swift:26` | Fetches route assignments. |
| `/api/routes/assignments/{assignmentId}` | GET | `FLYR/Features/Routes/Services/RouteAssignmentsAPI.swift:58` | Fetches assignment detail. |
| `/api/routes/assignments/{assignmentId}/map` | GET | `FLYR/Features/Routes/Services/RouteAssignmentsAPI.swift:86` | Fetches assignment map payload. |
| `/api/routes/assignments/status` | POST | `FLYR/Features/Routes/Services/RouteAssignmentsAPI.swift:119` | Updates assignment status. |
| `/api/share-card` | GET | `FLYR/Features/Challenges/Services/ChallengeService.swift:217` | Fetches challenge share-card image. |

### 3.1 New web routes touching iOS-coupled tables

These routes were added in Daniel's salespeople/live-sessions/contractor CRM checkpoint.
They may not all be called by the current iOS app yet, but they read or write tables
that iOS also uses directly. Treat them as shared-data routes.

| Route | Method | Tables touched | iOS coupling risk | Notes |
|---|---:|---|---|---|
| `/api/contacts` | GET | `contacts` | Medium | Lists up to 200 contacts scoped by workspace or user. Response maps DB names into `fullName`, `email`, `phone`, and `tags`. |
| `/api/contacts` | POST | `contacts` | High | Inserts a contact with `user_id`, optional `workspace_id`, `full_name`, `email`, `phone`, and `status = 'new'`. `contacts` is directly read/written by iOS. |
| `/api/leads` | GET | `contacts` | Medium | Reads campaign/workspace-scoped leads from `contacts` and maps them to lead fields. Has fallback for older schemas missing enriched columns. |
| `/api/leads/upsert` | POST | `contacts`, `contact_activities` | High | Inserts a contact/lead with campaign/address/building/session linkage when provided, then optionally inserts note/meeting rows into `contact_activities`. |
| `/api/salesperson/demo-center` | GET | `salespeople`, `salesperson_click_events`, `salesperson_demo_video_events`, `salesperson_demo_links`, `workspaces` | Medium | Salesperson settings/demo-link payload for FLYR Pro and iOS Settings. Returns `links.soloDemoUrl` for the solo `/demo-2` flow and `links.teamDemoUrl` for the team `/demo-1` flow. |
| `/api/salesperson/leads` | GET | `sales_leads` | Medium | Salesperson/iOS prospecting list. This must not read customer `contacts`; it returns internal sales prospects only. |
| `/api/salesperson/pipeline` | GET | `sales_leads`, `sales_activities` | Medium | Salesperson Pipeline list/detail payload. iOS should label this workflow "Pipeline", not "Tasks". |
| `/api/salesperson/pipeline/{leadId}` | PATCH | `sales_leads`, `sales_activities` | Medium | Updates sales pipeline stage, priority, next pipeline step, and activity history. |
| `/api/sales/leads/{leadId}/convert` | POST | `sales_leads`, `contacts`, `sales_activities` | High | Manual-only conversion from internal sales prospect to regular FLYR customer contact. This is the only sales path that should create a customer `contacts` row. |
| `/api/qr-codes` | GET | `qr_codes` | Medium | Lists QR rows owned by the authenticated user via metadata filters. iOS writes and reads `qr_codes` directly. |
| `/api/qr-codes` | POST | `qr_codes` | High | Inserts generic direct-link QR rows with generated `slug`, `/q/{slug}` URL, `direct_url`, and owner/workspace metadata. Do not change `qr_codes` shape without iOS coordination. |
| `/api/sessions/start` | POST | `campaigns`, `workspace_members`, `campaign_members`, `sessions`, `session_participants` | High | Starts an active session row, resolving workspace access from workspace/campaign membership, and upserts the host into `session_participants` for campaign sessions. `sessions` is iOS-critical. |
| `/api/sessions/update` | POST | `campaigns`, `workspace_members`, `campaign_members`, `session_participants`, `sessions`, `route_assignments`, `farm_touches` | High | Updates active sessions or creates/completes session rows, writes route assignment completion progress, and marks farm touches complete. Touches multiple field-session tables used by iOS. |
| `/api/live-sessions/codes/create` | POST | `sessions`, `campaigns`, `live_session_codes` | Medium | Host-only route that revokes existing active codes for a session and inserts a new hashed join code. Depends on `sessions` and `campaigns` consistency. |
| `/api/live-sessions/codes/join` | POST | `live_session_codes`, `sessions`, `campaigns`, `campaign_members`, `session_participants` | High | Validates a join code, may upsert `campaign_members`, upserts the joining user into `session_participants`, and updates `live_session_codes.last_used_at`. |
| `/api/live-sessions/presence` | GET | `campaign_presence` | Medium | Reads fresh participant locations for a campaign after campaign access validation. Presence is web-owned but campaign access is shared. |
| `/api/live-sessions/presence` | POST | `campaign_presence`, `session_participants` | Medium | Upserts campaign presence and updates participant heartbeat fields. Coordinate with iOS if native live-session presence is added. |

### 3.2 Existing iOS-coupled routes changed in Daniel's latest commit

| Route | Method | Tables/RPCs touched | iOS coupling risk | Change note |
|---|---:|---|---|---|
| `/api/campaigns/{campaignId}/addresses/{addressId}` | DELETE | `campaign_addresses` via `deleteAddressIfExists` helper | High | Direct delete was replaced with a shared location-delete helper that can clean related location data. Request/response contract remains `deleted: true, address_id`. |
| `/api/campaigns/{campaignId}/addresses/{addressId}/manual` | DELETE | `campaign_addresses` via `deleteCampaignAddressDeep` helper | High | Manual address delete now validates `source = 'manual'` and uses deep-delete helper with `requireManualSource`. Non-manual rows return 409. |
| `/api/campaigns/{campaignId}/state` | GET | `address_statuses`, `campaign_assignments`, `campaign_assignment_homes` | High | Adds assigned-to-me scoping and cursor-based state payload for address statuses. iOS depends on address status semantics. |
| `/api/campaigns/{campaignId}/state` | POST | `record_campaign_address_outcome`, `upsert_address_status`, `farm_addresses` | High | Writes canonical address outcomes through RPC with fallback to `upsert_address_status`; optionally syncs farm address visit/outcome fields. |
| `/api/campaigns/provision` | POST | `campaigns`, `building_address_links`, post-processing/linker pipeline | High | Adds optional wait flags (`wait_for_linker`, `wait_for_postprocess`, `require_linked_homes`) that run post-processing before response, counts building links, and repairs missing `provision_source`. Existing default background behavior is preserved when flags are absent. |

## 4. Database tables read or written by iOS directly

| Table | Operations | iOS caller (file:line) | Web dev constraint |
|---|---|---|---|
| `address_content` | select, upsert | `FLYR/Features/QRCodes/Services/QRCodeAPI.swift:107`, `FLYR/Features/QRCodes/Services/QRCodeAPI.swift:188` | Safe to add columns, unsafe to remove or rename |
| `address_statuses` | select | `FLYR/Features/Campaigns/API/VisitsAPI.swift:134` | Safe to add columns, unsafe to remove or rename |
| `batches` | select, insert, update, delete | `FLYR/Features/QRCodes/Services/BatchRepository.swift:35`, `:61`, `:75`, `:107`, `:131` | Safe to add columns, unsafe to remove or rename |
| `building_address_links` | select | `FLYR/Features/Buildings/Services/BuildingLinkService.swift:65`, `FLYR/Features/Map/Services/BuildingDataService.swift:219` | Safe to add columns, unsafe to remove or rename |
| `building_stats` | select | `FLYR/Features/Buildings/Services/BuildingLinkService.swift:239`, `FLYR/Features/Map/Services/BuildingStatsSubscriber.swift:196` | Safe to add columns, unsafe to remove or rename |
| `building_touches` | insert, update | `FLYR/Features/Campaigns/API/VisitsAPI.swift:67`, `FLYR/Features/Campaigns/API/VisitsAPI.swift:416` | Must not alter schema without iOS coordination |
| `building_units` | select | `FLYR/Features/Buildings/Services/BuildingLinkService.swift:252` | Safe to add columns, unsafe to remove or rename |
| `buildings` | select | `FLYR/Features/Buildings/Services/BuildingLinkService.swift:78`, `FLYR/Features/Map/Services/BuildingDataService.swift:354` | Safe to add columns, unsafe to remove or rename |
| `campaign_addresses` | select, update | `FLYR/Features/QRCodes/Services/QRRepository.swift:327`, `FLYR/Features/Map/API/VoiceNoteAPI.swift:39`, `FLYR/Features/Campaigns/API/VisitsAPI.swift:94` | Must not alter schema without iOS coordination |
| `campaign_addresses_v` | select | `FLYR/Feautures/Campaigns/CampaignsAPI.swift:413`, `FLYR/Feautures/Campaigns/CampaignsAPI.swift:440` | Column `id,campaign_id,formatted,postal_code,source,seq,visited,geom_json,created_at` must remain -- iOS reads it |
| `campaign_qr_batches` | upsert | `FLYR/Features/QRExport/Services/SupabaseUploadService.swift:163` | Safe to add columns, unsafe to remove or rename |
| `campaigns` | select, insert, update, delete | `FLYR/Feautures/Campaigns/CampaignsAPI.swift:78`, `:122`, `:490`, `:532` | Must not alter schema without iOS coordination |
| `challenge_participants` | select | `FLYR/Features/Challenges/Services/ChallengeService.swift:320`, `:332`, `:592` | Safe to add columns, unsafe to remove or rename |
| `challenge_templates` | select | `FLYR/Features/Challenges/Services/ChallengeService.swift:139` | Safe to add columns, unsafe to remove or rename |
| `challenges` | select, insert, update | `FLYR/Features/Challenges/Services/ChallengeService.swift:251`, `:366`, `:418`, `:568` | Safe to add columns, unsafe to remove or rename |
| `contact_activities` | select, insert | `FLYR/Feautures/Home/Services/ActivityFeedService.swift:264`, `FLYR/Features/Contacts/Services/ContactsService.swift:407` | Safe to add columns, unsafe to remove or rename |
| `contacts` | select, insert, update, delete | `FLYR/Features/Contacts/Services/ContactsService.swift:20`, `:63`, `:151`, `FLYR/Features/Leads/Services/FieldLeadsService.swift:276` | Must not alter schema without iOS coordination |
| `sales_leads` | select, insert, update | Salesperson prospecting/dialer/pipeline API contracts | Internal sales prospects only. Do not show these in regular iOS CRM/contact lead views unless explicitly converted. |
| `sales_activities` | select, insert | Salesperson prospecting/dialer/pipeline API contracts | Activity history for internal sales prospects. Do not mix with `contact_activities` except after explicit conversion. |
| `crm_connections` | select | `FLYR/Features/Integrations/Services/CRMConnectionStore.swift:42` | Safe to add columns, unsafe to remove or rename |
| `farm_leads` | select, insert, update | `FLYR/Features/Farm/Services/FarmLeadService.swift:17`, `:41`, `:80` | Safe to add columns, unsafe to remove or rename |
| `farm_phases` | select, insert, update, delete | `FLYR/Features/Farm/Services/FarmPhaseService.swift:111`, `:157`, `:174`, `:192` | Safe to add columns, unsafe to remove or rename |
| `farm_touches` | select, insert, update, delete | `FLYR/Features/Farm/Services/FarmTouchService.swift:26`, `:85`, `:210`, `:322` | Safe to add columns, unsafe to remove or rename |
| `farms` | select, insert, update, delete | `FLYR/Features/QRCodes/Services/QRRepository.swift:517`, `FLYR/Features/Farm/Services/FarmService.swift:149`, `:240`, `:278` | Must not alter schema without iOS coordination |
| `farms_with_geojson` | select | `FLYR/Features/Farm/Services/FarmService.swift:36`, `:54`, `:70` | Safe to add columns, unsafe to remove or rename |
| `field_leads` | select, insert, update, delete | `FLYR/Features/Leads/Services/FieldLeadsService.swift:55`, `:213`, `:244`, `:502` | Must not alter schema without iOS coordination |
| `notifications` | select, update | `FLYR/Feautures/Home/Services/PerformanceReportsService.swift:231`, `:264` | Safe to add columns, unsafe to remove or rename |
| `profile_images` | storage bucket operations | `FLYR/Features/Settings/ViewModels/ProfileViewModel.swift:192`, `FLYR/Features/Challenges/Services/ChallengeService.swift:629` | Safe to add columns, unsafe to remove or rename |
| `profiles` | select, insert, update, upsert | `FLYR/Config/AuthManager.swift:457`, `FLYR/Features/Onboarding/ViewModels/OnboardingViewModel.swift:94`, `FLYR/Features/Settings/ViewModels/ProfileViewModel.swift:55` | Must not alter schema without iOS coordination |
| `qr_code_scans` | select, insert | `FLYR/Features/QRCodes/Services/QRCodeAPI.swift:20`, `:33`, `:76` | Must not alter schema without iOS coordination |
| `qr_codes` | select, insert, update | `FLYR/Features/QRCodes/Services/QRRepository.swift:75`, `:206`, `:467`, `FLYR/Features/QRCodes/Services/QRCodeAPI.swift:324` | Must not alter schema without iOS coordination |
| `qr_sets` | select | `FLYR/Features/QRCodes/Services/QRCodeAPI.swift:283`, `:299` | Safe to add columns, unsafe to remove or rename |
| `reports` | select | `FLYR/Feautures/Home/Services/PerformanceReportsService.swift:206` | Safe to add columns, unsafe to remove or rename |
| `safety_events` | insert | `FLYR/Features/Map/Services/SessionSafetyBeaconService.swift:517` | Safe to add columns, unsafe to remove or rename |
| `session_analytics` | select | `FLYR/Feautures/Home/Services/ActivityFeedService.swift:137`, `FLYR/Features/Map/Services/SessionsAPI.swift:74` | Safe to add columns, unsafe to remove or rename |
| `session_checkins` | select, update, upsert, delete | `FLYR/Features/Map/Services/SessionSafetyBeaconService.swift:153`, `:340`, `:460`, `:580` | Safe to add columns, unsafe to remove or rename |
| `session_events` | select | `FLYR/Features/Map/SessionManager.swift:1356` | Safe to add columns, unsafe to remove or rename |
| `session_heartbeats` | insert | `FLYR/Features/Map/Services/SessionSafetyBeaconService.swift:435` | Safe to add columns, unsafe to remove or rename |
| `session_shares` | select, insert, update | `FLYR/Features/Map/Services/SessionSafetyBeaconService.swift:136`, `:256`, `:290` | Safe to add columns, unsafe to remove or rename |
| `sessions` | select, insert, update | `FLYR/Features/Map/Services/SessionsAPI.swift:181`, `:204`, `:265`, `FLYR/Features/Map/SessionManager.swift:2395` | Must not alter schema without iOS coordination |
| `support_messages` | select, insert | `FLYR/Features/Support/SupportService.swift:28`, `:45` | Safe to add columns, unsafe to remove or rename |
| `user_integrations` | select, upsert, delete | `FLYR/Features/Integrations/Services/CRMIntegrationManager.swift:242`, `:284`, `:522` | Must not alter schema without iOS coordination |
| `user_settings` | select, update, upsert | `FLYR/Features/QRCodes/Views/CreateBatchView.swift:245`, `FLYR/Features/Settings/Services/SettingsService.swift:17`, `:44` | Safe to add columns, unsafe to remove or rename |
| `user_stats` | select, update, upsert | `FLYR/Features/Stats/Services/StatsService.swift:17`, `:31`, `FLYR/Features/Stats/Views/LeaderboardDebugView.swift:195` | Safe to add columns, unsafe to remove or rename |
| `workspace_members` | update | `FLYR/Features/Routes/Services/RoutePlansAPI.swift:94` | Safe to add columns, unsafe to remove or rename |
| `workspaces` | insert | `FLYR/Features/Routes/Services/RoutePlansAPI.swift:144` | Safe to add columns, unsafe to remove or rename |

## 5. RPC functions called by iOS

| Function | iOS caller (file:line) | What it does | Risk if changed |
|---|---|---|---|
| `accept_challenge_invite` | `FLYR/Features/Challenges/Services/ChallengeService.swift:447` | Accepts challenge invite and creates participant state. | Challenge join flow breaks. |
| `count_challenge_rolling_participants` | `FLYR/Features/Challenges/Services/ChallengeService.swift:154` | Counts rolling challenge participants. | Challenge landing stats break. |
| `generate_my_performance_reports` | `FLYR/Feautures/Home/Services/PerformanceReportsService.swift:189` | Generates member performance reports. | Report notification/home data may disappear. |
| `get_address_scan_count` | `FLYR/Features/QRCodes/Services/QRCodeAPI.swift:48` | Returns scan count for one address. | QR analytics undercounts or fails. |
| `get_buildings_by_address_ids` | `FLYR/Feautures/Campaigns/API/BuildingsAPI.swift:709` | Fetches building polygons for address IDs. | Map fallback building display breaks. |
| `get_campaign_address_centroids` | `FLYR/Feautures/Campaigns/CampaignsAPI.swift:365` | Returns campaign address centroids. | Campaign list/map centering breaks. |
| `get_campaign_address_counts` | `FLYR/Feautures/Campaigns/CampaignsAPI.swift:318` | Returns address counts by campaign. | Campaign list house counts break. |
| `get_campaign_buildings_geojson` | `FLYR/Features/Addresses/API/AddressesAPI.swift:55` | Returns campaign building GeoJSON. | Address/building map polygons break. |
| `get_campaign_confidence_hotspots` | `FLYR/Feautures/Campaigns/CampaignsAPI.swift:387` | Returns confidence hotspot rows. | Campaign analytics/hotspots break. |
| `get_campaign_road_metadata` | dynamic via `FLYR/Config/SupabaseClientShim.swift:165` | Reads road cache metadata. | Road-layer cache state breaks. |
| `get_campaign_roads` / `rpc_get_campaign_roads_v2` | dynamic via `FLYR/Config/SupabaseClientShim.swift:165`; `FLYR/Services/CampaignRoadService.swift:197` | Reads campaign road GeoJSON. | Route/road map layers break. |
| `get_challenge_rolling_leaderboard` | `FLYR/Features/Challenges/Services/ChallengeService.swift:163` | Returns rolling challenge leaderboard. | Challenge leaderboard breaks. |
| `get_leaderboard` | `FLYR/Features/Stats/Services/LeaderboardService.swift:116`, `:200` | Returns stats leaderboard. | Stats leaderboard breaks. |
| `get_my_assigned_routes` | `FLYR/Features/Routes/Services/RoutePlansAPI.swift:206` | Returns assigned route plans for user/workspace. | Route assignment UI breaks. |
| `get_or_create_support_thread` | `FLYR/Features/Support/SupportService.swift:18` | Creates or fetches support thread. | Support chat cannot initialize. |
| `get_route_plan_detail` | `FLYR/Features/Routes/Services/RoutePlansAPI.swift:224` | Returns route plan detail. | Route detail/start-session flow breaks. |
| `join_searchable_challenge` | `FLYR/Features/Challenges/Services/ChallengeService.swift:468` | Joins public/searchable challenge. | Public challenge join breaks. |
| `primary_workspace_id` | `FLYR/Features/Routes/Services/RoutePlansAPI.swift:169` | Resolves user's primary workspace. | Workspace-scoped route calls break. |
| `record_campaign_address_outcome` | `FLYR/Features/Campaigns/API/VisitsAPI.swift:216` | Records canonical address visit/outcome. | Visit tracking and address status break. |
| `record_campaign_target_outcome` | `FLYR/Features/Campaigns/API/VisitsAPI.swift:324` | Records canonical building/target outcome. | Building outcome tracking breaks. |
| `rpc_complete_building_in_session` | `FLYR/Features/Map/API/SessionEventsAPI.swift:31`, `:54` | Completes/logs building work inside a field session. | Session completion analytics break. |
| `rpc_upsert_campaign_roads` | `FLYR/Services/CampaignRoadService.swift:391` | Stores campaign road cache and metadata. | Road preparation/cache write breaks. |
| `sync_challenge_progress` | `FLYR/Features/Challenges/Services/ChallengeService.swift:497` | Syncs challenge progress. | Challenge progress breaks. |
| `update_farm_polygon` | `FLYR/Features/Farm/Services/FarmService.swift:271` | Updates farm polygon. | Farm territory editing breaks. |
| `upsert_address_building_by_formatted` | `FLYR/Features/Addresses/API/AddressesAPI.swift:40` | Caches address-building link. | Address/building cache writes break. |
| `upsert_address_status` | `FLYR/Features/Campaigns/API/VisitsAPI.swift:240` | Fallback status upsert. | Visit fallback path breaks. |
| `validate_challenge_invite` | `FLYR/Features/Challenges/Services/ChallengeService.swift:429` | Validates challenge invite token. | Challenge invite validation breaks. |

## 6. iOS QR system

### 6.1 How iOS generates QR codes

1. `QRCodeGenerator.generate(from:size:)` creates the `UIImage` QR image from an arbitrary string in `FLYR/Features/QRCodes/QRCodeGenerator.swift:13`; `generateBase64(from:size:)` wraps that image as base64 at `FLYR/Features/QRCodes/QRCodeGenerator.swift:64`.
2. Address QR creation happens in `QRRepository.createQRCodeForAddress(...)` at `FLYR/Features/QRCodes/Services/QRRepository.swift:24`. It builds either `https://flyrpro.app/address/{addressId}?device={deviceUUID}&campaign={campaignId}` at `:34` or `https://flyrpro.app/address/{addressId}?device={deviceUUID}` at `:36`.
3. Campaign/farm QR creation happens in `QRRepository.createQRCode(...)` at `FLYR/Features/QRCodes/Services/QRRepository.swift:142`. It builds `https://flyrpro.app/qr/{campaignId}/{qrUUID}?device={deviceUUID}` at `:161` or `https://flyrpro.app/qr/farm/{farmId}/{qrUUID}?device={deviceUUID}` at `:163`.
4. Batch QR generation happens in `BatchQRGenerator.generateBatchQRCodes(...)` at `FLYR/Features/QRCodes/Utils/BatchQRGenerator.swift:13`. It resolves each destination through `BatchURLResolver.resolveBatchURL(...)` at `FLYR/Features/QRCodes/Utils/BatchQRGenerator.swift:39`.
5. iOS writes QR rows directly to Supabase, not through a web `QRCodeService`. Address, campaign, farm, and batch flows insert into `qr_codes` with `qr_url`, `qr_image`, `metadata`, and optional `address_id`, `campaign_id`, `farm_id`, or `batch_id` at `FLYR/Features/QRCodes/Services/QRRepository.swift:59`, `:189`, and `FLYR/Features/QRCodes/Utils/BatchQRGenerator.swift:58`.

### 6.2 QR URL formats in the wild

| Template | Swift file | Web handler when scanned |
|---|---|---|
| `https://flyrpro.app/address/{addressId}?device={deviceUUID}&campaign={campaignId}` | `FLYR/Features/QRCodes/Services/QRRepository.swift:34` | No matching `../flyrpro/app/address/[id]` route was found; needs manual web routing check. |
| `https://flyrpro.app/address/{addressId}?device={deviceUUID}` | `FLYR/Features/QRCodes/Services/QRRepository.swift:36` | No matching `../flyrpro/app/address/[id]` route was found; needs manual web routing check. |
| `https://flyrpro.app/qr/{campaignId}/{qrUUID}?device={deviceUUID}` | `FLYR/Features/QRCodes/Services/QRRepository.swift:161` | No matching `../flyrpro/app/qr/[...]` scanner route was found; needs manual web routing check. |
| `https://flyrpro.app/qr/farm/{farmId}/{qrUUID}?device={deviceUUID}` | `FLYR/Features/QRCodes/Services/QRRepository.swift:163` | No matching `../flyrpro/app/qr/farm/[...]` scanner route was found; needs manual web routing check. |
| `https://flyrpro.app/address/{addressId}` | `FLYR/Features/QRCodes/Models/QRCodeAddress.swift:37` | No matching `../flyrpro/app/address/[id]` route was found; needs manual web routing check. |
| `flyr://address/{addressId}` | `FLYR/Features/QRCodes/Models/QRCodeAddress.swift:38` | Native deep link, not a web handler. |
| `https://flyr.app/map/{batchId}?addr={addressId}` | `FLYR/Features/QRCodes/Utils/BatchURLResolver.swift:20`, `:41` | External/non-flyrpro domain; not handled by `../flyrpro`. |
| `{batch.customURL}?addr={addressId}` | `FLYR/Features/QRCodes/Utils/BatchURLResolver.swift:23`, `:41` | Depends on custom URL. |
| `{userDefaultWebsite}?addr={addressId}` | `FLYR/Features/QRCodes/Utils/BatchURLResolver.swift:31`, `:41` | Depends on user website. |
| `https://flyr.app?addr={addressId}` | `FLYR/Features/QRCodes/Utils/BatchURLResolver.swift:25`, `:34`, `:41` | External/non-flyrpro fallback. |

### 6.3 Scan tracking

The sibling web repo contains scan handlers at `../flyrpro/app/api/scan/route.ts` and `../flyrpro/app/api/q/[slug]/route.ts`. The `/api/scan` route records campaign/address scans into `scan_events` and updates legacy campaign/address counters, including `increment_building_scans` and `increment_scan` RPC calls (`../flyrpro/app/api/scan/route.ts:237`, `:257`, `:293`). The `/api/q/[slug]` short-link route resolves `qr_codes.short_url`, records into `qr_code_scans`, calls `record_public_qr_scan_outcome`, and increments campaign scans (`../flyrpro/app/api/q/[slug]/route.ts:20`, `:116`, `:129`, `:152`).

The iOS-generated QR templates found in `QRRepository` are direct `/address/...` and `/qr/...` paths, not `/api/scan?...` or `/api/q/[slug]`. I did not find a matching `../flyrpro/app/address/[id]` or dynamic `../flyrpro/app/qr/...` scanner page in the sibling repo. Therefore, scan tracking for those iOS QR formats is a divergence risk: either the production web app has routes not present locally, rewrites redirect those paths into `/api/scan` or `/api/q/[slug]`, or these iOS QR formats will not be tracked by the visible web handlers.

## 7. backend-api-routes/ directory

### 7.1 What it is

`backend-api-routes/` is a standalone Next.js route bundle intended to be copied into the flyrpro web app. Its README says it contains backend API routes for FLYR, copied to the Next.js app at `flyrpro.app`, and specifically calls out copying `app/api/integrations/fub/` plus required Supabase, CRM encryption, and Apple billing environment variables (`backend-api-routes/README.md:1`, `:3`, `:8`, `:10`). Its `package.json` identifies it as a private Next 15 project with Supabase and React dependencies (`backend-api-routes/package.json:2`, `:15`).

### 7.2 Routes in backend-api-routes/

| Route | Method |
|---|---|
| `/api/account/delete` | DELETE |
| `/api/billing/apple/verify` | POST |
| `/api/billing/entitlement` | GET |
| `/api/campaigns/[campaignId]/addresses/[addressId]/manual` | DELETE |
| `/api/campaigns/[campaignId]/addresses/manual` | POST |
| `/api/campaigns/[campaignId]/buildings/[buildingId]/addresses` | GET, POST, DELETE |
| `/api/campaigns/[campaignId]/buildings/[buildingId]/manual` | DELETE |
| `/api/campaigns/[campaignId]/buildings/manual` | POST |
| `/api/campaigns/[campaignId]/buildings` | GET |
| `/api/campaigns/provision` | POST |
| `/api/farms` | POST |
| `/api/integrations/boldtrail/connect` | POST |
| `/api/integrations/boldtrail/disconnect` | POST, DELETE |
| `/api/integrations/boldtrail/push-lead` | POST |
| `/api/integrations/boldtrail/status` | GET |
| `/api/integrations/boldtrail/test` | POST |
| `/api/integrations/fub/connect` | POST |
| `/api/integrations/fub/disconnect` | POST, DELETE |
| `/api/integrations/fub/oauth/callback` | GET |
| `/api/integrations/fub/oauth/start` | GET |
| `/api/integrations/fub/push-lead` | POST |
| `/api/integrations/fub/status` | GET |
| `/api/integrations/fub/test-push` | POST |
| `/api/integrations/fub/test` | POST |
| `/api/integrations/fub/voice-log` | POST |
| `/api/integrations/hubspot/disconnect` | POST, DELETE |
| `/api/integrations/hubspot/oauth/callback` | GET |
| `/api/integrations/hubspot/oauth/start` | GET |
| `/api/integrations/hubspot/push-lead` | POST |
| `/api/integrations/hubspot/status` | GET |
| `/api/integrations/hubspot/test` | POST |
| `/api/leads/sync-crm` | POST |

### 7.3 Divergence risk

Every route in `backend-api-routes/app/api/` has the same path present in `../flyrpro/app/api/`, but every file differs byte-for-byte from the sibling web implementation. That means these are duplicates with implementation divergence risk and need manual comparison before copying or editing.

| Route | flyrpro presence | Comparison |
|---|---|---|
| `/api/account/delete` | present | differs |
| `/api/billing/apple/verify` | present | differs |
| `/api/billing/entitlement` | present | differs |
| `/api/campaigns/[campaignId]/addresses/[addressId]/manual` | present | differs |
| `/api/campaigns/[campaignId]/addresses/manual` | present | differs |
| `/api/campaigns/[campaignId]/buildings/[buildingId]/addresses` | present | differs |
| `/api/campaigns/[campaignId]/buildings/[buildingId]/manual` | present | differs |
| `/api/campaigns/[campaignId]/buildings/manual` | present | differs |
| `/api/campaigns/[campaignId]/buildings` | present | differs |
| `/api/campaigns/provision` | present | differs |
| `/api/farms` | present | differs |
| `/api/integrations/boldtrail/connect` | present | differs |
| `/api/integrations/boldtrail/disconnect` | present | differs |
| `/api/integrations/boldtrail/push-lead` | present | differs |
| `/api/integrations/boldtrail/status` | present | differs |
| `/api/integrations/boldtrail/test` | present | differs |
| `/api/integrations/fub/connect` | present | differs |
| `/api/integrations/fub/disconnect` | present | differs |
| `/api/integrations/fub/oauth/callback` | present | differs |
| `/api/integrations/fub/oauth/start` | present | differs |
| `/api/integrations/fub/push-lead` | present | differs |
| `/api/integrations/fub/status` | present | differs |
| `/api/integrations/fub/test-push` | present | differs |
| `/api/integrations/fub/test` | present | differs |
| `/api/integrations/fub/voice-log` | present | differs |
| `/api/integrations/hubspot/disconnect` | present | differs |
| `/api/integrations/hubspot/oauth/callback` | present | differs |
| `/api/integrations/hubspot/oauth/start` | present | differs |
| `/api/integrations/hubspot/push-lead` | present | differs |
| `/api/integrations/hubspot/status` | present | differs |
| `/api/integrations/hubspot/test` | present | differs |
| `/api/leads/sync-crm` | present | differs |

## 8. What web developers must never change without iOS coordination

### 8.1 API routes — never modify without coordination

- `/api/access/redirect` -- changing response shape breaks app routing after sign-in.
- `/api/access/state` -- changing response shape breaks workspace/access gating.
- `/api/account/delete` -- changing auth or method breaks in-app account deletion.
- `/api/addresses-same-street` -- changing body/response breaks same-street address creation.
- `/api/auth/handoff` and `/api/auth/redeem-handoff` -- changing token/cookie contract breaks iOS-to-web authenticated handoff.
- `/api/billing/apple/verify` and `/api/billing/entitlement` -- changing entitlement shape breaks paywall/unlock behavior.
- `/api/billing/stripe/checkout` -- changing checkout URL response breaks Stripe checkout.
- `/api/brokerages/search` -- changing query or response breaks onboarding brokerage selection.
- `/api/buildings/{gersId}` -- changing gated scan fields breaks building detail UI.
- `/api/campaigns/*/addresses/*/manual` and `/api/campaigns/*/buildings*` -- changing request/response contracts breaks manual building/address linking and map data.
- `/api/campaigns/generate-address-list` -- changing body or inserted-count/preview response breaks address generation.
- `/api/campaigns/provision` -- changing provisioning response breaks campaign creation/provision state.
- `/api/daily-content` -- changing response breaks home screen content.
- `/api/farms` -- changing create contract breaks farm creation from iOS.
- `/api/integrations/boldtrail/*` -- changing contracts breaks BoldTrail connect/status/test/push/disconnect.
- `/api/integrations/fub/*` -- these alias routes exist specifically for iOS compatibility; changing them breaks Follow Up Boss iOS integration.
- `/api/integrations/hubspot/*` -- changing contracts breaks HubSpot OAuth/test/push/disconnect.
- `/api/integrations/monday/*` -- changing contracts breaks Monday OAuth/status/board selection/disconnect.
- `/api/invites/validate` and `/api/invites/accept` -- changing token or response contracts breaks join flow.
- `/api/leads/sync-crm` -- changing body/response breaks bulk CRM sync.
- `/api/onboarding/complete` -- changing body/response breaks workspace onboarding.
- `/api/routes/assignments*` -- changing route assignment contracts breaks route/session flows.
- `/api/share-card` -- changing image response breaks challenge share cards.

### 8.2 Database objects — never modify without coordination

- `campaigns`: iOS reads/writes campaign metadata, status, territory, provision fields, scans, owner/workspace fields.
- `campaign_addresses` and `campaign_addresses_v`: iOS reads address geometry/display fields and writes visit, transcript, summary, and status fields.
- `qr_codes`: iOS writes `address_id`, `campaign_id`, `farm_id`, `batch_id`, `qr_url`, `qr_image`, `metadata` and reads them for QR management.
- `qr_code_scans`: iOS reads and can insert scan analytics.
- `address_content`, `qr_sets`, `batches`, `campaign_qr_batches`: iOS QR management depends on these schemas.
- `buildings`, `building_address_links`, `building_stats`, `building_touches`, `building_units`: iOS map and visit flows depend on these objects.
- `contacts`, `field_leads`, `contact_activities`: iOS lead/contact flows depend on these schemas.
- `farms`, `farms_with_geojson`, `farm_leads`, `farm_phases`, `farm_touches`: iOS farm workflows depend on these schemas.
- `profiles`, `profile_images`, `user_settings`, `user_stats`, `workspace_members`, `workspaces`: iOS auth/profile/settings/team flows depend on these objects.
- `sessions`, `session_analytics`, `session_events`, `session_shares`, `session_checkins`, `session_heartbeats`, `safety_events`: iOS field session and safety flows depend on these objects.
- `user_integrations`, `crm_connections`: iOS integration status and CRM flows depend on these objects.
- RPCs: `get_address_scan_count`, `get_campaign_scan_count`, `record_campaign_address_outcome`, `record_campaign_target_outcome`, `upsert_address_status`, `rpc_complete_building_in_session`, `rpc_upsert_campaign_roads`, `get_campaign_address_counts`, `get_campaign_address_centroids`, `get_campaign_confidence_hotspots`, `get_buildings_by_address_ids`, `primary_workspace_id`, `get_my_assigned_routes`, `get_route_plan_detail`, `get_or_create_support_thread`, and challenge RPCs listed in section 5.

## 9. Safe changes

- Add new nullable columns to shared tables, as long as existing columns, defaults, constraints, RLS policies, and RPC return fields remain compatible.
- Add new web API routes that iOS does not call.
- Add optional fields to API responses, as long as required existing fields and status codes remain unchanged.
- Add new CRM providers or web-only integration routes without changing existing `/api/integrations/fub/*`, `/boldtrail/*`, `/hubspot/*`, or `/monday/*` contracts.
- Change web UI components, page layout, marketing copy, and dashboards that do not alter API routes, database schemas, or shared RPCs.
- Add new Supabase RPC functions without changing or replacing the functions listed in section 5.
- Improve backend internals behind existing routes if method, auth, request body, response shape, side effects, and status-code semantics stay backward compatible for iOS.
