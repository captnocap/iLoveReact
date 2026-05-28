// Humanoid — an authored single-mesh low-poly character body.
//
// The N64/PS1-era register: Mario 64, Banjo-Kazooie, Crash Bandicoot. One
// continuous mesh, no internal surfaces — the body flows from foot to crown as
// one shape. Compare against the parts-based figure (box torso + sphere head +
// cylinder limbs) in cart/camera_lab to see how the seams disappear and the
// silhouette reads as a body instead of a stack of solids.
//
// Construction: sweeps of ring cross-sections welded into a trunk (legs+torso+
// head as one column is impossible because legs branch — so the TRUNK runs hip→
// crown, and four LIMBS sweep down from the hip/shoulder rings, each limb's
// first ring sitting inside the trunk surface so the join hides naturally).
// Quads between adjacent rings are flat-shaded (one face normal per quad — the
// faceted register), caps are triangle fans. ~350 triangles for the default
// proportions — well under the N64 character budget.
//
// One generator, one material color. Multi-tone (skin/shirt/pants) would need
// vertex colors or a texture — a v2 concern; v1 nails the SHAPE story.

import { mesh, type GeometryData, type Vec2, type Vec3 } from './_util';

export type HumanoidParams = {
  /** total height from foot-bottom to crown. */
  height: number;
  /** width across shoulders. */
  shoulderWidth: number;
  /** width across hips. */
  hipWidth: number;
  /** head bulge — front-to-back size of the head ring. */
  headSize: number;
  /** how chunky limbs are. 1 = default, >1 thicker. */
  limbThickness: number;
  /** ring polygon sides. 6 = PS1 chunky, 8 = N64, 12+ = smoother. */
  sides: number;
  /**
   * Shading model: false = flat (one normal per quad, hard creases between
   * facets — PS1 gem look), true = smooth/Gouraud (per-vertex averaged normals,
   * lighting interpolates across facets so the surface reads round at low poly
   * count — the N64 head register). Same vertex count either way.
   */
  smoothShading: boolean;
};

export const HUMANOID_DEFAULTS: HumanoidParams = {
  height: 2.0,
  shoulderWidth: 0.72,
  hipWidth: 0.46,
  headSize: 0.34,
  limbThickness: 1.0,
  sides: 8,
  smoothShading: true,
};

// ── a single ring cross-section ──────────────────────────────────────────────
// Each ring lies in a plane parallel to XZ at height y, centered at (cx,y,cz),
// with elliptical radii (rx,rz). `twist` rotates the ring around its center.
type Ring = { y: number; cx: number; cz: number; rx: number; rz: number; twist?: number };

