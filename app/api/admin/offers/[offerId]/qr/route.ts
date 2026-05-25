import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import {
  PARTNER_OFFER_SELECT,
  type PartnerOfferRow,
  toClientPartnerOffer,
} from '@/lib/offers/partnerOfferRecord';
import { requireOfferAccessApi } from '@/app/api/admin/offers/_lib/access';

function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(parsed.hostname);
  } catch {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/i.test(url);
  }
}

type Params = { params: Promise<{ offerId: string }> };

/**
 * Partner-offer QR: same PNG settings as POST /api/campaigns/[id]/generate-basic-qr (512px, margin 2).
 * Encodes the public offer URL (vanity slug or /partner-offer/:token).
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireOfferAccessApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { offerId } = await params;
    if (!offerId) {
      return NextResponse.json({ error: 'Offer id is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const requestedBaseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const envBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
    const fallbackBaseUrl = request.nextUrl.origin;
    const safeBaseUrl =
      requestedBaseUrl && !isLocalhostUrl(requestedBaseUrl)
        ? requestedBaseUrl
        : envBaseUrl || fallbackBaseUrl;

    const origin = safeBaseUrl.replace(/\/$/, '');

    let query = auth.admin
      .from('partner_offers')
      .select(PARTNER_OFFER_SELECT)
      .eq('id', offerId);

    if (!auth.isFounder) {
      query = query.eq('created_by', auth.user.id);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    const row = data as PartnerOfferRow;
    const { shareUrl: targetUrl } = toClientPartnerOffer(row, origin);

    const qrBase64 = await QRCode.toDataURL(targetUrl, {
      type: 'image/png',
      width: 512,
      margin: 2,
    });

    return NextResponse.json({ qrBase64, targetUrl });
  } catch (error) {
    console.error('[api/admin/offers/:offerId/qr] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
