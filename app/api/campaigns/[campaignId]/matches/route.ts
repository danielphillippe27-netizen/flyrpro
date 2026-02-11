import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { StableLinkerService } from '@/lib/services/StableLinkerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/[campaignId]/matches
 * 
 * Returns all building-address matches for a campaign with quality metrics
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  const { campaignId } = params;
  
  console.log(`[API] GET /campaigns/${campaignId}/matches`);
  
  try {
    const supabase = await createClient();
    
    // Check if user has access to this campaign
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
    
    // Get matches using the StableLinkerService
    const linkerService = new StableLinkerService(supabase);
    const matches = await linkerService.getCampaignMatches(campaignId);
    
    // Get quality summary from database view
    const { data: quality } = await supabase
      .from('campaign_match_quality')
      .select('*')
      .eq('campaign_id', campaignId)
      .single();
    
    return NextResponse.json({
      success: true,
      matches,
      summary: quality || {
        containment_verified: 0,
        containment_suspect: 0,
        point_on_surface: 0,
        proximity_verified: 0,
        proximity_fallback: 0,
        manual: 0,
        orphan: 0,
        total: 0,
        avg_confidence: 0,
        avg_distance: 0,
      },
    });
    
  } catch (error) {
    console.error('[API] Error fetching matches:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch matches' },
      { status: 500 }
    );
  }
}
