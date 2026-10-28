# KimiCoco → WolfGrid Mac CRM integration

This initial-preview audit is superseded by [the implemented release](release.md).

Audit and initial implementation: October 27, 2026. Source checkout: `/Volumes/Samsung SSD/Kimi Coco` (a sibling of WolfGrid, not a nested folder). KimiCoco was not changed. Source docs contain historical status statements; the implementation and later updates take precedence over its original README.

## Architecture and reusable capabilities

| KimiCoco area | Owning source | WolfGrid treatment |
| --- | --- | --- |
| Hosted web CRM in a native Mac window | `apps/apple/Mac/MacWebShell.swift` | New WolfGrid WKWebView shell with a fixed origin, main-frame checks, and native request/reply bridge. Native code never receives Supabase access/refresh tokens. |
| Apple contact permission and review | `Mac/MacContactsSetup.swift`, `iOS/ContactReviewView.swift` | Native checkbox selection, then web review of selected phones/emails. Save uses the existing WolfGrid contact API. Potential duplicates are flagged, not merged. |
| Messages history reader and attributed text decoding | `Mac/MacMessagesProvider.swift`, `tests/messages-history/` | Adapted reader with a mandatory identifier allowlist; removed sending and older diagnostic surfaces. Unicode decoder and synthetic fixtures retained. Read-only SQLite; group/unknown threads excluded before body reads. |
| History batching, consent, pause and cursor | `Mac/MacBridgeView.swift`, `202610040005_messages_history.sql`, `202610050003_messages_matched_only.sql` | New WolfGrid tables/RPCs. Explicit selection per user/device/contact; 100-row batches, row lock, expected-cursor check, transactionally saved progress, message GUID deduplication. No background loop yet. |
| Attachments | Same reader/history migration, web `MessageAttachments.tsx` | First phase stores only a has-attachments flag. No paths, manifests, or files uploaded. Private storage and signed downloads remain future work. |
| Native sending | `Mac/MacWebShell.swift`, provider Apple Events; `iOS/IOSMessageComposer.swift` | Not ported in this preview. KimiCoco's source exposes an Apple Events send method, but source docs do not establish live delivery verification. |
| Native auth/cloud model | `Shared/CloudStore.swift`, `Shared/Models.swift`, `Shared/Views.swift` | Reuse WolfGrid's existing web login and session cookies. Avoid a second native Supabase session and KimiCoco-specific workspace schema. |
| Apple tasks | `Shared/AppleTaskExport.swift`, `docs/apple-reminders-calendar.md` | Follow-on: EventKit task exports and opt-in reminders updates. Existing KimiCoco implementation is primarily CRM → Apple, not general two-way sync. |
| Gmail + Google Workspace | Web `lib/gmail*.ts`, `lib/google-workspace.ts`, integration routes, `EmailComposer.tsx`, `GmailClientImport.tsx` | Preserve ongoing WolfGrid Gmail implementation. KimiCoco adds consent-separated read/send scopes, encrypted refresh tokens, bounded AI deal extraction/review, and read-only Calendar/People/Drive context. Do not create competing OAuth/token storage. |
| WolfGrid handoff | Web `lib/wolfgrid.ts`, receiver routes, `202610050001_wolfgrid.sql`; WolfGrid `lib/integrations/kimicoco*.ts` | Existing cross-product export remains intact. New Mac data goes directly into WolfGrid rather than using KimiCoco as a middleman. |
| AI / billing | Web AI routes, key management, billing routes/migrations | Audited as surrounding architecture, not transplanted. WolfGrid has its own access, billing and AI model. |

KimiCoco also has explicit not-yet-available UI for call history and Apple Mail. Its direct-download package is not proof of a notarized public distribution. Do not promise these integrations based on placeholder UI.

## Initial WolfGrid implementation

