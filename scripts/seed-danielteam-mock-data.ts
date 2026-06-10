#!/usr/bin/env tsx

import { createHash } from 'node:crypto';
import * as dotenv from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', override: true });
dotenv.config();

type MetricKey =
  | 'doors_knocked'
  | 'flyers_delivered'
  | 'conversations'
  | 'leads_created'
  | 'appointments_set'
  | 'time_spent_seconds'
  | 'sessions_count';

type Metrics = Record<MetricKey, number>;

type MemberSeed = {
  slug: string;
  userId?: string;
  firstName: string;
  lastName: string;
  role: 'owner' | 'member';
  color: string;
  weeklyDoorGoal: number;
  weeklySessionsGoal: number;
  weeklyMinutesGoal: number;
  current7d: {
    doors: number;
    conversations: number;
    leads: number;
    appointments: number;
  };
};

type SessionSeed = {
  id: string;
  user_id: string;
  workspace_id: string;
  start_time: string;
  end_time: string | null;
  distance_meters: number;
  goal_type: string;
  goal_amount: number;
  path_geojson: string;
  campaign_id: string | null;
  doors_hit: number;
  conversations: number;
  flyers_delivered: number;
  active_seconds: number;
  completed_count: number;
  leads_created: number;
  route_data: Record<string, unknown>;
  session_mode: string;
  notes: string;
};

type ContactSeed = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  email: string;
  address: string;
  status: string;
  last_contacted: string;
  notes: string;
  reminder_date: string | null;
  created_at: string;
  updated_at: string;
  workspace_id: string;
  session_id: string | null;
  follow_up_at: string | null;
  appointment_at: string | null;
  phone_e164: string;
  sync_status: string;
};

type AuthUserSummary = {
  id: string;
  email?: string;
};

const OWNER_EMAIL = 'danielteam@gmail.com';
const EXPECTED_WORKSPACE_ID = 'a1067746-c0af-496f-8902-8a08c612e8de';
const WORKSPACE_NAME = 'Phillippe Group';
const ZERO_METRICS: Metrics = {
  doors_knocked: 0,
  flyers_delivered: 0,
  conversations: 0,
  leads_created: 0,
  appointments_set: 0,
  time_spent_seconds: 0,
  sessions_count: 0,
};

const baseMembers: Omit<MemberSeed, 'userId'>[] = [
  {
    slug: 'avery-brooks',
    firstName: 'Avery',
    lastName: 'Brooks',
    role: 'member',
    color: '#E11D48',
    weeklyDoorGoal: 225,
    weeklySessionsGoal: 6,
    weeklyMinutesGoal: 480,
    current7d: { doors: 212, conversations: 61, leads: 12, appointments: 4 },
  },
  {
    slug: 'maya-chen',
    firstName: 'Maya',
    lastName: 'Chen',
    role: 'member',
    color: '#2563EB',
    weeklyDoorGoal: 205,
    weeklySessionsGoal: 5,
    weeklyMinutesGoal: 420,
    current7d: { doors: 186, conversations: 49, leads: 9, appointments: 3 },
  },
  {
    slug: 'noah-patel',
    firstName: 'Noah',
    lastName: 'Patel',
    role: 'member',
    color: '#16A34A',
    weeklyDoorGoal: 190,
    weeklySessionsGoal: 5,
    weeklyMinutesGoal: 390,
    current7d: { doors: 174, conversations: 42, leads: 7, appointments: 2 },
  },
  {
    slug: 'sofia-martinez',
    firstName: 'Sofia',
    lastName: 'Martinez',
    role: 'member',
    color: '#F97316',
    weeklyDoorGoal: 180,
    weeklySessionsGoal: 5,
    weeklyMinutesGoal: 390,
    current7d: { doors: 161, conversations: 44, leads: 8, appointments: 3 },
  },
  {
    slug: 'ethan-walker',
    firstName: 'Ethan',
    lastName: 'Walker',
    role: 'member',
    color: '#7C3AED',
    weeklyDoorGoal: 165,
    weeklySessionsGoal: 4,
    weeklyMinutesGoal: 360,
    current7d: { doors: 149, conversations: 35, leads: 6, appointments: 2 },
  },
  {
    slug: 'priya-shah',
    firstName: 'Priya',
    lastName: 'Shah',
    role: 'member',
    color: '#0891B2',
    weeklyDoorGoal: 155,
    weeklySessionsGoal: 4,
    weeklyMinutesGoal: 330,
    current7d: { doors: 137, conversations: 31, leads: 5, appointments: 2 },
  },
  {
    slug: 'liam-oconnor',
    firstName: 'Liam',
    lastName: 'OConnor',
    role: 'member',
    color: '#CA8A04',
    weeklyDoorGoal: 145,
    weeklySessionsGoal: 4,
    weeklyMinutesGoal: 320,
    current7d: { doors: 128, conversations: 29, leads: 4, appointments: 1 },
  },
  {
    slug: 'grace-kim',
    firstName: 'Grace',
    lastName: 'Kim',
    role: 'member',
    color: '#DB2777',
    weeklyDoorGoal: 125,
    weeklySessionsGoal: 4,
    weeklyMinutesGoal: 300,
    current7d: { doors: 104, conversations: 26, leads: 5, appointments: 2 },
  },
  {
    slug: 'jordan-reed',
    firstName: 'Jordan',
    lastName: 'Reed',
    role: 'member',
    color: '#475569',
    weeklyDoorGoal: 110,
    weeklySessionsGoal: 3,
    weeklyMinutesGoal: 260,
    current7d: { doors: 86, conversations: 19, leads: 4, appointments: 1 },
  },
];

