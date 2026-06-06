// editors/characters/paintKit.ts — the sculpt-paint plumbing the route's
// canvas rides: resolutions, the depth-overlay shader, byte↔grid conversion,
// the editor's preview mesh params, and the content-addressed key recipes.
//
// Behavior reference: cart/head_lab/index.tsx (read, never imported). Pure
// data + functions — the route owns the hooks (usePaintable) and the JSX.
//
// EDITOR EXCEPTION, surfaced: editorPartParams extends the bake's recipe
// (partGlobeParams) with non-head displacement so detail paint is VISIBLE
// while authoring — the bake currently composites displacement for the head
// only (game/figure/bake.ts); whether non-head sculpt detail ships in the
// compiled figure is the bake's open question (CAPTURE.md).

import { HED_GRID_H, HED_GRID_W } from '../../game/figure/hed';
import { PART_LOD, PART_PRESETS, type PartId } from '../../game/figure/shapes';
// the engine's own pressure curve — the cursor ring and the landed dab must
// derive from the SAME function (BRUSHFLOOR-0606; headless-safe import)
import { pressureRadius } from '../paint/strokes';
import { editorTunables } from '../tunables';
import type { CharacterDraft } from './draft';
import { regionSignature } from './regions';

export const PAINT_EDITOR_TUNING = Object.freeze({
  /** unwrap canvas (2:1 equirect) as drawn in the route */
  editor: { width: 768, height: 384 },
  /** the GPU paint texture (smooth brushing) */
  paint: { width: 192, height: 96 },
  /** the mesh displacement grid the paint downsamples to on release */
  grid: { width: HED_GRID_W, height: HED_GRID_H },
  /** R8 midpoint = flat; above raises, below carves */
  neutral: 0.5,
  /** knob specs (GAME_CHROME.Knob) */
  knobs: {
    brush: { min: 4, max: 40, step: 2, precision: 0 },
    strength: { min: 0.1, max: 1, step: 0.1, precision: 1 },
    amount: { min: 0.05, max: 0.8, step: 0.05, precision: 2 },
    skull: { min: 0.9, max: 1.6, step: 0.05, precision: 2 },
    photoScale: { min: 0.15, max: 0.95, step: 0.05, precision: 2 },
    photoY: { min: -200, max: 200, step: 8, precision: 0 },
    zoom: { min: 1.6, max: 12, step: 0.4, precision: 1 },
  },
  /** orbit drag feel + pitch clamp. Yaw is unbounded (full 360 spins); pitch
   *  runs pole to pole — ±88 instead of ±90 because the look-at up vector
   *  degenerates exactly overhead/underfoot (GRABQOL-0605: "i cant get top
   *  or bottom of the model"). The host orbit controller doesn't clamp;
   *  this JS clamp is the one authority and the shadow stays exact. */
  orbit: {
    yawPerPx: 0.4, pitchPerPx: 0.3, pitchMin: -88, pitchMax: 88,
    /** zoom-to-cursor pivot travel, as offsets from the view's center —
     *  enough to reach head/feet, never off into space (GRABQOL-0605) */
    panY: 1.1, panXZ: 0.9,
  },
  /** the FLY camera (noclip, GRABFLY-0605): WASD move + q/e (or shift/space)
   *  down/up at flySpeed units/s (host-integrated), drag = look at lookPerPx,
   *  wheel = dolly along the cursor ray by flyWheelStep per notch.
   *  lookPerPx (CAMSENS-0606, USER: "the freeroam ... has the dpi of like a
   *  million so a small movement goes like 720 degree spin"): an fps look
   *  rotates the VIEW DIRECTION — at fov 45 the subject leaves the frame
   *  after ~75px of drag — so its rate must sit ~4× UNDER the orbit rate
   *  (orbit swings the eye around a centered subject; same °/px feels calm
   *  there and wild here). 0.08°/px ≈ a full pane-width drag sweeps ~72°.
   *  /settings-tunable (sculpt-camera cluster below) for the user's own DPI. */
  fly: { speed: 2.6, lookPerPx: 0.08, wheelStep: 0.35, pitchMin: -89, pitchMax: 89 },
  /** boot/refocus framing (CAMFOCUS-0606): on load, on part/model switch, and
   *  on the F verb the camera frames the subject's bounding sphere — margin
   *  multiplies the fitted distance (1 = the sphere kisses the frustum edge);
   *  distance clamps ride knobs.zoom, angles ride each route's defaults.look. */
  frame: { margin: 1.25 },
  /** draft auto-commit debounce (V20 micro-save; AUTOSAVE-0605) */
  autosaveDebounceMs: 1200,
  // (the face-paint palette + stroke numbers died with the coupled
  // color+depth tool — MODELPAINT-0605; /cutout owns texture painting)
});

