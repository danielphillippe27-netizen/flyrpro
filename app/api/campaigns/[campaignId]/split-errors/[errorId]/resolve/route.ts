import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { TownhouseSplitterService } from '@/lib/services/TownhouseSplitterService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/campaigns/[campaignId]/split-errors/[errorId]/resolve
 * 
 * Manually resolve a split error by creating custom unit geometries
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { campaignId: string; errorId: string } }
) {
  const { campaignId, errorId } = params;
  
  console.log(`[API] POST /campaigns/${campaignId}/split-errors/${errorId}/resolve`);
  
  try {
    const supabase = await getSupabaseServerClient();
    
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
    
    const body = await request.json();
    const { units, notes } = body;
    
    if (!units || !Array.isArray(units) || units.length === 0) {
      return NextResponse.json(
        { error: 'units array is required' },
        { status: 400 }
      );
    }
    
    // Resolve using TownhouseSplitterService
    const splitterService = new TownhouseSplitterService(supabase);
    await splitterService.resolveSplitError(errorId, units, user.id, notes);
    
    return NextResponse.json({
      success: true,
      message: 'Split error resolved successfully',
      errorId,
      units_created: units.length,
    });
    
  } catch (error) {
    console.error('[API] Error resolving split error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve split error' },
      { status: 500 }
    );
  }
}
