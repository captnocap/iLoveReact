// editor/home/confetti.ts — the celebration burst (req_4435).
//
// One <Effect> quad. Confetti is a scalar field over the quad — per-particle
// rotated squares, ballistic, fading — which is exactly the fill case the house
// rule reserves for a fragment shader (multi-segment STROKES are the case that
// belongs to Graph.Polyline; there are none here).
//
// WGSL gotchas this file obeys: no unary plus, and no backticks inside the
// template literal's comments.
//
// data layout (flat f32):
//   [0] progress   0..1 through the burst; outside that range nothing draws
//   [1] count      how many particles (bounded by PARTICLE_LIMIT)
//   [2] seed       varies the pattern between bursts
//
// The quad's aspect comes from U.size_w/U.size_h in the injected header, not
// from JS: a guessed aspect stretches every square into a smear the moment the
// window is a different shape than the guess.

/** Loop bound in the shader. WGSL wants a constant trip count, so the uniform
 *  count only ever reduces it. */
export const PARTICLE_LIMIT = 96;

/** How long one burst lasts, in ms. Long enough to read as a celebration,
 *  short enough that it never becomes chrome you have to wait out. */
export const BURST_MS = 1700;

/** Animation tick. The runtime has no requestAnimationFrame — setTimeout at
 *  ~60fps is the house pattern. */
export const BURST_TICK_MS = 16;

export const CONFETTI_SHADER = `
fn h11(p: f32) -> f32 {
  var x = fract(p * 0.1031);
  x = x * (x + 33.33);
  x = x * (x + x);
  return fract(x);
}

// Cheap categorical palette: warm, cool, mint, magenta, gold, sky.
fn confetti_color(s: f32) -> vec3f {
  let i = floor(s * 6.0);
  if (i < 1.0) { return vec3f(0.98, 0.44, 0.36); }
  if (i < 2.0) { return vec3f(0.36, 0.72, 0.98); }
  if (i < 3.0) { return vec3f(0.40, 0.88, 0.66); }
  if (i < 4.0) { return vec3f(0.92, 0.46, 0.82); }
  if (i < 5.0) { return vec3f(0.98, 0.80, 0.30); }
  return vec3f(0.66, 0.62, 0.99);
}

@group(0) @binding(1) var<storage, read> ys: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let t = ys[0];
  if (t <= 0.0 || t >= 1.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let n = i32(ys[1]);
  let aspect = max(U.size_w, 1.0) / max(U.size_h, 1.0);
  let seed = ys[2];

  // Work in a square-corrected space so a particle reads as a square, not a
  // letterbox-stretched smear on a wide masthead.
  let p = vec2f(in.uv.x * aspect, in.uv.y);

  var rgb = vec3f(0.0);
  var alpha = 0.0;

  for (var i = 0; i < ${PARTICLE_LIMIT}; i = i + 1) {
    if (i >= n) { break; }
    let fi = f32(i) + seed * 17.0;
    let launch_x = h11(fi * 1.7);
    let speed_up = h11(fi * 3.1 + 11.0);
    let drift = h11(fi * 5.3 + 23.0);
    let spin = h11(fi * 9.1 + 41.0);
    let tint = h11(fi * 7.9 + 37.0);
    let scale = 0.006 + h11(fi * 13.7 + 5.0) * 0.009;

    // Ballistic: thrown up and outward from a band across the middle, then
    // gravity takes it. Everything is in 0..1 quad space before aspect.
    let x0 = launch_x;
    let vx = (drift - 0.5) * 0.75;
    let vy = -(0.75 + speed_up * 0.85);
    let cx = (x0 + vx * t) * aspect;
    let cy = 0.62 + vy * t + 1.55 * t * t;

    // Rotated square: distance in the particle's own frame.
    let ang = spin * 6.2831853 + t * (4.0 + spin * 9.0);
    let ca = cos(ang);
    let sa = sin(ang);
    let d = p - vec2f(cx, cy);
    let local = vec2f(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
    // Flat, tumbling chips: one axis squashes as the piece turns edge-on.
    let half = vec2f(scale, scale * (0.35 + 0.65 * abs(cos(ang * 1.3))));
    let q = abs(local) - half;
    let sd = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
    let edge = fwidth(sd) + 0.0005;
    let cover = 1.0 - smoothstep(-edge, edge, sd);
    if (cover <= 0.0) { continue; }

    // Fade out over the back half so the burst ends rather than stops.
    let life = 1.0 - smoothstep(0.55, 1.0, t);
    let a = cover * life;
    rgb = mix(rgb, confetti_color(tint), a);
    alpha = max(alpha, a);
  }

  return vec4f(rgb, alpha);
}
`;

/** The uniform buffer the surface uploads each tick. */
export function confettiData(progress: number, count: number, seed: number): number[] {
  return [
    Math.min(Math.max(progress, 0), 1),
    Math.min(Math.max(Math.round(count), 0), PARTICLE_LIMIT),
    seed,
  ];
}

/** Particle count for a celebration intensity (0..1). */
export function particlesFor(intensity: number): number {
  const clamped = Math.min(Math.max(intensity, 0), 1);
  return Math.round(18 + clamped * (PARTICLE_LIMIT - 18));
}
