import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    if (!slug) {
      return NextResponse.json({ error: 'Slug is required' }, { status: 400 });
    }

    // Use admin client for reading QR codes (no auth required for public redirects)
    const supabase = createAdminClient();

    // Lookup QR code by slug
    const { data: qrCode, error: qrError } = await supabase
      .from('qr_codes')
      .select('id, slug, destination_type, direct_url, landing_page_id, address_id, campaign_id')
      .eq('slug', slug)
      .single();

    if (qrError || !qrCode) {
      return NextResponse.json({ error: 'QR code not found' }, { status: 404 });
    }

    let redirectUrl: string;

    // Determine destination based on destination_type
    const destinationType = qrCode.destination_type || 
      (qrCode.landing_page_id ? 'landingPage' : null);

    if (destinationType === 'landingPage' || (!destinationType && qrCode.landing_page_id)) {
      // Case A: Landing Page destination
      if (!qrCode.landing_page_id) {
        return NextResponse.json(
          { error: 'Landing page ID missing for landing page destination' },
          { status: 500 }
        );
      }

      // Fetch landing page to get its slug
      const { data: landingPage, error: landingPageError } = await supabase
        .from('campaign_landing_pages')
        .select('id, slug')
        .eq('id', qrCode.landing_page_id)
        .single();

      if (landingPageError || !landingPage) {
        return NextResponse.json(
          { error: 'Landing page not found' },
          { status: 404 }
        );
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://flyrpro.app';
      redirectUrl = `${baseUrl}/l/${landingPage.slug}`;

      // Call increment_landing_page_views RPC (non-blocking)
      try {
        const { error: rpcError } = await supabase.rpc('increment_landing_page_views', {
          landing_page_id: qrCode.landing_page_id,
        });
        if (rpcError) {
          console.error('Error incrementing landing page views:', rpcError);
        }
      } catch (rpcErr) {
        console.error('Failed to call increment_landing_page_views:', rpcErr);
      }
    } else if (destinationType === 'directLink') {
      // Case B: Direct Link destination
      if (!qrCode.direct_url) {
        return NextResponse.json(
          { error: 'Direct URL missing for direct link destination' },
          { status: 500 }
        );
      }
      redirectUrl = qrCode.direct_url;
    } else {
      return NextResponse.json(
        { error: 'Invalid destination type or missing destination' },
        { status: 500 }
      );
    }

    // Bot detection - filter out common bots and preview scanners
    const userAgent = request.headers.get('user-agent') || '';
    const isBot = /bot|crawler|spider|preview|scanner|mail|email|facebookexternalhit|linkedinbot|twitterbot|slackbot|whatsapp|telegram|skype|bingpreview|googlebot|baiduspider|yandex|sogou|exabot|facebot|ia_archiver/i.test(userAgent);
    
    // Record scan in qr_code_scans (non-blocking - don't fail redirect if this fails)
    // Only record if not a bot to maintain accurate scan rates
    if (!isBot && qrCode.address_id) {
      try {
        const forwardedFor = request.headers.get('x-forwarded-for');
        const realIp = request.headers.get('x-real-ip');
        const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || null;
        const referrer = request.headers.get('referer') || request.headers.get('referrer') || null;

        // Get address visited status and campaign_id to check if this is a unique scan
        const { data: address } = await supabase
          .from('campaign_addresses')
          .select('visited, campaign_id')
          .eq('id', qrCode.address_id)
          .single();

        // Check if this is a unique scan (first scan for this address)
        const isFirstScan = address && !address.visited;
        
        // Use campaign_id from qr_code if available, otherwise use from address
        const campaignId = qrCode.campaign_id || address?.campaign_id || null;

        // Insert scan record
        const { error: scanError } = await supabase
          .from('qr_code_scans')
          .insert({
            qr_code_id: qrCode.id,
            address_id: qrCode.address_id,
            user_agent: userAgent,
            ip_address: ipAddress,
            referrer: referrer,
            scanned_at: new Date().toISOString(),
          });

        if (scanError) {
          console.error('Error recording QR scan:', scanError);
        } else if (address && isFirstScan) {
          // Update address visited status (mark as scanned)
          await supabase
            .from('campaign_addresses')
            .update({ visited: true })
            .eq('id', qrCode.address_id);

          // Increment campaign scan count (only for first scan to track unique homes)
          if (campaignId) {
            const { data: campaign } = await supabase
              .from('campaigns')
              .select('scans')
              .eq('id', campaignId)
              .single();

            const currentScans = campaign?.scans || 0;
            await supabase
              .from('campaigns')
              .update({ scans: currentScans + 1 })
              .eq('id', campaignId);
          }
        }
      } catch (scanErr) {
        console.error('Failed to record QR scan:', scanErr);
        // Continue with redirect even if scan recording fails
      }
    } else if (isBot) {
      // Log bot scan for analytics but don't count toward scan rate
      console.log(`Bot scan detected (${userAgent.substring(0, 50)}), not counted toward scan rate`);
    }

    // Return 302 redirect
    return NextResponse.redirect(redirectUrl, { status: 302 });
  } catch (error) {
    console.error('Error in QR redirect handler:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}




