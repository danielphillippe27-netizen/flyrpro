import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreateCampaignBody {
  name: string;
  type: string;
  address_source: string;
  workspace_id?: string;
  seed_query?: string;
  bbox?: number[];
  territory_boundary?: { type: 'Polygon'; coordinates: number[][][] };
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

    if (!name || !type || !address_source) {
      return NextResponse.json(
        { error: 'name, type, and address_source are required' },
        { status: 400 }
      );
    }

    let targetWorkspaceId: string | null = workspace_id ?? null;
    if (targetWorkspaceId) {
      const { data: membership, error: membershipError } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .eq('workspace_id', targetWorkspaceId)
        .maybeSingle();

      if (membershipError || !membership) {
        return NextResponse.json(
          { error: 'You are not a member of the selected workspace' },
          { status: 403 }
        );
      }
    } else {
      const { data: fallbackMembership, error: fallbackError } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (fallbackError || !fallbackMembership?.workspace_id) {
        return NextResponse.json(
          { error: 'No workspace membership found for this user' },
          { status: 400 }
        );
      }

      targetWorkspaceId = fallbackMembership.workspace_id;
    }

    const { data: campaign, error: insertError } = await supabase
      .from('campaigns')
      .insert({
        owner_id: user.id,
        workspace_id: targetWorkspaceId,
        name,
        title: name,
        description: '',
        type,
        address_source,
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
