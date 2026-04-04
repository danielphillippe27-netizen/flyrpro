import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getHubSpotAuthForUserWorkspace } from '../_lib/auth';

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

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
      requestUser.id,
      requestedWorkspaceId
    );

    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { success: false, error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }

    const hubSpotAuth = await getHubSpotAuthForUserWorkspace(supabase, requestUser.id);
    if (!hubSpotAuth) {
      return NextResponse.json(
        { success: false, error: 'HubSpot is not connected' },
        { status: 404 }
      );
    }

    const now = new Date().toISOString();

    const testResponse = await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1&properties=email', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...hubSpotAuth.headers,
      },
    });

    if (!testResponse.ok) {
      await supabase
        .from('crm_connections')
        .update({
          status: 'error',
          last_tested_at: now,
          last_error: `API test failed: ${testResponse.status}`,
        })
        .eq('workspace_id', workspaceResolution.workspaceId)
        .eq('provider', 'hubspot');

      return NextResponse.json(
        { error: 'API test failed. Please reconnect your account.' },
        { status: 400 }
      );
    }

    await supabase
      .from('crm_connections')
      .update({
        status: 'connected',
        last_tested_at: now,
        last_error: null,
      })
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('provider', 'hubspot');

    return NextResponse.json({
      success: true,
      message: 'Connection is working properly',
    });
  } catch (error) {
    console.error('[hubspot/test]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Something went wrong' },
      { status: 500 }
    );
  }
}
