// @reactjit/particles — the data WAIST for the particle system.
//
// GUIDING_LIGHT, made literal: a particle system is NOT engine code, it is DATA
// (declarative emitter specs) run by a FIXED HOST SYSTEM (the continuous tier:
// `pos += vel·dt`). This file is the narrow format that producer (typed TS
// presets) and host (the Zig integrator + billboard pipeline) both speak.
//
// Every rule the north star sets, applied here:
//   • DECLARATIVE, never Turing-complete — an EmitterSpec is a SUM OF FACTORS
//     (volume + rate + lifetime + a color lerp + a scale ramp + render enums).
//     No closures, no conditionals, no per-particle functions. The only "logic"
//     is enum SELECTORS that pick a fixed system path (billboard/blend/texture);
//     customisability is bounded by the dimensions the system exposes, not by
//     general computation.
//   • The product is the cost; keep the factors. A particle's full state is the
//     outer product (position × color × scale × …); we store the FACTORS and let
//     the host multiply them at integrate-time.
//   • CONTENT-ADDRESS everything. The sprite atlas stores each texture once; a
//     particle REFERENCES a slot by index. A preset is one spec, referenced
//     everywhere (see ./presets).
//   • Pack BINARY, zero-copy. packEmitter → a Float32Array IS the load form; the
//     host reads the floats in place, no JSON parse, no GC.
//
// The companion ./simulate.ts is the executable SPEC of the fixed system's
// arithmetic (and the editor-preview integrator — authoring only). The shipped
// game runs that same arithmetic in Zig. Nothing here runs a frame.

// ── render SELECTORS (fixed system paths the host implements) ────────────────

// How a quad orients to the camera — the reference's `quaternion.w` trick, named.
//   face    — full camera-facing billboard (smoke puffs, fireballs)        [w=3]
//   axis    — locked to world-up, yaws to the camera (grass, upright flame) [w=4]
//   stretch — oriented along the particle's velocity (sparks, tracers)      [w=6]
export type BillboardMode = 'face' | 'axis' | 'stretch';
export const BILLBOARD_CODE: Record<BillboardMode, number> = { face: 0, axis: 1, stretch: 2 };

//   additive — light-emitting (fire, sparks, magic): colors SUM, no sort needed
//   alpha    — occluding (smoke, dust): needs back-to-front draw
export type BlendMode = 'additive' | 'alpha';
export const BLEND_CODE: Record<BlendMode, number> = { additive: 0, alpha: 1 };

// A content-addressed atlas slot. Each sprite is stored ONCE; particles point at
// it by index. (Order mirrors the reference atlas so the WGSL sampler matches.)
export type AtlasSlot = 'smoke' | 'fire' | 'spark' | 'grass';
export const ATLAS_CODE: Record<AtlasSlot, number> = { smoke: 0, fire: 1, spark: 2, grass: 3 };

// A scalar that may vary per particle. A constant `n` is the degenerate range
// [n,n]; the host samples uniformly between min and max ONCE at spawn (a 2-factor
// range, not a distribution function — declarative). `range(n)` and `range(a,b)`.
export type Range = [number, number];
export const range = (a: number, b?: number): Range => [a, b ?? a];

// ── the EMITTER SPEC — the declarative unit of authoring (a sum of factors) ───

