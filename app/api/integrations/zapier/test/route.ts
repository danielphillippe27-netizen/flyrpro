import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getZapierWebhookUrlForWorkspace } from '../_lib/auth';
import {
  ZapierWebhookClient,
  ZapierWebhookError,
  validateZapierWebhookUrl,
} from '../_lib/client';

type TestBody = {
  workspaceId?: string | null;
  webhookUrl?: string;
  webhook_url?: string;
};

const zapierClient = new ZapierWebhookClient();

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    let body: TestBody = {};
    try {
      body = (await request.json()) as TestBody;
    } catch {
      body = {};
    }

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

    const enteredWebhookUrl =
      typeof body.webhookUrl === 'string'
        ? body.webhookUrl.trim()
        : typeof body.webhook_url === 'string'
          ? body.webhook_url.trim()
          : '';

    const storedWebhookUrl = enteredWebhookUrl
      ? null
      : await getZapierWebhookUrlForWorkspace(supabase, workspaceResolution.workspaceId);
    const webhookUrl = validateZapierWebhookUrl(enteredWebhookUrl || storedWebhookUrl || '');
    const usingStoredWebhook = !enteredWebhookUrl;
    const now = new Date().toISOString();

    const testLead = {
      id: `zapier-test-${Date.now()}`,
      name: 'FLYR Zapier Test Lead',
      email: `zapier-test-${Date.now()}@example.com`,
      phone: '(555) 123-4567',
      address: '123 Test Street',
      notes: 'Manual integration test from the FLYR settings page.',
      source: 'FLYR Zapier Test',
      createdAt: now,
    };

    try {
      await zapierClient.sendTestLead(webhookUrl, workspaceResolution.workspaceId, testLead);

      if (usingStoredWebhook) {
        await supabase
          .from('crm_connections')
          .update({
            last_tested_at: now,
            updated_at: now,
            status: 'connected',
            last_error: null,
          })
          .eq('workspace_id', workspaceResolution.workspaceId)
          .eq('provider', 'zapier');
      }

      return NextResponse.json({
        success: true,
        message: 'Test webhook sent successfully',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send Zapier test payload';

      if (usingStoredWebhook) {
        await supabase
          .from('crm_connections')
          .update({
            last_tested_at: now,
            updated_at: now,
            last_error: message,
          })
          .eq('workspace_id', workspaceResolution.workspaceId)
          .eq('provider', 'zapier');
      }

      const status =
        error instanceof ZapierWebhookError && error.status
          ? error.status
          : error instanceof ZapierWebhookError
            ? 400
            : 502;
      return NextResponse.json({ success: false, error: message }, { status });
    }
  } catch (error) {
    console.error('[zapier/test]', error);
    const status = error instanceof ZapierWebhookError && error.status ? error.status : 500;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Something went wrong' },
      { status }
    );
  }
}
