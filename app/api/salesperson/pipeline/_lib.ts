import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest, type RequestUser } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import type {
  SalesLeadActivityType,
  SalesLeadMatchConfidence,
  SalesPipelinePriority,
  SalesPipelineStage,
  SalesPipelineTaskType,
  SalesActivity,
  SalesLead,
  SalespersonLeadActivity,
  SalespersonLeadAppMatch,
} from '@/types/database';

export const PIPELINE_LEAD_SELECT = `
  id,
  workspace_id,
  contact_id,
  dialler_lead_id,
  assigned_user_id,
  assigned_salesperson_id,
  created_by_user_id,
  name,
  company,
  phone,
  phone_e164,
  email,
  email_normalized,
  website,
  website_domain,
  address,
  city,
  region,
  country_code,
  source,
  external_id,
  lead_fingerprint,
  lead_state,
  pipeline_stage,
  pipeline_owner_id,
  pipeline_priority,
  seat_count,
  estimated_monthly_value_cents,
  attempt_count,
  last_attempted_at,
  next_task_title,
  next_task_type,
  next_follow_up_at,
  last_touch_at,
  last_touch_summary,
  objection,
  trial_status,
  trial_started_at,
  signed_up_user_id,
  signed_up_workspace_id,
  last_product_active_at,
  usage_summary,
  match_confidence,
  disposition,
  notes,
  metadata,
  created_at,
  updated_at
`;

export type SalesPipelineMember = {
  id: string;
  salespersonId: string | null;
  userId: string | null;
  name: string;
  email: string | null;
  role: string | null;
};

export type PipelineUsageSummary = {
  campaignsCount?: number;
  teamMembersCount?: number;
  contactsCount?: number;
  lastActivityAt?: string | null;
  suggestedSeatCount?: number;
};

export type SalesPipelineLead = SalesLead & {
  owner_name?: string | null;
  salesperson_name?: string | null;
  usage_summary?: PipelineUsageSummary | null;
};

export type PipelineContext = {
  admin: ReturnType<typeof createAdminClient>;
  requestUser: RequestUser;
  salesperson: SalespersonRow | null;
  isFounder: boolean;
  workspaceId: string | null;
};

type SalespersonRow = {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  workspace_id: string | null;
};

type UserProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
};

const PIPELINE_STAGES = new Set<SalesPipelineStage>([
  'new_lead',
  'attempting_contact',
  'connected',
  'demo_sent',
  'trial_sent',
  'trial_active',
  'closing',
  'won',
  'lost',
  'nurture',
]);