- `apps/mac/`: native Mac shell, selected contact picker, read-only history bridge, app/ZIP builder, synthetic reader tests.
- `/settings/mac`: setup, saved per-device contact selection, manual import/resume/pause, private history with older-page loading, selected Apple contact review/save.
- `/api/mac-companion`: authenticated cookie API, bounded strict payloads, paginated owned-contact matching and private history retrieval.
- `20261028020000_mac_companion.sql`: private RLS tables and transactional configuration/import functions. Message content is not written into shared contact notes or activity feeds.
- Settings → Integrations links to Mac setup. Existing Gmail and CRM connections are preserved.

The existing iOS/Sales personal-communications regression documentation and isolation migrations were also inspected. Their user-private ownership approach is consistent with this preview; Mac imports are kept separate from provider-backed calls/SMS and do not rewrite those communication records.

Only contacts owned by the signed-in user in the selected workspace are eligible in this first phase. Team-wide access to a contact is not permission to import or read another member's personal messages. Phone normalization handles ordinary NANP numbers and explicit international + numbers; extensions and malformed identifiers fail closed. Shared numbers/emails are excluded when they match more than one of the user's contacts in the workspace.

## Deliberate first-phase limits

Manual history import only; no sync while closed, no login item, no timer, no automatic import from permission alone. Names do not authorize message imports. Source schema changes stop import. Rich content, edits, reactions, deleted-message reconciliation, and history arriving later below an acknowledged cursor are not reconciled yet. A future explicit recheck/replay action should upgrade unsupported bodies safely. Attachment files remain local. Contacts import saves one chosen phone and email using WolfGrid's existing schema; all Apple values are considered during duplicate review. Duplicate-name matches are review warnings, not automatic merges. Concurrent contact import from multiple clients is not made transactionally idempotent in this first phase.

The bridge runs only on the exact configured origin and `/settings/mac`, only in the main frame. Native approval is reset on navigation, pause and completion. Reads run off the UI thread. The ordinary browser has no native bridge and shows the setup explanation plus previously imported history. Email/password login in the hosted shell is the intended first validation path; external OAuth session return requires further validation.

## Verification completed

- Mac app compiled and ad-hoc signed; ZIP generated.
- Swift synthetic reader: Unicode archive decoding, malformed archives, unique one-to-one match, group/unknown exclusion, invalid identifiers, and local-path encoding exclusion.
- Actual SQL migration/RPC in disposable PGlite: consent/ownership checks, private RLS, idempotent GUIDs, stale cursor rejection, atomic rollback, malformed rows, group/unknown/ambiguous matches, pause/resume.
- Actual route handler with auth/database mocks: unauthenticated/cross-origin/malformed/oversized/group/local-path payload rejection and valid RPC invocation.
- Actual React page in a browser harness with mocked native bridge/API: normal-browser fallback, selection, ambiguous disabled contact, batch import, history, contact review/save, mobile width, and pause discarding pending native reads. Desktop screenshot in `verification/desktop.png` uses synthetic content.
- Focused TypeScript check and scoped ESLint passed.
- Repository-wide TypeScript attempt was blocked by an unrelated syntax error in concurrently edited `lib/map/canonicalTileState.ts`. No unrelated files were repaired.

These are local build/fixture checks, not a real Messages or production acceptance test. No personal Messages content was read or uploaded. No production migration/deployment, installation, Developer ID signing, notarization, or public download publication was performed.

## Release sequence

1. Apply the additive migration to a test WolfGrid database and run its policies with real authenticated users.
2. Deploy the new API/page in a controlled test environment; build the shell for the matching allowlisted origin.
3. Sign in, import one explicitly selected real contact, grant this exact app Full Disk Access, verify one real thread against Apple Messages, retry/pause/resume, and verify another signed-in device can view only that user's imported data.
4. Validate login/logout and OAuth, app restarts, Mac permission renewal, schema compatibility, and a large local library.
5. Developer ID signing, notarization/stapling, universal architecture packaging, app icon, release hosting and authenticated download/version policy.
6. Follow-on features: explicit replay/recheck, attachment storage, contact-record timeline placement, shared-contact consent design, EventKit exports, reviewed outbound messages, and user-controlled background sync.
