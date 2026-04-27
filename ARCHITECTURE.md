# FLYR PRO — Architecture & Developer Guide

> **If you just joined this project, read this document first.**  
> It explains what this product does, how the codebase is structured, what is safe to touch, and what will break production if you get it wrong. The existing README covers setup steps. This document covers the mental model you need before writing a single line of code.

---

## Table of contents

1. [What this product is](#1-what-this-product-is)
2. [The two repositories](#2-the-two-repositories)
3. [Tech stack](#3-tech-stack)
4. [Getting the app running locally](#4-getting-the-app-running-locally)
5. [Core data flow](#5-core-data-flow)
6. [The QR system](#6-the-qr-system)
7. [Authentication](#7-authentication)
8. [Billing](#8-billing)
9. [Database](#9-database)
10. [iOS coupling — read this before touching anything](#10-ios-coupling--read-this-before-touching-anything)
11. [What is safe to change](#11-what-is-safe-to-change)
12. [Known issues and technical debt](#12-known-issues-and-technical-debt)
13. [How to contribute](#13-how-to-contribute)

---

## 1. What this product is

FLYR PRO is a field prospecting platform for real estate agents. It has two surfaces:

**The web app (this repo)** is the management layer. Campaign owners use it to:
- Create campaigns and define target areas on a map
- Generate address lists from those areas using a cascading geocoder
- Generate QR codes for each address
- Export QR codes and print manifests for professional printers
- View scan analytics when homeowners scan a flyer
- Manage teams, routes, billing, and CRM integrations

**The iOS app (`FLYR` repo)** is the field tool. Agents use it to:
- Work assigned territories and routes
- Record outcomes at each door (talked, no answer, appointment, etc.)
- Run sessions and track their activity
- View leaderboards and challenges
- Sync leads to CRM systems (Follow Up Boss, HubSpot, BoldTrail, monday.com)

Both apps share the same Supabase database. A campaign created on the web is immediately visible in the iOS app. A door outcome recorded in iOS immediately appears in the web analytics dashboard. **They are not independent systems.**

The product is also sold under the domain `flyr.software`. Both `flyrpro.app` and `flyr.software` point to the same Vercel deployment. The `flyr.software` domain is used for partner offer links and email branding; `flyrpro.app` is used for auth callbacks, QR scan redirects, and everything else. Pick `flyrpro.app` as canonical if you ever need to hardcode one.

---

## 2. The two repositories

| Repo | Purpose | Stack |
|------|---------|-------|
| `flyrpro` (this repo) | Web management app | Next.js 15, TypeScript, Supabase, Stripe |
| `FLYR` | iOS field app + supporting infrastructure | Swift/Xcode, Supabase SDK, FastAPI backend, Next.js API routes |

The iOS repo contains a `backend-api-routes/` directory described as "copy to flyrpro.app." Some API routes exist in both repos and may have diverged. Before modifying any route that the iOS app calls (see Section 10), check whether a copy exists in `FLYR/backend-api-routes/` and whether it differs.

The iOS repo also contains its own Supabase migration history. Both repos have been applying migrations to the same production database. The web repo's `supabase/migrations/` folder does **not** contain all migrations — some tables (including `campaign_addresses` and `qr_codes`) were created by iOS repo migrations and have no `CREATE TABLE` in this repo.

---

## 3. Tech stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 15 (App Router) | TypeScript throughout |
| Database | Supabase (PostgreSQL) | Auth, Storage, RLS, RPCs, Realtime |
| ORM | None for main app | Drizzle used for editor-only tables only |
| Payments | Stripe + Apple IAP | Both active — see Section 8 |
| Maps | Mapbox | Style IDs currently hardcoded in components |
| Email | Resend | Invite and partner offer emails |
| Geodata | AWS S3 + MotherDuck/DuckDB | Address/building pipeline |
| AI | Google Gemini + Replicate | Flyer generation |
| CRM | Follow Up Boss, HubSpot, BoldTrail, monday.com, Zapier | OAuth-based integrations |
| Deployment | Vercel | Node.js 20, region iad1 |
| Node version | 20 | See `.nvmrc`. Do not use Node 14 — it will fail. |

---

## 4. Getting the app running locally

### Prerequisites

- Node 20 (`node --version` must return `v20.x.x`)
- If you are on a Mac with Fish shell, ensure `/opt/homebrew/opt/node@20/bin` is in your PATH ahead of any other Node installation

### Steps

```bash
git clone https://github.com/danielphillippe27-netizen/flyrpro
cd flyrpro
nvm use          # uses .nvmrc — requires nvm
npm install --ignore-scripts   # --ignore-scripts skips DuckDB native compilation (not needed for web dev)
cp .env.example .env.local     # then fill in the values below
npm run dev
```

### Required environment variables

The `.env.example` file documents the minimum set. The full list grouped by service:

**Supabase (required for anything to work)**
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Stripe (required for billing flows)**
```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRO_MONTHLY_PRICE_ID=
STRIPE_PRO_ANNUAL_PRICE_ID=
STRIPE_TEAM_PRICE_ID=
```

**Mapbox (required for map views)**
```
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=
```

**Apple IAP (required for iOS billing verification)**
```
APPLE_APP_STORE_SERVER_ISSUER_ID=
APPLE_APP_STORE_SERVER_KEY_ID=
APPLE_BUNDLE_ID=
APPLE_APP_STORE_SERVER_PRIVATE_KEY=
APPLE_ENVIRONMENT=
```

**AWS / S3 (required for geodata pipeline)**
```
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_S3_BUCKET=
```

**Email (required for invites and partner offers)**
```
RESEND_API_KEY=
```

**CRM OAuth (required for CRM integration flows)**
```
FOLLOWUPBOSS_CLIENT_ID=
FOLLOWUPBOSS_CLIENT_SECRET=
HUBSPOT_CLIENT_ID=
HUBSPOT_CLIENT_SECRET=
MONDAY_CLIENT_ID=
MONDAY_CLIENT_SECRET=
OAUTH_STATE_SECRET=
```

**AI (required for flyer generation)**
```
GOOGLE_GEMINI_API_KEY=
REPLICATE_API_TOKEN=
```

**MotherDuck (required for address/building data pipeline)**
```
MOTHERDUCK_TOKEN=
```

For local development on the QR fix and campaign management, you only need the Supabase block and `NEXT_PUBLIC_APP_URL`. Everything else can be omitted — the routes that need it will fail gracefully or return 500s, but the core app will run.

### What to expect on first boot

The app will start at `http://localhost:3000`. Without Supabase credentials it renders the marketing shell but all data routes return errors. With credentials it connects to the production database — the same one live users are on. Be careful running any write operations locally.

There is currently no staging environment. If you need one, create a free second Supabase project and import the schema.

---

## 5. Core data flow

This is the end-to-end journey from campaign creation to scan analytics.

### Step 1 — Campaign created
- Web UI calls `POST /api/campaigns`
- Route at `app/api/campaigns/route.ts:25` writes a row to `campaigns` table
- Campaign requires a `workspace_id` — the user must be in a workspace

### Step 2 — Addresses added
Two paths depending on how addresses are sourced:

**From map selection (primary path):**
- User draws a territory on the map
- Web calls `POST /api/campaigns/provision` (`app/api/campaigns/provision/route.ts:56`)
- Provisioning runs the cascading geocoder and writes rows to `campaign_addresses`
- Building matching links each address to a `buildings` row via `building_address_links`

**From CSV upload (legacy path):**
- User uploads a CSV file
- `POST /api/upload-csv` (`app/api/upload-csv/route.ts:13`) parses and inserts to `campaign_addresses`

### Step 3 — QR codes generated
- Campaign page calls `POST /api/generate-qrs` (`app/api/generate-qrs/route.ts`)
- Route fetches all `campaign_addresses` for the campaign
- For each address: generates a PNG using the `qrcode` npm library, encodes a tracking URL, converts to base64
- Writes `qr_code_base64` and `purl` to each `campaign_addresses` row
- **Current issue:** Does not write to the `qr_codes` table or Supabase Storage. This breaks ZIP download and VDP manifest export. See Section 6.

### Step 4 — Flyer printed
- Campaign page calls `POST /api/canva/generate` after QR generation
- Canva-style QR URLs are embedded in a generated flyer template
- Professional printers use `GET /api/campaigns/[campaignId]/vdp-manifest` for Variable Data Printing
- **Current issue:** VDP manifest filters on `qr_png_url` which is never written. Returns empty. See Section 6.

### Step 5 — Homeowner scans QR
Three different scan handlers exist depending on which URL was encoded in the QR:

| URL format | Handler | Used by |
|-----------|---------|---------|
| `/api/scan?id={address_id}` | `app/api/scan/route.ts` | Current web-generated QR codes |
| `/api/q/{slug}` | `app/api/q/[slug]/route.ts` | Modern slug-based QR codes (not yet generated) |
| `/address/...` or `/qr/...` | Unknown / Edge Function | iOS-generated QR codes |
| `/api/open?id={id}` | `app/api/open/route.ts` | Legacy — still active for older codes |

### Step 6 — Scan recorded
**Via `/api/scan`:**
- Inserts row into `scan_events`
- Calls `increment_building_scans` RPC → updates `building_stats`
- Calls `increment_scan` RPC → increments scan count on `campaign_addresses`
- Redirects to `campaign.video_url` or app fallback

**Via `/api/q/[slug]`:**
- Looks up slug in `qr_codes` table
- Inserts row into `qr_code_scans`
- Calls `record_public_qr_scan_outcome` RPC on first scan
- Increments `campaigns.scans` count
- Redirects to landing page or direct URL

### Step 7 — Analytics updated
- Campaign page reads scan counts from `campaign_addresses.scans`
- QR analytics service (`lib/services/QRCodeService.ts`) reads from `qr_code_scans`
- Building map visualizes scan density from `building_stats`
- Team dashboard aggregates from `session_events` and `sessions`

---

## 6. The QR system

**This is the most important section for any developer working on campaigns.**

There are currently two QR generation systems that are not connected to each other. Understanding why is critical before touching anything.

### System A — Web (current, partially broken)

`POST /api/generate-qrs` generates QR codes and writes:
- `campaign_addresses.qr_code_base64` — the full PNG as a base64 data URI stored directly in the database row
- `campaign_addresses.purl` — a tracking URL pointing at `/api/scan?id={address_uuid}`

This system **works for display** — `RecipientsTable` renders the base64 image correctly.

This system **breaks for export** — `zip-qrs` and `vdp-manifest` both filter on `qr_png_url` which this system never writes, so both return empty results for any campaign generated today.

### System B — iOS (active, independent)

The iOS app generates QR codes natively using `CIFilter.qrCodeGenerator` in Swift. It writes directly to the `qr_codes` table in Supabase. iOS-generated QR codes encode URLs like:
- `https://flyrpro.app/address/{address_id}`
- `https://flyrpro.app/qr/{slug}`

These are different URL formats from the web system and hit different handlers.

### System C — Slug-based (designed but not yet wired)

`app/api/q/[slug]/route.ts` is a fully implemented modern QR handler with bot filtering, `qr_code_scans` tracking, and landing page support. `QRCodeService.ts` has a complete `createQRCodeWithDestination()` method for inserting into the `qr_codes` table.

This system is never called by `generate-qrs`. It exists and works — nothing feeds into it from the web generation flow yet.

### The fix (planned in Phase 3)

Make `generate-qrs` write to `qr_codes` in addition to `campaign_addresses`, encode `/q/{slug}` in the QR image, and update `zip-qrs` and `vdp-manifest` to read from `qr_code_base64` instead of `qr_png_url`.

**This fix is iOS-safe.** The iOS app does not call `generate-qrs`, `zip-qrs`, or `vdp-manifest`.

### Scan tracking tables

| Table | Written by | Read by |
|-------|-----------|---------|
| `scan_events` | `/api/scan` | Campaign analytics, building map |
| `qr_code_scans` | `/api/q/[slug]`, iOS app | QR analytics service |
| `building_stats` | `/api/scan` via RPC | Building heat map |

---

## 7. Authentication

### Web flow
1. User visits `/login`
2. Login page checks for existing session and redirects to `/gate` if already authenticated
3. Email sign-in: attempts login first, then sign-up if credentials not found
4. Google OAuth and Apple OAuth are also available from the login page
5. Auth callback at `app/auth/callback/route.ts` exchanges the Supabase code for a session
6. Successful callback redirects to `/gate`

### The `/gate` route
`/gate` is the central post-auth router. It calls `getPostAuthRedirect` in `app/lib/post-auth-gate.ts` which handles:
- Invite link deep links
- First-time onboarding (no workspace yet)
- Subscription gate (workspace owner without active subscription)
- Inactive team member (contact owner state)
- Founder dashboard shortcut
- Default: redirect to `/home`

### Middleware
`middleware.ts` creates a Supabase SSR client and refreshes the session on every request. It does **not** redirect or enforce auth — that is handled by individual routes and the gate logic.

### iOS Bearer token auth
Some API routes support both cookie-based auth (web) and Bearer token auth (iOS). Example: `app/api/buildings/[gersId]/route.ts` explicitly handles both patterns. If you modify any of these routes, preserve both auth paths.

### Apple Sign In vs email
Apple Sign In on iOS creates a separate Supabase identity from email sign-up on web, even if the same iCloud email is used. Whether Supabase links these identities is controlled by Supabase provider configuration, not this codebase.

---

## 8. Billing

### Two billing systems

**Stripe** handles web subscriptions:
- Checkout: `POST /api/billing/stripe/checkout`
- Portal: `POST /api/billing/stripe/portal`
- Webhooks: `POST /api/billing/stripe/webhook`
- Subscription lifecycle events update the `entitlements` table

**Apple IAP** handles iOS subscriptions:
- Verification: `POST /api/billing/apple/verify` — called directly by the iOS app
- Transaction result updates the same `entitlements` table

Both systems write to `entitlements` through `mergeEntitlementUpdate` in `app/lib/billing/entitlements.ts`. This function prevents an inactive Apple subscription from downgrading an active Stripe subscription and vice versa.

### Subscription tiers

| Plan | Access |
|------|--------|
| `free` | Default. Limited features. |
| `pro` | Full single-user access. Unlocks ZIP download, full analytics. |
| `team` | Pro features plus team management, leaderboards, route assignment. |

### Paywall enforcement
- `getEntitlementForUser()` in `app/lib/billing/entitlements.ts` — checks the `entitlements` table
- `canUsePro()` — returns true if plan is `pro` or `team` and `is_active` is true
- Example enforced in: `app/api/zip-qrs/route.ts:39-50` (ZIP download requires Pro)
- Workspace subscription status is also checked separately in `app/api/access/state/route.ts`

---

## 9. Database

### Source of truth problem

**The `supabase/schema.sql` file in this repo is not the production schema.** It reflects the original MVP and only defines `campaigns`, `campaign_recipients`, `user_profiles`, and `crm_connections`.

The actual production database has been built up through:
1. Migrations in this repo (`supabase/migrations/` — 150+ files)
2. Migrations in the iOS repo (`FLYR/supabase/migrations/` — separate history)
3. Manual SQL applied directly in the Supabase dashboard

**`campaign_addresses` and `qr_codes` — the two most important tables — have no `CREATE TABLE` statement in this repo.** They were created by iOS repo migrations.

Until `supabase/schema.current.sql` is created (planned in P1-9), the Supabase dashboard is the only place to see the real schema.

### Row Level Security

RLS is enabled on most tables. The admin/service-role client (used in API routes via `createAdminClient()`) bypasses RLS. User-scoped clients (used in some routes and all client-side code) are subject to RLS policies.

Key RLS policies:
- `campaign_addresses` — workspace members can manage rows for campaigns in their workspace (`supabase/migrations/20260218223000_workspace_rls_child_tables_phase1_1.sql`)
- iOS-specific tables (`address_content`, `campaign_qr_batches`, `building_touches`, `crm_object_links`, `crm_events`) have their own policies defined in the iOS schema alignment migration

### Tables the iOS app reads and writes directly

The following tables must not have columns removed, renamed, or type-changed without coordinating with iOS development:

- `campaigns`
- `campaign_addresses`
- `qr_codes`
- `qr_code_scans`
- `buildings`
- `building_address_links`
- `building_stats`
- `workspaces`
- `workspace_members`
- `sessions`
- `session_events`
- `contacts`
- `address_content` (iOS-only)
- `campaign_qr_batches` (iOS-only)
- `building_touches` (iOS-only)
- `crm_object_links` (iOS-only)
- `crm_events` (iOS-only)

### RPCs the iOS app calls directly

- `record_campaign_address_outcome`
- `get_address_scan_count`
- `get_campaign_scan_count`
- `rpc_get_campaign_addresses`
- `rpc_get_campaign_full_features`
- `rpc_complete_building_in_session`

Do not modify or drop these functions without iOS coordination.

### Running migrations

There is currently no `supabase/config.toml` and no configured local Supabase setup. Migrations are applied manually via the Supabase dashboard SQL editor. Until a local dev environment is established, do not run `supabase db reset` — it will produce an incomplete schema because the iOS-repo-created tables are missing from this repo's migrations.

---

## 10. iOS coupling — read this before touching anything

The iOS app (`FLYR`) calls the following web API routes **in production right now**:

| Route | Called from |
|-------|------------|
| `POST /api/campaigns/provision` | `FLYR/Feautures/Campaigns/CampaignsAPI.swift:555` |
| `GET /api/campaigns/[campaignId]/buildings` | `FLYR/Feautures/Campaigns/API/BuildingsAPI.swift:584` |
| `POST /api/campaigns/generate-address-list` | `FLYR/Services/OvertureAddressService.swift:185` |
| `POST /api/addresses-same-street` | `FLYR/Services/OvertureAddressService.swift:277` |
| `POST /api/auth/handoff` | `FLYR/Services/OvertureAddressService.swift:344` |
| `POST /api/auth/redeem-handoff` | `FLYR/Services/OvertureAddressService.swift:365` |
| `GET /api/billing/entitlement` | `FLYR/Features/Billing/EntitlementsService.swift:82` |
| `POST /api/billing/apple/verify` | `FLYR/Features/Billing/EntitlementsService.swift:120` |
| `GET /api/access/redirect` | `FLYR/Features/Auth/Services/AccessAPI.swift:91` |
| `GET /api/access/state` | `FLYR/Features/Auth/Services/AccessAPI.swift:110` |
| All CRM push-lead routes | `FLYR/Features/Integrations/Services/` |
| All invite routes | `FLYR/Features/Invites/Services/InviteService.swift` |

**If you modify any of these routes, you may break the iOS app for live users.**

The iOS app also uses FUB alias routes under `/api/integrations/fub/*` which exist specifically for iOS compatibility — do not remove these even if the underlying FUB routes are refactored.

The iOS app calls Supabase Edge Functions directly:
- `/functions/v1/tiledecode_roads`
- `/functions/v1/tiledecode_buildings`
- `/functions/v1/process-voice-note`
- `/functions/v1/crm_sync`

These are not in this repo but run against the shared Supabase project.

---

## 11. What is safe to change

### Safe without iOS coordination

These files and routes are web-only. The iOS app does not call them and does not depend on their output:

- `app/api/generate-qrs/route.ts`
- `app/api/zip-qrs/route.ts`
- `app/api/campaigns/[campaignId]/vdp-manifest/route.ts`
- `components/RecipientsTable.tsx`
- `campaign_addresses.qr_code_base64` column (iOS does not read this)
- `campaign_addresses.purl` column (iOS does not read this)
- All web UI components not related to auth or billing
- The editor routes (`app/api/editor/*`)
- Partner offer routes
- Challenge and leaderboard routes (web UI only)

### Requires iOS coordination

- Any route listed in Section 10
- Any column on a table listed in Section 9
- Any RPC listed in Section 9
- The `qr_codes` table structure
- The `qr_code_scans` table structure
- Auth flow changes (affects both web and iOS sessions)
- Billing and entitlement logic
- Workspace and membership schema

### Requires owner decision before coding

- Scope of the flyer editor (stub vs implement vs gate)
- Which features are in the launch scope vs gated
- Canonical domain (flyrpro.app vs www.flyrpro.app)
- Whether `campaign_recipients` is fully retired

---

## 12. Known issues and technical debt

### Broken right now

| Issue | Location | Impact |
|-------|---------|--------|
| ZIP download always returns empty | `app/api/zip-qrs/route.ts:65` — filters on `qr_png_url` which is never written | Users cannot download QR code ZIPs |
| VDP manifest always returns empty | `app/api/campaigns/[campaignId]/vdp-manifest/route.ts:80` — same filter | Print exports are broken |
| NewCampaignDialog does not create campaigns | `components/NewCampaignDialog.tsx` — demo stub | Primary CTA on dashboard does nothing |
| Flyer export returns 501 | `app/api/flyers/[flyerId]/export/route.ts:7` | Export button leads to error |
| FlyerService has no persistence | `lib/services/FlyerService.ts:29` — all TODOs | Flyer instances are not saved |
| `/landing-pages/create` does not exist | `app/(main)/create/page.tsx:21` — routes to missing page | Dead end in create flow |

### TypeScript and ESLint are disabled in builds

`next.config.js` has `eslint.ignoreDuringBuilds: true` and `typescript.ignoreBuildErrors: true`. A successful Vercel deployment does not mean the code is type-safe. These will be re-enabled as part of Phase 2 cleanup.

### Hardcoded values

`https://flyrpro.app` and `https://www.flyrpro.app` are hardcoded as string literals in at least 15 places across the codebase. These should all read from `process.env.NEXT_PUBLIC_APP_URL`.

### Schema source of truth

There is no single file that accurately describes the production database schema. `supabase/schema.sql` reflects the original MVP only. A `supabase/schema.current.sql` reflecting the actual production state needs to be created from a Supabase dashboard export.

### Deprecated packages with security advisories

`npm audit` reports 51 vulnerabilities (5 low, 35 moderate, 11 high) as of April 2026. These come from transitive dependencies of `duckdb`, `geographiclib`, and several other packages. Address separately — do not run `npm audit fix --force` without testing, as it will introduce breaking changes.

---

## 13. How to contribute

### Branch naming

```
harry/pr{n}-{description}
# examples:
harry/pr2-config-cleanup
harry/pr3-qr-unification
```

### Before opening a PR

1. Check Section 10 — if your change touches any iOS-coupled route or table, coordinate first
2. Check Section 11 — confirm your change is in the safe zone or has been cleared
3. Run `npm run dev` locally and verify the affected flows work
4. Once TypeScript gates are re-enabled (Phase 2), run `tsc --noEmit` before pushing

### PR description template

```
## What this does
One paragraph explaining the change and why it was needed.

## What I tested
List the specific flows you verified locally.

## iOS safe?
Yes — this change only touches [list files].
OR
Coordinated with [name] — confirmed safe on [date].

## Screenshots (if UI changed)
```

### Never do these without explicit coordination

- Rename or remove a column on any table listed in Section 9
- Modify or drop an RPC listed in Section 9
- Change the behavior of any route listed in Section 10
- Apply a database migration without adding it to `supabase/migrations/`
- Apply a migration directly in the Supabase dashboard without committing the SQL to this repo

### Adding new env vars

When you add a new environment variable:
1. Add it to `.env.example` with a comment explaining what it is and where to get it
2. Add it to `lib/supabase/env.ts` or the appropriate config file with a clear error if missing
3. Document it in this file under Section 4

---

*Next review: after schema.current.sql is created (P1-9)*