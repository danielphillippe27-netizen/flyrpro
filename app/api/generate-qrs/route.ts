import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    // ---------------------------------------------------------
    // 1. READ DATA FROM THE BODY (The Fix)
    // ---------------------------------------------------------
    const body = await request.json();
    const { campaignId, trackable: trackableParam, baseUrl } = body;

    console.log("Generating QRs for Campaign:", campaignId);
    console.log("Received Body:", body); // <--- CHECK YOUR TERMINAL FOR THIS

    if (!campaignId) {
      console.error("Error: Missing campaignId");
      return NextResponse.json({ error: 'Missing campaignId in request body' }, { status: 400 });
    }

    // Initialize Supabase Admin Client
    const supabase = createAdminClient();

    // ---------------------------------------------------------
    // 2. FETCH ADDRESSES
    // ---------------------------------------------------------
    console.log("Fetching addresses for campaignId:", campaignId);
    
    // First, try to fetch all addresses for this campaign
    const { data: addresses, error } = await supabase
      .from('campaign_addresses')
      .select('id, qr_code_base64')
      .eq('campaign_id', campaignId);

    if (error) {
      console.error("Supabase Error Details:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      return NextResponse.json({ 
        error: 'Could not fetch addresses',
        details: error.message 
      }, { status: 500 });
    }

    console.log(`Found ${addresses?.length || 0} total addresses for campaign`);

    if (!addresses || addresses.length === 0) {
      return NextResponse.json({ 
        success: true, 
        count: 0,
        message: 'No addresses found for this campaign' 
      });
    }

    // Filter addresses that don't have QR codes yet (qr_code_base64 is null)
    const addressesNeedingQR = addresses.filter(addr => 
      !addr.qr_code_base64
    );

    console.log(`${addressesNeedingQR.length} addresses need QR codes`);

    if (addressesNeedingQR.length === 0) {
      return NextResponse.json({ 
        success: true, 
        count: 0,
        message: 'All addresses already have QR codes' 
      });
    }

    // ---------------------------------------------------------
    // 3. GENERATE QR CODES
    // ---------------------------------------------------------
    let count = 0;
    
    // Default base URL if not provided
    const domain = baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    for (const address of addressesNeedingQR) {
      try {
        // Create the tracking URL
        const trackingUrl = `${domain}/api/scan?id=${address.id}`;

        // Generate Base64 QR Image
        const qrImageBase64 = await QRCode.toDataURL(trackingUrl, {
          type: 'image/png',
          width: 512,
          margin: 2,
        });

        // Save to Supabase
        const { error: updateError } = await supabase
          .from('campaign_addresses')
          .update({ 
            qr_code_base64: qrImageBase64,  // ✅ Base64 QR code (new way)
            purl: trackingUrl              // ✅ Tracking URL
            // ❌ Removed qr_png_url - using base64 instead
          })
          .eq('id', address.id);

        if (updateError) {
          console.error(`Error updating address ${address.id}:`, updateError);
          continue;
        }

        count++;
      } catch (error) {
        console.error(`Error generating QR for address ${address.id}:`, error);
        // Continue processing other addresses even if one fails
      }
    }

    return NextResponse.json({ 
      success: true, 
      count,
      message: `Generated ${count} QR codes successfully` 
    });

  } catch (error) {
    console.error("GENERATE QR ERROR:", error);
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : 'Internal Server Error' 
    }, { status: 500 });
  }
}
