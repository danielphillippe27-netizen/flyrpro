import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { asUuid, canManageRoutes, getWorkspaceRole } from '@/app/api/routes/_lib';

type AssignmentRow = {
  id: string;
  campaign_id: string;
  workspace_id: string;
  assigned_to_user_id: string;
  assigned_by_user_id: string;
  mode: 'zone_split' | 'whole_team';
  goal_homes: number;
  zone_index: number | null;
  status: string;
  due_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type CampaignRow = {
  id: string;
  name: string | null;
  status: string | null;
};

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const workspaceId = asUuid(request.nextUrl.searchParams.get('workspaceId'));
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
    }

    const role = await getWorkspaceRole(workspaceId, requestUser.id);
    if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const admin = createAdminClient();
    let query = admin
      .from('campaign_assignments')
      .select('id, campaign_id, workspace_id, assigned_to_user_id, assigned_by_user_id, mode, goal_homes, zone_index, status, due_at, notes, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .in('status', ['assigned', 'in_progress'])
      .order('updated_at', { ascending: false })
      .limit(300);

    if (!canManageRoutes(role)) {
      query = query.eq('assigned_to_user_id', requestUser.id);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const assignments = (data ?? []) as AssignmentRow[];
    const campaignIds = Array.from(new Set(assignments.map((row) => row.campaign_id)));
    let campaignById = new Map<string, CampaignRow>();
    if (campaignIds.length > 0) {
      const { data: campaigns, error: campaignError } = await admin
        .from('campaigns')
        .select('id, name, status')
        .in('id', campaignIds);
      if (campaignError) {
        return NextResponse.json({ error: campaignError.message }, { status: 500 });
      }
      campaignById = new Map(((campaigns ?? []) as CampaignRow[]).map((row) => [row.id, row]));
    }

    return NextResponse.json({
      assignments: assignments.map((assignment) => ({
        ...assignment,
        campaign: campaignById.get(assignment.campaign_id) ?? null,
      })),
      role,
    });
  } catch (error) {
    console.error('[api/campaign-assignments] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
