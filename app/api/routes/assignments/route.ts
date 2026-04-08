import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { asUuid, canManageRoutes, getWorkspaceRole } from '@/app/api/routes/_lib';

type AssignmentRow = {
  id: string;
  route_plan_id: string;
  workspace_id: string;
  assigned_to_user_id: string;
  assigned_by_user_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  progress: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  priority?: 'low' | 'normal' | 'high';
  due_at?: string | null;
  notes?: string | null;
  accepted_at?: string | null;
  declined_at?: string | null;
  decline_reason?: string | null;
};

type RoutePlanRow = {
  id: string;
  campaign_id: string | null;
  name: string;
  total_stops: number;
  est_minutes: number | null;
  distance_meters: number | null;
  status: string;
};

type ProfileRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
};

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { code?: string; message?: string };
  if (maybeError.code === '42703' || maybeError.code === 'PGRST204') return true;
  return (
    typeof maybeError.message === 'string' &&
    maybeError.message.toLowerCase().includes('column') &&
    maybeError.message.toLowerCase().includes('does not exist')
  );
}

function getDisplayName(profile: ProfileRow | undefined, fallbackId: string): string {
  if (!profile) return fallbackId.slice(0, 8);
  if (profile.full_name && profile.full_name.trim().length > 0) return profile.full_name;
  const joined = [profile.first_name, profile.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();
  if (joined.length > 0) return joined;
  return fallbackId.slice(0, 8);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const workspaceId = asUuid(request.nextUrl.searchParams.get('workspaceId'));
    const campaignId = asUuid(request.nextUrl.searchParams.get('campaignId'));
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
    }

    const role = await getWorkspaceRole(workspaceId, user.id);
    if (!role) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createAdminClient();
    let query = admin
      .from('route_assignments')
      .select(
        'id, route_plan_id, workspace_id, assigned_to_user_id, assigned_by_user_id, status, started_at, completed_at, progress, created_at, updated_at, priority, due_at, notes, accepted_at, declined_at, decline_reason'
      )
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(300);

    if (!canManageRoutes(role)) {
      query = query.eq('assigned_to_user_id', user.id);
    }

    let { data: assignmentData, error: assignmentError } = await query;
    let hasWorkflowColumns = true;

    if (assignmentError && isMissingColumnError(assignmentError)) {
      hasWorkflowColumns = false;
      let fallbackQuery = admin
        .from('route_assignments')
        .select(
          'id, route_plan_id, workspace_id, assigned_to_user_id, assigned_by_user_id, status, started_at, completed_at, progress, created_at, updated_at'
        )
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
        .limit(300);

      if (!canManageRoutes(role)) {
        fallbackQuery = fallbackQuery.eq('assigned_to_user_id', user.id);
      }

      const fallback = await fallbackQuery;
      assignmentData = fallback.data;
      assignmentError = fallback.error;
    }

    if (assignmentError) {
      return NextResponse.json({ error: assignmentError.message }, { status: 500 });
    }

    const assignments = ((assignmentData ?? []) as AssignmentRow[]).map((assignment) =>
      hasWorkflowColumns
        ? assignment
        : {
            ...assignment,
            priority: undefined,
            due_at: null,
            notes: null,
            accepted_at: null,
            declined_at: null,
            decline_reason: null,
          }
    );
    const routePlanIds = Array.from(
      new Set(assignments.map((row) => row.route_plan_id).filter(Boolean))
    );
    const assigneeIds = Array.from(
      new Set(
        assignments
          .flatMap((row) => [row.assigned_to_user_id, row.assigned_by_user_id])
          .filter(Boolean)
      )
    );

    let routePlans: RoutePlanRow[] = [];
    if (routePlanIds.length > 0) {
      const routePlanQuery = admin
        .from('route_plans')
        .select('id, campaign_id, name, total_stops, est_minutes, distance_meters, status')
        .in('id', routePlanIds);
      if (campaignId) routePlanQuery.eq('campaign_id', campaignId);
      const { data, error } = await routePlanQuery;
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      routePlans = (data ?? []) as RoutePlanRow[];
    }

    const routePlanById = new Map(routePlans.map((row) => [row.id, row]));
    const filteredAssignments = assignments.filter((row) => routePlanById.has(row.route_plan_id));

    let profiles: ProfileRow[] = [];
    if (assigneeIds.length > 0) {
      const { data } = await admin
        .from('profiles')
        .select('id, first_name, last_name, full_name')
        .in('id', assigneeIds);
      profiles = (data ?? []) as ProfileRow[];
    }
    const profileById = new Map(profiles.map((row) => [row.id, row]));

    const payload = filteredAssignments.map((assignment) => {
      const routePlan = routePlanById.get(assignment.route_plan_id);
      return {
        ...assignment,
        route_plan: routePlan ?? null,
        assignee: {
          user_id: assignment.assigned_to_user_id,
          display_name: getDisplayName(
            profileById.get(assignment.assigned_to_user_id),
            assignment.assigned_to_user_id
          ),
        },
        assigned_by: {
          user_id: assignment.assigned_by_user_id,
          display_name: getDisplayName(
            profileById.get(assignment.assigned_by_user_id),
            assignment.assigned_by_user_id
          ),
        },
      };
    });

    return NextResponse.json({ assignments: payload, role });
  } catch (error) {
    console.error('[api/routes/assignments] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
