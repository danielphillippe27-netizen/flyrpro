import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import {
  PARTNER_OFFER_SELECT,
  type PartnerOfferRow,
  toClientPartnerOffer,
} from '@/lib/offers/partnerOfferRecord';
import { resolveUniquePartnerOfferSlug } from '@/lib/offers/partnerOfferSlug';

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

function parseOptionalBoolean(value: unknown): boolean | null {
  return value === true ? true : value === false ? false : null;
}

function parseOptionalEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
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
      .select(PARTNER_OFFER_SELECT)
      .eq('id', offerId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    const row = data as PartnerOfferRow;
    return NextResponse.json({ offer: toClientPartnerOffer(row, request.nextUrl.origin) });
  } catch (error) {
    console.error('[api/admin/offers/:offerId] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { offerId } = await params;
    if (!offerId) {
      return NextResponse.json({ error: 'Offer id is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const recipientName = parseOptionalString(body?.recipientName, 120);
    const recipientEmail =
      body?.recipientEmail === '' || body?.recipientEmail == null
        ? null
        : parseOptionalEmail(body?.recipientEmail);
    const partnerName = parseOptionalString(body?.partnerName, 160);
    const offerTitle = parseOptionalString(body?.offerTitle, 180);
    const offerMessage = parseOptionalString(body?.offerMessage, 5000);
    const ctaLabel = parseOptionalString(body?.ctaLabel, 80);
    const ctaUrl = parseOptionalString(body?.ctaUrl, 500);
    const vanitySlugInput = parseOptionalString(body?.vanitySlug, 160);
    const maxViews = parseOptionalPositiveInt(body?.maxViews);
    const expiresAtRaw = parseOptionalString(body?.expiresAt, 80);
    const isDraft = parseOptionalBoolean(body?.draft);
    const revoke = body?.revoke === true;

    if (body?.recipientEmail && !recipientEmail) {
      return NextResponse.json({ error: 'Recipient email is invalid' }, { status: 400 });
    }

    let expiresAtIso: string | undefined;
    if (expiresAtRaw) {
      const expiresAtMs = new Date(expiresAtRaw).getTime();
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
        return NextResponse.json({ error: 'Expiry must be in the future' }, { status: 400 });
      }
      expiresAtIso = new Date(expiresAtMs).toISOString();
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

    const updates: Record<string, string | number | boolean | null> = {};
    if ('vanitySlug' in body || 'partnerName' in body) {
      const slugSeed = vanitySlugInput || partnerName || offerTitle || 'offer';
      updates.vanity_slug = await resolveUniquePartnerOfferSlug(auth.admin, slugSeed, offerId);
    }
    if ('recipientName' in body) updates.recipient_name = recipientName;
    if ('recipientEmail' in body) updates.recipient_email = recipientEmail;
    if ('partnerName' in body) updates.partner_name = partnerName || 'Untitled partner';
    if ('offerTitle' in body) updates.offer_title = offerTitle ?? '';
    if ('offerMessage' in body) updates.offer_message = offerMessage;
    if ('ctaLabel' in body) updates.cta_label = ctaLabel;
    if ('ctaUrl' in body) updates.cta_url = ctaUrl;
    if ('maxViews' in body) updates.max_views = maxViews;
    if (expiresAtIso) updates.expires_at = expiresAtIso;
    if (isDraft !== null) updates.is_draft = isDraft;
    if (revoke) updates.revoked_at = new Date().toISOString();

    const shouldValidateForPublish = isDraft === false;
    if (shouldValidateForPublish) {
      if (!partnerName) {
        return NextResponse.json({ error: 'Partner/company is required' }, { status: 400 });
      }
      if (!offerTitle) {
        return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
      }
      if (!expiresAtRaw) {
        return NextResponse.json({ error: 'Expiry is required' }, { status: 400 });
      }
    }

    const { data, error } = await auth.admin
      .from('partner_offers')
      .update(updates)
      .eq('id', offerId)
      .select(PARTNER_OFFER_SELECT)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }

    const row = data as PartnerOfferRow;
    return NextResponse.json({ offer: toClientPartnerOffer(row, request.nextUrl.origin) });
  } catch (error) {
    console.error('[api/admin/offers/:offerId] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
