import { NextRequest, NextResponse } from 'next/server';
import { getDecryptedMetaToken, requireMetaUser } from '../_lib/access';
import { listAdInsights, listMetaAds, metaErrorResponse } from '../_lib/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type MetaAction = {
  action_type?: string;
  value?: string;
};

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function getLastSevenDayWindow(now = new Date()): { since: string; until: string } {
  const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - 6);
  return {
    since: formatDate(since),
    until: formatDate(until),
  };
}

function parseInteger(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDecimal(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveLeads(actions: MetaAction[] | undefined): number {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, action) => {
    const type = action.action_type?.toLowerCase() || '';
    return type.includes('lead') ? sum + parseInteger(action.value) : sum;
  }, 0);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireMetaUser(request);
    if (auth instanceof NextResponse) return auth;

    const campaignId = request.nextUrl.searchParams.get('campaignId')?.trim();
    if (!campaignId) {
      return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });
    }

    const { accessToken } = await getDecryptedMetaToken(auth.admin, auth.user.id);
    const window = getLastSevenDayWindow();
    const ads = await listMetaAds(accessToken, campaignId);

    const enrichedAds = await Promise.all(
      ads.map(async (ad) => {
        const insights = await listAdInsights(accessToken, ad.id, window);
        const metrics = insights.reduce(
          (summary, insight) => ({
            spend: summary.spend + parseDecimal(insight.spend),
            impressions: summary.impressions + parseInteger(insight.impressions),
            reach: summary.reach + parseInteger(insight.reach),
            clicks: summary.clicks + parseInteger(insight.clicks),
            leads: summary.leads + deriveLeads(insight.actions),
          }),
          {
            spend: 0,
            impressions: 0,
            reach: 0,
            clicks: 0,
            leads: 0,
          }
        );

        return {
          id: ad.id,
          name: ad.name ?? 'Untitled Meta ad',
          status: ad.status ?? null,
          effective_status: ad.effective_status ?? null,
          creative: {
            id: ad.creative?.id ?? null,
            name: ad.creative?.name ?? null,
            thumbnail_url: ad.creative?.thumbnail_url ?? null,
          },
          metrics,
        };
      })
    );

    const summary = enrichedAds.reduce(
      (totals, ad) => ({
        spend: totals.spend + ad.metrics.spend,
        impressions: totals.impressions + ad.metrics.impressions,
        reach: totals.reach + ad.metrics.reach,
        clicks: totals.clicks + ad.metrics.clicks,
        leads: totals.leads + ad.metrics.leads,
      }),
      {
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        leads: 0,
      }
    );

    return NextResponse.json({
      ads: enrichedAds,
      summary,
      window,
    });
  } catch (error) {
    const metaError = metaErrorResponse(error);
    return NextResponse.json(
      { error: metaError.message, code: metaError.code },
      { status: metaError.status }
    );
  }
}
