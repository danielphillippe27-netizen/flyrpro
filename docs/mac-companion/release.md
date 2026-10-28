> Version 0.3.0 supersedes this earlier pilot. See [Apple command centre](command-center.md) for current permissions, automatic Apple-import authorization and native capabilities.

# Mac CRM and OpenAI pilot

Implementation date: October 27, 2026 (Toronto). Extends the local preview documented in `audit.md`.

## Delivered

The Mac shell owns a separate authenticated WebKit sync runtime. Both views share the app's WebKit cookie store; native bridge messages contain identity/scope IDs rather than credentials. A native 20-second timer drives polling through navigation and minimization. Closing the last window disposes the runtime. Logout, identity changes, workspace changes, and consent changes invalidate pending work. Requests bind mutations to the expected authenticated user to prevent saving data or keys under a newly switched account.

One per-user/workspace consent covers all owned CRM contacts, including new contacts. A single participant index is built per scan; each candidate chat is revalidated inside the same SQLite read snapshot before bodies are selected. Only unique one-to-one phone/email matches import. No attachment file paths or files are read/uploaded. Round-robin bounded batches prevent a large thread from starving other contacts. Retry backoff is capped at five minutes. Contact alias changes and explicit Recheck history replay old rows; message GUIDs deduplicate and replay fills missing text without replacing successful text.

Apple Contacts review preserves all supplied normalized phones/emails as private matching identifiers and keeps compatible primary fields. A transaction and user/workspace advisory lock make imports idempotent. Existing matches require choosing a person; populated fields are retained. Message history stays private on the contact record and supports pagination and direct links to cited messages.

The shared CRM assistant answers questions and produces summaries, follow-up suggestions and editable reply drafts. It uses only a personal per-user/workspace OpenAI key, encrypted server-side with tenant-bound AES-256-GCM. There is no platform-key fallback. Retrieval searches the owned-contact corpus and consented messages, with contact/date filters and indexed message text. Separate evidence budgets retain room for messages even when contact notes are long. Returned citations are checked against retrieved IDs. Chat history is session-only and private views clear on identity changes. Message opt-out excludes prior assistant history from subsequent provider requests as well as new message retrieval.

The Responses API request uses `store:false`, a configured model, no action tools, structured output and a timeout. The shared atomic rolling limit is 30 requests/user/hour across workspaces. Operational logs contain usage/status/error codes, not message bodies or keys. Connection replacement, disconnect and consent changes are rechecked before and after inference; a stale result is discarded.

## Deployment configuration

Required server variables:

- `CRM_MAC_ENABLED=true` and `CRM_AI_ENABLED=true`. Production defaults closed unless explicitly enabled.
- `CRM_PILOT_USER_IDS`: comma-separated allowed user UUIDs. The current Preview pilot is limited to Daniel's existing account.
- `CRM_AI_MODEL=gpt-6-luna`, matching KimiCoco's configured model. Actual model access and credits depend on the user's API key.
- `CRM_AI_ENCRYPTION_KEY`: stable base64-encoded 32 random bytes. Dedicated to this feature; never use a `NEXT_PUBLIC_` name, browser storage, or native Info.plist. Rotation without re-encrypting records makes existing keys unreadable.

Preview configuration is installed in the existing `flyrpro` Vercel project. The encryption recovery value is stored in the ignored, permission-restricted pilot checkout environment file; it is not included in Git, public assets, or this document. No personal OpenAI API key was copied from KimiCoco.

Applied only these two migrations to the linked WolfGrid project, transactionally, after validating against the live schema in a rollback transaction:

1. `20261028020000_mac_companion.sql`
2. `20261028030000_mac_crm_release.sql`

The isolated pilot checkout contains only this feature over baseline `7ad2a1320`. Other active working changes were not bundled. Preview releases do not replace the production domain. Consult `pilot-status.json` for the verified deployment URL and remaining acceptance gates.

## Verification

Run from `Wolfgrid-WEB`:

```sh
sh apps/mac/tests/run.sh
node scripts/test-mac-crm-release-db.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js
node scripts/test-mac-companion-api.cjs
node scripts/test-crm-ai-release.cjs
node scripts/test-mac-sync-runtime.cjs
node scripts/test-mac-auth.cjs
node scripts/test-mac-companion-browser.cjs
```

Coverage includes group/unknown/ambiguous exclusions; stale participant indexes; Unicode and malformed attributed text; rollback; stale cursors; consent/pause/replay; new contacts/aliases; imports and preservation of primary values; 1,502 eligible contacts; two users in one workspace; membership loss; key replacement/removal; provider quota; unsupported citations; sanitized usage logs; pending-read cancellation; mobile layout; account-wide consent; and sign-out clearing private views. OpenAI calls in automated tests are mocked: they do not establish real generation quality or provider prompt-injection resistance.

Focused TypeScript and scoped ESLint pass. The full repository type check still reports unrelated existing errors; Next's pre-existing build configuration skips full type/lint checks. Cloud production-mode builds of the isolated pilot succeed.

## Real selected-contact check

