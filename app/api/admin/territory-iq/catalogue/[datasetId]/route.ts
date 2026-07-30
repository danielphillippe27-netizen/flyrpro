import { NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ datasetId: string }> },
) {
  const auth = await requireFounderApi();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { datasetId } = await context.params;

  const [catalogueResult, versionsResult, runsResult] = await Promise.all([
    auth.admin
      .from('territory_iq_dataset_catalogue')
      .select('*')
      .eq('dataset_id', datasetId)
      .maybeSingle(),
    auth.admin
      .from('territory_iq_source_versions')
      .select('*')
      .eq('catalogue_dataset_id', datasetId)
      .order('created_at', { ascending: false }),
    auth.admin
      .from('territory_iq_acquisition_runs')
      .select('*')
      .eq('dataset_id', datasetId)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  const error = catalogueResult.error ?? versionsResult.error ?? runsResult.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!catalogueResult.data) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 });
  }
  return NextResponse.json({
    dataset: catalogueResult.data,
    versions: versionsResult.data ?? [],
    acquisitionRuns: runsResult.data ?? [],
  });
}