function mockEmail(slug: string): string {
  return `danielteam.mock.${slug}@example.com`;
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required. Check .env.local.`);
  return value;
}

function deterministicUuid(seed: string): string {
  const chars = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
  chars[12] = '4';
  chars[16] = '8';
  const hex = chars.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function iso(date: Date): string {
  return date.toISOString();
}

function startOfUtcDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number, hours = 0, minutes = 0): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  copy.setUTCHours(hours, minutes, 0, 0);
  return copy;
}

function startOfWeekUtc(date: Date): Date {
  const start = startOfUtcDay(date);
  const day = start.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setUTCDate(start.getUTCDate() + diff);
  return start;
}

function startOfMonthUtc(date: Date): Date {
  const start = startOfUtcDay(date);
  start.setUTCDate(1);
  return start;
}

function startOfYearUtc(date: Date): Date {
  const start = startOfUtcDay(date);
  start.setUTCMonth(0, 1);
  return start;
}

function addPeriod(start: Date, period: 'weekly' | 'monthly' | 'yearly', amount: number): Date {
  const next = new Date(start);
  if (period === 'weekly') next.setUTCDate(next.getUTCDate() + amount * 7);
  if (period === 'monthly') next.setUTCMonth(next.getUTCMonth() + amount);
  if (period === 'yearly') next.setUTCFullYear(next.getUTCFullYear() + amount);
  return next;
}

function splitTotal(total: number, weights: number[]): number[] {
  const raw = weights.map((weight) => Math.floor(total * weight));
  let remaining = total - raw.reduce((sum, value) => sum + value, 0);
  let index = 0;
  while (remaining > 0) {
    raw[index % raw.length] += 1;
    remaining -= 1;
    index += 1;
  }
  return raw;
}

function fullName(member: MemberSeed): string {
  return `${member.firstName} ${member.lastName}`;
}

async function listAllAuthUsers(admin: SupabaseClient): Promise<AuthUserSummary[]> {
  const users: AuthUserSummary[] = [];
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    assertNoError(error, 'Load auth users');
    users.push(...data.users.map((user) => ({ id: user.id, email: user.email ?? undefined })));
    if (data.users.length < perPage) break;
  }
  return users;
}

async function ensureMockAuthUsers(
  admin: SupabaseClient,
  members: Omit<MemberSeed, 'userId'>[]
): Promise<Map<string, string>> {
  const usersByEmail = new Map(
    (await listAllAuthUsers(admin)).map((user) => [(user.email ?? '').toLowerCase(), user])
  );
  const idsBySlug = new Map<string, string>();

  for (const member of members) {
    const email = mockEmail(member.slug);
    const existing = usersByEmail.get(email.toLowerCase());
    if (existing) {
      idsBySlug.set(member.slug, existing.id);
      const { error } = await admin.auth.admin.updateUserById(existing.id, {
        email_confirm: true,
        user_metadata: {
          first_name: member.firstName,
          last_name: member.lastName,
          mock_seed: 'danielteam-2026',
        },
        app_metadata: {
          mock_seed: 'danielteam-2026',
          workspace_fixture: 'danielteam',
        },
      });
      assertNoError(error, `Update mock auth user ${email}`);
      continue;
    }

    const passwordHash = createHash('sha256').update(`danielteam:${member.slug}:password`).digest('hex').slice(0, 16);
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: `Mock-${passwordHash}!2026`,
      email_confirm: true,
      user_metadata: {
        first_name: member.firstName,
        last_name: member.lastName,
        mock_seed: 'danielteam-2026',
      },
      app_metadata: {
        mock_seed: 'danielteam-2026',
        workspace_fixture: 'danielteam',
      },
    });
    assertNoError(error, `Create mock auth user ${email}`);
    if (!data.user?.id) throw new Error(`Create mock auth user ${email}: missing user id`);
    idsBySlug.set(member.slug, data.user.id);
  }

  return idsBySlug;
}

function isIgnorableSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { code?: string; message?: string };
  const message = (maybe.message ?? '').toLowerCase();
  return (
    maybe.code === 'PGRST204' ||
    maybe.code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('could not find the table') ||
    message.includes('could not find the column')
  );
}

function assertNoError(error: unknown, label: string): void {
  if (!error) return;
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message)
    : String(error);
  throw new Error(`${label}: ${message}`);
}

async function deleteEq(
  admin: SupabaseClient,
  table: string,
  column: string,
  value: string
): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .delete({ count: 'exact' })
    .eq(column, value);

  if (error && isIgnorableSchemaError(error)) return 0;
  assertNoError(error, `Delete ${table}.${column}`);
  return count ?? 0;
}

async function deleteIn(
  admin: SupabaseClient,
  table: string,
  column: string,
  values: string[]
): Promise<number> {
  if (values.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < values.length; i += 100) {
    const chunk = values.slice(i, i + 100);
    const { count, error } = await admin
      .from(table)
      .delete({ count: 'exact' })
      .in(column, chunk);

    if (error && isIgnorableSchemaError(error)) continue;
    assertNoError(error, `Delete ${table}.${column}`);
    total += count ?? 0;
  }
  return total;
}

async function updateIn(
  admin: SupabaseClient,
  table: string,
  column: string,
  values: string[],
  patch: Record<string, unknown>
): Promise<number> {
  if (values.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < values.length; i += 100) {
    const chunk = values.slice(i, i + 100);
    const { count, error } = await admin
      .from(table)
      .update(patch, { count: 'exact' })
      .in(column, chunk);

    if (error && isIgnorableSchemaError(error)) continue;
    assertNoError(error, `Update ${table}.${column}`);
    total += count ?? 0;
  }
  return total;
}

async function selectIdsByEq(
  admin: SupabaseClient,
  table: string,
  filterColumn: string,
  value: string
): Promise<string[]> {
  const { data, error } = await admin
    .from(table)
    .select('id')
    .eq(filterColumn, value)
    .limit(10000);

  if (error && isIgnorableSchemaError(error)) return [];
  assertNoError(error, `Select ${table}.id`);
  return (data ?? [])
    .map((row: { id?: unknown }) => (typeof row.id === 'string' ? row.id : null))
    .filter((id): id is string => Boolean(id));
}

function buildSessionRows(
  workspaceId: string,
  members: MemberSeed[],
  now: Date
): SessionSeed[] {
  const today = startOfUtcDay(now);
  const rows: SessionSeed[] = [];
  const currentWeights = [0.18, 0.16, 0.15, 0.14, 0.15, 0.13, 0.09];
  const historicalWeights = [0.28, 0.25, 0.2, 0.15, 0.12];

  for (const member of members) {
    const memberSeed = `danielteam:${member.slug}`;
    const currentDoors = splitTotal(member.current7d.doors, currentWeights);
    const currentConvos = splitTotal(member.current7d.conversations, currentWeights);
    const currentLeads = splitTotal(member.current7d.leads, currentWeights);

    for (let index = 0; index < currentWeights.length; index += 1) {
      const start = addDays(today, -index, 15 + (index % 3), (index * 11) % 45);
      const activeSeconds = 3600 + currentDoors[index] * 45 + currentConvos[index] * 30;
      rows.push({
        id: deterministicUuid(`${memberSeed}:session:current:${index}`),
        user_id: member.userId!,
        workspace_id: workspaceId,
        start_time: iso(start),
        end_time: iso(new Date(start.getTime() + activeSeconds * 1000)),
        distance_meters: Math.round(currentDoors[index] * 18 + currentConvos[index] * 7),
        goal_type: 'knocks',
        goal_amount: Math.max(20, currentDoors[index]),
        path_geojson: '{"type":"LineString","coordinates":[]}',
        campaign_id: null,
        doors_hit: currentDoors[index],
        conversations: currentConvos[index],
        flyers_delivered: currentDoors[index],
        active_seconds: activeSeconds,
        completed_count: currentDoors[index],
        leads_created: currentLeads[index],
        route_data: {
          mockSeed: 'danielteam-2026',
          dayOffset: index,
          rep: member.slug,
        },
        session_mode: 'door_knocking',
        notes: `Mock field session for ${fullName(member)}`,
      });
    }

    const previousDoors = splitTotal(Math.round(member.current7d.doors * 0.62), historicalWeights);
    const previousConvos = splitTotal(Math.round(member.current7d.conversations * 0.58), historicalWeights);
    const previousLeads = splitTotal(Math.round(member.current7d.leads * 0.55), historicalWeights);
    const olderDoors = splitTotal(Math.round(member.current7d.doors * 0.72), historicalWeights);
    const olderConvos = splitTotal(Math.round(member.current7d.conversations * 0.7), historicalWeights);
    const olderLeads = splitTotal(Math.round(member.current7d.leads * 0.65), historicalWeights);
    const yearDoors = splitTotal(Math.round(member.current7d.doors * 0.95), historicalWeights);
    const yearConvos = splitTotal(Math.round(member.current7d.conversations * 0.86), historicalWeights);
    const yearLeads = splitTotal(Math.round(member.current7d.leads * 0.8), historicalWeights);

    const groups = [
      { name: 'previous', offset: 8, doors: previousDoors, convos: previousConvos, leads: previousLeads },
      { name: 'older30', offset: 16, doors: olderDoors, convos: olderConvos, leads: olderLeads },
      { name: 'year', offset: 70, doors: yearDoors, convos: yearConvos, leads: yearLeads },
    ];

    for (const group of groups) {
      for (let index = 0; index < historicalWeights.length; index += 1) {
        const start = addDays(today, -(group.offset + index * 3), 14 + (index % 4), (index * 9) % 50);
        const activeSeconds = 3000 + group.doors[index] * 42 + group.convos[index] * 25;
        rows.push({
          id: deterministicUuid(`${memberSeed}:session:${group.name}:${index}`),
          user_id: member.userId!,
          workspace_id: workspaceId,
          start_time: iso(start),
          end_time: iso(new Date(start.getTime() + activeSeconds * 1000)),
          distance_meters: Math.round(group.doors[index] * 17 + group.convos[index] * 6),
          goal_type: 'knocks',
          goal_amount: Math.max(20, group.doors[index]),
          path_geojson: '{"type":"LineString","coordinates":[]}',
          campaign_id: null,
          doors_hit: group.doors[index],
          conversations: group.convos[index],
          flyers_delivered: group.doors[index],
          active_seconds: activeSeconds,
          completed_count: group.doors[index],
          leads_created: group.leads[index],
          route_data: {
            mockSeed: 'danielteam-2026',
            group: group.name,
            rep: member.slug,
          },
          session_mode: 'door_knocking',
          notes: `Mock historical session for ${fullName(member)}`,
        });
      }
    }
  }

  const liveMembers = members.filter((member) => member.slug === 'avery-brooks' || member.slug === 'maya-chen');
  liveMembers.forEach((member, index) => {
    const start = new Date(now.getTime() - (42 + index * 31) * 60 * 1000);
    rows.push({
      id: deterministicUuid(`danielteam:${member.slug}:session:live`),
      user_id: member.userId!,
      workspace_id: workspaceId,
      start_time: iso(start),
      end_time: null,
      distance_meters: 0,
      goal_type: 'knocks',
      goal_amount: member.slug === 'avery-brooks' ? 40 : 35,
      path_geojson: '{"type":"LineString","coordinates":[]}',
      campaign_id: null,
      doors_hit: 0,
      conversations: 0,
      flyers_delivered: 0,
      active_seconds: Math.floor((now.getTime() - start.getTime()) / 1000),
      completed_count: 0,
      leads_created: 0,
      route_data: {
        mockSeed: 'danielteam-2026',
        live: true,
        rep: member.slug,
      },
      session_mode: 'door_knocking',
      notes: `Live mock session for ${fullName(member)}`,
    });
  });

  return rows;
}

function buildContactRows(
  workspaceId: string,
  members: MemberSeed[],
  sessions: SessionSeed[],
  now: Date
): ContactSeed[] {
  const today = startOfUtcDay(now);
  const rows: ContactSeed[] = [];
  const statuses = ['new', 'warm', 'cold', 'not_home', 'no_answer'];
  let phoneCounter = 1000;

  const addContactGroup = (
    member: MemberSeed,
    groupName: string,
    count: number,
    appointments: number,
    dayOffsetStart: number
  ) => {
    const memberSessions = sessions.filter((session) =>
      session.user_id === member.userId &&
      session.end_time &&
      session.leads_created > 0 &&
      Math.abs((today.getTime() - new Date(session.start_time).getTime()) / (24 * 60 * 60 * 1000)) >= dayOffsetStart - 2
    );
    for (let index = 0; index < count; index += 1) {
      const isAppointment = index < appointments;
      const isFollowUp = !isAppointment && index % 3 === 0;
      const created = addDays(today, -(dayOffsetStart + (index % 5)), 12, (index * 7) % 45);
      const updated = new Date(created.getTime() + (isAppointment ? 90 : 35) * 60 * 1000);
      const appointmentAt = isAppointment ? new Date(updated.getTime() + 2 * 60 * 60 * 1000) : null;
      const followUpAt = isFollowUp ? new Date(updated.getTime() + 45 * 60 * 1000) : null;
      const streetNo = 120 + ((phoneCounter + index) % 780);
      const id = deterministicUuid(`danielteam:${member.slug}:contact:${groupName}:${index}`);
      const session = memberSessions[index % Math.max(1, memberSessions.length)];
      const status = isAppointment ? 'interested' : isFollowUp ? 'warm' : statuses[index % statuses.length];
      rows.push({
        id,
        user_id: member.userId!,
        full_name: `${['Alex', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Jamie'][index % 6]} ${['Stone', 'Bennett', 'Cole', 'Parker', 'Hayes', 'Nguyen'][(index + phoneCounter) % 6]}`,
        phone: `+1 416 555 ${String(phoneCounter).padStart(4, '0')}`,
        email: `lead-${member.slug}-${groupName}-${index}@example.com`,
        address: `${streetNo} ${['Maple Ave', 'King St W', 'Queen St E', 'Parkview Dr', 'Lakeshore Rd'][(index + phoneCounter) % 5]}`,
        status,
        last_contacted: iso(updated),
        notes: `${fullName(member)} mock ${status.replace('_', ' ')} lead.`,
        reminder_date: followUpAt ? iso(followUpAt) : null,
        created_at: iso(created),
        updated_at: iso(updated),
        workspace_id: workspaceId,
        session_id: session?.id ?? null,
        follow_up_at: followUpAt ? iso(followUpAt) : null,
        appointment_at: appointmentAt ? iso(appointmentAt) : null,
        phone_e164: `+1416555${String(phoneCounter).padStart(4, '0')}`,
        sync_status: 'mock',
      });
      phoneCounter += 1;
    }
  };

  for (const member of members) {
    addContactGroup(member, 'current', member.current7d.leads, member.current7d.appointments, 0);
    addContactGroup(
      member,
      'previous',
      Math.round(member.current7d.leads * 0.55),
      Math.max(0, Math.floor(member.current7d.appointments * 0.6)),
      8
    );
    addContactGroup(
      member,
      'older30',
      Math.round(member.current7d.leads * 0.65),
      Math.max(0, Math.floor(member.current7d.appointments * 0.7)),
      16
    );
    addContactGroup(
      member,
      'year',
      Math.round(member.current7d.leads * 0.8),
      Math.max(0, Math.floor(member.current7d.appointments * 0.75)),
      70
    );
  }

  return rows;
}

