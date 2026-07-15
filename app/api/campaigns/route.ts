import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import { resolveCampaignRegion } from '@/lib/geo/regionResolver';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

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
const LEGACY_CAMPAIGN_TYPE_FALLBACK = 'flyer';

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

function isWorkspaceCampaignLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string; details?: string | null; hint?: string | null };
  return (
    candidate.code === 'P0001' &&
    (candidate.message?.includes('workspace_campaign_limit_reached') ||
      candidate.details?.includes('included campaign') ||
      candidate.hint?.includes('workspace_campaign_limit_reached') ||
      false)
  );
}

function isMissingCampaignAllowanceRpc(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string; details?: string | null; hint?: string | null };
  const combined = [candidate.message, candidate.details, candidate.hint].filter(Boolean).join(' ');
  return (
    candidate.code === 'PGRST202' ||
    (combined.includes('workspace_can_create_campaign') && combined.includes('schema cache'))
  );
}

interface CreateCampaignBody {
  name: string;
  description?: string;
  type: string;
  address_source: string;
  region?: string;
  workspace_id?: string;
  seed_query?: string;
  tags?: string;
  bbox?: number[];
  territory_boundary?: { type: 'Polygon'; coordinates: number[][][] };
}

function isWorkspaceManagerRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

async function workspaceRoleForUser(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string
): Promise<string | null> {
  const { data } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  return ((data as { role?: string | null } | null)?.role ?? null) || null;
}

async function assignedCampaignIdsForUser(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  workspaceId?: string | null
): Promise<string[]> {
  let query = admin
    .from('campaign_assignments')
    .select('campaign_id')
    .eq('assigned_to_user_id', userId)
    .in('status', ['accepted', 'in_progress'])
    .limit(1000);

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return Array.from(
    new Set(
      ((data ?? []) as { campaign_id?: string | null }[])
        .map((assignment) => assignment.campaign_id)
        .filter((id): id is string => Boolean(id))
    )
  );
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
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
  }
  const campaignRows = new Map<string, Record<string, unknown>>();
  const requestedWorkspaceRole = requestedWorkspaceId
    ? await workspaceRoleForUser(admin, requestedWorkspaceId, requestUser.id)
    : null;

  let ownedQuery = admin
    .from('campaigns')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(100);

  if (requestedWorkspaceId && isWorkspaceManagerRole(requestedWorkspaceRole)) {
    ownedQuery = ownedQuery.eq('workspace_id', requestedWorkspaceId);
  } else {
    ownedQuery = ownedQuery.eq('owner_id', requestUser.id);
    if (requestedWorkspaceId) {
      ownedQuery = ownedQuery.eq('workspace_id', requestedWorkspaceId);
    }
  }

  const { data: ownedCampaigns, error: ownedError } = await ownedQuery;
  if (ownedError) {
    return NextResponse.json({ error: ownedError.message }, { status: 500 });
  }
  for (const campaign of ownedCampaigns ?? []) {
    campaignRows.set(campaign.id, campaign);
  }

  if (!requestedWorkspaceId || !isWorkspaceManagerRole(requestedWorkspaceRole)) {
    let assignedCampaignIds: string[];
    try {
      assignedCampaignIds = await assignedCampaignIdsForUser(admin, requestUser.id, requestedWorkspaceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load assigned campaigns';
      return NextResponse.json({ error: message }, { status: 500 });
    }

    const missingAssignedIds = assignedCampaignIds.filter((id) => !campaignRows.has(id));
    if (missingAssignedIds.length > 0) {
      const { data: assignedCampaigns, error: assignedError } = await admin
        .from('campaigns')
        .select('*')
        .in('id', missingAssignedIds)
        .order('updated_at', { ascending: false })
        .limit(100);
      if (assignedError) {
        return NextResponse.json({ error: assignedError.message }, { status: 500 });
      }
      for (const campaign of assignedCampaigns ?? []) {
        campaignRows.set(campaign.id, campaign);
      }
    }
  }

  const rows = [...campaignRows.values()].sort((a, b) => {
    const aTime = Date.parse(asString(a.updated_at) ?? '');
    const bTime = Date.parse(asString(b.updated_at) ?? '');
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });

  return NextResponse.json(
    rows.map((campaign) => ({
      ...campaign,
      id: asString(campaign.id) ?? '',
      name: campaign.title || campaign.name || 'Untitled Campaign',
      status: campaign.status || campaign.provision_status || 'draft',
    }))
  );
}

/**
 * POST /api/campaigns - Create a campaign server-side after validating workspace access.
 * Requires SUPABASE_SERVICE_ROLE_KEY for admin resolution/insert.
 */