function ringVerts(r: Ring, sides: number): Vec3[] {
  const out: Vec3[] = [];
  const t = r.twist ?? 0;
  for (let i = 0; i < sides; i++) {
    const a = t + (i / sides) * Math.PI * 2;
    const x = r.cx + Math.cos(a) * r.rx;
    const z = r.cz + Math.sin(a) * r.rz;
    out.push([x, r.y, z]);
  }
  return out;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function normalize3(v: Vec3): Vec3 {
  const L = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
}

// ── stitch a sweep of rings together with quads ──────────────────────────────
// rings[i] connects to rings[i+1] side-by-side; the same `sides` count for all.
// Two shading modes:
//   smooth=false → one face normal per quad (hard creases between facets, PS1)
//   smooth=true  → per-vertex normals averaged from the 4 adjacent quad faces,
//                  so the GPU interpolates lighting across facets (N64 Gouraud).
//                  Same vertex count; only the normals differ.
function emitSweep(g: ReturnType<typeof mesh>, rings: Ring[], sides: number, smooth: boolean): void {
  const ringPts = rings.map((r) => ringVerts(r, sides));
  const numRings = ringPts.length;
  // ringVerts winds CCW around +Y. cross((p1-p0),(p3-p0)) at a +X-face quad gives
  // an outward normal ONLY when b is below a (e2 = p3-p0 points -Y, e.g. limbs:
  // shoulder→hand, hip→foot). When b is above a (trunk: hip→crown, ascending y),
  // e2 points +Y and the same cross flips inward — exactly what made the trunk
  // hollow before. Detect direction once per sweep and pick the winding + cross
  // order that puts the outward face on the camera side either way.
  const descending = rings.length >= 2 && rings[1].y <= rings[0].y;

  // 1) face normals — one per quad (i, s) between ring i and ring i+1, side s.
  const faceN: Vec3[][] = [];
  for (let i = 0; i < numRings - 1; i++) {
    const a = ringPts[i];
    const b = ringPts[i + 1];
    const row: Vec3[] = [];
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const p0 = a[s];
      const p1 = a[s2];
      const p3 = b[s];
      const e1 = sub(p1, p0);
      const e2 = sub(p3, p0);
      const n = normalize3(descending ? cross(e1, e2) : cross(e2, e1));
      row.push(n);
    }
    faceN.push(row);
  }

  // 2) per-vertex normals (smooth only). vertN[i][s] = normalize(sum of up to 4
  //    surrounding face normals: below-left, below-right, above-left, above-right).
  //    At the top/bottom ring fewer faces touch — clamp those out.
  let vertN: Vec3[][] | null = null;
  if (smooth) {
    vertN = [];
    for (let i = 0; i < numRings; i++) {
      const row: Vec3[] = [];
      for (let s = 0; s < sides; s++) {
        const sPrev = (s + sides - 1) % sides;
        let nx = 0, ny = 0, nz = 0;
        const acc = (qi: number, qs: number) => {
          if (qi < 0 || qi >= faceN.length) return;
          const n = faceN[qi][qs];
          nx += n[0]; ny += n[1]; nz += n[2];
        };
        acc(i - 1, sPrev); acc(i - 1, s);
        acc(i, sPrev);     acc(i, s);
        const L = Math.hypot(nx, ny, nz);
        row.push(L > 1e-6 ? [nx / L, ny / L, nz / L] as Vec3 : [0, 1, 0]);
      }
      vertN.push(row);
    }
  }

  // 3) emit triangles. Winding mirrors the original logic exactly; only the
  //    normals fed to each corner differ between flat and smooth.
  for (let i = 0; i < numRings - 1; i++) {
    const a = ringPts[i];
    const b = ringPts[i + 1];
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const p0 = a[s];
      const p1 = a[s2];
      const p2 = b[s2];
      const p3 = b[s];
      const fn = faceN[i][s];
      const n0 = vertN ? vertN[i][s]      : fn;
      const n1 = vertN ? vertN[i][s2]     : fn;
      const n2 = vertN ? vertN[i + 1][s2] : fn;
      const n3 = vertN ? vertN[i + 1][s]  : fn;
      if (descending) {
        g.tri(p0, n0, [0, 0] as Vec2, p1, n1, [1, 0] as Vec2, p2, n2, [1, 1] as Vec2);
        g.tri(p0, n0, [0, 0] as Vec2, p2, n2, [1, 1] as Vec2, p3, n3, [0, 1] as Vec2);
      } else {
        g.tri(p0, n0, [0, 0] as Vec2, p3, n3, [0, 1] as Vec2, p2, n2, [1, 1] as Vec2);
        g.tri(p0, n0, [0, 0] as Vec2, p2, n2, [1, 1] as Vec2, p1, n1, [1, 0] as Vec2);
      }
    }
  }
}

// ── cap a ring with a triangle fan from its center, normal +Y or -Y ──────────
function emitCap(g: ReturnType<typeof mesh>, ring: Ring, sides: number, up: boolean): void {
  const pts = ringVerts(ring, sides);
  const center: Vec3 = [ring.cx, ring.y, ring.cz];
  const n: Vec3 = up ? [0, 1, 0] : [0, -1, 0];
  for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides;
    // ringVerts winds CCW around +Y, so cross(pts[s]−c, pts[s2]−c) points −Y.
    // For the TOP cap (n=+Y, e.g. crown of head) we need cross to give +Y, which
    // means winding (center, pts[s2], pts[s]). For the BOTTOM cap (n=−Y, e.g.
    // sole of foot) we want cross −Y, i.e. (center, pts[s], pts[s2]). The two
    // branches' windings were previously swapped relative to the up flag, which
    // made the crown render only from below and the sole only from above — both
    // invisible from the normal viewing angle, contributing to the hollow read.
    if (up) {
      g.tri(center, n, [0.5, 0.5] as Vec2, pts[s2], n, [1, 0] as Vec2, pts[s], n, [0, 0] as Vec2);
    } else {
      g.tri(center, n, [0.5, 0.5] as Vec2, pts[s], n, [0, 0] as Vec2, pts[s2], n, [1, 0] as Vec2);
    }
  }
}

