import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getFubAuthForUserWorkspace } from '../_lib/auth';

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const userId = requestUser.id;
    const supabase = createAdminClient();

    let requestedWorkspaceId: string | null = null;
    try {
      const body = await request.json();
      requestedWorkspaceId = body?.workspaceId ?? null;
    } catch {
      requestedWorkspaceId = null;
    }

    const workspaceResolution = await resolveWorkspaceIdForUser(
      supabase as unknown as MinimalSupabaseClient,
      userId,
      requestedWorkspaceId
    );
    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }
    const targetWorkspaceId = workspaceResolution.workspaceId;

    const fubAuth = await getFubAuthForUserWorkspace(supabase, userId, targetWorkspaceId);
    if (!fubAuth) {
      return NextResponse.json(
        { error: 'No connection found' },
        { status: 404 }
      );
    }
    
    const testResponse = await fetch('https://api.followupboss.com/v1/users', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...fubAuth.headers,
      },
    });

    if (!testResponse.ok) {
      // Update status to error
      await supabase
        .from('crm_connections')
        .update({
          status: 'error',
          last_tested_at: new Date().toISOString(),
          last_error: `API test failed: ${testResponse.status}`,
        })
        .eq('workspace_id', targetWorkspaceId)
        .eq('provider', 'followupboss');

      return NextResponse.json(
        { error: 'API test failed. Please reconnect your account.' },
        { status: 400 }
      );
    }

    // Update last tested timestamp
    await supabase
      .from('crm_connections')
      .update({
        status: 'connected',
        last_tested_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('workspace_id', targetWorkspaceId)
      .eq('provider', 'followupboss');

    return NextResponse.json({
      success: true,
      message: 'Connection is working properly',
    });
  } catch (error) {
    console.error('Error testing FUB connection:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to test connection' },
      { status: 500 }
    );
  }
}
