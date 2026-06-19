'use client';

import { track } from '@/lib/demo/analytics/track';
import type { BeatCopy, DemoPayload } from '@/lib/demo/payload';

type Beat6Props = {
  copy: BeatCopy;
  ctaVariant: DemoPayload['ctaVariant'];
  ctaUrl: string;
};

function renderLines(value: string) {
  return value.split('\n').map((line, index) => (
    <span key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
}

function renderPrice(value: string) {
  const slashIndex = value.indexOf('/');
  const accentText = slashIndex === -1 ? value : value.slice(0, slashIndex);
  const rest = slashIndex === -1 ? '' : value.slice(slashIndex);

  return (
    <>
      <span className="accent">{accentText}</span>
      {rest}
    </>
  );
}

function renderFounderLine(value: string) {
  const boldText = 'You get the person who built it';
  const [before, after] = value.split(boldText);

  if (after === undefined) {
    return value;
  }

  return (
    <>
      {before}
      <b>{boldText}</b>
      {after}
    </>
  );
}

function resolveCtaHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (trimmed.toLowerCase().startsWith('mailto:') || trimmed.includes('://')) {
    return trimmed;
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return `mailto:${trimmed}`;
  }

  return trimmed;
}

export function Beat6({ copy, ctaVariant, ctaUrl }: Beat6Props) {
  return (
    <>
      <section id="b6" data-cta-variant={ctaVariant}>
        <div className="rv eyebrow"></div>
        <h2 className="price rv d1">{renderPrice(copy.b6Price)}</h2>
        <h2 className="h-big rv d2">{renderLines(copy.b6Headline)}</h2>
        <div className="cta-row rv d3">
          <a
            className="btn"
            href={resolveCtaHref(ctaUrl)}
            onClick={() => track('cta_click', 6, { variant: ctaVariant, target: 'primary' })}
          >
            {copy.ctaPrimary}
          </a>
          <a
            className="btn ghost"
            href="https://flyrpro.app"
            onClick={() => track('cta_click', 6, { variant: ctaVariant, target: 'secondary' })}
          >
            {copy.ctaSecondary}
          </a>
        </div>
        <p className="founder rv d4">{renderFounderLine(copy.b6FounderLine)}</p>
      </section>

      <footer>
        <span>FLYR PRO · Field operations, verified</span>
        <span>CA · US · UK · AU · NZ · ZA</span>
      </footer>
    </>
  );
}
