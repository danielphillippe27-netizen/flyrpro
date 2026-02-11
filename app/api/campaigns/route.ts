import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CreateCampaignBody {
  name: string;
  type: string;
  address_source: string;
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
    const { name, type, address_source, seed_query, bbox, territory_boundary } = body;

    if (!name || !type || !address_source) {
      return NextResponse.json(
        { error: 'name, type, and address_source are required' },
        { status: 400 }
      );
    }

    const { data: campaign, error: insertError } = await supabase
      .from('campaigns')
      .insert({
        owner_id: user.id,
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
