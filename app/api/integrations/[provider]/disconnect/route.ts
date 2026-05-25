import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import {
  getContractorDisplayName,
  getContractorProvider,
} from '@/app/api/integrations/_lib/contractor-providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DisconnectBody = {
  workspaceId?: string | null;
};

export async function POST(
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

  const body = (await request.json().catch(() => ({}))) as DisconnectBody;
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
    .eq('provider', provider.id);

  await supabase
    .from('user_integrations')
    .delete()
    .eq('user_id', requestUser.id)
    .eq('provider', provider.id);

  return NextResponse.json({
    disconnected: true,
    message: `${getContractorDisplayName(provider.id)} disconnected successfully`,
  });
}
