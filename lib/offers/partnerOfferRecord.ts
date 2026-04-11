export type PartnerOfferEmailStatus = 'not_requested' | 'sent' | 'failed';

export type PartnerOfferRow = {
  id: string;
  token: string;
  vanity_slug: string | null;
  is_draft: boolean | null;
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
  email_sent: boolean | null;
  email_sent_at: string | null;
  email_recipient: string | null;
  resend_message_id: string | null;
  email_status: PartnerOfferEmailStatus | null;
};

export const PARTNER_OFFER_SELECT =
  'id, token, vanity_slug, is_draft, recipient_name, recipient_email, partner_name, offer_title, offer_message, cta_label, cta_url, max_views, view_count, expires_at, last_viewed_at, revoked_at, created_at, email_sent, email_sent_at, email_recipient, resend_message_id, email_status';

export function computePartnerOfferStatus(
  row: PartnerOfferRow
): 'active' | 'expired' | 'revoked' | 'maxed' {
  if (row.revoked_at) return 'revoked';
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  if (row.max_views != null && row.view_count >= row.max_views) return 'maxed';
  return 'active';
}

export function toClientPartnerOffer(row: PartnerOfferRow, origin: string) {
  const publicPath = row.vanity_slug ? `/${row.vanity_slug}` : `/partner-offer/${row.token}`;

  return {
    id: row.id,
    isDraft: Boolean(row.is_draft),
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
    emailSent: Boolean(row.email_sent),
    emailSentAt: row.email_sent_at,
    emailRecipient: row.email_recipient,
    resendMessageId: row.resend_message_id,
    emailStatus: row.email_status ?? 'not_requested',
    status: computePartnerOfferStatus(row),
    vanitySlug: row.vanity_slug,
    shareUrl: `${origin}${publicPath}`,
  };
}
