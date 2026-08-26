// The Fart Racer circuit — one authored closed loop and the queries every other
// part of the world derives from it.
//
// The track is the world's spine. Terrain flattens along it, the city faces it,
// trees keep clear of it, and the checkpoint sampler walks the SAME committed
// centerline natively. Nothing here re-approximates the native road geometry;
// this module owns the AUTHORED input, and the native path sampler owns the
// committed result.

export type TrackPoint = Readonly<{ x: number; z: number; elevationM: number }>;

/** Gastown Circuit. A 300 m downtown straight with a crest partway down it, a
 *  climb onto the elevated eastern back straight, a fast descending sweep
 *  through the north woods, and a dipped western run back to the line.
 *  Elevations are metres and ARE the terrain: `terrainHeightAt` reproduces them
 *  exactly inside the road corridor, so a checkpoint sampled at a point's
 *  elevation sits on the surface the car drives. */
export const TRACK_POINTS: readonly TrackPoint[] = Object.freeze([
  Object.freeze({ x: 70, z: 90, elevationM: 0 }),     // start / finish line
  Object.freeze({ x: 200, z: 90, elevationM: 2.5 }),  // main-straight crest
  Object.freeze({ x: 310, z: 90, elevationM: 0 }),
  Object.freeze({ x: 385, z: 96, elevationM: 1 }),
  Object.freeze({ x: 432, z: 152, elevationM: 4.5 }), // turn 1, climbing
  Object.freeze({ x: 434, z: 248, elevationM: 11 }),  // elevated back straight
  Object.freeze({ x: 392, z: 328, elevationM: 8 }),
  Object.freeze({ x: 302, z: 392, elevationM: 3.5 }), // fast left through the woods
  Object.freeze({ x: 186, z: 402, elevationM: 1 }),
  Object.freeze({ x: 102, z: 356, elevationM: -1.5 }),// dipped hairpin exit
  Object.freeze({ x: 66, z: 262, elevationM: 0 }),
  Object.freeze({ x: 66, z: 160, elevationM: 0 }),
  Object.freeze({ x: 70, z: 90, elevationM: 0 }),     // closes the loop
]);

export const TRACK_PROFILE = Object.freeze({
  id: 1,
  lanesForward: 2,
  lanesBackward: 2,
  sidewalks: true,
  tracks: 0,
  curveRadiusM: 24,
  speedLimitKph: 140,
});

type Segment = Readonly<{
  ax: number; az: number; ay: number;
  dx: number; dz: number; dy: number;
  lengthSquared: number;
}>;

function buildSegments(points: readonly TrackPoint[]): readonly Segment[] {
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared <= 0) continue;
    segments.push({ ax: a.x, az: a.z, ay: a.elevationM, dx, dz, dy: b.elevationM - a.elevationM, lengthSquared });
  }
  if (!segments.length) throw new Error('the Fart Racer track has no measurable segment');
  return segments;
}

const SEGMENTS = buildSegments(TRACK_POINTS);

export type TrackProximity = Readonly<{ distanceM: number; elevationM: number }>;

/** Distance from (x, z) to the authored centerline, and the centerline's
 *  elevation at the nearest point. One allocation-free pass — this runs roughly
 *  a million times while a world is generated. */
export function trackProximity(x: number, z: number): TrackProximity {
  let bestSquared = Infinity;
  let bestElevation = 0;
  for (const segment of SEGMENTS) {
    const px = x - segment.ax;
    const pz = z - segment.az;
    let t = (px * segment.dx + pz * segment.dz) / segment.lengthSquared;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ox = px - segment.dx * t;
    const oz = pz - segment.dz * t;
    const squared = ox * ox + oz * oz;
    if (squared < bestSquared) {
      bestSquared = squared;
      bestElevation = segment.ay + segment.dy * t;
    }
  }
  return { distanceM: Math.sqrt(bestSquared), elevationM: bestElevation };
}

/** Total authored lap length in metres (the native sampler measures the
 *  committed curve, which rounds corners and comes out slightly shorter). */
export function authoredLapLengthM(): number {
  let total = 0;
  for (const segment of SEGMENTS) total += Math.sqrt(segment.lengthSquared);
  return total;
}
