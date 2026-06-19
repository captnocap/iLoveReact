// editors/model/meshPaintTexture.ts — the PIXEL painter (req_1372). Replaces the
// box-atlas paint renderer (boxes → StaticSurface → texture) with direct RGBA
// pixel painting into a GPU <Paintable> the model's mesh samples by textureKey.
//
// Why: every old paint bug (AA seams between run-merged boxes, 1px gutters between
// packed cell slots, stale StaticSurface captures, bleed hacks) was the box-atlas
// indirection. Painting pixels straight into the texture deletes the whole class —
// a colour boundary is just adjacent texels, nearest-sampled (req_1321) = crisp,
// no blend. N colours cost nothing; 1 colour or the rainbow is the same machine.
//
// The mesh keeps its per-face UVs (the textureize unwrap). A brush dab raycasts to
// a face + interpolated UV (meshPaint.pickFaceUV), then stamps a coloured disc at
// (u*TEX, v*TEX), SCISSOR-clamped to the face's UV island so a round brush can't
// bleed onto a neighbour island packed beside it in the atlas.

import { paintableOps } from '@reactjit/runtime/hooks/usePaintable';
import * as localstore from '@reactjit/hooks/localstore';
import { bytesToBase64, base64ToBytes } from '@reactjit/workspace';
import { faceTexelRect, type TexelRect } from './meshPaint';
import { type EditMesh } from './editMesh';

/** The one RGBA paint texture every part's mesh samples while painting. */
export const STUDIO_PAINT_KEY = 'studio.paint.live';
/** Fixed paint resolution (px). Resolution-independent storage (PNG), so this is
 *  just the working canvas — generous so a many-face gun resolves fine detail. */
export const PAINT_TEX = 1024;

/** Imperative ops for the model paint texture (calls straight into V8, no React). */
export function paintTex() {
  return paintableOps(STUDIO_PAINT_KEY);
}

/** Hex (`#rrggbb`) → linear-ish 0..1 RGB triplet for the brush colour. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6) || '000000', 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Base coat: flat-fill the whole texture (the "fill all" / new-texture start). */
export function baseCoat(hex: string): void {
  const [r, g, b] = hexToRgb(hex);
  paintTex().clearColor(r, g, b, 1);
}

/** The hit face's UV island rect in TEXTURE PIXELS — the scissor clamp so a dab
 *  near an island edge can't spill onto the neighbour island. */
export function faceIslandPx(mesh: EditMesh, faceIndex: number): TexelRect | null {
  return faceTexelRect(mesh, faceIndex, PAINT_TEX);
}

/** Stamp one coloured disc at a normalized UV. `radiusPx` is the brush radius in
 *  texture pixels; `island` (px) scissors the dab to the hit face. Hard round
 *  brush (kind 0, hardness 1) → crisp flat paint. */
export function stampUV(u: number, v: number, hex: string, radiusPx: number, island: TexelRect | null): void {
  const [r, g, b] = hexToRgb(hex);
  let cx = 0, cy = 0, cw = 0, ch = 0;
  if (island) {
    cx = Math.max(0, Math.floor(island.x0));
    cy = Math.max(0, Math.floor(island.y0));
    cw = Math.max(1, Math.ceil(island.x1) - cx);
    ch = Math.max(1, Math.ceil(island.y1) - cy);
  }
  paintTex().brushColor(u * PAINT_TEX, v * PAINT_TEX, radiusPx, r, g, b, 0, 0, 1, 1, 1, 0, 0, cx, cy, cw, ch);
}

/** Erase a disc back to a colour (no real alpha-erase yet — paint the base coat).
 *  `baseHex` is the texture's base colour so erase reveals it. */
export function eraseUV(u: number, v: number, baseHex: string, radiusPx: number, island: TexelRect | null): void {
  stampUV(u, v, baseHex, radiusPx, island);
}

// ── Persistence (req_1373) ────────────────────────────────────────────────
// The paint lives in a GPU texture; a hot reload (or restart) would lose it. So
// on each stroke we read the texture back (raw RGBA) and stash it as base64 in
// localstore keyed by the model. On entering paint we restore it (upload parks
// until the <Paintable> exists, then flushes). Raw (not PNG) keeps this a pure
// cart-side feature — no @reactjit/image, no new build gate, no host rebuild;
// hot reload picks it up instantly. (1024² RGBA ≈ 4MB → ~5.5MB base64 per save;
// PNG-compressing it is a follow-up for whenever the host is rebuilt anyway.)

const PAINT_STORE_NS = 'studio-paint';
const RGBA_LEN = PAINT_TEX * PAINT_TEX * 4;
const storeKey = (model: string | null) => `paint:${model || 'untitled'}`;

