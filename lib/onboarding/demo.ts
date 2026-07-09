import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DashboardAccessLevel, WorkspaceRole } from '@/app/api/_utils/workspace';

export type DemoRolePath = 'team_owner' | 'solo_owner' | 'member';

export type DemoSeedResult = {
  seeded: boolean;
  skipped: boolean;
  campaignId: string | null;
  rolePath: DemoRolePath;
  reason?: string;
};

export type DemoState = {
  id: string;
  workspace_id: string;
  user_id: string;
  role_path: DemoRolePath;
  seeded_campaign_id: string | null;
  completed_items: Record<string, boolean>;
  dismissed_at: string | null;
  created_at?: string;
  updated_at?: string;
  starter_contact_count?: number;
};

type DemoStateRow = Omit<DemoState, 'completed_items' | 'starter_contact_count'> & {
  completed_items: unknown;
};

type CampaignRow = {
  id: string;
  name?: string | null;
  title?: string | null;
  tags?: string | null;
};

type SeedOptions = {
  workspaceId: string;
  userId: string;
  role?: WorkspaceRole | null;
  accessLevel?: DashboardAccessLevel | null;
  memberCount?: number | null;
  maxSeats?: number | null;
};

type StateOptions = {
  workspaceId: string;
  userId: string;
  role?: WorkspaceRole | null;
  accessLevel?: DashboardAccessLevel | null;
  memberCount?: number | null;
  maxSeats?: number | null;
  seededCampaignId?: string | null;
};

type PatchOptions = {
  workspaceId: string;
  userId: string;
  completedItems?: Record<string, boolean>;
  dismissedAt?: string | null;
  role?: WorkspaceRole | null;
  accessLevel?: DashboardAccessLevel | null;
  memberCount?: number | null;
  maxSeats?: number | null;
};

const STARTER_CAMPAIGN_NAME = 'Salt Lake City Replay Campaign';
const LEGACY_STARTER_CAMPAIGN_NAME = 'Sugar House Starter Farm';
const STARTER_TAG = 'starter-demo';
const STARTER_TAGS = 'starter-demo,pre-recorded,salt-lake-city';
const STARTER_BBOX = [-111.863, 40.7122, -111.8465, 40.7248] as const;
const STARTER_POLYGON = {
  type: 'Polygon' as const,
  coordinates: [[
    [STARTER_BBOX[0], STARTER_BBOX[1]],
    [STARTER_BBOX[2], STARTER_BBOX[1]],
    [STARTER_BBOX[2], STARTER_BBOX[3]],
    [STARTER_BBOX[0], STARTER_BBOX[3]],
    [STARTER_BBOX[0], STARTER_BBOX[1]],
  ]],
};

const STREET_NAMES = ['E 2100 S', 'S 1100 E', 'E Emerson Ave', 'S McClelland St'];
const FIRST_NAMES = ['Maya', 'Jordan', 'Priya', 'Elliot', 'Casey'];
const LAST_NAMES = ['Reed', 'Bennett', 'Shah', 'Miller', 'Nguyen'];

export function deterministicDemoUuid(seed: string): string {
  const chars = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
  chars[12] = '4';
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function starterCampaignIdForWorkspace(workspaceId: string): string {
  return deterministicDemoUuid(`flyr-demo:campaign:${workspaceId}`);
}

export function isStarterDemoCampaign(campaign: { id?: string | null; tags?: string | null; name?: string | null; title?: string | null } | null | undefined): boolean {
  if (!campaign) return false;
  return (
    campaign.tags?.split(',').map((tag) => tag.trim()).includes(STARTER_TAG) ||
    campaign.name === STARTER_CAMPAIGN_NAME ||
    campaign.title === STARTER_CAMPAIGN_NAME ||
    campaign.name === LEGACY_STARTER_CAMPAIGN_NAME ||
    campaign.title === LEGACY_STARTER_CAMPAIGN_NAME
  );
}

export function resolveDemoRolePath(input: {
  role?: WorkspaceRole | null;
  accessLevel?: DashboardAccessLevel | null;
  memberCount?: number | null;
  maxSeats?: number | null;
}): DemoRolePath {
  if (input.role === 'member' || input.accessLevel === 'member') return 'member';
  if (input.role === 'admin') return 'team_owner';
  if (input.accessLevel === 'team_leader') return 'team_owner';
  if (input.role === 'owner') {
    const hasTeamCapacity = (input.maxSeats ?? 1) > 1;
    const hasTeamMembers = (input.memberCount ?? 1) > 1;
    return hasTeamCapacity || hasTeamMembers ? 'team_owner' : 'solo_owner';
  }
  return input.accessLevel === 'solo_owner' ? 'solo_owner' : 'member';
}

function normalizeCompletedItems(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, boolean> = {};
  for (const [key, completed] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string' && typeof completed === 'boolean') {
      result[key] = completed;
    }
  }
  return result;
}

