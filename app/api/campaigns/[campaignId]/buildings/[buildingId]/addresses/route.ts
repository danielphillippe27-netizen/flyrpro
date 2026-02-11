import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AddressResult {
  address_id: string;
  formatted: string;
  house_number: string | null;
  street_name: string | null;
  unit_number: string | null;
  match_type: string;
  confidence: number;
  distance_meters: number;
  is_outside_footprint: boolean;
  geom: {
    type: 'Point';
    coordinates: [number, number];
  };
}

/**
 * GET /api/campaigns/[campaignId]/buildings/[buildingId]/addresses
 * 
 * Returns all addresses linked to a specific building.
 * Includes flags for addresses outside the building footprint.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; buildingId: string }> }
) {
  const { campaignId, buildingId } = await params;
  
  console.log(`[API] GET /campaigns/${campaignId}/buildings/${buildingId}/addresses`);
  
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
    
    // Get threshold for "outside footprint" warning
    const outsideThreshold = parseFloat(process.env.ADDRESS_OUTSIDE_THRESHOLD_METERS || '10');
    
    // Fetch addresses linked to this building
    const { data: links, error: linksError } = await supabase
      .from('building_address_links')
      .select(`
        address_id,
        match_type,
        confidence,
        distance_meters,
        campaign_addresses:campaign_addresses!inner (
          id,
          formatted,
          house_number,
          street_name,
          unit_number,
          geom
        )
      `)
      .eq('campaign_id', campaignId)
      .eq('building_id', buildingId)
      .order('confidence', { ascending: false });
    
    if (linksError) {
      throw new Error(`Failed to fetch addresses: ${linksError.message}`);
    }
    
    // Format response with outside footprint flag
    const addresses: AddressResult[] = (links || []).map((link: any) => ({
      address_id: link.address_id,
      formatted: link.campaign_addresses.formatted,
      house_number: link.campaign_addresses.house_number,
      street_name: link.campaign_addresses.street_name,
      unit_number: link.campaign_addresses.unit_number,
      match_type: link.match_type,
      confidence: link.confidence,
      distance_meters: link.distance_meters,
      is_outside_footprint: link.distance_meters > outsideThreshold,
      geom: link.campaign_addresses.geom,
    }));
    
    // Calculate summary
    const outsideCount = addresses.filter(a => a.is_outside_footprint).length;
    
    return NextResponse.json({
      success: true,
      building_id: buildingId,
      campaign_id: campaignId,
      addresses,
      summary: {
        total: addresses.length,
        outside_footprint: outsideCount,
        inside_footprint: addresses.length - outsideCount,
      },
    });
    
  } catch (error) {
    console.error('[API] Error fetching building addresses:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch addresses' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/campaigns/[campaignId]/buildings/[buildingId]/addresses
 * 
 * Manually link an address to a building.
 * Body: { address_id: string, unit_label?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; buildingId: string }> }
) {
  const { campaignId, buildingId } = await params;
  
  console.log(`[API] POST /campaigns/${campaignId}/buildings/${buildingId}/addresses`);
  
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
    const { address_id, unit_label } = body;
    
    if (!address_id) {
      return NextResponse.json(
        { error: 'address_id is required' },
        { status: 400 }
      );
    }
    
    // Check if address is already linked to a different building
    const { data: existingLink } = await supabase
      .from('building_address_links')
      .select('building_id, confidence')
      .eq('campaign_id', campaignId)
      .eq('address_id', address_id)
      .maybeSingle();
    
    if (existingLink && existingLink.building_id !== buildingId) {
      // If existing link has high confidence, warn user
      if (existingLink.confidence >= 0.85) {
        return NextResponse.json({
          success: false,
          warning: 'address_already_linked',
          message: `Address is already linked to building ${existingLink.building_id} with high confidence (${existingLink.confidence.toFixed(2)})`,
          existing_building_id: existingLink.building_id,
          existing_confidence: existingLink.confidence,
        }, { status: 409 });
      }
    }
    
    // Upsert the link
    const { error: upsertError } = await supabase
      .from('building_address_links')
      .upsert({
        campaign_id: campaignId,
        building_id: buildingId,
        address_id: address_id,
        match_type: 'manual',
        confidence: 1.0,
        modified_at: new Date().toISOString(),
      }, {
        onConflict: 'campaign_id,address_id',
      });
    
    if (upsertError) {
      throw new Error(`Failed to link address: ${upsertError.message}`);
    }
    
    return NextResponse.json({
      success: true,
      message: 'Address linked successfully',
      building_id: buildingId,
      address_id,
      unit_label: unit_label || null,
    });
    
  } catch (error) {
    console.error('[API] Error linking address:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to link address' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/campaigns/[campaignId]/buildings/[buildingId]/addresses
 * 
 * Unlink an address from a building.
 * Query param: address_id
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; buildingId: string }> }
) {
  const { campaignId, buildingId } = await params;
  
  console.log(`[API] DELETE /campaigns/${campaignId}/buildings/${buildingId}/addresses`);
  
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
    
    // Get address_id from query params
    const { searchParams } = new URL(request.url);
    const address_id = searchParams.get('address_id');
    
    if (!address_id) {
      return NextResponse.json(
        { error: 'address_id query parameter is required' },
        { status: 400 }
      );
    }
    
    // Delete the link
    const { error: deleteError } = await supabase
      .from('building_address_links')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('building_id', buildingId)
      .eq('address_id', address_id);
    
    if (deleteError) {
      throw new Error(`Failed to unlink address: ${deleteError.message}`);
    }
    
    return NextResponse.json({
      success: true,
      message: 'Address unlinked successfully',
      building_id: buildingId,
      address_id,
    });
    
  } catch (error) {
    console.error('[API] Error unlinking address:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to unlink address' },
      { status: 500 }
    );
  }
}
