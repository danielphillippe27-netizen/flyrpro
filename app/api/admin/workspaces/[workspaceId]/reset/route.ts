import { NextRequest, NextResponse } from 'next/server';
import type { PostgrestError } from '@supabase/supabase-js';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';

const RESET_CONFIRMATION = 'reset-workspace-data';

type DeleteSummary = {
  table: string;
  count: number;
  skipped: boolean;
};

function isIgnorableDeleteError(error: PostgrestError | null): boolean {
  if (!error) return false;

  if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST204') {
    return true;
  }

  const message = `${error.message ?? ''} ${error.details ?? ''} ${error.hint ?? ''}`.toLowerCase();
  return (
    message.includes('does not exist') ||
    message.includes('could not find the') ||
    message.includes('column') && message.includes('not found')
  );
}

async function deleteRows(
  table: string,
  runDelete: () => Promise<{ error: PostgrestError | null; count: number | null }>
): Promise<DeleteSummary> {
  const { error, count } = await runDelete();
  if (error) {
    if (isIgnorableDeleteError(error)) {
      return { table, count: 0, skipped: true };
    }
    throw new Error(`[${table}] ${error.message}`);
  }

  return {
    table,
    count: count ?? 0,
    skipped: false,
  };
}

export async function POST(
  request: NextRequest,
  contextParam: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { workspaceId } = await contextParam.params;
    const body = await request.json().catch(() => ({}));
    const confirmation =
      typeof body?.confirm === 'string' ? body.confirm.trim() : '';

    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace ID is required' }, { status: 400 });
    }

    if (confirmation !== RESET_CONFIRMATION) {
      return NextResponse.json(
        {
          error: `Confirmation required. Send { "confirm": "${RESET_CONFIRMATION}" }.`,
        },
        { status: 400 }
      );
    }

    const { data: workspace, error: workspaceError } = await auth.admin
      .from('workspaces')
      .select('id, name')
      .eq('id', workspaceId)
      .maybeSingle();

    if (workspaceError) {
      console.error('[admin/workspaces/:workspaceId/reset] workspace lookup error:', workspaceError);
      return NextResponse.json({ error: 'Failed to load workspace' }, { status: 500 });
    }

    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const { data: campaignRows, error: campaignsError } = await auth.admin
      .from('campaigns')
      .select('id')
      .eq('workspace_id', workspaceId);

    if (campaignsError) {
      console.error('[admin/workspaces/:workspaceId/reset] campaign lookup error:', campaignsError);
      return NextResponse.json({ error: 'Failed to load workspace campaigns' }, { status: 500 });
    }

    const campaignIds = (campaignRows ?? [])
      .map((row) => row.id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    const deletions: DeleteSummary[] = [];

    deletions.push(
      await deleteRows('route_assignments', () =>
        auth.admin.from('route_assignments').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );
    deletions.push(
      await deleteRows('route_plans', () =>
        auth.admin.from('route_plans').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );
    deletions.push(
      await deleteRows('field_sessions', () =>
        auth.admin.from('field_sessions').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );
    deletions.push(
      await deleteRows('activity_events', () =>
        auth.admin.from('activity_events').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );
    deletions.push(
      await deleteRows('sessions', () =>
        auth.admin.from('sessions').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );
    deletions.push(
      await deleteRows('session_events', () =>
        auth.admin.from('session_events').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );
    deletions.push(
      await deleteRows('feedback_submissions', () =>
        auth.admin.from('feedback_submissions').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );
    deletions.push(
      await deleteRows('workspace_invites', () =>
        auth.admin.from('workspace_invites').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );
    deletions.push(
      await deleteRows('crm_connections', () =>
        auth.admin.from('crm_connections').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );
    deletions.push(
      await deleteRows('contacts', () =>
        auth.admin.from('contacts').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );
    deletions.push(
      await deleteRows('field_leads', () =>
        auth.admin.from('field_leads').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );

    if (campaignIds.length > 0) {
      deletions.push(
        await deleteRows('map_buildings', () =>
          auth.admin.from('map_buildings').delete({ count: 'exact' }).in('campaign_id', campaignIds)
        )
      );
      deletions.push(
        await deleteRows('building_stats', () =>
          auth.admin.from('building_stats').delete({ count: 'exact' }).in('campaign_id', campaignIds)
        )
      );
      deletions.push(
        await deleteRows('scan_events', () =>
          auth.admin.from('scan_events').delete({ count: 'exact' }).in('campaign_id', campaignIds)
        )
      );
      deletions.push(
        await deleteRows('campaign_snapshots', () =>
          auth.admin.from('campaign_snapshots').delete({ count: 'exact' }).in('campaign_id', campaignIds)
        )
      );
      deletions.push(
        await deleteRows('campaign_qr_batches', () =>
          auth.admin.from('campaign_qr_batches').delete({ count: 'exact' }).in('campaign_id', campaignIds)
        )
      );
      deletions.push(
        await deleteRows('qr_generation_jobs', () =>
          auth.admin.from('qr_generation_jobs').delete({ count: 'exact' }).in('campaign_id', campaignIds)
        )
      );
      deletions.push(
        await deleteRows('building_touches', () =>
          auth.admin.from('building_touches').delete({ count: 'exact' }).in('campaign_id', campaignIds)
        )
      );
      deletions.push(
        await deleteRows('campaign_parcels', () =>
          auth.admin.from('campaign_parcels').delete({ count: 'exact' }).in('campaign_id', campaignIds)
        )
      );
    }

    deletions.push(
      await deleteRows('campaigns', () =>
        auth.admin.from('campaigns').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );
    deletions.push(
      await deleteRows('buildings', () =>
        auth.admin.from('buildings').delete({ count: 'exact' }).eq('workspace_id', workspaceId)
      )
    );

    return NextResponse.json({
      success: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
      },
      preserved: ['workspaces row', 'workspace_members', 'subscription/onboarding state'],
      deleted: deletions,
    });
  } catch (error) {
    console.error('[admin/workspaces/:workspaceId/reset] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
