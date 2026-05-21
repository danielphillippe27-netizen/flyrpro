import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { asUuid, canManageRoutes, getWorkspaceRole } from '@/app/api/routes/_lib';
import {
  distributeWholeTeamGoals,
  normalizeZoneAssignments,
  type CampaignAssignmentMode,
  type ZoneAssignmentInput,
} from '@/lib/campaignAssignments';
import { sendCampaignAssignmentEmail } from '@/lib/email/campaignAssignments';

type RouteContext = { params: Promise<{ campaignId: string }> };

type CampaignRow = {
  id: string;
  name: string | null;
  workspace_id: string | null;
};

type AssignmentRow = {
  id: string;
  campaign_id: string;
  workspace_id: string;
  assigned_to_user_id: string;
  assigned_by_user_id: string;
  mode: CampaignAssignmentMode;
  goal_homes: number;
  zone_index: number | null;
  status: string;
  due_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

function asMode(value: unknown): CampaignAssignmentMode | null {
  return value === 'zone_split' || value === 'whole_team' ? value : null;
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function displayName(profile: ProfileRow | undefined, fallback: string): string {
  const name = [profile?.first_name, profile?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();
  return name || fallback;
}

async function fetchAllCampaignAddressIds(
  admin: ReturnType<typeof createAdminClient>,
  campaignId: string
): Promise<string[]> {
  const ids: string[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from('campaign_addresses')
      .select('id')
      .eq('campaign_id', campaignId)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message || 'Failed to load campaign homes');
    ids.push(...((data ?? []) as Array<{ id: string }>).map((row) => row.id).filter(Boolean));
    if (!data || data.length < pageSize) break;
  }
  return ids;
}

async function loadProfiles(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<Map<string, ProfileRow>> {
  if (userIds.length === 0) return new Map();
  const { data } = await admin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', userIds);
  return new Map(((data ?? []) as ProfileRow[]).map((row) => [row.user_id, row]));
}

async function loadEmails(
  admin: ReturnType<typeof createAdminClient>,
  userIds: string[]
): Promise<Map<string, string>> {
  const emailByUserId = new Map<string, string>();
  await Promise.all(
    userIds.map(async (userId) => {
      const { data, error } = await admin.auth.admin.getUserById(userId);
      const email = data?.user?.email?.trim().toLowerCase();
      if (!error && email) emailByUserId.set(userId, email);
    })
  );
  return emailByUserId;
}

async function loadAssignmentsForResponse(params: {
  admin: ReturnType<typeof createAdminClient>;
  campaignId: string;
  workspaceId: string;
  viewerUserId: string;
  canManage: boolean;
}) {
  const { admin, campaignId, workspaceId, viewerUserId, canManage } = params;
  let query = admin
    .from('campaign_assignments')
    .select('id, campaign_id, workspace_id, assigned_to_user_id, assigned_by_user_id, mode, goal_homes, zone_index, status, due_at, notes, created_at, updated_at')
    .eq('campaign_id', campaignId)
    .eq('workspace_id', workspaceId)
    .in('status', ['assigned', 'in_progress'])
    .order('zone_index', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (!canManage) {
    query = query.eq('assigned_to_user_id', viewerUserId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Failed to load campaign assignments');

  const rows = (data ?? []) as AssignmentRow[];
  const assignmentIds = rows.map((row) => row.id);
  const assigneeIds = Array.from(new Set(rows.map((row) => row.assigned_to_user_id)));
  const profiles = await loadProfiles(admin, assigneeIds);

  let homesByAssignmentId = new Map<string, Array<{ campaign_address_id: string; sequence: number }>>();
  if (assignmentIds.length > 0) {
    const { data: homes, error: homesError } = await admin
      .from('campaign_assignment_homes')
      .select('assignment_id, campaign_address_id, sequence')
      .in('assignment_id', assignmentIds)
      .order('sequence', { ascending: true });
    if (homesError) throw new Error(homesError.message || 'Failed to load assigned homes');
    homesByAssignmentId = ((homes ?? []) as Array<{ assignment_id: string; campaign_address_id: string; sequence: number }>).reduce(
      (map, row) => {
        const list = map.get(row.assignment_id) ?? [];
        list.push({ campaign_address_id: row.campaign_address_id, sequence: row.sequence });
        map.set(row.assignment_id, list);
        return map;
      },
      new Map<string, Array<{ campaign_address_id: string; sequence: number }>>()
    );
  }

  return rows.map((row) => ({
    ...row,
    assignee: {
      user_id: row.assigned_to_user_id,
      display_name: displayName(profiles.get(row.assigned_to_user_id), row.assigned_to_user_id.slice(0, 8)),
    },
    homes: homesByAssignmentId.get(row.id) ?? [],
  }));
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { campaignId } = await context.params;
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminClient();
    const { data: campaign } = await admin
      .from('campaigns')
      .select('id, name, workspace_id')
      .eq('id', campaignId)
      .maybeSingle();

    const campaignRow = campaign as CampaignRow | null;
    if (!campaignRow?.id || !campaignRow.workspace_id) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const role = await getWorkspaceRole(campaignRow.workspace_id, requestUser.id);
    if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const assignments = await loadAssignmentsForResponse({
      admin,
      campaignId,
      workspaceId: campaignRow.workspace_id,
      viewerUserId: requestUser.id,
      canManage: canManageRoutes(role),
    });

    return NextResponse.json({ campaign: campaignRow, assignments, role });
  } catch (error) {
    console.error('[api/campaigns/:campaignId/assignments] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const warnings: string[] = [];

  try {
    const { campaignId } = await context.params;
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      workspaceId?: unknown;
      mode?: unknown;
      memberIds?: unknown;
      dueAt?: unknown;
      notes?: unknown;
      zoneAssignments?: ZoneAssignmentInput[];
    } | null;

    const workspaceId = asUuid(body?.workspaceId);
    const mode = asMode(body?.mode);
    const memberIds = Array.isArray(body?.memberIds)
      ? Array.from(new Set(body.memberIds.map((value) => asUuid(value)).filter((value): value is string => Boolean(value))))
      : [];
    const dueAt = asOptionalString(body?.dueAt);
    const notes = asOptionalString(body?.notes);
    const zoneAssignments = Array.isArray(body?.zoneAssignments) ? body.zoneAssignments : [];

    if (!workspaceId || !mode || memberIds.length === 0) {
      return NextResponse.json(
        { error: 'workspaceId, mode, and memberIds are required' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: campaign } = await admin
      .from('campaigns')
      .select('id, name, workspace_id')
      .eq('id', campaignId)
      .maybeSingle();

    const campaignRow = campaign as CampaignRow | null;
    if (!campaignRow?.id || campaignRow.workspace_id !== workspaceId) {
      return NextResponse.json({ error: 'Campaign not found in workspace' }, { status: 404 });
    }

    const role = await getWorkspaceRole(workspaceId, requestUser.id);
    if (!canManageRoutes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: memberships, error: memberError } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .in('user_id', memberIds);
    if (memberError) {
      return NextResponse.json({ error: memberError.message }, { status: 500 });
    }
    const validMembers = new Set(((memberships ?? []) as Array<{ user_id: string }>).map((row) => row.user_id));
    if (memberIds.some((memberId) => !validMembers.has(memberId))) {
      return NextResponse.json(
        { error: 'Every assigned member must belong to this workspace' },
        { status: 400 }
      );
    }

    const campaignAddressIds = await fetchAllCampaignAddressIds(admin, campaignId);
    if (campaignAddressIds.length === 0) {
      return NextResponse.json({ error: 'Campaign has no homes to assign' }, { status: 400 });
    }

    const normalizedZones =
      mode === 'zone_split'
        ? normalizeZoneAssignments({ memberIds, zoneAssignments, campaignAddressIds })
        : [];
    const wholeTeamGoals =
      mode === 'whole_team' ? distributeWholeTeamGoals(campaignAddressIds.length, memberIds) : new Map<string, number>();

    const now = new Date().toISOString();
    const { error: cancelError } = await admin
      .from('campaign_assignments')
      .update({ status: 'cancelled', updated_at: now })
      .eq('campaign_id', campaignId)
      .eq('workspace_id', workspaceId)
      .in('status', ['assigned', 'in_progress']);
    if (cancelError) {
      return NextResponse.json({ error: cancelError.message || 'Failed to cancel previous assignments' }, { status: 500 });
    }

    const assignmentInserts =
      mode === 'zone_split'
        ? normalizedZones.map((zone) => ({
            campaign_id: campaignId,
            workspace_id: workspaceId,
            assigned_to_user_id: zone.userId,
            assigned_by_user_id: requestUser.id,
            mode,
            goal_homes: zone.goalHomes,
            zone_index: zone.zoneIndex,
            status: 'assigned',
            due_at: dueAt,
            notes,
          }))
        : memberIds.map((memberId, index) => ({
            campaign_id: campaignId,
            workspace_id: workspaceId,
            assigned_to_user_id: memberId,
            assigned_by_user_id: requestUser.id,
            mode,
            goal_homes: wholeTeamGoals.get(memberId) ?? 0,
            zone_index: index + 1,
            status: 'assigned',
            due_at: dueAt,
            notes,
          }));

    const { data: insertedAssignments, error: insertError } = await admin
      .from('campaign_assignments')
      .insert(assignmentInserts)
      .select('id, campaign_id, workspace_id, assigned_to_user_id, assigned_by_user_id, mode, goal_homes, zone_index, status, due_at, notes, created_at, updated_at');

    if (insertError || !insertedAssignments) {
      return NextResponse.json(
        { error: insertError?.message || 'Failed to create campaign assignments' },
        { status: 500 }
      );
    }

    const createdAssignments = insertedAssignments as AssignmentRow[];
    if (mode === 'zone_split') {
      const assignmentByUserId = new Map(createdAssignments.map((row) => [row.assigned_to_user_id, row]));
      const homeRows = normalizedZones.flatMap((zone) => {
        const assignment = assignmentByUserId.get(zone.userId);
        if (!assignment) return [];
        return zone.addressIds.map((addressId, index) => ({
          assignment_id: assignment.id,
          campaign_address_id: addressId,
          sequence: index + 1,
        }));
      });

      const { error: homesError } = await admin.from('campaign_assignment_homes').insert(homeRows);
      if (homesError) {
        await admin
          .from('campaign_assignments')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .in('id', createdAssignments.map((row) => row.id));
        return NextResponse.json({ error: homesError.message || 'Failed to assign campaign homes' }, { status: 500 });
      }
    }

    const profiles = await loadProfiles(admin, memberIds);
    const emails = await loadEmails(admin, memberIds);
    const campaignName = campaignRow.name?.trim() || 'Campaign';
    const campaignUrl = `${request.nextUrl.origin}/campaigns/${campaignId}`;

    const notificationRows = createdAssignments.map((assignment) => ({
      workspace_id: campaignRow.workspace_id,
      user_id: assignment.assigned_to_user_id,
      type: 'campaign_assigned',
      title: 'Campaign assigned',
      body:
        assignment.mode === 'zone_split'
          ? `${campaignName}: your zone has ${assignment.goal_homes} homes.`
          : `${campaignName}: your house goal is ${assignment.goal_homes}.`,
      data: {
        campaignId,
        assignmentId: assignment.id,
        mode: assignment.mode,
        goalHomes: assignment.goal_homes,
        link: `/campaigns/${campaignId}`,
      },
    }));
    const { error: notificationError } = await admin.from('notifications').insert(notificationRows);
    if (notificationError) {
      warnings.push(`In-app notification failed: ${notificationError.message}`);
    }

    await Promise.all(
      createdAssignments.map(async (assignment) => {
        const email = emails.get(assignment.assigned_to_user_id);
        if (!email) {
          warnings.push(`No email found for ${assignment.assigned_to_user_id.slice(0, 8)}.`);
          return;
        }
        try {
          await sendCampaignAssignmentEmail({
            to: email,
            recipientName: displayName(profiles.get(assignment.assigned_to_user_id), 'there'),
            campaignName,
            mode: assignment.mode,
            goalHomes: assignment.goal_homes,
            dueAt: assignment.due_at,
            notes: assignment.notes,
            campaignUrl,
          });
        } catch (error) {
          warnings.push(
            error instanceof Error
              ? `Email failed for ${email}: ${error.message}`
              : `Email failed for ${email}.`
          );
        }
      })
    );

    const assignments = await loadAssignmentsForResponse({
      admin,
      campaignId,
      workspaceId,
      viewerUserId: requestUser.id,
      canManage: true,
    });

    return NextResponse.json({ assignments, warnings });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message.includes('Zone assignment') || message.includes('At least') || message.includes('Every')
      ? 400
      : 500;
    console.error('[api/campaigns/:campaignId/assignments] POST error:', error);
    return NextResponse.json({ error: message }, { status });
  }
}
