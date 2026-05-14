import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { createAdminClient } from '@/lib/supabase/server';
import { createPrintableQrPng, formatAddressLabel } from '@/lib/utils/qr-print';

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname);
  } catch {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(url);
  }
}

export async function POST(request: NextRequest) {
  try {
    // ---------------------------------------------------------
    // 1. READ DATA FROM THE BODY (The Fix)
    // ---------------------------------------------------------
    const body = await request.json();
    const { campaignId, trackable: trackableParam, baseUrl, forceRegenerate } = body;

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
      .select('id, qr_code_base64, purl, address, formatted, house_number, street_name')
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

    // By default, regenerate all addresses so visual QR style updates are applied immediately.
    // A caller can pass forceRegenerate=false to keep legacy behavior.
    const shouldRegenerateAll = forceRegenerate !== false;
    const addressesNeedingQR = shouldRegenerateAll
      ? addresses
      : addresses.filter((addr) =>
          !addr.qr_code_base64 ||
          !addr.purl ||
          isLocalhostUrl(addr.purl)
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
    
    // Default base URL - MUST use production URL for QR codes to work from phones
    // Priority: 1) Explicitly passed baseUrl, 2) NEXT_PUBLIC_APP_URL env var, 3) Production default
    const requestedBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
    const envBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
    const fallbackBaseUrl = request.nextUrl.origin;
    const domain = requestedBaseUrl && !isLocalhostUrl(requestedBaseUrl)
      ? requestedBaseUrl
      : (envBaseUrl || fallbackBaseUrl);
    
    console.log(`Using domain for QR codes: ${domain}`);

    for (const address of addressesNeedingQR) {
      try {
        const addressLabel = formatAddressLabel(address);
        const addressTag = addressLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);

        // Create the tracking URL (keeping address id as primary tracking key).
        const scanUrl = new URL('/api/scan', domain);
        scanUrl.searchParams.set('id', address.id);
        if (addressTag) {
          scanUrl.searchParams.set('addr', addressTag);
        }
        const trackingUrl = scanUrl.toString();

        // Generate a print-ready QR image (QR + address label beneath).
        const baseQrPng = await QRCode.toBuffer(trackingUrl, {
          type: 'png',
          width: 512,
          margin: 2,
        });
        const printableQrPng = await createPrintableQrPng(baseQrPng, addressLabel);
        const qrImageBase64 = `data:image/png;base64,${printableQrPng.toString('base64')}`;

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