// CAMSENS-0606: the sculpt camera's FEEL numbers are P2 tunables — they show
// on /settings and the user dials their own DPI. Registration where the
// numbers live (SETTINGS-0605 law); the registry writes THROUGH the table, so
// a knob edit lands in the very value orbitMove reads on the next mouse move.
// Only NESTED leaves are registered — the top-level freeze is shallow, so the
// orbit/fly/frame sub-objects stay writable.
editorTunables().register({
  system: 'sculpt-camera', route: 'editors/sculptCamera', table: PAINT_EDITOR_TUNING,
  specs: {
    'orbit.yawPerPx': { label: 'orbit yaw °/px', min: 0.05, max: 2, step: 0.01, precision: 2 },
    'orbit.pitchPerPx': { label: 'orbit pitch °/px', min: 0.05, max: 2, step: 0.01, precision: 2 },
    'fly.lookPerPx': { label: 'fly look °/px', min: 0.01, max: 0.6, step: 0.01, precision: 2 },
    'fly.speed': { label: 'fly speed u/s', min: 0.5, max: 12, step: 0.1, precision: 1 },
    'fly.wheelStep': { label: 'fly wheel u', min: 0.05, max: 2, step: 0.05, precision: 2 },
    'frame.margin': { label: 'frame margin ×', min: 1, max: 2.5, step: 0.05, precision: 2 },
  },
});

/** 'smooth' (MESHSMOOTH-0606) relaxes the grid (smoothKit) instead of
 *  painting a value — surfaces branch on it before the stroke engine. */
export type SculptMode = 'raise' | 'lower' | 'flatten' | 'smooth';

/** The brush's paint-texture value for a mode at a strength. 'smooth' has no
 *  paint value; an unguarded call paints neutral (a no-op), never a dent. */
export function sculptModeValue(mode: SculptMode, strength: number): number {
  const N = PAINT_EDITOR_TUNING.neutral;
  return mode === 'raise' ? N + 0.5 * strength : mode === 'lower' ? N - 0.5 * strength : N;
}

/** paint-texture R8 bytes → signed mesh grid (average blocks, recenter). */
export function gridFromBytes(bytes: Uint8Array): number[] {
  const { paint, grid, neutral } = PAINT_EDITOR_TUNING;
  const out = new Array(grid.width * grid.height).fill(0);
  const bx = paint.width / grid.width;
  const by = paint.height / grid.height;
  for (let gy = 0; gy < grid.height; gy++) {
    for (let gx = 0; gx < grid.width; gx++) {
      let sum = 0;
      for (let oy = 0; oy < by; oy++) {
        for (let ox = 0; ox < bx; ox++) {
          sum += bytes[(gy * by + oy) * paint.width + gx * bx + ox];
        }
      }
      out[gy * grid.width + gx] = (sum / (bx * by) / 255 - neutral) * 2;
    }
  }
  return out;
}

