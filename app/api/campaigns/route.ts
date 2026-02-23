import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import { resolveCampaignRegion } from '@/lib/geo/regionResolver';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreateCampaignBody {
  name: string;
  type: string;
  address_source: string;
  region?: string;
  workspace_id?: string;
  seed_query?: string;
  bbox?: number[];
  territory_boundary?: { type: 'Polygon'; coordinates: number[][][] };
}

/**
 * POST /api/campaigns - Create a campaign server-side after validating workspace access.
 * Requires SUPABASE_SERVICE_ROLE_KEY for admin resolution/insert.
 */
export async function POST(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const body: CreateCampaignBody = await request.json();
    const { name, type, address_source, region, workspace_id, seed_query, bbox, territory_boundary } = body;

    if (!name || !type || !address_source) {
      return NextResponse.json(
        { error: 'name, type, and address_source are required' },
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
          user_id: user.id,
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

    const { data: campaign, error: insertError } = await admin
      .from('campaigns')
      .insert({
        owner_id: user.id,
        workspace_id: targetWorkspaceId,
        name,
        title: name,
        description: '',
        type,
        address_source,
        region: regionResolution.regionCode,
        seed_query: seed_query ?? null,
        bbox: bbox ?? null,
        territory_boundary: territory_boundary ?? null,
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
