'use client';

import { FormEvent, useMemo, useState } from 'react';
import { track } from '@/lib/demo/analytics/track';
import type { BeatCopy, DemoPayload } from '@/lib/demo/payload';

type Beat6Props = {
  copy: BeatCopy;
  ctaVariant: DemoPayload['ctaVariant'];
  ctaUrl: string;
  company?: string;
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

function normalizeReplyAddress(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (!trimmed.toLowerCase().startsWith('mailto:')) {
    return trimmed;
  }

  return trimmed.slice('mailto:'.length).split('?')[0];
}

function buildReplyHref(ctaUrl: string, company?: string) {
  const email = normalizeReplyAddress(ctaUrl);
  const subjectCompany = company?.trim() || 'your team';
  const params = new URLSearchParams({
    subject: `FLYR PRO — ${subjectCompany}`,
    body: 'Hi,\n\nI watched the FLYR PRO demo and want to talk next steps.',
  });

  return `mailto:${email}?${params.toString()}`;
}

export function Beat6({ copy, ctaVariant, ctaUrl, company }: Beat6Props) {
  const [territoryCity, setTerritoryCity] = useState('');
  const [territorySubmitted, setTerritorySubmitted] = useState(false);
  const primaryHref = useMemo(
    () => (ctaVariant === 'reply' ? buildReplyHref(ctaUrl, company) : ctaUrl),
    [company, ctaUrl, ctaVariant]
  );

  const submitTerritory = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const city = territoryCity.trim();

    if (!city) {
      return;
    }

    track('cta_click', 6, { variant: ctaVariant, target: 'primary', city });
    setTerritorySubmitted(true);
  };

  return (
    <>
      <section id="b6" data-cta-variant={ctaVariant}>
        <div className="rv eyebrow">Beat 06 · The math</div>
        <h2 className="price rv d1">{renderPrice(copy.b6Price)}</h2>
        <h2 className="h-big rv d2">{renderLines(copy.b6Headline)}</h2>
        <div className="cta-row rv d3">
          {ctaVariant === 'territory' ? (
            territorySubmitted ? (
              <div className="territory-confirm" role="status">
                Got it. We'll have your map ready shortly.
              </div>
            ) : (
              <form className="territory-cta" onSubmit={submitTerritory}>
                <label className="territory-copy" htmlFor="territory-city">
                  Type your city — I'll send you your map.
                </label>
                <div className="territory-form-row">
                  <input
                    id="territory-city"
                    className="territory-input"
                    value={territoryCity}
                    onChange={(event) => setTerritoryCity(event.target.value)}
                    placeholder="Oshawa, ON"
                    autoComplete="address-level2"
                  />
                  <button className="btn" type="submit">
                    {copy.ctaPrimary}
                  </button>
                </div>
              </form>
            )
          ) : (
            <a
              className="btn"
              href={primaryHref}
              onClick={() => track('cta_click', 6, { variant: ctaVariant, target: 'primary' })}
            >
              {copy.ctaPrimary}
            </a>
          )}
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
