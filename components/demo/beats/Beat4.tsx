'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildCity, drawStreets, fitCanvas, mulberry, type CityAddress, type DemoCity } from '@/lib/demo/canvas/cityModel';
import { getInitialReducedMotion } from '@/lib/demo/canvas/useReducedMotion';
import type { BeatCopy } from '@/lib/demo/payload';

type RepName = 'MARCUS' | 'DEVON' | 'PRIYA' | 'COLE';
type OutcomeClass = 'ok' | 'nh' | 'dk';
type FeedLine = { id: number; className: OutcomeClass; text: string };

type Rep = {
  name: RepName;
  col: string;
  path: number[][];
  seg: number;
  f: number;
  trail: number[][];
  speed: number;
  x?: number;
  y?: number;
};

const NAMES: [RepName, string][] = [
  ['MARCUS', '#5ab4ff'],
  ['DEVON', '#ff4d00'],
  ['PRIYA', '#27c878'],
  ['COLE', '#ffb000'],
];
const STREETS = ['Birch St', 'Larkspur Crt', 'Mason Ave', 'Hilltop Rd', 'Quarry Ln', 'Fenwick Dr', 'Aspen Gate'];
const OUTCOMES: [string, OutcomeClass, number][] = [
  ['INTERESTED', 'ok', 0.22],
  ['NOT HOME', 'nh', 0.42],
  ['NO ANSWER', 'nh', 0.22],
  ['DO NOT KNOCK', 'dk', 0.14],
];
const OUTCOME_COLORS: Record<OutcomeClass, string> = { ok: '#27c878', nh: '#ffb000', dk: '#e53935' };

