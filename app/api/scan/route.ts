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

    // Track the scan using the secure RPC function
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
