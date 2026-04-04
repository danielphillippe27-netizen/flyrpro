import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getBoldTrailTokenForWorkspace } from '../_lib/auth';
import { BoldTrailAPIClient, BoldTrailTokenValidator } from '../_lib/client';

type TestBody = {
  workspaceId?: string | null;
  apiToken?: string;
  api_token?: string;
};

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

    const enteredToken =
      typeof body.apiToken === 'string'
        ? body.apiToken.trim()
        : typeof body.api_token === 'string'
          ? body.api_token.trim()
          : '';

    const storedToken = enteredToken
      ? null
      : await getBoldTrailTokenForWorkspace(supabase, workspaceResolution.workspaceId);
    const tokenToTest = enteredToken || storedToken || '';
    const usingStoredToken = !enteredToken;

    if (!tokenToTest) {
      return NextResponse.json(
        { success: false, error: 'BoldTrail is not connected' },
        { status: 404 }
      );
    }

    const validator = new BoldTrailTokenValidator(new BoldTrailAPIClient());
    const now = new Date().toISOString();

    try {
      const validation = await validator.validate(tokenToTest);

      if (usingStoredToken) {
        await supabase
          .from('crm_connections')
          .update({
            last_tested_at: now,
            updated_at: now,
            status: 'connected',
            last_error: null,
          })
          .eq('workspace_id', workspaceResolution.workspaceId)
          .eq('provider', 'boldtrail');
      }

      return NextResponse.json({
        success: true,
        message: 'Connection successful',
        account: {
          name: validation.accountName ?? null,
          email: validation.userEmail ?? null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to connect to BoldTrail';

      if (usingStoredToken) {
        await supabase
          .from('crm_connections')
          .update({
            last_tested_at: now,
            updated_at: now,
            last_error: message,
          })
          .eq('workspace_id', workspaceResolution.workspaceId)
          .eq('provider', 'boldtrail');
      }

      const status = /invalid token/i.test(message) ? 401 : 502;
      return NextResponse.json({ success: false, error: message }, { status });
    }
  } catch (error) {
    console.error('[boldtrail/test]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Something went wrong' },
      { status: 500 }
    );
  }
}
