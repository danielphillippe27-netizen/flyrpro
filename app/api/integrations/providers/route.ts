import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const providers = [
  { id: 'followupboss', displayName: 'Follow Up Boss' },
  { id: 'boldtrail', displayName: 'BoldTrail / kvCORE' },
  { id: 'hubspot', displayName: 'HubSpot' },
  { id: 'monday', displayName: 'monday.com' },
  { id: 'zapier', displayName: 'Zapier' },
];

function normalizedProvider(provider: string | null | undefined) {
  if (provider === 'fub') return 'followupboss';
  if (provider === 'kvcore') return 'boldtrail';
  return provider ?? '';
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim() || null;
  const { data: legacyIntegrations } = await admin
    .from('user_integrations')
    .select('provider')
    .eq('user_id', requestUser.id);

  let workspaceIds: string[] = [];
  if (requestedWorkspaceId) {
    const workspace = await resolveWorkspaceIdForUser(
      admin as unknown as MinimalSupabaseClient,
      requestUser.id,
      requestedWorkspaceId
    );
    if (!workspace.workspaceId) {
      return NextResponse.json(
        { error: workspace.error ?? 'Workspace not found' },
        { status: workspace.status ?? 400 }
      );
    }
    workspaceIds = [workspace.workspaceId];
  } else {
    const { data: memberships } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', requestUser.id);
    workspaceIds = (memberships ?? []).map((row) => row.workspace_id).filter(Boolean);
  }

  const { data: crmConnections } = workspaceIds.length > 0
    ? await admin
        .from('crm_connections')
        .select('provider, status')
        .in('workspace_id', workspaceIds)
        .eq('status', 'connected')
    : { data: [] };

  const connected = new Set([
    ...(legacyIntegrations ?? []).map((row) => normalizedProvider(row.provider)),
    ...(crmConnections ?? []).map((row) => normalizedProvider(row.provider)),
  ]);

  return NextResponse.json(
    providers.map((provider) => ({
      ...provider,
      connected: connected.has(provider.id),
    }))
  );
}
