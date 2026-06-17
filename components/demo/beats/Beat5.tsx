'use client';

import { useState } from 'react';
import { track } from '@/lib/demo/analytics/track';
import type { BeatCopy } from '@/lib/demo/payload';

type OutcomeKey = 'ok' | 'nh' | 'na' | 'dk';

function renderLines(value: string) {
  return value.split('\n').map((line, index) => (
    <span key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
}

export function Beat5({ copy }: { copy: BeatCopy }) {
  const [selectedOutcome, setSelectedOutcome] = useState<OutcomeKey | null>(null);

  return (
    <section id="b5" className="light">
      <div className="rv eyebrow">Beat 05 · At the door</div>
      <h2 className="h-big rv d1">{renderLines(copy.b5Headline)}</h2>
      <div className="duo">
        <ul className="pitch rv d2">
          {copy.b5Pitch.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="phone rv d3" aria-label="Interactive phone demo">
          <div className="screen">
            <div className="appbar">
              <span>
                {copy.b5AppbarText}
                <b>{copy.b5AppbarAccent}</b>
              </span>
              <span>{copy.b5AppbarTime}</span>
            </div>
            <div className="doorcard">
              <div className="addr" id="addr5">
                {copy.b5DoorAddress}
              </div>
              <div className="meta">{copy.b5DoorMeta}</div>
            </div>
            <div className="outs" id="outs5">
              {(['ok', 'nh', 'na', 'dk'] as const).map((key) => (
                <button
                  className={selectedOutcome === key ? `sel-${key}` : ''}
                  data-k={key}
                  key={key}
                  type="button"
                  onClick={() => {
                    track('phone_tap', 5, { outcome: key });
                    setSelectedOutcome(key);
                  }}
                >
                  {copy.b5OutcomeButtons[key]}
                </button>
              ))}
            </div>
            <div className={selectedOutcome === 'ok' ? 'leadflow show' : 'leadflow'} id="lead5">
              {copy.b5LeadDetails.map((line) => (
                <div className="leadline" key={line.key}>
                  <span>{line.key}</span>
                  <span>{line.value}</span>
                </div>
              ))}
              <div className="sync">{copy.b5SyncText}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