function buildMetricsForPeriod(
  memberIds: string[],
  sessions: SessionSeed[],
  contacts: ContactSeed[],
  start: Date,
  end: Date
): Map<string, Metrics> {
  const metrics = new Map(memberIds.map((id) => [id, { ...ZERO_METRICS }] as const));
  const startMs = start.getTime();
  const endMs = end.getTime();

  for (const session of sessions) {
    if (!metrics.has(session.user_id) || !session.end_time) continue;
    const time = new Date(session.start_time).getTime();
    if (time < startMs || time >= endMs) continue;
    const current = metrics.get(session.user_id)!;
    current.doors_knocked += session.doors_hit;
    current.flyers_delivered += session.flyers_delivered;
    current.conversations += session.conversations;
    current.leads_created += session.leads_created;
    current.time_spent_seconds += session.active_seconds;
    current.sessions_count += 1;
  }

  const leadSignatures = new Map<string, Set<string>>();
  const appointmentSignatures = new Map<string, Set<string>>();
  for (const contact of contacts) {
    if (!metrics.has(contact.user_id)) continue;
    const createdTime = new Date(contact.created_at).getTime();
    const updatedTime = new Date(contact.updated_at).getTime();
    const apptTime = contact.appointment_at ? new Date(contact.appointment_at).getTime() : NaN;
    const signature = [contact.full_name, contact.phone, contact.email, contact.address].join('|');
    if (createdTime >= startMs && createdTime < endMs) {
      const set = leadSignatures.get(contact.user_id) ?? new Set<string>();
      set.add(signature);
      leadSignatures.set(contact.user_id, set);
    }
    const appointmentInRange = Number.isFinite(apptTime) && apptTime >= startMs && apptTime < endMs;
    const changedInRange = updatedTime >= startMs && updatedTime < endMs;
    if (appointmentInRange || (changedInRange && ['appointment', 'hot', 'interested'].includes(contact.status))) {
      const set = appointmentSignatures.get(contact.user_id) ?? new Set<string>();
      set.add(signature);
      appointmentSignatures.set(contact.user_id, set);
    }
  }

  for (const [userId, signatures] of leadSignatures.entries()) {
    metrics.get(userId)!.leads_created = signatures.size;
  }
  for (const [userId, signatures] of appointmentSignatures.entries()) {
    metrics.get(userId)!.appointments_set = signatures.size;
  }

  return metrics;
}

