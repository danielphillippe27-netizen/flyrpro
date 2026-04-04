import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { encryptZapierWebhookUrl } from '../_lib/auth';
import {
  ZapierWebhookClient,
  ZapierWebhookError,
  validateZapierWebhookUrl,
} from '../_lib/client';

type ConnectBody = {
  workspaceId?: string | null;
  webhookUrl?: string;
  webhook_url?: string;
};

const zapierClient = new ZapierWebhookClient();

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ connected: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as ConnectBody;
    const webhookUrlInput =
      typeof body.webhookUrl === 'string'
        ? body.webhookUrl
        : typeof body.webhook_url === 'string'
          ? body.webhook_url
          : '';

    const webhookUrl = validateZapierWebhookUrl(webhookUrlInput);

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

    const testLead = {
      id: `zapier-connect-test-${Date.now()}`,
      name: 'FLYR Zapier Test Lead',
      email: `zapier-connect-${Date.now()}@example.com`,
      phone: '(555) 123-4567',
      address: '123 Test Street',
      notes: 'Connection test from FLYR while validating your Zapier webhook.',
      source: 'FLYR Zapier Connection Test',
      createdAt: new Date().toISOString(),
    };

    await zapierClient.sendTestLead(webhookUrl, workspaceResolution.workspaceId, testLead);

    const now = new Date().toISOString();
    const encrypted = encryptZapierWebhookUrl(webhookUrl);

    const { data: existingConnection } = await supabase
      .from('crm_connections')
      .select('id')
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('provider', 'zapier')
      .maybeSingle();

    if (existingConnection?.id) {
      const { error } = await supabase
        .from('crm_connections')
        .update({
          api_key_encrypted: encrypted,
          status: 'connected',
          updated_at: now,
          last_tested_at: now,
          last_error: null,
        })
        .eq('id', existingConnection.id);

      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('crm_connections')
        .insert({
          user_id: requestUser.id,
          workspace_id: workspaceResolution.workspaceId,
          provider: 'zapier',
          api_key_encrypted: encrypted,
          status: 'connected',
          last_tested_at: now,
        });

      if (error) throw error;
    }

    await supabase
      .from('user_integrations')
      .delete()
      .eq('user_id', requestUser.id)
      .eq('provider', 'zapier');

    return NextResponse.json({
      connected: true,
      message: 'Zapier connected successfully',
    });
  } catch (error) {
    console.error('[zapier/connect]', error);

    if (error instanceof ZapierWebhookError) {
      const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 400;
      return NextResponse.json({ connected: false, error: error.message }, { status });
    }

    const err = error as { message?: string; code?: string };
    let message =
      error instanceof Error ? error.message : typeof err?.message === 'string' ? err.message : 'Failed to connect Zapier';

    const isMissingTable =
      err?.code === '42P01' ||
      (typeof message === 'string' && message.includes('crm_connections') && message.includes('does not exist'));
    if (isMissingTable) {
      message =
        'Database table crm_connections is missing. In Supabase Dashboard go to SQL Editor and run the script in supabase/QUICK_FIX_crm_connections.sql, then try again.';
    }

    return NextResponse.json({ connected: false, error: message }, { status: 500 });
  }
}
