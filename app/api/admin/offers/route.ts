import { randomBytes } from 'node:crypto';
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

function parseOptionalString(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function parseOptionalPositiveInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
}

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

export async function GET(request: NextRequest) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { data, error } = await auth.admin
      .from('partner_offers')
      .select(
        'id, token, recipient_name, recipient_email, partner_name, offer_title, offer_message, cta_label, cta_url, max_views, view_count, expires_at, last_viewed_at, revoked_at, created_at'
      )
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const origin = request.nextUrl.origin;
    const offers = ((data ?? []) as PartnerOfferRow[]).map((row) => toClientOffer(row, origin));
    return NextResponse.json({ offers });
  } catch (error) {
    console.error('[api/admin/offers] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));

    const recipientName = parseOptionalString(body?.recipientName, 120);
    const recipientEmail = parseOptionalString(body?.recipientEmail, 254)?.toLowerCase() ?? null;
    const partnerName = parseOptionalString(body?.partnerName, 160);
    const offerTitle = parseOptionalString(body?.offerTitle, 180);
    const offerMessage = parseOptionalString(body?.offerMessage, 5000);
    const ctaLabel = parseOptionalString(body?.ctaLabel, 80);
    const ctaUrl = parseOptionalString(body?.ctaUrl, 500);
    const maxViews = parseOptionalPositiveInt(body?.maxViews);
    const expiresAtRaw = parseOptionalString(body?.expiresAt, 80);

    if (!partnerName) {
      return NextResponse.json({ error: 'Partner/company is required' }, { status: 400 });
    }
    if (!offerTitle) {
      return NextResponse.json({ error: 'Offer title is required' }, { status: 400 });
    }
    if (!expiresAtRaw) {
      return NextResponse.json({ error: 'Expiry is required' }, { status: 400 });
    }

    const expiresAtMs = new Date(expiresAtRaw).getTime();
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      return NextResponse.json({ error: 'Expiry must be in the future' }, { status: 400 });
    }

    if (ctaUrl) {
      try {
        const parsed = new URL(ctaUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return NextResponse.json({ error: 'CTA URL must be http(s)' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'CTA URL is invalid' }, { status: 400 });
      }
    }

    const token = randomBytes(24).toString('base64url');
    const { data, error } = await auth.admin
      .from('partner_offers')
      .insert({
        token,
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        partner_name: partnerName,
        offer_title: offerTitle,
        offer_message: offerMessage,
        cta_label: ctaLabel,
        cta_url: ctaUrl,
        max_views: maxViews,
        expires_at: new Date(expiresAtMs).toISOString(),
        created_by: auth.user.id,
      })
      .select(
        'id, token, recipient_name, recipient_email, partner_name, offer_title, offer_message, cta_label, cta_url, max_views, view_count, expires_at, last_viewed_at, revoked_at, created_at'
      )
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Failed to create offer' }, { status: 500 });
    }

    const row = data as PartnerOfferRow;
    return NextResponse.json({ offer: toClientOffer(row, request.nextUrl.origin) });
  } catch (error) {
    console.error('[api/admin/offers] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
