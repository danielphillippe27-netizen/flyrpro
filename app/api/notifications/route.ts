import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { asUuid, getWorkspaceRole } from '@/app/api/routes/_lib';
import { createAdminClient } from '@/lib/supabase/server';

type NotificationRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

function asPositiveLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.min(Math.floor(parsed), 100);
}

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const workspaceId = asUuid(request.nextUrl.searchParams.get('workspaceId'));
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
    }

    const role = await getWorkspaceRole(workspaceId, requestUser.id);
    if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const limit = asPositiveLimit(request.nextUrl.searchParams.get('limit'));
    const admin = createAdminClient();
    const [notificationsResult, unreadCountResult] = await Promise.all([
      admin
        .from('notifications')
        .select('id, workspace_id, user_id, type, title, body, data, read_at, created_at')
        .eq('workspace_id', workspaceId)
        .eq('user_id', requestUser.id)
        .order('created_at', { ascending: false })
        .limit(limit),
      admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('user_id', requestUser.id)
        .is('read_at', null),
    ]);

    if (notificationsResult.error) {
      return NextResponse.json({ error: notificationsResult.error.message }, { status: 500 });
    }
    if (unreadCountResult.error) {
      return NextResponse.json({ error: unreadCountResult.error.message }, { status: 500 });
    }

    return NextResponse.json({
      notifications: (notificationsResult.data ?? []) as NotificationRow[],
      unreadCount: unreadCountResult.count ?? 0,
    });
  } catch (error) {
    console.error('[api/notifications] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      workspaceId?: unknown;
      notificationId?: unknown;
      markAllRead?: unknown;
    } | null;
    const workspaceId = asUuid(body?.workspaceId);
    const notificationId = asUuid(body?.notificationId);
    const markAllRead = body?.markAllRead === true;

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
    }
    if (!markAllRead && !notificationId) {
      return NextResponse.json({ error: 'notificationId or markAllRead is required' }, { status: 400 });
    }

    const role = await getWorkspaceRole(workspaceId, requestUser.id);
    if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const admin = createAdminClient();
    let query = admin
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('user_id', requestUser.id)
      .is('read_at', null);

    if (!markAllRead && notificationId) {
      query = query.eq('id', notificationId);
    }

    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/notifications] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
