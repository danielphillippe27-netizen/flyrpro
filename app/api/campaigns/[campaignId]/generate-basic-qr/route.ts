import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params;
    const body = await request.json().catch(() => ({}));
    const baseUrl = body.baseUrl || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;

    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const trackingUrl = `${baseUrl.replace(/\/$/, '')}/api/scan?campaignId=${campaignId}&basic=true`;

    const qrBase64 = await QRCode.toDataURL(trackingUrl, {
      type: 'image/png',
      width: 512,
      margin: 2,
    });

    return NextResponse.json({ qrBase64, trackingUrl });
  } catch (error) {
    console.error('Generate basic QR error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
