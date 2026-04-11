'use client';

import { MessageCircle } from 'lucide-react';
import { toast } from 'sonner';

type PartnerOfferDmPreviewProps = {
  recipientName: string;
  openerText: string;
  replyText: string;
  linkText: string;
  privateOfferLink: string;
};

export function PartnerOfferDmPreview({
  recipientName,
  openerText,
  replyText,
  linkText,
  privateOfferLink,
}: PartnerOfferDmPreviewProps) {
  const label = recipientName.trim() || 'Recipient';

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied.`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}.`);
    }
  };

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-lg border border-border bg-[#111827] shadow-sm">
      <div className="border-b border-white/10 bg-[#0b1220] px-5 py-4 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/15 text-red-300">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-xs text-zinc-400">Instagram DM preview</p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(239,68,68,0.12),_rgba(17,24,39,1)_28%)] p-5">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void copyText(openerText, 'Opener')}
            className="max-w-[85%] rounded-[20px] rounded-br-md bg-red-600 px-4 py-3 text-left text-sm leading-6 text-white shadow-[0_12px_30px_rgba(239,68,68,0.22)] transition hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            title="Tap to copy opener"
          >
            {openerText}
          </button>
        </div>

        {replyText ? (
          <div className="flex justify-start">
            <button
              type="button"
              onClick={() => void copyText(replyText, 'Reply')}
              className="max-w-[70%] rounded-[20px] rounded-bl-md bg-[#1f2937] px-4 py-3 text-left text-sm leading-6 text-white shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition hover:bg-[#273548] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              title="Tap to copy reply"
            >
              {replyText}
            </button>
          </div>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void copyText(`${linkText}\n\n${privateOfferLink}`, 'Link message')}
            className="max-w-[90%] rounded-[20px] rounded-br-md bg-white px-4 py-3 text-left text-sm leading-6 text-zinc-900 shadow-[0_14px_30px_rgba(15,23,42,0.18)] transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
            title="Tap to copy link message"
          >
            <div className="whitespace-pre-wrap">{linkText}</div>
            <div className="mt-3 break-all text-sm font-semibold text-red-600 underline underline-offset-2">
              {privateOfferLink}
            </div>
          </button>
        </div>

        <p className="pt-2 text-center text-xs text-zinc-500">Tap any message bubble to copy it.</p>
      </div>
    </div>
  );
}
