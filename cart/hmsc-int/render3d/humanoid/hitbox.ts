// Locational hit detection for a humanoid rig. The player's aim ray is tested
// against the rig's zone capsules (built in skeleton.ts from the same joints the
// mesh is drawn from); the nearest capsule the ray pierces is the hit, and its
// zone picks the damage multiplier. This is the ONLY geometric hit path in HMSC:
// player ray -> NPC. NPC->player and NPC->NPC damage stay on the probability roll
// (systems/chance), never a raycast — see the damage design note in PlayerFigure
// history and the perception split.

import type { DamageZone, HitCapsule, HumanoidRig, Vec3Tuple } from './skeleton';

// How much a shot is scaled by where it lands. Head is a near-kill, torso is the
// baseline, limbs bleed but don't drop. Tune these, not the capsule geometry.
export const ZONE_DAMAGE: Record<DamageZone, number> = {
  head: 2.5,
  torso: 1.0,
  armL: 0.55,
  armR: 0.55,
  legL: 0.7,
  legR: 0.7,
};

export type HumanoidHit = {
  zone: DamageZone;
  // Distance along the ray to the closest-approach point (ray units; if `dir` is
  // a unit vector this is meters). Used to pick the nearest target among many.
  distance: number;
  // World point of closest approach on the ray.
  point: Vec3Tuple;
  damageMultiplier: number;
};

function clampLow(value: number, low: number): number {
  return value < low ? low : value;
}

// Closest distance (squared) between a forward ray (origin + s*dir, s>=0) and a
// segment a->b, returning the ray parameter `s` at closest approach. `dir` is
// assumed unit length. Adapted from the standard segment-segment closest-point
// solution with the ray's near end clamped at the origin and its far end open.
function rayCapsuleHit(origin: Vec3Tuple, dir: Vec3Tuple, cap: HitCapsule): number | null {
  const d2: Vec3Tuple = [cap.b[0] - cap.a[0], cap.b[1] - cap.a[1], cap.b[2] - cap.a[2]];
  const r: Vec3Tuple = [origin[0] - cap.a[0], origin[1] - cap.a[1], origin[2] - cap.a[2]];
  const e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  const c = dir[0] * r[0] + dir[1] * r[1] + dir[2] * r[2];
  const b = dir[0] * d2[0] + dir[1] * d2[1] + dir[2] * d2[2];

  // Degenerate segment (a == b): treat as a sphere at a.
  if (e <= 1e-9) {
    const s = clampLow(-c, 0);
    return withinRadius(origin, dir, s, cap, cap.a) ? s : null;
  }

  const denom = e - b * b; // dot(dir,dir)=1, so aa*e - b^2 = e - b^2
  let s = denom > 1e-9 ? clampLow((b * f - c * e) / denom, 0) : 0;
  let t = (b * s + f) / e;

  if (t < 0) {
    t = 0;
    s = clampLow(-c, 0);
  } else if (t > 1) {
    t = 1;
    s = clampLow(b - c, 0);
  }

  const segPoint: Vec3Tuple = [cap.a[0] + d2[0] * t, cap.a[1] + d2[1] * t, cap.a[2] + d2[2] * t];
  return withinRadius(origin, dir, s, cap, segPoint) ? s : null;
}

function withinRadius(origin: Vec3Tuple, dir: Vec3Tuple, s: number, cap: HitCapsule, segPoint: Vec3Tuple): boolean {
  const px = origin[0] + dir[0] * s - segPoint[0];
  const py = origin[1] + dir[1] * s - segPoint[1];
  const pz = origin[2] + dir[2] * s - segPoint[2];
  return px * px + py * py + pz * pz <= cap.radius * cap.radius;
}

// Test an aim ray against one humanoid. Returns the nearest zone the ray pierces,
// or null on a clean miss. `dir` should be a unit vector for `distance` to read
// in meters.
export function raycastHumanoid(rig: HumanoidRig, origin: Vec3Tuple, dir: Vec3Tuple): HumanoidHit | null {
  let best: HumanoidHit | null = null;
  for (const cap of rig.zones) {
    const s = rayCapsuleHit(origin, dir, cap);
    if (s === null) continue;
    if (best === null || s < best.distance) {
      best = {
        zone: cap.zone,
        distance: s,
        point: [origin[0] + dir[0] * s, origin[1] + dir[1] * s, origin[2] + dir[2] * s],
        damageMultiplier: ZONE_DAMAGE[cap.zone],
      };
    }
  }
  return best;
}

// Pick the nearest hit humanoid out of many. Each entry pairs an id with its
// solved rig; the winner is the closest pierced zone across all of them. This is
// what the player's fire command calls: one ray, the front-most NPC takes it.
export function raycastHumanoids(
  rigs: Array<{ id: string; rig: HumanoidRig }>,
  origin: Vec3Tuple,
  dir: Vec3Tuple,
): { id: string; hit: HumanoidHit } | null {
  let winner: { id: string; hit: HumanoidHit } | null = null;
  for (const entry of rigs) {
    const hit = raycastHumanoid(entry.rig, origin, dir);
    if (hit === null) continue;
    if (winner === null || hit.distance < winner.hit.distance) {
      winner = { id: entry.id, hit };
    }
  }
  return winner;
}