export type EmitterSpec = {
  // EMISSION VOLUME — a cone frustum (inner disc → outer disc, lifted by height).
  // Pure geometry factors; the host picks a spawn point inside it. (ref radius_1/2)
  innerRadius: number;
  outerRadius: number;
  height: number;

  // EMISSION RATE — a continuous stream and/or a one-shot burst on trigger.
  ratePerSecond: number; // 0 = burst-only (an explosion is rate 0 + burst N)
  burst: number;         // particles emitted at once when the emitter is triggered

  // PER-PARTICLE LIFETIME + the arithmetic factors the integrator advances.
  life: Range;                  // seconds before the particle dies
  speed: Range;                 // m/s along the spawn direction
  scaleStart: number;           // world size at birth
  scaleGrowthPerSecond: number; // dScale/dt (ref scale_increase, per second)
  spin: Range;                  // rad/s billboard rotation

  // COLOR as a 2-ENDPOINT RAMP — a lerp factor, NOT a curve function. Values may
  // exceed 1.0 (HDR; additive blending turns that into bloom). (ref color_from/to)
  colorFrom: [number, number, number];
  colorTo: [number, number, number];
  colorRampSeconds: number;     // time to travel colorFrom → colorTo
  opacity: number;              // alpha at birth
  opacityFadePerSecond: number; // dAlpha/dt once life is spent (ref opacity_decrease)

  // RENDER — fixed-path selectors.
  blend: BlendMode;
  billboard: BillboardMode;
  texture: AtlasSlot;
};

// ── the packed artifact — binary, zero-copy, content-addressable ─────────────

// The float order the host unpacks. ONE source of truth shared by packEmitter
// (producer side) and the Zig reader (host side) — change here, change there.
export const EMITTER_FIELD_ORDER = [
  'innerRadius', 'outerRadius', 'height',
  'ratePerSecond', 'burst',
  'lifeMin', 'lifeMax', 'speedMin', 'speedMax',
  'scaleStart', 'scaleGrowthPerSecond', 'spinMin', 'spinMax',
  'colorFromR', 'colorFromG', 'colorFromB',
  'colorToR', 'colorToG', 'colorToB',
  'colorRampSeconds', 'opacity', 'opacityFadePerSecond',
  'blend', 'billboard', 'texture',
] as const;

/** Flatten a spec to its load form. The returned Float32Array is the artifact —
 *  hash it to content-address the emitter; hand the bytes to the host as-is. */
export function packEmitter(s: EmitterSpec): Float32Array {
  return new Float32Array([
    s.innerRadius, s.outerRadius, s.height,
    s.ratePerSecond, s.burst,
    s.life[0], s.life[1], s.speed[0], s.speed[1],
    s.scaleStart, s.scaleGrowthPerSecond, s.spin[0], s.spin[1],
    s.colorFrom[0], s.colorFrom[1], s.colorFrom[2],
    s.colorTo[0], s.colorTo[1], s.colorTo[2],
    s.colorRampSeconds, s.opacity, s.opacityFadePerSecond,
    BLEND_CODE[s.blend], BILLBOARD_CODE[s.billboard], ATLAS_CODE[s.texture],
  ]);
}

// ── the PARTICLE POOL — the columnar (SoA) state the FIXED HOST integrates ────
//
// The host owns this buffer; the format is the contract. Struct-of-arrays so the
// native loop is zero-alloc and cache-friendly (no-GC native runtime). Each
// particle's per-frame factors are RESOLVED AT SPAWN (the host samples the spec's
// ranges once) so the integrator only does arithmetic and never re-reads the spec
// — that's the low-rank cut: the emitter→particle coupling is paid once, at birth.
export const PARTICLE_COLUMNS = [
  'px', 'py', 'pz',          // position (m)         — integrated: p += v·dt
  'vx', 'vy', 'vz',          // velocity (m/s)
  'scale', 'scaleGrowth',    // size + dScale/dt
  'rot', 'rotVel',           // billboard rotation + dRot/dt
  'r', 'g', 'b', 'a',        // current color (resolved each step from the ramp)
  'colorFromR', 'colorFromG', 'colorFromB',
  'colorToR', 'colorToG', 'colorToB',
  'colorRampSeconds',
  'opacity', 'opacityFade',  // birth alpha + dAlpha/dt after life ends
  'life', 'age',             // seconds total / elapsed; age ≥ life → cull
  'billboard', 'tex',        // render selectors (the spec's enum codes)
] as const;

export type ParticleColumn = (typeof PARTICLE_COLUMNS)[number];
