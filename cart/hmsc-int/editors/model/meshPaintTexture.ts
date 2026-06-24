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

import { paintableOps, type PaintableOps } from '@reactjit/runtime/hooks/usePaintable';
import { bytesToBase64, base64ToBytes } from '@reactjit/workspace';
import { sha256Hex } from '@reactjit/workspace/sha256';
import { encode, image } from '@reactjit/image';
import { faceTexelRect, type TexelRect } from './meshPaint';
import { type EditMesh } from './editMesh';

/** The composite RGBA texture every part's mesh samples — the flattened stack of
 *  paint LAYERS (req_1729). Painting writes the ACTIVE layer; this is recomposited
 *  from the visible layers and is what the mesh reads + what bakes to the paintRef. */
export const STUDIO_PAINT_KEY = 'studio.paint.live';
/** Fixed paint resolution (px). Resolution-independent storage (PNG), so this is
 *  just the working canvas — generous so a many-face gun resolves fine detail. */
export const PAINT_TEX = 1024;

// ── Paint LAYERS (req_1729) ──────────────────────────────────────────────────
// Each layer is its OWN RGBA paintable; painting targets the ACTIVE one, and the
// display texture (STUDIO_PAINT_KEY, sampled by the mesh) is the GPU composite of
// the visible layers — so you can paint a fresh layer over a base without being
// exact, hide/reorder/delete a layer, set its opacity, and erase THROUGH a layer to
// reveal the one below. The layer stack is owned by the editor (StudioViewport) and
// mirrored here via setLayers/setActiveLayerId so the GPU plumbing has one source.

export type PaintLayerMeta = { id: string; name: string; visible: boolean; opacity: number };
export const BASE_LAYER_ID = 'base';

let g_layers: PaintLayerMeta[] = [{ id: BASE_LAYER_ID, name: 'Base', visible: true, opacity: 1 }];
let g_activeLayerId = BASE_LAYER_ID;

/** The GPU paintable key for a layer id. */
export function layerKey(id: string): string { return `studio.paint.L.${id}`; }
/** Mirror the editor's layer stack here (bottom→top order). */
export function setLayers(layers: PaintLayerMeta[]): void { if (layers.length) g_layers = layers; }
export function getLayers(): PaintLayerMeta[] { return g_layers; }
export function setActiveLayerId(id: string): void { g_activeLayerId = id; }
export function activeLayerId(): string { return g_activeLayerId; }
/** Ops for the ACTIVE layer's texture (what a dab accumulates into). */
export function activeLayerOps(): PaintableOps { return paintableOps(layerKey(g_activeLayerId)); }
/** Ops for the DISPLAY/composite texture (what the mesh samples + what bakes). */
export function displayOps(): PaintableOps { return paintableOps(STUDIO_PAINT_KEY); }

/** Flatten the visible layers into the display texture (clear → composite each
 *  visible layer bottom→top × its opacity). Cheap GPU passes; call at stroke-end
 *  and on any layer-stack change, not per dab (live dabs fan to the display). */
export function recompositeDisplay(): void {
  const d = displayOps();
  // Composite each UNIQUE layer id at most ONCE — a stray duplicate id in the stack
  // would otherwise draw a layer's content twice (req_1731). Skip hidden/zero-opacity.
  const seen = new Set<string>();
  const vis = g_layers.filter((L) => {
    if (!L.visible || L.opacity <= 0 || seen.has(L.id)) return false;
    seen.add(L.id);
    return true;
  });
  if (vis.length === 0) { d.composite('', 0, true); return; } // pure clear (nothing visible)
  // clearFirst on the first layer folds the clear INTO the composite sequence, so
  // calling this twice in a frame stays idempotent (the second clear wipes the first).
  vis.forEach((L, i) => d.composite(layerKey(L.id), L.opacity, i === 0));
}

/** Drop any duplicate-id entries from a layer stack (keep first), preserving order.
 *  A layer id must be unique — two entries sharing one would composite + list twice. */
export function dedupeLayers(layers: PaintLayerMeta[]): PaintLayerMeta[] {
  const seen = new Set<string>();
  return layers.filter((L) => (seen.has(L.id) ? false : (seen.add(L.id), true)));
}

