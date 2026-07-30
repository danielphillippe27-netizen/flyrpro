import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { requireFounder } from '@/lib/auth/requireFounder';
import { createAdminClient } from '@/lib/supabase/server';

type LinkQualityRow = {
  campaign_id: string;
  name: string | null;
  workspace_id: string | null;
  owner_id: string | null;
  provision_status: string | null;
  parcel_enrichment_status: string | null;
  parcel_source_id: string | null;
  parcel_count: number | null;
  link_quality_status: 'unknown' | 'healthy' | 'degraded' | 'repairing' | 'failed' | null;
  link_quality_score: number | null;
  link_quality_reason: string | null;
  link_quality_checked_at: string | null;
  total_addresses: number | null;
  total_links: number | null;
  open_orphans: number | null;
  suspect_links: number | null;
  parcel_bridge_links: number | null;
  coverage_percent: number | string | null;
  orphan_rate_percent: number | string | null;
  suspect_rate_percent: number | string | null;
  parcel_bridge_usage_percent: number | string | null;
};

type SortKey = 'degraded' | 'orphan' | 'suspect' | 'parcel_bridge';

type ReconciliationRun = {
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  mode: string;
  status: string;
  algorithm_version: string;
  before_metrics: Record<string, unknown> | null;
  after_metrics: Record<string, unknown> | null;
  decision_count: number | string;
  applied_count: number | string;
  review_count: number | string;
  rollback_count: number | string;
  rejected_count: number | string;
  synthetic_suggestion_count: number | string;
  synthetic_applied_count: number | string;
  queued_at: string | null;
  completed_at: string | null;
};

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'degraded', label: 'Degraded first' },
  { key: 'orphan', label: 'Orphan rate' },
  { key: 'suspect', label: 'Suspect rate' },
  { key: 'parcel_bridge', label: 'Parcel bridge' },
];

function asNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatPercent(value: number | string | null | undefined): string {
  return `${asNumber(value).toFixed(2)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

function getStatusVariant(status: LinkQualityRow['link_quality_status']): 'default' | 'destructive' | 'secondary' | 'outline' {
  switch (status) {
    case 'healthy':
      return 'default';
    case 'degraded':
    case 'failed':
      return 'destructive';
    case 'repairing':
      return 'secondary';
    default:
      return 'outline';
  }
}

function sortRows(rows: LinkQualityRow[], sort: SortKey): LinkQualityRow[] {
  const copy = [...rows];

  switch (sort) {
    case 'orphan':
      copy.sort((a, b) => asNumber(b.orphan_rate_percent) - asNumber(a.orphan_rate_percent));
      return copy;
    case 'suspect':
      copy.sort((a, b) => asNumber(b.suspect_rate_percent) - asNumber(a.suspect_rate_percent));
      return copy;
    case 'parcel_bridge':
      copy.sort((a, b) => asNumber(b.parcel_bridge_usage_percent) - asNumber(a.parcel_bridge_usage_percent));
      return copy;
    case 'degraded':
    default: {
      const priority = (status: LinkQualityRow['link_quality_status']) => {
        switch (status) {
          case 'failed':
            return 0;
          case 'degraded':
            return 1;
          case 'repairing':
            return 2;
          case 'unknown':
            return 3;
          case 'healthy':
          default:
            return 4;
        }
      };

      copy.sort((a, b) => {
        const byStatus = priority(a.link_quality_status) - priority(b.link_quality_status);
        if (byStatus !== 0) return byStatus;
        return asNumber(a.link_quality_score) - asNumber(b.link_quality_score);
      });
      return copy;
    }
  }
}

export default async function AdminLinkQualityPage({
  searchParams,
}: {
  searchParams?: Promise<{ sort?: string }>;
}) {
  await requireFounder();
  const resolvedSearchParams = await searchParams;
  const sort = SORT_OPTIONS.some((option) => option.key === resolvedSearchParams?.sort)
    ? (resolvedSearchParams?.sort as SortKey)
    : 'degraded';

  const admin = createAdminClient();
  const [{ data, error }, reconciliationResult] = await Promise.all([
    admin
      .from('campaign_link_quality_dashboard')
      .select('*')
      .limit(500),
    admin
      .from('map_reconciliation_run_summaries')
      .select('*')
      .order('queued_at', { ascending: false })
      .limit(100),
  ]);

  if (error) {
    throw new Error(`Failed to load link quality dashboard: ${error.message}`);
  }

  const rows = sortRows((data ?? []) as LinkQualityRow[], sort);
  const degradedCount = rows.filter((row) => row.link_quality_status === 'degraded' || row.link_quality_status === 'failed').length;
  const repairingCount = rows.filter((row) => row.link_quality_status === 'repairing').length;
  const reconciliationRuns = (reconciliationResult.data ?? []) as ReconciliationRun[];
  const reconciliationReviewCount = reconciliationRuns.reduce(
    (sum, run) => sum + asNumber(run.review_count),
    0
  );
  const coverageTrend = reconciliationRuns.length > 0
    ? reconciliationRuns.reduce(
        (sum, run) =>
          sum +
          asNumber(run.after_metrics?.coverage_percent) -
          asNumber(run.before_metrics?.coverage_percent),
        0
      ) / reconciliationRuns.length
    : 0;
  const orphanReduction = reconciliationRuns.reduce(
    (sum, run) =>
      sum +
      asNumber(run.before_metrics?.address_orphans) -
      asNumber(run.after_metrics?.address_orphans),
    0
  );
  const syntheticSuggestions = reconciliationRuns.reduce(
    (sum, run) => sum + asNumber(run.synthetic_suggestion_count),
    0
  );
  const syntheticApplied = reconciliationRuns.reduce(
    (sum, run) => sum + asNumber(run.synthetic_applied_count),
    0
  );
  const rejectedSuggestions = reconciliationRuns.reduce(
    (sum, run) => sum + asNumber(run.rejected_count),
    0
  );
  const rollbackCount = reconciliationRuns.reduce(
    (sum, run) => sum + asNumber(run.rollback_count),
    0
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Campaign Link QA</h1>
          <p className="mt-1 text-muted-foreground">
            Internal view of campaign link quality, orphan pressure, suspect matches, and parcel bridge usage.
          </p>
        </div>
        <Link href="/admin">
          <Button variant="outline">Back to founder dashboard</Button>
        </Link>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Campaigns loaded</CardDescription>
            <CardTitle>{rows.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Degraded or failed</CardDescription>
            <CardTitle>{degradedCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Repairing</CardDescription>
            <CardTitle>{repairingCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Reconciliation review</CardDescription>
            <CardTitle>{reconciliationReviewCount}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-3 md:grid-cols-5">
        {[
          ['Average coverage lift', `${coverageTrend.toFixed(2)} pts`],
          ['Address orphans removed', String(orphanReduction)],
          [
            'Synthetic acceptance',
            syntheticSuggestions > 0
              ? `${((syntheticApplied / syntheticSuggestions) * 100).toFixed(1)}%`
              : '—',
          ],
          ['Rejected suggestions', String(rejectedSuggestions)],
          ['Rollbacks', String(rollbackCount)],
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
          <CardTitle>Map reconciliation runs</CardTitle>
          <CardDescription>
            Shadow and applied runs, with reversible decisions and downloadable evidence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reconciliationRuns.length === 0 ? (
            <div className="text-sm text-muted-foreground">No reconciliation runs yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Campaign</th>
                    <th className="px-3 py-2 font-medium">Mode / status</th>
                    <th className="px-3 py-2 font-medium">Decisions</th>
                    <th className="px-3 py-2 font-medium">Applied</th>
                    <th className="px-3 py-2 font-medium">Review</th>
                    <th className="px-3 py-2 font-medium">Coverage</th>
                    <th className="px-3 py-2 font-medium">Queued</th>
                  </tr>
                </thead>
                <tbody>
                  {reconciliationRuns.map((run) => (
                    <tr key={run.id} className="border-b">
                      <td className="px-3 py-3 font-medium">
                        <Link href={`/admin/link-quality/reconciliation/${run.id}`} className="hover:underline">
                          {run.campaign_name || run.campaign_id}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={run.status === 'failed' ? 'destructive' : 'outline'}>
                          {run.mode} · {run.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">{asNumber(run.decision_count)}</td>
                      <td className="px-3 py-3">{asNumber(run.applied_count)}</td>
                      <td className="px-3 py-3">{asNumber(run.review_count)}</td>
                      <td className="px-3 py-3">
                        {asNumber(run.before_metrics?.coverage_percent)}% →{' '}
                        {asNumber(run.after_metrics?.coverage_percent)}%
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {formatDate(run.queued_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3">
          <div>
            <CardTitle>Sort</CardTitle>
            <CardDescription>Use the view metrics to bubble up campaigns that need attention first.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {SORT_OPTIONS.map((option) => (
              <Link key={option.key} href={`/admin/link-quality?sort=${option.key}`}>
                <Button variant={sort === option.key ? 'default' : 'outline'} size="sm">
                  {option.label}
                </Button>
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No campaigns found in the link quality view yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Campaign</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Score</th>
                    <th className="px-3 py-2 font-medium">Coverage</th>
                    <th className="px-3 py-2 font-medium">Orphan rate</th>
                    <th className="px-3 py-2 font-medium">Suspect rate</th>
                    <th className="px-3 py-2 font-medium">Parcel bridge</th>
                    <th className="px-3 py-2 font-medium">Parcels</th>
                    <th className="px-3 py-2 font-medium">Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.campaign_id} className="border-b align-top">
                      <td className="px-3 py-3">
                        <div className="font-medium">
                          <Link href={`/campaigns/${row.campaign_id}`} className="hover:underline">
                            {row.name || row.campaign_id}
                          </Link>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {row.link_quality_reason || 'No reason recorded'}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-2">
                          <Badge variant={getStatusVariant(row.link_quality_status)}>
                            {row.link_quality_status || 'unknown'}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            provision {row.provision_status || 'unknown'} / parcels {row.parcel_enrichment_status || 'unknown'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">{asNumber(row.link_quality_score)}</td>
                      <td className="px-3 py-3">
                        <div>{formatPercent(row.coverage_percent)}</div>
                        <div className="text-xs text-muted-foreground">
                          {asNumber(row.total_links)} / {asNumber(row.total_addresses)} linked
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div>{formatPercent(row.orphan_rate_percent)}</div>
                        <div className="text-xs text-muted-foreground">
                          {asNumber(row.open_orphans)} open
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div>{formatPercent(row.suspect_rate_percent)}</div>
                        <div className="text-xs text-muted-foreground">
                          {asNumber(row.suspect_links)} suspect
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div>{formatPercent(row.parcel_bridge_usage_percent)}</div>
                        <div className="text-xs text-muted-foreground">
                          {asNumber(row.parcel_bridge_links)} parcel-linked
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div>{row.parcel_source_id || 'none'}</div>
                        <div className="text-xs text-muted-foreground">
                          {asNumber(row.parcel_count)} parcels
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{formatDate(row.link_quality_checked_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
