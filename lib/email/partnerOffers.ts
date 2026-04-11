import { Resend } from 'resend';
import type { PartnerOfferEmailTemplateProps } from '@/lib/email/templates/PartnerOfferEmail';
import {
  PARTNER_OFFER_EMAIL_CLOSING_LINE,
  PARTNER_OFFER_EMAIL_LOGO_URL,
  partnerOfferEmailSubject,
  partnerOfferGreetingFirstName,
} from '@/lib/email/partnerOfferEmailCopy';

const DEFAULT_FROM_EMAIL = 'Daniel Phillippe <daniel@flyr.software>';
const OFFER_REPLY_TO = 'daniel@flyr.software';

function getEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractEmailAddress(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const angleMatch = trimmed.match(/<([^>]+)>/);
  const candidate = (angleMatch?.[1] ?? trimmed).trim().toLowerCase();
  return candidate || null;
}

export function getPartnerOfferFromEmail(): string {
  return getEnv('RESEND_FROM_EMAIL') || DEFAULT_FROM_EMAIL;
}

export function getPartnerOfferMailerConfigError(): string | null {
  if (!getEnv('RESEND_API_KEY')) {
    return (
      'Offer was created, but the email was not sent because RESEND_API_KEY is missing or empty. ' +
      'For local dev: add RESEND_API_KEY=re_... to .env.local in the project root and restart next dev. ' +
      'For production: set RESEND_API_KEY in your host (e.g. Vercel → Settings → Environment Variables) and redeploy.'
    );
  }

  const from = getPartnerOfferFromEmail();
  const address = extractEmailAddress(from);
  if (!address) {
    return 'Offer was created, but the email sender is invalid.';
  }

  if (address !== 'daniel@flyr.software') {
    return 'Offer email sender must be Daniel Phillippe <daniel@flyr.software>. Update RESEND_FROM_EMAIL to match.';
  }

  return null;
}

export type PartnerOfferEmailInput = {
  to: string;
  recipientName: string;
  companyName: string;
  offerTitle: string;
  offerMessage: string;
  expiresAt: string;
  ctaLabel: string;
  ctaUrl: string;
  privateOfferLink: string;
};

export function buildPartnerOfferEmailSubject(subject: string, companyName: string): string {
  return partnerOfferEmailSubject(subject, companyName);
}

export function buildPartnerOfferEmailProps(
  input: PartnerOfferEmailInput
): PartnerOfferEmailTemplateProps {
  return {
    recipientGreetingFirstName: partnerOfferGreetingFirstName(input.recipientName),
    offerMessage: input.offerMessage,
    privateOfferLink: input.privateOfferLink,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPartnerOfferEmailHtml(props: PartnerOfferEmailTemplateProps): string {
  const link = escapeHtml(props.privateOfferLink);
  const logo = escapeHtml(PARTNER_OFFER_EMAIL_LOGO_URL);
  return `
    <div style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#1e293b;">
      <p style="margin:0 0 16px;">Hi ${escapeHtml(props.recipientGreetingFirstName)},</p>
      <div style="margin:0 0 18px;white-space:pre-wrap;">${escapeHtml(props.offerMessage)}</div>
      <p style="margin:0 0 18px;">Here's the link: <a href="${link}" style="color:#0f172a;text-decoration:underline;word-break:break-all;">${link}</a></p>
      <p style="margin:0 0 22px;">${escapeHtml(PARTNER_OFFER_EMAIL_CLOSING_LINE)}</p>
      <p style="margin:0 0 4px;">Daniel Phillippe</p>
      <p style="margin:0 0 12px;color:#64748b;font-size:14px;">Founder</p>
      <p style="margin:0;"><img src="${logo}" alt="FLYR" width="120" height="auto" style="display:block;border:0;max-width:140px;height:auto;" /></p>
    </div>
  `.trim();
}

export async function sendPartnerOfferEmail(
  input: PartnerOfferEmailInput
): Promise<{ id: string | null }> {
  const apiKey = getEnv('RESEND_API_KEY');
  const from = getPartnerOfferFromEmail();
  const configError = getPartnerOfferMailerConfigError();

  if (configError || !apiKey) {
    throw new Error(configError ?? 'Offer email is not configured.');
  }

  const props = buildPartnerOfferEmailProps(input);
  const subject = buildPartnerOfferEmailSubject(input.offerTitle, input.companyName);
  const html = `<!DOCTYPE html><html><body>${buildPartnerOfferEmailHtml(props)}</body></html>`;
  const greet = partnerOfferGreetingFirstName(input.recipientName);
  const text = [
    `Hi ${greet},`,
    '',
    input.offerMessage,
    '',
    `Here's the link: ${input.privateOfferLink}`,
    '',
    PARTNER_OFFER_EMAIL_CLOSING_LINE,
    '',
    'Daniel Phillippe',
    'Founder',
  ].join('\n');

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    replyTo: OFFER_REPLY_TO,
    subject,
    html,
    text,
  });

  if (error) {
    const message = error.message.trim() || 'Resend email request failed';
    if (/only send testing emails|verify a domain at resend\.com\/domains/i.test(message)) {
      throw new Error(
        'Offer was created, but Resend is still in test mode for this sender. Verify flyr.software in Resend to deliver this email.'
      );
    }

    throw new Error(message);
  }

  return {
    id: typeof data?.id === 'string' ? data.id : null,
  };
}
