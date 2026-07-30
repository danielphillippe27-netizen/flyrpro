import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFounderApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const params = request.nextUrl.searchParams;
  const limit = Math.max(1, Math.min(500, Number(params.get('limit') ?? 100)));
  const offset = Math.max(0, Number(params.get('offset') ?? 0));
  const search = params.get('q')?.trim();
  const recommendation = params.get('recommendation')?.trim();
  const commercialUse = params.get('commercial_use')?.trim();
  const ingestionStatus = params.get('ingestion_status')?.trim();
  const category = params.get('category')?.trim();
  const industry = params.get('industry')?.trim();

  let query = auth.admin
    .from('territory_iq_dataset_catalogue')
    .select('*', { count: 'exact' })
    .order('rank_score', { ascending: false })
    .order('dataset_name')
    .range(offset, offset + limit - 1);

  if (search) {
    const safe = search.replace(/[,%()]/g, ' ').trim();
    if (safe) query = query.or(`dataset_name.ilike.%${safe}%,official_publisher.ilike.%${safe}%,coverage_name.ilike.%${safe}%`);
  }
  if (recommendation) query = query.eq('recommendation', recommendation);
  if (commercialUse) query = query.eq('commercial_use_status', commercialUse);
  if (ingestionStatus) query = query.eq('ingestion_status', ingestionStatus);
  if (category) query = query.contains('categories', [category]);
  if (industry) query = query.contains('applicable_industries', [industry]);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    datasets: data ?? [],
    pagination: { offset, limit, total: count ?? 0 },
  });
}
