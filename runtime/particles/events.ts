// @reactjit/particles events — the SEPARABLE SEAM.
//
// GUIDING_LIGHT: "Keep the systems separable; bridge with events. Coupling is the
// rank that costs." The particle system must know NOTHING about explosives, cars,
// weather, or any producer. Producers don't call into rendering; they emit a tiny
// declarative event and drop it on a bus. The particle system drains the bus.
//
// So GAME_FIRE.burningCells → a stream of `light` events; a GAME_EXPLOSION blast
// → one `burst` event; rain, exhaust, muzzle-flash → the same two verbs with a
// different preset. Two verbs, by design — a continuous source and a one-shot —
// mirroring the two emission factors (ratePerSecond, burst) in the spec.

import type { PresetName } from './presets';

export type Vec3 = [number, number, number];

// LIGHT — a continuous emitter exists at a place while `active`. Re-emitting the
// same id updates it (move the fire as it spreads); omit it next drain to stop.
// `intensity` scales the spec's rate (a half-lit cell emits less).
export type ParticleLight = {
  kind: 'light';
  id: string;            // stable handle so the source can move/extinguish it
  preset: PresetName;
  at: Vec3;
  intensity?: number;    // 0..1+ multiplier on ratePerSecond (default 1)
};

// BURST — fire the emitter's `burst` count once at a point, then forget it.
// `scale` multiplies the burst count and the spawn volume (a bigger boom).
export type ParticleBurst = {
  kind: 'burst';
  preset: PresetName;
  at: Vec3;
  scale?: number;        // default 1
};

export type ParticleEvent = ParticleLight | ParticleBurst;

// The bus contract the host (or the preview integrator) drains each frame. A
// producer only ever touches `emit`; it never sees a particle. Ref-backed on the
// consumer side so emitting never triggers a re-render (PARTICLE-SEAM).
export type ParticleBus = {
  emit: (event: ParticleEvent) => void;
  /** drain + clear the queued events for this frame (consumer side) */
  drain: () => ParticleEvent[];
};

export function makeParticleBus(): ParticleBus {
  let queue: ParticleEvent[] = [];
  return {
    emit: (event) => { queue.push(event); },
    drain: () => { const out = queue; queue = []; return out; },
  };
}
