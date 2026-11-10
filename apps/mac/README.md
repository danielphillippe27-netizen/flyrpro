# Shared live website · Mac 0.6.3

The installed app loads https://wolfgrid.app/messages and uses the same live deployment as the browser. Web features update with the website. Mac bridge permissions, Apple Contacts review, Messages synchronization and system handoffs remain native app capabilities. The website business inbox remains at /inbox; the private CRM messages inbox is /messages. There is no preview-share cookie or expiring entry link in this build.

Quit and reopen after installing to leave the previous preview origin. Sign in once at the live website origin. Native permissions and server-side personal settings are retained. Native bridge changes still require an app update. This remains a signed private pilot, not a notarized public download.

# WolfGrid

Mac wrapper for WolfGrid with reviewed Apple Contacts import, ongoing private one-to-one Messages sync, contact history, and the web CRM assistant. Version 0.3.0 adds the Apple command centre, a private communications inbox, contact-level history permissions, reviewed EventKit exports and opt-in menu-bar/login behaviour. This remains a pilot until Developer ID signing and notarization are complete.

## Build

Run on macOS with Xcode command-line tools from the web repository:

```sh
sh apps/mac/build.sh
```

Produces a universal arm64/x86_64 macOS 15+ app, ZIP and checksum in `apps/mac/build/`. The default origin is `https://wolfgrid.app`; the feature must be deployed there before this default build is usable. Nothing is installed or opened by the builder.

Local test build:

```sh
WOLFGRID_WEB_ORIGIN=http://localhost:3000 sh apps/mac/build.sh
```

Pilot builds may explicitly set `WOLFGRID_PILOT_BUILD=true` and an owned `https://flyrpro-*.vercel.app` origin. An optional `WOLFGRID_PILOT_ENTRY_URL` must use the same origin; it supports a temporary Vercel share link without changing deployment security. Never publish an expiring pilot package as a permanent public download.

Public release builds require `WOLFGRID_PUBLIC_RELEASE=true`, `WOLFGRID_SIGNING_IDENTITY` naming a Developer ID Application identity, and `WOLFGRID_NOTARY_PROFILE` naming a configured keychain profile. The builder signs, notarizes, staples, validates and checks Gatekeeper. Do not substitute an Apple Distribution certificate for Developer ID distribution.

## Behaviour

Continue with Google/Apple uses the macOS authentication session and returns to the app with its original WebKit verifier cookie. Password login remains available. The native bridge never receives passwords, API keys or session tokens.

Apple Integrations lives at `/settings/integrations/apple`; the old `/settings/mac` entry still works. Saving a reviewed Apple contact automatically authorizes its uniquely matched future messages. Other CRM contacts require a permission choice. Older history always requires choosing a time range. The master sync switch and AI-message permission remain separate.

Native Messages access requires Full Disk Access for this exact signed app. Check Messages access in the toolbar performs a content-free permission/schema check. Polling defaults to five seconds, with selectable slower intervals, metadata change detection, transactional deduplication and acknowledged scan progress.

Mac 0.6.3 shows the latest outgoing call and up to ten incoming or outgoing calls from the last 90 days in the selected contact’s activity. It matches unique CRM phone numbers and emails to the Apple Phone and FaceTime history available on the Mac, including iPhone calls that appear there. The view updates every 30 seconds while open and when returning to the app. Full Disk Access is required. Calls are shown locally unless the user enables call sync for that contact; synced records remain private to the signed-in account and do not change follow-up dates. A call attempt is listed separately from a call with recorded connection time.

Closing the last window pauses by default. The user can explicitly keep the signed-in runtime running in the visible menu-bar app and optionally register normal macOS launch at login. Quit/logout/workspace changes stop work; sleep may pause synchronization. No hidden helper is installed.

Calendar and Reminders use EventKit with separate permissions and native review before each CRM export. They do not import unrelated personal data or silently synchronize edits back. System phone/Messages handoffs require review and never invent delivery or call results. Existing business dialer/Gmail integrations stay separate.

Connect a personal OpenAI API key in Permissions & devices for summaries and editable drafts. API usage belongs to that OpenAI account. The assistant has no tools to send communications or change records.

See `docs/mac-companion/command-center.md` and `pilot-status.json` for configuration, verification, live-check limits and public-release requirements. Reader fixtures never access the real Messages database.
