import {
  PARTNER_OFFER_EMAIL_BODY_HOOK,
  PARTNER_OFFER_EMAIL_SUBJECT_SENTINEL,
} from '@/lib/email/partnerOfferEmailCopy';

export type OfferStatus = 'active' | 'expired' | 'revoked' | 'maxed';
export type OfferEmailStatus = 'not_requested' | 'sent' | 'failed';

export type PartnerOffer = {
  id: string;
  isDraft: boolean;
  recipientName: string | null;
  recipientEmail: string | null;
  partnerName: string;
  offerTitle: string;
  offerMessage: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  maxViews: number | null;
  viewCount: number;
  expiresAt: string;
  lastViewedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  emailSent: boolean;
  emailSentAt: string | null;
  emailRecipient: string | null;
  resendMessageId: string | null;
  emailStatus: OfferEmailStatus;
  status: OfferStatus;
  vanitySlug: string | null;
  shareUrl: string;
};

export const FLYR_PARTNER_FREE_FOREVER_REFERRAL_CODE = 'Free2026';

export type OfferTemplate = {
  id:
    | 'team-partner'
    | 'flyr-partner-free-forever'
    | 'free-30-day-challenge'
    | 'solo-agent'
    | 'affiliate'
    | 'just-listed-dm';
  label: string;
  title: string;
  message: string;
  ctaLabel: string;
};

export const OFFER_TEMPLATES: OfferTemplate[] = [
  {
    id: 'team-partner',
    label: 'Team Partner Offer',
    title: PARTNER_OFFER_EMAIL_SUBJECT_SENTINEL,
    message: PARTNER_OFFER_EMAIL_BODY_HOOK,
    ctaLabel: 'Book your team onboarding',
  },
  {
    id: 'flyr-partner-free-forever',
    label: 'FLYR Partner Free Forever',
    title: 'FLYR Partner Offer',
    message:
      'Private FLYR Partner access for your team. Complete onboarding through this invite and your workspace will be set up with FLYR Pro free forever.',
    ctaLabel: 'Claim free partner access',
  },
  {
    id: 'free-30-day-challenge',
    label: 'Free 30 Day Challenge Offer',
    title: 'Free 30 Day Challenge Offer',
    message:
      'Private access to the challenge. This page is invite-only and not publicly listed.',
    ctaLabel: 'Join the 30 day challenge',
  },
  {
    id: 'solo-agent',
    label: 'Solo Agent Partner Offer',
    title: 'Exclusive Solo Agent Offer',
    message:
      'Placeholder: special solo-agent pricing and setup support to help you launch quickly.',
    ctaLabel: 'Claim solo offer',
  },
  {
    id: 'affiliate',
    label: 'Affiliate Partner Offer',
    title: 'Exclusive Affiliate Partner Offer',
    message:
      'Placeholder: affiliate collaboration terms, referral incentives, and campaign support details.',
    ctaLabel: 'Review affiliate terms',
  },
  {
    id: 'just-listed-dm',
    label: 'Just Listed DM Template',
    title: 'Use this listing to win the neighbourhood.',
    message:
      "You've already got the listing.\n\nNow use FLYR to turn it into more exposure, more conversations, and your next client.\n\nUse flyers and doorknocking around your listing to create local buzz, uncover buyers, and meet nearby sellers before this window closes.",
    ctaLabel: 'See the listing play',
  },
];

export {
  partnerOfferGreetingFirstName,
  partnerOfferRecipientFirstName,
} from '@/lib/email/partnerOfferEmailCopy';
export { slugifyPartnerOfferPath } from '@/lib/offers/partnerOfferSlug';

export function isJustListedDmOffer(offerTitle: string, offerMessage?: string | null): boolean {
  const content = `${offerTitle}\n${offerMessage ?? ''}`;
  return /just listed|new listing|listing play|listing advantage|win the neighbourhood|hot listing|doorknocking around your listing/i.test(
    content
  );
}

/** Team Partner template: dedicated team onboarding. DM / 30-day / others use standard flow + partner trial. */
export function isPartnerOfferTeamExclusiveOnboarding(
  offerTitle: string,
  offerMessage: string | null | undefined
): boolean {
  if (isJustListedDmOffer(offerTitle, offerMessage)) return false;
  if (/30\s*day\s*challenge/i.test(offerTitle)) return false;
  if (/private access to the challenge/i.test(offerMessage ?? '')) return false;

  const title = offerTitle.trim();
  if (title === PARTNER_OFFER_EMAIL_SUBJECT_SENTINEL) return true;
  if (/^FLYR is Built for\b/i.test(title)) return true;
  return false;
}

/** Free 30 Day Challenge template (and matching copy). Used to tune onboarding (e.g. hide step-1 demo). */
export function isThirtyDayChallengePartnerOffer(
  offerTitle: string,
  offerMessage: string | null | undefined
): boolean {
  return (
    /30\s*day\s*challenge/i.test(offerTitle) || /private access to the challenge/i.test(offerMessage ?? '')
  );
}

export function isFlyrPartnerFreeForeverOffer(
  offerTitle: string,
  offerMessage: string | null | undefined
): boolean {
  const content = `${offerTitle}\n${offerMessage ?? ''}`;
  return /FLYR Partner Offer/i.test(offerTitle) || /free forever/i.test(content);
}

