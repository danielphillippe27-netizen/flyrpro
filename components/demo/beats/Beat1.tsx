'use client';

import { useEffect, useMemo, useState } from 'react';
import { getInitialReducedMotion } from '@/lib/demo/canvas/useReducedMotion';
import type { BeatCopy } from '@/lib/demo/payload';

type Beat1Props = {
  copy: BeatCopy;
  center?: [number, number];
};

const DEFAULT_CENTER: [number, number] = [43.8828, 79.4403];

function formatInitialCoords(baseLat: number, baseLng: number) {
  return `${baseLat.toFixed(4)}° N · ${baseLng.toFixed(4)}° W\nTUE 07:42 · CREW OF 15\nSTATUS: UNKNOWN`;
}

function formatCoords(baseLat: number, baseLng: number) {
  const d = new Date();
  const lat = (baseLat + Math.sin(Date.now() / 9000) * 0.0007).toFixed(4);
  const lng = (baseLng + Math.cos(Date.now() / 11000) * 0.0007).toFixed(4);

  return `${lat}° N · ${lng}° W\nTUE ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')} · CREW OF 15\nSTATUS: UNKNOWN`;
}

export function Beat1({ copy, center }: Beat1Props) {
  const [baseLat, baseLng] = center ?? DEFAULT_CENTER;
  const initialCoords = useMemo(() => formatInitialCoords(baseLat, baseLng), [baseLat, baseLng]);
  const [coords, setCoords] = useState(initialCoords);

  useEffect(() => {
    setCoords(formatCoords(baseLat, baseLng));

    const reduced = getInitialReducedMotion();

    if (reduced) {
      return;
    }

    const interval = setInterval(() => {
      setCoords(formatCoords(baseLat, baseLng));
    }, 1000);

    return () => clearInterval(interval);
  }, [baseLat, baseLng]);

  return (
    <section id="b1">
      <div className="wordmark">
        FLYR<b>PRO</b>
      </div>
      <div className="coords" id="coords">
        {coords.split('\n').map((line, index) => (
          <span key={line}>
            {index > 0 ? <br /> : null}
            {line}
          </span>
        ))}
      </div>
      <svg className="trace" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path d="M-50,620 L180,620 L180,470 L390,470 L390,560 L640,560 L640,380 L520,380 L520,250 L820,250 L820,330 L1020,330 L1020,140 L1260,140" />
      </svg>
      <div className="rv eyebrow">Beat 01 · Cold open</div>
      <h1 className="h-mega rv d1">{copy.b1Headline}</h1>
      <h1 className="h-mega accent rv d2">{copy.b1Accent}</h1>
      <p className="sub rv d3">{copy.b1Sub}</p>
      <div className="scrollcue">Scroll ↓</div>
    </section>
  );
}
