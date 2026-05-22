import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SessionStatsRow = {
  doors_hit?: number | null;
  leads_created?: number | null;
};

function toNumber(value: unknown) {
  return Number(value) || 0;
}

function isMissingRelation(error: { message?: string; details?: string | null }, relation: string) {
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return text.includes(relation.toLowerCase()) && (text.includes('does not exist') || text.includes('not find'));
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();
  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim() || null;
  const workspace = await resolveWorkspaceIdForUser(
    supabase as unknown as MinimalSupabaseClient,
    requestUser.id,
    requestedWorkspaceId
  );
  if (requestedWorkspaceId && !workspace.workspaceId) {
    return NextResponse.json(
      { error: workspace.error ?? 'Workspace not found' },
      { status: workspace.status ?? 400 }
    );
  }

  let sessionsQuery = supabase
    .from('sessions')
    .select('doors_hit, leads_created')
    .eq('user_id', requestUser.id);
  if (workspace.workspaceId) sessionsQuery = sessionsQuery.eq('workspace_id', workspace.workspaceId);
  const sessionsRes = await sessionsQuery;

  if (sessionsRes.error) {
    return NextResponse.json({ error: sessionsRes.error.message }, { status: 500 });
  }

  let appointmentQuery = supabase
    .from('crm_events')
    .select('id')
    .eq('user_id', requestUser.id)
    .not('fub_appointment_id', 'is', null);
  if (workspace.workspaceId) appointmentQuery = appointmentQuery.eq('workspace_id', workspace.workspaceId);
  const appointmentRes = await appointmentQuery;

  if (appointmentRes.error && !isMissingRelation(appointmentRes.error, 'crm_events')) {
    return NextResponse.json({ error: appointmentRes.error.message }, { status: 500 });
  }

  const totals = ((sessionsRes.data ?? []) as SessionStatsRow[]).reduce(
    (acc, session) => {
      acc.knocks += toNumber(session.doors_hit);
      acc.leads += toNumber(session.leads_created);
      return acc;
    },
    { knocks: 0, leads: 0, distanceMeters: 0 }
  );

  return NextResponse.json({
    knocks: totals.knocks,
    leads: totals.leads,
    appointments: appointmentRes.error ? 0 : appointmentRes.data?.length ?? 0,
    distanceMeters: totals.distanceMeters,
  });
}
