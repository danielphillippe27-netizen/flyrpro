import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface NearbyAddress {
  address_id: string;
  formatted: string;
  house_number: string | null;
  street_name: string | null;
  distance_meters: number;
  geom: {
    type: 'Point';
    coordinates: [number, number];
  };
}

/**
 * GET /api/campaigns/[campaignId]/buildings/[buildingId]/nearby-addresses
 * 
 * Returns nearby addresses that are not yet linked to any building.
 * Used for "Add Address" UI when manually linking addresses.
 * 
 * Query params:
 * - radius: Search radius in meters (default: 50)
 * - limit: Max results (default: 20)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { campaignId: string; buildingId: string } }
) {
  const { campaignId, buildingId } = params;
  
  console.log(`[API] GET /campaigns/${campaignId}/buildings/${buildingId}/nearby-addresses`);
  
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
    
    // Parse query params
    const { searchParams } = new URL(request.url);
    const radius = parseFloat(searchParams.get('radius') || '50');
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    
    // Use the RPC function to get nearby unlinked addresses
    const { data, error } = await supabase
      .rpc('get_nearby_unlinked_addresses', {
        p_campaign_id: campaignId,
        p_building_id: buildingId,
        p_radius_meters: radius,
        p_limit: limit,
      });
    
    if (error) {
      // Fallback if RPC doesn't exist yet - query directly
      console.log('[API] RPC not available, using fallback query');
      
      const { data: fallbackData, error: fallbackError } = await supabase
        .from('campaign_addresses')
        .select(`
          id,
          formatted,
          house_number,
          street_name,
          geom
        `)
        .eq('campaign_id', campaignId)
        .limit(limit);
      
      if (fallbackError) {
        throw new Error(`Failed to fetch nearby addresses: ${fallbackError.message}`);
      }
      
      // Filter out already linked addresses
      const linkedIds = new Set(
        (await supabase
          .from('building_address_links')
          .select('address_id')
          .eq('campaign_id', campaignId)
        ).data?.map(l => l.address_id) || []
      );
      
      const unlinked = (fallbackData || [])
        .filter(a => !linkedIds.has(a.id))
        .map((a: any) => ({
          address_id: a.id,
          formatted: a.formatted,
          house_number: a.house_number,
          street_name: a.street_name,
          distance_meters: 0, // Unknown without PostGIS
          geom: a.geom,
        }));
      
      return NextResponse.json({
        success: true,
        building_id: buildingId,
        addresses: unlinked,
        note: 'Distance calculation requires PostGIS',
      });
    }
    
    const addresses: NearbyAddress[] = (data || []).map((row: any) => ({
      address_id: row.address_id,
      formatted: row.formatted,
      house_number: row.house_number,
      street_name: row.street_name,
      distance_meters: row.distance_meters,
      geom: row.geom,
    }));
    
    return NextResponse.json({
      success: true,
      building_id: buildingId,
      radius_meters: radius,
      addresses,
    });
    
  } catch (error) {
    console.error('[API] Error fetching nearby addresses:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch nearby addresses' },
      { status: 500 }
    );
  }
}
