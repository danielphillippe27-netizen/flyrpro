'use client';

import { type ReactNode } from 'react';
import { Check } from 'lucide-react';

export interface PricingFeature {
  text: string;
  bold?: boolean;
}

export interface PricingCardProps {
  title: string;
  subtitle: string;
  badge?: string;
  priceDisplay?: ReactNode | null;
  features: PricingFeature[];
  cta: ReactNode;
  highlighted?: boolean;
}

export function PricingCard({
  title,
  subtitle,
  badge,
  priceDisplay,
  features,
  cta,
  highlighted = false,
}: PricingCardProps) {
  return (
    <article
      className={`relative flex flex-col rounded-[2rem] border p-6 md:p-8 ${
        highlighted
          ? 'border-zinc-950 bg-zinc-950 text-white shadow-2xl shadow-zinc-950/15'
          : 'border-zinc-200 bg-white text-zinc-950'
      }`}
    >
      {badge && (
        <span className="mb-5 inline-flex w-fit rounded-full bg-red-600 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white">
          {badge}
        </span>
      )}
      <h3 className={`text-3xl font-black tracking-tight ${highlighted ? 'text-white' : 'text-zinc-950'}`}>{title}</h3>
      <p className={`mt-2 text-sm leading-6 ${highlighted ? 'text-zinc-400' : 'text-zinc-600'}`}>{subtitle}</p>
      {priceDisplay != null && <div className="mt-5">{priceDisplay}</div>}
      <ul className={`mt-7 space-y-3 text-sm ${highlighted ? 'text-zinc-200' : 'text-zinc-700'}`}>
        {features.map(({ text, bold }) => (
          <li key={text} className="flex items-start gap-3">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${highlighted ? 'bg-red-600' : 'bg-red-50'}`}>
              <Check className={`h-3 w-3 ${highlighted ? 'text-white' : 'text-red-600'}`} />
            </span>
            <span className={`min-w-0 break-words leading-5 ${bold ? 'font-bold' : ''}`}>{text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-1 flex-col justify-end space-y-3">{cta}</div>
    </article>
  );
}
