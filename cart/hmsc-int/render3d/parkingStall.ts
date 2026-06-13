// parkingStall.ts — the ONE home for parking stall-line paint, shared by the
// three lockstep sites that draw it: the game heightfield shader
// (render3d/heightfieldSurface HEIGHTFIELD_TILE_SHADER), its CPU bake mirror
// (heightfieldTexelColor → the compiled floor), and the editor's live painter
// view (painterView.wgsl PAINTER_VIEW_WGSL). Pure (no React) so the compile
// bake can import it.
//
// Two orientations, two tile kinds (req_0710 — "rotate it so I'm not stuck to
// one direction"), the same way the road grammar expresses direction as
// separate lane kinds:
//   • 'parking'      — bay lines run across X (lines of constant X).
//   • 'parkingCross' — bay lines run across Z (lines of constant Z), i.e. the
//                      stalls rotated 90°.
// The cell's kind index picks the axis; the bay paint is otherwise identical,
// so the math + every magic number live HERE once, never copied per site
// (the rule-of-two / no-magic-values rulings).

import { TILE_KINDS } from '../world/tileKinds';

export const PARKING_KIND_INDEX = TILE_KINDS.indexOf('parking');
export const PARKING_CROSS_KIND_INDEX = TILE_KINDS.indexOf('parkingCross');

// Both parking kinds in TILE_KINDS order — the floor bake routes any chunk
// containing one of these through the textured path (the box-slab path can't
// draw the fragment-painted lines).
export const PARKING_KIND_INDICES: readonly number[] = [PARKING_KIND_INDEX, PARKING_CROSS_KIND_INDEX];

// Bay spacing (m / tiles) + line geometry. The compiled floor bakes at 4 px/
// tile, so texel centres sit 0.25 tiles apart and the nearest to a bay line is
// up to 0.125 away; the full-white core (0.16) clears that worst case so the
// line never aliases away (req_0704 — it showed in the painter, vanished in
// the game). One source for all three sites; never re-type these.
export const STALL_BAY_TILES = 3.0;
const STALL_CORE = 0.16;
const STALL_AA = 0.28;
const STALL_STRENGTH = 0.85;
const STALL_RGB: readonly [number, number, number] = [0.85, 0.86, 0.88];

// WGSL float literal: 3 → "3.0" (WGSL is strict about f32 vs abstract-int).
const wf = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));

// WGSL helper injected into every parking shader (prepend PARKING_STALL_WGSL to
// the shader body, then call parking_stall). `coord` is the across-bay axis in
// tiles — uv.x*cols for 'parking', uv.y*rows for 'parkingCross'. (WGSL: no
// unary +, no backticks in comments.)
export const PARKING_STALL_WGSL = `
fn parking_stall(coord: f32, base: vec3f) -> vec3f {
  let d = abs(coord - ${wf(STALL_BAY_TILES)} * round(coord / ${wf(STALL_BAY_TILES)}));
  let s = 1.0 - smoothstep(${wf(STALL_CORE)}, ${wf(STALL_AA)}, d);
  return mix(base, vec3f(${wf(STALL_RGB[0])}, ${wf(STALL_RGB[1])}, ${wf(STALL_RGB[2])}), s * ${wf(STALL_STRENGTH)});
}
`;

function smoothstep01(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** CPU mirror of parking_stall (the compiled bake). `coord` is the across-bay
 *  axis in tiles; returns the base colour with the bay line painted over it. */
export function parkingStallColor(coord: number, rgb: readonly [number, number, number]): [number, number, number] {
  const d = Math.abs(coord - STALL_BAY_TILES * Math.round(coord / STALL_BAY_TILES));
  const s = (1 - smoothstep01(STALL_CORE, STALL_AA, d)) * STALL_STRENGTH;
  return [
    rgb[0] + (STALL_RGB[0] - rgb[0]) * s,
    rgb[1] + (STALL_RGB[1] - rgb[1]) * s,
    rgb[2] + (STALL_RGB[2] - rgb[2]) * s,
  ];
}

/** True for either parking kind — the across-bay axis differs, the paint does
 *  not. Callers branch the axis on which one. */
export function isParkingKind(kind: number): boolean {
  return kind === PARKING_KIND_INDEX || kind === PARKING_CROSS_KIND_INDEX;
}
