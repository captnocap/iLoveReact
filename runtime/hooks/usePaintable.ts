/**
 * usePaintable — persistent GPU mask textures for carts that need to
 * accumulate pixel-level state without touching CPU arrays.
 *
 * Importing this file flips the build-time `__paintable_` gate on, which
 * registers the V8 bindings in framework/v8_bindings_paintable.zig and
 * links framework/gpu/paintable.zig into the host.
 *
 * ── Usage ────────────────────────────────────────────────────────────
 *
 *   import { usePaintable } from '@reactjit/runtime/hooks/usePaintable';
 *
 *   function CutoutCart() {
 *     const mask = usePaintable({ w: imgW, h: imgH });
 *
 *     // 1. Render the holder so the GPU texture is created during CREATE
 *     //    (before any consumer paints). It paints nothing visible.
 *     // 2. Render the effect that samples it via textures={{ mask }}.
 *     return (
 *       <>
 *         <Paintable id={mask.id} w={imgW} h={imgH} />
 *         <Effect shader={WGSL} textures={{ mask: mask.id }} />
 *         <Pressable
 *           onMouseDown={(e) => mask.paint.circle(e.x, e.y, 20, 1)}
 *           onMouseMove={(e) => e.buttons && mask.paint.circle(e.x, e.y, 20, 1)}
 *         />
 *       </>
 *     );
 *   }
 *
 * ── Why not React state? ─────────────────────────────────────────────
 *
 * Brush strokes fire on every mousemove. Pushing them through useState /
 * React props would re-render the entire subtree per stroke dab. The
 * paint.* methods call directly into V8 — no React state, no re-render.
 * Ops queue Zig-side; the engine drains them once per frame BEFORE the
 * paint walk, so consumers always see the latest texture state.
 */

import { useRef } from 'react';
import { callHost } from '../ffi';

// Stable per-cart id counter so two hook instances don't collide. We
// don't use crypto.randomUUID — the id is purely process-local and the
// counter is enough.
let g_nextPaintableId = 1;
function nextId(): string {
  return `paintable-${g_nextPaintableId++}`;
}

export interface PaintableOps {
  /** Handle string — pass to `<Paintable id>` and `<Effect textures>`. */
  readonly id: string;
  /** Filled circle. value 0..1 (1 = fully painted, 0 = erased). */
  circle(cx: number, cy: number, r: number, value: number): void;
  /** Edge-aware circle — only writes pixels whose sobel gradient against
   *  `grayId` falls below `gradThreshold`. Refine-brush behavior. The
   *  `grayId` paintable must exist (uploaded from the source image). */
  circleEdgeAware(
    cx: number, cy: number, r: number, value: number,
    grayId: string, gradThreshold: number,
  ): void;
  /** General brush stamp. `kind` is a small numeric enum owned by the caller;
   *  angle is radians; aspect is width/height; hardness/flow/scatter are 0..1+
   *  tuning values interpreted by the host brush shader. */
  brush(
    cx: number, cy: number, r: number, value: number,
    kind: number, angle: number, aspect: number, hardness: number,
    flow: number, scatter: number, seed: number,
  ): void;
  /** Coloured brush dab into an RGBA paintable. cr/cg/cb are 0..1. The optional
   *  clip rect (texture pixels; omit or 0 ⇒ unclamped) scissors the dab to a
   *  region — pass the hit face's UV island rect so a round brush can't bleed
   *  onto a neighbour island packed beside it in the atlas. */
  brushColor(
    cx: number, cy: number, r: number, cr: number, cg: number, cb: number,
    kind: number, angle: number, aspect: number, hardness: number,
    flow: number, scatter: number, seed: number,
    clipX?: number, clipY?: number, clipW?: number, clipH?: number,
  ): void;
  /** Eraser dab (DEST-OUT) into an RGBA paintable: the footprint's coverage carves
   *  TRANSPARENCY into the texture (rather than painting a colour), so a layer erased
   *  here reveals whatever composites below it (req_1729). Same footprint params as
   *  `brushColor`, no colour. The clip rect scissors to the hit face's UV island. */
  brushErase(
    cx: number, cy: number, r: number,
    kind: number, angle: number, aspect: number, hardness: number,
    flow: number, scatter: number, seed: number,
    clipX?: number, clipY?: number, clipW?: number, clipH?: number,
  ): void;
  /** Composite a SOURCE paintable into THIS one, premultiplied-OVER × `opacity`
   *  (LAYERS, req_1729). Pass `clearFirst` on the FIRST composite of a flatten
   *  sequence to clear the destination to transparent first; the rest accumulate.
   *  Folding the clear into the first composite keeps the whole sequence in one op
   *  phase so repeating it within a frame stays idempotent (last wins). */
  composite(srcId: string, opacity: number, clearFirst?: boolean): void;
  /** Replace every pixel of an RGBA paintable with a flat colour (base coat). */
  clearColor(r: number, g: number, b: number, a: number): void;
  /** Polygon fill via interleaved [x0, y0, x1, y1, ...] Float32Array. */
  polygon(verts: Float32Array, value: number): void;
  /** Replace every pixel with `value`. */
  clear(value: number): void;
  /** Replace texture contents with raw bytes: R8 targets take w*h, RGBA targets
   *  take w*h*4. Used for masks and save-boundary CPU composites. */
  upload(bytes: Uint8Array): void;
  /** Block-and-readback to a CPU Uint8Array. Use at save / export
   *  boundaries only — not per frame. Returns null on failure. */
  readback(): Uint8Array | null;
}

