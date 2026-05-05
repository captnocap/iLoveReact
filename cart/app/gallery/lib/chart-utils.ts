import { COLORS, PALETTE } from './chart-palette';

export { COLORS, PALETTE } from './chart-palette';
export * from '../data/overstock/chart-demo-data';

export function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const m = (r1 - r0) / (d1 - d0 || 1);
  return (v: number) => r0 + (v - d0) * m;
}

// Produces ~count nicely-rounded ticks covering [min, max].
//
// Old formula used `10 ^ floor(log10(range/count))` which collapses to 1 whenever
// range/count is in [1, 10) — e.g. range=32/count=4 → step=1 → 33 gridlines
// packed into the plot area as a dense bottom band. Replaced with the standard
// 1/2/5 × 10^k quantisation so the step size is always close to range/count
// but snaps to human-readable intervals.
export function niceTicks(min: number, max: number, count: number = 5): number[] {
  const range = max - min;
  if (range === 0) return [min];
  const rawStep = range / Math.max(1, count);
  const pow10 = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / pow10;
  let step: number;
  if (norm < 1.5) step = 1 * pow10;
  else if (norm < 3) step = 2 * pow10;
  else if (norm < 7) step = 5 * pow10;
  else step = 10 * pow10;
  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  let t = start;
  while (t <= max + step * 0.5 && ticks.length < 128) {
    ticks.push(Number(t.toFixed(10)));
    t += step;
  }
  return ticks.length ? ticks : [min, max];
}

export function polar(cx: number, cy: number, radius: number, angleDeg: number): [number, number] {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
}

export function arcPath(cx: number, cy: number, radius: number, start: number, end: number): string {
  const [sx, sy] = polar(cx, cy, radius, start);
  const [ex, ey] = polar(cx, cy, radius, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${sx} ${sy} A ${radius} ${radius} 0 ${large} 1 ${ex} ${ey}`;
}

export function donutSegment(cx: number, cy: number, inner: number, outer: number, start: number, end: number): string {
  const [sxo, syo] = polar(cx, cy, outer, start);
  const [exo, eyo] = polar(cx, cy, outer, end);
  const [sxi, syi] = polar(cx, cy, inner, start);
  const [exi, eyi] = polar(cx, cy, inner, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${sxo} ${syo} A ${outer} ${outer} 0 ${large} 1 ${exo} ${eyo} L ${exi} ${eyi} A ${inner} ${inner} 0 ${large} 0 ${sxi} ${syi} Z`;
}

export function hexColorWithAlpha(color: string, _alpha: number): string {
  return color;
}

export type Margin = { top: number; right: number; bottom: number; left: number };

export function plotArea(width: number, height: number, margin: Margin = { top: 20, right: 20, bottom: 32, left: 40 }) {
  return {
    width,
    height,
    x: margin.left,
    y: margin.top,
    w: Math.max(40, width - margin.left - margin.right),
    h: Math.max(40, height - margin.top - margin.bottom),
  };
}
