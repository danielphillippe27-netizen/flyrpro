import {
  getDemoStateForUser,
  patchDemoStateForUser,
  starterCampaignIdForWorkspace,
} from '../onboarding/demo';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
type Result = { data?: unknown; error: null; count?: number | null };

class FakeQuery {
  private filters: Array<(row: Row) => boolean> = [];
  private mode: 'select' | 'upsert' | 'update' = 'select';
  private mutationRows: Row[] = [];
  private patch: Row = {};
  private countMode = false;
  private head = false;

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

  limit(count: number) {
    void count;
    return this;
  }

  upsert(rows: Row | Row[], options?: { onConflict?: string }) {
    this.mode = 'upsert';
    const incoming = Array.isArray(rows) ? rows : [rows];
    const conflicts = (options?.onConflict ?? 'id').split(',').map((column) => column.trim());
    const changed: Row[] = [];
    for (const row of incoming) {
      const existing = this.db[this.table].find((candidate) =>
        conflicts.every((column) => candidate[column] === row[column])
      );
      if (existing) {
        Object.assign(existing, row);
        changed.push(existing);
      } else {
        const inserted = {
          ...row,
          id: typeof row.id === 'string' ? row.id : `${this.table}-${this.db[this.table].length + 1}`,
        };
        this.db[this.table].push(inserted);
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
    if (this.mode === 'upsert') return Promise.resolve({ data: this.mutationRows[0] ?? null, error: null });
    if (this.mode === 'update') {
      const row = this.rows()[0] ?? null;
      if (row) Object.assign(row, this.patch);
      return Promise.resolve({ data: row, error: null });
    }
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }

  then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) {
    return this.execute().then(resolve, reject);
  }

  private async execute(): Promise<Result> {
    const rows = this.rows();
    return { data: this.head ? null : rows, error: null, count: this.countMode ? rows.length : null };
  }

  private rows() {
    return this.db[this.table].filter((row) => this.filters.every((filter) => filter(row)));
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

function createDb(): Record<string, Row[]> {
  return {
    onboarding_demo_states: [],
    campaigns: [
      {
        id: starterCampaignIdForWorkspace('workspace-1'),
        workspace_id: 'workspace-1',
        name: 'Salt Lake City Replay Campaign',
        tags: 'starter-demo,pre-recorded,salt-lake-city',
      },
    ],
    contacts: [
      { id: 'contact-1', campaign_id: starterCampaignIdForWorkspace('workspace-1'), tags: 'starter-demo' },
      { id: 'contact-2', campaign_id: starterCampaignIdForWorkspace('workspace-1'), tags: 'starter-demo' },
    ],
  };
}

async function main() {
  await test('member state loads without seeding a campaign', async () => {
    const db = createDb();
    const state = await getDemoStateForUser(fakeClient(db), {
      workspaceId: 'workspace-1',
      userId: 'member-1',
      role: 'member',
      accessLevel: 'member',
      memberCount: 2,
      maxSeats: 2,
    });

    assert(state.role_path === 'member', 'should create member role path');
    assert(state.seeded_campaign_id === starterCampaignIdForWorkspace('workspace-1'), 'should link existing replay campaign');
    assert(db.campaigns.length === 1, 'state load should not seed campaigns');
    assert(state.starter_contact_count === 2, 'should count starter contacts');
  });

  await test('checklist patch persists completed items and dismissal', async () => {
    const db = createDb();
    await getDemoStateForUser(fakeClient(db), {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'owner',
      memberCount: 1,
      maxSeats: 1,
    });

    const patched = await patchDemoStateForUser(fakeClient(db), {
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'owner',
      memberCount: 1,
      maxSeats: 1,
      completedItems: { open_campaign: true },
      dismissedAt: '2026-06-13T12:00:00.000Z',
    });

    assert(patched.completed_items.open_campaign === true, 'completed item should persist');
    assert(patched.dismissed_at === '2026-06-13T12:00:00.000Z', 'dismissal should persist');
  });

  if (testsFailed > 0) {
    console.error(`\n${testsFailed} test(s) failed, ${testsPassed} passed.`);
    process.exit(1);
  }

  console.log(`\n${testsPassed} test(s) passed.`);
}

void main();