export function formatLongDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function toLocalDateTimeInputValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/** `YYYY-MM-DD` for a `<input type="date" />` in local time. */
export function toLocalDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** End of local calendar day as ISO, for API `expires_at` from a date-only picker. */
export function expiresAtIsoFromDateInput(yyyyMmDd: string): string {
  const trimmed = yyyyMmDd.trim();
  const parts = trimmed.split('-').map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return new Date(trimmed).toISOString();
  }
  const [y, m, d] = parts;
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

export function statusVariant(status: OfferStatus): 'default' | 'destructive' | 'secondary' | 'outline' {
  if (status === 'active') return 'default';
  if (status === 'revoked') return 'destructive';
  if (status === 'maxed') return 'secondary';
  return 'outline';
}

export function statusLabel(status: OfferStatus): string {
  if (status === 'active') return 'Active';
  if (status === 'revoked') return 'Revoked';
  if (status === 'maxed') return 'View limit reached';
  return 'Expired';
}

export function emailStatusLabel(status: OfferEmailStatus): string {
  if (status === 'sent') return 'Sent';
  if (status === 'failed') return 'Failed';
  return 'Not sent';
}

export function buildOutreachCopy(offer: PartnerOffer) {
  const recipient = offer.recipientName || offer.recipientEmail || 'there';
  const partner = offer.partnerName || 'your team';
  const justListedDm = isJustListedDmOffer(offer.offerTitle, offer.offerMessage);
  const ctaText = justListedDm
    ? offer.ctaLabel || 'See the listing play'
    : offer.ctaLabel || 'review your private offer';
  const expires = formatLongDate(offer.expiresAt);
  const includeArcadeEmbed =
    /team/i.test(offer.offerTitle) || /30\s*day\s*challenge/i.test(offer.offerTitle);

  const emailSubject = justListedDm
    ? `Just listed: a FLYR listing play for ${partner}`
    : `Exclusive FLYR Partner Offer for ${partner}`;
  const emailBody = justListedDm
    ? [
        `Hi ${recipient},`,
        '',
        `Just listed: I made a FLYR listing play for ${partner}.`,
        `Open it here: ${offer.shareUrl}`,
        '',
        `${offer.offerMessage || 'Use this listing to create more local exposure, more conversations, and more seller opportunities while the listing is fresh.'}`,
        `Offer expires: ${expires}`,
        '',
        `When ready, tap "${ctaText}" on the page.`,
        '',
        '— Daniel Phillippe',
      ].join('\n')
    : [
        `Hi ${recipient},`,
        '',
        `I created a private FLYR offer page for ${partner}.`,
        `This link is invite-only and not public: ${offer.shareUrl}`,
        '',
        `${offer.offerMessage || 'You can review the details and next steps on that page.'}`,
        `Offer expires: ${expires}`,
        '',
        `When ready, click "${ctaText}" on the page.`,
        '',
        '— Daniel Phillippe',
      ].join('\n');

  const smsText = justListedDm
    ? `Hey ${recipient} — just listed. Here is the FLYR listing play for ${partner}: ${offer.shareUrl} (expires ${expires}).`
    : `Hey ${recipient} — here is your private FLYR offer link for ${partner}: ${offer.shareUrl} (expires ${expires}).`;

  const igDmIntroText = justListedDm
    ? `Hey ${recipient}! Congrats on the listing.`
    : `Hey ${recipient}! I made an invite-only FLYR offer page for ${partner}. Want me to send the link?`;

  const igDmReplyText = justListedDm ? 'Thank you!' : '';

  const igDmLinkText = justListedDm
    ? `Use FLYR to flyer the area, knock the surrounding homes, and turn listing attention into your next seller and buyer opportunities.\n\nI've attached one included campaign and a demo on how it works: ${offer.shareUrl}`
    : `Perfect. Here is your private FLYR offer link for ${partner}: ${offer.shareUrl}\n\nIt expires ${expires}.`;

  const igDmText = justListedDm
    ? `${igDmIntroText}\n\n${igDmReplyText}\n\n${igDmLinkText}`
    : `${igDmIntroText}\n\n${igDmLinkText}`;

  const teamOfferEmailHtml = includeArcadeEmbed
    ? [
        `<p>Hi ${recipient},</p>`,
        `<p>I created a private FLYR offer page for ${partner}. This link is invite-only and not public: <a href="${offer.shareUrl}" target="_blank" rel="noopener noreferrer">${offer.shareUrl}</a></p>`,
        `<p>${offer.offerMessage || 'You can review the details and next steps on that page.'}</p>`,
        `<p><strong>Offer expires:</strong> ${expires}</p>`,
        `<div style="margin-top:16px;margin-bottom:16px;">`,
        `<div style="position: relative; padding-bottom: calc(64.94708994708994% + 41px); height: 0; width: 100%;">`,
        `<iframe`,
        `  src="https://demo.arcade.software/nbvH4JKdrqCGt8a0O8pi?embed&embed_mobile=tab&embed_desktop=inline&show_copy_link=true"`,
        `  title="FLYR: Team Prospecting Dashboard"`,
        `  frameborder="0"`,
        `  loading="lazy"`,
        `  allowfullscreen`,
        `  allow="clipboard-write"`,
        `  style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; color-scheme: light;"`,
        `></iframe>`,
        `</div>`,
        `</div>`,
        `<p>When ready, click "${ctaText}" on the page.</p>`,
        `<p>— Daniel Phillippe</p>`,
      ].join('\n')
    : null;

  return {
    emailSubject,
    emailBody,
    smsText,
    igDmIntroText,
    igDmReplyText,
    igDmLinkText,
    igDmText,
    teamOfferEmailHtml,
  };
}