function addMetrics(left: Metrics, right: Metrics): Metrics {
  return {
    doors_knocked: left.doors_knocked + right.doors_knocked,
    flyers_delivered: left.flyers_delivered + right.flyers_delivered,
    conversations: left.conversations + right.conversations,
    leads_created: left.leads_created + right.leads_created,
    appointments_set: left.appointments_set + right.appointments_set,
    time_spent_seconds: left.time_spent_seconds + right.time_spent_seconds,
    sessions_count: left.sessions_count + right.sessions_count,
  };
}

function sumMetrics(metricsByUser: Map<string, Metrics>): Metrics {
  return Array.from(metricsByUser.values()).reduce(addMetrics, { ...ZERO_METRICS });
}

function calculateDeltas(current: Metrics, previous: Metrics) {
  return Object.fromEntries(
    (Object.keys(ZERO_METRICS) as MetricKey[]).map((key) => {
      const abs = current[key] - previous[key];
      return [
        key,
        {
          abs,
          pct: previous[key] === 0 ? null : Number(((abs / previous[key]) * 100).toFixed(2)),
          trend: abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat',
        },
      ];
    })
  );
}

function buildReportRows(
  workspaceId: string,
  ownerId: string,
  members: MemberSeed[],
  sessions: SessionSeed[],
  contacts: ContactSeed[],
  now: Date
) {
  const rows: Array<Record<string, unknown>> = [];
  const periods: Array<{ period: 'weekly' | 'monthly' | 'yearly'; start: Date; end: Date }> = [
    { period: 'weekly', start: startOfWeekUtc(now), end: addPeriod(startOfWeekUtc(now), 'weekly', 1) },
    { period: 'monthly', start: startOfMonthUtc(now), end: addPeriod(startOfMonthUtc(now), 'monthly', 1) },
    { period: 'yearly', start: startOfYearUtc(now), end: addPeriod(startOfYearUtc(now), 'yearly', 1) },
  ];

  const memberIds = members.map((member) => member.userId!);
  for (const period of periods) {
    const current = buildMetricsForPeriod(memberIds, sessions, contacts, period.start, period.end);
    const previousStart = new Date(period.start.getTime() - (period.end.getTime() - period.start.getTime()));
    const previous = buildMetricsForPeriod(memberIds, sessions, contacts, previousStart, period.start);
    const totals = sumMetrics(current);
    const previousTotals = sumMetrics(previous);
    rows.push({
      id: deterministicUuid(`danielteam:report:team:${period.period}:${iso(period.start)}`),
      workspace_id: workspaceId,
      scope: 'team',
      owner_user_id: ownerId,
      subject_user_id: null,
      period: period.period,
      period_start: iso(period.start),
      period_end: iso(period.end),
      metrics: totals,
      deltas: calculateDeltas(totals, previousTotals),
      created_at: iso(now),
    });

    for (const member of members) {
      const memberMetrics = current.get(member.userId!) ?? { ...ZERO_METRICS };
      const previousMetrics = previous.get(member.userId!) ?? { ...ZERO_METRICS };
      rows.push({
        id: deterministicUuid(`danielteam:report:member:${member.slug}:${period.period}:${iso(period.start)}`),
        workspace_id: workspaceId,
        scope: 'member',
        owner_user_id: null,
        subject_user_id: member.userId!,
        period: period.period,
        period_start: iso(period.start),
        period_end: iso(period.end),
        metrics: memberMetrics,
        deltas: calculateDeltas(memberMetrics, previousMetrics),
        created_at: iso(now),
      });
    }
  }

  return rows;
}

