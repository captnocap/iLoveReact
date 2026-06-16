// Behavior tests for the fixed system (the executable spec): emitters spawn the
// right way, particles integrate and die, bursts vs streams behave, the pool
// truncates LOUDLY, and the same seed replays identically.

import { makeParticleSystem, type Particle } from './index';

let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`PASS particles-sim :: ${name}`); }
  catch (e: any) { failed++; console.error(`FAIL particles-sim :: ${name} — ${e?.message ?? e}`); }
}
function assert(c: boolean, m: string) { if (!c) throw new Error(m); }
function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m} (expected ${String(b)}, got ${String(a)})`); }

const collect = (sys: ReturnType<typeof makeParticleSystem>): Particle[] => { const out: Particle[] = []; sys.forEachLive((p) => out.push({ ...p })); return out; };

test('a burst spawns its count at once; an empty frame adds nothing more', () => {
  const sys = makeParticleSystem({ seed: 1 });
  sys.frame([{ kind: 'burst', preset: 'explosion', at: [0, 0, 0] }], 1 / 60);
  const after = sys.count();
  assert(after > 0, 'the explosion put particles in the pool');
  sys.frame([], 1 / 60); // no events
  assert(sys.count() <= after, 'an empty frame emits nothing new (only ages/culls)');
});

test('burst scale multiplies the count', () => {
  const a = makeParticleSystem({ seed: 5 });
  a.frame([{ kind: 'burst', preset: 'spark', at: [0, 0, 0], scale: 1 }], 1 / 60);
  const b = makeParticleSystem({ seed: 5 });
  b.frame([{ kind: 'burst', preset: 'spark', at: [0, 0, 0], scale: 3 }], 1 / 60);
  assert(b.count() > a.count(), 'scale 3 burst > scale 1 burst');
});

test('a continuous light streams particles over time, and stops when not re-emitted', () => {
  const sys = makeParticleSystem({ seed: 2 });
  const light = { kind: 'light' as const, id: 'f0', preset: 'fire' as const, at: [0, 0, 0] as [number, number, number] };
  for (let i = 0; i < 30; i++) sys.frame([light], 1 / 60); // ~0.5s of fire
  const lit = sys.count();
  assert(lit > 0, 'fire accumulated a flame');
  // stop re-emitting: the source extinguishes, existing particles fade out
  for (let i = 0; i < 120; i++) sys.frame([], 1 / 60);
  eq(sys.count(), 0, 'with no source and time, the flame fully dies');
});

test('particles integrate: position advances along velocity', () => {
  const sys = makeParticleSystem({ seed: 3 });
  sys.frame([{ kind: 'burst', preset: 'spark', at: [0, 0, 0] }], 0); // spawn at age 0, no move yet
  const born = collect(sys);
  assert(born.length > 0, 'sparks spawned');
  sys.frame([], 0.1); // advance 100ms
  const moved = collect(sys);
  // at least one particle measurably changed position (sparks are fast)
  let anyMoved = false;
  for (const p of moved) if (Math.hypot(p.x, p.y, p.z) > 0.01) anyMoved = true;
  assert(anyMoved, 'pos += vel·dt moved the particles');
});

test('a light particle eventually dies after its life + fade tail', () => {
  const sys = makeParticleSystem({ seed: 7 });
  const light = { kind: 'light' as const, id: 'x', preset: 'fire' as const, at: [0, 0, 0] as [number, number, number] };
  // a rate of 38/s needs a few 16ms frames to accumulate a whole particle
  for (let i = 0; i < 12; i++) sys.frame([light], 1 / 60);
  assert(sys.count() > 0, 'sustained fire emitted a flame');
  for (let i = 0; i < 300; i++) sys.frame([], 1 / 30); // ~10s, no source
  eq(sys.count(), 0, 'all fire particles fade and cull');
});

test('the pool truncates LOUDLY, not silently', () => {
  const sys = makeParticleSystem({ seed: 9, capacity: 10 });
  sys.frame([{ kind: 'burst', preset: 'explosion', at: [0, 0, 0], scale: 5 }], 1 / 60); // wants 60×5
  eq(sys.count(), 10, 'pool capped at capacity');
  assert(sys.dropped() > 0, 'and the overflow is COUNTED (a loud truncation), not hidden');
});

test('same seed + same events replay identically (determinism)', () => {
  const run = () => {
    const s = makeParticleSystem({ seed: 42 });
    s.frame([{ kind: 'burst', preset: 'explosion', at: [1, 0, 2] }], 1 / 60);
    s.frame([], 0.05);
    return collect(s).map((p) => [p.x.toFixed(5), p.y.toFixed(5), p.z.toFixed(5), p.a.toFixed(5)]);
  };
  eq(JSON.stringify(run()), JSON.stringify(run()), 'identical trace under the same seed');
});

console.log(`particles-sim: ${7 - failed}/7 passed`);
const exit = (globalThis as any).__exit;
if (typeof exit === 'function') exit(failed > 0 ? 1 : 0);
else if (failed > 0) throw new Error(`${failed} sim test(s) failed`);