/** Read the live paint texture back and persist it for `model`. Call at
 *  stroke-end / on leaving paint — readback blocks on the GPU, so NOT per dab. */
export function savePaint(model: string | null): void {
  const rgba = paintTex().readback();
  if (!rgba || rgba.length !== RGBA_LEN) return;
  localstore.nsSet(PAINT_STORE_NS, storeKey(model), bytesToBase64(rgba));
}

/** Restore `model`'s saved paint into the texture. Returns true if there was
 *  saved paint (so the caller skips the base coat). Upload parks until the
 *  <Paintable> CREATE drains, so this is safe to call right on paint-enter. */
export function restorePaint(model: string | null): boolean {
  const b64 = localstore.nsHas(PAINT_STORE_NS, storeKey(model)) ? localstore.nsGet(PAINT_STORE_NS, storeKey(model)) : '';
  if (!b64) return false;
  const rgba = base64ToBytes(b64);
  if (!rgba || rgba.length !== RGBA_LEN) return false;
  paintTex().upload(rgba);
  return true;
}

// ── Paint undo/redo (req_1379) ─────────────────────────────────────────────
// Paint lives in the GPU texture, OUTSIDE studioModel's event stream, so Ctrl-Z
// hit model.undo() (reverting a stray palette mint — "brush goes white") and never
// touched the paint. This is a paint-only snapshot ring: the texture state BEFORE
// each stroke is read back and pushed; undo restores it. The parent's Ctrl-Z prefers
// this whenever paint mode is active and the ring is non-empty.

const UNDO_CAP = 24; // ~4MB each; bounded so a long session can't grow unbounded
let g_paintActive = false;
const g_undo: Uint8Array[] = [];
const g_redo: Uint8Array[] = [];

/** Paint mode on/off — gates whether Ctrl-Z routes to paint undo vs model undo. */
export function setPaintActive(on: boolean): void { g_paintActive = on; }
export function paintActive(): boolean { return g_paintActive; }
export function canPaintUndo(): boolean { return g_undo.length > 0; }
export function canPaintRedo(): boolean { return g_redo.length > 0; }

/** Snapshot the texture BEFORE a stroke begins (call on mouse-down in paint).
 *  Pushes the pre-stroke state so undo can return to it; a fresh stroke clears
 *  the redo branch. Readback blocks on the GPU — once per stroke, never per dab. */
export function paintSnapshotBegin(): void {
  const rgba = paintTex().readback();
  if (!rgba || rgba.length !== RGBA_LEN) return;
  g_undo.push(rgba);
  if (g_undo.length > UNDO_CAP) g_undo.shift();
  g_redo.length = 0;
}

/** Undo the last stroke: stash the current state for redo, restore the previous.
 *  Persists the restored state so it survives reload too. Returns true if it ran. */
export function paintUndo(model: string | null): boolean {
  if (g_undo.length === 0) return false;
  const cur = paintTex().readback();
  const prev = g_undo.pop()!;
  if (cur && cur.length === RGBA_LEN) g_redo.push(cur);
  paintTex().upload(prev);
  localstore.nsSet(PAINT_STORE_NS, storeKey(model), bytesToBase64(prev));
  return true;
}

/** Redo: restore the state undone last, stashing the current for undo again. */
export function paintRedo(model: string | null): boolean {
  if (g_redo.length === 0) return false;
  const cur = paintTex().readback();
  const next = g_redo.pop()!;
  if (cur && cur.length === RGBA_LEN) g_undo.push(cur);
  paintTex().upload(next);
  localstore.nsSet(PAINT_STORE_NS, storeKey(model), bytesToBase64(next));
  return true;
}

/** Drop all paint undo/redo history (call when leaving paint / switching model). */
export function clearPaintHistory(): void { g_undo.length = 0; g_redo.length = 0; }

// ── Session init tracking (req_1379b) ──────────────────────────────────────
// The <Paintable> stays mounted as long as a paint texture exists (NOT gated on
// paint mode), so the GPU texture survives paint→object→paint without being
// destroyed. That means base-coat/restore must run only on the FIRST init per
// model per session — re-running it on every paint re-entry would wipe the texture
// that's still sitting there. This set tracks which models have been initialized;
// a hot reload re-evals the module and clears it, so restore-from-localstore runs
// again then (rebuilding a texture the reload may have dropped).
const g_inited = new Set<string>();
export function paintInited(model: string | null): boolean { return g_inited.has(model || 'untitled'); }
export function markPaintInited(model: string | null): void { g_inited.add(model || 'untitled'); }
export function forgetPaintInited(model: string | null): void { g_inited.delete(model || 'untitled'); }