/** signed grid → paint-texture R8 bytes (nearest-upscaled, for upload). */
export function bytesFromGrid(g: number[]): Uint8Array {
  const { paint, grid, neutral } = PAINT_EDITOR_TUNING;
  const bytes = new Uint8Array(paint.width * paint.height);
  for (let py = 0; py < paint.height; py++) {
    const gy = Math.min(grid.height - 1, Math.floor((py / paint.height) * grid.height));
    for (let px = 0; px < paint.width; px++) {
      const gx = Math.min(grid.width - 1, Math.floor((px / paint.width) * grid.width));
      bytes[py * paint.width + px] = Math.max(0, Math.min(255, Math.round((g[gy * grid.width + gx] / 2 + neutral) * 255)));
    }
  }
  return bytes;
}

/** signed grid → R8 bytes at GRID resolution (the overlay's contour texture). */
export function reliefBytesFromGrid(g: number[]): Uint8Array {
  const { neutral } = PAINT_EDITOR_TUNING;
  const bytes = new Uint8Array(g.length);
  for (let i = 0; i < g.length; i++) {
    bytes[i] = Math.max(0, Math.min(255, Math.round((g[i] / 2 + neutral) * 255)));
  }
  return bytes;
}

// (softening lives in the shared painter now: PAINT.soften3x3 — editors/paint)

/** The editor's PREVIEW mesh params for a part — the bake recipe extended
 *  with live displacement on every part (see the header note).
 *
 *  MIRRORSYM-0606: the editor preview RESOLVES the sculpt grid. The bake
 *  LODs undersample 48×24 (torso 24×12, finger 10×7) — single-cell sculpt
 *  lines alias into irregular spikes that READ as a mirror-symmetry break
 *  under a rotated camera, while the data and the analytic surface are
 *  exactly symmetric (mirrored-pair error 8.5e-15, measured on the user's
 *  own trident). 2× the grid puts a vertex on every cell CENTER (full-value
 *  tents) and every boundary: see-it == sculpt-it. Editor-only — the game
 *  bake keeps its own LODs (the documented open question stands). */
export function editorPartParams(
  id: PartId,
  draft: Pick<CharacterDraft, 'amount' | 'headScaleY' | 'profiles'>,
  displace: number[],
): Record<string, unknown> {
  const preset = PART_PRESETS[id];
  const lod = PART_LOD[id];
  return {
    radius: 1,
    segments: Math.max(lod.segments, HED_GRID_W * 2),
    rings: Math.max(lod.rings, HED_GRID_H * 2),
    displace, dCols: HED_GRID_W, dRows: HED_GRID_H,
    amount: draft.amount,
    // radial-only law: the profile thins x/z; length is scaleY alone
    profile: id === 'head' ? (preset.profile ?? [1]) : draft.profiles[id],
    scaleX: preset.scaleX,
    scaleY: id === 'head' ? draft.headScaleY : preset.scaleY,
    scaleZ: preset.scaleZ,
  };
}

// ── content-addressed keys (the carve_lab stale-bake lesson) ─────────────────

/** Dyn-key contract (3d.zig dynSlotLocate): "<slotId>~<version>". */
export function partDynKey(id: PartId, seq: number, headBits: string, amount: number, regionSig: string): string {
  return `chr.${id}~${seq}.${headBits}.${amount.toFixed(2)}.${regionSig}`;
}

export function headTextureKey(args: { photoStamp: number | null; faceId: string; anim: string; phase: number; skin: string; photoScale: number; photoY: number }): string {
  return `chr.head.${args.photoStamp ?? 'bare'}.${args.faceId}.${args.anim}.${args.phase}.${args.skin}.${args.photoScale.toFixed(2)}.${args.photoY}`;
}

/** Non-head parts share the plain-skin bake. (The clothing/bottoms/bodyShape
 *  key components date from the deleted underwear stamps; they stay so keys
 *  remain stable — wardrobe changes re-bake identical skins, harmless.) */
export function skinTextureKey(id: PartId, args: { skin: string; clothing: string; bottoms: string; bodyShape: string }): string {
  return `chr.skin.${id}.${args.skin}.${args.clothing}.${args.bottoms}.${args.bodyShape}`;
}

