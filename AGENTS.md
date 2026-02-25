# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

FLYR PRO is a Next.js 15 (App Router, Turbopack) direct mail campaign management platform. All data services (Supabase, Stripe, Mapbox) are cloud-hosted — no local databases or Docker required for the main app.

### Running the app

- **Dev server**: `npm run dev` (port 3000, uses Turbopack)
- **Build**: `npm run build` (TypeScript and ESLint errors are intentionally ignored via `next.config.js`)
- **Lint**: `npm run lint` (pre-existing warnings/errors exist in the codebase; this is expected)

### Environment variables

A `.env.local` file is required at the project root. See `SETUP.md` for full details. The critical vars are:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `APP_BASE_URL` (typically `http://localhost:3000`)

The middleware (`middleware.ts`) gracefully handles missing/invalid Supabase credentials (catches errors, logs once), so the dev server starts even with placeholder values. However, authenticated routes and API calls will fail without real credentials.

### Gotchas

- The `next.config.js` sets `serverExternalPackages` for `duckdb` and `@duckdb/node-api` (native C++ bindings). These must not be bundled by Webpack.
- The ESLint config (`eslint.config.mjs`) uses flat config format with `@eslint/eslintrc` FlatCompat for Next.js compatibility.
- The codebase has ~493 pre-existing ESLint errors and ~1130 warnings. The build ignores these (`ignoreDuringBuilds: true`).
- There is a `web/` sub-project (Vite/React leaderboard SPA) and a `kimi-cli/` sub-project (Lambda deployment CLI). These are independent and not required for the main app.

### Sub-projects

| Sub-project | Purpose | Dev command |
|-------------|---------|-------------|
| `web/` | Leaderboard SPA (Vite + React) | `cd web && npm install && npm run dev` |
| `kimi-cli/` | Lambda deployment CLI | Not a dev server; used for AWS deployments |