function normalizeState(row: DemoStateRow, starterContactCount = 0): DemoState {
  return {
    ...row,
    role_path: row.role_path,
    seeded_campaign_id: row.seeded_campaign_id ?? null,
    completed_items: normalizeCompletedItems(row.completed_items),
    dismissed_at: row.dismissed_at ?? null,
    starter_contact_count: starterContactCount,
  };
}

function transientDemoState(options: StateOptions, rolePath: DemoRolePath, seededCampaignId: string | null): DemoState {
  return {
    id: deterministicDemoUuid(`flyr-demo:state:${options.workspaceId}:${options.userId}`),
    workspace_id: options.workspaceId,
    user_id: options.userId,
    role_path: rolePath,
    seeded_campaign_id: seededCampaignId,
    completed_items: {},
    dismissed_at: null,
    starter_contact_count: 0,
  };
}

function isIgnorableMissingSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string; details?: string | null };
  const text = `${candidate.message ?? ''} ${candidate.details ?? ''}`.toLowerCase();
  return candidate.code === 'PGRST204' || candidate.code === 'PGRST205' || text.includes('does not exist') || text.includes('could not find');
}

function pointWkt(lon: number, lat: number): string {
  return `POINT(${lon} ${lat})`;
}

function nowOffsetIso(daysAgo: number, hours = 15): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  date.setUTCHours(hours, 0, 0, 0);
  return date.toISOString();
}

function buildStarterAddresses(workspaceId: string, campaignId: string) {
  const [west, south, east, north] = STARTER_BBOX;
  const rows = [];

  for (let index = 0; index < 24; index += 1) {
    const streetName = STREET_NAMES[index % STREET_NAMES.length];
    const houseNumber = String(1040 + index * 6);
    const lon = west + ((east - west) * ((index % 6) + 0.6)) / 6.8;
    const lat = south + ((north - south) * (Math.floor(index / 6) + 0.7)) / 4.9;
    const id = deterministicDemoUuid(`flyr-demo:${workspaceId}:address:${index}`);
    const visited = index < 8;
    const scans = index === 2 ? 3 : index === 4 ? 2 : index < 8 ? 1 : 0;
    const formatted = `${houseNumber} ${streetName}, Salt Lake City, UT 84106`;

    rows.push({
      id,
      campaign_id: campaignId,
      address: formatted,
      formatted,
      house_number: houseNumber,
      street_name: streetName,
      locality: 'Salt Lake City',
      region: 'UT',
      postal_code: '84106',
      source: 'starter_demo',
      source_id: deterministicDemoUuid(`flyr-demo:${workspaceId}:source:${index}`),
      coordinate: { lat, lon },
      geom: pointWkt(lon, lat),
      visited,
      scans,
      last_scanned_at: scans > 0 ? nowOffsetIso(index % 4, 17) : null,
      purl: `/api/scan?id=${id}`,
      seq: index + 1,
      updated_at: new Date().toISOString(),
    });
  }

  return rows;
}

function buildStarterStatuses(addressIds: string[]) {
  const statuses = ['delivered', 'talked', 'appointment', 'hot_lead', 'no_answer', 'delivered', 'talked', 'no_answer'] as const;
  return statuses.map((status, index) => ({
    campaign_address_id: addressIds[index],
    status,
    notes: status === 'appointment' ? 'Booked a valuation follow-up.' : status === 'hot_lead' ? 'Asked for seller packet.' : null,
    last_visited_at: nowOffsetIso(index % 3, 16),
    visit_count: 1,
    updated_at: new Date().toISOString(),
  }));
}

