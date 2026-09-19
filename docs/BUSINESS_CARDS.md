# Business cards — implementation and release checklist

Implemented across Wolfgrid-WEB, WolfGrid-IOS, and WolfGrid-ANDROID. Existing unrelated working-tree changes were preserved. The additive Supabase migration was deployed to the public production project on September 18, 2026. Web/API production release is live. Development builds are installed on the connected iPhone 16 Pro and Samsung SM-G991W. Persistent user-workspace enablement and physical end-to-end acceptance remain pending.

## Experience

More → My Business Card automatically saves and publishes a workspace-specific rep card when any personal or business detail is present. There is no separate iOS publish switch. Blank cards (including appearance-only changes) remain unpublished. Sending an existing populated card upgrades its old unpublished flag before creating the share. Existing profile data prefills the editor; blank socials are hidden and their order is editable. The public `/c/{token}` card includes prominent social links, call/text/email, vCard download, external reviews, and two referral flows. The visual editor supports device photo-library uploads for the company logo and profile photo, with URL fields as an alternative. The company logo appears in the header; the circular profile photo overlaps the header edge. Editing is also available from Settings.

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
3. Production web/API deployed September 18, 2026 to `https://wolfgrid.app`, deployment `dpl_ALPKye3cLYefFnjrrjpEmWDno4de` (READY). Isolated release worktree `/tmp/wolfgrid-card-release`, branch `codex/business-card-release`, based on then-current production `33e3d7623` to preserve the login fix. Card implementation commit `c37e47b7e`; referral follow-up commit `61a214a11`. Next.js 15.5.9 production build passed using Node 22.22.2. The existing build configuration skips repository-wide type/lint checks; focused card tests passed.
4. Applied and registered follow-up `20260918210000_business_card_referral_address.sql`: production contacts require a non-null address, so new contact-only referrals explicitly use an empty address without household IDs. The SQL test fixture now enforces this production constraint.
5. Authenticated live production API verification passed in a temporary synthetic workspace: disabled gate, profile publishing, distinct shares, retry idempotency, public page without recipient IDs, no GET engagement, two-second qualification, repeat visits and deduplication, social action, both referral flows, empty referral address and no inherited household IDs, unchanged printed-QR count and lead status, activity history, and parent revocation. All synthetic fixtures and the temporary feature gate were removed.
6. iOS signed Debug device build passed and was installed/launched on Daniel's iPhone 16 Pro (`com.danielphillippe.FLYR`). Android productionDebug build and JVM tests passed and APK installed/launched on Samsung SM-G991W (`software.flyr.app.debug`); More → My Business Card was verified on-device. These are direct development installs, not App Store/TestFlight/Google Play releases. Builds include the current native checkout, including existing concurrent work.
7. Persistent rollout workspace remains pending the user's workspace name and WolfGrid account email because several workspaces have duplicate names. No existing workspace gate was enabled. A real personal text send → public open → correct purple unit → social click → referral, composer cancellation/offline recovery, and foreground refresh remain physical-device acceptance work.
8. Roll back exposure by disabling the workspace gate or unpublishing profiles. Keep additive tables and historical engagement; no destructive schema rollback is required.

Deferred as agreed: provider SMS/email delivery, hosted reviews, automated follow-up, appointments/estimates, engagement scoring, and management funnels.

## Visual editor update

My Business Card now opens a tappable native card preview on iOS and Android. Company/logo, photo, identity, contacts, social links, bio, and review links open focused editors. Header, Save Contact button, and background colours are saved in the profile `theme` object; public cards compute readable foreground colours. iOS uses native colour pickers; Android supports presets and validated hex colours. Older clients preserve stored themes. Native social marks are bundled. Web custom-colour rendering and live profile round-trip/legacy preservation passed; Samsung custom-colour editing was exercised. The user workspace is still disabled until a specific activation target is provided.

## Card image uploads

`POST /api/cards/images?workspaceId=…&kind=photo|companyLogo` takes a raw JPEG, PNG, or WebP body up to 3 MB. It requires authenticated membership and an enabled card workspace. Uploads are limited to 12 per minute per rep/workspace. Native pickers resize images before transfer; the server decodes, auto-rotates, strips metadata, and stores WebP in the public `business-card-images` bucket under workspace/user/random paths. Transparent logos are preserved. Bucket writes use the authorized API; public clients have no direct write policy. Apply migration `20260918220000_business_card_images.sql` to the public project. Uploaded artwork becomes part of the published card when the rep saves the profile.

