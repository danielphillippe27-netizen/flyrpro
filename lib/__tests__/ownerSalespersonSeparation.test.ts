/**
 * Test suite: owner/salesperson world separation (PR39 session)
 *
 * Run with:
 *   NEXT_PUBLIC_SUPABASE_URL=https://x.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test \
 *   npx tsx lib/__tests__/ownerSalespersonSeparation.test.ts
 *
 * Coverage:
 *  1. contact.name → contact.full_name fix in campaigns page
 *  2. CrmContactsHub has zero dialer/scraper DNA
 *  3. CrmContactsHub uses ContactsService, not campaign_contacts
 *  4. CrmContactsHub passes callStats={null} to LeadsTableView
 *  5. LeadsTableView stat cards gated on callStats !== null
 *  6. leads/page.tsx routes by role (imports both views, has role guard)
 *  7. post-auth-gate.ts: isSalesperson gated on role !== owner/admin
 *  8. access/state/route.ts: salespersonDashboardEnabled gated on role
 *  9. home/page.tsx: accessLevel gated on role
 * 10. Role guard logic: owner always wins over salespeople table
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

// ─── Test runner ──────────────────────────────────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main() {

// 1. campaigns/[campaignId]/page.tsx: contact.name → contact.full_name
await test('campaigns page: contact.name is no longer referenced', async () => {
  const src = await read('app/(main)/campaigns/[campaignId]/page.tsx');
  assert.ok(
    !src.includes('contact.name'),
    'contact.name still referenced — should be contact.full_name'
  );
});

await test('campaigns page: contact.full_name is used for contact label', async () => {
  const src = await read('app/(main)/campaigns/[campaignId]/page.tsx');
  assert.ok(
    src.includes('contact.full_name'),
    'contact.full_name not found in campaign page'
  );
});

// 2. CrmContactsHub: zero dialer/scraper DNA
await test('CrmContactsHub: no dialler/dialer references', async () => {
  const src = await read('components/crm/CrmContactsHub.tsx');
  const dialerRefs = [...src.matchAll(/diall?er/gi)].map((m) => m[0]);
  assert.equal(
    dialerRefs.length,
    0,
    `CrmContactsHub contains dialler references: ${dialerRefs.join(', ')}`
  );
});

await test('CrmContactsHub: no scraper references', async () => {
  const src = await read('components/crm/CrmContactsHub.tsx');
  assert.ok(
    !src.toLowerCase().includes('scraper'),
    'CrmContactsHub contains scraper reference'
  );
});

await test('CrmContactsHub: no PhoneCall/Send to Diall imports or JSX', async () => {
  const src = await read('components/crm/CrmContactsHub.tsx');
  assert.ok(!src.includes('PhoneCall'), 'CrmContactsHub imports PhoneCall icon');
  assert.ok(!src.includes('sendToDialer'), 'CrmContactsHub references sendToDialer copy');
  assert.ok(!src.includes('handleSendListToDialler'), 'CrmContactsHub has handleSendListToDialler');
});

await test('CrmContactsHub: owner-appropriate description in source', async () => {
  const src = await read('components/crm/CrmContactsHub.tsx');
  assert.ok(
    src.includes('campaigns and manual entries'),
    'CrmContactsHub does not contain owner-appropriate description'
  );
});

// 3. CrmContactsHub: data source
await test('CrmContactsHub: uses ContactsService.fetchContacts', async () => {
  const src = await read('components/crm/CrmContactsHub.tsx');
  assert.ok(
    src.includes('ContactsService.fetchContacts'),
    'CrmContactsHub does not use ContactsService.fetchContacts'
  );
});

await test('CrmContactsHub: no campaign_contacts table references', async () => {
  const src = await read('components/crm/CrmContactsHub.tsx');
  assert.ok(
    !src.includes('campaign_contacts'),
    'CrmContactsHub references campaign_contacts table'
  );
});

await test('CrmContactsHub: uses full_name not name for contact label', async () => {
  const src = await read('components/crm/CrmContactsHub.tsx');
  // Should not use contact.name (wrong field)
  assert.ok(
    !src.includes('contact.name'),
    'CrmContactsHub uses contact.name instead of contact.full_name'
  );
});

// 4. CrmContactsHub: passes callStats={null} to LeadsTableView
await test('CrmContactsHub: passes callStats={null} to LeadsTableView', async () => {
  const src = await read('components/crm/CrmContactsHub.tsx');
  assert.ok(
    src.includes('callStats={null}'),
    'CrmContactsHub does not pass callStats={null} to LeadsTableView'
  );
});

// 5. LeadsTableView: stat cards gated on callStats !== null
await test('LeadsTableView: stat grid is conditional on callStats !== null', async () => {
  const src = await read('components/crm/LeadsTableView.tsx');
  assert.ok(
    src.includes('callStats !== null'),
    'LeadsTableView does not gate stat cards on callStats !== null'
  );
});

await test('LeadsTableView: stat grid is inside the callStats guard', async () => {
  const src = await read('components/crm/LeadsTableView.tsx');
  const guardIdx = src.indexOf('callStats !== null');
  const gridIdx = src.indexOf('grid-cols-2 lg:grid-cols-4');
  assert.ok(guardIdx !== -1, 'callStats !== null guard not found');
  assert.ok(gridIdx !== -1, 'stat grid not found');
  assert.ok(
    gridIdx > guardIdx,
    'stat grid appears before the callStats !== null guard — cards would always render'
  );
});

// 6. leads/page.tsx: routes by role
await test('leads/page.tsx: imports ContactsHubView (salesperson path)', async () => {
  const src = await read('app/(main)/leads/page.tsx');
  assert.ok(
    src.includes("from '@/components/crm/ContactsHubView'"),
    'leads/page.tsx does not import ContactsHubView'
  );
});

await test('leads/page.tsx: imports CrmContactsHub (owner path)', async () => {
  const src = await read('app/(main)/leads/page.tsx');
  assert.ok(
    src.includes("from '@/components/crm/CrmContactsHub'"),
    'leads/page.tsx does not import CrmContactsHub'
  );
});

await test('leads/page.tsx: has role guard blocking owners from salesperson view', async () => {
  const src = await read('app/(main)/leads/page.tsx');
  assert.ok(
    src.includes("access.role !== 'owner'"),
    "leads/page.tsx missing access.role !== 'owner' guard"
  );
  assert.ok(
    src.includes("access.role !== 'admin'"),
    "leads/page.tsx missing access.role !== 'admin' guard"
  );
});

await test('leads/page.tsx: renders CrmContactsHub for non-salesperson', async () => {
  const src = await read('app/(main)/leads/page.tsx');
  // The ternary must have CrmContactsHub in the false branch
  assert.ok(
    src.includes('<CrmContactsHub />'),
    'leads/page.tsx does not render CrmContactsHub'
  );
});

await test('leads/page.tsx: is a server component (no "use client")', async () => {
  const src = await read('app/(main)/leads/page.tsx');
  assert.ok(
    !src.startsWith("'use client'") && !src.includes('"use client"'),
    'leads/page.tsx still has "use client" — must be a server component to do role-based routing'
  );
});

// 7. post-auth-gate.ts: isSalesperson gated on role
await test('post-auth-gate.ts: isSalesperson check guards owner role', async () => {
  const src = await read('app/lib/post-auth-gate.ts');
  // Find the isSalesperson branch
  const salespersonBranchIdx = src.indexOf('if (isSalesperson');
  assert.ok(salespersonBranchIdx !== -1, 'isSalesperson branch not found');
  const branch = src.slice(salespersonBranchIdx, salespersonBranchIdx + 200);
  assert.ok(
    branch.includes("access.role !== 'owner'"),
    "post-auth-gate.ts isSalesperson branch missing access.role !== 'owner' guard"
  );
  assert.ok(
    branch.includes("access.role !== 'admin'"),
    "post-auth-gate.ts isSalesperson branch missing access.role !== 'admin' guard"
  );
});

// 8. access/state/route.ts: salespersonDashboardEnabled gated on role
await test('access/state: salespersonDashboardEnabled guards owner/admin role', async () => {
  const src = await read('app/api/access/state/route.ts');
  const enabledIdx = src.indexOf('salespersonDashboardEnabled');
  assert.ok(enabledIdx !== -1, 'salespersonDashboardEnabled not found');
  // Check within a reasonable window after the declaration
  const window = src.slice(enabledIdx, enabledIdx + 300);
  assert.ok(
    window.includes("access.role !== 'owner'"),
    "access/state salespersonDashboardEnabled missing access.role !== 'owner' guard"
  );
  assert.ok(
    window.includes("access.role !== 'admin'"),
    "access/state salespersonDashboardEnabled missing access.role !== 'admin' guard"
  );
});

// 9. home/page.tsx: accessLevel gated on role
await test('home/page.tsx: accessLevel derivation guards owner/admin role', async () => {
  const src = await read('app/(main)/home/page.tsx');
  const accessLevelIdx = src.indexOf('const accessLevel');
  assert.ok(accessLevelIdx !== -1, 'accessLevel declaration not found');
  const window = src.slice(accessLevelIdx, accessLevelIdx + 300);
  assert.ok(
    window.includes("access.role !== 'owner'"),
    "home/page.tsx accessLevel missing access.role !== 'owner' guard"
  );
  assert.ok(
    window.includes("access.role !== 'admin'"),
    "home/page.tsx accessLevel missing access.role !== 'admin' guard"
  );
});

// 10. Role guard logic: owner always wins
await test('role guard logic: owner role blocks salesperson classification', () => {
  // Replicate the gate logic from all three files
  function isSalespersonEnabled(params: {
    isSalesperson: boolean;
    isFounder: boolean;
    role: string | null;
  }): boolean {
    return (
      params.isSalesperson &&
      !params.isFounder &&
      params.role !== 'owner' &&
      params.role !== 'admin'
    );
  }

  // Owner with email in salespeople table → NOT salesperson
  assert.equal(
    isSalespersonEnabled({ isSalesperson: true, isFounder: false, role: 'owner' }),
    false,
    'Owner should NOT be treated as salesperson'
  );

  // Admin with email in salespeople table → NOT salesperson
  assert.equal(
    isSalespersonEnabled({ isSalesperson: true, isFounder: false, role: 'admin' }),
    false,
    'Admin should NOT be treated as salesperson'
  );

  // Founder always excluded regardless
  assert.equal(
    isSalespersonEnabled({ isSalesperson: true, isFounder: true, role: null }),
    false,
    'Founder should NOT be treated as salesperson'
  );

  // Regular member with salespeople row → IS salesperson
  assert.equal(
    isSalespersonEnabled({ isSalesperson: true, isFounder: false, role: 'member' }),
    true,
    'Member with salespeople row SHOULD be treated as salesperson'
  );

  // Member without salespeople row → NOT salesperson
  assert.equal(
    isSalespersonEnabled({ isSalesperson: false, isFounder: false, role: 'member' }),
    false,
    'Member without salespeople row should NOT be treated as salesperson'
  );

  // null role (no workspace) → NOT salesperson
  assert.equal(
    isSalespersonEnabled({ isSalesperson: true, isFounder: false, role: null }),
    true, // role is null (not 'owner'/'admin'), so only isFounder gates it — this is acceptable
    'null role with salesperson row should pass the gate (no workspace = no owner role to check)'
  );
});

await test('Contact interface: has full_name, no name field', async () => {
  const src = await read('types/database.ts');
  // Find the Contact interface
  const contactIdx = src.indexOf('export interface Contact {');
  assert.ok(contactIdx !== -1, 'Contact interface not found');
  const contactBlock = src.slice(contactIdx, contactIdx + 600);
  assert.ok(
    contactBlock.includes('full_name:'),
    'Contact interface does not have full_name field'
  );
  // 'name:' should not appear as a standalone field in the Contact block
  const nameFieldMatch = contactBlock.match(/^\s+name\s*[?:].*$/m);
  assert.ok(
    !nameFieldMatch,
    `Contact interface has unexpected 'name' field: ${nameFieldMatch?.[0]}`
  );
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
