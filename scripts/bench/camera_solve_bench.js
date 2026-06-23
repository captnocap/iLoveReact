// camera_solve_bench.js — measures the COST of a camera rig solve in V8.
//
// Run: tools/v8cli scripts/bench/camera_solve_bench.js
//
// The solvers below are faithful inlines of runtime/cameras/rigs/*.ts (the same
// arithmetic, byte-for-byte intent) so this measures the real per-frame cost of
// "compute the camera POV in JS." Input varies every iteration so V8 can't hoist
// the call out of the loop, and a checksum is printed to defeat dead-code
// elimination. Pair with camera_solve_bench.zig for the JS-vs-Zig comparison.

const DEG = Math.PI / 180;

function orbitalEye(tx, ty, tz, yawDeg, pitchDeg, dist) {
  const yaw = yawDeg * DEG, elev = pitchDeg * DEG;
  const horiz = dist * Math.cos(elev), height = dist * Math.sin(elev);
  return [tx - Math.sin(yaw) * horiz, ty + height, tz - Math.cos(yaw) * horiz];
}
function lookForward(ex, ey, ez, yawDeg, pitchDeg) {
  const yaw = yawDeg * DEG, pit = pitchDeg * DEG;
  return [ex + Math.sin(yaw) * Math.cos(pit), ey + Math.sin(pit), ez + Math.cos(yaw) * Math.cos(pit)];
}

// — rigs: each returns {pos:[3], target:[3], fov} —
function orbit(yaw, pitch, dist, zoom) {
  const d = dist / Math.max(0.2, zoom);
  const pos = orbitalEye(0, 1, 0, yaw, pitch, d);
  return { pos, target: [0, 1, 0], fov: 55 };
}
function follow(heading, distance, height) {
  const h = heading * DEG, fx = Math.sin(h), fz = Math.cos(h);
  return { pos: [-fx * distance, height, -fz * distance], target: [0, 1.1, 0], fov: 55 };
}
function topDown(height, tilt, heading) {
  const h = heading * DEG, t = Math.max(1.5, tilt) * DEG, horiz = height * Math.tan(t);
  return { pos: [-Math.sin(h) * horiz, height, -Math.cos(h) * horiz], target: [0, 0, 0], fov: 50 };
}
function isometric(yaw, dist) {
  return { pos: orbitalEye(0, 0, 0, yaw, 35.264, dist), target: [0, 0, 0], fov: 30 };
}
function firstPerson(facing, pitch) {
  const eye = [0, 1.7, 5.5];
  return { pos: eye, target: lookForward(eye[0], eye[1], eye[2], facing, pitch), fov: 72 };
}
function freeFly(px, py, pz, yaw, pitch) {
  return { pos: [px, py, pz], target: lookForward(px, py, pz, yaw, pitch), fov: 62 };
}

// cinematic: shot library + director (inline of rigs/cinematic.ts)
const SHOTS = [
  [9, 1.5, 5.5, 1.0, 42, 0], [3.2, 0.6, 0.5, 1.7, 52, 0], [1.7, 0.3, 1.72, 1.78, 32, 0],
  [-2.2, 0.8, 1.85, 1.2, 58, 4], [0.2, 5.0, 1.3, 1.1, 46, 0], [4.0, -1.0, 6.5, 0.8, 44, 0],
  [2.6, 1.4, 0.7, 1.0, 50, 0], [2.0, -0.4, 0.14, 1.5, 62, 0],
];
function pickIndex(n, len, seed) {
  if (len <= 1) return 0;
  const hash = (m) => ((m * 1103515245 + 12345 + seed) >>> 0) % len;
  let i = hash(n);
  if (i === hash(n - 1)) i = (i + 1) % len;
  return i;
}
function cinematic(facing, t) {
  const f = facing * DEG, fwd = [Math.sin(f), 0, Math.cos(f)], right = [Math.cos(f), 0, -Math.sin(f)];
  const dwell = 2.6, n = Math.floor(t / dwell), idx = pickIndex(n, SHOTS.length, 7);
  const s = SHOTS[idx], a = s[0], b = s[1], c = s[2], lookY = s[3], fov = s[4], lead = s[5];
  const pos = [fwd[0] * a + right[0] * b, c, fwd[2] * a + right[2] * b];
  const target = [fwd[0] * lead, lookY, fwd[2] * lead];
  const local = t / dwell - n, frac = local * 0.05;
  pos[0] += (target[0] - pos[0]) * frac; pos[1] += (target[1] - pos[1]) * frac; pos[2] += (target[2] - pos[2]) * frac;
  return { pos, target, fov: fov * (1 - frac * 0.25) };
}

const now = (globalThis.performance && globalThis.performance.now)
  ? () => globalThis.performance.now()
  : () => Number(Date.now());

const N = 5_000_000;

function bench(name, fn) {
  // warmup
  let warm = 0;
  for (let i = 0; i < 200_000; i++) { const s = fn(i); warm += s.pos[0] + s.fov; }
  // timed
  let sum = 0;
  const t0 = now();
  for (let i = 0; i < N; i++) {
    const s = fn(i);
    sum += s.pos[0] + s.pos[1] + s.pos[2] + s.target[0] + s.target[1] + s.target[2] + s.fov;
  }
  const t1 = now();
  const ms = t1 - t0;
  const nsPer = (ms * 1e6) / N;
  // print checksum so DCE can't remove the loop
  print(`${name.padEnd(13)} ${nsPer.toFixed(2).padStart(7)} ns/solve  ${(N / (ms / 1000) / 1e6).toFixed(1).padStart(7)} M/s   (checksum ${(warm + sum).toFixed(1)})`);
  return nsPer;
}

const log = (typeof print === 'function') ? print : console.log;
function P(s) { log(s); }
// allow `print(...)` calls above whether or not v8cli provides it
if (typeof print !== 'function') { globalThis.print = console.log; }

P('camera rig solve — V8');
P(`iterations: ${N.toLocaleString ? N.toLocaleString() : N} per rig, input varied each iteration`);
P('');
bench('orbit', (i) => orbit(i * 0.013, 35 + (i % 80), 7, 1));
bench('follow', (i) => follow(i * 0.05, 6, 3));
bench('topDown', (i) => topDown(13, 12, i * 0.05));
bench('isometric', (i) => isometric(i * 0.013, 17));
bench('firstPerson', (i) => firstPerson(i * 0.05, ((i % 160) - 80)));
bench('freeFly', (i) => freeFly(i * 0.001, 5, 16, i * 0.05, -10));
bench('cinematic', (i) => cinematic(0, i * 0.0005));
P('');
P('Note: a real frame runs ONE solve. ns/solve ÷ 16,666,000 ns (a 60fps frame budget) = share of frame.');
