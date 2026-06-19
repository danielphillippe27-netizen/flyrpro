'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildCity, drawStreets, fitCanvas, mulberry, pointInPoly, type PolygonPoint } from '@/lib/demo/canvas/cityModel';
import { getInitialReducedMotion } from '@/lib/demo/canvas/useReducedMotion';
import { track } from '@/lib/demo/analytics/track';
import type { BeatCopy } from '@/lib/demo/payload';

function renderLines(value: string) {
  return value.split('\n').map((line, index) => (
    <span key={`${line}-${index}`}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
}

export function Beat3Canvas({ copy }: { copy: BeatCopy }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const hasRunRef = useRef(false);
  const reducedRef = useRef(false);
  const [count, setCount] = useState('0');
  const [timer, setTimer] = useState('00.0 s');

  const cancelAnimation = useCallback(() => {
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  const runBeat3 = useCallback(() => {
    const cv = canvasRef.current;

    if (!cv) {
      return;
    }

    cancelAnimation();
    const { ctx, W, H } = fitCanvas(cv);
    const city = buildCity(W, H);
    const poly: PolygonPoint[] = [
      [W * 0.16, H * 0.3],
      [W * 0.44, H * 0.12],
      [W * 0.8, H * 0.2],
      [W * 0.92, H * 0.55],
      [W * 0.7, H * 0.9],
      [W * 0.3, H * 0.86],
      [W * 0.1, H * 0.62],
    ];
    const inside = city.addrs.filter((p) => pointInPoly(p, poly));
    const rng = mulberry(13);
    for (let i = inside.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [inside[i], inside[j]] = [inside[j], inside[i]];
    }
    const total = inside.length;
    const drawDur = reducedRef.current ? 0 : 1100;
    const cascadeDur = reducedRef.current ? 0 : 2600;
    const start = performance.now();
    let perim = 0;
    const segs: { a: PolygonPoint; b: PolygonPoint; L: number }[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      segs.push({ a, b, L });
      perim += L;
    }

    function drawFinalState() {
      ctx.clearRect(0, 0, W, H);
      drawStreets(ctx, city, W, H, 'rgba(12,12,10,.22)');
      ctx.fillStyle = 'rgba(12,12,10,.10)';
      city.addrs.forEach((p) => ctx.fillRect(p.x - 1, p.y - 1, 2, 2));

      ctx.strokeStyle = '#ff4d00';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255,77,0,.06)';
      ctx.beginPath();
      poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ff4d00';
      inside.forEach((p) => ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3));
      inside.slice(Math.max(0, total - 40)).forEach((p) => ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5));
      setCount(total.toLocaleString());
      setTimer(copy.b3FinalTimer);
    }

    if (reducedRef.current) {
      drawFinalState();
      return;
    }

    function frame(now: number) {
      const t = now - start;
      ctx.clearRect(0, 0, W, H);
      drawStreets(ctx, city, W, H, 'rgba(12,12,10,.22)');
      ctx.fillStyle = 'rgba(12,12,10,.10)';
      city.addrs.forEach((p) => ctx.fillRect(p.x - 1, p.y - 1, 2, 2));
      const sp = reducedRef.current ? 1 : Math.min(1, t / drawDur);
      let drawn = perim * sp,
        acc = 0;
      ctx.strokeStyle = '#ff4d00';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      for (const s of segs) {
        if (acc >= drawn) break;
        const take = Math.min(s.L, drawn - acc);
        const f = take / s.L;
        ctx.moveTo(s.a[0], s.a[1]);
        ctx.lineTo(s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f);
        acc += s.L;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (sp >= 1) {
        ctx.fillStyle = 'rgba(255,77,0,.06)';
        ctx.beginPath();
        poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.closePath();
        ctx.fill();
      }
      const cp = reducedRef.current ? 1 : Math.max(0, Math.min(1, (t - drawDur) / cascadeDur));
      const eased = 1 - Math.pow(1 - cp, 3);
      const n = Math.floor(total * eased);
      ctx.fillStyle = '#ff4d00';
      for (let i = 0; i < n; i++) {
        const p = inside[i];
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
      for (let i = Math.max(0, n - 40); i < n; i++) {
        const p = inside[i];
        ctx.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
      }
      setCount(n.toLocaleString());
      setTimer((Math.min(t, drawDur + cascadeDur) / 100).toFixed(1).padStart(4, '0') + ' s · unit splits included');
      if (t < drawDur + cascadeDur + 200) animationRef.current = requestAnimationFrame(frame);
      else {
        animationRef.current = null;
        setTimer(copy.b3FinalTimer);
      }
    }

    animationRef.current = requestAnimationFrame(frame);
  }, [cancelAnimation, copy.b3FinalTimer]);

  useEffect(() => {
    reducedRef.current = getInitialReducedMotion();
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasRunRef.current) {
          hasRunRef.current = true;
          runBeat3();
        }
      },
      { threshold: 0.45 }
    );
    observer.observe(stage);

    return () => {
      observer.disconnect();
      cancelAnimation();
    };
  }, [cancelAnimation, runBeat3]);

  return (
    <section id="b3" className="light">
      <div className="rv eyebrow">Beat 03 · Territory</div>
      <h2 className="h-big rv d1">{renderLines(copy.b3Headline)}</h2>
      <p className="sub rv d2">{copy.b3Sub}</p>
      <div className="stage rv d3" id="stage3" ref={stageRef}>
        <canvas id="cv3" ref={canvasRef} />
        <button
          className="replay"
          id="replay3"
          type="button"
          onClick={() => {
            track('replay', 3);
            runBeat3();
          }}
        >
          {copy.b3ReplayLabel}
        </button>
        <div className="hud">
          <div className="counter">
            <span id="count3">{count}</span>
            <small>{copy.b3CounterLabel}</small>
          </div>
          <div id="time3">{timer}</div>
        </div>
      </div>
    </section>
  );
}
