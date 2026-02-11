import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { StableLinkerService } from '@/lib/services/StableLinkerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/[campaignId]/orphans
 * 
 * Returns all orphaned addresses (not matched to buildings) for manual review
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  const { campaignId } = params;
  
  console.log(`[API] GET /campaigns/${campaignId}/orphans`);
  
  try {
    const supabase = await getSupabaseServerClient();
    
    // Check if user has access
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Verify campaign ownership
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('owner_id')
      .eq('id', campaignId)
      .single();
    
    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    
    if (campaign.owner_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    
    // Get orphans with coordinate and address details (all reviewable statuses)
    const { data: orphans, error } = await supabase
      .from('address_orphans')
      .select(`
        id,
        address_id,
        nearest_building_id,
        nearest_distance,
        nearest_building_street,
        address_street,
        street_match_score,
        suggested_buildings,
        suggested_street,
        status,
        coordinate,
        created_at,
        campaign_addresses:campaign_addresses!inner (
          id,
          formatted,
          house_number,
          street_name,
          city,
          postal_code,
          geom
        )
      `)
      .eq('campaign_id', campaignId)
      .in('status', ['pending', 'pending_review', 'ambiguous_match'])
      .order('nearest_distance', { ascending: true });
    
    if (error) {
      throw new Error(`Failed to fetch orphans: ${error.message}`);
    }
    
    return NextResponse.json({
      success: true,
      orphans: orphans || [],
      count: orphans?.length || 0,
    });
    
  } catch (error) {
    console.error('[API] Error fetching orphans:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch orphans' },
      { status: 500 }
    );
  }
}
