import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient, createAdminClient } from '@/lib/supabase/server';
import { resolveDashboardAccessLevel, resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { regionFromPolygon } from '@/lib/geo/regionFromPolygon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Allowed campaign types (must match DB constraint campaigns_type_check). */
const ALLOWED_CAMPAIGN_TYPES = [
  'flyer',
  'door_knock',
  'event',
  'survey',
  'gift',
  'pop_by',
  'open_house',
  'letters',
] as const;

function normalizeCampaignType(value: string | undefined): string {
  if (!value || typeof value !== 'string') return 'flyer';
  const lower = value.trim().toLowerCase();
  if (ALLOWED_CAMPAIGN_TYPES.includes(lower as (typeof ALLOWED_CAMPAIGN_TYPES)[number])) return lower;
  // Map legacy/alternate labels to allowed type (e.g. iOS "Territory" → flyer)
  if (lower === 'territory') return 'flyer';
  return 'flyer';
}

interface CreateCampaignBody {
  name: string;
  type?: string;
  address_source: string;
  workspace_id?: string;
  seed_query?: string;
  bbox?: number[];
  territory_boundary?: { type: 'Polygon'; coordinates: number[][][] };
}

/**
 * GET /api/campaigns - list campaigns with permission-aware scope.
 * - owner/admin/founder/team_leader: workspace campaigns
 * - member: only campaigns they own
 */
export async function GET(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const requestedWorkspaceId =
      searchParams.get('workspaceId') ??
      searchParams.get('workspace_id') ??
      undefined;

    const admin = createAdminClient();
    const access = await resolveDashboardAccessLevel(
      admin as unknown as MinimalSupabaseClient,
      user.id,
      requestedWorkspaceId
    );

    if (!access.workspaceId) {
      return NextResponse.json([]);
    }

    let query = admin
      .from('campaigns')
      .select('*')
      .eq('workspace_id', access.workspaceId)
      .order('created_at', { ascending: false });

    if (access.level === 'member') {
      query = query.eq('owner_id', user.id);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[GET /api/campaigns] Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data ?? []);
  } catch (err: unknown) {
    console.error('[GET /api/campaigns] Unhandled error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown server error' },
      { status: 500 }
    );
  }
}

/** If user has no workspace (e.g. skipped onboarding), create one and return its id. */
async function ensureWorkspaceForUser(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing?.workspace_id) return existing.workspace_id;

  const { data: newWorkspace, error: createErr } = await admin
    .from('workspaces')
    .insert({ name: 'My Workspace', owner_id: userId })
    .select('id')
    .single();
  if (createErr || !newWorkspace?.id) return null;

  const { error: memberErr } = await admin
    .from('workspace_members')
    .insert({ workspace_id: newWorkspace.id, user_id: userId, role: 'owner' });
  if (memberErr) return null;

  return newWorkspace.id;
}

/**
 * POST /api/campaigns - Create a campaign server-side (session client).
 * Ensure SUPABASE_SERVICE_ROLE_KEY is set for your project so generate-address-list can find the campaign.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: CreateCampaignBody = await request.json();
    const { name, type, address_source, workspace_id, seed_query, bbox, territory_boundary } = body;

    if (!name || !address_source) {
      return NextResponse.json(
        { error: 'name and address_source are required' },
        { status: 400 }
      );
    }

    const normalizedType = normalizeCampaignType(type);

    // Derive region from territory polygon so Lambda/Gold use correct tiles (e.g. Vancouver → BC, not default ON)
    const derivedRegion = territory_boundary
      ? regionFromPolygon(territory_boundary as { type: 'Polygon'; coordinates: number[][][] })
      : null;

    let targetWorkspaceId: string | null = null;
    const requestedWorkspaceId = workspace_id ?? null;

    if (requestedWorkspaceId) {
      const requestedResolution = await resolveWorkspaceIdForUser(
        supabase as unknown as MinimalSupabaseClient,
        user.id,
        requestedWorkspaceId
      );
      if (requestedResolution.workspaceId) {
        targetWorkspaceId = requestedResolution.workspaceId;
      }
    }

    if (!targetWorkspaceId) {
      const fallbackResolution = await resolveWorkspaceIdForUser(
        supabase as unknown as MinimalSupabaseClient,
        user.id
      );
      if (fallbackResolution.workspaceId) {
        targetWorkspaceId = fallbackResolution.workspaceId;
      } else {
        targetWorkspaceId = await ensureWorkspaceForUser(user.id);
        if (!targetWorkspaceId) {
          return NextResponse.json(
            { error: 'Failed to create workspace. Please try again.' },
            { status: 500 }
          );
        }
      }
    }

    const { data: campaign, error: insertError } = await supabase
      .from('campaigns')
      .insert({
        owner_id: user.id,
        workspace_id: targetWorkspaceId,
        name,
        title: name,
        description: '',
        type: normalizedType,
        address_source,
        seed_query: seed_query ?? null,
        bbox: bbox ?? null,
        territory_boundary: territory_boundary ?? null,
        region: derivedRegion ?? null,
        total_flyers: 0,
        scans: 0,
        conversions: 0,
        status: 'draft',
      })
      .select()
      .single();

    if (insertError) {
      console.error('[POST /api/campaigns] Insert error:', insertError);
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ...campaign,
      name: campaign.title || campaign.name,
    });
  } catch (err: unknown) {
    console.error('[POST /api/campaigns] Unhandled error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown server error' },
      { status: 500 }
    );
  }
}
