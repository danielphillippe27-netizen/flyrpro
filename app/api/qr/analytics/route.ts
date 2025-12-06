import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { QRCodeService } from '@/lib/services/QRCodeService';

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();

    // Authenticate user
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { campaignId, qrCodeIds } = body;

    if (campaignId) {
      // Fetch QR codes with scan status for campaign
      const qrCodesWithScans = await QRCodeService.fetchQRCodesWithScanStatusForCampaign(supabase, campaignId);
      return NextResponse.json({ data: qrCodesWithScans });
    }

    if (qrCodeIds && Array.isArray(qrCodeIds)) {
      // Fetch scan counts for specific QR codes
      const scanData: Record<string, number> = {};
      for (const qrCodeId of qrCodeIds) {
        try {
          const count = await QRCodeService.getScanCountForQRCode(supabase, qrCodeId);
          scanData[qrCodeId] = count;
        } catch (error) {
          console.error(`Error fetching scan count for ${qrCodeId}:`, error);
          scanData[qrCodeId] = 0;
        }
      }
      return NextResponse.json({ data: scanData });
    }

    return NextResponse.json(
      { error: 'campaignId or qrCodeIds is required' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('Error fetching QR analytics:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch QR analytics' },
      { status: 500 }
    );
  }
}

