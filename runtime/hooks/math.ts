/**
 * math — framework/math.zig bridged to JS.
 *
 * Every `pub fn` in framework/math.zig is automatically callable here via a
 * single V8 host function (`__zig_call`, see framework/v8_bindings_zigcall.zig).
 * No per-function binding glue — adding a function to the Zig module makes it
 * reachable from JS on the next build.
 *
 * Usage:
 *   import { math } from '../../runtime/hooks';
 *   const v = math.v2(10, 5);
 *   const h = math.noise2d(x * 0.1, y * 0.1, 42);
 *
 * Tradeoff: every call crosses the V8→Zig bridge. Trivial ops (v2add, lerp,
 * clamp) are 100× faster inlined in JS for hot paths. The bridge shines for
 * non-trivial kernels: Perlin/fBm noise, Bezier curve sampling, smoothDamp.
 *
 * Types: Vec2 → `{x, y}`, Vec3 → `{x, y, z}`, BBox2 → `{x, y, w, h}`, etc.
 * The Zig side deserializes plain objects with those field names; no class
 * wrappers needed on the JS side.
 */

import { callHost, callHostJson, hasHost } from '../ffi';

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };
export type BBox2 = { x: number; y: number; w: number; h: number };
export type BBox3 = { x: number; y: number; z: number; w: number; h: number; d: number };
export type SmoothDampResult = { value: number; velocity: number };

// ── Proxy facade ─────────────────────────────────────────────────────────
// The Zig side has a reflection dispatcher, so we don't need to enumerate
// every function by name. A Proxy forwards property access into __zig_call.
// TypeScript augmentation below ('declare' block) gives each function a
// signature — the augmentation is purely compile-time; the Proxy handles
// runtime resolution.

function zigCall(module: string, fn: string, ...args: any[]): any {
  if (!hasHost('__zig_call')) return null;
  return callHost<any>('__zig_call', null, module, fn, ...args);
}

type MathSurface = {
  // Vec2
  v2(x: number, y: number): Vec2;
  v2zero(): Vec2;
  v2one(): Vec2;
  v2add(a: Vec2, b: Vec2): Vec2;
  v2sub(a: Vec2, b: Vec2): Vec2;
  v2mul(a: Vec2, b: Vec2): Vec2;
  v2div(a: Vec2, b: Vec2): Vec2;
  v2scale(v: Vec2, s: number): Vec2;
  v2negate(v: Vec2): Vec2;
  v2dot(a: Vec2, b: Vec2): number;
  v2cross(a: Vec2, b: Vec2): number;
  v2length(v: Vec2): number;
  v2lengthSq(v: Vec2): number;
  v2distance(a: Vec2, b: Vec2): number;
  v2distanceSq(a: Vec2, b: Vec2): number;
  v2normalize(v: Vec2): Vec2;
  v2abs(v: Vec2): Vec2;
  v2floor(v: Vec2): Vec2;
  v2ceil(v: Vec2): Vec2;
  v2round(v: Vec2): Vec2;
  v2min(a: Vec2, b: Vec2): Vec2;
  v2max(a: Vec2, b: Vec2): Vec2;
  v2clamp(v: Vec2, lo: Vec2, hi: Vec2): Vec2;
  v2lerp(a: Vec2, b: Vec2, t: number): Vec2;
  v2smoothstep(a: Vec2, b: Vec2, t: number): Vec2;
  v2angle(v: Vec2): number;
  v2fromAngle(radians: number): Vec2;
  v2rotate(v: Vec2, radians: number): Vec2;
  v2equals(a: Vec2, b: Vec2): boolean;
  v2almostEquals(a: Vec2, b: Vec2, eps: number): boolean;

  // Vec3
  v3(x: number, y: number, z: number): Vec3;
  v3zero(): Vec3;
  v3one(): Vec3;
  v3up(): Vec3;
  v3forward(): Vec3;
  v3right(): Vec3;
  v3add(a: Vec3, b: Vec3): Vec3;
  v3sub(a: Vec3, b: Vec3): Vec3;
  v3mul(a: Vec3, b: Vec3): Vec3;
  v3div(a: Vec3, b: Vec3): Vec3;
  v3scale(v: Vec3, s: number): Vec3;
  v3negate(v: Vec3): Vec3;
  v3dot(a: Vec3, b: Vec3): number;
  v3cross(a: Vec3, b: Vec3): Vec3;
  v3length(v: Vec3): number;
  v3lengthSq(v: Vec3): number;
  v3distance(a: Vec3, b: Vec3): number;
  v3distanceSq(a: Vec3, b: Vec3): number;
  v3normalize(v: Vec3): Vec3;
  v3abs(v: Vec3): Vec3;
  v3floor(v: Vec3): Vec3;
  v3ceil(v: Vec3): Vec3;
  v3round(v: Vec3): Vec3;
  v3min(a: Vec3, b: Vec3): Vec3;
  v3max(a: Vec3, b: Vec3): Vec3;
  v3clamp(v: Vec3, lo: Vec3, hi: Vec3): Vec3;
  v3lerp(a: Vec3, b: Vec3, t: number): Vec3;

  // Scalar helpers
  lerp(a: number, b: number, t: number): number;
  inverseLerp(a: number, b: number, value: number): number;
  smoothstep(edge0: number, edge1: number, x: number): number;
  smootherstep(edge0: number, edge1: number, x: number): number;
  remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number;
  clamp(value: number, lo: number, hi: number): number;
  wrap(value: number, lo: number, hi: number): number;
  damp(a: number, b: number, smoothing: number, dt: number): number;
  step(edge: number, x: number): number;
  pingPong(value: number, length: number): number;
  moveTowards(current: number, target: number, maxDelta: number): number;
  moveTowardsAngle(current: number, target: number, maxDelta: number): number;
  smoothDamp(current: number, target: number, velocity: number, smoothTime: number, dt: number, maxSpeed: number): SmoothDampResult;
  toRadians(degrees: number): number;
  toDegrees(radians: number): number;

  // Geometry
  distancePointToSegment(point: Vec2, a: Vec2, b: Vec2): number;
  distancePointToRect(point: Vec2, rect: BBox2): number;
  circleContainsPoint(center: Vec2, radius: number, point: Vec2): boolean;
  circleIntersectsRect(center: Vec2, radius: number, rect: BBox2): boolean;
  lineIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null;

  // Noise
  noise2d(x: number, y: number, seed: number): number;
  noise3d(x: number, y: number, z: number, seed: number): number;
  fbm2d(x: number, y: number, octaves: number, seed: number, lacunarity: number, persistence: number): number;
  fbm3d(x: number, y: number, z: number, octaves: number, seed: number, lacunarity: number, persistence: number): number;

  // Bezier
  bezierPoint(points: Vec2[], t: number): Vec2;
  cubicBezier(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2;
  cubicBezierDerivative(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2;
  quadraticBezier(p0: Vec2, p1: Vec2, p2: Vec2, t: number): Vec2;

  // Anything else that framework/math.zig exports — the Proxy still forwards it.
  [fnName: string]: (...args: any[]) => any;
};

export const math: MathSurface = new Proxy({} as MathSurface, {
  get(_target, fn: string) {
    return (...args: any[]) => zigCall('math', fn, ...args);
  },
}) as MathSurface;

/** Returns `{ moduleName: [fnName, ...] }` for every callable Zig fn. */
export function listZigCallable(): Record<string, string[]> {
  return callHostJson<Record<string, string[]>>('__zig_call_list', {});
}
