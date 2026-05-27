// tui/effects.ts — render <Effect shader={WGSL}> in the terminal.
//
// Same API as on the GPU: the cart's shader string is the source of truth.
// We compile a JS sampler from it (see tui/wgsl.ts) and call it at each cell
// to get an RGBA color. The classic upper-half-block trick (▀) packs two
// vertical pixels into one cell: fg = top row, bg = bottom row. That gives
// us 2× vertical resolution effectively for free.
//
// Animation: any Effect on screen schedules a follow-up paint via the host's
// requestPaint. We coalesce with a single shared frame timer so 50 effects
// don't fan out into 50 timers.

import { compileWgsl, type CompiledShader } from './wgsl';

export type Cell = {
  ch: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  reverse: boolean;
  strike: boolean;
};

export type EffectBox = { x: number; y: number; w: number; h: number };

// ── Animation scheduler ──

let frameTimer: any = null;
let scheduleRepaint: (() => void) | null = null;
let getMouse: (() => { x: number; y: number; inside: number }) | null = null;
const FRAME_MS = 60; // ~16fps; terminals don't like more than this with full-grid emits

export function bindEffectScheduler(req: () => void, mouseGetter?: () => { x: number; y: number; inside: number }): void {
  scheduleRepaint = req;
  if (mouseGetter) getMouse = mouseGetter;
}
function tickNextFrame(): void {
  if (frameTimer != null || !scheduleRepaint) return;
  frameTimer = setTimeout(() => {
    frameTimer = null;
    scheduleRepaint && scheduleRepaint();
  }, FRAME_MS);
}

// ── Time ──

const t0 = Date.now();
function now(): number { return (Date.now() - t0) / 1000; }

// ── Color helpers ──

function rgbHex(r: number, g: number, b: number): string {
  const to = (v: number): string => {
    const n = Math.max(0, Math.min(255, Math.round(v * 255)));
    return n.toString(16).padStart(2, '0');
  };
  return '#' + to(r) + to(g) + to(b);
}

// Premultiplied-over composite of (src over dst) when src has alpha < 1.
// dst defaults to opaque black so transparent effect regions read as black,
// matching the GPU's clear-to-bg behavior on most demo carts.
function over(src: [number, number, number, number], dstR: number, dstG: number, dstB: number): [number, number, number] {
  const a = src[3];
  return [
    src[0] * a + dstR * (1 - a),
    src[1] * a + dstG * (1 - a),
    src[2] * a + dstB * (1 - a),
  ];
}

// ── Pluck a likely background color out of `style.backgroundColor` on the
// Effect node or its parent. Caller passes it in; we just clamp.

