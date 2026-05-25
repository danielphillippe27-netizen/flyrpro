import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import {
  encryptContractorSecret,
  getContractorDisplayName,
  getContractorProvider,
  testContractorConnection,
} from '@/app/api/integrations/_lib/contractor-providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ConnectBody = {
  workspaceId?: string | null;
  apiKey?: string;
  api_key?: string;
  token?: string;
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider: rawProvider } = await params;
  const provider = getContractorProvider(rawProvider);
  if (!provider) {
    return NextResponse.json({ connected: false, error: 'Unsupported integration provider' }, { status: 404 });
  }

  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ connected: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as ConnectBody;
  const apiKey = (
    typeof body.apiKey === 'string'
      ? body.apiKey
      : typeof body.api_key === 'string'
        ? body.api_key
        : typeof body.token === 'string'
          ? body.token
          : ''
  ).trim();

  if (!apiKey) {
    return NextResponse.json(
      { connected: false, error: `${getContractorDisplayName(provider.id)} API key is required` },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const workspaceResolution = await resolveWorkspaceIdForUser(
    supabase as unknown as MinimalSupabaseClient,
    requestUser.id,
    body.workspaceId ?? null
  );
  if (!workspaceResolution.workspaceId) {
    return NextResponse.json(
      { connected: false, error: workspaceResolution.error ?? 'Workspace not found' },
      { status: workspaceResolution.status ?? 400 }
    );
  }

  try {
    await testContractorConnection(provider.id, { mode: 'api_key', token: apiKey });
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error: error instanceof Error ? error.message : `${getContractorDisplayName(provider.id)} connection failed`,
      },
      { status: 502 }
    );
  }

  const now = new Date().toISOString();
  const encrypted = encryptContractorSecret(apiKey);
  const { data: existing } = await supabase
    .from('crm_connections')
    .select('id')
    .eq('workspace_id', workspaceResolution.workspaceId)
    .eq('provider', provider.id)
    .maybeSingle();

  const payload = {
    user_id: requestUser.id,
    workspace_id: workspaceResolution.workspaceId,
    provider: provider.id,
    api_key_encrypted: encrypted,
    status: 'connected',
    last_tested_at: now,
    last_error: null,
    updated_at: now,
    metadata: {
      authMode: 'api_key',
    },
  };

  const { error } = existing?.id
    ? await supabase.from('crm_connections').update(payload).eq('id', existing.id)
    : await supabase.from('crm_connections').insert(payload);

  if (error) {
    return NextResponse.json({ connected: false, error: error.message }, { status: 500 });
  }

  await supabase
    .from('user_integrations')
    .delete()
    .eq('user_id', requestUser.id)
    .eq('provider', provider.id);

  return NextResponse.json({
    connected: true,
    message: `${getContractorDisplayName(provider.id)} connected successfully`,
  });
}