function buildStarterContacts(workspaceId: string, campaignId: string, userId: string, addresses: Array<{ id: string; formatted: string }>) {
  const statuses = ['hot', 'warm', 'hot', 'new', 'warm'] as const;
  return Array.from({ length: 5 }, (_, index) => {
    const createdAt = nowOffsetIso(index, 18);
    const followUpAt = index === 1 || index === 4 ? nowOffsetIso(-2 - index, 14) : null;
    const appointmentAt = index === 2 ? nowOffsetIso(-3, 15) : null;
    return {
      id: deterministicDemoUuid(`flyr-demo:${workspaceId}:contact:${index}`),
      user_id: userId,
      workspace_id: workspaceId,
      campaign_id: campaignId,
      address_id: addresses[index + 1]?.id ?? addresses[index]?.id,
      full_name: `${FIRST_NAMES[index]} ${LAST_NAMES[index]}`,
      phone: `+1 385 555 ${String(1400 + index).padStart(4, '0')}`,
      phone_e164: `+1385555${String(1400 + index).padStart(4, '0')}`,
      email: `starter-lead-${index + 1}@example.com`,
      address: addresses[index + 1]?.formatted ?? addresses[index]?.formatted,
      status: statuses[index],
      source: 'starter_demo',
      notes: index === 2 ? 'Wants a comparative market analysis this week.' : 'Created from the pre-recorded Salt Lake City replay.',
      tags: 'starter-demo',
      last_contacted: createdAt,
      reminder_date: followUpAt,
      follow_up_at: followUpAt,
      appointment_at: appointmentAt,
      created_at: createdAt,
      updated_at: createdAt,
    };
  });
}

function buildStarterSessions(workspaceId: string, campaignId: string, userId: string) {
  return [0, 1].map((_, index) => {
    const start = new Date(nowOffsetIso(index + 1, 15));
    const activeSeconds = index === 0 ? 4200 : 3600;
    return {
      id: deterministicDemoUuid(`flyr-demo:${workspaceId}:session:${index}`),
      user_id: userId,
      workspace_id: workspaceId,
      campaign_id: campaignId,
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + activeSeconds * 1000).toISOString(),
      distance_meters: index === 0 ? 1260 : 980,
      goal_type: 'knocks',
      goal_amount: index === 0 ? 18 : 14,
      path_geojson: JSON.stringify({
        type: 'LineString',
        coordinates: [
          [-111.859, 40.716],
          [-111.856, 40.718],
          [-111.852, 40.721],
        ],
      }),
      doors_hit: index === 0 ? 15 : 11,
      conversations: index === 0 ? 5 : 3,
      flyers_delivered: index === 0 ? 15 : 11,
      active_seconds: activeSeconds,
      completed_count: index === 0 ? 15 : 11,
      leads_created: index === 0 ? 3 : 2,
      route_data: { source: 'starter_demo', label: STARTER_CAMPAIGN_NAME },
      session_mode: 'door_knocking',
      notes: 'Pre-recorded demo session for the Salt Lake City replay campaign.',
      updated_at: new Date().toISOString(),
    };
  });
}

async function selectWorkspaceMembership(admin: SupabaseClient, workspaceId: string, userId: string) {
  const { data, error } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.role ?? null) as WorkspaceRole | null;
}

async function findStarterCampaign(admin: SupabaseClient, workspaceId: string): Promise<string | null> {
  const campaignId = starterCampaignIdForWorkspace(workspaceId);
  const { data: direct } = await admin
    .from('campaigns')
    .select('id, name, title, tags')
    .eq('id', campaignId)
    .maybeSingle();
  if (direct?.id) return direct.id;

  const { data } = await admin
    .from('campaigns')
    .select('id, name, title, tags')
    .eq('workspace_id', workspaceId)
    .limit(50);
  const starter = ((data ?? []) as CampaignRow[]).find(isStarterDemoCampaign);
  return starter?.id ?? null;
}

