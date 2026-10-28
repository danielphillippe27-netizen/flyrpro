# KimiCoco Inbox and Contacts parity — 0.4.0 pilot

Source: `/Volumes/Samsung SSD/Kimi Coco/apps/web/src/app/page.tsx`, `globals.css`, `ContactDetailsEditor.tsx`, `EmailComposer.tsx`, `GmailClientImport.tsx`; native reference `apps/apple/Mac/MacContactsSetup.swift`, `MacBridgeView.swift`, `MacMessagesProvider.swift`, and `MacWebShell.swift`.

The actual source layouts and interactions were adapted into `components/coco`; CSS is scoped to the CRM so it cannot restyle other WolfGrid pages. WolfGrid retains its logo, shell and red accent. Native toolbar buttons open Inbox and Contacts, with Inbox as the app's initial destination.

## Implemented

- Contacts: persistent list and detail panes, search, labels and four source stages, filters, bulk selection/labels/stages, confirmed deletion, retained detached tasks, editable contact details with stale-write protection, conversation preview, tasks, appointments, past deals and full WolfGrid record link.
- Inbox: persistent conversation list/thread, source pinned-name order, avatars, recent previews and unread state, contact navigation, independently paged history, fresh Mac connection status, scroll-position preservation, session drafts, AI draft editing/tone buttons/use/discard and supporting records/excerpts. Previous contact drafts, files and history cannot appear under a newly selected recipient. Asynchronous AI results are tied to their original contact.
- Apple Contacts: source swipe-card layout, select/skip/undo/search/review/save, explicit ambiguous match choice, primary and alternate identifier matching, owner/workspace review state, retryable remaining selections, existing populated fields preserved by the existing transactional import RPC. Done is disabled while saving.
- Native send: explicit recipient/body/files review in an AppKit dialog, authenticated unique-recipient lookup before and after review, deliberate Apple Events send, persistent attempt IDs blocking automatic retries, acceptance distinguished from delivery. No real communications were sent during implementation checks.
- Attachments: user-selected outgoing files; separate optional history attachment setting in Apple Integrations → Permissions & devices, off by default. Incoming files are limited to downloaded regular files under the canonical Messages attachment directory and 50 MB each. Bytes remain native, uploads use bound signed URLs to a private bucket, redirects are refused, logout cancels uploads, and acknowledgement precedes message progress. File manifests are saved in the same transaction as each message batch. Owner-authenticated short-lived download links, immutable file reuse, and replay repair are supported. History deletion revokes stored manifests and attempts object cleanup.
- Gmail: separate read/send capability controls, session-bound server-side PKCE tickets, scoped native authentication, user-initiated plain-text email with atomic idempotency and uncertain-send protection, optional up-to-five-email draft context, paused/resumable all-mail/date-range AI candidate review and idempotent approved saves. Own alternate email identifiers participate in matching; ambiguous CRM matches reject instead of silently choosing one.
- AI: existing personal encrypted API keys, dedicated AI encryption configuration, atomic 30 requests/hour, server model, Responses with `store:false`, bounded evidence and consent/version checks. No provider credential fallback, chat subscription use or autonomous communications.

## Intentional WolfGrid boundaries

KimiCoco's workspace-shared message storage and native token-forwarding patterns were not copied. WolfGrid messages/files remain owner-private, and native requests reuse authenticated web requests without bridge login credentials. Existing CRM campaign/financial records are preserved; restrictive references may veto a requested contact deletion transactionally. Native reviewed sending and optional attachments extend the earlier release scope because the later request explicitly asked for all KimiCoco features.

The existing business inbox remains at `/inbox/business`; the Mac navigation exposes it separately when applicable. New CRM routes remain authenticated and gated by the existing pilot APIs.

## Validation

- Real Next production build passed; repository-wide type/lint checks are configured to skip in that build, so separate scoped TypeScript and ESLint checks were run for the new source. The scope includes the actual main app shell; its native-navigation state placement was repaired after an installed-app check, and a dedicated full-shell browser regression now passes.
- PGlite migration/data tests cover owner boundaries, >1000 contact paging, four stages/labels, atomic bulk writes, stale contact/task updates, read state, retained tasks, unique recipients, alternate email matching, idempotent/ambiguous Gmail candidate saves, server-only OAuth tickets and transactional attachment manifests rejecting local paths.
- Browser tests render the actual components in Strict Mode, exercise desktop/mobile master-detail views, contact stage editing, AI draft use, native review wiring and cross-contact cleanup. Existing Apple dashboard permission/sync/AI checks also pass.
- Actual route fixture tests cover auth/origin checks, credential-bound OAuth claims, duplicate and unknown Gmail send outcomes, attachment consent/ambiguity/size limits and confirmed uploads. Providers are mocked; no real email or files are sent.
- Native fixture tests verify participant validation before message/file reads, normalization, stale scan revalidation, history boundaries/checkpoints and OAuth policy. Universal package build verifies Apple Silicon and Intel compilation and hardened signing.
- Live owner-scoped database reads after migration show 23 contacts, one private conversation and two preserved messages for the pilot account. No real records were changed for fixture testing.

