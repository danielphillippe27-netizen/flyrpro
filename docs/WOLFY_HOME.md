# Wolfy Home

The field iOS target now opens Wolfy Home. The former Home grid lives in More,
with Calendar and an explicit Back to More control. Session, campaign creation,
Leads, assignment routing, and profile/Settings retain their existing destinations.

## Data and rollout

Apply `supabase/migrations/20260915150000_wolfy_home.sql` to the field app's
Supabase project before releasing the app. This migration has been tested in an
isolated PostgreSQL runtime; it has not been applied to a hosted project.
Do not push unrelated pending migrations from this checkout.

- Personal targets use `user_profiles.weekly_door_goal` and the new nullable
  `daily_door_goal`. Blank clears a target; positive integers set one.
- `wolfy_save_personal_goals` checks the expected user against the authenticated
  user and derives ownership from the token. A trigger prevents other authenticated
  users from changing personal targets even under broader profile update policies.
- `wolfy_home_metrics` is security-invoker, checks workspace membership, and filters
  activity to the authenticated user and selected workspace.
- Daily/weekly doors use dated session events, deduplicated per session and target;
  the latest undo removes a target. Conversations exclude no-answer/do-not-knock
  outcomes. Leads count field contacts created that day; appointments count meeting
  activities created that day, independently of their scheduled date.
- Day/week boundaries use the device's timezone, with Monday as the first day.
  Historical sessions without timestamped visit events are not guessed from totals.
- XP/streaks are existing personal all-time stats; leaderboard uses the existing
  weekly door leaderboard. Neither is presented as a workspace daily metric.
- Follow-up and appointment reads use strict, paginated remote loading for Home;
  other activity screens retain their existing cache fallback behavior.
- Home uses deterministic text, with no language-model calls or automatic outreach.
- Unsynced offline events are not included. Unavailable sections have retry states.

## Verification

```
swiftc WolfGrid/Feautures/Home/WolfyHomePolicy.swift scripts/test-wolfy-home.swift -o /tmp/test-wolfy-home
/tmp/test-wolfy-home
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node supabase/tests/wolfy_home.mjs
```

Tests cover Monday/Sunday, midnight, DST, goal pace, goal persistence and clearing,
invalid targets, foreign-owner and anonymous rejection, workspace authorization,
event deduplication and undo. The database test creates only an isolated in-memory
database and never connects to a hosted project.

The field simulator build and install/launch were verified. The simulator is signed
out. Authenticated navigation, real-account data comparison, device installation,
and light/dark/Dynamic Type inspection of Home remain release checks.
