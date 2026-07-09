import { NextRequest, NextResponse } from 'next/server';
import {
  parseActivityBody,
  PIPELINE_LEAD_SELECT,
  resolvePipelineContext,
} from '../../_lib';
import type { SalespersonLeadActivity, SalesLead } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadAccessibleLead(
  context: Exclude<Awaited<ReturnType<typeof resolvePipelineContext>>, NextResponse>,
  leadId: string
): Promise<SalesLead | null> {
  const { admin, requestUser, salesperson, isFounder, workspaceId } = context;
  if (!workspaceId) return null;

  let query = admin
    .from('sales_leads')
    .select(PIPELINE_LEAD_SELECT)
    .eq('workspace_id', workspaceId)
    .eq('id', leadId)
    .limit(1);

  if (salesperson?.id) {
    query = query.or(
      `assigned_user_id.eq.${requestUser.id},assigned_salesperson_id.eq.${salesperson.id},pipeline_owner_id.eq.${requestUser.id}`
    );
  } else if (!isFounder) {
    query = query.eq('pipeline_owner_id', requestUser.id);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SalesLead | null) ?? null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leadId: string }> }
) {
  const { leadId } = await params;
  const context = await resolvePipelineContext(request);
  if (context instanceof NextResponse) return context;

  try {
    const lead = await loadAccessibleLead(context, leadId);
    if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const activity = parseActivityBody(body);

    const { data, error } = await context.admin
      .from('sales_activities')
      .insert({
        sales_lead_id: lead.id,
        workspace_id: lead.workspace_id,
        actor_user_id: context.requestUser.id,
        activity_type: activity.activity_type,
        note: activity.body ? `${activity.title}\n\n${activity.body}` : activity.title,
        occurred_at: new Date().toISOString(),
        metadata: {
          ...activity.metadata,
          title: activity.title,
          body: activity.body ?? null,
          legacySalespersonId: lead.assigned_salesperson_id ?? context.salesperson?.id ?? null,
        },
      })
      .select('*')
      .single();

    if (error) throw new Error(error.message);

    await context.admin
      .from('sales_leads')
      .update({
        last_touch_at: new Date().toISOString(),
        last_touch_summary: activity.title,
      })
      .eq('id', lead.id)
      .eq('workspace_id', lead.workspace_id);

    return NextResponse.json({
      activity: {
        id: String((data as { id?: unknown }).id ?? ''),
        lead_id: lead.id,
        workspace_id: lead.workspace_id,
        actor_user_id: context.requestUser.id,
        salesperson_id: lead.assigned_salesperson_id ?? context.salesperson?.id ?? null,
        activity_type: activity.activity_type,
        title: activity.title,
        body: activity.body ?? null,
        metadata: activity.metadata,
        created_at: String((data as { occurred_at?: unknown; created_at?: unknown }).occurred_at ?? (data as { created_at?: unknown }).created_at ?? new Date().toISOString()),
      } satisfies SalespersonLeadActivity,
    });
  } catch (error) {
    console.error('[api/salesperson/pipeline activities] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add pipeline activity.' },
      { status: 500 }
    );
  }
}
