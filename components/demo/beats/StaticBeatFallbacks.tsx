import type { BeatCopy, DemoPayload } from '@/lib/demo/payload';

function renderLines(value: string) {
  return value.split('\n').map((line, index) => (
    <span key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
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

export function StaticBeat1Fallback({ copy }: { copy: BeatCopy }) {
  return (
    <section id="b1" className="in">
      <div className="wordmark">WolfGrid<b>PRO</b>
      </div>
      <div className="eyebrow">Beat 01 · Cold open</div>
      <h1 className="h-mega">{renderLines(copy.b1Headline)}</h1>
      <h1 className="h-mega accent">{renderLines(copy.b1Accent)}</h1>
      <p className="sub">{copy.b1Sub}</p>
    </section>
  );
}

export function StaticBeat2Fallback({ copy }: { copy: BeatCopy }) {
  return (
    <section id="b2" className="light in">
      <div className="eyebrow">Beat 02 · The problem</div>
      <h2 className="h-big">{renderLines(copy.b2Headline)}</h2>
      <p className="sub">{copy.b2Sub}</p>
      <div className="static-list">
        {copy.b2Strikes.map((strike) => (
          <p key={strike}>{strike}</p>
        ))}
      </div>
    </section>
  );
}

export function StaticBeat3Fallback({ copy }: { copy: BeatCopy }) {
  return (
    <section id="b3" className="light in">
      <div className="eyebrow">Beat 03 · Territory</div>
      <h2 className="h-big">{renderLines(copy.b3Headline)}</h2>
      <p className="sub">{copy.b3Sub}</p>
      <div className="static-stage">
        <b>{copy.b3CounterLabel}</b>
        <span>{copy.b3FinalTimer}</span>
      </div>
    </section>
  );
}

export function StaticBeat4Fallback({ copy }: { copy: BeatCopy }) {
  return (
    <section id="b4" className="in">
      <div className="eyebrow">Beat 04 · Ground truth</div>
      <h2 className="h-big">{renderLines(copy.b4Headline)}</h2>
      <p className="sub">{copy.b4Sub}</p>
      <div className="static-stage">
        <b>Sessions details</b>
        <span>Completed session · route verified</span>
      </div>
    </section>
  );
}

export function StaticBeat5Fallback({ copy }: { copy: BeatCopy }) {
  return (
    <section id="b5" className="light in">
      <div className="eyebrow">Beat 05 · At the door</div>
      <h2 className="h-big">{renderLines(copy.b5Headline)}</h2>
      <p className="sub">{copy.b5Sub}</p>
      <ul className="static-list">
        {copy.b5Pitch.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function StaticBeat6Fallback({
  copy,
  ctaVariant,
  ctaUrl,
}: {
  copy: BeatCopy;
  ctaVariant: DemoPayload['ctaVariant'];
  ctaUrl: string;
}) {
  return (
    <section id="b6" className="in" data-cta-variant={ctaVariant}>
      <div className="eyebrow">Beat 06 · The math</div>
      <h2 className="price">
        <span className="accent">{copy.b6Price}</span>
      </h2>
      <h2 className="h-big">{renderLines(copy.b6Headline)}</h2>
      <div className="cta-row">
        <a className="btn" href={resolveCtaHref(ctaUrl)}>
          {copy.ctaPrimary}
        </a>
        <a className="btn ghost" href="https://wolfgrid.app">
          {copy.ctaSecondary}
        </a>
      </div>
      <p className="founder">{copy.b6FounderLine}</p>
    </section>
  );
}
