import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { CampaignAddressEnrichmentService } from '@/lib/services/CampaignAddressEnrichmentService';
import { prebuildCampaignMapBundle } from '@/lib/services/CampaignMapBundlePrebuilder';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const admin = createAdminClient();
  try {
    const result = await new CampaignAddressEnrichmentService(admin).processBatch();
    // A failed bundle build must be retried even when every address is confirmed.
    const pending = await admin.from('campaign_addresses').select('campaign_id')
      .eq('address_resolution_bundle_pending', true).neq('address_resolution_status', 'pending').limit(1).maybeSingle();
    if (pending.error) throw new Error(pending.error.message);
    if (pending.data) {
      const campaignId = pending.data.campaign_id;
      const rows = await fetchAllInPages<{ id: string }>(async (from, to) => await admin.from('campaign_addresses')
        .select('id').eq('campaign_id', campaignId).eq('address_resolution_bundle_pending', true)
        .neq('address_resolution_status', 'pending').range(from, to));
      await prebuildCampaignMapBundle(admin, campaignId, undefined, { forceRebuild: true });
      // Pending retries may change again, so only acknowledge terminal records.
      if (rows.length) {
        const { error } = await admin.from('campaign_addresses').update({ address_resolution_bundle_pending: false })
          .in('id', rows.map(r => r.id)).neq('address_resolution_status', 'pending');
        if (error) throw new Error(error.message);
      }
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
