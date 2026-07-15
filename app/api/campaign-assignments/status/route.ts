import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { asUuid, getWorkspaceRole } from '@/app/api/routes/_lib';
import { createAdminClient } from '@/lib/supabase/server';

type AssignmentAction = 'accept' | 'decline';

type AssignmentRow = {
  id: string;
  campaign_id: string;
  workspace_id: string;
  assigned_to_user_id: string;
  assigned_by_user_id: string;
  status: string;
};

function isAction(value: unknown): value is AssignmentAction {
  return value === 'accept' || value === 'decline';
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      assignmentId?: unknown;
      action?: unknown;
    } | null;
    const assignmentId = asUuid(body?.assignmentId);
    const action = body?.action;
    if (!assignmentId || !isAction(action)) {
      return NextResponse.json(
        { error: 'assignmentId and an accept or decline action are required' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('campaign_assignments')
      .select('id, campaign_id, workspace_id, assigned_to_user_id, assigned_by_user_id, status')
      .eq('id', assignmentId)
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
    }

    const assignment = data as AssignmentRow;
    const role = await getWorkspaceRole(assignment.workspace_id, requestUser.id);
    if (!role || assignment.assigned_to_user_id !== requestUser.id) {
      return NextResponse.json({ error: 'Only the assignee can respond' }, { status: 403 });
    }
    if (assignment.status !== 'assigned') {
      return NextResponse.json(
        { error: `This assignment has already been ${assignment.status}` },
        { status: 409 }
      );
    }

    const nextStatus = action === 'accept' ? 'accepted' : 'declined';
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from('campaign_assignments')
      .update({ status: nextStatus, updated_at: now })
      .eq('id', assignment.id)
      .eq('status', 'assigned')
      .select('id, campaign_id, workspace_id, assigned_to_user_id, assigned_by_user_id, mode, goal_homes, zone_index, status, due_at, notes, created_at, updated_at')
      .maybeSingle();
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ error: 'Assignment was already answered' }, { status: 409 });
    }

    // The assignment notification is the actionable inbox item. Once answered,
    // mark it read so clients no longer offer Accept/Decline for stale work.
    await admin
      .from('notifications')
      .update({ read_at: now })
      .eq('workspace_id', assignment.workspace_id)
      .eq('user_id', requestUser.id)
      .eq('type', 'campaign_assigned')
      .contains('data', { assignmentId: assignment.id });

    const [{ data: campaign }, { data: profile }] = await Promise.all([
      admin.from('campaigns').select('name').eq('id', assignment.campaign_id).maybeSingle(),
      admin.from('profiles').select('full_name, email').eq('id', requestUser.id).maybeSingle(),
    ]);
    const campaignName =
      (campaign as { name?: string | null } | null)?.name?.trim() || 'Campaign';
    const assigneeName =
      (profile as { full_name?: string | null } | null)?.full_name?.trim() ||
      requestUser.email?.split('@')[0] ||
      'A team member';

    const { error: notificationError } = await admin.from('notifications').insert({
      workspace_id: assignment.workspace_id,
      user_id: assignment.assigned_by_user_id,
      type: action === 'accept' ? 'campaign_assignment_accepted' : 'campaign_assignment_declined',
      title: action === 'accept' ? 'Assignment accepted' : 'Assignment declined',
      body:
        action === 'accept'
          ? `${assigneeName} accepted ${campaignName}.`
          : `${assigneeName} declined ${campaignName}.`,
      data: {
        campaignId: assignment.campaign_id,
        assignmentId: assignment.id,
        assigneeUserId: requestUser.id,
        response: nextStatus,
        label: action === 'accept' ? 'Accepted' : 'Declined',
        link: `/campaigns/${assignment.campaign_id}`,
      },
    });

    return NextResponse.json({
      assignment: updated,
      warning: notificationError
        ? `Assignment updated, but the team lead notification failed: ${notificationError.message}`
        : null,
    });
  } catch (error) {
    console.error('[api/campaign-assignments/status] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
