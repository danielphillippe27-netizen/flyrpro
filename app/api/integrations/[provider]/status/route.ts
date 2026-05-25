import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { getContractorProvider } from '@/app/api/integrations/_lib/contractor-providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: rawProvider } = await params;
  const provider = getContractorProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ error: 'Unsupported integration provider' }, { status: 404 });
  }

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
    .select('status, created_at, updated_at, last_tested_at, last_push_at, last_error, metadata')
    .eq('workspace_id', workspaceResolution.workspaceId)
    .eq('provider', provider.id)
    .maybeSingle();

  if (!connection) {
    return NextResponse.json({
      connected: false,
      status: 'disconnected',
      authMode: null,
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
    authMode:
      connection.metadata && typeof connection.metadata === 'object'
        ? (connection.metadata as Record<string, unknown>).authMode ?? null
        : null,
  });
}
