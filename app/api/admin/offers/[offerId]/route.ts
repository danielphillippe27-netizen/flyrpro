import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';

type PartnerOfferRow = {
  id: string;
  token: string;
  recipient_name: string | null;
  recipient_email: string | null;
  partner_name: string;
  offer_title: string;
  offer_message: string | null;
  cta_label: string | null;
  cta_url: string | null;
  max_views: number | null;
  view_count: number;
  expires_at: string;
  last_viewed_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function computeStatus(row: PartnerOfferRow): 'active' | 'expired' | 'revoked' | 'maxed' {
  if (row.revoked_at) return 'revoked';
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  if (row.max_views != null && row.view_count >= row.max_views) return 'maxed';
  return 'active';
}

function toClientOffer(row: PartnerOfferRow, origin: string) {
  return {
    id: row.id,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    partnerName: row.partner_name,
    offerTitle: row.offer_title,
    offerMessage: row.offer_message,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    maxViews: row.max_views,
    viewCount: row.view_count,
    expiresAt: row.expires_at,
    lastViewedAt: row.last_viewed_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    status: computeStatus(row),
    shareUrl: `${origin}/partner-offer/${row.token}`,
  };
}

type Params = {
  params: Promise<{ offerId: string }>;
};

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { offerId } = await params;
    if (!offerId) {
      return NextResponse.json({ error: 'Offer id is required' }, { status: 400 });
    }

    const { data, error } = await auth.admin
      .from('partner_offers')
      .select(
        'id, token, recipient_name, recipient_email, partner_name, offer_title, offer_message, cta_label, cta_url, max_views, view_count, expires_at, last_viewed_at, revoked_at, created_at'
      )
      .eq('id', offerId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    const row = data as PartnerOfferRow;
    return NextResponse.json({ offer: toClientOffer(row, request.nextUrl.origin) });
  } catch (error) {
    console.error('[api/admin/offers/:offerId] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
