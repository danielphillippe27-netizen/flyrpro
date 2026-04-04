import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getZapierWebhookUrlForWorkspace } from '../_lib/auth';
import { ZapierWebhookClient, ZapierWebhookError, type ZapierLeadPayload } from '../_lib/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PushLeadBody = ZapierLeadPayload & {
  campaignId?: string | null;
  campaign_id?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  workspaceId?: string | null;
  workspace_id?: string | null;
};

const zapierClient = new ZapierWebhookClient();

function cleaned(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLead(body: PushLeadBody): ZapierLeadPayload {
  return {
    id: cleaned(body.id),
    name: cleaned(body.name),
    phone: cleaned(body.phone),
    email: cleaned(body.email),
    address: cleaned(body.address),
    source: cleaned(body.source) || 'FLYR',
    notes: cleaned(body.notes),
    campaignId: cleaned(body.campaignId) ?? cleaned(body.campaign_id),
    createdAt: cleaned(body.createdAt) ?? cleaned(body.created_at),
  };
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as PushLeadBody | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid request body' }, { status: 400 });
    }

    const lead = normalizeLead(body);
    if (!lead.id && !lead.email && !lead.phone && !lead.name) {
      return NextResponse.json(
        { success: false, error: 'Lead must include at least one identifier for Zapier sync.' },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const workspaceResolution = await resolveWorkspaceIdForUser(
      supabase as unknown as MinimalSupabaseClient,
      requestUser.id,
      body.workspaceId ?? body.workspace_id ?? null
    );

    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { success: false, error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }

    const webhookUrl = await getZapierWebhookUrlForWorkspace(supabase, workspaceResolution.workspaceId);
    if (!webhookUrl) {
      return NextResponse.json(
        { success: false, error: 'Zapier is not connected' },
        { status: 404 }
      );
    }

    await zapierClient.sendLead(webhookUrl, workspaceResolution.workspaceId, lead);
    await supabase
      .from('crm_connections')
      .update({
        last_push_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'connected',
        last_error: null,
      })
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('provider', 'zapier');

    return NextResponse.json({
      success: true,
      message: 'Lead sent to Zapier',
    });
  } catch (error) {
    console.error('[zapier/push-lead]', error);
    const status =
      error instanceof ZapierWebhookError && error.status
        ? error.status
        : error instanceof ZapierWebhookError
          ? 400
          : 500;
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Zapier sync failed',
      },
      { status }
    );
  }
}
