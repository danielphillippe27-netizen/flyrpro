import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    // Support both 'id' (legacy) and 'addressId' (new) parameters
    const addressId = searchParams.get('addressId') || searchParams.get('id');

    if (!addressId) {
      return NextResponse.redirect(new URL('/thank-you', request.url));
    }

    const supabase = createAdminClient();

    // Update address visited status
    const { error: updateError } = await supabase
      .from('campaign_addresses')
      .update({
        visited: true,
      })
      .eq('id', addressId);

    if (updateError) {
      console.error('Error updating address:', updateError);
    }

    // Get campaign destination URL
    const { data: address } = await supabase
      .from('campaign_addresses')
      .select('campaign_id')
      .eq('id', addressId)
      .single();

    if (address) {
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('destination_url')
        .eq('id', address.campaign_id)
        .single();

      if (campaign?.destination_url) {
        return NextResponse.redirect(campaign.destination_url);
      }
    }

    return NextResponse.redirect(new URL('/thank-you', request.url));
  } catch (error) {
    console.error('Error in open route:', error);
    return NextResponse.redirect(new URL('/thank-you', request.url));
  }
}

