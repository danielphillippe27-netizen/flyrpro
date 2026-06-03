import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { normalizeAddressStatus } from '@/lib/constants/mapStatus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIVE_ASSIGNMENT_STATUSES = ['assigned', 'in_progress'];
const VISITED_STATUSES = new Set([
  'no_answer',
  'not_home',
  'attempted',
  'delivered',
  'talked',
  'lead',
  'interested',
  'appointment',
  'follow_up',
  'appointment_set',
  'callback_requested',
  'do_not_knock',
  'future_seller',
  'hot_lead',
]);

type CampaignOverlayRow = {
  id: string;
  name?: string | null;
  title?: string | null;
  status?: string | null;
  provision_status?: string | null;
  territory_boundary?: unknown;
  campaign_polygon_raw?: unknown;
  campaign_polygon_snapped?: unknown;
  bbox?: unknown;
};

type CampaignAddressRow = {
  id: string;
  campaign_id: string;
  visited?: boolean | null;
};

type AddressStatusRow = {
  campaign_address_id: string;
  campaign_id: string;
  status?: string | null;
};

type AssignmentRow = {
  campaign_id: string;
  assigned_to_user_id: string;
};

type ProfileRow = {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
};

function normalizePolygon(value: unknown): GeoJSON.Polygon | GeoJSON.MultiPolygon | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return normalizePolygon(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (typeof value !== 'object') return null;
  const candidate = value as { type?: unknown; coordinates?: unknown };
  if (
    (candidate.type === 'Polygon' || candidate.type === 'MultiPolygon') &&
    Array.isArray(candidate.coordinates)
  ) {
    return candidate as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  }
  return null;
}

function normalizeBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const bbox = value.map((entry) => Number(entry));
  if (!bbox.every(Number.isFinite)) return null;
  if (bbox[0] > bbox[2] || bbox[1] > bbox[3]) return null;
  return bbox as [number, number, number, number];
}

function displayName(profile: ProfileRow | undefined, fallback: string): string {
  const name = [profile?.first_name, profile?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();
  return name || fallback.slice(0, 8);
}

async function fetchPagedRows<T>(
  queryFactory: () => {
    range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>;
  }
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message || 'Failed to load overlay rows');
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const workspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const workspace = await resolveWorkspaceIdForUser(
      admin as unknown as MinimalSupabaseClient,
      requestUser.id,
      workspaceId
    );

    if (!workspace.workspaceId) {
      return NextResponse.json(
        { error: workspace.error ?? 'Workspace not found' },
        { status: workspace.status ?? 403 }
      );
    }

    const { data: campaignData, error: campaignError } = await admin
      .from('campaigns')
      .select('id, name, title, status, provision_status, territory_boundary, campaign_polygon_raw, campaign_polygon_snapped, bbox')
      .eq('workspace_id', workspace.workspaceId)
      .not('territory_boundary', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(250);

    if (campaignError) {
      return NextResponse.json({ error: campaignError.message }, { status: 500 });
    }

    const campaignRows = (campaignData ?? []) as CampaignOverlayRow[];
    const campaignsWithGeometry = campaignRows
      .map((campaign) => ({
        ...campaign,
        geometry:
          normalizePolygon(campaign.campaign_polygon_snapped) ??
          normalizePolygon(campaign.campaign_polygon_raw) ??
          normalizePolygon(campaign.territory_boundary),
      }))
      .filter((campaign) => campaign.geometry);

    const campaignIds = campaignsWithGeometry.map((campaign) => campaign.id);
    if (campaignIds.length === 0) {
      return NextResponse.json({ campaigns: [] });
    }

    const addresses = await fetchPagedRows<CampaignAddressRow>(() =>
      admin
        .from('campaign_addresses')
        .select('id, campaign_id, visited')
        .in('campaign_id', campaignIds)
        .order('id', { ascending: true })
    );

    let addressStatuses: AddressStatusRow[] = [];
    try {
      addressStatuses = await fetchPagedRows<AddressStatusRow>(() =>
        admin
          .from('address_statuses')
          .select('campaign_address_id, campaign_id, status')
          .in('campaign_id', campaignIds)
          .order('campaign_address_id', { ascending: true })
      );
    } catch (statusError) {
      console.warn('[GET /api/campaigns/territory-overlays] Failed to load address statuses:', statusError);
    }

    const statusByAddressId = new Map(
      addressStatuses.map((row) => [row.campaign_address_id, normalizeAddressStatus(row.status)])
    );
    const progressByCampaignId = new Map<string, { total: number; visited: number }>();

    for (const address of addresses) {
      const progress = progressByCampaignId.get(address.campaign_id) ?? { total: 0, visited: 0 };
      const status = statusByAddressId.get(address.id);
      progress.total += 1;
      if (status ? VISITED_STATUSES.has(status) : Boolean(address.visited)) {
        progress.visited += 1;
      }
      progressByCampaignId.set(address.campaign_id, progress);
    }

    const { data: assignmentData, error: assignmentError } = await admin
      .from('campaign_assignments')
      .select('campaign_id, assigned_to_user_id')
      .in('campaign_id', campaignIds)
      .in('status', ACTIVE_ASSIGNMENT_STATUSES);

    if (assignmentError) {
      return NextResponse.json({ error: assignmentError.message }, { status: 500 });
    }

    const assignments = (assignmentData ?? []) as AssignmentRow[];
    const assigneeIds = Array.from(new Set(assignments.map((row) => row.assigned_to_user_id)));
    const profilesByUserId = new Map<string, ProfileRow>();

    if (assigneeIds.length > 0) {
      const { data: profileData, error: profileError } = await admin
        .from('user_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', assigneeIds);

      if (profileError) {
        return NextResponse.json({ error: profileError.message }, { status: 500 });
      }

      for (const profile of (profileData ?? []) as ProfileRow[]) {
        profilesByUserId.set(profile.user_id, profile);
      }
    }

    const assigneesByCampaignId = assignments.reduce((map, assignment) => {
      const list = map.get(assignment.campaign_id) ?? [];
      const label = displayName(profilesByUserId.get(assignment.assigned_to_user_id), assignment.assigned_to_user_id);
      if (!list.includes(label)) list.push(label);
      map.set(assignment.campaign_id, list);
      return map;
    }, new Map<string, string[]>());

    return NextResponse.json({
      campaigns: campaignsWithGeometry.map((campaign) => {
        const progress = progressByCampaignId.get(campaign.id) ?? { total: 0, visited: 0 };
        const percent = progress.total > 0 ? Math.round((progress.visited / progress.total) * 100) : 0;

        return {
          id: campaign.id,
          name: campaign.title || campaign.name || 'Untitled Campaign',
          status: campaign.status || campaign.provision_status || 'draft',
          geometry: campaign.geometry,
          bbox: normalizeBbox(campaign.bbox),
          assignees: assigneesByCampaignId.get(campaign.id) ?? [],
          progress: {
            visited: progress.visited,
            total: progress.total,
            percent,
          },
        };
      }),
    });
  } catch (error) {
    console.error('[GET /api/campaigns/territory-overlays] Unhandled error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown server error' },
      { status: 500 }
    );
  }
}
