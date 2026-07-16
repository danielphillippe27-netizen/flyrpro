import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
let failures = 0;

async function source(file: string) {
  return readFile(path.join(root, file), 'utf8');
}

async function test(name: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

async function main() {
await test('invite UI sends invitations without seat checkout', async () => {
  const dialog = await source('components/home/team/InviteMemberDialog.tsx');
  assert.match(dialog, /Send invites/);
  assert.doesNotMatch(dialog, /additionalSeats|Pay for .*seat|paid seat/i);
});

await test('team invite API does not enforce paid-seat capacity', async () => {
  const route = await source('app/api/team/invites/route.ts');
  assert.doesNotMatch(route, /getSeatUsage|ensureInviteWithinSeatLimit|paid seat/i);
});

await test('owners and legacy solo owners render the team dashboard', async () => {
  const home = await source('app/(main)/home/HomePageClient.tsx');
  assert.match(home, /currentRole === 'owner'/);
  assert.match(home, /currentRole === 'admin'/);
  assert.match(home, /resolvedAccessLevel === 'solo_owner'/);
});

await test('campaign limit responses expose the stable public code', async () => {
  const route = await source('app/api/campaigns/route.ts');
  assert.match(route, /code: 'campaign_limit_reached'/);
});

await test('feedback guide targets the real header feedback control', async () => {
  const header = await source('components/layout/AppTopHeader.tsx');
  const dashboard = await source('components/home/TeamOwnerDashboardView.tsx');
  assert.match(header, /data-feedback-trigger="true"/);
  assert.match(dashboard, /\[data-feedback-trigger="true"\]/);
  assert.match(dashboard, /ResizeObserver/);
});

if (failures > 0) process.exit(1);
}

void main();
