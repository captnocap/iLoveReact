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
  /** draft auto-commit debounce (V20 micro-save; AUTOSAVE-0605) */
  autosaveDebounceMs: 1200,
  // (the face-paint palette + stroke numbers died with the coupled
  // color+depth tool — MODELPAINT-0605; /cutout owns texture painting)
});

export type SculptMode = 'raise' | 'lower' | 'flatten';

/** The brush's paint-texture value for a mode at a strength. */
export function sculptModeValue(mode: SculptMode, strength: number): number {
  const N = PAINT_EDITOR_TUNING.neutral;
  return mode === 'flatten' ? N : mode === 'raise' ? N + 0.5 * strength : N - 0.5 * strength;
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
 *  with live displacement on every part (see the header note). */
export function editorPartParams(
  id: PartId,
  draft: Pick<CharacterDraft, 'amount' | 'headScaleY' | 'profiles'>,
  displace: number[],
): Record<string, unknown> {
  const preset = PART_PRESETS[id];
  const lod = PART_LOD[id];
  return {
    radius: 1, segments: lod.segments, rings: lod.rings,
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

/** Non-head parts share the plain-skin bake EXCEPT the torso, whose texture
 *  carries the underwear stamps (briefs/bra paint in unwrap space). */
export function skinTextureKey(id: PartId, args: { skin: string; clothing: string; bottoms: string; bodyShape: string }): string {
  return `chr.skin.${id}.${args.skin}.${args.clothing}.${args.bottoms}.${args.bodyShape}`;
}

export { regionSignature };

// ── the painter overlay shader ───────────────────────────────────────────────
// Three layers in one quad: live stroke heat (blue raised / orange carved),
// contour rings of the current form (relief texture, slot 2), faint unwrap
// guides. Declares the FULL textures-mode binding set (2 tex + 2 samp) — the
// textures-enabled pipeline layout expects all four. (No backticks in WGSL.)
export const DEPTH_OVERLAY_WGSL = `
@group(0) @binding(1) var<storage, read> data: array<f32>;
@group(0) @binding(2) var depth_tex: texture_2d<f32>;
@group(0) @binding(3) var depth_samp: sampler;
@group(0) @binding(4) var relief_tex: texture_2d<f32>;
@group(0) @binding(5) var relief_samp: sampler;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let live = textureSampleLevel(depth_tex, depth_samp, in.uv, 0.0).r - 0.5;
  let relief = textureSampleLevel(relief_tex, relief_samp, in.uv, 0.0).r - 0.5;

  let raised = vec3f(0.24, 0.66, 1.0);
  let carved = vec3f(1.0, 0.58, 0.2);

  // contour rings of the current form, faded out where the surface is flat
  let levels = 12.0;
  let t = fract(abs(relief) * levels);
  let ring = 1.0 - smoothstep(0.0, 0.18, min(t, 1.0 - t));
  let contour_a = ring * 0.3 * smoothstep(0.01, 0.05, abs(relief));
  let contour_c = select(carved, raised, relief > 0.0);

  // unwrap guides: front meridian (u=.5), side meridians (u=.25/.75), equator
  let gx = min(abs(in.uv.x - 0.5), min(abs(in.uv.x - 0.25), abs(in.uv.x - 0.75)));
  let gy = abs(in.uv.y - 0.5);
  let guide_a = max((1.0 - smoothstep(0.0015, 0.0035, gx)) * 0.13,
                    (1.0 - smoothstep(0.003, 0.007, gy)) * 0.09);

  // live stroke heat
  let heat_a = clamp(abs(live) * 2.0, 0.0, 1.0) * 0.5;
  let heat_c = select(carved, raised, live > 0.0);

  let ink = vec3f(0.07, 0.1, 0.16);
  let color = heat_c * heat_a + contour_c * contour_a + ink * guide_a;
  let a = min(heat_a + contour_a + guide_a, 0.85);
  return vec4f(color, a);
}
`;
