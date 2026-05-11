import { NextRequest, NextResponse } from 'next/server';
import { getMetaConnectionForUser, requireAuthorizedFarm } from '@/app/api/meta/_lib/access';
import { metaErrorResponse } from '@/app/api/meta/_lib/client';
import { syncMetaCampaignLinks } from '@/app/api/meta/_lib/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ farmId: string }> }
) {
  try {
    const { farmId } = await context.params;
    const authorized = await requireAuthorizedFarm(request, farmId);
    if (authorized instanceof NextResponse) return authorized;

    const connection = await getMetaConnectionForUser(authorized.admin, authorized.user.id);
    if (!connection) {
      return NextResponse.json(
        { error: 'Connect Meta Ads first.', code: 'not_connected' },
        { status: 401 }
      );
    }
    const { data: links, error: linksError } = await authorized.admin
      .from('farm_meta_campaign_links')
      .select('id, farm_id, user_id, team_id, meta_connection_id, meta_campaign_id, meta_campaign_name')
      .eq('farm_id', authorized.farm.id)
      .eq('status', 'active')
      .eq('meta_connection_id', connection.id);

    if (linksError) throw new Error(linksError.message);

    const linkRows = (links ?? []) as Array<{
      id: string;
      farm_id: string;
      user_id: string;
      team_id?: string | null;
      meta_connection_id: string | null;
      meta_campaign_id: string;
      meta_campaign_name?: string | null;
    }>;

    if (linkRows.length === 0) {
      return NextResponse.json(
        { error: 'No active Meta campaign links are available for your Meta connection.' },
        { status: 400 }
      );
    }

    const result = await syncMetaCampaignLinks(authorized.admin, linkRows);

    return NextResponse.json({
      synced: true,
      synced_from: result.syncedFrom,
      synced_to: result.syncedTo,
      synced_rows: result.rowsSynced,
      campaigns: result.results.map((item) => ({
        link_id: item.linkId,
        meta_campaign_id: item.metaCampaignId,
        rows: item.rowsSynced,
        ok: item.ok,
        error: item.error,
      })),
    });
  } catch (error) {
    const metaError = metaErrorResponse(error);
    return NextResponse.json(
      { error: metaError.message, code: metaError.code },
      { status: metaError.status }
    );
  }
}
