# Wolfy field intelligence

Wolfy now uses a read-only projection of field data for rep coaching, historical
comparisons, territory analysis and owner/admin team coaching. The iOS chat has
My performance / My team controls, a 30/90/365-day history selector, an All KPIs
report and expandable verified figures on replies.

## KPI coverage

See [the KPI catalog](WOLFY_KPI_CATALOG.md) for the 63 base definitions. The report
also includes derived rates, complete-period changes, custom pipeline-stage counts
and values, goal progress, rep ranks, and the user's existing lifetime stats.

- Visits: event doors, conversations, flyer visits and no-answer, do-not-knock and
  not-interested outcomes. Legacy session totals are distinct measures.
- Sessions: started/completed sessions, completed-session tracked time and distance,
  eligible door/flyer session goals and productivity.
- Leads: field leads created, contacted cohorts, current hot/warm/cold/new status,
  stale hot leads, never-contacted leads and overdue reminders.
- Appointments/contact activity: meetings created, scheduled/upcoming meetings,
  recorded meeting outcomes where supported, and logged calls, texts, emails,
  notes, knocks and flyers. Logged communication is not proof of delivery/contact.
- Sales: verified/pending/cancelled counts, exact verified revenue, average value,
  sales without appointment links and creation-date lead-to-sale cohorts.
- Pipeline: open/won/lost opportunities, known and weighted values, missing values,
  custom stage breakdowns, overdue expected closes and hot opportunities without
  next steps. Pipeline estimates and marked-won opportunities are not revenue.
- Tasks: due, completed, cancelled, on-time and overdue; completion rates exclude
  cancelled tasks from their denominator.
- Goals: personal daily/weekly doors, doors remaining and required daily pace,
  personal monthly sales targets and the configured team monthly sales target.
- Marketing/farms: QR scan events, landing-page view/click events and planned/
  completed farm touches where workspace attribution is supported.
- Lifetime: existing user_stats metrics, QR rates, XP and streaks. These are
  explicitly all-workspace personal totals, never workspace/team figures.

## Calculation contract

`wolfy_field_context(workspace, timezone, scope, days)` returns a versioned,
aggregated projection. A maximum of twice the selected history length is read for
comparison periods. Today/week/month are incomplete. Historical comparisons use
last 7 vs previous 7 complete local days, last 30 vs previous 30, selected history
vs the preceding equal period, and four complete Monday–Sunday weeks.

Latest visit state wins per session and address/building; an undo removes the
visit. No-answer/do-not-knock outcomes are excluded from conversation counts.
Session-reported counters are never added to event counts. A detected legacy
counter/event gap is disclosed, not interpreted as a performance decline.
Completed-session time/distance belong to their start day; live time and splitting
cross-midnight sessions are not inferred. Sales use the configured sales timezone;
a mismatch with activity timezone is disclosed. There is no invented hourly
schedule or finish-time estimate.

Period lead/conversation, appointment/lead and sale/door ratios compare activity
volumes, not the same people. Lead-sale conversion is explicitly a lead-creation
cohort followed through now, with an age-bias caveat for newer cohorts. No baseline
or a zero denominator means unavailable; growth from zero is not a percentage.
Small denominators are flagged. Current pipeline/contact status is not reconstructed
as historical status. Session goal rates include only door/flyer goal types.

Currency sums and formatting use exact decimal strings/BigInt. Values above the
JavaScript safe integer limit remain intact. Rates are rounded to two decimals.
Unknown optional sources, disabled Sales and absent targets remain unavailable.
Meeting outcome counts require the status column. Data synced after a request
appears on the next refresh; there is no background model loop.

Territories use explicit sales territory IDs and campaign territory assignments;
campaigns without a territory remain separate. Unassigned records are labelled.
Up to 60 territory/campaign groups are detailed, with an explicit coverage notice
if more exist; full scope totals still include all records. QR/page/farm attribution
is to the owner, not a claim that an individual rep caused the engagement.

## Permissions and privacy

The server verifies the bearer session and workspace membership. The database
independently enforces membership and derives the actor from auth.uid(). Self
scope returns only the actor's records. Team scope requires owner/admin and
includes current workspace members only. Downgrades are checked on every call.

The SECURITY DEFINER projection is necessary because financial/pipeline tables
have no direct authenticated read grants. Every source uses explicit workspace
and actor/authorized-rep filtering; no client metric or user ID is trusted.
No raw read grants or existing CRM RLS policies are broadened.

Manager coaching receives aggregate rep performance, not team customer names,
notes, phone/email/address, GPS paths, private messages or recordings. Self scope
can identify up to ten of the user's priority leads, with name/status/due date and
last-contact date. Notes and contact details are excluded. Current goals are the
existing personal goals; lifetime stats remain private to self scope.

Manager attention flags identify overdue work, hot opportunities without next
steps and enough conversations with no new leads. Being below the daily target
is labelled an open goal, not being behind an assumed hourly pace. Ranks use last
seven complete days and share ranks for ties. Alerts are coaching prompts, not
assertions about why a rep is struggling.

## Grounded answers and cost

