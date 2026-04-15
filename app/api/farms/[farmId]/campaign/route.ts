import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveCampaignRegion } from '@/lib/geo/regionResolver';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { buildFarmCampaignDescription } from '@/lib/farms/backingCampaign';
import {
  formatApiError,
  persistLinkedCampaignIdIfPossible,
  resolveBackingCampaignId,
  selectFarmCampaignRow,
  userCanAccessFarm,
} from '@/app/api/farms/_utils/backingCampaign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseFarmPolygon(rawPolygon: unknown): GeoJSON.Polygon | null {
  if (!rawPolygon) return null;

  if (typeof rawPolygon === 'object') {
    const candidate = rawPolygon as GeoJSON.Polygon;
    if (candidate?.type === 'Polygon' && Array.isArray(candidate.coordinates)) {
      return candidate;
    }
    return null;
  }

  if (typeof rawPolygon !== 'string' || !rawPolygon.trim()) return null;

  try {
    const parsed = JSON.parse(rawPolygon) as GeoJSON.Polygon;
    if (parsed?.type === 'Polygon' && Array.isArray(parsed.coordinates)) {
      return parsed;
    }
  } catch {}

  return null;
}

async function getAuthorizedFarm(
  request: NextRequest,
  farmId: string
): Promise<
  | {
      admin: ReturnType<typeof createAdminClient>;
      userId: string;
      farm: NonNullable<Awaited<ReturnType<typeof selectFarmCampaignRow>>['farm']>;
      hasLinkedCampaignColumn: boolean;
    }
  | NextResponse
> {
  const authClient = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { farm, hasLinkedCampaignColumn } = await selectFarmCampaignRow(admin, farmId);
  if (!farm) {
    return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
  }

  const canAccess = await userCanAccessFarm(admin, user.id, farm);
  if (!canAccess) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  return {
    admin,
    userId: user.id,
    farm,
    hasLinkedCampaignColumn,
  };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ farmId: string }> }
) {
  try {
    const { farmId } = await context.params;
    const authorized = await getAuthorizedFarm(request, farmId);
    if (authorized instanceof NextResponse) return authorized;

    const { admin, farm, hasLinkedCampaignColumn } = authorized;
    const campaignId = await resolveBackingCampaignId(admin, farm, hasLinkedCampaignColumn);

    return NextResponse.json({
      farm_id: farm.id,
      linked_campaign_id: campaignId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load linked campaign' },
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
    const authorized = await getAuthorizedFarm(request, farmId);
    if (authorized instanceof NextResponse) return authorized;

    const { admin, userId, farm, hasLinkedCampaignColumn } = authorized;
    const existingCampaignId = await resolveBackingCampaignId(admin, farm, hasLinkedCampaignColumn);
    if (existingCampaignId) {
      return NextResponse.json({
        farm_id: farm.id,
        linked_campaign_id: existingCampaignId,
        created: false,
      });
    }

    const polygon = parseFarmPolygon(farm.polygon);
    if (!polygon) {
      return NextResponse.json({ error: 'Farm polygon is required' }, { status: 400 });
    }

    const bbox = turf.bbox(turf.polygon(polygon.coordinates));
    const regionResolution = await resolveCampaignRegion({
      polygon,
      bbox,
    });

    let workspaceId = farm.workspace_id ?? null;
    if (!workspaceId) {
      const workspaceResolution = await resolveWorkspaceIdForUser(
        admin as unknown as MinimalSupabaseClient,
        userId,
        null
      );
      if (!workspaceResolution.workspaceId) {
        return NextResponse.json(
          { error: workspaceResolution.error ?? 'No workspace membership found for this user' },
          { status: workspaceResolution.status ?? 400 }
        );
      }
      workspaceId = workspaceResolution.workspaceId;
    }

    const { data: campaign, error: insertError } = await admin
      .from('campaigns')
      .insert({
        owner_id: farm.owner_id,
        workspace_id: workspaceId,
        name: farm.name,
        title: farm.name,
        description: buildFarmCampaignDescription(farm.id, farm.description),
        type: 'flyer',
        address_source: 'map',
        region: regionResolution.regionCode,
        bbox,
        territory_boundary: polygon,
        total_flyers: 0,
        scans: 0,
        conversions: 0,
        status: 'draft',
      })
      .select('id')
      .single();

    if (insertError || !campaign) {
      return NextResponse.json(
        { error: insertError ? formatApiError(insertError) : 'Failed to create linked campaign' },
        { status: 500 }
      );
    }

    await persistLinkedCampaignIdIfPossible(admin, farm.id, campaign.id, hasLinkedCampaignColumn);

    return NextResponse.json({
      farm_id: farm.id,
      linked_campaign_id: campaign.id,
      created: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create linked campaign' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ farmId: string }> }
) {
  try {
    const { farmId } = await context.params;
    const authorized = await getAuthorizedFarm(request, farmId);
    if (authorized instanceof NextResponse) return authorized;

    const { admin, farm, hasLinkedCampaignColumn } = authorized;
    const campaignId = await resolveBackingCampaignId(admin, farm, hasLinkedCampaignColumn);

    if (!campaignId) {
      return NextResponse.json({ error: 'Linked campaign not found' }, { status: 404 });
    }

    const { error: updateError } = await admin
      .from('campaigns')
      .update({
        name: farm.name,
        title: farm.name,
        description: buildFarmCampaignDescription(farm.id, farm.description),
      })
      .eq('id', campaignId);

    if (updateError) {
      return NextResponse.json(
        { error: formatApiError(updateError) },
        { status: 500 }
      );
    }

    return NextResponse.json({
      farm_id: farm.id,
      linked_campaign_id: campaignId,
      updated: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync linked campaign' },
      { status: 500 }
    );
  }
}
