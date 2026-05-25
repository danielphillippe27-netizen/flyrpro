import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_CAMPAIGN_TYPES = new Set([
  'flyer',
  'door_knock',
  'event',
  'survey',
  'gift',
  'pop_by',
  'open_house',
  'coming_soon',
  'market_update',
  'letters',
  'just_sold',
  'just_listed',
  'prospecting',
  'other',
]);

const EXPANDED_CAMPAIGN_TYPES = new Set(['just_sold', 'just_listed', 'prospecting', 'coming_soon', 'market_update', 'other']);

function isCampaignTypeConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string; details?: string | null };
  return (
    candidate.code === '23514' ||
    candidate.message?.includes('campaigns_type_check') ||
    candidate.details?.includes('campaigns_type_check') ||
    false
  );
}

type RouteContext = {
  params: Promise<{
    campaignId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
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
    const hasAccess = await ensureCampaignAccess(admin, campaignId, user.id);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
    }

    const { data: campaign, error } = await admin
      .from('campaigns')
      .select('id, name, title, status, type, provision_status, provision_phase, provision_source, updated_at')
      .eq('id', campaignId)
      .single();

    if (error || !campaign) {
      return NextResponse.json({ error: error?.message ?? 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: campaign.id,
      name: campaign.title || campaign.name || 'Untitled Campaign',
      status: campaign.status || campaign.provision_status || 'draft',
      type: campaign.type ?? null,
      provision_status: campaign.provision_status ?? null,
      provision_phase: campaign.provision_phase ?? null,
      provision_source: campaign.provision_source ?? null,
      updated_at: campaign.updated_at ?? null,
    });
  } catch (err) {
    console.error('[GET /api/campaigns/[campaignId]] Unhandled error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { campaignId } = await context.params;
    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign id is required' }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      description?: unknown;
      type?: unknown;
    };

    const updates: Record<string, string> = {};
    if (typeof body.name === 'string') {
      const trimmedName = body.name.trim();
      if (!trimmedName) {
        return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 });
      }
      updates.name = trimmedName;
      updates.title = trimmedName;
    }

    if (typeof body.description === 'string') {
      updates.description = body.description.trim();
    }

    if (typeof body.type === 'string') {
      const trimmedType = body.type.trim();
      if (!ALLOWED_CAMPAIGN_TYPES.has(trimmedType)) {
        return NextResponse.json({ error: 'Unsupported campaign type' }, { status: 400 });
      }
      updates.type = trimmedType;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No campaign updates provided' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: campaign, error: campaignError } = await admin
      .from('campaigns')
      .select('id, owner_id')
      .eq('id', campaignId)
      .maybeSingle();

    if (campaignError) {
      console.error('[PATCH /api/campaigns/[campaignId]] Failed to load campaign:', campaignError);
      return NextResponse.json({ error: campaignError.message }, { status: 500 });
    }

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    if (campaign.owner_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const requestedType = typeof body.type === 'string' ? body.type.trim() : null;
    const detailUpdates = { ...updates };
    delete detailUpdates.type;

    let updatedCampaign = null;
    if (Object.keys(detailUpdates).length > 0) {
      const { data, error } = await admin
        .from('campaigns')
        .update(detailUpdates)
        .eq('id', campaignId)
        .select()
        .single();

      if (error) {
        console.error('[PATCH /api/campaigns/[campaignId]] Failed to update campaign details:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      updatedCampaign = data;
    }

    if (requestedType) {
      const { data, error } = await admin
        .from('campaigns')
        .update({ type: requestedType })
        .eq('id', campaignId)
        .select()
        .single();

      if (error) {
        if (EXPANDED_CAMPAIGN_TYPES.has(requestedType) || isCampaignTypeConstraintError(error)) {
          console.warn('[PATCH /api/campaigns/[campaignId]] Campaign type could not be saved; keeping details update', {
            campaign_id: campaignId,
            requested_type: requestedType,
            error: error.message,
          });
        } else {
          console.error('[PATCH /api/campaigns/[campaignId]] Failed to update campaign type:', error);
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      } else {
        updatedCampaign = data;
      }
    }

    if (!updatedCampaign) {
      const { data, error } = await admin
        .from('campaigns')
        .select()
        .eq('id', campaignId)
        .single();

      if (error) {
        console.error('[PATCH /api/campaigns/[campaignId]] Failed to reload campaign after update:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      updatedCampaign = data;
    }

    return NextResponse.json({
      ...updatedCampaign,
      name: updatedCampaign.title || updatedCampaign.name,
      type: requestedType && EXPANDED_CAMPAIGN_TYPES.has(requestedType) ? requestedType : updatedCampaign.type,
    });
  } catch (err) {
    console.error('[PATCH /api/campaigns/[campaignId]] Unhandled error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown server error' },
      { status: 500 }
    );
  }
}

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
