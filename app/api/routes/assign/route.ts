import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import {
  asOptionalString,
  asPriority,
  asUuid,
  canManageRoutes,
  getWorkspaceRole,
} from '@/app/api/routes/_lib';

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      routePlanId?: unknown;
      assignedToUserId?: unknown;
      priority?: unknown;
      dueAt?: unknown;
      notes?: unknown;
      allowReassign?: unknown;
    } | null;

    const routePlanId = asUuid(body?.routePlanId);
    const assignedToUserId = asUuid(body?.assignedToUserId);
    const priority = asPriority(body?.priority);
    const dueAt = asOptionalString(body?.dueAt);
    const notes = asOptionalString(body?.notes);
    const allowReassign = body?.allowReassign === true;
    if (!routePlanId || !assignedToUserId) {
      return NextResponse.json(
        { error: 'routePlanId and assignedToUserId are required' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: routePlan } = await admin
      .from('route_plans')
      .select('id, workspace_id')
      .eq('id', routePlanId)
      .maybeSingle();
    if (!routePlan?.id) {
      return NextResponse.json({ error: 'Route plan not found' }, { status: 404 });
    }

    const actorRole = await getWorkspaceRole(routePlan.workspace_id, user.id);
    if (!canManageRoutes(actorRole)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const assigneeRole = await getWorkspaceRole(routePlan.workspace_id, assignedToUserId);
    if (!assigneeRole) {
      return NextResponse.json(
        { error: 'Assigned user is not in this workspace' },
        { status: 400 }
      );
    }

    const { data: activeAssignment } = await admin
      .from('route_assignments')
      .select('id, assigned_to_user_id, status')
      .eq('route_plan_id', routePlanId)
      .in('status', ['assigned', 'accepted', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeAssignment?.id && activeAssignment.assigned_to_user_id !== assignedToUserId) {
      if (!allowReassign) {
        return NextResponse.json(
          { error: 'Route already has an active assignee. Use reassignment flow.' },
          { status: 409 }
        );
      }

      const reassignmentNote =
        notes ?? 'Reassigned by team lead before completion.';
      const { error: cancelError } = await admin
        .from('route_assignments')
        .update({
          status: 'cancelled',
          progress: { reason: 'reassigned' },
          updated_at: new Date().toISOString(),
          notes: reassignmentNote,
        })
        .eq('id', activeAssignment.id);

      if (cancelError) {
        return NextResponse.json(
          { error: cancelError.message || 'Failed to close previous assignment' },
          { status: 500 }
        );
      }
    } else if (activeAssignment?.id && activeAssignment.assigned_to_user_id === assignedToUserId) {
      return NextResponse.json({ error: 'Route is already assigned to this user' }, { status: 409 });
    }

    const { data, error } = await admin
      .from('route_assignments')
      .insert({
        route_plan_id: routePlanId,
        workspace_id: routePlan.workspace_id,
        assigned_to_user_id: assignedToUserId,
        assigned_by_user_id: user.id,
        status: 'assigned',
        progress: {},
        priority,
        due_at: dueAt,
        notes,
      })
      .select(
        'id, route_plan_id, workspace_id, assigned_to_user_id, assigned_by_user_id, status, priority, due_at, notes, created_at, updated_at'
      )
      .single();

    if (error) {
      const message = error.message || 'Failed to assign route plan';
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const { error: planStatusError } = await admin
      .from('route_plans')
      .update({ status: 'active', updated_at: new Date().toISOString() })
      .eq('id', routePlanId);
    if (planStatusError) {
      console.warn('[api/routes/assign] failed to set route_plans.status active:', planStatusError.message);
    }

    return NextResponse.json({ assignment: data });
  } catch (error) {
    console.error('[api/routes/assign] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
