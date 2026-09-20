# Sales Beta release — 15 September 2026

## Scope

Public customer Sales on web and iOS: verified contracts, owner/admin review, cancellation/history, targets and conversion evidence, historical reports, CSV export, configurable customer pipeline stages, weighted estimates and individual follow-up tasks. Sales entry points and feature labels carry Beta.

This is not full SalesRabbit/SPOTIO parity. The research inventory records remaining gaps, including configurable objects/report builders, automated sequences, offline sale queues, setter/closer attribution, signature providers, licensed prospect data and operational enterprise services.

## Verified evidence

- PostgreSQL regression suites pass for Sales permissions, retries, money, cohorts, historical timezone boundaries, reversals, pipeline privacy and task lifecycle.
- Real Supabase authentication passed with temporary owner, admin and rep accounts in a private acceptance workspace.
- Deployed public web shell passed submit → verify → Home → leaderboard → cancel, plus follow-up completion, with no page errors. This caught and corrected the missing Sales card on owner/member Home variants.
- The real SwiftUI Sales screens passed the same sales flow against live Supabase in an isolated simulator app. Pipeline follow-up creation/completion also passed. The unsigned harness uses in-memory auth storage; production authentication is unchanged.
- The full public iOS simulator build passed. A separate signed release archive is being prepared from a scoped checkout.
- Whole-web TypeScript checking still reports existing errors outside the Sales module; Sales-specific lint/type checks and production Next.js builds pass. The repository already bypasses global lint/type errors during production builds; this release did not add that bypass.

## Backend

Applied to the shared public Supabase project `kfnsnwqylsdsbgnwgxva`:

- `20260915190000_field_sales_v1`
- `20260915230000_field_sales_pipeline_beta`

Both migrations passed a rolled-back live-schema probe before installation. They were installed atomically and recorded in migration history. They did not enable ordinary workspaces. The separate Beta rollout migration must be applied after client acceptance.

The internal Sales project `yxxuazvosddtajwitlxu` was not migrated.

## Release isolation

Web source branch: `codex/customer-sales-beta-release`, built on the deployed parcel and Wolfy coaching releases. Public iOS source branch: `codex/customer-sales-beta-ios-release`; only Sales screens, entry points, a Home card/coaching module and release version metadata are included. It preserves the baseline mobile bottom navigation and excludes unrelated uncommitted changes.

Pending finalization: web promotion/rollout, signed iOS export/upload, temporary acceptance-data cleanup, and exact final URLs/build status below.
