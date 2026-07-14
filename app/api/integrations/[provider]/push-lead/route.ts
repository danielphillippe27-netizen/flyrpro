import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import {
  getContractorAuthForWorkspace,
  getContractorDisplayName,
  getContractorProvider,
  pushContractorLead,
  type ContractorLeadPayload,
} from '@/app/api/integrations/_lib/contractor-providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PushBody = ContractorLeadPayload & {
  workspaceId?: string | null;
  lead?: ContractorLeadPayload;
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

  const body = (await request.json().catch(() => ({}))) as PushBody;
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

  const auth = await getContractorAuthForWorkspace(
    supabase,
    requestUser.id,
    workspaceResolution.workspaceId,
    provider.id
  );
  if (!auth) {
    return NextResponse.json(
      { success: false, error: `${getContractorDisplayName(provider.id)} is not connected` },
      { status: 404 }
    );
  }

  const lead = body.lead ?? body;
  try {
    const result = await pushContractorLead(provider.id, auth, {
      id: lead.id ?? `manual-${Date.now()}`,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      address: lead.address,
      notes: lead.notes,
      source: lead.source ?? 'WolfGrid',
      campaignId: lead.campaignId,
      createdAt: lead.createdAt,
    });

    await supabase
      .from('crm_connections')
      .update({
        last_push_at: new Date().toISOString(),
        status: 'connected',
        last_error: null,
      })
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('provider', provider.id);

    return NextResponse.json({
      success: true,
      message: `Lead pushed to ${getContractorDisplayName(provider.id)}`,
      remoteObjectId: result.remoteObjectId,
      remoteObjectType: result.remoteObjectType,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : `${getContractorDisplayName(provider.id)} push failed`;
    await supabase
      .from('crm_connections')
      .update({
        updated_at: new Date().toISOString(),
        last_error: message,
      })
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('provider', provider.id);

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
