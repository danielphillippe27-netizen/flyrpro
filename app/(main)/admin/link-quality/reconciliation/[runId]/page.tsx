import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireFounder } from '@/lib/auth/requireFounder';
import { createAdminClient } from '@/lib/supabase/server';
import { ReconciliationActions, ReconciliationBatchActions } from './ReconciliationActions';

type JsonRecord = Record<string, unknown>;

function metric(record: unknown, key: string): string {
  const value = record && typeof record === 'object' ? (record as JsonRecord)[key] : null;
  return value === null || value === undefined ? '—' : String(value);
}

export default async function ReconciliationRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  await requireFounder();
  const { runId } = await params;
  const admin = createAdminClient();
  const [runResult, decisionResult] = await Promise.all([
    admin.from('map_reconciliation_run_summaries').select('*').eq('id', runId).maybeSingle(),
    admin
      .from('map_reconciliation_decisions')
      .select('*')
      .eq('run_id', runId)
      .order('score', { ascending: false }),
  ]);
  if (!runResult.data || runResult.error) notFound();
  if (decisionResult.error) throw new Error(decisionResult.error.message);
  const run = runResult.data as JsonRecord;
  const decisions = (decisionResult.data ?? []) as JsonRecord[];
  const reviewable = decisions.filter((decision) =>
    ['proposed', 'requires_review'].includes(String(decision.status))
  );
  const riskyActions = new Set(['hide_duplicate', 'hide_auxiliary', 'create_synthetic_address']);
  const safeDecisionIds = reviewable
    .filter((decision) => !riskyActions.has(String(decision.action)))
    .map((decision) => String(decision.id));
  const riskyDecisionIds = reviewable
    .filter((decision) => riskyActions.has(String(decision.action)))
    .map((decision) => String(decision.id));

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/link-quality" className="text-sm text-muted-foreground hover:underline">
            ← Campaign Link QA
          </Link>
          <h1 className="mt-2 text-2xl font-bold">{String(run.campaign_name ?? run.campaign_id)}</h1>
          <p className="mt-1 text-muted-foreground">
            {String(run.algorithm_version)} · {String(run.mode)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/api/admin/map-reconciliation/${runId}?format=csv`}>
            <Button variant="outline">Download CSV</Button>
          </Link>
          <Link href={`/api/admin/map-reconciliation/${runId}?format=json`}>
            <Button variant="outline">Download JSON</Button>
          </Link>
          <ReconciliationActions runId={runId} action="rollback_run" />
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        {[
          ['Coverage', `${metric(run.before_metrics, 'coverage_percent')} → ${metric(run.after_metrics, 'coverage_percent')}%`],
          ['Address orphans', `${metric(run.before_metrics, 'address_orphans')} → ${metric(run.after_metrics, 'address_orphans')}`],
          ['Building orphans', `${metric(run.before_metrics, 'building_orphans')} → ${metric(run.after_metrics, 'building_orphans')}`],
          ['Needs review', String(run.review_count ?? 0)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle>{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Current vs proposed map</CardTitle>
          <CardDescription>
            Parcel-group changes are shown before application; source geometry is never edited.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border p-4">
              <div className="text-sm font-semibold">Current bundle</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Coverage {metric(run.before_metrics, 'coverage_percent')}% · address orphans{' '}
                {metric(run.before_metrics, 'address_orphans')} · building orphans{' '}
                {metric(run.before_metrics, 'building_orphans')}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="text-sm font-semibold">Proposed / applied bundle</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Coverage {metric(run.after_metrics, 'coverage_percent')}% · address orphans{' '}
                {metric(run.after_metrics, 'address_orphans')} · building orphans{' '}
                {metric(run.after_metrics, 'building_orphans')}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <ReconciliationBatchActions
              runId={runId}
              decisionIds={safeDecisionIds}
              action="approve"
              label="Approve filtered safe"
            />
            <ReconciliationBatchActions
              runId={runId}
              decisionIds={riskyDecisionIds}
              action="approve"
              label="Approve filtered risky"
              risky
            />
            <ReconciliationBatchActions
              runId={runId}
              decisionIds={reviewable.map((decision) => String(decision.id))}
              action="reject"
              label="Reject filtered"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decisions</CardTitle>
          <CardDescription>
            Evidence and before/proposed state are retained for audit and exact rollback.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Score / margin</th>
                <th className="px-3 py-2">Evidence</th>
                <th className="px-3 py-2">Before → proposed</th>
                <th className="px-3 py-2">Review</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((decision) => {
                const status = String(decision.status);
                const action = String(decision.action);
                const risky = ['hide_duplicate', 'hide_auxiliary', 'create_synthetic_address'].includes(action);
                return (
                  <tr key={String(decision.id)} className="border-b align-top">
                    <td className="px-3 py-3 font-medium">{action.replaceAll('_', ' ')}</td>
                    <td className="px-3 py-3"><Badge variant="outline">{status}</Badge></td>
                    <td className="px-3 py-3 text-xs">
                      <div>address {String(decision.address_id ?? '—')}</div>
                      <div>building {String(decision.building_id ?? '—')}</div>
                    </td>
                    <td className="px-3 py-3">
                      {Number(decision.score ?? 0).toFixed(3)} / {Number(decision.runner_up_margin ?? 0).toFixed(3)}
                    </td>
                    <td className="max-w-72 px-3 py-3 text-xs">
                      {Array.isArray(decision.evidence_codes) ? decision.evidence_codes.join(', ') : '—'}
                    </td>
                    <td className="max-w-96 px-3 py-3 text-xs">
                      <div className="font-medium">
                        Group {String(decision.parent_building_id ?? decision.secondary_building_id ?? decision.building_id ?? '—')}
                      </div>
                      <div className="mt-1 break-all text-muted-foreground">
                        {JSON.stringify(decision.before_state ?? {})} → {JSON.stringify(decision.proposed_state ?? {})}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        {status === 'requires_review' || status === 'proposed' ? (
                          <>
                            <ReconciliationActions runId={runId} decisionId={String(decision.id)} action="approve" risky={risky} />
                            <ReconciliationActions runId={runId} decisionId={String(decision.id)} action="reject" />
                          </>
                        ) : null}
                        {status === 'applied' ? (
                          <ReconciliationActions runId={runId} decisionId={String(decision.id)} action="rollback" />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
