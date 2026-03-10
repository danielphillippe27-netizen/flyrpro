import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getFubAuthForUserWorkspace } from '../_lib/auth';

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const userId = requestUser.id;
    const supabase = createAdminClient();

    let requestedWorkspaceId: string | null = null;
    try {
      const body = await request.json();
      requestedWorkspaceId = body?.workspaceId ?? null;
    } catch {
      requestedWorkspaceId = null;
    }

    const workspaceResolution = await resolveWorkspaceIdForUser(
      supabase as unknown as MinimalSupabaseClient,
      userId,
      requestedWorkspaceId
    );
    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }
    const targetWorkspaceId = workspaceResolution.workspaceId;

    const fubAuth = await getFubAuthForUserWorkspace(supabase, userId, targetWorkspaceId);
    if (!fubAuth) {
      return NextResponse.json(
        { error: 'Follow Up Boss not connected. Please connect your account first.' },
        { status: 404 }
      );
    }

    // Create a test lead
    const testLead = {
      source: 'FLYR',
      system: 'FLYR',
      type: 'General Inquiry',
      message: '🧪 Test lead from FLYR Integration - This is a test to verify your connection is working',
      person: {
        firstName: 'Test',
        lastName: 'Lead',
        emails: [{ value: `test-${Date.now()}@flyr.test` }],
        phones: [{ value: '(555) 123-4567' }],
      },
      metadata: {
        testLead: true,
        sentAt: new Date().toISOString(),
        source: 'FLYR Integration Test',
      },
    };

    // Push to Follow Up Boss
    const fubResponse = await fetch('https://api.followupboss.com/v1/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...fubAuth.headers,
      },
      body: JSON.stringify(testLead),
    });

    if (!fubResponse.ok) {
      const errorData = await fubResponse.text();
      console.error('FUB test push error:', errorData);
      
      // Update connection with error
      await supabase
        .from('crm_connections')
        .update({
          status: 'error',
          last_error: `Test push failed: ${fubResponse.status}`,
        })
        .eq('workspace_id', targetWorkspaceId)
        .eq('provider', 'followupboss');

      return NextResponse.json(
        { error: `Failed to push test lead: ${fubResponse.status}` },
        { status: 502 }
      );
    }

    const result = await fubResponse.json();

    // Update last_push_at timestamp
    await supabase
      .from('crm_connections')
      .update({
        last_push_at: new Date().toISOString(),
        status: 'connected',
        last_error: null,
      })
      .eq('workspace_id', targetWorkspaceId)
      .eq('provider', 'followupboss');

    return NextResponse.json({
      success: true,
      message: 'Test lead successfully pushed to Follow Up Boss! Check your FUB account to see it.',
      fubEventId: result.id,
      testLead: {
        name: 'Test Lead',
        email: testLead.person.emails[0].value,
      },
    });
  } catch (error) {
    console.error('Error pushing test lead to FUB:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to push test lead' },
      { status: 500 }
    );
  }
}