async function findAnyWorkspaceCampaign(admin: SupabaseClient, workspaceId: string): Promise<string | null> {
  const { data } = await admin
    .from('campaigns')
    .select('id')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function resolveValidSeededCampaignId(
  admin: SupabaseClient,
  workspaceId: string,
  campaignId: string | null | undefined
): Promise<string | null> {
  if (campaignId) {
    const { data } = await admin
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  return findStarterCampaign(admin, workspaceId);
}

async function starterContactCount(admin: SupabaseClient, campaignId: string | null): Promise<number> {
  if (!campaignId) return 0;
  const { count, error } = await admin
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('tags', STARTER_TAG);
  if (error && isIgnorableMissingSchemaError(error)) return 0;
  if (error) return 0;
  return count ?? 0;
}

async function upsertDemoState(admin: SupabaseClient, options: StateOptions): Promise<DemoState> {
  const rolePath = resolveDemoRolePath(options);
  const existingStarterId = await resolveValidSeededCampaignId(
    admin,
    options.workspaceId,
    options.seededCampaignId
  );
  const { data, error } = await admin
    .from('onboarding_demo_states')
    .upsert(
      {
        workspace_id: options.workspaceId,
        user_id: options.userId,
        role_path: rolePath,
        seeded_campaign_id: existingStarterId,
      },
      { onConflict: 'workspace_id,user_id' }
    )
    .select('*')
    .single();
  if (error && isIgnorableMissingSchemaError(error)) {
    return transientDemoState(options, rolePath, existingStarterId);
  }
  if (error) throw error;
  return normalizeState(data as DemoStateRow, await starterContactCount(admin, existingStarterId));
}

export async function getDemoStateForUser(admin: SupabaseClient, options: StateOptions): Promise<DemoState> {
  const { data, error } = await admin
    .from('onboarding_demo_states')
    .select('*')
    .eq('workspace_id', options.workspaceId)
    .eq('user_id', options.userId)
    .maybeSingle();

  if (error && !isIgnorableMissingSchemaError(error)) throw error;
  if (!data) return upsertDemoState(admin, options);

  const rolePath = resolveDemoRolePath(options);
  const seededCampaignId = await resolveValidSeededCampaignId(
    admin,
    options.workspaceId,
    data.seeded_campaign_id ?? options.seededCampaignId
  );
  if (data.role_path !== rolePath || data.seeded_campaign_id !== seededCampaignId) {
    const { data: updated, error: updateError } = await admin
      .from('onboarding_demo_states')
      .update({
        role_path: rolePath,
        seeded_campaign_id: seededCampaignId,
      })
      .eq('id', data.id)
      .select('*')
      .single();
    if (updateError && isIgnorableMissingSchemaError(updateError)) {
      return transientDemoState(options, rolePath, seededCampaignId);
    }
    if (updateError) throw updateError;
    return normalizeState(updated as DemoStateRow, await starterContactCount(admin, seededCampaignId));
  }

  return normalizeState(data as DemoStateRow, await starterContactCount(admin, seededCampaignId));
}

export async function patchDemoStateForUser(admin: SupabaseClient, options: PatchOptions): Promise<DemoState> {
  const current = await getDemoStateForUser(admin, options);
  const patch: Record<string, unknown> = {};

  if (options.completedItems) {
    patch.completed_items = {
      ...current.completed_items,
      ...normalizeCompletedItems(options.completedItems),
    };
  }
  if (options.dismissedAt !== undefined) {
    patch.dismissed_at = options.dismissedAt;
  }

  if (Object.keys(patch).length === 0) return current;

  const { data, error } = await admin
    .from('onboarding_demo_states')
    .update(patch)
    .eq('id', current.id)
    .eq('user_id', options.userId)
    .select('*')
    .single();
  if (error && isIgnorableMissingSchemaError(error)) return current;
  if (error) throw error;
  return normalizeState(data as DemoStateRow, await starterContactCount(admin, current.seeded_campaign_id));
}

async function maybeSeedStarterAssignment(admin: SupabaseClient, workspaceId: string, campaignId: string, ownerId: string) {
  const { data: members, error } = await admin
    .from('workspace_members')
    .select('user_id, role')
    .eq('workspace_id', workspaceId)
    .neq('user_id', ownerId)
    .eq('role', 'member')
    .limit(1);
  if (error || !members?.[0]?.user_id) return;

  await admin
    .from('campaign_assignments')
    .upsert(
      {
        id: deterministicDemoUuid(`flyr-demo:${workspaceId}:campaign-assignment:${members[0].user_id}`),
        workspace_id: workspaceId,
        campaign_id: campaignId,
        assigned_to_user_id: members[0].user_id,
        assigned_by_user_id: ownerId,
        mode: 'whole_team',
        goal_homes: 12,
        status: 'assigned',
        notes: 'Pre-recorded assignment from the Salt Lake City replay campaign.',
      },
      { onConflict: 'id' }
    );
}

export async function seedStarterCampaignForWorkspace(admin: SupabaseClient, options: SeedOptions): Promise<DemoSeedResult> {
  const role = options.role ?? await selectWorkspaceMembership(admin, options.workspaceId, options.userId);
  if (role !== 'owner' && role !== 'admin') {
    throw new Error('Only workspace owners and admins can load replay demo data.');
  }

  const rolePath = resolveDemoRolePath({ ...options, role });
  const campaignId = starterCampaignIdForWorkspace(options.workspaceId);
  const state = await getDemoStateForUser(admin, { ...options, role, seededCampaignId: campaignId });

  if (state.seeded_campaign_id) {
    const { data: existing } = await admin
      .from('campaigns')
      .select('id')
      .eq('id', state.seeded_campaign_id)
      .maybeSingle();
    if (existing?.id) {
      return { seeded: false, skipped: false, campaignId: existing.id, rolePath };
    }
  }

  const existingWorkspaceCampaignId = await findAnyWorkspaceCampaign(admin, options.workspaceId);
  if (existingWorkspaceCampaignId) {
    await getDemoStateForUser(admin, {
      ...options,
      role,
      seededCampaignId: existingWorkspaceCampaignId,
    });
    return {
      seeded: false,
      skipped: true,
      campaignId: existingWorkspaceCampaignId,
      rolePath,
      reason: 'workspace_campaign_limit_reached',
    };
  }

  const now = new Date().toISOString();
  const addresses = buildStarterAddresses(options.workspaceId, campaignId);
  const contacts = buildStarterContacts(options.workspaceId, campaignId, options.userId, addresses);
  const sessions = buildStarterSessions(options.workspaceId, campaignId, options.userId);

  const { error: campaignError } = await admin
    .from('campaigns')
    .upsert(
      {
        id: campaignId,
        owner_id: options.userId,
        workspace_id: options.workspaceId,
        name: STARTER_CAMPAIGN_NAME,
        title: STARTER_CAMPAIGN_NAME,
        description: 'Pre-recorded Salt Lake City campaign replay with fixed demo activity and reporting.',
        type: 'prospecting',
        address_source: 'map',
        status: 'active',
        provision_status: 'ready',
        provision_phase: 'optimized',
        provisioned_at: now,
        addresses_ready_at: now,
        map_ready_at: now,
        optimized_at: now,
        map_mode: 'standard_pins',
        region: 'UT',
        bbox: [...STARTER_BBOX],
        territory_boundary: STARTER_POLYGON,
        total_flyers: addresses.length,
        scans: addresses.reduce((sum, address) => sum + Number(address.scans ?? 0), 0),
        conversions: contacts.length,
        tags: STARTER_TAGS,
        has_parcels: false,
        building_link_confidence: 0,
        link_quality_status: 'healthy',
        link_quality_score: 1,
        link_quality_reason: 'Replay demo uses standard pins.',
        link_quality_checked_at: now,
        link_quality_metrics: { source: 'starter_demo' },
        updated_at: now,
      },
      { onConflict: 'id' }
    );
  if (campaignError) throw campaignError;

  const { error: addressError } = await admin
    .from('campaign_addresses')
    .upsert(addresses, { onConflict: 'id' });
  if (addressError) throw addressError;

  const { error: statusError } = await admin
    .from('address_statuses')
    .upsert(buildStarterStatuses(addresses.map((address) => address.id)), { onConflict: 'campaign_address_id' });
  if (statusError) throw statusError;

  const { error: contactError } = await admin
    .from('contacts')
    .upsert(contacts, { onConflict: 'id' });
  if (contactError) throw contactError;

  const { error: sessionError } = await admin
    .from('sessions')
    .upsert(sessions, { onConflict: 'id' });
  if (sessionError) throw sessionError;

  await maybeSeedStarterAssignment(admin, options.workspaceId, campaignId, options.userId);
  await getDemoStateForUser(admin, { ...options, role, seededCampaignId: campaignId });

  return { seeded: true, skipped: false, campaignId, rolePath };
}