export { regionSignature };

// ── the sculpt canvas palette (SCULPTSPLIT-0606 addendum, USER RULING) ───────
// The unwrap canvas is a MEASUREMENT surface, not a skin preview — its base
// and gridlines are FIXED theme ink, never derived from character data. Skin
// tone belongs to the 3D views and the PAINT lens. Both routes (the live
// /characters page and the workbench SCULPT lens) read this one palette.
export const SCULPT_CANVAS = {
  /** the canvas field — the outline lathe's proven dark, now the unwrap's too */
  base: '#0a1322',
  /** the lathe's profile bars (was draft.skin — the exact bug class ruled out) */
  silhouette: '#3d6ea8',
  /** the unwrap guide lines (0..1 rgb — interpolated into the shader below);
   *  pinned LIGHT against the dark base so the grid always reads */
  guideInk: [0.55, 0.66, 0.84],
} as const;

// ── grid nodes (GRIDNODES-0606, USER SPEC) ───────────────────────────────────
// "i want to see every single point on the grid down here as a node that i
// can click on, and can have a slider value that lets me fine tune that one
// specific point." Every sculpt-grid cell is an addressable NODE: the shader
// draws a dot at every cell center, ONE Pressable maps clicks (48×24 React
// nodes would be a scatter-limit violation), the selected node rings bright,
// and its value edits ride the same grid truth as brush/grab/smooth.

export type GridNode = { gx: number; gy: number; idx: number; u: number; v: number };

/** canvas uv → the node under it; u/v come back as that CELL's CENTER (the
 *  same surface point grabPointWorld puts the 3D flag on — one mapping). */
export function gridNodeAt(u: number, v: number): GridNode {
  const { width: GW, height: GH } = PAINT_EDITOR_TUNING.grid;
  const gx = Math.max(0, Math.min(GW - 1, Math.floor(u * GW)));
  const gy = Math.max(0, Math.min(GH - 1, Math.floor(v * GH)));
  return { gx, gy, idx: gy * GW + gx, u: (gx + 0.5) / GW, v: (gy + 0.5) / GH };
}

/** pure: the grid with ONE node set, clamped to the signed depth range. */
export function withNodeValue(grid: number[], idx: number, value: number): number[] {
  const next = grid.slice();
  next[idx] = Math.max(-1, Math.min(1, value));
  return next;
}

/** The GREATER-GRID crossings (meridian × equator) — each gets a DISTINCT
 *  colored dot on the canvas AND a same-color flag on the 3D model at the
 *  same surface uv, so 2D position ↔ 3D location reads instantly.
 *  `ink` is the 0..1 rgb baked into the shader; `color` is the flag's hex. */
export const GREATER_POINTS = [
  { u: 0.25, v: 0.5, color: '#34d399', ink: [0.2, 0.83, 0.6] },
  { u: 0.5, v: 0.5, color: '#ef4444', ink: [0.94, 0.27, 0.27] },
  { u: 0.75, v: 0.5, color: '#3b82f6', ink: [0.23, 0.51, 0.96] },
] as const;

// ── the honest brush (BRUSHFLOOR-0606, USER REPORT) ──────────────────────────
// The sculpt brush speaks DIAMETER in paint px. Before this, the stroke
// engine treated v.brush as a RADIUS SCALE (mouse dab radius = brushPx ×
// 1.0) while the cursor circle drew brushPx/2 — the landed footprint was 2×
// the ring, and the "4px" floor splashed a multi-cell core. Now ONE math
// (sculptEffectiveRadiusPx, riding the engine's own pressureRadius curve)
// feeds BOTH the landed dab and the cursor ring: nominal == drawn == landed.

/** one paint cell, in paint px (192/48 = 96/24 = 4) */
export const SCULPT_CELL_PX = PAINT_EDITOR_TUNING.paint.width / PAINT_EDITOR_TUNING.grid.width;