export function generate(p: HumanoidParams): GeometryData {
  const g = mesh();
  const sides = Math.max(4, p.sides | 0);
  const t = p.limbThickness;

  // proportions — heights expressed as fractions of total `height` so the
  // figure scales coherently when you grow it. ~Mario / Crash silhouette.
  const H = p.height;
  const hipY = H * 0.46;
  const waistY = H * 0.54;
  const chestY = H * 0.66;
  const shoulderY = H * 0.74;
  const neckY = H * 0.78;
  const chinY = H * 0.83;
  const faceY = H * 0.92;
  const crownY = H * 1.0;

  const shoulderHalf = p.shoulderWidth * 0.5;
  const hipHalf = p.hipWidth * 0.5;

  // ── trunk: hip → crown ──────────────────────────────────────────────────
  const trunkRings: Ring[] = [
    { y: hipY,      cx: 0, cz: 0,    rx: hipHalf * 1.08, rz: hipHalf * 0.85 }, // hip
    { y: waistY,    cx: 0, cz: 0,    rx: hipHalf * 0.95, rz: hipHalf * 0.78 }, // waist
    { y: chestY,    cx: 0, cz: 0,    rx: shoulderHalf * 0.88, rz: shoulderHalf * 0.62 }, // chest
    { y: shoulderY, cx: 0, cz: 0,    rx: shoulderHalf, rz: shoulderHalf * 0.62 }, // shoulder
    { y: neckY,     cx: 0, cz: 0,    rx: H * 0.07, rz: H * 0.06 }, // neck (narrow)
    { y: chinY,     cx: 0, cz: 0.01, rx: p.headSize * 0.72, rz: p.headSize * 0.78 }, // jaw
    { y: faceY,     cx: 0, cz: 0.01, rx: p.headSize * 1.0,  rz: p.headSize * 1.0  }, // face/head widest
    { y: crownY,    cx: 0, cz: 0,    rx: p.headSize * 0.62, rz: p.headSize * 0.62 }, // crown
  ];
  emitSweep(g, trunkRings, sides, p.smoothShading);
  emitCap(g, trunkRings[trunkRings.length - 1], sides, true); // top of head

  // ── legs: hip → foot. First ring sits inside the trunk hip so the join hides
  const legRings = (sx: number): Ring[] => [
    { y: hipY + 0.04,            cx: sx, cz: 0,    rx: H * 0.085 * t, rz: H * 0.085 * t }, // root inside trunk
    { y: hipY - H * 0.05,        cx: sx, cz: 0,    rx: H * 0.085 * t, rz: H * 0.085 * t }, // upper thigh
    { y: hipY - H * 0.18,        cx: sx, cz: 0,    rx: H * 0.075 * t, rz: H * 0.075 * t }, // knee
    { y: hipY - H * 0.34,        cx: sx, cz: 0.01, rx: H * 0.07 * t,  rz: H * 0.07 * t  }, // ankle
    { y: hipY - H * 0.40,        cx: sx, cz: 0.06, rx: H * 0.085 * t, rz: H * 0.13 * t  }, // foot (forward-stretched)
  ];
  const legXOffset = hipHalf * 0.55;
  for (const sx of [-legXOffset, legXOffset]) {
    const rings = legRings(sx);
    emitSweep(g, rings, sides, p.smoothShading);
    emitCap(g, rings[rings.length - 1], sides, false); // sole of foot
  }

  // ── arms: shoulder → hand. First ring inside the trunk shoulder ──────────
  const armRings = (sx: number): Ring[] => [
    { y: shoulderY,              cx: sx * 0.55, cz: 0,    rx: H * 0.07 * t,  rz: H * 0.07 * t  }, // root inside trunk
    { y: shoulderY - H * 0.04,   cx: sx,        cz: 0,    rx: H * 0.07 * t,  rz: H * 0.07 * t  }, // shoulder bulge
    { y: shoulderY - H * 0.16,   cx: sx,        cz: 0,    rx: H * 0.06 * t,  rz: H * 0.06 * t  }, // bicep
    { y: shoulderY - H * 0.30,   cx: sx,        cz: 0,    rx: H * 0.055 * t, rz: H * 0.055 * t }, // wrist
    { y: shoulderY - H * 0.36,   cx: sx,        cz: 0.02, rx: H * 0.075 * t, rz: H * 0.075 * t }, // hand (mitt bulge)
  ];
  const armX = shoulderHalf * 1.02;
  for (const sx of [-armX, armX]) {
    const rings = armRings(sx);
    emitSweep(g, rings, sides, p.smoothShading);
    emitCap(g, rings[rings.length - 1], sides, false); // end of hand
  }

  return g.build();
}