async function cleanupWorkspace(
  admin: SupabaseClient,
  workspaceId: string,
  ownerId: string,
  plannedUserIds: string[]
) {
  const { data: existingMembers, error: existingMembersError } = await admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId);
  assertNoError(existingMembersError, 'Load existing workspace members');

  const existingUserIds = (existingMembers ?? [])
    .map((row: { user_id?: unknown }) => (typeof row.user_id === 'string' ? row.user_id : null))
    .filter((id): id is string => Boolean(id));
  const dataUserIds = Array.from(new Set([...existingUserIds, ...plannedUserIds, ownerId]));
  const contactIds = await selectIdsByEq(admin, 'contacts', 'workspace_id', workspaceId);
  const sessionIds = await selectIdsByEq(admin, 'sessions', 'workspace_id', workspaceId);

  const deleted: Record<string, number> = {};
  deleted.contact_activities = await deleteIn(admin, 'contact_activities', 'contact_id', contactIds);
  deleted.contacts = await deleteEq(admin, 'contacts', 'workspace_id', workspaceId);
  deleted.field_leads = await deleteEq(admin, 'field_leads', 'workspace_id', workspaceId);
  deleted.crm_events = await deleteIn(admin, 'crm_events', 'user_id', dataUserIds);
  deleted.reports = await deleteEq(admin, 'reports', 'workspace_id', workspaceId);
  deleted.workspace_invites = await deleteEq(admin, 'workspace_invites', 'workspace_id', workspaceId);
  deleted.leaderboard_rollups = await deleteEq(admin, 'leaderboard_rollups', 'workspace_id', workspaceId);

  deleted.session_events = await deleteIn(admin, 'session_events', 'session_id', sessionIds);
  deleted.session_heartbeats = await deleteIn(admin, 'session_heartbeats', 'session_id', sessionIds);
  deleted.session_checkins = await deleteIn(admin, 'session_checkins', 'session_id', sessionIds);
  deleted.session_shares = await deleteIn(admin, 'session_shares', 'session_id', sessionIds);
  deleted.safety_events = await deleteIn(admin, 'safety_events', 'session_id', sessionIds);
  deleted.live_session_codes = await deleteIn(admin, 'live_session_codes', 'session_id', sessionIds);
  deleted.session_participants = await deleteIn(admin, 'session_participants', 'session_id', sessionIds);
  deleted.campaign_home_events = await deleteIn(admin, 'campaign_home_events', 'session_id', sessionIds);
  deleted.campaign_presence = await deleteIn(admin, 'campaign_presence', 'session_id', sessionIds);
  deleted.building_touches = await deleteIn(admin, 'building_touches', 'session_id', sessionIds);
  deleted.address_statuses = await deleteIn(admin, 'address_statuses', 'last_session_id', sessionIds);
  deleted.farm_touches = await updateIn(admin, 'farm_touches', 'session_id', sessionIds, { session_id: null });
  deleted.sessions = await deleteEq(admin, 'sessions', 'workspace_id', workspaceId);

  const { count: removedMembers, error: removedMembersError } = await admin
    .from('workspace_members')
    .delete({ count: 'exact' })
    .eq('workspace_id', workspaceId)
    .neq('user_id', ownerId);
  assertNoError(removedMembersError, 'Remove non-owner workspace members');
  deleted.workspace_members = removedMembers ?? 0;

  return deleted;
}

