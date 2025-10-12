import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const recipientId = searchParams.get('id');

    if (!recipientId) {
      return NextResponse.redirect(new URL('/thank-you', request.url));
    }

    const supabase = createAdminClient();

    // Update recipient status
    const { error: updateError } = await supabase
      .from('campaign_recipients')
      .update({
        status: 'scanned',
        scanned_at: new Date().toISOString(),
      })
      .eq('id', recipientId);

    if (updateError) {
      console.error('Error updating recipient:', updateError);
    }

    // Get campaign destination URL
    const { data: recipient } = await supabase
      .from('campaign_recipients')
      .select('campaign_id')
      .eq('id', recipientId)
      .single();

    if (recipient) {
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('destination_url')
        .eq('id', recipient.campaign_id)
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

