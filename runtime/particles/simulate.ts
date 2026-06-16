// @reactjit/particles simulate — the FIXED SYSTEM, written as pure arithmetic.
//
// This is the executable SPEC of the particle system's behaviour: spawn from
// emitters, integrate every live particle (`pos += vel·dt`, age, a color lerp, a
// scale ramp), cull the dead. The shipped game runs exactly this arithmetic in
// Zig over the columnar pool (format.ts PARTICLE_COLUMNS); this JS twin is the
// AUTHORING/EDITOR-PREVIEW integrator AND the reference the host must match —
// it is never on the shipped frame path (GUIDING_LIGHT: the CPU produces
// artifacts and previews, the host runs frames).
//
// For legibility as a spec it keeps particles as plain objects; the host uses
// struct-of-arrays for the no-GC native loop. Same arithmetic either way.
//
// Determinism: every random draw comes from a seeded generator, so a given
// (events, dt) trace replays identically — the property the whole data-engine
// rests on (replay/rollback/lockstep fall out of pure systems).

import type { EmitterSpec } from './format';
import { PARTICLE_PRESETS } from './presets';
import type { ParticleEvent } from './events';

// generous by default — truncation is LOUD (see `dropped`), never a silent cap.
const DEFAULT_CAPACITY = 4096;

// One live particle (the resolved factors + integration state). The host stores
// these as SoA columns; here they are objects for readability.
export type Particle = {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  scale: number; scaleGrowth: number;
  rot: number; rotVel: number;
  r: number; g: number; b: number; a: number;
  colorFrom: [number, number, number];
  colorTo: [number, number, number];
  colorRamp: number;
  opacity: number; opacityFade: number;
  life: number; age: number;
  billboard: EmitterSpec['billboard'];
  tex: EmitterSpec['texture'];
};

// A continuous source kept alive by re-emitted `light` events (events.ts). Holds
// the fractional emission accumulator so a 38/s rate emits correctly at any dt.
type LiveLight = { spec: EmitterSpec; x: number; y: number; z: number; intensity: number; accumulator: number; seen: boolean };

export type ParticleSystem = {
  /** reconcile this frame's events, emit, integrate, cull — one call per frame */
  frame: (events: ParticleEvent[], dtSeconds: number) => void;
  /** live particle count */
  count: () => number;
  /** particles dropped because the pool was full (for a LOUD truncation log) */
  dropped: () => number;
  /** read live particles for rendering (no mutation); sort is the renderer's job */
  forEachLive: (cb: (p: Particle, index: number) => void) => void;
  /** drop everything (lab reset) */
  clear: () => void;
};

