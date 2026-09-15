# Wolfy hybrid coach

Home keeps the deterministic next step and displays a separate AI coaching tip. The Den adds **Ask Wolfy**, quick questions, a bounded conversation, clear and retry. Portraits, accessories, XP accounting and the live map are independent of coaching.

## Data and rules

`POST /api/wolfy/coach` requires a Supabase bearer session and verified workspace membership. It accepts only workspace ID, IANA device timezone, mode, question and up to six recent conversation messages. Client-supplied metrics, user IDs and system roles are rejected.

`wolfy_coach_context` reads through caller RLS, explicitly filters the authenticated owner/workspace, and reuses `wolfy_home_metrics`. It returns today's doors/conversations/leads/appointments, weekly doors, personal targets, overdue follow-ups and upcoming appointments. No contact names, notes, addresses or emails are automatically sent to OpenAI. Questions can contain user-entered information; the chat explains this. There is no persisted chat transcript.

Priority: overdue follow-ups, upcoming appointments, then remaining weekly doors and rounded-up daily pace through Sunday (including today), then setting goals. Local day and Monday–Sunday boundaries are computed in PostgreSQL using the validated device timezone. Missing metrics return unavailable, never fabricated zeros. Counts represent synced activity, not unsynced local work. Historical trends, sales totals and leaderboard position are not part of this first coaching context.

## Model and spending

The model is deliberately fixed to `gpt-5-nano`, with minimal reasoning, 1,000 maximum output tokens (including reasoning), no tools, no retries and an 18-second provider timeout. There is no expensive model fallback. Responses API uses `store:false` and strict JSON output. Numeric claims, links, malformed output and common false action claims are rejected. This is a guardrail, not a guarantee that generated prose is correct. Exact figures and destinations come from code; coaching cannot mutate records, XP or purchases.

A service-only cache holds one brief per user/workspace. It is reused for 15 minutes only while facts and local day are unchanged. Changed data uses fixed rules during a 60-second brief cooldown. An atomic service-only database reservation limits **all workspaces combined to 30 model attempts per user per UTC day**, with a five-second cooldown. Failures consume an attempt. Missing cache/quota storage fails closed to fixed rules. There is no scheduled or background model loop. Home requests on launch, foreground, refresh and relevant activity/goal refreshes; chat requests only on send/retry. Account/workspace changes create a new scoped store; late replies cannot update another scope.

## Activation

1. Apply existing Home migration `20260915150000_wolfy_home.sql`, then `20260915220000_wolfy_coach.sql` to the matching Supabase project. The new tables reference existing auth users and workspaces. Do not apply unrelated pending migrations blindly.
2. Set server-only `OPENAI_API_KEY` for the backend. Never add it to Xcode, Info.plist, a public environment variable or source control. Configure a project spending limit in the provider dashboard.
3. Deploy the private route/library with existing Supabase URL, anon and service-role configuration. Ship the iOS build pointing to that backend through `Config.backendAPIURL`.
4. Verify two real accounts/workspaces, actual synced activity and a real nano response on the deployed endpoint. Until activation, Home retains rule-based advice and Ask Wolfy reports unavailable.

No hosted migration, backend deployment, real OpenAI call or device installation is implied by local build/tests.

## Verification

- `npx tsx --test lib/wolfy/__tests__/*.test.ts` (from backend): policy, malformed/hostile input, unavailable metrics, cache invalidation, bearer/membership checks, model contract, budget denial and provider fallback through mocked HTTP.
- `PGLITE_MODULE=/tmp/wolfy-db-test/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/wolfy_coach.mjs`: PostgreSQL migration execution, owner scope, anonymous/foreign access, private tables, service-only atomic budget/cooldown/day rollover.
- `npx tsc --noEmit --incremental false`: backend type check.
- Build field `WolfGrid` iOS simulator target. Debug UI launch: `--wolfy-lab --wolfy-coach` (explicitly labelled fixture, no real account data).

### Local verification result (2026-09-15)

Seven backend tests passed, PostgreSQL isolation/budget tests passed, and TypeScript passed. Field simulator build succeeded; a transient link error during concurrent live-canvassing edits cleared on rebuild. Installed and launched the explicit coach fixture on the dedicated iPhone 16e simulator. Light and dark/max Dynamic Type screenshots are in `art/wolfy/coach-review/`; text wraps in the scroll view and the composer stays available. A final privacy-copy correction was syntax-checked after the simulator build. Real authenticated data, production configuration, live provider quality and physical-device behavior remain unverified.
