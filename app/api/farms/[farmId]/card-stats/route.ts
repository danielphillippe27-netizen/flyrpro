import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';
import { selectFarmCampaignRow, resolveBackingCampaignId, userCanAccessFarm } from '@/app/api/farms/_utils/backingCampaign';
import { cardScope, CardError } from '@/lib/cards/server';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, context: { params: Promise<{ farmId: string }> }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) throw new CardError('Sign in to continue', 401);
    const farmId = z.uuid().parse((await context.params).farmId);
    const admin = createAdminClient();
    const { farm } = await selectFarmCampaignRow(admin, farmId);
    if (!farm) throw new CardError('Farm unavailable', 404);
    if (!await userCanAccessFarm(admin, user.id, farm)) throw new CardError('Farm unavailable', 403);
    if (!farm.workspace_id) throw new CardError('Farm workspace unavailable', 409);
    const { client } = await cardScope(request, farm.workspace_id);
    const campaignId = (farm.linked_campaign_id ?? await resolveBackingCampaignId(client, farm, false));
    const shares = new Set<string>();
    // Include farm contacts as well as legacy linked-campaign shares. Deduplicate
    // shares that qualify through both paths; exclude forwarded referral cards.
    for (const scope of ['contacts', 'campaign'] as const) {
      if (scope === 'campaign' && !campaignId) continue;
      for (let offset = 0; ; offset += 500) {
        let query = scope === 'contacts'
          ? client.from('card_shares').select('id,contacts!inner(farm_id)')
          : client.from('card_shares').select('id');
        query = query.eq('workspace_id', farm.workspace_id).is('parent_share_id', null);
        query = scope === 'contacts' ? query.eq('contacts.farm_id', farm.id) : query.eq('campaign_id', campaignId!);
        const { data, error } = await query.order('id').range(offset, offset + 499);
        if (error) throw error;
        for (const row of data ?? []) shares.add(row.id);
        if ((data?.length ?? 0) < 500) break;
      }
    }
    const ids = [...shares];
    let sent = 0, opened = 0;
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500);
      const [sends, opens] = await Promise.all([
        client.from('card_events').select('id', { count: 'exact', head: true }).in('share_id', batch).eq('event_type', 'composer_sent'),
        client.from('card_events').select('id', { count: 'exact', head: true }).in('share_id', batch).eq('event_type', 'qualified_open'),
      ]);
      if (sends.error || opens.error || sends.count === null || opens.count === null) throw Error('Card totals unavailable');
      sent += sends.count;
      opened += opens.count;
    }
    return NextResponse.json({ sent, opened }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const status = error instanceof CardError ? error.status : error instanceof z.ZodError ? 400 : 500;
    return NextResponse.json({ error: status === 500 ? 'Unable to load business-card totals' : error instanceof Error ? error.message : 'Invalid request' }, { status });
  }
}
