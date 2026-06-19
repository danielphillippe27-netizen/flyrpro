import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveDashboardAccessLevel,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { getDemoStateForUser, patchDemoStateForUser } from '@/lib/onboarding/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveDemoContext(request: NextRequest, userId: string) {
  const admin = createAdminClient();
  const requestedWorkspaceId =
    request.nextUrl.searchParams.get('workspaceId')?.trim() || null;
  const access = await resolveDashboardAccessLevel(
    admin as unknown as MinimalSupabaseClient,
    userId,
    requestedWorkspaceId
  );

  if (!access.workspaceId) {
    return {
      admin,
      error: NextResponse.json(
        { error: access.error ?? 'Workspace not found' },
        { status: access.status ?? 400 }
      ),
    };
  }

  const { data: workspace } = await admin
    .from('workspaces')
    .select('max_seats')
    .eq('id', access.workspaceId)
    .maybeSingle();

  return {
    admin,
    access,
    workspaceId: access.workspaceId,
    role: access.role,
    memberCount: access.memberCount,
    maxSeats: typeof workspace?.max_seats === 'number' ? workspace.max_seats : 1,
  };
}

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const context = await resolveDemoContext(request, requestUser.id);
    if ('error' in context && context.error) return context.error;

    const state = await getDemoStateForUser(context.admin, {
      workspaceId: context.workspaceId,
      userId: requestUser.id,
      role: context.role,
      accessLevel: context.access.level,
      memberCount: context.memberCount,
      maxSeats: context.maxSeats,
    });

    return NextResponse.json({ state });
  } catch (error) {
    console.error('[GET /api/onboarding/demo/state] failed:', error);
    return NextResponse.json(
      { error: 'Failed to load demo checklist state' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const context = await resolveDemoContext(request, requestUser.id);
    if ('error' in context && context.error) return context.error;

    const body = await request.json().catch(() => ({}));
    const completedItems =
      body?.completedItems && typeof body.completedItems === 'object' && !Array.isArray(body.completedItems)
        ? body.completedItems as Record<string, boolean>
        : undefined;
    const dismissedAt =
      body?.dismissed === true
        ? new Date().toISOString()
        : body?.dismissedAt === null
          ? null
          : typeof body?.dismissedAt === 'string'
            ? body.dismissedAt
            : undefined;

    const state = await patchDemoStateForUser(context.admin, {
      workspaceId: context.workspaceId,
      userId: requestUser.id,
      role: context.role,
      accessLevel: context.access.level,
      memberCount: context.memberCount,
      maxSeats: context.maxSeats,
      completedItems,
      dismissedAt,
    });

    return NextResponse.json({ state });
  } catch (error) {
    console.error('[PATCH /api/onboarding/demo/state] failed:', error);
    return NextResponse.json(
      { error: 'Failed to update demo checklist state' },
      { status: 500 }
    );
  }
}
