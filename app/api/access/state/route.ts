import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveDashboardAccessLevel } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

/**
 * GET /api/access/state
 * Returns workspace role, name, and whether user has dashboard access (for subscribe page and guards).
 */
export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const access = await resolveDashboardAccessLevel(
      admin as unknown as MinimalSupabaseClient,
      requestUser.id
    );
    if (!access.workspaceId) {
      return NextResponse.json({
        userId: requestUser.id,
        role: access.role,
        workspaceId: null,
        workspace_id: null,
        workspaceName: null,
        hasAccess: access.isFounder,
        reason: 'no_workspace',
        isFounder: access.isFounder,
        accessLevel: access.level,
        memberCount: access.memberCount,
      });
    }

    const { data: workspace } = await admin
      .from('workspaces')
      .select('id, name, subscription_status, trial_ends_at, max_seats')
      .eq('id', access.workspaceId)
      .single();

    if (!workspace) {
      return NextResponse.json({
        userId: requestUser.id,
        role: access.role,
        workspaceId: access.workspaceId,
        workspace_id: access.workspaceId,
        workspaceName: null,
        hasAccess: access.isFounder,
        reason: 'no_workspace',
        isFounder: access.isFounder,
        accessLevel: access.level,
        memberCount: access.memberCount,
      });
    }

    const status = workspace.subscription_status ?? 'inactive';
    const trialEnd = workspace.trial_ends_at
      ? new Date(workspace.trial_ends_at)
      : null;
    const subscriptionAccess =
      status === 'active' ||
      (status === 'trialing' && (!trialEnd || trialEnd > new Date()));
    const hasAccess = subscriptionAccess || access.isFounder;

    return NextResponse.json({
      userId: requestUser.id,
      role: access.role,
      workspaceId: workspace.id,
      workspace_id: workspace.id,
      workspaceName: workspace.name,
      maxSeats: workspace.max_seats ?? 1,
      hasAccess,
      isFounder: access.isFounder,
      accessLevel: access.level,
      memberCount: access.memberCount,
      reason:
        access.level === 'member' && !hasAccess
          ? 'member-inactive'
          : undefined,
    });
  } catch (e) {
    console.error('Access state error:', e);
    return NextResponse.json(
      { error: 'Failed to get access state' },
      { status: 500 }
    );
  }
}
