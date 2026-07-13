import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import { resolveCampaignRegion } from '@/lib/geo/regionResolver';
import { bboxFromPolygon } from '@/lib/services/provisionHelpers';

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

const EXPANDED_CAMPAIGN_TYPES = new Set([
  'just_sold',
  'just_listed',
  'prospecting',
  'coming_soon',
  'market_update',
  'other',
]);

function isCampaignTypeConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    code?: string;
    message?: string;
    details?: string | null;
  };
  return (
    candidate.code === '23514' ||
    candidate.message?.includes('campaigns_type_check') ||
    candidate.details?.includes('campaigns_type_check') ||
    false
  );
}

function normalizeBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map((entry) => Number(entry));
  if (!bbox.every(Number.isFinite)) return null;
  if (bbox[0] > bbox[2] || bbox[1] > bbox[3]) return null;
  return bbox as [number, number, number, number];
}

function normalizeTerritoryBoundary(value: unknown): GeoJSON.Polygon | null {
  if (
    !value ||
    typeof value !== 'object' ||
    (value as { type?: unknown }).type !== 'Polygon' ||
    !Array.isArray((value as { coordinates?: unknown }).coordinates)
  ) {
    return null;
  }

  const polygon = value as GeoJSON.Polygon;
  const ring = polygon.coordinates[0];
  if (!Array.isArray(ring) || ring.length < 4) return null;
  for (const point of ring) {
    if (
      !Array.isArray(point) ||
      point.length < 2 ||
      typeof point[0] !== 'number' ||
      typeof point[1] !== 'number' ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ) {
      return null;
    }
  }

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) {
    return polygon;
  }

  return {
    ...polygon,
    coordinates: [[...ring, [first[0], first[1]]], ...polygon.coordinates.slice(1)],
  };
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
      .select('*')
      .eq('id', campaignId)
      .single();

    if (error || !campaign) {
      return NextResponse.json({ error: error?.message ?? 'Campaign not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...campaign,
      name: campaign.title || campaign.name || 'Untitled Campaign',
      status: campaign.status || campaign.provision_status || 'draft',
    });
  } catch (err) {
    console.error('[GET /api/campaigns/[campaignId]] Unhandled error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown server error' }, { status: 500 });
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
      territory_boundary?: unknown;
      bbox?: unknown;
      region?: unknown;
    };

    const updates: Record<string, unknown> = {};
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

    const hasTerritoryBoundary = Object.prototype.hasOwnProperty.call(body, 'territory_boundary');
    const territoryBoundary = hasTerritoryBoundary ? normalizeTerritoryBoundary(body.territory_boundary) : null;
    if (hasTerritoryBoundary && !territoryBoundary) {
      return NextResponse.json({ error: 'Invalid territory boundary polygon' }, { status: 400 });
    }

    const hasBbox = Object.prototype.hasOwnProperty.call(body, 'bbox');
    const requestedBbox = hasBbox ? normalizeBbox(body.bbox) : null;
    if (hasBbox && !requestedBbox) {
      return NextResponse.json({ error: 'Invalid bbox' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: campaign, error: campaignError } = await admin
      .from('campaigns')
      .select('id, owner_id, region')
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

    if (territoryBoundary) {
      const bbox = requestedBbox ?? bboxFromPolygon(territoryBoundary);
      if (!bbox) {
        return NextResponse.json({ error: 'Could not calculate territory bbox' }, { status: 400 });
      }
      const regionResolution = await resolveCampaignRegion({
        currentRegion:
          typeof body.region === 'string' && body.region.trim() ? body.region.trim().toUpperCase() : campaign.region,
        polygon: territoryBoundary,
        bbox,
      });
      updates.territory_boundary = territoryBoundary;
      updates.bbox = bbox;
      updates.region = regionResolution.regionCode;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No campaign updates provided' }, { status: 400 });
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
      const { data, error } = await admin.from('campaigns').select().eq('id', campaignId).single();

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
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown server error' }, { status: 500 });
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

    const { error: parcelsError } = await admin.from('campaign_parcels').delete().eq('campaign_id', campaignId);

    if (parcelsError) {
      console.error('[DELETE /api/campaigns/[campaignId]] Failed to delete campaign parcels:', parcelsError);
      return NextResponse.json({ error: parcelsError.message }, { status: 500 });
    }

    const { error: deleteError } = await admin.from('campaigns').delete().eq('id', campaignId);

    if (deleteError) {
      console.error('[DELETE /api/campaigns/[campaignId]] Failed to delete campaign:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/campaigns/[campaignId]] Unhandled error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown server error' }, { status: 500 });
  }
}