/** the stroke engine's brushPx argument for a nominal sculpt diameter —
 *  pressureRadius(x) returns x at mouse/fallback pressure, so half the
 *  diameter in = radius out, and the disc lands at exactly nominal width */
export function sculptEngineBrushPx(diameterPx: number): number {
  return diameterPx / 2;
}

/** the effective dab radius (mouse/fallback) for a nominal diameter — THE
 *  number both the landed dab and the cursor footprint derive from */
export function sculptEffectiveRadiusPx(diameterPx: number): number {
  return pressureRadius(diameterPx / 2, undefined);
}

/** THE FLOOR: at single-cell size a dab snaps to the center of the cell
 *  under it — one click = exactly one cell core, zero falloff bleed, no
 *  matter where in the cell the click lands. Above the floor, untouched. */
export function sculptDabSnap(diameterPx: number, x: number, y: number): { x: number; y: number } {
  if (diameterPx > SCULPT_CELL_PX) return { x, y };
  const ch = PAINT_EDITOR_TUNING.paint.height / PAINT_EDITOR_TUNING.grid.height;
  return {
    x: (Math.floor(x / SCULPT_CELL_PX) + 0.5) * SCULPT_CELL_PX,
    y: (Math.floor(y / ch) + 0.5) * ch,
  };
}

