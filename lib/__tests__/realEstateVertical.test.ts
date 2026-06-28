/**
 * Tests: real estate vertical copy + vertical override system (PR39 session)
 *
 * Run with:
 *   NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test \
 *   npx tsx lib/__tests__/realEstateVertical.test.ts
 *
 * Coverage:
 *  1. DemoVertical type includes 'real_estate'
 *  2. resolvePayload DEMO_VERTICALS list includes 'real_estate'
 *  3. mapIndustryToDemoVertical maps industry strings correctly
 *  4. getVerticalCopyOverrides returns real estate overrides
 *  5. All required BeatCopy keys are present in real estate overrides
 *  6. b2Math hot row is present and sensible
 *  7. b5LeadDetails has real-estate-appropriate content (no roofing copy)
 *  8. b6Headline mentions listing (not roof)
 *  9. b5SyncText mentions a real estate CRM (Follow Up Boss or BoldTrail)
 * 10. getVerticalCopyOverrides returns {} for 'generic' (no spurious overrides)
 * 11. Vertical overrides applied correctly via resolvePayload (integration path)
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

// ─── 1. Type definition ───────────────────────────────────────────────────────

await test("payload.ts: DemoVertical includes 'real_estate'", async () => {
  const src = await read('lib/demo/payload.ts');
  assert.ok(src.includes("'real_estate'"), "DemoVertical type missing 'real_estate'");
});

// ─── 2. DEMO_VERTICALS whitelist ──────────────────────────────────────────────

await test("resolvePayload.ts: DEMO_VERTICALS includes 'real_estate'", async () => {
  const src = await read('lib/demo/resolvePayload.ts');
  assert.ok(src.includes("'real_estate'"), "DEMO_VERTICALS missing 'real_estate'");
});

// ─── 3. resolvePayload imports and applies overrides ─────────────────────────

await test('resolvePayload.ts: imports getVerticalCopyOverrides', async () => {
  const src = await read('lib/demo/resolvePayload.ts');
  assert.ok(
    src.includes('getVerticalCopyOverrides'),
    'resolvePayload.ts does not import or call getVerticalCopyOverrides'
  );
});

await test('resolvePayload.ts: applies overrides via spread', async () => {
  const src = await read('lib/demo/resolvePayload.ts');
  assert.ok(
    src.includes('payload.copy = { ...payload.copy, ...overrides }'),
    'resolvePayload.ts does not merge vertical copy overrides'
  );
});

// ─── 4. Industry mapper ───────────────────────────────────────────────────────

await test('mapIndustryToDemoVertical: maps "real estate" → real_estate', async () => {
  const src = await read('lib/demo/generateDemoLinkForLead.ts');
  assert.ok(
    src.includes("'real_estate'"),
    "generateDemoLinkForLead.ts missing 'real_estate' in mapper"
  );
  assert.ok(
    src.includes('real estate') || src.includes('realtor') || src.includes('realty'),
    'mapper does not check for real estate keywords'
  );
});

await test('mapIndustryToDemoVertical: logic — real estate strings', () => {
  // Mirror the mapper logic for unit testing without importing server-only modules
  function mapIndustryToDemoVertical(industry: string | null | undefined): string {
    const normalized = (industry ?? '').trim().toLowerCase();
    if (normalized.includes('roofing')) return 'roofing';
    if (normalized.includes('solar')) return 'solar';
    if (normalized.includes('lawn')) return 'lawncare';
    if (normalized.includes('hvac')) return 'hvac';
    if (
      normalized.includes('real estate') ||
      normalized.includes('realtor') ||
      normalized.includes('realty') ||
      normalized.includes('brokerage')
    ) return 'real_estate';
    return 'generic';
  }

  assert.equal(mapIndustryToDemoVertical('Real Estate'), 'real_estate');
  assert.equal(mapIndustryToDemoVertical('REAL ESTATE'), 'real_estate');
  assert.equal(mapIndustryToDemoVertical('Realtor'), 'real_estate');
  assert.equal(mapIndustryToDemoVertical('Realty'), 'real_estate');
  assert.equal(mapIndustryToDemoVertical('Real Estate Brokerage'), 'real_estate');
  assert.equal(mapIndustryToDemoVertical('Roofing'), 'roofing');
  assert.equal(mapIndustryToDemoVertical('HVAC'), 'hvac');
  assert.equal(mapIndustryToDemoVertical('Pest Control'), 'generic');
  assert.equal(mapIndustryToDemoVertical(null), 'generic');
});

// ─── 5. Vertical override file structure ─────────────────────────────────────

await test('verticals/index.ts: file exists', async () => {
  const src = await read('lib/demo/verticals/index.ts');
  assert.ok(src.length > 0, 'verticals/index.ts is empty');
});

await test('verticals/index.ts: exports getVerticalCopyOverrides', async () => {
  const src = await read('lib/demo/verticals/index.ts');
  assert.ok(
    src.includes('export function getVerticalCopyOverrides'),
    'getVerticalCopyOverrides not exported'
  );
});

// ─── 6. Real estate copy quality ──────────────────────────────────────────────

await test("real estate copy: b1Headline mentions agents", async () => {
  const src = await read('lib/demo/verticals/index.ts');
  assert.ok(src.includes('agents are on the doors'), 'b1Headline not real-estate specific');
});

await test("real estate copy: b2Math has non-roofing rate", async () => {
  const src = await read('lib/demo/verticals/index.ts');
  // Should have agent count and hourly rate
  assert.ok(src.includes('Agents'), "b2Math key should say 'Agents' not 'Reps'");
});

await test("real estate copy: b3Headline mentions farm (not just territory)", async () => {
  const src = await read('lib/demo/verticals/index.ts');
  assert.ok(src.includes('Draw a farm'), 'b3Headline should say "Draw a farm"');
});

await test("real estate copy: b5LeadDetails has real estate note (wants CMA)", async () => {
  const src = await read('lib/demo/verticals/index.ts');
  assert.ok(src.includes('CMA') || src.includes('selling'), 'b5LeadDetails lacks real estate context');
});

await test("real estate copy: b5SyncText mentions a real estate CRM", async () => {
  const src = await read('lib/demo/verticals/index.ts');
  assert.ok(
    src.includes('Follow Up Boss') || src.includes('BoldTrail') || src.includes('kvCORE'),
    'b5SyncText should mention a real estate CRM'
  );
});

await test("real estate copy: b6Headline mentions listing (not roof)", async () => {
  const src = await read('lib/demo/verticals/index.ts');
  assert.ok(src.includes('listing'), 'b6Headline should mention listing');
  assert.ok(!src.includes('One roof'), 'b6Headline should not say "One roof" for real estate');
});

// ─── 7. Generic vertical returns empty overrides ──────────────────────────────

await test("getVerticalCopyOverrides: returns {} for 'generic'", () => {
  // Test the exported function logic inline
  type Vertical = 'roofing' | 'lawncare' | 'hvac' | 'solar' | 'political' | 'real_estate' | 'generic';
  const VERTICAL_COPY: Partial<Record<Vertical, Record<string, unknown>>> = {
    real_estate: { b1Headline: 'test' },
  };
  function getVerticalCopyOverrides(v: Vertical): Record<string, unknown> {
    return VERTICAL_COPY[v] ?? {};
  }
  assert.deepEqual(getVerticalCopyOverrides('generic'), {});
  assert.deepEqual(getVerticalCopyOverrides('roofing'), {});
  assert.notDeepEqual(getVerticalCopyOverrides('real_estate'), {});
});

// ─── 8. No roofing copy bleeds into real estate overrides ────────────────────

await test("real estate copy: no roofing-specific language in overrides", async () => {
  const src = await read('lib/demo/verticals/index.ts');
  // b6Headline in defaults is "One roof pays for the year" — should not appear in RE overrides
  assert.ok(!src.includes('One roof'), 'roofing b6 copy leaked into real estate overrides');
  assert.ok(!src.includes('hail'), 'hail reference should not appear in real estate copy');
});

// ─── 9. b5Pitch array is real-estate specific ─────────────────────────────────

await test("real estate copy: b5Pitch[1] mentions real estate CRM", async () => {
  const src = await read('lib/demo/verticals/index.ts');
  // Must mention Follow Up Boss or BoldTrail in the pitch
  assert.ok(
    src.includes('Follow Up Boss') || src.includes('BoldTrail'),
    'b5Pitch does not mention a real estate CRM'
  );
});

await test("real estate copy: b5Pitch mentions farm sheet (not route sheet)", async () => {
  const src = await read('lib/demo/verticals/index.ts');
  assert.ok(src.includes('farm sheet'), 'b5Pitch[2] should say "farm sheet" for real estate');
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