## Remaining acceptance gates

Gmail OAuth client ID, secret, redirect URI and outreach encryption configuration are absent in both current Vercel preview and production environments. Gmail connection cannot be live-tested until those are configured; the stable registered callback must include the new `coco.` ticket dispatch. Google login to WolfGrid is a different connection and does not supply Gmail read/send permission.

Real Messages reads still depend on Full Disk Access granted to the exact signed installed application. Real outgoing transport, attachment uploads and paid AI/Gmail analysis require explicit user actions/consent; test fixtures do not establish provider acceptance or delivery. No unattended sending is implemented. No Developer ID/notarization or public rollout is claimed.

## Database rollout

Applied additive migrations `20261028070000_coco_crm_pages.sql`, `20261028071000_coco_attachment_manifest.sql`, and `20261028072000_coco_ai_tasks.sql` transactionally before dependent APIs. Existing records are retained. Rollback disables the pilot feature flags and sync; do not drop private history or encryption keys.

Installed 0.4.0 build 9 targets protected deployment `dpl_HPWXTug4GPJCse59VG74akrfM4ff` (`https://flyrpro-onns9ffb0-danielphillippe27-netizens-projects.vercel.app`). Google sign-in was completed in the installed app. Verified all 23 owned contacts, the selected Daniel record and saved history, native Apple review/search/match, one real personal-key AI draft, editable use and a native review showing the exact unique number. The send was cancelled. A separate content-free native Messages check confirmed read permission and supported schema. Active sync remains paused by the user preference; the paused-device Mac offline label was subsequently corrected and covered by a native-bridge component regression. Attachment/provider delivery and Gmail acceptance are not claimed. Fixture screenshots are in `verification/coco-0.4.0/`.

Final status-only patch: deployment `dpl_DQRfGfWbjGgAiqoqKzTrsYPet5Nh`, `https://flyrpro-1wydy5bp3-danielphillippe27-netizens-projects.vercel.app`, installed 0.4.0 build 10. Same verified universal native executable, re-signed with the updated preview origin. The new protected origin may require Google sign-in again.

Composer update (0.4.2 build 12): removed the floating Ask WolfGrid launcher. The message plus menu offers Templates and Attachments. Four starting templates personalize the first name and append to an existing draft, with keyboard-accessible menu/dialog controls. Templates never send automatically. Actual-component browser checks cover personalized insertion, preserving draft text, attachment selection, and no native send.

Apple review save fix (0.4.3 build 13): Done becomes Save N & Done while people are queued, saves them before closing, and stays open on errors. Pending people, explicit match choices, titles and notes persist per owner/workspace. Cards include a freeform title/label, suggested Past Client/Tradie labels and a note. Import details are transactional; retries keep the same contact and avoid appending the same note twice. Existing labels/notes and primary identifiers are preserved. The counter now distinguishes remaining from total. Selections closed by the old Done action were not persisted and cannot be reconstructed automatically.

0.4.4: Contacts toolbar reduced to Filter and + Contact. Both stage and label chips share the Filter panel. + Contact offers Google (Gmail) and Apple; the duplicate top plus was removed. Actual-component desktop/mobile browser checks pass. Installed for next launch, leaving the signed-in session open.

0.4.5 Apple Contacts visual update: narrow alphabetic contact browser, smaller rows, circular filter and plus controls, real CRM list/sidebar filters, centered avatar and four round communications actions. Light/dark/mobile browser fixtures and Swift typecheck pass. FaceTime opens only after clicking the visible trusted contact link; no calls or communications were sent. Installed signed universal build 15 for next launch.

0.4.7 conversation header: compact centered avatar and name pill, contact/email actions in the name menu, and one circular FaceTime action on the right. Removed the wide contact/email controls and status subtitle from the header. Actual-component browser checks verify centering, contact menu, exact FaceTime recipient, full-height native inbox and mobile layout. No calls or messages were sent.

0.4.8: removed the native toolbar and title text using the standard hidden-title-bar window style. Navigation remains in Navigate (Cmd+1 Inbox, Cmd+2 Contacts), and Mac setup in the app menu (Cmd+comma). The visible menu-bar app also retains these actions. Same web origin, no redeploy. Signed universal build 18 installed for next launch; active campaign screen left uninterrupted.

0.5.0 build 19 integrates the current farm and canonical PMTiles source snapshot. Includes the single-name farm creator, guided daily/weekly planning and holidays, farm calendar/card metrics, optional Durham business exclusions, canonical farm map preparation, compact metadata, exact geometry and current map layers. Live authenticated farm list and compact map return 200; archive range returns 206 with a valid 127-byte PMTiles header. Fixed legacy farm phase/status query mismatch and map adjustment source selection. No existing campaign backfill or worker rollout was launched. All Mac/CRM UI changes retained; installed for next launch. Snapshot hashes: farm-pmtiles-sync.json.
