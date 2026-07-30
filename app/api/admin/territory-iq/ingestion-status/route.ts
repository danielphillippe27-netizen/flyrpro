import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFounderApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const params = request.nextUrl.searchParams;
  const datasetId = params.get('dataset_id')?.trim();
  const status = params.get('status')?.trim();
  const limit = Math.max(1, Math.min(500, Number(params.get('limit') ?? 100)));

  let query = auth.admin
    .from('territory_iq_acquisition_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (datasetId) query = query.eq('dataset_id', datasetId);
  if (status) query = query.eq('status', status);

  const [{ data, error }, catalogueCounts, marketAudits] = await Promise.all([
    query,
    auth.admin
      .from('territory_iq_dataset_catalogue')
      .select('ingestion_status,recommendation,commercial_use_status'),
    auth.admin
      .from('territory_iq_campaign_market_audits')
      .select('*')
      .order('updated_at', { ascending: false }),
  ]);
  const combinedError = error ?? catalogueCounts.error ?? marketAudits.error;
  if (combinedError) return NextResponse.json({ error: combinedError.message }, { status: 500 });

  const summary = (catalogueCounts.data ?? []).reduce<Record<string, number>>((counts, row) => {
    counts[row.ingestion_status] = (counts[row.ingestion_status] ?? 0) + 1;
    return counts;
  }, {});
  return NextResponse.json({
    summary,
    runs: data ?? [],
    campaignMarkets: marketAudits.data ?? [],
  });
}
