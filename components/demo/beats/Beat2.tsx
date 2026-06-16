import type { BeatCopy } from '@/lib/demo/payload';

function renderLines(value: string) {
  return value.split('\n').map((line, index) => (
    <span key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
}

export function Beat2({ copy }: { copy: BeatCopy }) {
  return (
    <section id="b2" className="light">
      <div className="rv eyebrow">Beat 02 · The problem</div>
      <h2 className="h-big rv d1">{renderLines(copy.b2Headline)}</h2>
      <p className="sub rv d2">{copy.b2Sub}</p>
      <div className="strikes rv d3">
        {copy.b2Strikes.map((strike) => (
          <div className="strike" key={strike}>
            {strike}
          </div>
        ))}
      </div>
      <div className="mathrow rv d4">
        {copy.b2Math.map((item) => (
          <div className={item.hot ? 'mathcell hot' : 'mathcell'} key={item.key}>
            <div className="k">{item.key}</div>
            <div className="v">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
