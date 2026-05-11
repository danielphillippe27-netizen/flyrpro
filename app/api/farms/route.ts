import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveCampaignRegion } from '@/lib/geo/regionResolver';
import { buildFarmCampaignDescription } from '@/lib/farms/backingCampaign';
import { formatApiError, persistLinkedCampaignIdIfPossible } from '@/app/api/farms/_utils/backingCampaign';
import type { CreateFarmPayload } from '@/types/farms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateFarmBody = CreateFarmPayload;

function isMissingFarmColumnError(error: unknown, column: string): boolean {
  const message = formatApiError(error).toLowerCase();
  return (
    message.includes(`could not find the '${column}' column`) ||
    message.includes(`column farms.${column}`) ||
    message.includes(`${column} does not exist`)
  );
}

function parseFarmPolygon(rawPolygon: string | undefined): GeoJSON.Polygon | null {
  if (!rawPolygon?.trim()) return null;

  try {
    const parsed = JSON.parse(rawPolygon) as GeoJSON.Polygon;
    if (parsed?.type === 'Polygon' && Array.isArray(parsed.coordinates)) {
      return parsed;
    }
  } catch {}

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const body: CreateFarmBody = await request.json();
    const polygon = parseFarmPolygon(body.polygon);

    if (!body.name?.trim() || !polygon) {
      return NextResponse.json(
        { error: 'name and polygon are required' },
        { status: 400 }
      );
    }

    const requestedWorkspaceId =
      typeof body.workspace_id === 'string' && body.workspace_id.trim()
        ? body.workspace_id.trim()
        : null;

    let targetWorkspaceId: string | null = requestedWorkspaceId;
    if (targetWorkspaceId) {
      const resolution = await resolveWorkspaceIdForUser(
        admin as unknown as MinimalSupabaseClient,
        user.id,
        targetWorkspaceId
      );

      if (!resolution.workspaceId) {
        const fallbackResolution = await resolveWorkspaceIdForUser(
          admin as unknown as MinimalSupabaseClient,
          user.id,
          null
        );
        if (!fallbackResolution.workspaceId) {
          return NextResponse.json(
            { error: fallbackResolution.error ?? resolution.error ?? 'No workspace membership found for this user' },
            { status: fallbackResolution.status ?? resolution.status ?? 400 }
          );
        }
        targetWorkspaceId = fallbackResolution.workspaceId;
      } else {
        targetWorkspaceId = resolution.workspaceId;
      }
    } else {
      const fallbackResolution = await resolveWorkspaceIdForUser(
        admin as unknown as MinimalSupabaseClient,
        user.id,
        null
      );
      if (!fallbackResolution.workspaceId) {
        return NextResponse.json(
          { error: fallbackResolution.error ?? 'No workspace membership found for this user' },
          { status: fallbackResolution.status ?? 400 }
        );
      }
      targetWorkspaceId = fallbackResolution.workspaceId;
    }

    const bbox = turf.bbox(turf.polygon(polygon.coordinates));
    const regionResolution = await resolveCampaignRegion({
      polygon,
      bbox,
    });

    const basePayload: Record<string, unknown> = {
      owner_id: user.id,
      workspace_id: targetWorkspaceId,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      polygon: JSON.stringify(polygon),
      start_date: body.start_date,
      end_date: body.end_date,
      frequency: 1,
      is_active: true,
      touches_per_interval: 1,
      touches_interval: body.touches_interval ?? 'month',
      goal_type: body.goal_type ?? 'homes_per_cycle',
      goal_target: body.goal_target ?? body.touches_per_interval ?? body.frequency,
      cycle_completion_window_days: body.cycle_completion_window_days ?? null,
      touch_types: body.touch_types ?? [],
      annual_budget_cents: body.annual_budget_cents ?? null,
      include_social_ads_in_spend: body.include_social_ads_in_spend ?? false,
      area_label: body.area_label ?? null,
      home_limit: Math.min(5000, Math.max(1, Number(body.home_limit ?? 5000) || 5000)),
      address_count: body.address_count ?? 0,
    };

    const removableColumns = [
      'workspace_id',
      'description',
      'is_active',
      'touches_per_interval',
      'touches_interval',
      'goal_type',
      'goal_target',
      'cycle_completion_window_days',
      'touch_types',
      'annual_budget_cents',
      'include_social_ads_in_spend',
      'home_limit',
      'address_count',
    ] as const;

    let { data: farm, error: farmError } = await admin
      .from('farms')
      .insert(basePayload)
      .select()
      .single();

    while (farmError) {
      const missingColumn = removableColumns.find(
        (column) => column in basePayload && isMissingFarmColumnError(farmError, column)
      );
      if (!missingColumn) break;
      delete basePayload[missingColumn];
      const retry = await admin.from('farms').insert(basePayload).select().single();
      farm = retry.data;
      farmError = retry.error;
    }

    if (farmError || !farm) {
      return NextResponse.json(
        { error: farmError ? formatApiError(farmError) : 'Failed to create farm' },
        { status: 500 }
      );
    }

    const { data: campaign, error: campaignError } = await admin
      .from('campaigns')
      .insert({
        owner_id: user.id,
        workspace_id: targetWorkspaceId,
        name: body.name.trim(),
        title: body.name.trim(),
        description: buildFarmCampaignDescription(farm.id, body.description),
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

    if (campaignError || !campaign) {
      return NextResponse.json(
        { error: campaignError ? formatApiError(campaignError) : 'Failed to create linked campaign' },
        { status: 500 }
      );
    }

    await persistLinkedCampaignIdIfPossible(admin, farm.id, campaign.id, true);

    return NextResponse.json({
      ...farm,
      linked_campaign_id: campaign.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown server error' },
      { status: 500 }
    );
  }
}