// paintTex() fans a STAMP to BOTH the active layer (the durable, isolated source)
// AND the display (instant on-screen feedback, no per-frame recomposite needed);
// clear/upload/readback act on the active layer only. savePaint/undo bake the
// DISPLAY (the flattened picture) via displayOps explicitly.
function fanOps(): PaintableOps {
  const a = activeLayerOps();
  const d = displayOps();
  return {
    id: a.id,
    circle: (cx, cy, r, v) => { a.circle(cx, cy, r, v); d.circle(cx, cy, r, v); },
    circleEdgeAware: (cx, cy, r, v, g, t) => a.circleEdgeAware(cx, cy, r, v, g, t),
    brush: (cx, cy, r, v, k, an, asp, h, f, s, sd) => { a.brush(cx, cy, r, v, k, an, asp, h, f, s, sd); d.brush(cx, cy, r, v, k, an, asp, h, f, s, sd); },
    brushColor: (cx, cy, r, cr, cg, cb, k, an, asp, h, f, s, sd, clx, cly, clw, clh) => {
      a.brushColor(cx, cy, r, cr, cg, cb, k, an, asp, h, f, s, sd, clx, cly, clw, clh);
      d.brushColor(cx, cy, r, cr, cg, cb, k, an, asp, h, f, s, sd, clx, cly, clw, clh);
    },
    brushErase: (cx, cy, r, k, an, asp, h, f, s, sd, clx, cly, clw, clh) => {
      a.brushErase(cx, cy, r, k, an, asp, h, f, s, sd, clx, cly, clw, clh);
      d.brushErase(cx, cy, r, k, an, asp, h, f, s, sd, clx, cly, clw, clh);
    },
    composite: (src, op) => d.composite(src, op),
    clearColor: (r, g, b, al) => a.clearColor(r, g, b, al),
    polygon: (verts, v) => a.polygon(verts, v),
    clear: (v) => a.clear(v),
    upload: (bytes) => a.upload(bytes),
    readback: () => a.readback(),
  };
}

/** Imperative ops for the active paint layer + live display (calls into V8). */
export function paintTex(): PaintableOps {
  return fanOps();
}

/** Hex (`#rrggbb`) → linear-ish 0..1 RGB triplet for the brush colour. */
export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6) || '000000', 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Base coat: flat-fill the ACTIVE layer (the "fill all" / new-texture start), then
 *  recomposite so the display reflects it. */
export function baseCoat(hex: string): void {
  const [r, g, b] = hexToRgb(hex);
  activeLayerOps().clearColor(r, g, b, 1);
  recompositeDisplay();
}

/** Clear the active layer to fully TRANSPARENT (a fresh, empty layer to paint on
 *  without touching what's below), then recomposite. */