// mulberry32 — a tiny seeded PRNG (runtime/ must not import the game-side one).
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function makeParticleSystem(opts: { capacity?: number; seed?: number } = {}): ParticleSystem {
  const capacity = opts.capacity ?? DEFAULT_CAPACITY;
  const rng = seededRng(opts.seed ?? 1);
  const pool: Particle[] = [];
  const lights = new Map<string, LiveLight>();
  let dropped = 0;

  // a point uniformly inside a disc of the given radius (offsets in x,z)
  function inDisc(radius: number): [number, number] {
    const r = radius * Math.sqrt(rng());
    const theta = 2 * Math.PI * rng();
    return [r * Math.cos(theta), r * Math.sin(theta)];
  }

  // spawn ONE particle from a spec at a world point. `volumeScale` widens the
  // emission cone (a bigger burst). Returns false (and counts a drop) when full.
  function spawn(spec: EmitterSpec, x: number, y: number, z: number, volumeScale: number): boolean {
    if (pool.length >= capacity) { dropped++; return false; }
    // a cone frustum: base point in the inner disc, aim point in the outer disc,
    // lifted by `height` — the spawn direction (reference radius_1/radius_2/height).
    const [bx, bz] = inDisc(spec.innerRadius * volumeScale);
    const [ax, az] = inDisc(spec.outerRadius * volumeScale);
    const dx = ax, dy = spec.height, dz = az;
    const dlen = Math.hypot(dx, dy, dz) || 1;
    const speed = lerp(spec.speed[0], spec.speed[1], rng());
    pool.push({
      x: x + bx, y, z: z + bz,
      vx: (dx / dlen) * speed, vy: (dy / dlen) * speed, vz: (dz / dlen) * speed,
      scale: spec.scaleStart, scaleGrowth: spec.scaleGrowthPerSecond,
      rot: rng() * Math.PI * 2, rotVel: lerp(spec.spin[0], spec.spin[1], rng()),
      r: spec.colorFrom[0], g: spec.colorFrom[1], b: spec.colorFrom[2], a: spec.opacity,
      colorFrom: spec.colorFrom, colorTo: spec.colorTo, colorRamp: spec.colorRampSeconds,
      opacity: spec.opacity, opacityFade: spec.opacityFadePerSecond,
      life: lerp(spec.life[0], spec.life[1], rng()), age: 0,
      billboard: spec.billboard, tex: spec.texture,
    });
    return true;
  }

  function reconcile(events: ParticleEvent[]) {
    for (const l of lights.values()) l.seen = false;
    for (const ev of events) {
      const spec = PARTICLE_PRESETS[ev.preset];
      if (!spec) continue;
      if (ev.kind === 'light') {
        const existing = lights.get(ev.id);
        if (existing) {
          existing.x = ev.at[0]; existing.y = ev.at[1]; existing.z = ev.at[2];
          existing.intensity = ev.intensity ?? 1; existing.seen = true;
        } else {
          lights.set(ev.id, { spec, x: ev.at[0], y: ev.at[1], z: ev.at[2], intensity: ev.intensity ?? 1, accumulator: 0, seen: true });
        }
      } else {
        // burst: emit `burst × scale` particles at once, in a `scale`-wide cone
        const scale = ev.scale ?? 1;
        const n = Math.round(spec.burst * scale);
        for (let i = 0; i < n; i++) spawn(spec, ev.at[0], ev.at[1], ev.at[2], scale);
      }
    }
    // a light not re-emitted this frame has been extinguished
    for (const [id, l] of lights) if (!l.seen) lights.delete(id);
  }

  function emitStreams(dt: number) {
    for (const l of lights.values()) {
      l.accumulator += l.spec.ratePerSecond * l.intensity * dt;
      while (l.accumulator >= 1) { l.accumulator -= 1; if (!spawn(l.spec, l.x, l.y, l.z, 1)) break; }
    }
  }

  function integrate(dt: number) {
    // swap-remove cull: dead particles get overwritten by the last live one.
    for (let i = 0; i < pool.length; ) {
      const p = pool[i];
      p.age += dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.scale = Math.max(0, p.scale + p.scaleGrowth * dt);
      p.rot += p.rotVel * dt;
      const t = p.colorRamp > 0 ? Math.min(p.age / p.colorRamp, 1) : 1;
      p.r = lerp(p.colorFrom[0], p.colorTo[0], t);
      p.g = lerp(p.colorFrom[1], p.colorTo[1], t);
      p.b = lerp(p.colorFrom[2], p.colorTo[2], t);
      // `life` is the solid-burn span; past it the particle fades out, then dies
      // (reference: live counts down, then alpha decreases until culled).
      if (p.age >= p.life) p.a -= p.opacityFade * dt;
      if (p.a <= 0) { pool[i] = pool[pool.length - 1]; pool.pop(); continue; }
      i++;
    }
  }

  return {
    frame(events, dt) { reconcile(events); emitStreams(dt); integrate(dt); },
    count: () => pool.length,
    dropped: () => dropped,
    forEachLive(cb) { for (let i = 0; i < pool.length; i++) cb(pool[i], i); },
    clear() { pool.length = 0; lights.clear(); dropped = 0; },
  };
}
