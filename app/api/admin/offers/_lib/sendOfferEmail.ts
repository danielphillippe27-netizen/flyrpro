import { createAdminClient } from '@/lib/supabase/server';
import { sendPartnerOfferEmail } from '@/lib/email/partnerOffers';
import {
  PARTNER_OFFER_SELECT,
  type PartnerOfferRow,
  toClientPartnerOffer,
} from '@/lib/offers/partnerOfferRecord';

type ClientOffer = ReturnType<typeof toClientPartnerOffer>;

type SendOfferEmailResult =
  | {
      ok: true;
      emailSent: true;
      offer: ClientOffer;
      resendMessageId: string | null;
      emailError: null;
    }
  | {
      ok: false;
      emailSent: false;
      offer: ClientOffer;
      resendMessageId: null;
      emailError: string;
    };

function getEmailRecipient(offer: PartnerOfferRow): string | null {
  return offer.recipient_email?.trim().toLowerCase() || null;
}

export function validateOfferEmailFields(offer: PartnerOfferRow): string | null {
  const email = getEmailRecipient(offer);
  if (!email) {
    return 'Recipient email is required before sending this offer.';
  }

  if (!offer.partner_name?.trim()) {
    return 'Partner/company is required before sending this offer.';
  }

  if (!offer.offer_title?.trim()) {
    return 'Offer title is required before sending this offer.';
  }

  if (!offer.expires_at) {
    return 'Expiry is required before sending this offer.';
  }

  return null;
}

export async function sendOfferEmailForRow(params: {
  offer: PartnerOfferRow;
  origin: string;
}): Promise<SendOfferEmailResult> {
  const { offer, origin } = params;
  const admin = createAdminClient();
  const emailValidationError = validateOfferEmailFields(offer);
  const emailRecipient = getEmailRecipient(offer);

  if (emailValidationError || !emailRecipient) {
    const { data } = await admin
      .from('partner_offers')
      .update({
        email_sent: false,
        email_sent_at: null,
        email_recipient: emailRecipient,
        resend_message_id: null,
        email_status: 'failed',
      })
      .eq('id', offer.id)
      .select(PARTNER_OFFER_SELECT)
      .single();

    const failedOffer = (data as PartnerOfferRow | null) ?? offer;
    return {
      ok: false,
      emailSent: false,
      resendMessageId: null,
      emailError: emailValidationError ?? 'Offer email could not be sent.',
      offer: toClientPartnerOffer(failedOffer, origin),
    };
  }

  const recipientName =
    offer.recipient_name?.trim() || offer.recipient_email?.trim() || offer.partner_name.trim();
  const offerMessage =
    offer.offer_message?.trim() || 'Private access for your team. This page is invite-only.';
  const ctaLabel = offer.cta_label?.trim() || 'Book your team onboarding';
  const privateOfferLink = `${origin}/partner-offer/${offer.token}`;
  const ctaUrl = offer.cta_url?.trim() || privateOfferLink;

  try {
    const { id: resendMessageId } = await sendPartnerOfferEmail({
      to: emailRecipient,
      recipientName,
      companyName: offer.partner_name,
      offerTitle: offer.offer_title,
      offerMessage,
      expiresAt: offer.expires_at,
      ctaLabel,
      ctaUrl,
      privateOfferLink,
    });

    const { data, error } = await admin
      .from('partner_offers')
      .update({
        email_sent: true,
        email_sent_at: new Date().toISOString(),
        email_recipient: emailRecipient,
        resend_message_id: resendMessageId,
        email_status: 'sent',
      })
      .eq('id', offer.id)
      .select(PARTNER_OFFER_SELECT)
      .single();

    if (error || !data) {
      throw new Error(error?.message ?? 'Offer email sent, but the offer record could not be updated.');
    }

    return {
      ok: true,
      emailSent: true,
      resendMessageId,
      emailError: null,
      offer: toClientPartnerOffer(data as PartnerOfferRow, origin),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Offer was created, but the email failed to send.';

    const { data } = await admin
      .from('partner_offers')
      .update({
        email_sent: false,
        email_sent_at: null,
        email_recipient: emailRecipient,
        resend_message_id: null,
        email_status: 'failed',
      })
      .eq('id', offer.id)
      .select(PARTNER_OFFER_SELECT)
      .single();

    return {
      ok: false,
      emailSent: false,
      resendMessageId: null,
      emailError: message,
      offer: toClientPartnerOffer(((data as PartnerOfferRow | null) ?? offer), origin),
    };
  }
}