export interface PaintableHandle {
  /** Stable id — same as `ops.id`, hoisted for ergonomic destructuring. */
  readonly id: string;
  /** Imperative brush + buffer API. Calls go straight to V8; no React. */
  readonly paint: PaintableOps;
}

export interface UsePaintableOptions {
  /** Optional explicit id. Defaults to a process-unique counter. */
  id?: string;
  /** Texture dimensions in pixels. */
  w: number;
  h: number;
}

// Single instance pool — re-using the same id returns the same ops object
// (referentially stable, safe to pass through props without re-render
// chains). Carts that mount/unmount the cart subtree rebuild fresh ops
// against the new texture.
const g_opsByid = new Map<string, PaintableOps>();

function makeOps(id: string): PaintableOps {
  const existing = g_opsByid.get(id);
  if (existing) return existing;
  const ops: PaintableOps = {
    id,
    circle(cx, cy, r, value) { callHost('__paintable_circle', undefined, id, cx, cy, r, value); },
    circleEdgeAware(cx, cy, r, value, grayId, gradThreshold) {
      callHost('__paintable_circle_edge', undefined, id, cx, cy, r, value, grayId, gradThreshold);
    },
    brush(cx, cy, r, value, kind, angle, aspect, hardness, flow, scatter, seed) {
      callHost('__paintable_brush', undefined, id, cx, cy, r, value, kind, angle, aspect, hardness, flow, scatter, seed);
    },
    brushColor(cx, cy, r, cr, cg, cb, kind, angle, aspect, hardness, flow, scatter, seed, clipX = 0, clipY = 0, clipW = 0, clipH = 0) {
      callHost('__paintable_brush_rgba', undefined, id, cx, cy, r, cr, cg, cb, kind, angle, aspect, hardness, flow, scatter, seed, clipX, clipY, clipW, clipH);
    },
    brushErase(cx, cy, r, kind, angle, aspect, hardness, flow, scatter, seed, clipX = 0, clipY = 0, clipW = 0, clipH = 0) {
      callHost('__paintable_brush_erase', undefined, id, cx, cy, r, kind, angle, aspect, hardness, flow, scatter, seed, clipX, clipY, clipW, clipH);
    },
    composite(srcId, opacity, clearFirst = false) { callHost('__paintable_composite', undefined, id, srcId, opacity, clearFirst ? 1 : 0); },
    clearColor(r, g, b, a) { callHost('__paintable_clear_rgba', undefined, id, r, g, b, a); },
    polygon(verts, value) {
      callHost('__paintable_polygon', undefined, id, verts, value);
    },
    clear(value) { callHost('__paintable_clear', undefined, id, value); },
    upload(bytes) { callHost('__paintable_upload', undefined, id, bytes); },
    readback() {
      const out = callHost<unknown>('__paintable_readback', null, id);
      return out instanceof Uint8Array ? out : null;
    },
  };
  g_opsByid.set(id, ops);
  return ops;
}

/**
 * Get a (lazily-created, referentially-stable) ops object for a paintable
 * keyed by `opts.id` — or by an autogenerated id if `opts.id` is omitted.
 * Does NOT itself create the GPU texture; you still have to render
 * `<Paintable id={...} w={...} h={...} />` somewhere in the subtree so the
 * host_tree CREATE path can allocate it.
 *
 * This hook intentionally returns the SAME ops object across renders —
 * it's the imperative API surface, not a value to put in deps arrays.
 */
export function usePaintable(opts: UsePaintableOptions): PaintableHandle {
  // The id MUST be stable across renders — every JSX render reads it,
  // and the <Paintable> primitive triggers paintable.ensure() on prop
  // change. A fresh nextId() per render means a fresh GPU texture per
  // render (leaking the previous one) and the cart's brush ops pointing
  // at an id different from the one currently mounted in JSX. useRef
  // memoizes per component instance; `opts.id` overrides for the rare
  // case the cart wants a stable cross-process handle.
  const idRef = useRef<string | null>(null);
  if (idRef.current === null) {
    idRef.current = opts.id ?? nextId();
  } else if (opts.id && opts.id !== idRef.current) {
    // Cart explicitly switched to a different id — honor it.
    idRef.current = opts.id;
  }
  const paint = makeOps(idRef.current);
  return { id: idRef.current, paint };
}

/**
 * Variant for cases where you only need the ops object — typically when
 * a parent component owns the <Paintable> JSX and you just want to
 * imperatively paint from a callback. No JSX side effects.
 */
export function paintableOps(id: string): PaintableOps {
  return makeOps(id);
}
