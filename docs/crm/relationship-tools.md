# Web contact relationship tools

Implemented locally on November 5, 2026. Not deployed; apply `20261106010000_crm_relationships.sql` before releasing the Web code. Uses the existing CRM pilot access gate and signed-in user/workspace checks.

Contacts now show Special fields & touch points. Birthday and Home anniversary are suggested date fields; users can add/remove up to 40 named text/date fields per contact and save them. Field updates reject stale versions.

Select contacts to open Follow-ups, letters & touch points. Schedule a named follow-up such as Christmas for up to 500 contacts in one atomic operation. Each recipient gets a normal CRM task, available in existing task views. Retry keys prevent duplicated tasks when a response is lost. Tasks are one-time; annual recurring reminders and automatic date-based targeting are not included.

Letter text supports `{first_name}`, `{last_name}` and `{address}`. Preview/print creates one personalized page per selected contact, with browser printing or Save as PDF. Mailing addresses are required. Printing does not contact a mailing vendor. Users explicitly record Letter prepared or Letter mailed; only the mailed record updates last-contact time. Calls, emails, texts, visits and notes can also be logged manually. These actions record activity; they do not send messages.

History combines this new activity ledger with completed contact tasks and the conversations loaded by the existing contact page. It does not backfill every historical activity from other WolfGrid modules. Date fields are stored as calendar dates, while task/activity times use the browser's local timezone and persist as UTC instants.

Validation:
- `node scripts/test-crm-relationships.mjs <path-to-pglite/dist/index.js>` passes database integration checks, including real RLS access, atomic batches, retry handling, stale field writes and preparation-versus-mailing state.
- `node scripts/test-crm-relationships-browser.cjs` passes isolated browser tests with a mocked API for saves/reloads, bulk recipients, print personalization, HTML escaping and mobile overflow. Desktop/mobile screenshots are written to its reported temporary directory.
- Targeted ESLint passes. Project-wide TypeScript checking reports existing unrelated errors; no diagnostics in the changed relationship files or their CRM integration.
- Authenticated production browser/database verification remains outstanding.
