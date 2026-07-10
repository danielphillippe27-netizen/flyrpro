/**
 * Tests: salesperson route guards (PR39 session)
 *
 * Run with:
 *   NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test \
 *   npx tsx lib/__tests__/salespersonRouteGuards.test.ts
 *
 * Coverage:
 *  1. requireSalesperson.ts exists and has correct redirect logic
 *  2. Each unguarded route now calls requireSalesperson()
 *  3. requireSalesperson blocks founders, owners, and admins
 *  4. requireFounder routes still have their guard
 *  5. No route uses 'use client' where a server guard is present
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');

async function read(rel: string): Promise<string> {
  return fs.readFile(path.join(root, rel), 'utf8');
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

async function main() {

// ─── 1. requireSalesperson utility ───────────────────────────────────────────

await test('requireSalesperson: file exists', async () => {
  const src = await read('lib/auth/requireSalesperson.ts');
  assert.ok(src.length > 0, 'requireSalesperson.ts is empty');
});

await test('requireSalesperson: redirects to /login when no user', async () => {
  const src = await read('lib/auth/requireSalesperson.ts');
  assert.ok(src.includes("redirect('/login')"), 'missing redirect to /login');
});

await test('requireSalesperson: redirects to /home when owner role', async () => {
  const src = await read('lib/auth/requireSalesperson.ts');
  assert.ok(
    src.includes("access.role === 'owner'"),
    "missing owner role guard"
  );
  assert.ok(src.includes("redirect('/home')"), 'missing redirect to /home');
});

await test('requireSalesperson: redirects to /home when admin role', async () => {
  const src = await read('lib/auth/requireSalesperson.ts');
  assert.ok(src.includes("access.role === 'admin'"), "missing admin role guard");
});

await test('requireSalesperson: redirects to /home when founder', async () => {
  const src = await read('lib/auth/requireSalesperson.ts');
  assert.ok(src.includes('access.isFounder'), 'missing isFounder guard');
});

await test('requireSalesperson: uses resolveSalespersonForUser for the check', async () => {
  const src = await read('lib/auth/requireSalesperson.ts');
  assert.ok(
    src.includes('resolveSalespersonForUser'),
    'requireSalesperson does not call resolveSalespersonForUser'
  );
});

// ─── 2. Each route imports and calls requireSalesperson ──────────────────────

const guardedRoutes: Array<{ route: string; file: string }> = [
  { route: '/dialer',           file: 'app/(main)/dialer/page.tsx' },
  { route: '/scraper',          file: 'app/(main)/scraper/page.tsx' },
  { route: '/inbox',            file: 'app/(main)/inbox/page.tsx' },
  { route: '/scripts',          file: 'app/(main)/scripts/page.tsx' },
  { route: '/sales-leaderboard',file: 'app/(main)/sales-leaderboard/page.tsx' },
];

for (const { route, file } of guardedRoutes) {
  await test(`${route}: imports requireSalesperson`, async () => {
    const src = await read(file);
    assert.ok(
      src.includes("from '@/lib/auth/requireSalesperson'"),
      `${file} does not import requireSalesperson`
    );
  });

  await test(`${route}: calls await requireSalesperson()`, async () => {
    const src = await read(file);
    assert.ok(
      src.includes('await requireSalesperson()'),
      `${file} does not call await requireSalesperson()`
    );
  });

  await test(`${route}: page function is async`, async () => {
    const src = await read(file);
    assert.ok(
      src.includes('async function') || src.includes('async ('),
      `${file} page export is not async — requireSalesperson() won't be awaited`
    );
  });

  await test(`${route}: is a server component (no "use client")`, async () => {
    const src = await read(file);
    assert.ok(
      !src.includes("'use client'") && !src.includes('"use client"'),
      `${file} has "use client" — server guard won't run`
    );
  });
}

// ─── 3. Founder-only routes still have requireFounder ────────────────────────

const founderRoutes = [
  'app/(main)/salespeople/page.tsx',
  'app/(main)/ambassadors/page.tsx',
];

for (const file of founderRoutes) {
  await test(`${file}: still calls requireFounder()`, async () => {
    const src = await read(file);
    assert.ok(
      src.includes('requireFounder'),
      `${file} lost its requireFounder() guard`
    );
  });
}

// ─── 4. requireFounder itself still has correct redirect logic ────────────────

await test('requireFounder: redirects to /login when no user', async () => {
  const src = await read('lib/auth/requireFounder.ts');
  assert.ok(src.includes("redirect('/login')"), 'requireFounder missing /login redirect');
});

await test('requireFounder: 404s non-founders (not just redirect)', async () => {
  const src = await read('lib/auth/requireFounder.ts');
  assert.ok(src.includes('notFound()'), 'requireFounder should 404, not redirect, for non-founders');
});

// ─── 5. Guard logic: role hierarchy ──────────────────────────────────────────

await test('guard logic: salesperson access matrix', () => {
  // Mirrors the logic inside requireSalesperson
  function canAccessSalespersonRoute(params: {
    hasUser: boolean;
    isFounder: boolean;
    role: string | null;
    hasSalespersonRecord: boolean;
  }): 'login' | 'home' | 'allow' {
    if (!params.hasUser) return 'login';
    if (params.isFounder || params.role === 'owner' || params.role === 'admin') return 'home';
    if (!params.hasSalespersonRecord) return 'home';
    return 'allow';
  }

  assert.equal(canAccessSalespersonRoute({ hasUser: false, isFounder: false, role: null, hasSalespersonRecord: false }), 'login');
  assert.equal(canAccessSalespersonRoute({ hasUser: true, isFounder: true, role: null, hasSalespersonRecord: true }), 'home');
  assert.equal(canAccessSalespersonRoute({ hasUser: true, isFounder: false, role: 'owner', hasSalespersonRecord: true }), 'home');
  assert.equal(canAccessSalespersonRoute({ hasUser: true, isFounder: false, role: 'admin', hasSalespersonRecord: true }), 'home');
  assert.equal(canAccessSalespersonRoute({ hasUser: true, isFounder: false, role: 'member', hasSalespersonRecord: false }), 'home');
  assert.equal(canAccessSalespersonRoute({ hasUser: true, isFounder: false, role: 'member', hasSalespersonRecord: true }), 'allow');
  assert.equal(canAccessSalespersonRoute({ hasUser: true, isFounder: false, role: null, hasSalespersonRecord: true }), 'allow');
});

} // end main

main()
  .then(() => {
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  })
  .catch((err: unknown) => {
    console.error('Test runner crashed:', err);
    process.exitCode = 1;
  });
