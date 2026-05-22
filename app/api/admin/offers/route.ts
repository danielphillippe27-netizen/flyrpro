import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getPartnerOfferMailerConfigError } from '@/lib/email/partnerOffers';
import {
  PARTNER_OFFER_SELECT,
  type PartnerOfferRow,
  toClientPartnerOffer,
} from '@/lib/offers/partnerOfferRecord';
import { resolveUniquePartnerOfferSlug } from '@/lib/offers/partnerOfferSlug';
import { sendOfferEmailForRow } from '@/app/api/admin/offers/_lib/sendOfferEmail';
import { requireOfferAccessApi } from '@/app/api/admin/offers/_lib/access';

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

function parseOptionalBoolean(value: unknown): boolean {
  return value === true;
}

function parseOptionalEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireOfferAccessApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let query = auth.admin
      .from('partner_offers')
      .select(PARTNER_OFFER_SELECT)
      .eq('is_draft', false);

    if (!auth.isFounder) {
      query = query.eq('created_by', auth.user.id);
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(100);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const origin = request.nextUrl.origin;
    const offers = ((data ?? []) as PartnerOfferRow[]).map((row) => toClientPartnerOffer(row, origin));
    return NextResponse.json({ offers });
  } catch (error) {
    console.error('[api/admin/offers] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireOfferAccessApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));

    const recipientName = parseOptionalString(body?.recipientName, 120);
    const recipientEmail = parseOptionalEmail(body?.recipientEmail);
    const partnerName = parseOptionalString(body?.partnerName, 160);
    const offerTitle = parseOptionalString(body?.offerTitle, 180);
    const offerMessage = parseOptionalString(body?.offerMessage, 5000);
    const ctaLabel = parseOptionalString(body?.ctaLabel, 80);
    const ctaUrl = parseOptionalString(body?.ctaUrl, 500);
    const vanitySlugInput = parseOptionalString(body?.vanitySlug, 160);
    const maxViews = parseOptionalPositiveInt(body?.maxViews);
    const expiresAtRaw = parseOptionalString(body?.expiresAt, 80);
    const sendOfferEmail = parseOptionalBoolean(body?.sendOfferEmail);
    const isDraft = parseOptionalBoolean(body?.draft);

    if (!partnerName && !isDraft) {
      return NextResponse.json({ error: 'Partner/company is required' }, { status: 400 });
    }
    if (!offerTitle) {
      return NextResponse.json({ error: 'Offer title is required' }, { status: 400 });
    }
    if (!expiresAtRaw) {
      return NextResponse.json({ error: 'Expiry is required' }, { status: 400 });
    }
    if (body?.recipientEmail && !recipientEmail) {
      return NextResponse.json({ error: 'Recipient email is invalid' }, { status: 400 });
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

    if (sendOfferEmail && !recipientEmail) {
      return NextResponse.json(
        { error: 'Recipient email is required when "Send offer email" is enabled' },
        { status: 400 }
      );
    }

    const emailConfigError = sendOfferEmail ? getPartnerOfferMailerConfigError() : null;
    if (emailConfigError) {
      return NextResponse.json({ error: emailConfigError }, { status: 400 });
    }

    const vanitySlug = await resolveUniquePartnerOfferSlug(
      auth.admin,
      vanitySlugInput || partnerName || offerTitle || 'offer'
    );
    const token = randomBytes(24).toString('base64url');
    const { data, error } = await auth.admin
      .from('partner_offers')
      .insert({
        token,
        vanity_slug: vanitySlug,
        is_draft: isDraft,
        recipient_name: recipientName,
        recipient_email: recipientEmail,
        partner_name: partnerName || 'Untitled partner',
        offer_title: offerTitle,
        offer_message: offerMessage,
        cta_label: ctaLabel,
        cta_url: ctaUrl,
        max_views: maxViews,
        expires_at: new Date(expiresAtMs).toISOString(),
        email_sent: false,
        email_status: sendOfferEmail ? 'failed' : 'not_requested',
        email_recipient: sendOfferEmail ? recipientEmail : null,
        created_by: auth.user.id,
      })
      .select(PARTNER_OFFER_SELECT)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Failed to create offer' }, { status: 500 });
    }

    const row = data as PartnerOfferRow;
    if (!sendOfferEmail) {
      return NextResponse.json({
        offer: toClientPartnerOffer(row, request.nextUrl.origin),
        emailSent: false,
      });
    }

    const emailResult = await sendOfferEmailForRow({
      offer: row,
      origin: request.nextUrl.origin,
    });

    return NextResponse.json({
      offer: emailResult.offer,
      emailSent: emailResult.emailSent,
      emailError: emailResult.emailError,
      resendMessageId: emailResult.resendMessageId,
    });
  } catch (error) {
    console.error('[api/admin/offers] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