function bgFloats(hex: string | null | undefined): [number, number, number] {
  if (!hex) return [0, 0, 0];
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ── Public: paint an Effect into the grid. ──

export interface EffectNodeLike {
  id: number;
  type: string;
  props: { shader?: string; effectData?: number[] | Float32Array; data?: number[] | Float32Array; pattern?: string; style?: any };
}

export function paintEffect(grid: Cell[][], box: EffectBox, node: EffectNodeLike, parentBg: string | null): void {
  if (box.w <= 0 || box.h <= 0) return;
  const shader = node.props?.shader;
  const data = (node.props?.effectData ?? node.props?.data ?? []) as number[] | Float32Array;
  const style = node.props?.style ?? {};
  const ownBg = typeof style.backgroundColor === 'string' ? style.backgroundColor : null;
  const [bR, bG, bB] = bgFloats(ownBg ?? parentBg ?? '#000000');

  // Schedule animation regardless of whether compile succeeded — even error
  // stipple ticks once so any data change replays. Cheap if no effects.
  tickNextFrame();

  if (typeof shader !== 'string' || shader.length === 0) {
    paintFallback(grid, box, node.id, '(no shader)');
    return;
  }

  const compiled = compileWgsl(shader);
  if ((compiled as any).error) {
    paintFallback(grid, box, node.id, (compiled as any).error);
    return;
  }
  const sample = (compiled as CompiledShader).sample;
  const t = now();

  // Mouse in *shader* pixel space. The shader sees the surface as box.w wide
  // by box.h*2 tall (half-block trick). Convert from cell coords by mapping
  // (mouseCellX - box.x) → 0..box.w and (mouseCellY - box.y)*2 → 0..box.h*2.
  // mouse_inside is gated to whether the cursor is over THIS effect's rect,
  // not just somewhere in the terminal — that matches the GPU behavior.
  const m = getMouse ? getMouse() : { x: -1, y: -1, inside: 0 };
  const overUs = m.inside === 1 && m.x >= box.x && m.x < box.x + box.w && m.y >= box.y && m.y < box.y + box.h;
  const mPxX = overUs ? (m.x - box.x) + 0.5 : box.w * 0.5;
  const mPxY = overUs ? (m.y - box.y) * 2 + 1.0 : box.h;
  const mInside = overUs ? 1 : 0;

  // We sample two y positions per cell (top and bottom halves), get two
  // colors, and emit '▀' with fg=top, bg=bottom. If the two are nearly
  // equal we drop the glyph and just set bg, which is cheaper to diff.
  const W = grid[0]?.length ?? 0;
  const H = grid.length;
  const TWO_ROWS = box.h * 2;
  for (let cy = 0; cy < box.h; cy++) {
    const gy = box.y + cy;
    if (gy < 0 || gy >= H) continue;
    const vTop = (cy * 2 + 0.5) / TWO_ROWS;
    const vBot = (cy * 2 + 1.5) / TWO_ROWS;
    for (let cx = 0; cx < box.w; cx++) {
      const gx = box.x + cx;
      if (gx < 0 || gx >= W) continue;
      const u = (cx + 0.5) / box.w;
      let top: [number, number, number, number];
      let bot: [number, number, number, number];
      try {
        top = sample([u, vTop], t, data, box.w, box.h * 2, mPxX, mPxY, mInside);
        bot = sample([u, vBot], t, data, box.w, box.h * 2, mPxX, mPxY, mInside);
      } catch {
        continue;
      }
      const topC = over(top, bR, bG, bB);
      const botC = over(bot, bR, bG, bB);
      const cell = grid[gy][gx];
      const sameish =
        Math.abs(topC[0] - botC[0]) < 0.004 &&
        Math.abs(topC[1] - botC[1]) < 0.004 &&
        Math.abs(topC[2] - botC[2]) < 0.004;
      if (sameish) {
        cell.ch = ' ';
        cell.fg = null;
        cell.bg = rgbHex(topC[0], topC[1], topC[2]);
      } else {
        cell.ch = '▀';
        cell.fg = rgbHex(topC[0], topC[1], topC[2]);
        cell.bg = rgbHex(botC[0], botC[1], botC[2]);
      }
      cell.bold = false; cell.italic = false; cell.underline = false;
      cell.dim = false; cell.reverse = false; cell.strike = false;
    }
  }
}

// Fallback: a stippled "broken-shader" pattern so the surface is obviously
// alive but the cart sees the error. First line shows the error message.
function paintFallback(grid: Cell[][], box: EffectBox, _id: number, msg: string): void {
  const W = grid[0]?.length ?? 0;
  const H = grid.length;
  for (let cy = 0; cy < box.h; cy++) {
    const gy = box.y + cy;
    if (gy < 0 || gy >= H) continue;
    for (let cx = 0; cx < box.w; cx++) {
      const gx = box.x + cx;
      if (gx < 0 || gx >= W) continue;
      const cell = grid[gy][gx];
      cell.ch = ((cx + cy) & 1) ? '░' : '▒';
      cell.fg = '#f87171';
      cell.bg = '#1f2937';
      cell.bold = false; cell.italic = false; cell.underline = false;
      cell.dim = false; cell.reverse = false; cell.strike = false;
    }
  }
  if (box.h > 0 && msg) {
    const line = ` fx: ${msg} `.slice(0, Math.max(0, box.w));
    const gy = box.y;
    for (let i = 0; i < line.length; i++) {
      const gx = box.x + i;
      if (gx < 0 || gx >= W || gy < 0 || gy >= H) continue;
      const cell = grid[gy][gx];
      cell.ch = line[i];
      cell.fg = '#fef3c7';
      cell.bg = '#7f1d1d';
    }
  }
}