const PIPELINE_PRIORITIES = new Set<SalesPipelinePriority>(['low', 'normal', 'high', 'hot']);
const TASK_TYPES = new Set<SalesPipelineTaskType>([
  'call',
  'text',
  'email',
  'dm',
  'demo_follow_up',
  'trial_check_in',
  'close_ask',
  'nurture',
]);
const MATCH_CONFIDENCES = new Set<SalesLeadMatchConfidence>(['strong', 'medium', 'weak', 'ambiguous']);
const ACTIVITY_TYPES = new Set<SalesLeadActivityType>([
  'note',
  'call',
  'text',
  'email',
  'stage_change',
  'task_change',
  'demo_opened',
  'signup',
  'usage_milestone',
  'match_review',
]);

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function readIsoDate(value: unknown): string | null | undefined {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function readNumber(value: unknown): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

async function resolveSalesperson(
  admin: ReturnType<typeof createAdminClient>,
  user: RequestUser
): Promise<SalespersonRow | null> {
  const normalizedEmail = user.email?.trim().toLowerCase();

  const byUser = await admin
    .from('salespeople')
    .select('id, user_id, full_name, email, workspace_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!byUser.error && byUser.data) return byUser.data as SalespersonRow;
  if (byUser.error) {
    const message = byUser.error.message?.toLowerCase() ?? '';
    if (!message.includes('user_id') && !message.includes('schema cache')) {
      throw new Error(byUser.error.message);
    }
  }

  if (!normalizedEmail) return null;
  const { data, error } = await admin
    .from('salespeople')
    .select('id, user_id, full_name, email, workspace_id')
    .ilike('email', normalizedEmail)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SalespersonRow | null) ?? null;
}

async function isFounderUser(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('user_profiles')
    .select('is_founder')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean((data as { is_founder?: boolean | null } | null)?.is_founder);
}

export async function resolvePipelineContext(
  request: NextRequest
): Promise<PipelineContext | NextResponse> {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId');
  const [salesperson, isFounder] = await Promise.all([
    resolveSalesperson(admin, requestUser),
    isFounderUser(admin, requestUser.id),
  ]);

  if (!salesperson && !isFounder) {
    return NextResponse.json({ error: 'Internal sales access is required.' }, { status: 403 });
  }

  const workspaceId = salesperson?.workspace_id
    ? salesperson.workspace_id
    : (
        await resolveWorkspaceIdForUser(
          admin as unknown as MinimalSupabaseClient,
          requestUser.id,
          requestedWorkspaceId
        )
      ).workspaceId;

  return { admin, requestUser, salesperson, isFounder, workspaceId };
}

function displayName(userProfile?: UserProfileRow, profile?: ProfileRow): string | null {
  const profileName = profile?.full_name?.trim();
  if (profileName) return profileName;
  const joined = [userProfile?.first_name, userProfile?.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  return joined || profile?.email || null;
}

export async function loadPipelineMembers(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<SalesPipelineMember[]> {
  const [{ data: salespeople }, { data: workspaceMembers }] = await Promise.all([
    admin
      .from('salespeople')
      .select('id, user_id, full_name, email, status, workspace_id')
      .eq('workspace_id', workspaceId)
      .order('full_name', { ascending: true }),
    admin
      .from('workspace_members')
      .select('user_id, role')
      .eq('workspace_id', workspaceId),
  ]);

  const userIds = Array.from(
    new Set((workspaceMembers ?? []).map((row) => row.user_id).filter(Boolean))
  );

  const [userProfilesResult, profilesResult] = userIds.length
    ? await Promise.all([
        admin.from('user_profiles').select('user_id, first_name, last_name').in('user_id', userIds),
        admin.from('profiles').select('id, email, full_name').in('id', userIds),
      ])
    : [{ data: [] }, { data: [] }];

  const userProfileById = new Map(
    ((userProfilesResult.data ?? []) as UserProfileRow[]).map((row) => [row.user_id, row])
  );
  const profileById = new Map(
    ((profilesResult.data ?? []) as ProfileRow[]).map((row) => [row.id, row])
  );

  const salespersonByUserId = new Map(
    ((salespeople ?? []) as Array<SalespersonRow & { status?: string | null }>).map((row) => [row.user_id, row])
  );

  const members: SalesPipelineMember[] = ((workspaceMembers ?? []) as Array<{ user_id: string; role: string | null }>).map((member) => {
    const salesperson = salespersonByUserId.get(member.user_id) ?? null;
    const profile = profileById.get(member.user_id);
    const userProfile = userProfileById.get(member.user_id);
    return {
      id: member.user_id,
      salespersonId: salesperson?.id ?? null,
      userId: member.user_id,
      name: salesperson?.full_name || displayName(userProfile, profile) || profile?.email || member.user_id.slice(0, 8),
      email: salesperson?.email ?? profile?.email ?? null,
      role: member.role,
    };
  });

  for (const salesperson of (salespeople ?? []) as SalespersonRow[]) {
    if (salesperson.user_id && members.some((member) => member.userId === salesperson.user_id)) continue;
    members.push({
      id: `salesperson:${salesperson.id}`,
      salespersonId: salesperson.id,
      userId: salesperson.user_id,
      name: salesperson.full_name || salesperson.email || salesperson.id.slice(0, 8),
      email: salesperson.email ?? null,
      role: 'salesperson',
    });
  }

  return members.sort((a, b) => a.name.localeCompare(b.name));
}

export function decorateLeadsWithMembers(
  leads: SalesLead[],
  members: SalesPipelineMember[]
): SalesPipelineLead[] {
  const byUserId = new Map(members.filter((member) => member.userId).map((member) => [member.userId as string, member]));
  const bySalespersonId = new Map(members.filter((member) => member.salespersonId).map((member) => [member.salespersonId as string, member]));
  return leads.map((lead) => ({
    ...lead,
    owner_name: lead.pipeline_owner_id ? byUserId.get(lead.pipeline_owner_id)?.name ?? null : null,
    salesperson_name: lead.assigned_salesperson_id ? bySalespersonId.get(lead.assigned_salesperson_id)?.name ?? null : null,
  }));
}

export async function enrichPipelineUsage(
  admin: ReturnType<typeof createAdminClient>,
  leads: SalesPipelineLead[]
): Promise<SalesPipelineLead[]> {
  const workspaceIds = Array.from(new Set(leads.map((lead) => lead.signed_up_workspace_id).filter((id): id is string => Boolean(id))));
  if (!workspaceIds.length) return leads;

  const [campaigns, members, contacts, activities] = await Promise.all([
    admin
      .from('campaigns')
      .select('id, workspace_id, created_at')
      .in('workspace_id', workspaceIds)
      .limit(10000),
    admin.from('workspace_members').select('id, workspace_id, created_at').in('workspace_id', workspaceIds).limit(10000),
    admin.from('contacts').select('id, workspace_id, created_at').in('workspace_id', workspaceIds).limit(10000),
    admin.from('activity_events').select('id, workspace_id, event_time').in('workspace_id', workspaceIds).order('event_time', { ascending: false }).limit(10000),
  ]);

  const usageByWorkspace = new Map<string, PipelineUsageSummary>();
  for (const id of workspaceIds) usageByWorkspace.set(id, {});

  for (const row of campaigns.data ?? []) {
    const current = usageByWorkspace.get(row.workspace_id) ?? {};
    current.campaignsCount = (current.campaignsCount ?? 0) + 1;
    usageByWorkspace.set(row.workspace_id, current);
  }
  for (const row of members.data ?? []) {
    const current = usageByWorkspace.get(row.workspace_id) ?? {};
    current.teamMembersCount = (current.teamMembersCount ?? 0) + 1;
    current.suggestedSeatCount = Math.max(current.suggestedSeatCount ?? 1, current.teamMembersCount);
    usageByWorkspace.set(row.workspace_id, current);
  }
  for (const row of contacts.data ?? []) {
    const current = usageByWorkspace.get(row.workspace_id) ?? {};
    current.contactsCount = (current.contactsCount ?? 0) + 1;
    usageByWorkspace.set(row.workspace_id, current);
  }
  for (const row of activities.data ?? []) {
    const current = usageByWorkspace.get(row.workspace_id) ?? {};
    if (!current.lastActivityAt || new Date(row.event_time).getTime() > new Date(current.lastActivityAt).getTime()) {
      current.lastActivityAt = row.event_time;
    }
    usageByWorkspace.set(row.workspace_id, current);
  }

  return leads.map((lead) => {
    const liveUsage = lead.signed_up_workspace_id ? usageByWorkspace.get(lead.signed_up_workspace_id) : null;
    if (!liveUsage) return lead;
    return {
      ...lead,
      last_product_active_at: liveUsage.lastActivityAt ?? lead.last_product_active_at ?? null,
      usage_summary: {
        ...(lead.usage_summary ?? {}),
        ...liveUsage,
      },
    };
  });
}

export async function loadLeadActivitiesAndMatches(params: {
  admin: ReturnType<typeof createAdminClient>;
  leadId: string;
  workspaceId: string;
}): Promise<{ activities: SalespersonLeadActivity[]; matches: SalespersonLeadAppMatch[] }> {
  const [activitiesResult, matchesResult] = await Promise.all([
    params.admin
      .from('sales_activities')
      .select('*')
      .eq('workspace_id', params.workspaceId)
      .eq('sales_lead_id', params.leadId)
      .order('occurred_at', { ascending: false })
      .limit(100),
    params.admin
      .from('sales_activities')
      .select('*')
      .eq('workspace_id', params.workspaceId)
      .eq('sales_lead_id', params.leadId)
      .in('activity_type', ['signup', 'match_review'])
      .order('occurred_at', { ascending: false })
      .limit(50),
  ]);

  if (activitiesResult.error) throw new Error(activitiesResult.error.message);
  if (matchesResult.error) throw new Error(matchesResult.error.message);
  const activities = ((activitiesResult.data ?? []) as SalesActivity[]).map((activity) => {
    const metadata = activity.metadata ?? {};
    return {
      id: activity.id,
      lead_id: activity.sales_lead_id ?? params.leadId,
      workspace_id: activity.workspace_id,
      actor_user_id: activity.actor_user_id ?? null,
      salesperson_id: typeof metadata.legacySalespersonId === 'string' ? metadata.legacySalespersonId : null,
      activity_type: activity.activity_type as SalesLeadActivityType,
      title: typeof metadata.title === 'string' ? metadata.title : activity.activity_type,
      body: typeof metadata.body === 'string' ? metadata.body : activity.note ?? null,
      metadata,
      created_at: activity.occurred_at ?? activity.created_at,
    } satisfies SalespersonLeadActivity;
  });

  const matches: SalespersonLeadAppMatch[] = [];
  for (const activity of (matchesResult.data ?? []) as SalesActivity[]) {
    const metadata = activity.metadata ?? {};
    if (!metadata.legacyAppMatch && activity.activity_type !== 'signup' && activity.activity_type !== 'match_review') {
      continue;
    }
    matches.push({
      id: activity.id,
      lead_id: activity.sales_lead_id ?? params.leadId,
      workspace_id: activity.workspace_id,
      salesperson_id: typeof metadata.legacySalespersonId === 'string' ? metadata.legacySalespersonId : null,
      matched_user_id: typeof metadata.matchedUserId === 'string' ? metadata.matchedUserId : null,
      matched_workspace_id: typeof metadata.matchedWorkspaceId === 'string' ? metadata.matchedWorkspaceId : null,
      demo_link_id: typeof metadata.demoLinkId === 'string' ? metadata.demoLinkId : null,
      match_method: (typeof metadata.matchMethod === 'string' ? metadata.matchMethod : 'email') as SalespersonLeadAppMatch['match_method'],
      match_confidence: (typeof metadata.matchConfidence === 'string' ? metadata.matchConfidence : 'medium') as SalespersonLeadAppMatch['match_confidence'],
      matched_email: typeof metadata.matchedEmail === 'string' ? metadata.matchedEmail : null,
      matched_phone_e164: typeof metadata.matchedPhoneE164 === 'string' ? metadata.matchedPhoneE164 : null,
      evidence: metadata.evidence && typeof metadata.evidence === 'object' ? metadata.evidence as Record<string, unknown> : {},
      auto_applied: Boolean(metadata.autoApplied),
      created_at: activity.occurred_at ?? activity.created_at,
    });
  }

  return {
    activities,
    matches,
  };
}

export function parsePipelineUpdate(body: Record<string, unknown>) {
  const updates: Record<string, unknown> = {};
  const stage = readString(body.pipeline_stage);
  if (stage && PIPELINE_STAGES.has(stage as SalesPipelineStage)) updates.pipeline_stage = stage;
  const priority = readString(body.pipeline_priority);
  if (priority && PIPELINE_PRIORITIES.has(priority as SalesPipelinePriority)) updates.pipeline_priority = priority;
  const taskType = readString(body.next_task_type);
  if (taskType && TASK_TYPES.has(taskType as SalesPipelineTaskType)) updates.next_task_type = taskType;
  if (body.next_task_type === null || body.next_task_type === '') updates.next_task_type = null;
  const matchConfidence = readString(body.match_confidence);
  if (matchConfidence && MATCH_CONFIDENCES.has(matchConfidence as SalesLeadMatchConfidence)) {
    updates.match_confidence = matchConfidence;
  }

  for (const key of [
    'pipeline_owner_id',
    'next_task_title',
    'last_touch_summary',
    'objection',
    'trial_status',
    'notes',
  ]) {
    if (key in body) updates[key] = readString(body[key]) ?? null;
  }

  for (const key of ['next_follow_up_at', 'last_touch_at', 'trial_started_at']) {
    if (key in body) {
      const iso = readIsoDate(body[key]);
      if (iso !== undefined) updates[key] = iso;
    }
  }

  if ('seat_count' in body) {
    const seats = readNumber(body.seat_count);
    if (seats && seats >= 1) {
      updates.seat_count = seats;
      updates.estimated_monthly_value_cents = seats * 4000;
    }
  }

  if ('estimated_monthly_value_cents' in body) {
    const value = readNumber(body.estimated_monthly_value_cents);
    if (value !== null && value >= 0) updates.estimated_monthly_value_cents = value;
  }

  return updates;
}

export function parseActivityBody(body: Record<string, unknown>) {
  const activityType = readString(body.activity_type) ?? 'note';
  return {
    activity_type: (ACTIVITY_TYPES.has(activityType as SalesLeadActivityType) ? activityType : 'note') as SalesLeadActivityType,
    title: readString(body.title) ?? 'Note',
    body: readString(body.body),
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : {},
  };
}