export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const body: CreateCampaignBody = await request.json();
    const { name, description, type, address_source, region, workspace_id, seed_query, tags, bbox, territory_boundary } = body;
    const normalizedType = typeof type === 'string' ? type.trim() : type;

    if (!name || !type || !address_source) {
      return NextResponse.json(
        { error: 'name, type, and address_source are required' },
        { status: 400 }
      );
    }

    if (!ALLOWED_CAMPAIGN_TYPES.has(normalizedType)) {
      return NextResponse.json(
        { error: 'Unsupported campaign type' },
        { status: 400 }
      );
    }

    const requestedWorkspaceId =
      typeof workspace_id === 'string' && workspace_id.trim()
        ? workspace_id.trim()
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
            {
              error:
                fallbackResolution.error ??
                resolution.error ??
                'No workspace membership found for this user',
            },
            { status: fallbackResolution.status ?? resolution.status ?? 400 }
          );
        }
        console.warn('[POST /api/campaigns] Provided workspace_id is not accessible; falling back to primary workspace', {
          user_id: requestUser.id,
          requested_workspace_id: targetWorkspaceId,
          fallback_workspace_id: fallbackResolution.workspaceId,
        });
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

    const { data: canCreateCampaign, error: campaignAllowanceError } = await admin.rpc(
      'workspace_can_create_campaign',
      {
        p_workspace_id: targetWorkspaceId,
        p_owner_id: requestUser.id,
      }
    );
    if (campaignAllowanceError && isMissingCampaignAllowanceRpc(campaignAllowanceError)) {
      console.warn('[POST /api/campaigns] workspace_can_create_campaign RPC missing; allowing create in local fallback', {
        workspace_id: targetWorkspaceId,
      });
    } else if (campaignAllowanceError) {
      return NextResponse.json({ error: campaignAllowanceError.message }, { status: 500 });
    } else if (!canCreateCampaign) {
      return NextResponse.json(
        {
          error: 'This workspace already has its included campaign. Upgrade to create more campaigns.',
          code: 'workspace_campaign_limit_reached',
        },
        { status: 403 }
      );
    }

    const regionResolution = await resolveCampaignRegion({
      currentRegion: region,
      polygon: territory_boundary ?? null,
      bbox: bbox ?? null,
    });

    if (regionResolution.source !== 'campaign') {
      console.log('[POST /api/campaigns] Resolved campaign region:', {
        region: regionResolution.regionCode,
        source: regionResolution.source,
        reason: regionResolution.reason,
      });
    }

    const insertPayload = {
      owner_id: requestUser.id,
      workspace_id: targetWorkspaceId,
      name,
      title: name,
      description:
        typeof description === 'string' && description.trim()
          ? description.trim()
          : 'Campaign created from polygon',
      type: normalizedType,
      address_source,
      region: regionResolution.regionCode,
      seed_query: seed_query ?? null,
      tags: typeof tags === 'string' && tags.trim() ? tags.trim() : null,
      bbox: bbox ?? null,
      territory_boundary: territory_boundary ?? null,
      total_flyers: 0,
      scans: 0,
      conversions: 0,
      status: 'draft',
      provision_status: territory_boundary ? 'pending' : null,
      provision_phase: territory_boundary ? 'created' : null,
      provision_source: null,
      provisioned_at: null,
      addresses_ready_at: null,
      map_ready_at: null,
      optimized_at: null,
      has_parcels: false,
      building_link_confidence: 0,
      map_mode: 'standard_pins',
      parcel_enrichment_status: 'not_started',
      link_quality_status: 'unknown',
      link_quality_score: 0,
      link_quality_reason: null,
      link_quality_checked_at: null,
      link_quality_metrics: {},
    };

    let { data: campaign, error: insertError } = await admin
      .from('campaigns')
      .insert(insertPayload)
      .select()
      .single();

    if (
      insertError &&
      EXPANDED_CAMPAIGN_TYPES.has(normalizedType) &&
      isCampaignTypeConstraintError(insertError)
    ) {
      console.warn('[POST /api/campaigns] campaigns_type_check does not allow expanded type yet; retrying with legacy fallback', {
        requested_type: normalizedType,
        fallback_type: LEGACY_CAMPAIGN_TYPE_FALLBACK,
      });
      const retry = await admin
        .from('campaigns')
        .insert({
          ...insertPayload,
          type: LEGACY_CAMPAIGN_TYPE_FALLBACK,
        })
        .select()
        .single();
      campaign = retry.data;
      insertError = retry.error;
    }

    if (insertError) {
      if (isWorkspaceCampaignLimitError(insertError)) {
        return NextResponse.json(
          {
            error: 'This workspace already has its included campaign. Upgrade to create more campaigns.',
            code: 'workspace_campaign_limit_reached',
          },
          { status: 403 }
        );
      }
      console.error('[POST /api/campaigns] Insert error:', insertError);
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ...campaign,
      name: campaign.title || campaign.name,
      type: EXPANDED_CAMPAIGN_TYPES.has(normalizedType) ? normalizedType : campaign.type,
    });
  } catch (err: unknown) {
    console.error('[POST /api/campaigns] Unhandled error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown server error' },
      { status: 500 }
    );
  }
}
