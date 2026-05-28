// @reactjit/effects — the shared registry of reusable <Effect>s.
//
// <Effect> is the ONE user-WGSL surface in ReactJIT, and anything worth reusing
// (plasma, gradients, rings, crt, …) lives here ONCE so carts import it by name
// instead of re-rolling private WGSL. Add a liked effect here and every cart
// gets it for free.
//
// Convention (see ./README.md): each entry takes a single `params` object,
// exports a `<NAME>_DEFAULTS` you spread-override, and packs params → data[]
// in the same order its WGSL unpacks P[].
//
//   import { Plasma, PLASMA_DEFAULTS } from '@reactjit/effects';
//   <Plasma params={{ ...PLASMA_DEFAULTS, velocity: 2 }} style={{ flexGrow: 1 }} />
//
// Entries with children sample them via `subtree(uv)` (e.g. Crt) — that's the
// "Effect used as a parent" / former-Filter case.

export { Plasma, PLASMA_DEFAULTS, type PlasmaParams } from './Plasma';
export { Gradient, GRADIENT_DEFAULTS, type GradientParams } from './Gradient';
export { Rings, RINGS_DEFAULTS, type RingsParams } from './Rings';
export { Crt, CRT_DEFAULTS, type CrtParams } from './Crt';
// Water.tsx exports Water + WaterProps but not yet a WATER_DEFAULTS / WaterParams
// (it takes variant/seed/frame props directly, not the single `params` object the
// convention above expects). Barrel-exported so WaterSurface.tsx resolves; the
// active session should finish the params/DEFAULTS convention.
export { Water, type WaterProps } from './Water';
