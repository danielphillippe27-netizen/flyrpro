# Permission settings buttons · Mac 0.3.4

Permission errors include an explicit button for the relevant macOS privacy pane: Open Calendar Settings, Open Reminders Settings, Open Contacts Settings, or Open Full Disk Access. Calendar/Reminders also expose settings buttons beside Connect, and denied source cards use explicit settings labels. The misleading Messages unavailable prefix is removed from unrelated Apple permission errors. Only allowlisted native settings destinations are used; clicking a button opens System Settings and never grants permission automatically.

Browser verification reproduces the reported Calendar denial, checks the source-specific action and corrected text, then confirms the native request is privacy-settings with source calendar. Type/lint checks passed. The rest of the contact import and one-button Messages flow remains in place.

---

# Contacts chooser repair · Mac 0.3.3

Fixed a second native issue after the signing repair: NSStackView rows could exist in accessibility but render blank inside the scroll view. The chooser now uses a flipped document view with explicit row frames and opens at the first contact. The review button stays disabled until one or more people are selected, reports the selected count and enforces the existing batch maximum before submission. An empty authorized address book now returns an actionable message.

Verified in the installed universal app: visible real Contacts list → selected previously authorized Daniel Phillippe with 2896752788 → review matched his existing CRM record → Fill missing details → 1 reviewed CRM imports. The existing primary phone/email were preserved, and no duplicate CRM contact was created. The working chooser is left open for the user; no other people were selected or imported. Contacts access reads Access allowed. Both architectures compiled and strict signature/entitlements verification passed.

---

# Contacts permission repair · Mac 0.3.2

The 0.3.1 hardened-runtime signature omitted Apple's Address Book and Calendar resource entitlements. Contacts import returned Access Denied before a usable permission flow. The build now signs with `apps/mac/WolfGridMac.entitlements`, containing the Address Book and Calendar capabilities. This allows normal macOS permission requests; it does not grant access or bypass the user's privacy controls. Signed output was inspected and installed in `/Applications`.

Apple reference: https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.personal-information.addressbook

---

# One-button contact sync · Mac 0.3.1

The current setup opens Messages with one **Enable sync with WolfGrid contacts** button. It authorizes available history and ongoing messages for existing and newly added contacts owned by the current user in the current workspace. Contacts must uniquely match a normalized phone number or email; groups remain excluded. There is no per-contact approval or date-range step in the main setup.

Enabling opens macOS Full Disk Access settings when needed. Only the user can grant that OS permission. The same button pauses future imports and preserves saved history. AI permission and the personal OpenAI connection remain separate, and enabling sync preserves their existing choices.

The additive `20261028050000_mac_one_button_sync.sql` migration leaves all existing consent unchanged until the button is pressed. Every manifest refresh includes newly eligible contacts; unchanged scans retain cursor progress and consent revision. Explicit history deletion still stops that contact until the account-wide enable action is deliberately repeated.

Validated with database fixtures for 1,500+ contacts, automatic new-contact eligibility, stable progress, pause and owner isolation; responsive browser checks exercise the single button without contact-approval requests. This supersedes the per-contact setup described below.

---

# Apple command centre · Mac 0.3.0

This release supersedes the 0.2 pilot’s account-wide Messages eligibility. It extends the existing Mac companion and WolfGrid CRM rather than introducing another app or database silo.

## Product behaviour

- Apple Integrations at `/settings/integrations/apple`, also accessible through the existing `/settings/mac` route. Six source cards, real native permissions and server counts, device heartbeats, diagnostics, permission history, light/dark mode and a mobile layout.
- A private `/messages` inbox with conversation search, incoming/outgoing bubbles, older-history loading, automatic refresh, source links, AI actions, an editable reply draft, export and per-contact deletion controls.
- Saving a reviewed Apple contact **automatically authorizes future messages for that contact’s unique identifiers**, per Daniel’s explicit instruction. Import is transactional and idempotent. Replaying the same import preserves the history cutoff; newly added identifiers require a fresh future-message window. Ambiguous identities remain ineligible. Saving contacts does not enable the master sync switch or AI access.
- Other CRM contacts are approved individually. Each approval pins normalized identifiers and selects future-only, 30-day, 90-day or all local history. Future-only is the default. Matching is checked again against current ownership and uniqueness on the server. Phone changes do not silently authorize a new identifier.
- Date filtering happens inside the local SQLite query **before selecting message bodies**. Group and unknown conversations remain excluded. Preview returns only matching conversation metadata, never text.
- Polling defaults to five seconds, configurable to 20 or 60 seconds. A metadata change index skips unchanged conversations. Date-excluded rows advance an acknowledged cursor without uploading their bodies. Batches remain transactional, deduplicated and limited to 100 rows, with bounded fair work, backoff and consent checks.
- Older agents cannot obtain a sync manifest without declaring support for history windows. The new runtime additionally requires the native capability before scanning. The migration pauses previous sync/AI settings for review; previously imported data and API keys are preserved.
- Message permission changes increment consent revision. AI retrieval excludes revoked contacts and records outside the current approved history range. Earlier assistant turns are accepted only for the same conversation scope and matching consent revision; revoked context is not silently retransmitted.
- Private history can be exported as JSON. Deletion requires typing DELETE, removes only that owner’s imported messages for the chosen contact, and revokes future imports. It does not delete the CRM contact or Apple Messages.