// ── the painter overlay shader ───────────────────────────────────────────────
// Layers in one quad: live stroke heat (blue raised / orange carved), contour
// rings of the current form (relief texture, slot 2), the unwrap guides, the
// always-on cell lattice, the per-cell node dots + selection ring, the
// greater-point markers, and the brush footprint ring. Declares the FULL
// textures-mode binding set (2 tex + 2 samp) — the textures-enabled pipeline
// layout expects all four. (No backticks in WGSL; no unary plus.)
//
// data[] contract (SCULPTSPLIT-0606 + GRIDNODES-0606 — both routes must pass
// all 10 floats; a short array reads out of bounds):
//   [0] chunky   — 1: depth/relief snap to cell centers ("precise when
//                  aiming"); 0: cell-bilinear smooth display at rest
//   [1] hoverOn  — 1: the brush footprint renders
//   [2] hoverU / [3] hoverV — cursor in canvas uv
//   [4] brushRadV — brush radius in v units (the 2:1 aspect is corrected here)
//   [5] mode     — 0 raise · 1 carve · 2 flatten · 3 smooth (ring tint)
//   [6] mirror   — 1: the mirror-twin footprint renders across u=0.5
//   [7] selOn    — 1: a node is selected (the ring renders)
//   [8] selU / [9] selV — the selected node's cell-center uv
export const DEPTH_OVERLAY_WGSL = `
@group(0) @binding(1) var<storage, read> data: array<f32>;
@group(0) @binding(2) var depth_tex: texture_2d<f32>;
@group(0) @binding(3) var depth_samp: sampler;
@group(0) @binding(4) var relief_tex: texture_2d<f32>;
@group(0) @binding(5) var relief_samp: sampler;

// bilinear over CELL CENTERS — the display granularity is the sculpt grid
// (what the mesh actually consumes), organic at rest like the 3D result
fn cell_bilinear(tex: texture_2d<f32>, samp: sampler, uv: vec2f, dims: vec2f) -> f32 {
  let p = uv * dims - 0.5;
  let i = floor(p);
  let f = p - i;
  let c00 = textureSampleLevel(tex, samp, (i + vec2f(0.5, 0.5)) / dims, 0.0).r;
  let c10 = textureSampleLevel(tex, samp, (i + vec2f(1.5, 0.5)) / dims, 0.0).r;
  let c01 = textureSampleLevel(tex, samp, (i + vec2f(0.5, 1.5)) / dims, 0.0).r;
  let c11 = textureSampleLevel(tex, samp, (i + vec2f(1.5, 1.5)) / dims, 0.0).r;
  return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let dims = vec2f(${PAINT_EDITOR_TUNING.grid.width}.0, ${PAINT_EDITOR_TUNING.grid.height}.0);
  let chunky = data[0] > 0.5;
  let uv_q = (floor(in.uv * dims) + vec2f(0.5, 0.5)) / dims;

  // smart depth read (Q4): smooth at rest, cell-snapped while aiming
  var live = cell_bilinear(depth_tex, depth_samp, in.uv, dims) - 0.5;
  var relief = cell_bilinear(relief_tex, relief_samp, in.uv, dims) - 0.5;
  if (chunky) {
    live = textureSampleLevel(depth_tex, depth_samp, uv_q, 0.0).r - 0.5;
    relief = textureSampleLevel(relief_tex, relief_samp, uv_q, 0.0).r - 0.5;
  }

  let raised = vec3f(0.24, 0.66, 1.0);
  let carved = vec3f(1.0, 0.58, 0.2);

  // contour rings of the current form, faded out where the surface is flat
  let levels = 12.0;
  let t = fract(abs(relief) * levels);
  let ring = 1.0 - smoothstep(0.0, 0.18, min(t, 1.0 - t));
  let contour_a = ring * 0.3 * smoothstep(0.01, 0.05, abs(relief));
  let contour_c = select(carved, raised, relief > 0.0);

  // unwrap guides: front meridian (u=.5), side meridians (u=.25/.75), equator.
  // SCULPTSPLIT-0606 addendum: the canvas base is FIXED dark ink now, so the
  // guides are light and their alpha is pinned high enough to always read.
  let gx = min(abs(in.uv.x - 0.5), min(abs(in.uv.x - 0.25), abs(in.uv.x - 0.75)));
  let gy = abs(in.uv.y - 0.5);
  let guide_a = max((1.0 - smoothstep(0.0015, 0.0035, gx)) * 0.3,
                    (1.0 - smoothstep(0.003, 0.007, gy)) * 0.22);

  // the cell lattice — ALWAYS ON (USER: "keep the lattice on, there is no
  // reason to not"); one faint line per sculpt-grid cell boundary
  let cf = fract(in.uv * dims);
  let cdx = min(cf.x, 1.0 - cf.x) / dims.x;
  let cdy = min(cf.y, 1.0 - cf.y) / dims.y;
  let cd = min(cdx, cdy);
  let lattice_a = (1.0 - smoothstep(0.0006, 0.0018, cd)) * 0.09;

  let aspect = 2.0; // the unwrap is structurally 2:1 equirect

  // GRIDNODES: a dot at EVERY cell center — every point is a visible node
  let pc = cf - vec2f(0.5, 0.5);
  let node_a = (1.0 - smoothstep(0.10, 0.18, length(pc))) * 0.13;

  // GRIDNODES: the selected node — bright ring + soft fill at its cell
  var sel_a = 0.0;
  if (data[7] > 0.5) {
    let sd = length(vec2f((in.uv.x - data[8]) * aspect, in.uv.y - data[9]));
    let selr = 0.7 / dims.y;
    sel_a = (1.0 - smoothstep(0.002, 0.005, abs(sd - selr)));
    sel_a = max(sel_a, select(0.0, 0.16, sd < selr));
  }
  let sel_c = vec3f(0.2, 0.9, 1.0);

  // GRIDNODES: the greater-grid crossings — distinct colors, matched 1:1 by
  // the same-color flags on the 3D model (GREATER_POINTS is the one truth)
  var greater_a = 0.0;
  var greater_c = vec3f(0.0, 0.0, 0.0);
${GREATER_POINTS.map((p) => `  {
    let gd = length(vec2f((in.uv.x - ${p.u}) * aspect, in.uv.y - ${p.v}));
    let ga = (1.0 - smoothstep(0.006, 0.013, gd)) * 0.95;
    if (ga > greater_a) { greater_a = ga; greater_c = vec3f(${p.ink.join(', ')}); }
  }`).join('\n')}

  // live stroke heat
  let heat_a = clamp(abs(live) * 2.0, 0.0, 1.0) * 0.5;
  let heat_c = select(carved, raised, live > 0.0);

  // the brush footprint (Q3): circle at true size + mode tint, mirror twin
  var brush_a = 0.0;
  var twin_a = 0.0;
  if (data[1] > 0.5) {
    let rad = data[4];
    let pv = vec2f((in.uv.x - data[2]) * aspect, in.uv.y - data[3]);
    let pd = length(pv);
    brush_a = (1.0 - smoothstep(0.0025, 0.006, abs(pd - rad))) * 0.85;
    brush_a = max(brush_a, select(0.0, 0.10, pd < rad));
    if (data[6] > 0.5) {
      let mv = vec2f((in.uv.x - (1.0 - data[2])) * aspect, in.uv.y - data[3]);
      let md = length(mv);
      twin_a = (1.0 - smoothstep(0.0025, 0.006, abs(md - rad))) * 0.45;
      twin_a = max(twin_a, select(0.0, 0.05, md < rad));
    }
  }
  let mode = u32(data[5] + 0.5);
  var brush_c = raised;                                  // 0 raise
  if (mode == 1u) { brush_c = carved; }                  // 1 carve
  if (mode == 2u) { brush_c = vec3f(0.58, 0.64, 0.72); } // 2 flatten
  if (mode == 3u) { brush_c = vec3f(0.2, 0.83, 0.6); }   // 3 smooth
  let foot_a = max(brush_a, twin_a);

  let ink = vec3f(${SCULPT_CANVAS.guideInk.join(', ')});
  // base field: heat/contours/guides compose additively (they ARE light)
  var rgb = heat_c * heat_a + contour_c * contour_a + ink * (guide_a + lattice_a + node_a);
  var out_a = min(heat_a + contour_a + guide_a + lattice_a + node_a, 0.92);
  // markers paint OVER the field (GRIDNODES fix 2: additive blending washed
  // the greater-point hues white against the heat — mix keeps them TRUE,
  // the same token the 3D flag wears)
  rgb = mix(rgb, greater_c, greater_a);
  rgb = mix(rgb, sel_c, sel_a);
  rgb = mix(rgb, brush_c, foot_a);
  let out_a2 = max(max(out_a, greater_a), max(sel_a, foot_a));
  return vec4f(rgb, out_a2);
}
`;

