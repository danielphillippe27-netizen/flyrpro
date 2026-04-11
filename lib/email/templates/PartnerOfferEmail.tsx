import * as React from 'react';
import {
  PARTNER_OFFER_EMAIL_BODY_HOOK,
  PARTNER_OFFER_EMAIL_CLOSING_LINE,
  PARTNER_OFFER_EMAIL_LOGO_URL,
} from '@/lib/email/partnerOfferEmailCopy';

export type PartnerOfferEmailTemplateProps = {
  recipientGreetingFirstName: string;
  offerMessage: string;
  privateOfferLink: string;
};

const pStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: '15px',
  lineHeight: 1.6,
  color: '#1e293b',
};

export function PartnerOfferEmailTemplate({
  recipientGreetingFirstName,
  offerMessage,
  privateOfferLink,
}: PartnerOfferEmailTemplateProps) {
  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: '15px',
        lineHeight: 1.6,
        color: '#1e293b',
      }}
    >
      <p style={pStyle}>Hi {recipientGreetingFirstName},</p>
      <div style={{ ...pStyle, margin: '0 0 18px', whiteSpace: 'pre-wrap' }}>{offerMessage}</div>
      <p style={{ ...pStyle, margin: '0 0 18px' }}>
        Here&apos;s the link:{' '}
        <a href={privateOfferLink} style={{ color: '#0f172a', textDecoration: 'underline', wordBreak: 'break-all' }}>
          {privateOfferLink}
        </a>
      </p>
      <p style={{ ...pStyle, margin: '0 0 22px' }}>{PARTNER_OFFER_EMAIL_CLOSING_LINE}</p>
      <p style={{ margin: '0 0 4px' }}>Daniel Phillippe</p>
      <p style={{ margin: '0 0 12px', color: '#64748b', fontSize: '14px' }}>Founder</p>
      <p style={{ margin: 0 }}>
        <img
          src={PARTNER_OFFER_EMAIL_LOGO_URL}
          alt="FLYR"
          width={120}
          style={{ display: 'block', border: 0, maxWidth: '140px', height: 'auto' }}
        />
      </p>
    </div>
  );
}

export const partnerOfferEmailPreviewProps: PartnerOfferEmailTemplateProps = {
  recipientGreetingFirstName: 'Sarah',
  offerMessage: PARTNER_OFFER_EMAIL_BODY_HOOK,
  privateOfferLink: 'https://flyr.software/partner-offer/example',
};