The user explicitly selected Daniel Phillippe's phone/email and authorized correcting two duplicate placeholder records in workspace 22. Only the specified identifiers were removed from those two records; the selected Daniel contact retains both. Recovery snapshots are kept outside deployment source with restricted permissions.

The production reader, run from the development process with the selected identifiers only, found two readable message rows. A live authenticated database transaction imported and replayed that batch. Final count is two, each identifier matches exactly one owned CRM contact, and a different workspace member sees zero messages for that contact. Temporary local message payload/SQL files were removed. Sync and AI-message consent were left disabled after the test.

The deployed API was additionally checked using a temporary session for Daniel's existing account, revoked after verification. It returns the two private messages, reports secure key/model configuration, and refuses AI inference without a connected personal key. No email was sent to create this temporary session. Message content and credentials were withheld from tool output and logs.

The installed Apple Development-signed app was launched and its own content-free permission check returned authorization denied. The final cloud deployment and installed app now visibly reach the email/password sign-in form; evidence is in `verification/installed-pilot-login.png`. This is distinct from the passing reader check in the development process. These checks do not establish the installed app's authenticated background loop or a live AI summary/draft. Those require permission in the exact installed app and connecting the user's API key. The content-free Check Messages access toolbar action can be used before signing in. Mac setup has a server-side sign-in guard and a middleware redirect before the main client layout can hide a streamed redirect. Authentication initialization uses a task rather than an animation frame, so hidden sync windows can initialize without rendering. A native Mac setup toolbar entry returns to setup after sign-in. Personal OpenAI controls are available directly in Mac setup, including for the pilot account that reaches the existing Pro gate on the older Integrations page.

## Packaging and release gates

The builder produces a universal arm64/x86_64 macOS 15+ app, WolfGrid app icon, hardened-runtime signature, ZIP, and SHA-256 checksum. Public builds require a Developer ID Application identity and notary keychain profile; the script submits, staples, validates and assesses before producing the final ZIP. The default builder uses ad-hoc signing; the final local pilot signing identity is recorded in `pilot-status.json`. The installed machine currently has Apple Development/Distribution identities, but no valid Developer ID Application identity; public notarized distribution remains gated.

An explicit pilot build may target the exact owned `flyrpro-*.vercel.app` deployment and use a temporary Vercel share entry URL to establish deployment access without disabling Deployment Protection. It still requires WolfGrid sign-in. That entry URL expires; it is for Daniel's local pilot, not a permanent public download.

Public release still requires installed-app permissions/session testing, real personal-key inference, Developer ID/notarization, Intel device validation, release hosting and update validation. Calendar/Reminders, attachments, outbound sending and a separate background agent remain excluded.

## Rollback and monitoring

Monitor `mac_crm_devices` for stale heartbeats and permission/schema/offline states; inspect `crm_ai_usage` for status counts, token usage, and sanitized error codes. A `syncing` device with stale `last_seen_at` is not currently online.

To stop the pilot, deploy with both feature flags false or remove its allowed users. To stop direct authenticated sync RPCs too, set the pilot user's `mac_crm_preferences.sync_enabled=false` (and AI consent false if retiring AI). Do not drop tables or delete imported history during rollback. Keep the encryption key stable for any records retained. A broader pilot requires explicitly adding users to the allowlist and a new deployment.


## Mac Google sign-in correction (0.2.1)

The user reproduced Continue with Google in the installed preview reaching an invalid password-reset page in Chrome. The preview landing page treated every authorization code as recovery. It also opened the provider in an ordinary external browser while its PKCE verifier cookie remained in WebKit. The current source landing-route fix is now included in the pilot: only explicit recovery signals go to reset; Google/Apple codes go to the auth callback.

Native Google/Apple sign-in now uses ASWebAuthenticationSession with a dedicated `wolfgrid-mac://auth/callback` return. A native reservation precedes generating the verifier, preventing a second Mac window from overwriting an active flow. Requests require the exact owned Supabase host, supported provider, S256 challenge and attempt-bound callback. Completion accepts a single authorization code for that attempt, routes it to the configured app origin's auth callback, and exchanges it using the existing WebKit cookies. No password, access token or refresh token crosses the native bridge; the native callback code is never returned to JavaScript through the bridge. Cancellation, a changed/closed window, and a five-minute timeout discard pending sign-in. Browser web sign-in retains its existing flow.

Added only `wolfgrid-mac://auth/callback**` to the linked project's redirect allowlist, preserving every existing redirect and the site URL. A restricted recovery snapshot is outside deployment source. Provider configuration, Google client secrets and iPhone redirects were not changed. Automated URL-policy/helper tests and native compile pass; real Google sign-in was completed in the installed update using the Google identity confirmed on the existing pilot account. The authentication tab closed, the app returned to `/settings/mac`, and authenticated setup rendered workspace 22 with both consents off. The native runtime recorded its paused device heartbeat. Screenshot: `verification/installed-google-signed-in.png`. Apple sign-in and actual Messages import after permission remain unverified. Version 0.2.1 is still an Apple Development-signed private pilot, not a notarized public release.

Additional checks: `node scripts/test-mac-oauth.cjs` and OAuth policy cases in `sh apps/mac/tests/run.sh`.
