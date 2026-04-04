import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { encryptBoldTrailToken } from '../_lib/auth';
import { BoldTrailAPIClient, BoldTrailTokenValidator } from '../_lib/client';

type ConnectBody = {
  workspaceId?: string | null;
  apiToken?: string;
  api_token?: string;
};

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ connected: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as ConnectBody;
    const apiToken =
      typeof body.apiToken === 'string'
        ? body.apiToken.trim()
        : typeof body.api_token === 'string'
          ? body.api_token.trim()
          : '';

    if (!apiToken) {
      return NextResponse.json(
        { connected: false, error: 'API token is required' },
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

    const validator = new BoldTrailTokenValidator(new BoldTrailAPIClient());
    let accountName: string | null = null;
    let userEmail: string | null = null;

    try {
      const validation = await validator.validate(apiToken);
      accountName = validation.accountName ?? null;
      userEmail = validation.userEmail ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to connect to BoldTrail';
      const status = /invalid token/i.test(message) ? 401 : 502;
      return NextResponse.json({ connected: false, error: message }, { status });
    }

    const now = new Date().toISOString();
    const encrypted = encryptBoldTrailToken(apiToken);

    const { data: existingConnection } = await supabase
      .from('crm_connections')
      .select('id')
      .eq('workspace_id', workspaceResolution.workspaceId)
      .eq('provider', 'boldtrail')
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
          provider: 'boldtrail',
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
      .eq('provider', 'boldtrail');

    return NextResponse.json({
      connected: true,
      message: 'Successfully connected to BoldTrail',
      account: {
        name: accountName,
        email: userEmail,
      },
    });
  } catch (error) {
    console.error('[boldtrail/connect]', error);
    const err = error as { message?: string; code?: string };
    let message =
      error instanceof Error ? error.message : typeof err?.message === 'string' ? err.message : 'Failed to connect';

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
