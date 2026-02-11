import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { TownhouseSplitterService } from '@/lib/services/TownhouseSplitterService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/[campaignId]/split-errors
 * 
 * Returns all split errors for manual review
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  
  console.log(`[API] GET /campaigns/${campaignId}/split-errors`);
  
  try {
    const supabase = await createClient();
    
    // Check authentication
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
    
    // Get split errors
    const { data: errors, error: errorsError } = await supabase
      .from('building_split_errors')
      .select(`
        *,
        campaign_addresses:campaign_addresses!inner (
          id,
          formatted,
          house_number,
          street_name
        )
      `)
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    
    if (errorsError) {
      throw new Error(`Failed to fetch split errors: ${errorsError.message}`);
    }
    
    // Get summary
    const { data: summary } = await supabase
      .from('split_error_summary')
      .select('*')
      .eq('campaign_id', campaignId)
      .single();
    
    return NextResponse.json({
      success: true,
      errors: errors || [],
      summary: summary || {
        pending_errors: 0,
        in_review: 0,
        resolved: 0,
        validation_errors: 0,
        geometry_errors: 0,
        split_errors: 0,
      },
    });
    
  } catch (error) {
    console.error('[API] Error fetching split errors:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch split errors' },
      { status: 500 }
    );
  }
}
