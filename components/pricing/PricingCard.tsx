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
    <article className="flex flex-col rounded-3xl border border-zinc-200 bg-zinc-100 p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-800/50 md:p-6">
      {badge && (
        <span className="mb-3 inline-flex w-fit rounded-full bg-red-600 px-3 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
          {badge}
        </span>
      )}
      <h3 className="text-xl font-semibold text-zinc-900 dark:text-white">{title}</h3>
      <p className="mt-2 text-sm leading-snug text-zinc-600 dark:text-zinc-400">{subtitle}</p>
      {priceDisplay != null && <div className="mt-5">{priceDisplay}</div>}
      <ul className="mt-5 space-y-1.5 text-[0.95rem] text-zinc-700 dark:text-zinc-300">
        {features.map(({ text, bold }) => (
          <li key={text} className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-500" />
            <span className={`min-w-0 break-words leading-snug ${bold ? 'font-semibold' : ''}`}>{text}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-1 flex-col justify-end space-y-2">{cta}</div>
    </article>
  );
}