function renderLines(value: string) {
  return value.split('\n').map((line, index) => (
    <span key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
}

function makePath(city: DemoCity, rng: () => number) {
  const pts: number[][] = [];
  let xIndex = 1 + ((rng() * (city.vx.length - 2)) | 0);
  let yIndex = 1 + ((rng() * (city.hy.length - 2)) | 0);
  let x = city.vx[xIndex],
    y = city.hy[yIndex];
  const startX = x,
    startY = y;
  pts.push([x, y]);
  for (let k = 0; k < 14; k++) {
    if (rng() < 0.5) {
      xIndex = Math.max(0, Math.min(city.vx.length - 1, xIndex + (rng() < 0.5 ? -1 : 1)));
      x = city.vx[xIndex];
    } else {
      yIndex = Math.max(0, Math.min(city.hy.length - 1, yIndex + (rng() < 0.5 ? -1 : 1)));
      y = city.hy[yIndex];
    }
    pts.push([x, y]);
  }
  if (x !== startX) {
    x = startX;
    pts.push([x, y]);
  }
  if (y !== startY) {
    y = startY;
    pts.push([x, y]);
  }
  return pts;
}

export function Beat4({ copy }: { copy: BeatCopy }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);
  const reducedRef = useRef(false);
  const feedIdRef = useRef(0);
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [scores, setScores] = useState<Record<RepName, number>>({ MARCUS: 0, DEVON: 0, PRIYA: 0, COLE: 0 });

  const stopBeat4 = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    runningRef.current = false;
  }, []);

  const runBeat4 = useCallback(() => {
    const cv = canvasRef.current;

    if (!cv) {
      return;
    }

    stopBeat4();
    runningRef.current = true;
    setFeed([]);
    setScores({ MARCUS: 0, DEVON: 0, PRIYA: 0, COLE: 0 });

    const { ctx, W, H } = fitCanvas(cv);
    const city = buildCity(W, H);
    const rng = mulberry(31);
    const reps: Rep[] = NAMES.map((n) => ({
      name: n[0],
      col: n[1],
      path: makePath(city, rng),
      seg: 0,
      f: 0,
      trail: [],
      speed: reducedRef.current ? 0 : 0.0035 + rng() * 0.0015,
    }));
    const flips: { x: number; y: number; col: string }[] = [];

    function drawFrame(now: number) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0c0c0a';
      ctx.fillRect(0, 0, W, H);
      drawStreets(ctx, city, W, H, 'rgba(217,213,203,.13)');
      ctx.fillStyle = 'rgba(217,213,203,.16)';
      city.addrs.forEach((p) => ctx.fillRect(p.x - 1, p.y - 1, 2, 2));
      flips.forEach((f) => {
        ctx.fillStyle = f.col;
        ctx.fillRect(f.x - 2, f.y - 2, 4, 4);
      });
      reps.forEach((r) => {
        if (!reducedRef.current) {
          r.f += r.speed * 16;
          if (r.f >= 1) {
            r.f = 0;
            r.seg = (r.seg + 1) % (r.path.length - 1);
          }
        }
        const a = r.path[r.seg],
          b = r.path[r.seg + 1];
        const x = a[0] + (b[0] - a[0]) * r.f,
          y = a[1] + (b[1] - a[1]) * r.f;
        r.x = x;
        r.y = y;
        r.trail.push([x, y]);
        if (r.trail.length > 90) r.trail.shift();
        ctx.strokeStyle = r.col + '66';
        ctx.lineWidth = 2;
        ctx.beginPath();
        r.trail.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.stroke();
        ctx.fillStyle = r.col;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 7);
        ctx.fill();
        ctx.strokeStyle = r.col;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 9 + Math.sin(now / 300) * 2, 0, 7);
        ctx.stroke();
        ctx.font = '700 10px IBM Plex Mono';
        ctx.fillText(r.name, x + 13, y + 4);
      });
    }

    function step(now: number) {
      drawFrame(now);
      animationRef.current = requestAnimationFrame(step);
    }

    if (reducedRef.current) {
      drawFrame(performance.now());
    } else {
      animationRef.current = requestAnimationFrame(step);
    }

    timerRef.current = setInterval(() => {
      const ri = (Math.random() * reps.length) | 0,
        r = reps[ri];
      let q = Math.random(),
        oc = OUTCOMES[0];
      for (const o of OUTCOMES) {
        if (q < o[2]) {
          oc = o;
          break;
        }
        q -= o[2];
      }
      let best: CityAddress | null = null,
        bd = 1e9;
      for (const p of city.addrs) {
        const d = (p.x - (r.x ?? 0)) ** 2 + (p.y - (r.y ?? 0)) ** 2;
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (best) flips.push({ x: best.x, y: best.y, col: OUTCOME_COLORS[oc[1]] });
      if (flips.length > 400) flips.shift();
      const num = 20 + ((Math.random() * 240) | 0);
      const st = STREETS[(Math.random() * STREETS.length) | 0];
      const d = new Date();
      const text =
        String(d.getHours()).padStart(2, '0') +
        ':' +
        String(d.getMinutes()).padStart(2, '0') +
        ' · ' +
        num +
        ' ' +
        st.toUpperCase() +
        ' · ' +
        oc[0] +
        ' · ' +
        r.name;
      setFeed((current) => [...current, { id: feedIdRef.current++, className: oc[1], text }].slice(-9));
      setScores((current) => ({ ...current, [r.name]: current[r.name] + 1 }));
    }, reducedRef.current ? 999999 : 1300);
  }, [stopBeat4]);

  useEffect(() => {
    reducedRef.current = getInitialReducedMotion();
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !runningRef.current) {
          runBeat4();
        }
        if (!entries[0].isIntersecting && runningRef.current) {
          stopBeat4();
        }
      },
      { threshold: 0.35 }
    );
    observer.observe(stage);

    return () => {
      observer.disconnect();
      stopBeat4();
    };
  }, [runBeat4, stopBeat4]);

  return (
    <section id="b4">
      <div className="rv eyebrow">Beat 04 · Ground truth</div>
      <h2 className="h-big rv d1">{renderLines(copy.b4Headline)}</h2>
      <p className="sub rv d2">{copy.b4Sub}</p>
      <div className="grid4 rv d3">
        <div className="stage" id="stage4" ref={stageRef}>
          <canvas id="cv4" ref={canvasRef} />
          <button className="replay" id="replay4" type="button" onClick={runBeat4}>
            {copy.b4ReplayLabel}
          </button>
        </div>
        <div className="panel">
          <h3>{copy.b4FeedTitle}</h3>
          <div className="feed" id="feed4" aria-live="off">
            {feed.map((line) => (
              <div className={line.className} key={line.id}>
                {line.text}
              </div>
            ))}
          </div>
          <div className="lb" id="lb4">
            {NAMES.map(([name, color]) => (
              <div className="row" key={name}>
                <b style={{ color }}>{name}</b>
                <span className="n">{scores[name]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
