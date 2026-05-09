# Known Issues

This file documents known technical debt and deferred fixes.

---

## TypeScript build errors (343 errors as of May 2026)

The TypeScript compiler reports 343 errors across the application.
Build gates in `next.config.js` are currently disabled
(`ignoreBuildErrors: true`, `ignoreDuringBuilds: true`) to allow
Vercel deployments to continue while these are resolved.

### Error breakdown by category

| Error code | Count | Meaning |
|-----------|-------|---------|
| TS2339 | 49 | Property does not exist on type |
| TS2345 | 47 | Argument type mismatch |
| TS2322 | 40 | Type assignment mismatch |
| TS18046 | 40 | Value is possibly unknown |
| TS2739 | 34 | Missing required properties |
| TS2352 | 16 | Invalid type assertion |
| TS18047 | 16 | Value is possibly null |
| TS7006 | 14 | Parameter implicitly has any type |
| TS2307 | 13 | Cannot find module |
| TS2304 | 13 | Cannot find name |
| TS18048 | 13 | Value is possibly undefined |
| other | 48 | Various |

### Most affected areas

- `lib/services/` — service layer types don't match Supabase query return shapes
- `components/map/` — Three.js and Mapbox types loosely typed
- `lib/editor-canva/` — editor subsystem has incomplete type coverage
- `app/api/` — several route handlers use implicit any

### Known specific errors

- `lib/stripe.ts:5` — Stripe API version string `"2025-09-30.clover"` is not
  assignable to expected version type. Stripe SDK needs updating.
- `lib/services/ParcelEnrichmentService.ts:1055` — PostgrestFilterBuilder
  being used where Promise is expected. Likely a missing `await`.
- `lib/services/StatsService.ts:105` — `appointment_at` field missing from
  query select but required by return type.

### Resolution plan

Fix errors in this priority order:
1. Simple missing `await` calls (TS2739 where Promise assigned to non-Promise)
2. Missing fields in select queries (TS2739, TS2322)
3. Stripe SDK version update
4. Null/undefined narrowing (TS18046, TS18047, TS18048)
5. Implicit any cleanup (TS7006)
6. Module resolution issues (TS2307, TS2304)

Re-enable build gates in `next.config.js` once error count reaches 0:
```js
typescript: { ignoreBuildErrors: false },
eslint: { ignoreDuringBuilds: false },
```

---

## supabase/functions — Deno runtime errors

The `supabase/functions/` directory contains Deno Edge Functions which
use Deno-specific imports (`https://deno.land/...`) and globals (`Deno`).
These are excluded from TypeScript compilation via `tsconfig.json` because
the Next.js TypeScript compiler cannot resolve Deno module URLs.

These are not errors — the functions work correctly when deployed to
Supabase Edge Functions. They should be linted separately using the
Deno CLI if needed.

---

## schema.current.sql — no local Supabase setup

The production schema has been exported to `supabase/schema.current.sql`
but no local Supabase CLI environment has been configured. Running
`supabase start` or `supabase db reset` will not produce a working
local database. See `MIGRATIONS.md` Section 10 for details.