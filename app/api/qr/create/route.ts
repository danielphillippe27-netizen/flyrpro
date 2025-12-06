import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { QRCodeService } from '@/lib/services/QRCodeService';
import type { CreateQRCodeArgs } from '@/lib/services/QRCodeService';

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
    const {
      campaignId,
      addressId,
      destinationType,
      landingPageId,
      directUrl,
      qrVariant,
    } = body;

    // Validate required fields
    if (!destinationType) {
      return NextResponse.json(
        { error: 'destinationType is required' },
        { status: 400 }
      );
    }

    if (destinationType === 'landingPage' && !landingPageId) {
      return NextResponse.json(
        { error: 'landingPageId is required for landingPage destination' },
        { status: 400 }
      );
    }

    if (destinationType === 'directLink' && !directUrl) {
      return NextResponse.json(
        { error: 'directUrl is required for directLink destination' },
        { status: 400 }
      );
    }

    // Validate directUrl format if provided
    if (directUrl && !directUrl.match(/^https?:\/\//)) {
      return NextResponse.json(
        { error: 'directUrl must start with http:// or https://' },
        { status: 400 }
      );
    }

    // Create QR code
    const args: CreateQRCodeArgs = {
      campaignId: campaignId || null,
      addressId: addressId || null,
      destinationType,
      landingPageId: landingPageId || null,
      directUrl: directUrl || null,
      qrVariant: qrVariant || null,
    };

    const qrCode = await QRCodeService.createQRCodeWithDestination(args);

    return NextResponse.json({ data: qrCode }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating QR code:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create QR code' },
      { status: 500 }
    );
  }
}

