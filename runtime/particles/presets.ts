// @reactjit/particles presets — the emitter VOCABULARY. Each entry is one
// declarative EmitterSpec, stored ONCE and referenced by name (content-address
// the spec; everything else is a pointer). These are the reusable "looks" —
// fire, smoke, spark, an explosion burst — that any system drives by emitting an
// event (see ./events). They are data, not code: a cart adds a look by adding a
// spec here, never by writing a frame loop.
//
// The numbers are ported/retuned from the THREE.js smoke-emitter reference the
// user shared (its emitters were already this declarative shape). HDR color
// values (>1) are intentional: additive blending turns them into bloom.

import { range, type EmitterSpec } from './format';

// A lazy column of grey smoke that rises and fades. Alpha-blended (it occludes).
export const SMOKE: EmitterSpec = {
  innerRadius: 0.02, outerRadius: 1, height: 5,
  ratePerSecond: 10, burst: 0,
  life: range(7, 7.5), speed: range(0.3, 0.6),
  scaleStart: 0.2, scaleGrowthPerSecond: 0.24, spin: range(0.5, 1),
  colorFrom: [2, 2, 2], colorTo: [0.05, 0.05, 0.05], colorRampSeconds: 3,
  opacity: 1, opacityFadePerSecond: 0.5,
  blend: 'alpha', billboard: 'face', texture: 'smoke',
};

// A steady flame: hot core fading up to smoke-tip, additive so it glows.
export const FIRE: EmitterSpec = {
  innerRadius: 0.05, outerRadius: 0.35, height: 4,
  ratePerSecond: 38, burst: 0,
  life: range(0.5, 0.9), speed: range(1.0, 1.8),
  scaleStart: 0.55, scaleGrowthPerSecond: 0.9, spin: range(-1.2, 1.2),
  colorFrom: [3.0, 1.6, 0.4], colorTo: [0.7, 0.08, 0.02], colorRampSeconds: 0.7,
  opacity: 1, opacityFadePerSecond: 3.5,
  blend: 'additive', billboard: 'face', texture: 'fire',
};

// Sparks: fast, short-lived, velocity-stretched streaks. Additive.
export const SPARK: EmitterSpec = {
  innerRadius: 0.0, outerRadius: 0.05, height: 1,
  ratePerSecond: 0, burst: 24,
  life: range(0.25, 0.6), speed: range(6, 14),
  scaleStart: 0.12, scaleGrowthPerSecond: -0.1, spin: range(0, 0),
  colorFrom: [4.0, 2.6, 1.0], colorTo: [1.0, 0.3, 0.05], colorRampSeconds: 0.4,
  opacity: 1, opacityFadePerSecond: 4,
  blend: 'additive', billboard: 'stretch', texture: 'spark',
};

// The boom itself: one big fireball burst — many short-lived hot puffs thrown out
// of a wide cone. Pair with SPARK (debris) + SMOKE (aftermath) at the same point.
export const EXPLOSION: EmitterSpec = {
  innerRadius: 0.1, outerRadius: 1.2, height: 2,
  ratePerSecond: 0, burst: 60,
  life: range(0.4, 0.9), speed: range(3, 9),
  scaleStart: 0.8, scaleGrowthPerSecond: 4.0, spin: range(-2, 2),
  colorFrom: [5.0, 3.5, 1.2], colorTo: [0.6, 0.1, 0.04], colorRampSeconds: 0.6,
  opacity: 1, opacityFadePerSecond: 2.2,
  blend: 'additive', billboard: 'face', texture: 'fire',
};

// The registry — name → spec. The event layer references emitters by these keys.
export const PARTICLE_PRESETS = { smoke: SMOKE, fire: FIRE, spark: SPARK, explosion: EXPLOSION } as const;
export type PresetName = keyof typeof PARTICLE_PRESETS;
