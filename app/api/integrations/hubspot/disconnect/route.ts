import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

type DisconnectBody = {
  workspaceId?: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: DisconnectBody = {};
    try {
      body = (await request.json()) as DisconnectBody;
    } catch {
      body = {};
    }

    const supabase = createAdminClient();
    const workspaceResolution = await resolveWorkspaceIdForUser(
      supabase as unknown as MinimalSupabaseClient,
      requestUser.id,
      body.workspaceId ?? null
    );

    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }

    await supabase
      .from('crm_connections')
      .delete()
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('provider', 'hubspot');

    await supabase
      .from('user_integrations')
      .delete()
      .eq('user_id', requestUser.id)
      .eq('provider', 'hubspot');

    return NextResponse.json({
      disconnected: true,
      message: 'HubSpot disconnected successfully',
    });
  } catch (error) {
    console.error('[hubspot/disconnect]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to disconnect HubSpot' },
      { status: 500 }
    );
  }
}
