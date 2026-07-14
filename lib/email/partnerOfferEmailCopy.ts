export const PARTNER_OFFER_EMAIL_CLOSING_LINE = 'Happy to answer any questions,';

/** Served from production so embedded images work in Gmail (not localhost). */
export const PARTNER_OFFER_EMAIL_LOGO_URL = 'https://wolfgrid.app/wolfgrid-icon-1024.png';

/** Default subject when the Subject field is left on auto (uses Company field). */
export function partnerOfferEmailDefaultSubject(companyName: string): string {
  const co = companyName.trim();
  return co ? `WolfGrid is Built for ${co}` : 'WolfGrid is Built for your team';
}

/** Default editable body (link line is added by the template after this). */
export const PARTNER_OFFER_EMAIL_BODY_HOOK =
  'WolfGrid is built for teams that prospect door-to-door. It automatically tracks every door knocked, syncs leads to your CRM, and gives managers the accountability metrics to coach what\'s actually happening in the field.\n\n' +
  'I put this invite together specifically for your team — it\'s not publicly listed.';

/** Subject field value meaning “use auto subject” (matches empty-company default). */
export const PARTNER_OFFER_EMAIL_SUBJECT_SENTINEL = 'WolfGrid is Built for your team';

function shouldUseAutoPartnerSubject(trimmedSubject: string): boolean {
  if (!trimmedSubject) return true;
  const legacy = new Set([
    PARTNER_OFFER_EMAIL_SUBJECT_SENTINEL,
    'Private WolfGrid page',
    'Exclusive Team Offer',
    'Exclusive WolfGrid Partner Offer',
    'Private WolfGrid page for your team',
  ]);
  if (legacy.has(trimmedSubject)) return true;
  if (/^Private WolfGrid page for .+/.test(trimmedSubject)) return true;
  if (/^WolfGrid is Built for .+/.test(trimmedSubject)) return true;
  return false;
}

/** Resolves subject line for sending / preview. */
export function partnerOfferEmailSubject(subject: string, companyName: string): string {
  const t = subject.trim();
  if (shouldUseAutoPartnerSubject(t)) {
    return partnerOfferEmailDefaultSubject(companyName);
  }
  return t;
}

/** First word of the recipient name for greetings; "there" if empty. */
export function partnerOfferRecipientFirstName(recipientName: string): string {
  const t = recipientName.trim();
  if (!t) return 'there';
  const first = t.split(/\s+/)[0];
  return first && first.length > 0 ? first : 'there';
}

/** Title-cased first name for "Hi {Name}," (e.g. richard → Richard, there → There). */
export function partnerOfferGreetingFirstName(recipientName: string): string {
  const raw = partnerOfferRecipientFirstName(recipientName);
  if (raw === 'there') return 'There';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/** @deprecated Prefer partnerOfferEmailSubject; kept for older landing copy paths. */
export function partnerOfferEmailHeadline(companyName: string, offerTitle: string): string {
  const fromCompany = companyName.trim();
  if (fromCompany) return fromCompany;
  return offerTitle.trim() || 'Partner offer';
}
