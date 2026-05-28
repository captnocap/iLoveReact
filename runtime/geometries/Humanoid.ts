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
  headSize: 0.24,
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
  // Start the ring at -π/2 so s=0 lands at -Z (the BACK of the figure). With
  // u walking 0→1 around the ring, that puts the texture seam down the back
  // and the face (+Z, front) at u = middle of the rect — the standard
  // character-UV-unwrap layout where a painter draws the face at the centre
  // of the head rectangle, not at its edge.
  for (let i = 0; i < sides; i++) {
    const a = -Math.PI / 2 + t + (i / sides) * Math.PI * 2;
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

// ── UV atlas: each body part owns a rectangle in texture space ─────────────
// A painter targets the atlas with known sub-rects (head in top-left of the
// image, arms top-right, torso bottom-left, legs bottom-right) and the
// generator's UVs put every face of that part inside its rect — no per-quad
// tiling. v=0 is the TOP of the image (matches the @reactjit/geometries
// face() helper convention).
export type UVRect = { u0: number; u1: number; v0: number; v1: number };

// Per-part rects oriented so a painter draws an UPRIGHT figure: the first
// ring of each sweep (the end nearest the trunk join) sits at the rect's
// "down" edge, the last ring at the rect's "up" edge. That means v1 < v0 for
// head and torso (their last ring is at the image-top edge of the rect),
// and v0 < v1 for arms and legs (their last ring is at the image-bottom edge
// — limbs hang downward both in world and on the image).
//
//   image:  ┌─────────┬─────────┐
//           │  HEAD   │  ARMS   │  ← v=0 = image top
//           │ crown↑  │ shldr↑  │
//           │ neck ↓  │  tip ↓  │
//           ├─────────┼─────────┤
//           │  TORSO  │  LEGS   │
//           │ neck ↑  │  hip ↑  │
//           │  hip ↓  │  toe ↓  │
//           └─────────┴─────────┘  ← v=1 = image bottom
export const HUMANOID_ATLAS: { head: UVRect; arms: UVRect; torso: UVRect; legs: UVRect } = {
  head:  { u0: 0.00, u1: 0.50, v0: 0.50, v1: 0.00 }, // top-left, flipped (crown→image top)
  arms:  { u0: 0.50, u1: 1.00, v0: 0.00, v1: 0.50 }, // top-right (shoulder→top, tip→middle)
  torso: { u0: 0.00, u1: 0.50, v0: 1.00, v1: 0.50 }, // bottom-left, flipped (hip→image bottom)
  legs:  { u0: 0.50, u1: 1.00, v0: 0.50, v1: 1.00 }, // bottom-right (hip→middle, toe→image bottom)
};

// ── stitch a sweep of rings together with quads ──────────────────────────────
// rings[i] connects to rings[i+1] side-by-side; the same `sides` count for all.
// Two shading modes:
//   smooth=false → one face normal per quad (hard creases between facets, PS1)
//   smooth=true  → per-vertex normals averaged from the 4 adjacent quad faces,
//                  so the GPU interpolates lighting across facets (N64 Gouraud).
//                  Same vertex count; only the normals differ.
//
// UVs: each ring i maps to v ∈ [rect.v0, rect.v1] linearly, each side s to u ∈
// [rect.u0, rect.u1] linearly. CRITICAL: positions wrap (s=sides-1's neighbour
// is s=0 — the cylinder closes) but UVs do NOT (s=sides-1's neighbour has u=
// rect.u1, not back to u0) — otherwise the texture mirrors at the seam.
function emitSweep(g: ReturnType<typeof mesh>, rings: Ring[], sides: number, smooth: boolean, rect: UVRect): void {
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
  //    normals and UVs fed to each corner differ.
  const uAt = (s: number) => rect.u0 + (s / sides) * (rect.u1 - rect.u0);
  const vAt = (i: number) => numRings > 1 ? rect.v0 + (i / (numRings - 1)) * (rect.v1 - rect.v0) : rect.v0;
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
      // UV: positions wrap at s=sides-1, UVs do NOT — use s+1 (not s2).
      const uv0: Vec2 = [uAt(s),     vAt(i)];
      const uv1: Vec2 = [uAt(s + 1), vAt(i)];
      const uv2: Vec2 = [uAt(s + 1), vAt(i + 1)];
      const uv3: Vec2 = [uAt(s),     vAt(i + 1)];
      if (descending) {
        g.tri(p0, n0, uv0, p1, n1, uv1, p2, n2, uv2);
        g.tri(p0, n0, uv0, p2, n2, uv2, p3, n3, uv3);
      } else {
        g.tri(p0, n0, uv0, p3, n3, uv3, p2, n2, uv2);
        g.tri(p0, n0, uv0, p2, n2, uv2, p1, n1, uv1);
      }
    }
  }
}

