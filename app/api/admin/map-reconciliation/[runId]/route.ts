import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import { CampaignMapReconciliationService } from '@/lib/services/CampaignMapReconciliationService';
import { prebuildCampaignMapBundle } from '@/lib/services/CampaignMapBundlePrebuilder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type JsonRecord = Record<string, unknown>;

function csvCell(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function decisionsCsv(rows: JsonRecord[]): string {
  const columns = [
    'id', 'action', 'status', 'address_id', 'building_id', 'secondary_building_id',
    'score', 'runner_up_margin', 'evidence_codes', 'address_identity',
    'split_signature', 'reviewed_by', 'review_reason', 'created_at',
  ];
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const auth = await requireFounderApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { runId } = await params;
  const [runResult, decisionResult] = await Promise.all([
    auth.admin.from('map_reconciliation_run_summaries').select('*').eq('id', runId).maybeSingle(),
    auth.admin
      .from('map_reconciliation_decisions')
      .select('*')
      .eq('run_id', runId)
      .order('score', { ascending: false })
      .order('created_at', { ascending: true }),
  ]);
  if (runResult.error || !runResult.data) {
    return NextResponse.json({ error: runResult.error?.message ?? 'Run not found' }, { status: 404 });
  }
  if (decisionResult.error) {
    return NextResponse.json({ error: decisionResult.error.message }, { status: 500 });
  }
  const decisions = (decisionResult.data ?? []) as JsonRecord[];
  if (request.nextUrl.searchParams.get('format') === 'csv') {
    return new Response(decisionsCsv(decisions), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="map-reconciliation-${runId}.csv"`,
      },
    });
  }
  if (request.nextUrl.searchParams.get('format') === 'json') {
    return new Response(JSON.stringify({ run: runResult.data, decisions }, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="map-reconciliation-${runId}.json"`,
      },
    });
  }
  return NextResponse.json({ run: runResult.data, decisions });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const auth = await requireFounderApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { runId } = await params;
  const body = await request.json().catch(() => null) as JsonRecord | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const action = String(body.action ?? '');
  const service = new CampaignMapReconciliationService(auth.admin);

  try {
    if (action === 'rollback_run') {
      if (body.confirm !== true) {
        return NextResponse.json({ error: 'confirm=true is required' }, { status: 400 });
      }
      return NextResponse.json(await service.rollbackRun(
        runId,
        auth.user.id,
        typeof body.reason === 'string' ? body.reason : undefined
      ));
    }

    const decisionIds = Array.isArray(body.decision_ids)
      ? body.decision_ids.map(String)
      : body.decision_id ? [String(body.decision_id)] : [];
    if (decisionIds.length === 0) {
      return NextResponse.json({ error: 'decision_id or decision_ids is required' }, { status: 400 });
    }
    const { data: decisions, error } = await auth.admin
      .from('map_reconciliation_decisions')
      .select('id, action, campaign_id')
      .eq('run_id', runId)
      .in('id', decisionIds);
    if (error || (decisions ?? []).length !== decisionIds.length) {
      return NextResponse.json({ error: error?.message ?? 'Decision not found in run' }, { status: 404 });
    }
    const risky = (decisions ?? []).some((decision) =>
      ['hide_duplicate', 'hide_auxiliary', 'create_synthetic_address'].includes(decision.action)
    );
    if (action === 'approve' && risky && body.confirm !== true) {
      return NextResponse.json({
        error: 'confirm=true is required for footprint hides and synthetic addresses',
      }, { status: 400 });
    }

    const results: JsonRecord[] = [];
    for (const decisionId of decisionIds) {
      if (action === 'approve' || action === 'reject') {
        results.push(await service.reviewDecision(
          decisionId,
          auth.user.id,
          action,
          typeof body.reason === 'string' ? body.reason : undefined,
          false
        ));
      } else if (action === 'rollback') {
        results.push(await service.rollbackDecision(
          decisionId,
          auth.user.id,
          typeof body.reason === 'string' ? body.reason : undefined
        ));
      } else {
        return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
      }
    }
    if (action === 'approve') {
      const campaignId = String(decisions?.[0]?.campaign_id ?? '');
      if (campaignId) {
        await prebuildCampaignMapBundle(auth.admin, campaignId, undefined, {
          forceRebuild: true,
        });
      }
    }
    return NextResponse.json({ run_id: runId, results });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Review action failed',
    }, { status: 409 });
  }
}
