# Business cards — implementation and release checklist

Implemented across Wolfgrid-WEB, WolfGrid-IOS, and WolfGrid-ANDROID. Existing unrelated working-tree changes were preserved. The additive Supabase migration was deployed to the public production project on September 18, 2026. Web/native release and workspace enablement remain pending.

## Experience

More → My Business Card edits/publishes a workspace-specific rep card. Existing profile data prefills the editor; blank socials are hidden and their order is editable. The public `/c/{token}` card includes prominent social links, call/text/email, vCard download, external reviews, and two referral flows. The editor accepts a photo URL and otherwise uses initials.

Send Business Card in the map Lead form or saved lead detail saves the lead before creating an opaque 192-bit URL and opening the native text composer. iOS records available composer results; Android records handoff only. Neither platform claims carrier delivery. A failed link request retains the lead and request idempotency key. Locally queued Android leads must finish syncing and be sent from the lead list.

## Backend contracts

All private `/api/cards` calls use the existing bearer/cookie auth resolver and require an explicit `workspaceId`, membership, and an enabled feature row. Contact history and sending require the contact's owner, not merely workspace membership.

- `GET/POST profile`: `{profile:{id,content,published}}`; content fields are name, title, company, bio, phone, email, photo, reviewUrl and ordered `{platform,url}` socials.
- `POST shares`: `{contactId,addressId?,idempotencyKey}` → `{id,url,message,phone}`. Existing `contacts.address_id` and legacy `campaign_address_id` are reconciled; conflicts fail closed.
- `POST shares/{id}/composer`: `{type,eventId}`. Types: composer_opened, composer_cancelled, composer_sent, composer_failed.
- `POST shares/{id}/revoke`: revokes that URL and access through its referral descendants.
- `GET activity?contactId=…` or `?addressId=…`: owner-scoped shares, events and referral provenance.
- `GET engagement?campaignId=…`: workspace-scoped address engagement for map rendering.
- `POST public/{token}/events`: `{visitId,eventId,type,detail?,visibleMs?}`. A qualified view requires 2 seconds visible; explicit actions can qualify a visit. This is a heuristic, not proof of viewer identity.
- `GET public/{token}/contact`: vCard. Contact-save analytics describe a download/click, not successful device address-book insertion.
- `POST public/{token}/referral-link`: `{idempotencyKey}` → child URL with no original household attribution.
- `POST public/{token}/referrals`: `{submissionId,name,phone,email,note,referrerName,permission:true}`. Requires phone or email. Creates or matches a contact only within the originating rep/workspace; ambiguous matches create a separate contact. Retains notes on referral provenance without overwriting an existing lead.

The public page serializes only published profile fields and the opaque token. It never serializes the recipient/contact/property IDs. GETs do not record views. Known previews are ignored and public writes have a database-backed per-link/IP rate limit. Referral submission and event aggregation are transactional and idempotent. Republishing updates existing cards; revocation prevents future use but does not erase historical engagement.

## Map integration

`card_property_engagement` contains campaign/address/building identity, count and last engagement. Qualified card opens do not write QR counters, canvassing dispositions, visits or session metrics. Clients subscribe to its realtime changes and periodically reconcile, including foreground/reload paths. Native and web renderers apply the QR purple priority; teammate ownership priority remains intact. Referrals do not inherit the original household address.

## Validation

- `npx tsx lib/cards/__tests__/contracts.test.ts`
- `node scripts/test-business-card-api.mjs` — actual Next route with deterministic database adapter; checks auth, membership, gate, ownership, property match, unique sends, retries, revocation and publishing.
- `PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/test-business-cards.mjs` — production migration/RPCs in isolated PostgreSQL. Checks repeat opens, deduplication, address isolation, unchanged QR counters/status, referral deduplication, RLS, revocation, unpublishing and rate limits.
- `node scripts/business-card-preview.mjs` — local UI fixture at port 4318. Not a production API or delivery test. Browser verified light/dark at 390px, no horizontal overflow, no console errors, qualified-open event and referral confirmation.
- Native builds: WolfGrid iOS arm64 simulator passed; Android productionDebug compile and 258 JVM tests passed. New Android map tests cover card priority while retaining disposition and adjacent-unit state.

## Release status / outstanding acceptance

1. Migration `20260918140000_business_cards.sql` is mirrored in web and iOS. Apply **only** to verified public Supabase project `kfnsnwqylsdsbgnwgxva`. The iOS checkout is currently linked to internal Sales project `yxxuazvosddtajwitlxu`; do not deploy from its linked configuration.
2. Deployment access restored September 18, 2026 by authorizing the CLI with the account that owns FLYR APP. Applied only `20260918140000_business_cards.sql` in a transaction and recorded it in migration history. Verified all seven tables have RLS, engagement realtime is registered, anonymous event RPC execution is denied, and zero workspaces are enabled. The old direct database password was not changed; deployment used the authenticated linked CLI.
3. Confirm the target test workspace. Enable just that workspace with a `card_workspace_features` row after migration and deployment; default is disabled everywhere. Workspace choice is pending.
4. Deploy only the card feature and its two web map integrations from an isolated release tree. Do not deploy unrelated dirty changes. Repository-wide TypeScript checking currently fails in unrelated integrations, session-start and demo code; changed card files have been checked independently.
5. Install the final native builds and verify a real text send → card open → correct purple unit → social click → referral on both physical platforms. Composer cancellation/offline recovery and foreground map refresh remain physical-device acceptance work. Simulator/compiler/JVM/browser fixtures are not substitutes.
6. Roll back exposure by disabling the workspace gate or unpublishing profiles. Keep additive tables and historical engagement; no destructive schema rollback is required.

Deferred as agreed: provider SMS/email delivery, push notifications, hosted reviews, automated follow-up, appointments/estimates, engagement scoring, and management funnels.