async function upsertRows(
  admin: SupabaseClient,
  table: string,
  rows: Array<Record<string, unknown>>,
  label: string,
  options: { onConflict?: string } = {}
) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await admin.from(table).upsert(chunk, options);
    assertNoError(error, `Upsert ${label}`);
  }
}

async function insertRows(admin: SupabaseClient, table: string, rows: Array<Record<string, unknown>>, label: string) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await admin.from(table).insert(chunk);
    assertNoError(error, `Insert ${label}`);
  }
}

async function main() {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY);
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const now = new Date();

  const authUsers = await listAllAuthUsers(admin);
  const owner = authUsers.find((user) => (user.email ?? '').toLowerCase() === OWNER_EMAIL);
  if (!owner) throw new Error(`No auth user found for ${OWNER_EMAIL}.`);
  const mockUserIds = await ensureMockAuthUsers(admin, baseMembers);

  const { data: ownerMemberships, error: ownerMembershipsError } = await admin
    .from('workspace_members')
    .select('workspace_id, role')
    .eq('user_id', owner.id)
    .eq('role', 'owner')
    .order('created_at', { ascending: true });
  assertNoError(ownerMembershipsError, 'Load owner memberships');

  const workspaceId = (ownerMemberships ?? [])[0]?.workspace_id ?? EXPECTED_WORKSPACE_ID;
  if (workspaceId !== EXPECTED_WORKSPACE_ID) {
    console.warn(`Using owner workspace ${workspaceId}; expected ${EXPECTED_WORKSPACE_ID}.`);
  }

  const members: MemberSeed[] = [
    {
      slug: 'daniel-phillippe',
      userId: owner.id,
      firstName: 'Daniel',
      lastName: 'Phillippe',
      role: 'owner',
      color: '#3B82F6',
      weeklyDoorGoal: 140,
      weeklySessionsGoal: 4,
      weeklyMinutesGoal: 320,
      current7d: { doors: 118, conversations: 30, leads: 6, appointments: 2 },
    },
    ...baseMembers.map((member) => ({
      ...member,
      userId: mockUserIds.get(member.slug),
    })),
  ];

  const missingMockUser = members.find((member) => !member.userId);
  if (missingMockUser) throw new Error(`Missing auth user id for ${fullName(missingMockUser)}.`);

  const deleted = await cleanupWorkspace(
    admin,
    workspaceId,
    owner.id,
    members.map((member) => member.userId!)
  );

  const { error: workspaceError } = await admin
    .from('workspaces')
    .update({
      name: WORKSPACE_NAME,
      owner_id: owner.id,
      industry: 'Real Estate',
      brokerage_name: 'REVEL REALTY INC',
      subscription_status: 'active',
      trial_ends_at: null,
      max_seats: 10,
      onboarding_completed_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', workspaceId);
  assertNoError(workspaceError, 'Update workspace');

  await upsertRows(
    admin,
    'user_profiles',
    members.map((member) => ({
      user_id: member.userId,
      first_name: member.firstName,
      last_name: member.lastName,
      weekly_door_goal: member.weeklyDoorGoal,
      weekly_sessions_goal: member.weeklySessionsGoal,
      weekly_minutes_goal: member.weeklyMinutesGoal,
      industry: 'Real Estate',
      brokerage_name: 'REVEL REALTY INC',
      is_founder: false,
      current_workspace_id: workspaceId,
      country_code: 'CA',
    })),
    'user profiles'
  );

  await upsertRows(
    admin,
    'workspace_members',
    members.map((member, index) => ({
      id: deterministicUuid(`danielteam:workspace-member:${member.slug}`),
      workspace_id: workspaceId,
      user_id: member.userId,
      role: member.role,
      color: member.color,
      created_at: iso(new Date(now.getTime() + index * 1000)),
      updated_at: iso(now),
    })),
    'workspace members',
    { onConflict: 'workspace_id,user_id' }
  );

  const sessions = buildSessionRows(workspaceId, members, now);
  await insertRows(admin, 'sessions', sessions as unknown as Array<Record<string, unknown>>, 'sessions');

  const contacts = buildContactRows(workspaceId, members, sessions, now);
  await insertRows(admin, 'contacts', contacts as unknown as Array<Record<string, unknown>>, 'contacts');

  const appointmentContacts = contacts.filter((contact) => contact.appointment_at);
  const crmRows = appointmentContacts.map((contact, index) => ({
    id: deterministicUuid(`danielteam:crm-event:${contact.id}`),
    user_id: contact.user_id,
    crm_type: 'fub',
    flyr_event_id: deterministicUuid(`danielteam:crm-flyr-event:${contact.id}`),
    fub_person_id: 900000 + index,
    fub_note_id: 800000 + index,
    fub_task_id: null,
    fub_appointment_id: 700000 + index,
    transcript: `Mock appointment created for ${contact.full_name}.`,
    ai_json: {
      source: 'danielteam-mock-seed',
      contact_id: contact.id,
      status: contact.status,
    },
    created_at: contact.appointment_at ?? contact.updated_at,
  }));
  await insertRows(admin, 'crm_events', crmRows, 'crm events');

  const fieldLeadRows = appointmentContacts.map((contact) => ({
    id: deterministicUuid(`danielteam:field-lead:${contact.id}`),
    user_id: contact.user_id,
    address: contact.address,
    name: contact.full_name,
    phone: contact.phone,
    email: contact.email,
    status: 'interested',
    notes: `Appointment mock lead owned by ${contact.user_id}.`,
    campaign_id: null,
    session_id: contact.session_id,
    sync_status: 'pending',
    created_at: contact.created_at,
    updated_at: contact.appointment_at ?? contact.updated_at,
    workspace_id: workspaceId,
  }));
  await insertRows(admin, 'field_leads', fieldLeadRows, 'field leads');

  const activityRows = contacts.flatMap((contact, index) => {
    const rows = [
      {
        id: deterministicUuid(`danielteam:contact-activity:note:${contact.id}`),
        contact_id: contact.id,
        type: 'note',
        note: `${contact.full_name} captured as a mock lead.`,
        timestamp: contact.created_at,
        created_at: contact.created_at,
      },
    ];
    if (contact.follow_up_at) {
      rows.push({
        id: deterministicUuid(`danielteam:contact-activity:followup:${contact.id}`),
        contact_id: contact.id,
        type: 'note',
        note: `Follow up with ${contact.full_name}.`,
        timestamp: contact.follow_up_at,
        created_at: contact.updated_at,
      });
    }
    if (contact.appointment_at) {
      rows.push({
        id: deterministicUuid(`danielteam:contact-activity:appointment:${contact.id}`),
        contact_id: contact.id,
        type: 'meeting',
        note: `Appointment booked with ${contact.full_name}.`,
        timestamp: contact.appointment_at,
        created_at: contact.updated_at,
      });
    }
    if (index % 11 === 0) {
      rows.push({
        id: deterministicUuid(`danielteam:contact-activity:call:${contact.id}`),
        contact_id: contact.id,
        type: 'call',
        note: `Mock call logged for ${contact.full_name}.`,
        timestamp: contact.updated_at,
        created_at: contact.updated_at,
      });
    }
    return rows;
  });
  await insertRows(admin, 'contact_activities', activityRows, 'contact activities');

  const reports = buildReportRows(workspaceId, owner.id, members, sessions, contacts, now);
  await insertRows(admin, 'reports', reports, 'reports');

  const yearStart = startOfYearUtc(now);
  const nextYear = addPeriod(yearStart, 'yearly', 1);
  const allTimeMetrics = buildMetricsForPeriod(
    members.map((member) => member.userId!),
    sessions,
    contacts,
    yearStart,
    nextYear
  );

  await upsertRows(
    admin,
    'user_stats',
    members.map((member) => {
      const metrics = allTimeMetrics.get(member.userId!) ?? { ...ZERO_METRICS };
      return {
        user_id: member.userId,
        doors_knocked: metrics.doors_knocked,
        flyers: metrics.flyers_delivered,
        conversations: metrics.conversations,
        leads_created: metrics.leads_created,
        appointments: metrics.appointments_set,
        distance_walked: sessions
          .filter((session) => session.user_id === member.userId && session.end_time)
          .reduce((sum, session) => sum + session.distance_meters, 0),
        conversation_per_door: metrics.doors_knocked > 0 ? metrics.conversations / metrics.doors_knocked : 0,
        conversation_lead_rate: metrics.conversations > 0 ? metrics.leads_created / metrics.conversations : 0,
        time_tracked: metrics.time_spent_seconds,
        xp: metrics.doors_knocked + metrics.conversations * 3 + metrics.leads_created * 10,
        day_streak: 5,
        best_streak: 9,
        updated_at: iso(now),
      };
    }),
    'user stats',
    { onConflict: 'user_id' }
  );

  for (const member of members) {
    const statsRefresh = await admin.rpc('refresh_user_stats_from_sessions', { p_user_id: member.userId });
    if (statsRefresh.error && !isIgnorableSchemaError(statsRefresh.error)) {
      console.warn(`refresh_user_stats_from_sessions failed for ${fullName(member)}: ${statsRefresh.error.message}`);
    }
    const leaderboardRefresh = await admin.rpc('refresh_leaderboard_rollups_for_user', { p_user_id: member.userId });
    if (leaderboardRefresh.error) {
      console.warn(`refresh_leaderboard_rollups_for_user failed for ${fullName(member)}: ${leaderboardRefresh.error.message}`);
    }
  }

  const [{ count: memberCount }, { count: sessionCount }, { count: contactCount }, { count: reportCount }, { count: rollupCount }] =
    await Promise.all([
      admin.from('workspace_members').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      admin.from('sessions').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      admin.from('contacts').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      admin.from('reports').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      admin.from('leaderboard_rollups').select('*', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
    ]);

  const current7dTotals = members.reduce(
    (acc, member) => ({
      doors: acc.doors + member.current7d.doors,
      conversations: acc.conversations + member.current7d.conversations,
      leads: acc.leads + member.current7d.leads,
      appointments: acc.appointments + member.current7d.appointments,
    }),
    { doors: 0, conversations: 0, leads: 0, appointments: 0 }
  );

  console.log('Danielteam mock data seeded.');
  console.log(JSON.stringify({
    workspaceId,
    deleted,
    counts: {
      members: memberCount,
      sessions: sessionCount,
      contacts: contactCount,
      reports: reportCount,
      leaderboard_rollups: rollupCount,
    },
    current7dTotals,
    roster: members.map((member) => ({
      user_id: member.userId,
      name: fullName(member),
      role: member.role,
      doors_7d: member.current7d.doors,
      conversations_7d: member.current7d.conversations,
      leads_7d: member.current7d.leads,
      appointments_7d: member.current7d.appointments,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
