import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';

export async function POST(request: NextRequest) {
  try {
    // Get current user
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    let requestedWorkspaceId: string | null = null;
    try {
      const body = await request.json();
      requestedWorkspaceId = body?.workspaceId ?? null;
    } catch {
      requestedWorkspaceId = null;
    }

    const workspaceResolution = await resolveWorkspaceIdForUser(supabase as any, user.id, requestedWorkspaceId);
    if (!workspaceResolution.workspaceId) {
      return NextResponse.json(
        { error: workspaceResolution.error ?? 'Workspace not found' },
        { status: workspaceResolution.status ?? 400 }
      );
    }
    const targetWorkspaceId = workspaceResolution.workspaceId;

    // Delete the connection
    const { error } = await supabase
      .from('crm_connections')
      .delete()
      .eq('workspace_id', targetWorkspaceId)
      .eq('provider', 'followupboss');

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: 'Successfully disconnected from Follow Up Boss',
    });
  } catch (error) {
    console.error('Error disconnecting from FUB:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to disconnect' },
      { status: 500 }
    );
  }
}
