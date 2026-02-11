import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    // Extract addressId from searchParams
    const addressId = request.nextUrl.searchParams.get('id');

    if (!addressId) {
      return NextResponse.json(
        { error: 'Address ID is required' },
        { status: 400 }
      );
    }

    // Use admin client to bypass RLS for tracking
    const supabase = createAdminClient();

    // Fetch address to get campaign_id
    const { data: address, error: addressError } = await supabase
      .from('campaign_addresses')
      .select('campaign_id')
      .eq('id', addressId)
      .single();

    if (addressError || !address) {
      console.error('Error fetching address:', addressError);
      // Redirect to welcome page even if address lookup fails
      const welcomeUrl = new URL('/welcome', request.url);
      welcomeUrl.searchParams.set('id', addressId);
      return NextResponse.redirect(welcomeUrl, { status: 302 });
    }

    // Look up the building using the stable linker (building_address_links table)
    // This is more reliable than matching by gers_id because:
    // 1. Overture Address GERS IDs and Building GERS IDs are different
    // 2. The linker explicitly maps address_id → building_id
    let buildingId: string | null = null;
    let buildingGersId: string | null = null;
    
    try {
      const { data: link, error: linkError } = await supabase
        .from('building_address_links')
        .select('building_id, buildings!inner(id, gers_id)')
        .eq('address_id', addressId)
        .eq('campaign_id', address.campaign_id)
        .single();

      if (!linkError && link) {
        buildingId = link.building_id;
        // TypeScript: link.buildings is the joined building record
        const building = link.buildings as { id: string; gers_id: string | null };
        buildingGersId = building?.gers_id || null;
        console.log('Found building via stable linker:', { buildingId, buildingGersId });
      } else {
        console.warn('No building_address_link found for address:', addressId, linkError?.message);
      }
    } catch (linkLookupError) {
      console.error('Failed to lookup building via linker:', linkLookupError);
    }

    // Insert scan event if we found a building
    if (buildingId) {
      try {
        const { error: scanEventError } = await supabase
          .from('scan_events')
          .insert({
            building_id: buildingId,
            campaign_id: address.campaign_id,
            address_id: addressId,
            scanned_at: new Date().toISOString(),
          });

        if (scanEventError) {
          console.error('Error inserting scan event:', scanEventError);
          // Continue with redirect even if scan event insertion fails
        }
      } catch (scanEventInsertError) {
        console.error('Failed to insert scan event:', scanEventInsertError);
        // Continue with redirect even if scan event insertion fails
      }
    }

    // IMPORTANT: Update building_stats using the BUILDING's gers_id (not address gers_id)
    // This ensures the map updates correctly because the RPC joins building_stats on buildings.gers_id
    // Using the stable linker's buildingGersId ensures perfect matching with the 3D buildings
    if (buildingGersId) {
      try {
        // Use the RPC function for atomic upsert (handles both insert and update cases)
        const { error: rpcError } = await supabase.rpc('increment_building_scans', {
          p_gers_id: buildingGersId,
          p_campaign_id: address.campaign_id,
        });
        
        if (rpcError) {
          console.error('Error incrementing building scans via RPC:', rpcError);
          
          // Fallback: Try direct insert/update
          const { error: directError } = await supabase
            .from('building_stats')
            .upsert({
              gers_id: buildingGersId,
              campaign_id: address.campaign_id,
              scans_total: 1,
              scans_today: 1,
              status: 'visited',
              last_scan_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'gers_id',
            });
          
          if (directError) {
            console.error('Error with direct building_stats upsert:', directError);
          } else {
            console.log('Direct upsert succeeded for building gers_id:', buildingGersId);
          }
        } else {
          console.log('Updated building_stats via RPC for building gers_id:', buildingGersId);
        }
      } catch (statsInsertError) {
        console.error('Failed to update building_stats:', statsInsertError);
      }
    } else {
      console.warn('No building gers_id found (no stable link), cannot update building_stats for map. Address:', addressId);
    }

    // Track the scan using the secure RPC function (legacy tracking)
    try {
      const { error: scanError } = await supabase.rpc('increment_scan', {
        row_id: addressId,
      });

      if (scanError) {
        console.error('Error tracking scan:', scanError);
        // Continue with redirect even if tracking fails
      }
    } catch (trackingError) {
      console.error('Failed to track scan:', trackingError);
      // Continue with redirect even if tracking fails
    }

    // Fetch campaign to get video_url
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('video_url')
      .eq('id', address.campaign_id)
      .single();

    if (campaignError) {
      console.error('Error fetching campaign:', campaignError);
    }

    // Check if video_url exists and is not empty
    if (campaign?.video_url && campaign.video_url.trim() !== '') {
      // Redirect to video URL
      return NextResponse.redirect(campaign.video_url, { status: 302 });
    }

    // Fallback: Redirect to welcome page
    const welcomeUrl = new URL('/welcome', request.url);
    welcomeUrl.searchParams.set('id', addressId);
    return NextResponse.redirect(welcomeUrl, { status: 302 });
  } catch (error) {
    console.error('Error in scan handler:', error);
    // Fallback to welcome page on any error
    const addressId = request.nextUrl.searchParams.get('id');
    if (addressId) {
      const welcomeUrl = new URL('/welcome', request.url);
      welcomeUrl.searchParams.set('id', addressId);
      return NextResponse.redirect(welcomeUrl, { status: 302 });
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
