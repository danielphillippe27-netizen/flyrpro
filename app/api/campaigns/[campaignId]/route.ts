import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{
    campaignId: string;
  }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { campaignId } = await context.params;
    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign id is required' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: campaign, error: campaignError } = await admin
      .from('campaigns')
      .select('id, owner_id')
      .eq('id', campaignId)
      .maybeSingle();

    if (campaignError) {
      console.error('[DELETE /api/campaigns/[campaignId]] Failed to load campaign:', campaignError);
      return NextResponse.json({ error: campaignError.message }, { status: 500 });
    }

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    if (campaign.owner_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error: parcelsError } = await admin
      .from('campaign_parcels')
      .delete()
      .eq('campaign_id', campaignId);

    if (parcelsError) {
      console.error('[DELETE /api/campaigns/[campaignId]] Failed to delete campaign parcels:', parcelsError);
      return NextResponse.json({ error: parcelsError.message }, { status: 500 });
    }

    const { error: deleteError } = await admin
      .from('campaigns')
      .delete()
      .eq('id', campaignId);

    if (deleteError) {
      console.error('[DELETE /api/campaigns/[campaignId]] Failed to delete campaign:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/campaigns/[campaignId]] Unhandled error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown server error' },
      { status: 500 }
    );
  }
}
