import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { StableLinkerService } from '@/lib/services/StableLinkerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/campaigns/[campaignId]/orphans/[orphanId]/assign
 * 
 * Manually assign an orphaned address to a building
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; orphanId: string }> }
) {
  const { campaignId, orphanId } = await params;
  
  console.log(`[API] POST /campaigns/${campaignId}/orphans/${orphanId}/assign`);
  
  try {
    const supabase = await getSupabaseServerClient();
    
    // Check if user is authenticated
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
    
    // Get request body
    const body = await request.json();
    const { buildingId } = body;
    
    if (!buildingId) {
      return NextResponse.json(
        { error: 'buildingId is required' },
        { status: 400 }
      );
    }
    
    // Assign orphan using StableLinkerService
    const linkerService = new StableLinkerService(supabase);
    await linkerService.assignOrphan(orphanId, buildingId, user.id);
    
    return NextResponse.json({
      success: true,
      message: 'Orphan assigned successfully',
      orphanId,
      buildingId,
    });
    
  } catch (error) {
    console.error('[API] Error assigning orphan:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to assign orphan' },
      { status: 500 }
    );
  }
}
