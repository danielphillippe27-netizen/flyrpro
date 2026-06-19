import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceMembershipForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { seedStarterCampaignForWorkspace } from '@/lib/onboarding/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedWorkspaceId =
      typeof body?.workspaceId === 'string' && body.workspaceId.trim()
        ? body.workspaceId.trim()
        : request.nextUrl.searchParams.get('workspaceId')?.trim() || null;

    const admin = createAdminClient();
    const membership = await resolveWorkspaceMembershipForUser(
      admin as unknown as MinimalSupabaseClient,
      requestUser.id,
      requestedWorkspaceId
    );

    if (!membership.workspaceId) {
      return NextResponse.json(
        { error: membership.error ?? 'Workspace not found' },
        { status: membership.status ?? 400 }
      );
    }

    if (membership.role !== 'owner' && membership.role !== 'admin') {
      return NextResponse.json(
        { error: 'Only workspace owners and admins can load replay demo data.' },
        { status: 403 }
      );
    }

    const [{ count: memberCount }, { data: workspace }] = await Promise.all([
      admin
        .from('workspace_members')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', membership.workspaceId),
      admin
        .from('workspaces')
        .select('max_seats')
        .eq('id', membership.workspaceId)
        .maybeSingle(),
    ]);

    const result = await seedStarterCampaignForWorkspace(admin, {
      workspaceId: membership.workspaceId,
      userId: requestUser.id,
      role: membership.role,
      memberCount: memberCount ?? 1,
      maxSeats: typeof workspace?.max_seats === 'number' ? workspace.max_seats : 1,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[POST /api/onboarding/demo/seed] failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load replay demo data' },
      { status: 500 }
    );
  }
}
