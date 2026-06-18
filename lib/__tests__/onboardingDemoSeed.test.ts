import {
  deterministicDemoUuid,
  resolveDemoRolePath,
  seedStarterCampaignForWorkspace,
  starterCampaignIdForWorkspace,
} from '../onboarding/demo';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
type Result = { data?: unknown; error: null; count?: number | null };

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private limitCount: number | null = null;
  private mode: 'select' | 'upsert' | 'update' = 'select';
  private mutationRows: Row[] = [];
  private patch: Row = {};
  private head = false;
  private countMode = false;

  constructor(private db: Record<string, Row[]>, private table: string) {
    if (!this.db[this.table]) this.db[this.table] = [];
  }

  select(_columnsOrOptions: string | { count?: string; head?: boolean } = '*', options?: { count?: string; head?: boolean }) {
    void _columnsOrOptions;
    this.countMode = options?.count === 'exact';
    this.head = options?.head === true;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value);
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  upsert(rows: Row | Row[], options?: { onConflict?: string }) {
    this.mode = 'upsert';
    this.mutationRows = Array.isArray(rows) ? rows : [rows];
    const conflictColumns = (options?.onConflict ?? 'id').split(',').map((column) => column.trim());
    const tableRows = this.db[this.table];
    const changed: Row[] = [];
    for (const row of this.mutationRows) {
      const existing = tableRows.find((candidate) =>
        conflictColumns.every((column) => candidate[column] === row[column])
      );
      if (existing) {
        Object.assign(existing, row);
        changed.push(existing);
      } else {
        const inserted = {
          ...row,
          id: typeof row.id === 'string' ? row.id : deterministicDemoUuid(`${this.table}:${tableRows.length}`),
        };
        tableRows.push(inserted);
        changed.push(inserted);
      }
    }
    this.mutationRows = changed;
    return this;
  }

  update(patch: Row) {
    this.mode = 'update';
    this.patch = patch;
    return this;
  }

  maybeSingle(): Promise<Result> {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  single(): Promise<Result> {
    if (this.mode === 'upsert') {
      return Promise.resolve({ data: this.mutationRows[0] ?? null, error: null });
    }
    if (this.mode === 'update') {
      const rows = this.rows();
      for (const row of rows) Object.assign(row, this.patch);
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    }
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) {
    return this.execute().then(resolve, reject);
  }

  private async execute(): Promise<Result> {
    if (this.mode === 'upsert') return { data: this.mutationRows, error: null };
    if (this.mode === 'update') {
      const rows = this.rows();
      for (const row of rows) Object.assign(row, this.patch);
      return { data: rows, error: null, count: rows.length };
    }
    const rows = this.rows();
    return {
      data: this.head ? null : rows,
      error: null,
      count: this.countMode ? rows.length : null,
    };
  }

  private rows() {
    let rows = this.db[this.table].filter((row) => this.filters.every((filter) => filter(row)));
    if (this.limitCount !== null) rows = rows.slice(0, this.limitCount);
    return rows;
  }
}

class FakeSupabase {
  constructor(public db: Record<string, Row[]>) {}
  from(table: string) {
    return new FakeQuery(this.db, table);
  }
}

function fakeClient(db: Record<string, Row[]>): SupabaseClient {
  return new FakeSupabase(db) as unknown as SupabaseClient;
}

let testsPassed = 0;
let testsFailed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    testsPassed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    testsFailed += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function createDb(role: 'owner' | 'admin' | 'member' = 'owner'): Record<string, Row[]> {
  return {
    workspace_members: [
      { workspace_id: 'workspace-1', user_id: 'user-1', role },
    ],
    workspaces: [{ id: 'workspace-1', max_seats: role === 'member' ? 1 : 2 }],
    onboarding_demo_states: [],
    campaigns: [],
    campaign_addresses: [],
    address_statuses: [],
    contacts: [],
    sessions: [],
    campaign_assignments: [],
  };
}

async function main() {
  await test('seed is deterministic and idempotent', async () => {
    const db = createDb('owner');
    const supabase = fakeClient(db);
    const first = await seedStarterCampaignForWorkspace(supabase, {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'owner',
      memberCount: 1,
      maxSeats: 1,
    });
    const second = await seedStarterCampaignForWorkspace(supabase, {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'owner',
      memberCount: 1,
      maxSeats: 1,
    });

    assert(first.seeded === true, 'first call should seed');
    assert(second.campaignId === first.campaignId, 'second call should return same campaign id');
    assert(db.campaigns.length === 1, 'should not duplicate campaigns');
    assert(db.campaign_addresses.length === 24, 'should seed 24 addresses');
    assert(db.address_statuses.length === 8, 'should seed 8 statuses');
    assert(db.contacts.length === 5, 'should seed 5 contacts');
    assert(db.sessions.length === 2, 'should seed 2 sessions');
    assert(first.campaignId === starterCampaignIdForWorkspace('workspace-1'), 'campaign id should be deterministic');
  });

  await test('seed keeps the replay available alongside real campaigns', async () => {
    const db = createDb('owner');
    db.campaigns.push({ id: 'real-campaign', workspace_id: 'workspace-1', name: 'Real Campaign', tags: null });
    const result = await seedStarterCampaignForWorkspace(fakeClient(db), {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'owner',
      memberCount: 1,
      maxSeats: 1,
    });

    assert(result.seeded === true, 'should seed the replay');
    assert(result.campaignId === starterCampaignIdForWorkspace('workspace-1'), 'should return the replay campaign');
    assert(db.campaigns.length === 2, 'should keep the real campaign and add the replay');
  });

  await test('regular members cannot seed demo campaigns', async () => {
    const db = createDb('member');
    let failed = false;
    try {
      await seedStarterCampaignForWorkspace(fakeClient(db), {
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: 'member',
        memberCount: 2,
        maxSeats: 2,
      });
    } catch {
      failed = true;
    }

    assert(failed, 'member seed should fail');
    assert(db.campaigns.length === 0, 'member should not create campaign');
  });

  await test('role path resolves team owner, solo owner, and member', () => {
    assert(resolveDemoRolePath({ role: 'owner', memberCount: 1, maxSeats: 1 }) === 'solo_owner', 'owner with one seat should be solo');
    assert(resolveDemoRolePath({ role: 'owner', memberCount: 1, maxSeats: 2 }) === 'team_owner', 'owner with team seats should be team owner');
    assert(resolveDemoRolePath({ role: 'admin', memberCount: 2, maxSeats: 2 }) === 'team_owner', 'admin should be team owner path');
    assert(resolveDemoRolePath({ role: 'member', memberCount: 2, maxSeats: 2 }) === 'member', 'member should be member path');
  });

  if (testsFailed > 0) {
    console.error(`\n${testsFailed} test(s) failed, ${testsPassed} passed.`);
    process.exit(1);
  }

  console.log(`\n${testsPassed} test(s) passed.`);
}

void main();
