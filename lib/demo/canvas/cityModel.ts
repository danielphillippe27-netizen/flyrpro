export type CityAddress = {
  x: number;
  y: number;
  side?: number;
  unit?: boolean;
};

export type DemoCity = {
  vx: number[];
  hy: number[];
  addrs: CityAddress[];
};

export type PolygonPoint = [number, number];

export function mulberry(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildCity(W: number, H: number): DemoCity {
  const rng = mulberry(7);
  const vx = [];
  const hy = [];
  for (let x = W * 0.04; x < W * 0.99; x += W * 0.085 + rng() * W * 0.03) vx.push(x);
  for (let y = H * 0.06; y < H * 0.99; y += H * 0.14 + rng() * H * 0.05) hy.push(y);
  const addrs: CityAddress[] = [];
  for (let i = 0; i < vx.length - 1; i++)
    for (let j = 0; j < hy.length - 1; j++) {
      const x0 = vx[i],
        x1 = vx[i + 1],
        y0 = hy[j],
        y1 = hy[j + 1];
      const inset = Math.min(10, (x1 - x0) * 0.12);
      const step = 11 + rng() * 3;
      for (let x = x0 + inset * 1.6; x < x1 - inset * 1.6; x += step) {
        addrs.push({ x, y: y0 + inset, side: 0 });
        addrs.push({ x, y: y1 - inset, side: 1 });
      }
      if (rng() < 0.18) {
        const cx = x0 + (x1 - x0) * 0.5,
          cy = (y0 + y1) / 2;
        for (let u = 0; u < 6; u++) addrs.push({ x: cx - 15 + u * 6, y: cy, unit: true });
      }
    }
  return { vx, hy, addrs };
}

export function drawStreets(ctx: CanvasRenderingContext2D, city: DemoCity, W: number, H: number, col: string) {
  ctx.strokeStyle = col;
  ctx.lineWidth = 1;
  ctx.beginPath();
  city.vx.forEach((x) => {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  });
  city.hy.forEach((y) => {
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  });
  ctx.stroke();
}

export function pointInPoly(p: CityAddress, poly: PolygonPoint[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      yi = poly[i][1],
      xj = poly[j][0],
      yj = poly[j][1];
    if (yi > p.y != yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function fitCanvas(cv: HTMLCanvasElement) {
  const r = cv.getBoundingClientRect(),
    dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = r.width * dpr;
  cv.height = r.height * dpr;
  const ctx = cv.getContext('2d');

  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W: r.width, H: r.height };
}
