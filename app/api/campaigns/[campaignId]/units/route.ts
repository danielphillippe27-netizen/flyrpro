import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { TownhouseSplitterService } from '@/lib/services/TownhouseSplitterService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/campaigns/[campaignId]/units
 * 
 * Returns all building units for a campaign as GeoJSON FeatureCollection
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  
  console.log(`[API] GET /campaigns/${campaignId}/units`);
  
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
    
    // Get units using database function
    const { data: unitsGeoJSON, error: funcError } = await supabase
      .rpc('get_campaign_units_geojson', { p_campaign_id: campaignId });
    
    if (funcError) {
      throw new Error(`Failed to fetch units: ${funcError.message}`);
    }
    
    // Get summary statistics
    const { data: summary } = await supabase
      .from('campaign_unit_summary')
      .select('*')
      .eq('campaign_id', campaignId)
      .single();
    
    return NextResponse.json({
      success: true,
      type: 'FeatureCollection',
      features: unitsGeoJSON?.features || [],
      summary: summary || {
        total_units: 0,
        townhouse_units: 0,
        apartment_units: 0,
        not_visited: 0,
        visited: 0,
      },
    });
    
  } catch (error) {
    console.error('[API] Error fetching units:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch units' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/campaigns/[campaignId]/units
 * 
 * Update unit status or notes
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  
  console.log(`[API] POST /campaigns/${campaignId}/units`);
  
  try {
    const supabase = await getSupabaseServerClient();
    
    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Verify campaign ownership and get workspace for team activity
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('owner_id, workspace_id')
      .eq('id', campaignId)
      .single();
    
    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    
    if (campaign.owner_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    
    const body = await request.json();
    const { unitId, status, notes } = body;
    
    if (!unitId) {
      return NextResponse.json(
        { error: 'unitId is required' },
        { status: 400 }
      );
    }
    
    // Update unit
    const updates: any = {};
    
    if (status) {
      updates.status = status;
      if (status === 'visited') {
        updates.visited_at = new Date().toISOString();
        updates.visited_by = user.id;
      }
    }
    
    if (notes !== undefined) {
      updates.notes = notes;
    }
    
    const { error: updateError } = await supabase
      .from('building_units')
      .update(updates)
      .eq('id', unitId)
      .eq('campaign_id', campaignId);
    
    if (updateError) {
      throw new Error(`Failed to update unit: ${updateError.message}`);
    }

    // Team activity: record knock when marking as visited
    const workspaceId = campaign.workspace_id;
    if (status === 'visited' && workspaceId) {
      const admin = (await import('@/lib/supabase/server')).createAdminClient();
      await admin.from('session_events').insert({
        workspace_id: workspaceId,
        user_id: user.id,
        event_type: 'knock',
        event_time: new Date().toISOString(),
        payload: { unit_id: unitId, campaign_id: campaignId },
      });
    }
    
    return NextResponse.json({
      success: true,
      message: 'Unit updated successfully',
      unitId,
      updates,
    });
    
  } catch (error) {
    console.error('[API] Error updating unit:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update unit' },
      { status: 500 }
    );
  }
}
