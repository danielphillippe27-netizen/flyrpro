import { NextRequest, NextResponse } from 'next/server';
import { getDecryptedMetaToken } from '@/app/api/meta/_lib/access';
import { requireAuthorizedFarm } from '@/app/api/meta/_lib/access';
import { normalizeMetaAdAccountId } from '@/app/api/meta/_lib/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MetricRow = {
  farm_meta_campaign_link_id: string;
  date: string;
  spend: number | string | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  leads: number | null;
};

function summarizeMetrics(metrics: MetricRow[]) {
  return metrics.reduce(
    (summary, metric) => ({
      spend: summary.spend + Number(metric.spend || 0),
      impressions: summary.impressions + Number(metric.impressions || 0),
      reach: summary.reach + Number(metric.reach || 0),
      clicks: summary.clicks + Number(metric.clicks || 0),
      leads: summary.leads + Number(metric.leads || 0),
      last_synced_date:
        !summary.last_synced_date || metric.date > summary.last_synced_date
          ? metric.date
          : summary.last_synced_date,
    }),
    {
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      leads: 0,
      last_synced_date: null as string | null,
    }
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ farmId: string }> }
) {
  try {
    const { farmId } = await context.params;
    const authorized = await requireAuthorizedFarm(request, farmId);
    if (authorized instanceof NextResponse) return authorized;

    const { data: links, error: linksError } = await authorized.admin
      .from('farm_meta_campaign_links')
      .select('*')
      .eq('farm_id', authorized.farm.id)
      .neq('status', 'unlinked')
      .order('linked_at', { ascending: false });

    if (linksError) throw new Error(linksError.message);

    const linkRows = (links ?? []) as Array<{
      id: string;
      farm_id: string;
      user_id: string;
      team_id?: string | null;
      meta_connection_id?: string | null;
      meta_ad_account_id: string;
      meta_campaign_id: string;
      meta_campaign_name?: string | null;
      status?: string | null;
      linked_at?: string | null;
      last_synced_at?: string | null;
    }>;

    const linkIds = linkRows.map((link) => link.id);
    let metricRows: MetricRow[] = [];
    if (linkIds.length > 0) {
      const { data: metrics, error: metricsError } = await authorized.admin
        .from('farm_meta_ad_daily_metrics')
        .select('farm_meta_campaign_link_id, date, spend, impressions, reach, clicks, leads')
        .eq('farm_id', authorized.farm.id)
        .in('farm_meta_campaign_link_id', linkIds);

      if (metricsError) throw new Error(metricsError.message);
      metricRows = (metrics ?? []) as MetricRow[];
    }

    const metricsByLink = new Map<string, MetricRow[]>();
    for (const metric of metricRows) {
      const rows = metricsByLink.get(metric.farm_meta_campaign_link_id) ?? [];
      rows.push(metric);
      metricsByLink.set(metric.farm_meta_campaign_link_id, rows);
    }

    const enrichedLinks = linkRows.map((link) => ({
      ...link,
      metrics_summary: summarizeMetrics(metricsByLink.get(link.id) ?? []),
    }));

    const summary = summarizeMetrics(metricRows);
    if (!summary.last_synced_date) {
      summary.last_synced_date =
        linkRows
          .map((link) => link.last_synced_at)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? null;
    }

    return NextResponse.json({
      links: enrichedLinks,
      summary,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load Meta campaign links.' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ farmId: string }> }
) {
  try {
    const { farmId } = await context.params;
    const authorized = await requireAuthorizedFarm(request, farmId);
    if (authorized instanceof NextResponse) return authorized;

    const body = await request.json().catch(() => null) as {
      meta_ad_account_id?: string;
      meta_campaign_id?: string;
      meta_campaign_name?: string;
    } | null;

    const metaAdAccountId = normalizeMetaAdAccountId(body?.meta_ad_account_id || '');
    const metaCampaignId = body?.meta_campaign_id?.trim();
    const metaCampaignName = body?.meta_campaign_name?.trim() || null;

    if (!metaAdAccountId || !metaCampaignId) {
      return NextResponse.json(
        { error: 'meta_ad_account_id and meta_campaign_id are required' },
        { status: 400 }
      );
    }

    const { connection } = await getDecryptedMetaToken(authorized.admin, authorized.user.id);

    const { data: account } = await authorized.admin
      .from('meta_ad_accounts')
      .select('id')
      .eq('user_id', authorized.user.id)
      .eq('meta_ad_account_id', metaAdAccountId)
      .maybeSingle();

    if (!account?.id) {
      return NextResponse.json(
        { error: 'Select a Meta ad account before linking a campaign.' },
        { status: 400 }
      );
    }

    // TODO(ads_management): reuse this link as the read model for future campaign creation.
    // TODO(meta-objectives): map Meta campaign objectives to FLYR farm campaign types.
    // TODO(special-ad-category): handle housing/real-estate special ad category rules before any write scopes.
    const { data: link, error } = await authorized.admin
      .from('farm_meta_campaign_links')
      .upsert(
        {
          farm_id: authorized.farm.id,
          user_id: authorized.user.id,
          team_id: authorized.farm.workspace_id ?? connection.team_id ?? null,
          meta_connection_id: connection.id,
          meta_ad_account_id: metaAdAccountId,
          meta_campaign_id: metaCampaignId,
          meta_campaign_name: metaCampaignName,
          status: 'active',
          linked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'farm_id,meta_campaign_id' }
      )
      .select('*')
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({ link });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to link Meta campaign.' },
      { status: 500 }
    );
  }
}
