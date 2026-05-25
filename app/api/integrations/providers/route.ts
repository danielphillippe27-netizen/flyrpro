import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { getIntegrationsForIndustry, normalizeIntegrationProvider } from '@/lib/integrations/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizedProvider(provider: string | null | undefined) {
  return normalizeIntegrationProvider(provider) ?? provider ?? '';
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
  let industry: string | null = null;
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
    const { data: workspaceRow } = await admin
      .from('workspaces')
      .select('industry')
      .eq('id', workspace.workspaceId)
      .maybeSingle();
    industry = workspaceRow?.industry ?? null;
  } else {
    const { data: memberships } = await admin
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', requestUser.id);
    workspaceIds = (memberships ?? []).map((row) => row.workspace_id).filter(Boolean);
    const firstWorkspaceId = workspaceIds[0];
    if (firstWorkspaceId) {
      const { data: workspaceRow } = await admin
        .from('workspaces')
        .select('industry')
        .eq('id', firstWorkspaceId)
        .maybeSingle();
      industry = workspaceRow?.industry ?? null;
    }
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
    getIntegrationsForIndustry(industry).map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      connected: connected.has(provider.id),
    }))
  );
}