Run `npx tsx lib/cards/__tests__/images.test.ts` and `node scripts/test-business-card-api.mjs` for image processing and upload access tests. Use a Linux build for production (`vercel deploy --prod` performs the remote build). A macOS `vercel build` / `--prebuilt` artifact carries macOS Sharp binaries and must not be deployed to the Linux runtime. The processor is loaded only by the upload handler so it cannot break other card endpoints at module initialization.

Native upload build checks passed for both platforms; the updated iPhone development build was installed. The Samsung was disconnected for this update, so its upload build still needs installation and both system picker flows need physical-device acceptance.

Production upload release verified September 18, 2026: `dpl_6dLa9cpEfogDNsFTwWHdDrPPANat`, source `2ea17247f`. Both binary uploads returned workspace/user-scoped URLs, public WebP images served successfully, saved profile artwork appeared in the public card, and the existing authenticated tracking/referral smoke passed. Synthetic users, workspace, leads and uploaded storage objects were removed. Linux release was explicitly promoted after restoring the prior deployment during the native-binary packaging fix. User workspace activation remains unchanged.

## General availability

Business cards are now enabled in production for all 232 existing workspaces, with zero missing or disabled gates after the rollout. Applied and registered `20260919010000_business_cards_available_to_all.sql` to public project `kfnsnwqylsdsbgnwgxva`; mirrored the migration in iOS. This supersedes the pending workspace activation notes above.

New workspaces receive an enabled feature row automatically through an insert trigger. New feature rows default to enabled. Card profiles still default to unpublished; membership, ownership, RLS, and upload limits remain unchanged. The subsequent API/iOS automatic-publishing change derives publication from saved details. An explicit workspace disable remains available for operational rollback. No app or API deployment is required.

PGlite regression checks passed for existing disabled/missing gates, new workspace activation by a non-admin database role, unpublished defaults, cascading cleanup, and existing engagement/referral/access isolation. Production verification confirmed all existing workspace gates and the installed trigger. Physical iOS retry remains device acceptance work.

## iOS activity push notifications

Migration `20260919020000_business_card_push.sql` is applied and registered on public project `kfnsnwqylsdsbgnwgxva`. New card opens and tracked button clicks enqueue durable push jobs. Repeated requests for the same action/platform/visit are deduplicated. The authenticated cron retries leased jobs, up to six attempts; successful device deliveries are retained across partial failures. Only the originating rep receives the alert. Removed membership, unpublished cards, and revoked links are checked again before dispatch. No historical events are backfilled.

The Next.js event route dispatches after its response, with `/api/cron/card-notifications` as the minute-by-minute retry path protected by `CRON_SECRET`. APNs uses HTTP/2 with a seven-second timeout and per-job collapse IDs. Production uses `APNS_KEY_ID`, `APNS_PRIVATE_KEY`, `APNS_TEAM_ID`, and `APNS_BUNDLE_ID`. Optional `APNS_SANDBOX_KEY_ID` and `APNS_SANDBOX_PRIVATE_KEY` support development builds separately.

The public backend now includes authenticated device registration. iOS requests notification permission in the business-card editor, refreshes registration for the signed-in user, and opens account-scoped activity history from the notification. The existing lead and address identifiers stay associated with the share; forwarded links cannot establish viewer identity. Android/FCM push delivery is not part of this iOS implementation.

Verification: database queue/RLS/lease and existing SQL regressions, actual card API tests, mocked APNs partial-success/retry tests, signed iOS build, and production synthetic open/click -> queue -> authenticated activity route passed. Synthetic fixtures were removed. The native build is installed on the connected iPhone.

Delivery limitation: Vercel exports sensitive APNs variables as empty strings, so exports cannot establish whether they are configured. Existing matching public app/team credentials were reapplied; use the live sender result to verify configuration. The available key is production-only: a direct test to Daniel's sandbox device returned `BadEnvironmentKeyInToken`; production authentication reached device-token validation. A development APNs key and actual banner/tap verification remain pending Apple Developer sign-in. No test alerts were sent to other reps.

Push release deployed to `wolfgrid.app`: `dpl_8DNMqrbX3Ztxfa2naBXEHfvEBQj5`, source `0b0bce589`. Production unauthorized cron/device registration requests returned 401; authenticated cron returned 200. An actual public open for a temporary fixture owned by Daniel's account returned 200, was claimed by the deployed worker, and reached APNs, which returned `403 BadEnvironmentKeyInToken` for his sandbox registrations. This verifies the deployed credentials are populated but do not support development delivery. Temporary own-account and synthetic fixtures were removed. Apple Developer sign-in is open in Chrome for the missing sandbox-key follow-up.
