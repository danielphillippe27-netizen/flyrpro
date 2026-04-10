export type OfferStatus = 'active' | 'expired' | 'revoked' | 'maxed';

export type PartnerOffer = {
  id: string;
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
  status: OfferStatus;
  shareUrl: string;
};

export type OfferTemplate = {
  id: 'team-partner' | 'free-30-day-challenge' | 'solo-agent' | 'affiliate';
  label: string;
  title: string;
  message: string;
  ctaLabel: string;
};

export const OFFER_TEMPLATES: OfferTemplate[] = [
  {
    id: 'team-partner',
    label: 'Team Partner Offer',
    title: 'Exclusive Team Offer',
    message:
      'Private access for your team. This page is invite-only and not publicly listed.',
    ctaLabel: 'Book team onboarding',
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
];

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

export function buildOutreachCopy(offer: PartnerOffer) {
  const recipient = offer.recipientName || offer.recipientEmail || 'there';
  const partner = offer.partnerName || 'your team';
  const ctaText = offer.ctaLabel || 'review your private offer';
  const expires = formatLongDate(offer.expiresAt);
  const includeArcadeEmbed =
    /team/i.test(offer.offerTitle) || /30\s*day\s*challenge/i.test(offer.offerTitle);

  const emailSubject = `${partner} x FLYR: Exclusive Offer`;
  const emailBody = [
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
    '— Daniel',
  ].join('\n');

  const smsText = `Hey ${recipient} — here is your private FLYR offer link for ${partner}: ${offer.shareUrl} (expires ${expires}).`;

  const igDmText = `Hey ${recipient}! I made an invite-only FLYR offer page for ${partner}: ${offer.shareUrl} (expires ${expires}).`;

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
        `<p>— Daniel</p>`,
      ].join('\n')
    : null;

  return { emailSubject, emailBody, smsText, igDmText, teamOfferEmailHtml };
}