// ── cap a ring with a triangle fan from its center, normal +Y or -Y ──────────
// UVs: perimeter vertices match what the matching sweep would put at this ring
// (u walks rect.u0→rect.u1, v at boundary `vEdge`), and the cap center sits at
// the midpoint of u with v offset slightly INSIDE the rect so the fan has
// some area in the texture image instead of collapsing to a line at the edge.
function emitCap(
  g: ReturnType<typeof mesh>,
  ring: Ring,
  sides: number,
  up: boolean,
  rect: UVRect,
  vEdge: 'v0' | 'v1',
): void {
  const pts = ringVerts(ring, sides);
  const center: Vec3 = [ring.cx, ring.y, ring.cz];
  const n: Vec3 = up ? [0, 1, 0] : [0, -1, 0];
  const perimeterV = vEdge === 'v0' ? rect.v0 : rect.v1;
  // Inset the cap center toward the inside of the rect by 8% of the v range.
  const dv = (rect.v1 - rect.v0) * 0.08 * (vEdge === 'v0' ? 1 : -1);
  const centerUV: Vec2 = [(rect.u0 + rect.u1) * 0.5, perimeterV + dv];
  const uAt = (s: number) => rect.u0 + (s / sides) * (rect.u1 - rect.u0);
  for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides;
    // ringVerts winds CCW around +Y, so cross(pts[s]−c, pts[s2]−c) points −Y.
    // For the TOP cap (n=+Y) we need (center, pts[s2], pts[s]); for the BOTTOM
    // cap (n=−Y) we want (center, pts[s], pts[s2]).
    const uv_s: Vec2 = [uAt(s),     perimeterV];
    const uv_s2: Vec2 = [uAt(s + 1), perimeterV]; // s+1 (not wrapped) for the UV neighbour
    if (up) {
      g.tri(center, n, centerUV, pts[s2], n, uv_s2, pts[s], n, uv_s);
    } else {
      g.tri(center, n, centerUV, pts[s], n, uv_s, pts[s2], n, uv_s2);
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

  // ── trunk split into two sweeps so the texture atlas can put shirt on the
  //    body and skin on the head. The neck ring lives in BOTH sweeps: same
  //    vertex positions, different UVs (top edge of TORSO rect = bottom edge
  //    of HEAD rect), so the painter gets a clean collar boundary while the
  //    geometry stays continuous.
  const neckRing: Ring = { y: neckY, cx: 0, cz: 0, rx: H * 0.07, rz: H * 0.06 };
  // Trunk taper: hip → waist → shoulder, no chest ring between. The chest
  // ring used to swell wider than the waist (radius 0.30 vs 0.22 → 36% bust
  // bulge), giving the figure an hourglass / inflatable-doll silhouette.
  // Removing it lets the torso linearly widen from waist to shoulder — t-shirt
  // shape, no swell — and the shoulder remains the wide point.
  const bodyRings: Ring[] = [
    { y: hipY,      cx: 0, cz: 0, rx: hipHalf * 1.08, rz: hipHalf * 0.85 }, // hip
    { y: waistY,    cx: 0, cz: 0, rx: hipHalf * 1.02, rz: hipHalf * 0.82 }, // waist (no narrowing — straight column)
    { y: shoulderY, cx: 0, cz: 0, rx: shoulderHalf,   rz: shoulderHalf * 0.62 }, // shoulder
    neckRing,
  ];
  const headRings: Ring[] = [
    neckRing,
    { y: chinY,    cx: 0, cz: 0.01, rx: p.headSize * 0.72, rz: p.headSize * 0.78 }, // jaw
    { y: faceY,    cx: 0, cz: 0.01, rx: p.headSize * 1.00, rz: p.headSize * 1.00 }, // face (widest)
    { y: H * 0.96, cx: 0, cz: 0,    rx: p.headSize * 0.70, rz: p.headSize * 0.70 }, // upper-skull dome
    { y: crownY,   cx: 0, cz: 0,    rx: p.headSize * 0.22, rz: p.headSize * 0.22 }, // crown (near-point)
  ];
  emitSweep(g, bodyRings, sides, p.smoothShading, HUMANOID_ATLAS.torso);
  emitSweep(g, headRings, sides, p.smoothShading, HUMANOID_ATLAS.head);
  emitCap(g, headRings[headRings.length - 1], sides, true, HUMANOID_ATLAS.head, 'v0'); // top of head (v=v0 is image top)

  // ── legs: hip → foot. Foot stretches FORWARD only (no X-widen so it doesn't
  //    bell out sideways like a trouser flare) and tapers slightly at the toe.
  const legRings = (sx: number): Ring[] => [
    { y: hipY + 0.04,            cx: sx, cz: 0,    rx: H * 0.085 * t, rz: H * 0.085 * t }, // root inside trunk
    { y: hipY - H * 0.05,        cx: sx, cz: 0,    rx: H * 0.085 * t, rz: H * 0.085 * t }, // upper thigh
    { y: hipY - H * 0.18,        cx: sx, cz: 0,    rx: H * 0.078 * t, rz: H * 0.078 * t }, // knee
    { y: hipY - H * 0.34,        cx: sx, cz: 0.01, rx: H * 0.07  * t, rz: H * 0.07  * t }, // ankle
    { y: hipY - H * 0.39,        cx: sx, cz: 0.06, rx: H * 0.07  * t, rz: H * 0.14  * t }, // foot (forward-stretched, no X widen)
    { y: hipY - H * 0.40,        cx: sx, cz: 0.10, rx: H * 0.05  * t, rz: H * 0.09  * t }, // toe (taper forward + down)
  ];
  const legXOffset = hipHalf * 0.55;
  for (const sx of [-legXOffset, legXOffset]) {
    const rings = legRings(sx);
    emitSweep(g, rings, sides, p.smoothShading, HUMANOID_ATLAS.legs);
    emitCap(g, rings[rings.length - 1], sides, false, HUMANOID_ATLAS.legs, 'v1'); // toe tip
  }

  // ── arms: shoulder → end. Continuously TAPERS to a near-point (no flare,
  //    no fake mitt — at this poly count a clean tapered arm reads cleaner
  //    than a flared "is that a hand or a sleeve" bulge).
  const armRings = (sx: number): Ring[] => [
    { y: shoulderY,              cx: sx * 0.55, cz: 0,    rx: H * 0.07  * t, rz: H * 0.07  * t }, // root inside trunk
    { y: shoulderY - H * 0.04,   cx: sx,        cz: 0,    rx: H * 0.07  * t, rz: H * 0.07  * t }, // shoulder bulge
    { y: shoulderY - H * 0.16,   cx: sx,        cz: 0,    rx: H * 0.062 * t, rz: H * 0.062 * t }, // bicep
    { y: shoulderY - H * 0.30,   cx: sx,        cz: 0,    rx: H * 0.055 * t, rz: H * 0.055 * t }, // forearm
    { y: shoulderY - H * 0.40,   cx: sx,        cz: 0,    rx: H * 0.045 * t, rz: H * 0.045 * t }, // wrist
    { y: shoulderY - H * 0.43,   cx: sx,        cz: 0,    rx: H * 0.020 * t, rz: H * 0.020 * t }, // arm end (near-point)
  ];
  const armX = shoulderHalf * 1.02;
  for (const sx of [-armX, armX]) {
    const rings = armRings(sx);
    emitSweep(g, rings, sides, p.smoothShading, HUMANOID_ATLAS.arms);
    emitCap(g, rings[rings.length - 1], sides, false, HUMANOID_ATLAS.arms, 'v1'); // arm tip
  }

  return g.build();
}
