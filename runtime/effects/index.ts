// @reactjit/effects — the shared registry of reusable <Effect>s.
//
// The point: <Effect> is the ONE user-WGSL surface in ReactJIT, and anything
// worth reusing (plasma, gradients, rings, …) lives here ONCE so carts import
// it by name instead of re-rolling private WGSL. Add a liked effect here and
// every cart gets it for free.
//
//   import { Plasma, Gradient, Rings } from '@reactjit/effects';
//   <Plasma style={{ flexGrow: 1 }} speed={1.4} />
//
// See ./README.md for the authoring contract (the uniforms/effect_math the
// host injects) and how to add a new entry.

export { Plasma, type PlasmaProps } from './Plasma';
export { Gradient, type GradientProps } from './Gradient';
export { Rings, type RingsProps } from './Rings';