## Native capabilities

| Source | Implemented behaviour | Limit |
| --- | --- | --- |
| Contacts | Native selection, reviewed matching, empty-field filling, alternate identifiers and future-message authorization | No silent merge or automatic overwrite; no background two-way Contacts editing |
| Calendar | EventKit permission request; choose a writable calendar; review/edit title, local date/time and duration; create/update the linked CRM export | Reviewed one-way export; unrelated personal events are not imported |
| Reminders | EventKit permission request; choose a writable list; review a CRM follow-up or dated task; save/update its linked reminder | Completion and due-date edits in Apple are not automatically copied back to CRM |
| Phone | Supported `tel:` handoff with exact-number confirmation; existing WolfGrid business-dialer navigation; link to manually log the outcome | Default-handler availability is not proof of iPhone/Continuity connectivity; no invented outcomes, durations or native call-history access |
| Messages replies | Copy an editable draft and open the system Messages conversation/application for final user review | WolfGrid does not send, queue or claim delivery; email-only identities open Messages for manual conversation selection |
| Background | Visible menu-bar app; per-user/workspace opt-in to keep the authenticated runtime alive after the last window closes; optional SMAppService launch at login | Default remains pause on last-window close. Quit, logout and workspace changes stop pending work. Mac sleep can pause local work |
| AI | Personal encrypted OpenAI key, bounded evidence, verified sources, summaries/follow-ups/drafts and use-draft-in-conversation | No automatic sends, calls, contact edits, appointment creation, campaign execution or provider-key fallback |

Native Calendar and Reminders saves use a per-user/workspace/record link. They update that linked item rather than create another on an ordinary retry. An export intent is persisted before the EventKit save; an interrupted/uncertain save is explicitly reviewed and is never blindly retried. User edits and a missing linked Apple item are surfaced in the next native review. Calendar/list names stay in the native review; unrelated event/reminder content is not uploaded.

Permission denial opens the relevant system privacy pane. Full Disk Access remains a user-controlled macOS grant, separate from CRM message authorization. Native bridge operations are limited to trusted main frames, approved app routes and the bound account/workspace. No passwords, OpenAI keys, access tokens or refresh tokens are added to native bridge messages.

## Verification

- Native compile for the target macOS APIs; synthetic reader tests cover group/unknown exclusions, stale participant indexes, local date filtering before bodies, metadata-only previews, scan checkpoints, Unicode, time zones and OAuth callback validation.
- Disposable PostgreSQL tests cover explicit grants, automatic reviewed-import approval, history ranges, ambiguity, revocation, AI exclusion, private search/counts/inbox, deletion confirmation, atomic checkpoint rollback and more than 1,000 approved contacts.
- Actual route tests cover authentication, workspace isolation, expected-owner headers, strict inputs, body limits, no local paths, personal key replacement/removal, provider quota, source verification, consent changes and exclusion of old assistant context after permission changes.
- Runtime tests cover old-agent refusal, one loop in flight, fair backfill, stopped reads, workspace/account invalidation, contact revocation without permanently losing the background session, offline backoff and recovery.
- Actual React UI tests use synthetic records and mocked native/provider boundaries. They verify the dashboard/inbox in light/dark/mobile layouts, reviewed import auto-approval, permissions, replay, stale devices, native export wiring, connection/disconnect, cited editable drafts, guarded deletion and logout clearing. These are not evidence of a real EventKit save or phone call.
- Focused TypeScript and ESLint pass. Repository-wide validation was not rerun for unrelated work.
- The additive migration passed a rollback transaction against the real WolfGrid schema, preserving two existing private messages, and was then applied before dependent deployment.

```sh
sh apps/mac/tests/run.sh
node scripts/test-apple-command-center-db.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js
node scripts/test-apple-command-center-browser.cjs
node scripts/test-mac-sync-runtime.cjs
node scripts/test-mac-companion-api.cjs
node scripts/test-crm-ai-release.cjs
node scripts/test-mac-oauth.cjs
node scripts/test-mac-auth.cjs
```

## Rollout and remaining acceptance

This is Daniel’s protected pilot, not a public release. `pilot-status.json` records its exact URL, signature, checksum and installed-app checks. The native app still needs user-granted Full Disk Access for an actual Messages sync; Calendar/Reminders need their own OS grants and a deliberately chosen test item before live save/update can be claimed. A personal API key is required for a real AI generation. No real phone call or outgoing message is initiated by the automated checks.

Two-way Apple data synchronization, attachment uploads, group imports, desktop notifications and bulk/automatic Apple message sending are not implemented or presented as connected capabilities. Existing Gmail/Telnyx infrastructure remains intact. Developer ID signing, notarization, Intel-device installation and update validation still gate public distribution.

Rollback: disable the Mac/AI API flags and set the pilot user’s sync and AI preferences false. Preserve imported records, contact permissions and encrypted connections. Do not restore the older permissive import functions or grant authenticated execution to their renamed internal versions.
