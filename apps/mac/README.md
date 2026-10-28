# WolfGrid Mac Preview

Mac wrapper for WolfGrid with reviewed Apple Contacts import, ongoing private one-to-one Messages sync, contact history, and the web CRM assistant. This is a development/pilot package until Developer ID signing and notarization are complete.

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

Sign in, choose the workspace, review Apple Contacts if desired, and enable message sync in Mac settings. The app prompts for native approval and requires Full Disk Access for this exact signed app. Rebuilding can affect macOS permissions. Check Messages access in the toolbar performs a schema/permission check without reading content.

Sync runs while at least one WolfGrid window stays open, including minimization and ordinary web navigation. It pauses on last-window close, quit, logout, or consent withdrawal. New contacts and alternate identifiers become eligible automatically only when unique. Recheck history replays available local rows without duplicating saved messages. Nothing reads an iCloud archive directly.

Connect a personal OpenAI API key in Mac setup or Integrations for the assistant. Permission to use synced messages is separate from message-sync permission. Imported messages and keys are private to their owner. Only text is imported; attachment files, sending, EventKit exports and a standalone daemon are excluded.

See `docs/mac-companion/release.md` for configuration, tests, live-check limits and release requirements. Reader tests use synthetic SQLite files and never read the real Messages database.
