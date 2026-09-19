import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { cardScope, CardError } from '@/lib/cards/server';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import { addCardEvent, emptyCardEngagement, cardActivityCounter } from '@/lib/cards/campaign-engagement';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const workspaceId = z.uuid().parse(request.nextUrl.searchParams.get('workspaceId'));
    const campaignId = z.uuid().parse(request.nextUrl.searchParams.get('campaignId'));
    const { client, user } = await cardScope(request, workspaceId);
    if (!await ensureCampaignAccess(client, campaignId, user.id)) throw new CardError('Campaign unavailable', 403);
    const rows = new Map<string, ReturnType<typeof emptyCardEngagement>>();
    const activity = cardActivityCounter();
    // Paginate both streams; a busy campaign can exceed PostgREST's row limit.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from('card_shares').select('id,address_id')
        .eq('workspace_id', workspaceId).eq('campaign_id', campaignId)
        .is('parent_share_id', null).not('address_id', 'is', null)
        .order('id').range(offset, offset + 499);
      if (error) throw error;
      for (const share of data ?? []) {
        const row = rows.get(share.address_id) ?? emptyCardEngagement(share.address_id);
        row.shares++;
        rows.set(share.address_id, row);
      }
      if ((data?.length ?? 0) < 500) break;
    }
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client.from('card_events')
        .select('id,share_id,visit_id,event_type,card_shares!inner(address_id)')
        .eq('card_shares.workspace_id', workspaceId).eq('card_shares.campaign_id', campaignId)
        .is('card_shares.parent_share_id', null).not('card_shares.address_id', 'is', null)
        .order('id').range(offset, offset + 499);
      if (error) throw error;
      for (const event of data ?? []) {
        activity.add(event);
        const share = event.card_shares as unknown as { address_id: string };
        const row = rows.get(share.address_id) ?? emptyCardEngagement(share.address_id);
        addCardEvent(row, event.event_type);
        rows.set(share.address_id, row);
      }
      if ((data?.length ?? 0) < 500) break;
    }
    return NextResponse.json({ engagement: [...rows.values()], totals: activity.totals() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof CardError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: status === 500 ? 'Unable to load business-card activity' : error instanceof Error ? error.message : 'Invalid request' }, { status });
  }
}
