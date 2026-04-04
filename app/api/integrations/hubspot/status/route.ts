import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const workspaceResolution = await resolveWorkspaceIdForUser(
      supabase as unknown as MinimalSupabaseClient,
      requestUser.id,
      request.nextUrl.searchParams.get('workspaceId')
    );

    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }

    const { data: connection } = await supabase
      .from('crm_connections')
      .select('status, created_at, updated_at, last_tested_at, last_push_at, last_error')
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('provider', 'hubspot')
      .maybeSingle();

    if (!connection) {
      return NextResponse.json({
        connected: false,
        status: 'disconnected',
      });
    }

    return NextResponse.json({
      connected: connection.status === 'connected',
      status: connection.status,
      createdAt: connection.created_at,
      updatedAt: connection.updated_at,
      lastTestedAt: connection.last_tested_at,
      lastPushAt: connection.last_push_at,
      lastError: connection.last_error,
    });
  } catch (error) {
    console.error('[hubspot/status]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get status' },
      { status: 500 }
    );
  }
}
