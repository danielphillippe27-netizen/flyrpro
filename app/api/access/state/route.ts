import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

/**
 * GET /api/access/state
 * Returns workspace role, name, and whether user has dashboard access (for subscribe page and guards).
 */
export async function GET() {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: memberships } = await supabase
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (!memberships?.length) {
      return NextResponse.json({
        role: null,
        workspaceName: null,
        hasAccess: false,
        reason: 'no_workspace',
      });
    }

    const primary = memberships[0];
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('id, name, subscription_status, trial_ends_at, max_seats')
      .eq('id', primary.workspace_id)
      .single();

    if (!workspace) {
      return NextResponse.json({
        role: primary.role,
        workspaceName: null,
        hasAccess: false,
        reason: 'no_workspace',
      });
    }

    const status = workspace.subscription_status ?? 'inactive';
    const trialEnd = workspace.trial_ends_at
      ? new Date(workspace.trial_ends_at)
      : null;
    const hasAccess =
      status === 'active' ||
      (status === 'trialing' && (!trialEnd || trialEnd > new Date()));

    return NextResponse.json({
      role: primary.role,
      workspaceName: workspace.name,
      maxSeats: workspace.max_seats ?? 1,
      hasAccess,
      reason:
        (primary.role === 'member' || primary.role === 'admin') && !hasAccess
          ? 'member-inactive'
          : undefined,
    });
  } catch (e) {
    console.error('Access state error:', e);
    return NextResponse.json(
      { error: 'Failed to get access state' },
      { status: 500 }
    );
  }
}
