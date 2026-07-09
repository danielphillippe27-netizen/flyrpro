import { NextRequest, NextResponse } from 'next/server';
import {
  decorateLeadsWithMembers,
  enrichPipelineUsage,
  loadLeadActivitiesAndMatches,
  loadPipelineMembers,
  PIPELINE_LEAD_SELECT,
  resolvePipelineContext,
  type SalesPipelineLead,
} from './_lib';
import type { SalesLead } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PipelineResponse = {
  leads: SalesPipelineLead[];
  members: Awaited<ReturnType<typeof loadPipelineMembers>>;
  workspaceId: string | null;
  activities?: Awaited<ReturnType<typeof loadLeadActivitiesAndMatches>>['activities'];
  matches?: Awaited<ReturnType<typeof loadLeadActivitiesAndMatches>>['matches'];
};

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? 2000);
  if (!Number.isFinite(parsed)) return 2000;
  return Math.min(Math.max(Math.trunc(parsed), 1), 5000);
}

export async function GET(request: NextRequest) {
  const context = await resolvePipelineContext(request);
  if (context instanceof NextResponse) return context;

  const { admin, requestUser, salesperson, isFounder, workspaceId } = context;
  if (!workspaceId) {
    return NextResponse.json({
      leads: [],
      members: [],
      workspaceId: null,
    } satisfies PipelineResponse);
  }

  const leadId = request.nextUrl.searchParams.get('leadId');
  const limit = parseLimit(request.nextUrl.searchParams.get('limit'));

  try {
    let query = admin
      .from('sales_leads')
      .select(PIPELINE_LEAD_SELECT)
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (leadId) {
      query = query.eq('id', leadId);
    }

    if (salesperson?.id) {
      query = query.or(
        `assigned_user_id.eq.${requestUser.id},assigned_salesperson_id.eq.${salesperson.id},pipeline_owner_id.eq.${requestUser.id}`
      );
    } else if (!isFounder) {
      query = query.eq('pipeline_owner_id', requestUser.id);
    }

    const [leadResult, members] = await Promise.all([
      query,
      loadPipelineMembers(admin, workspaceId),
    ]);

    if (leadResult.error) throw new Error(leadResult.error.message);

    const decorated = decorateLeadsWithMembers((leadResult.data ?? []) as SalesLead[], members);
    const leads = await enrichPipelineUsage(admin, decorated);

    if (!leadId || leads.length === 0) {
      return NextResponse.json({
        leads,
        members,
        workspaceId,
      } satisfies PipelineResponse);
    }

    const { activities, matches } = await loadLeadActivitiesAndMatches({
      admin,
      leadId,
      workspaceId,
    });

    return NextResponse.json({
      leads,
      members,
      workspaceId,
      activities,
      matches,
    } satisfies PipelineResponse);
  } catch (error) {
    console.error('[api/salesperson/pipeline] GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load sales pipeline.' },
      { status: 500 }
    );
  }
}
