// @reactjit/particles — the particle system's data WAIST (GUIDING_LIGHT slice 1).
//
// A particle system is DATA (declarative emitter specs) run by a FIXED HOST
// SYSTEM (the continuous tier, `pos += vel·dt`, + a billboard GPU pipeline).
// This package is the narrow format both sides speak:
//
//   • format   — the EmitterSpec (a sum of factors, no closures), its packed
//                binary load form, and the columnar particle-pool contract the
//                host integrates.
//   • presets  — the emitter vocabulary (fire/smoke/spark/explosion), each spec
//                stored ONCE and referenced by name.
//   • events   — the separable seam: producers (GAME_FIRE/GAME_EXPLOSION/weather)
//                emit `light`/`burst` events; the system drains them. No coupling.
//
// NEXT SLICES (own requests): ./simulate.ts — the executable arithmetic spec +
// editor-preview integrator (authoring only; the shipped game runs it in Zig);
// then the host billboard pipeline (framework/gpu, a ~grass~ sibling) + the
// <Particles> surface. Nothing here runs a frame.

export {
  type EmitterSpec,
  type BillboardMode,
  type BlendMode,
  type AtlasSlot,
  type Range,
  type ParticleColumn,
  range,
  packEmitter,
  BILLBOARD_CODE,
  BLEND_CODE,
  ATLAS_CODE,
  EMITTER_FIELD_ORDER,
  PARTICLE_COLUMNS,
} from './format';

export {
  SMOKE,
  FIRE,
  SPARK,
  EXPLOSION,
  PARTICLE_PRESETS,
  type PresetName,
} from './presets';

export {
  type Vec3,
  type ParticleLight,
  type ParticleBurst,
  type ParticleEvent,
  type ParticleBus,
  makeParticleBus,
} from './events';

export {
  type Particle,
  type ParticleSystem,
  makeParticleSystem,
} from './simulate';
