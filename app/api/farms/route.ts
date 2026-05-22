import { NextRequest, NextResponse } from 'next/server';
import * as turf from '@turf/turf';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
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

async function workspaceIdsForUser(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const workspaceIds = new Set<string>();

  const { data: memberships } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId);
  for (const membership of memberships ?? []) {
    const workspaceId = (membership as { workspace_id?: string | null }).workspace_id;
    if (workspaceId) workspaceIds.add(workspaceId);
  }

  const { data: ownedWorkspaces } = await admin
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId);
  for (const workspace of ownedWorkspaces ?? []) {
    const workspaceId = (workspace as { id?: string | null }).id;
    if (workspaceId) workspaceIds.add(workspaceId);
  }

  return [...workspaceIds];
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  let workspaceIds = await workspaceIdsForUser(admin, requestUser.id);
  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim() || null;
  if (requestedWorkspaceId) {
    const workspace = await resolveWorkspaceIdForUser(
      admin as unknown as MinimalSupabaseClient,
      requestUser.id,
      requestedWorkspaceId
    );
    if (!workspace.workspaceId) {
      return NextResponse.json(
        { error: workspace.error ?? 'Workspace not found' },
        { status: workspace.status ?? 400 }
      );
    }
    workspaceIds = [workspace.workspaceId];
  }
  const farmRows = new Map<string, {
    id: string;
    name?: string | null;
    phase?: string | null;
    status?: string | null;
    is_active?: boolean | null;
    address_count?: number | null;
    updated_at?: string | null;
    start_date?: string | null;
    end_date?: string | null;
    touches_per_interval?: number | null;
    touches_interval?: string | null;
    goal_type?: string | null;
    goal_target?: number | null;
  }>();
  const farmSelect = 'id, name, phase, status, is_active, address_count, updated_at, start_date, end_date, touches_per_interval, touches_interval, goal_type, goal_target';

  if (!requestedWorkspaceId) {
    const { data: ownedFarms, error: ownedError } = await admin
      .from('farms')
      .select(farmSelect)
      .eq('owner_id', requestUser.id)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (ownedError) {
      return NextResponse.json({ error: formatApiError(ownedError) }, { status: 500 });
    }
    for (const farm of ownedFarms ?? []) {
      farmRows.set(farm.id, farm);
    }
  }

  if (workspaceIds.length > 0) {
    const { data: workspaceFarms, error: workspaceError } = await admin
      .from('farms')
      .select(farmSelect)
      .in('workspace_id', workspaceIds)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (workspaceError) {
      return NextResponse.json({ error: formatApiError(workspaceError) }, { status: 500 });
    }
    for (const farm of workspaceFarms ?? []) {
      farmRows.set(farm.id, farm);
    }
  }

  const rows = [...farmRows.values()].sort((a, b) => {
    const aTime = Date.parse(a.updated_at ?? '');
    const bTime = Date.parse(b.updated_at ?? '');
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });

  return NextResponse.json(
    rows.map((farm) => ({
      id: farm.id,
      name: farm.name || 'Untitled Farm',
      phase: farm.phase || farm.status || (farm.is_active ? 'active' : 'prospecting'),
      addressCount: farm.address_count ?? 0,
      startDate: farm.start_date ?? null,
      endDate: farm.end_date ?? null,
      touchesPerInterval: farm.touches_per_interval ?? null,
      touchesInterval: farm.touches_interval ?? null,
      goalType: farm.goal_type ?? null,
      goalTarget: farm.goal_target ?? null,
    }))
  );
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
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
        requestUser.id,
        targetWorkspaceId
      );

      if (!resolution.workspaceId) {
        const fallbackResolution = await resolveWorkspaceIdForUser(
          admin as unknown as MinimalSupabaseClient,
          requestUser.id,
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
        requestUser.id,
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
      owner_id: requestUser.id,
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

    const linkedCampaignName = body.campaign_name?.trim() || body.name.trim();

    const { data: campaign, error: campaignError } = await admin
      .from('campaigns')
      .insert({
        owner_id: requestUser.id,
        workspace_id: targetWorkspaceId,
        name: linkedCampaignName,
        title: linkedCampaignName,
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
