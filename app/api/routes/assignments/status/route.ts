import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { asOptionalString, asUuid, canManageRoutes, getWorkspaceRole } from '@/app/api/routes/_lib';

type RouteAssignmentStatus =
  | 'assigned'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'cancelled';

type AssignmentAction = 'accept' | 'decline' | 'start' | 'complete' | 'cancel';

type AssignmentRow = {
  id: string;
  workspace_id: string;
  assigned_to_user_id: string;
  status: RouteAssignmentStatus;
  started_at: string | null;
  completed_at: string | null;
  accepted_at?: string | null;
};

function isAction(value: unknown): value is AssignmentAction {
  return (
    value === 'accept' ||
    value === 'decline' ||
    value === 'start' ||
    value === 'complete' ||
    value === 'cancel'
  );
}

function canTransition(current: RouteAssignmentStatus, action: AssignmentAction): boolean {
  if (action === 'accept') return current === 'assigned';
  if (action === 'decline') return current === 'assigned';
  if (action === 'start') return current === 'accepted' || current === 'assigned';
  if (action === 'complete') return current === 'in_progress';
  if (action === 'cancel') {
    return current === 'assigned' || current === 'accepted' || current === 'in_progress';
  }
  return false;
}

function nextStatus(action: AssignmentAction): RouteAssignmentStatus {
  if (action === 'accept') return 'accepted';
  if (action === 'decline') return 'declined';
  if (action === 'start') return 'in_progress';
  if (action === 'complete') return 'completed';
  return 'cancelled';
}

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
      assignmentId?: unknown;
      action?: unknown;
      declineReason?: unknown;
      progress?: unknown;
    } | null;

    const assignmentId = asUuid(body?.assignmentId);
    const action = body?.action;
    const declineReason = asOptionalString(body?.declineReason);
    const progress =
      body?.progress && typeof body.progress === 'object'
        ? (body.progress as Record<string, unknown>)
        : null;

    if (!assignmentId || !isAction(action)) {
      return NextResponse.json(
        { error: 'assignmentId and valid action are required' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: assignment, error: assignmentError } = await admin
      .from('route_assignments')
      .select(
        'id, workspace_id, assigned_to_user_id, status, started_at, completed_at, accepted_at, progress'
      )
      .eq('id', assignmentId)
      .maybeSingle();

    if (assignmentError || !assignment?.id) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const row = assignment as AssignmentRow & { progress?: Record<string, unknown> | null };
    const role = await getWorkspaceRole(row.workspace_id, user.id);
    if (!role) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const actorIsAssignee = row.assigned_to_user_id === user.id;
    const actorCanManage = canManageRoutes(role);

    if (!actorIsAssignee && !actorCanManage) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if ((action === 'cancel' && !actorCanManage) || (action === 'decline' && !actorIsAssignee)) {
      return NextResponse.json({ error: 'Action not permitted for this user' }, { status: 403 });
    }

    if (!canTransition(row.status, action)) {
      return NextResponse.json(
        { error: `Cannot ${action} assignment from ${row.status}` },
        { status: 409 }
      );
    }

    const status = nextStatus(action);
    const nowIso = new Date().toISOString();
    const mergedProgress = {
      ...(row.progress ?? {}),
      ...(progress ?? {}),
    };

    const updatePayload: Record<string, unknown> = {
      status,
      progress: mergedProgress,
      updated_at: nowIso,
    };

    if (action === 'accept') {
      updatePayload.accepted_at = nowIso;
      updatePayload.declined_at = null;
      updatePayload.decline_reason = null;
    }
    if (action === 'decline') {
      updatePayload.declined_at = nowIso;
      updatePayload.decline_reason = declineReason ?? 'No reason provided';
    }
    if (action === 'start') {
      updatePayload.started_at = row.started_at ?? nowIso;
      updatePayload.accepted_at = row.accepted_at ?? nowIso;
    }
    if (action === 'complete') {
      updatePayload.completed_at = nowIso;
      updatePayload.accepted_at = row.accepted_at ?? nowIso;
      updatePayload.started_at = row.started_at ?? nowIso;
    }
    if (action === 'cancel') {
      updatePayload.completed_at = null;
      updatePayload.declined_at = null;
      updatePayload.decline_reason = null;
    }

    const { data: updated, error: updateError } = await admin
      .from('route_assignments')
      .update(updatePayload)
      .eq('id', assignmentId)
      .select(
        'id, route_plan_id, workspace_id, assigned_to_user_id, assigned_by_user_id, status, started_at, completed_at, accepted_at, declined_at, decline_reason, progress, updated_at'
      )
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ assignment: updated });
  } catch (error) {
    console.error('[api/routes/assignments/status] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
