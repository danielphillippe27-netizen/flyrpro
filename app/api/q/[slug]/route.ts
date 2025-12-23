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
      .select('id, slug, destination_type, direct_url, landing_page_id, address_id')
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

    // Record scan in qr_code_scans (non-blocking - don't fail redirect if this fails)
    try {
      const userAgent = request.headers.get('user-agent') || null;
      const forwardedFor = request.headers.get('x-forwarded-for');
      const realIp = request.headers.get('x-real-ip');
      const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || null;
      const referrer = request.headers.get('referer') || request.headers.get('referrer') || null;

      const { error: scanError } = await supabase
        .from('qr_code_scans')
        .insert({
          qr_code_id: qrCode.id,
          address_id: qrCode.address_id || null,
          user_agent: userAgent,
          ip_address: ipAddress,
          referrer: referrer,
          scanned_at: new Date().toISOString(),
        });

      if (scanError) {
        console.error('Error recording QR scan:', scanError);
      }
    } catch (scanErr) {
      console.error('Failed to record QR scan:', scanErr);
      // Continue with redirect even if scan recording fails
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




