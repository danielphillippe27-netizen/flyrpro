import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { createAdminClient } from '@/lib/supabase/server';

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname);
  } catch {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(url);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params;
    const body = await request.json().catch(() => ({}));
    const requestedBaseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const envBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
    const fallbackBaseUrl = request.nextUrl.origin;
    const safeBaseUrl = requestedBaseUrl && !isLocalhostUrl(requestedBaseUrl)
      ? requestedBaseUrl
      : (envBaseUrl || fallbackBaseUrl);

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

    const trackingUrl = `${safeBaseUrl.replace(/\/$/, '')}/api/scan?campaignId=${campaignId}&basic=true`;

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
