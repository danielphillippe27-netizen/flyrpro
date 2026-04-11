'use client';

import {
  PARTNER_OFFER_EMAIL_CLOSING_LINE,
  PARTNER_OFFER_EMAIL_LOGO_URL,
  partnerOfferEmailSubject,
  partnerOfferGreetingFirstName,
} from '@/lib/email/partnerOfferEmailCopy';

type PartnerOfferEmailPreviewProps = {
  fromLabel: string;
  toLabel: string;
  subjectField: string;
  companyName: string;
  recipientName: string;
  offerMessage: string;
  privateOfferLink: string;
};

export function PartnerOfferEmailPreview({
  fromLabel,
  toLabel,
  subjectField,
  companyName,
  recipientName,
  offerMessage,
  privateOfferLink,
}: PartnerOfferEmailPreviewProps) {
  const greetingName = partnerOfferGreetingFirstName(recipientName);
  const resolvedSubject = partnerOfferEmailSubject(subjectField, companyName);

  return (
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-lg border border-border bg-white shadow-sm sm:min-h-[560px]">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-4 sm:px-5">
        <div className="space-y-2 text-sm text-slate-600">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-14 text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
              From
            </span>
            <span className="font-medium text-slate-900">{fromLabel}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-14 text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
              To
            </span>
            <span className="font-medium text-slate-900">{toLabel}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-14 text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
              Subject
            </span>
            <span className="font-medium text-slate-900">{resolvedSubject}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-white p-4 sm:p-6">
        <div className="mx-auto max-w-[560px] text-[15px] leading-relaxed text-slate-800">
          <p className="mb-4">Hi {greetingName},</p>
          <div className="mb-4 whitespace-pre-wrap">
            {offerMessage.trim() ? offerMessage : 'Your message appears here.'}
          </div>
          <p className="mb-4">
            Here&apos;s the link:{' '}
            <a className="break-all text-slate-900 underline" href={privateOfferLink}>
              {privateOfferLink}
            </a>
          </p>
          <p className="mb-6">{PARTNER_OFFER_EMAIL_CLOSING_LINE}</p>
          <p className="mb-1">Daniel Phillippe</p>
          <p className="mb-4 text-sm text-slate-600">Founder</p>
          <img
            src={PARTNER_OFFER_EMAIL_LOGO_URL}
            alt="FLYR"
            width={120}
            className="block h-auto max-w-[140px] border-0"
          />
        </div>
      </div>
    </div>
  );
}
