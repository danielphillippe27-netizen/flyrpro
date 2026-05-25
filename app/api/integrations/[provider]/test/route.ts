import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import {
  getContractorAuthForWorkspace,
  getContractorDisplayName,
  getContractorProvider,
  testContractorConnection,
  type ContractorAuth,
} from '@/app/api/integrations/_lib/contractor-providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type TestBody = {
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
    return NextResponse.json({ success: false, error: 'Unsupported integration provider' }, { status: 404 });
  }

  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as TestBody;
  const enteredToken = (
    typeof body.apiKey === 'string'
      ? body.apiKey
      : typeof body.api_key === 'string'
        ? body.api_key
        : typeof body.token === 'string'
          ? body.token
          : ''
  ).trim();

  const supabase = createAdminClient();
  const workspaceResolution = await resolveWorkspaceIdForUser(
    supabase as unknown as MinimalSupabaseClient,
    requestUser.id,
    body.workspaceId ?? null
  );
  if (!workspaceResolution.workspaceId) {
    return NextResponse.json(
      { success: false, error: workspaceResolution.error ?? 'Workspace not found' },
      { status: workspaceResolution.status ?? 400 }
    );
  }

  const storedAuth = enteredToken
    ? null
    : await getContractorAuthForWorkspace(
        supabase,
        requestUser.id,
        workspaceResolution.workspaceId,
        provider.id
      );
  const auth: ContractorAuth | null = enteredToken
    ? { mode: 'api_key', token: enteredToken }
    : storedAuth;

  if (!auth?.token) {
    return NextResponse.json(
      { success: false, error: `${getContractorDisplayName(provider.id)} is not connected` },
      { status: 404 }
    );
  }

  const now = new Date().toISOString();
  try {
    await testContractorConnection(provider.id, auth);

    if (!enteredToken) {
      await supabase
        .from('crm_connections')
        .update({
          status: 'connected',
          last_tested_at: now,
          updated_at: now,
          last_error: null,
        })
        .eq('workspace_id', workspaceResolution.workspaceId)
        .eq('provider', provider.id);
    }

    return NextResponse.json({
      success: true,
      message: `${getContractorDisplayName(provider.id)} connection successful`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : `${getContractorDisplayName(provider.id)} connection failed`;
    if (!enteredToken) {
      await supabase
        .from('crm_connections')
        .update({
          last_tested_at: now,
          updated_at: now,
          last_error: message,
        })
        .eq('workspace_id', workspaceResolution.workspaceId)
        .eq('provider', provider.id);
    }
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