/** The overlay's data[] for a frame — ONE builder for every mount (the
 *  10-float contract above; the old route passes the rest-state defaults).
 *  Aiming (hover) OR a live node selection snaps the display chunky. */
export function depthOverlayData(args?: {
  hover: { u: number; v: number } | null;
  brushPx: number;
  mode: SculptMode;
  mirror: boolean;
  selected?: { u: number; v: number } | null;
}): number[] {
  const hover = args?.hover ?? null;
  const sel = args?.selected ?? null;
  const modeIdx = !args ? 0 : args.mode === 'raise' ? 0 : args.mode === 'lower' ? 1 : args.mode === 'flatten' ? 2 : 3;
  return [
    // the display mode keys off AIMING alone (hover/stroke) — a persistent
    // node selection must NOT hold the canvas chunky (USER: "this never
    // resolves to smooth at all until i leave the interface")
    hover ? 1 : 0,
    hover ? 1 : 0,
    hover?.u ?? 0,
    hover?.v ?? 0,
    // BRUSHFLOOR-0606: the ring shows the EFFECTIVE footprint — the same
    // radius the engine will land at mouse/fallback pressure, in v units
    args ? sculptEffectiveRadiusPx(args.brushPx) / PAINT_EDITOR_TUNING.paint.height : 0,
    modeIdx,
    args?.mirror ? 1 : 0,
    sel ? 1 : 0,
    sel?.u ?? 0,
    sel?.v ?? 0,
  ];
}
