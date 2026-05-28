// @reactjit/cameras — modifiers: composable Solved -> Solved decorators.
//
// The swayCam analog (lifted from cart/scape3d). A rig produces a clean Solved;
// modifiers perturb it, and they stack in order via <CameraRig modifiers={[...]}>.
// They are PURE: time is passed in (so the same t always yields the same result
// and the cart owns the clock), never read from a global.
//
// Smoothing/lerp is deliberately NOT here — it needs the previous frame's value,
// which is state, not a pure transform. Use the `useSmoothed` hook instead.

import type { Modifier, Vec3 } from './types';

// Woozy orbital drift around the look point — a manic shimmer, not nausea.
// intensity 0 is the identity. `t` is seconds (or any monotonic clock).
export function sway(intensity: number, t: number): Modifier {
  return (s) => {
    if (intensity <= 0.01) return s;
    const [tx, ty, tz] = s.target;
    const ox = s.pos[0] - tx;
    const oy = s.pos[1] - ty;
    const oz = s.pos[2] - tz;
    const dyaw = Math.sin(t * 1.3) * 0.035 * intensity;
    const c = Math.cos(dyaw);
    const sn = Math.sin(dyaw);
    const rx = ox * c + oz * sn;
    const rz = -ox * sn + oz * c;
    const zoomw = 1 + Math.sin(t * 2.1) * 0.04 * intensity;
    const ply = 1 + Math.sin(t * 0.9 + 1.7) * 0.03 * intensity;
    const pos: Vec3 = [tx + rx * zoomw, ty + oy * ply * zoomw, tz + rz * zoomw];
    return { pos, target: s.target, fov: s.fov };
  };
}

// Deterministic positional shake (explosions, impacts). `amount` is world units.
export function shake(amount: number, t: number): Modifier {
  return (s) => {
    if (amount <= 0) return s;
    const dx = Math.sin(t * 53.0) * amount;
    const dy = Math.sin(t * 61.0 + 1.3) * amount;
    const dz = Math.sin(t * 47.0 + 2.1) * amount;
    const pos: Vec3 = [s.pos[0] + dx, s.pos[1] + dy, s.pos[2] + dz];
    return { pos, target: s.target, fov: s.fov };
  };
}