export function clearLayerTransparent(id: string): void {
  paintableOps(layerKey(id)).clearColor(0, 0, 0, 0);
  recompositeDisplay();
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

const RGBA_LEN = PAINT_TEX * PAINT_TEX * 4;

// CONTENT-ADDRESSED persistence (req_1382, GUIDING_LIGHT). The painted texture is
// an ASSET: PNG-compress it, hash the bytes (sha256 = paintRef), and hand the
// (ref, blob) to the model stream which interns it ONCE and references it. This
// replaces the localstore base64 hack (a 1024² RGBA is ~5.3MB base64 → blew
// localstore's 4MB cap, so saves were silently dropped and paint vanished). PNG is
// tens of KB; the V20 stream is durable across restart; and a hash-keyed blob is
// exactly the form the in-game asset bake reads — store once, reference everywhere.

/** Hands a content-addressed paint bake (sha256 ref + base64 PNG) to the model
 *  store, which interns the blob and points the model at it. */
export type PaintBake = (paintRef: string, blobB64: string) => void;

function bakeAndEmit(rgba: Uint8Array, emit: PaintBake): string | null {
  const png = encode(rgba, PAINT_TEX, PAINT_TEX, { format: 'png' });
  if (!png || png.length === 0) return null;
  const ref = sha256Hex(png);
  emit(ref, bytesToBase64(png));
  return ref;
}

function byteHex(n: number): string {
  const b = Math.max(0, Math.min(255, Math.round(n)));
  return b.toString(16).padStart(2, '0');
}

export function sampleRgbaHex(rgba: Uint8Array | null, u: number, v: number, w: number, h: number): string | null {
  if (!rgba || w <= 0 || h <= 0 || rgba.length < w * h * 4) return null;
  const x = Math.max(0, Math.min(w - 1, Math.floor(u * w)));
  const y = Math.max(0, Math.min(h - 1, Math.floor(v * h)));
  const i = (y * w + x) * 4;
  if (rgba[i + 3] <= 0) return null;
  return `#${byteHex(rgba[i])}${byteHex(rgba[i + 1])}${byteHex(rgba[i + 2])}`;
}

/** Sample the VISIBLE painted colour (the composited display) at normalized atlas
 *  UV. One-shot eyedropper use only: readback blocks, so never per-frame. */
export function samplePaintHex(u: number, v: number): string | null {
  recompositeDisplay();
  return sampleRgbaHex(displayOps().readback(), u, v, PAINT_TEX, PAINT_TEX);
}

/** Recomposite the layers, read the flattened DISPLAY back and bake it (PNG → hash →
 *  emit) — the durable picture the mesh + compile read. Call at stroke-end / undo /
 *  redo (readback blocks on the GPU, so NOT per dab). Returns the paintRef it wrote. */
export function savePaint(emit: PaintBake): string | null {
  recompositeDisplay();
  const rgba = displayOps().readback();
  if (!rgba || rgba.length !== RGBA_LEN) return null;
  return bakeAndEmit(rgba, emit);
}

/** Restore a saved (flattened) paint blob into the BASE layer, then recomposite so
 *  it shows on the display. Returns true if there was a blob (caller skips the base
 *  coat). Upload parks until the <Paintable> CREATE drains — safe on paint-enter. */
export function restorePaint(blobB64: string | null): boolean {
  if (!blobB64) return false;
  const raw = image(base64ToBytes(blobB64)).raw();
  if (!raw || raw.width !== PAINT_TEX || raw.height !== PAINT_TEX || raw.rgba.length !== RGBA_LEN) return false;
  const baseId = g_layers[0]?.id ?? BASE_LAYER_ID;
  paintableOps(layerKey(baseId)).upload(raw.rgba);
  recompositeDisplay();
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
// Each snapshot remembers WHICH layer it captured, so undo restores the right layer
// even if the active layer changed since (req_1729).
type PaintSnap = { layerId: string; rgba: Uint8Array };
const g_undo: PaintSnap[] = [];
const g_redo: PaintSnap[] = [];

/** Paint mode on/off — gates whether Ctrl-Z routes to paint undo vs model undo. */
export function setPaintActive(on: boolean): void { g_paintActive = on; }
export function paintActive(): boolean { return g_paintActive; }
export function canPaintUndo(): boolean { return g_undo.length > 0; }
export function canPaintRedo(): boolean { return g_redo.length > 0; }

/** Snapshot the texture BEFORE a stroke begins (call on mouse-down in paint).
 *  Pushes the pre-stroke state so undo can return to it; a fresh stroke clears
 *  the redo branch. Readback blocks on the GPU — once per stroke, never per dab. */
export function paintSnapshotBegin(): void {
  const layerId = g_activeLayerId;
  const rgba = paintableOps(layerKey(layerId)).readback();
  if (!rgba || rgba.length !== RGBA_LEN) return;
  g_undo.push({ layerId, rgba });
  if (g_undo.length > UNDO_CAP) g_undo.shift();
  g_redo.length = 0;
}

/** Undo the last stroke: stash the current layer state for redo, restore the
 *  previous, recomposite, and re-bake the flattened display so it persists. */
export function paintUndo(emit: PaintBake): boolean {
  const prev = g_undo.pop();
  if (!prev) return false;
  const ops = paintableOps(layerKey(prev.layerId));
  const cur = ops.readback();
  if (cur && cur.length === RGBA_LEN) g_redo.push({ layerId: prev.layerId, rgba: cur });
  ops.upload(prev.rgba);
  return finishHistoryStep(emit);
}

/** Redo: restore the state undone last, stashing the current for undo again. */
export function paintRedo(emit: PaintBake): boolean {
  const next = g_redo.pop();
  if (!next) return false;
  const ops = paintableOps(layerKey(next.layerId));
  const cur = ops.readback();
  if (cur && cur.length === RGBA_LEN) g_undo.push({ layerId: next.layerId, rgba: cur });
  ops.upload(next.rgba);
  return finishHistoryStep(emit);
}

/** After an undo/redo restored a layer texture: recomposite + bake the flattened
 *  display so the picture persists to the model's paintRef. */
function finishHistoryStep(emit: PaintBake): boolean {
  recompositeDisplay();
  const rgba = displayOps().readback();
  if (rgba && rgba.length === RGBA_LEN) bakeAndEmit(rgba, emit);
  return true;
}

/** Pop the last pushed undo snapshot WITHOUT applying it — for cancelling an op
 *  that called paintSnapshotBegin() but then restored the texture itself (e.g. the
 *  text layer's Cancel, which uploads its own base). Keeps the undo ring honest. */
export function paintDropUndoSnapshot(): void { g_undo.pop(); }

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
