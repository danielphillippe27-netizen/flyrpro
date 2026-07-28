import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireFounderApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const campaignId = request.nextUrl.searchParams.get('campaign_id')?.trim();
  const status = request.nextUrl.searchParams.get('status')?.trim();
  const limit = Math.max(1, Math.min(500, Number(request.nextUrl.searchParams.get('limit') ?? 100)));
  let query = auth.admin
    .from('map_reconciliation_run_summaries')
    .select('*')
    .order('queued_at', { ascending: false })
    .limit(limit);
  if (campaignId) query = query.eq('campaign_id', campaignId);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ runs: data ?? [] });
}