`POST /api/wolfy/coach` accepts brief, chat or report mode, self/team scope and
30/90/365 history days. Report mode makes no model call. Full reports expose every
calculated KPI in the selected projection. The model receives a bounded selection
of evidence matched to the question, named group and manager attention flags.

The model selects `[[fact.id]]` references. The server validates IDs and inserts
the exact metric label, value and period. Raw generated numbers, unknown references,
links and common unsupported action claims are rejected. Evidence is returned with
the answer. This prevents invented arithmetic; the advice still needs human judgment.
The implementation follows the [OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

The existing gpt-5-nano model is retained, store:false, minimal reasoning,
1,600 output-token cap, no tools, no retries, 18-second provider timeout. Existing
atomic quota remains 30 paid attempts/user/UTC day with a five-second cooldown.
Brief caching includes scope, role, dates, history, coverage, labels and values.
Cache/quota failures fall back to verified data. No chat transcript is persisted.
Account, workspace, scope or history changes clear the conversation and invalidate
late responses. Home briefs remain personal even while team chat is selected.

## Activation and release

This change is source-only until its database migration and API are released.
Apply `20260916010000_wolfy_field_intelligence.sql` to the actual field database
with the existing Home schema and coach cache/budget migration. Optional field
Sales, pipeline, QR, landing-page and farm sources are detected and labelled
unavailable if absent. Do not apply every pending migration from this dirty tree.

Deploy the matching coach route and intelligence library to the backend referenced
by the field iOS app, with its matching Supabase configuration and server-only
OpenAI key. The route returns unavailable when the new projection is missing;
it never substitutes another account/database or silently falls back to old data.
Ship the iOS build for the new controls. Before production acceptance, compare
real rep/manager KPIs against source records and verify a real provider response.

## Local verification

- `PGLITE_MODULE=/tmp/wolfy-intelligence-db/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/wolfy_field_intelligence.mjs`
- Backend: `npx tsx --test lib/wolfy/__tests__/*.test.ts`
- Backend: `npx tsc --noEmit --incremental false`
- Build the field `WolfGrid` simulator target.
- Debug-only visual entry: `--wolfy-lab --wolfy-kpis`. Fixture data is synthetic,
  explicitly labelled, and generated by `lib/wolfy/__tests__/export-review.ts`.

Hosted migrations, deployment, real-account data validation and a live provider
response are separate from these local tests.

### Verification result for this expansion

16 backend tests, TypeScript checking and the PostgreSQL projection/isolation tests
passed. The final field simulator build passed and the synthetic Team KPIs report
installed/launched. Visual review covered light mode and dark mode at the largest
Dynamic Type size; selector labels were changed to wrap. Review images are in
`art/wolfy/field-intelligence/`.

A concurrently introduced campaign-map UUID/String comparison blocked the final
build. Its guard now parses the map ID as a UUID before comparing session scope.
No map workflow was otherwise changed by this coaching task.

## Production deployment — 2026-09-15

- Field API: https://wolfgrid.app (Vercel project `flyrpro`).
- Production deployment: `dpl_xNjKnPdeGku7thh1U7PstAY8s7jB`, release source `02ad4ed1c` on `codex/wolfy-field-intelligence-release`.
- Database: field project `kfnsnwqylsdsbgnwgxva`; migration `20260916010000_wolfy_field_intelligence` applied and recorded. The separate Sales database was not changed.
- Release was based on the previous live production commit, preserving unrelated website work.
- Passed: 16 backend tests, scoped TypeScript check, PostgreSQL projection/isolation regression tests, and Vercel production build.
- Authenticated production smoke test: four event-based doors, two conversations, one lead, 50% conversation rate, 50% lead-per-conversation rate. Session-reported doors remain separately labelled. Personal and manager reports returned HTTP 200; member team requests returned 403; anonymous requests returned 401.
- AI-generated coaching triggered response validation fallback during live tests. Verified-data responses remain available; successful AI-written coaching was not verified. Sensitive keys exported by Vercel are redacted, so an exported-key test cannot establish whether the actual configured key is valid.
- No physical-device installation or App Store release was performed in this deployment.


## AI response repair — 2026-09-15

Released to wolfgrid.app as deployment dpl_GMaSfKDfq6MHicfDetpgBUEMQTDD.
The provider was reachable, but the inline citation and numeric-word restrictions
discarded usable responses. Coaching now uses GPT-4.1 mini with natural prose and
separate evidence_ids. The server verifies referenced IDs and numerical values,
retains full evidence metadata, and supports a bounded format repair within the
same quota reservation. Cache failures do not prevent generation. Overview
retrieval prioritizes recorded activity and goals; offline summaries include a
next step instead of the first alphabetically sorted metrics.

Validation: 20 coaching tests passed; backend TypeScript check passed; hosted
production build passed. The broader web release tree has unrelated existing
local type errors and is not claimed type-clean. Authenticated candidate checks
returned AI-generated performance, follow-up and brief responses. After promotion,
a direct authenticated POST to https://wolfgrid.app/api/wolfy/coach returned HTTP
200, source=ai and reason=generated, referring to the synthetic account's lead,
completed session and overdue reminder. Temporary test account/data were removed.
No iOS binary change or device installation was required for this server fix.
