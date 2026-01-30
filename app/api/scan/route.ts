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

    // Fetch address to get campaign_id and gers_id
    const { data: address, error: addressError } = await supabase
      .from('campaign_addresses')
      .select('campaign_id, gers_id')
      .eq('id', addressId)
      .single();

    if (addressError || !address) {
      console.error('Error fetching address:', addressError);
      // Redirect to welcome page even if address lookup fails
      const welcomeUrl = new URL('/welcome', request.url);
      welcomeUrl.searchParams.set('id', addressId);
      return NextResponse.redirect(welcomeUrl, { status: 302 });
    }

    // Look up the building using GERS ID from campaign_addresses
    let buildingId: string | null = null;
    if (address.gers_id) {
      try {
        const { data: building, error: buildingError } = await supabase
          .from('buildings')
          .select('id')
          .eq('gers_id', address.gers_id)
          .single();

        if (!buildingError && building) {
          buildingId = building.id;
        } else {
          console.error('Error finding building by gers_id:', buildingError);
        }
      } catch (buildingLookupError) {
        console.error('Failed to lookup building:', buildingLookupError);
      }
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
