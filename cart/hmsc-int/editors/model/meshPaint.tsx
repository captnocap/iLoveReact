// editors/model/meshPaint.tsx — PAINT mode PURE MATH for the Studio, the CORRECTED
// painter (req_1288/req_1289). The React grid overlay lives in ./meshPaintOverlay
// (this file stays import-clean + unit-testable). The model the demos proved
// (triangle_mask → paint_on_3d → paint_texture):
//
//   • Paint is keyed in UNIFORM MODEL-SURFACE CELLS, not atlas texels. Each face's
//     cell size is a fixed world size (PAINT_CELL_UNITS) derived from the face's own
//     world↔uv scale — so a thin/slanted face gets the SAME cell size as a big one
//     (no slivers), independent of how the atlas packed its slot.
//   • A cell stores a SLOT id (a pseudo-colour / placement), never raw RGB. The model
//     palette (studioModel) resolves a slot → a colour or a material at bake time.
//   • The mask is PER-FACE: a brush stamp clamps to the face's cell bounds, so a
//     stroke at an edge never bleeds onto a neighbouring face.
//   • The bake (TextureAtlas) fills each cell as one seamless atlas rect (shared-edge
//     rounding) — a continuous layer, no per-row gaps (no pinstripes).
//
// The viewport (Studio.tsx) raycasts on press/drag; the renderer (TextureAtlas.tsx)
// fills the painted cells into the offscreen atlas. Reuses meshSelect's camera
// projection (the SAME view the host renders), adding the INVERSE (screen → world
// ray) so a click lands on the exact face + cell under the cursor.

import { type CameraSnap } from './meshSelect';
import { type EditMesh, type EditMeshFace, type V3 } from './editMesh';

const DEG = Math.PI / 180;
/** model units per paint cell — uniform across every face (16 units = 1 m). At 0.5
 *  (~3 cm) a prop-scale face shows a real grid instead of collapsing to one cell;
 *  GRID_MAX caps a huge face so the bake/overlay stay bounded. */
export const PAINT_CELL_UNITS = 0.5;
/** The FIXED storage/bake resolution for paint, in model units. Paint cells are keyed
 *  on a grid of THIS size on every face — INDEPENDENT of the "detail" brush slider — so
 *  changing the brush size never re-lays-out paint you already laid down (req_1318: the
 *  detail slider used to re-key every stored cell against a different-sized grid, so the
 *  whole layout scrambled / half the face went unpainted). The slider now sizes the
 *  brush DAB only; this constant is the canvas it stamps onto. 0.08 ≈ 0.5 cm. */
export const PAINT_GRID_UNITS = 0.08;
/** never make more than this many grid divisions on a face (sanity + perf cap). High
 *  enough that a metre-scale face can still be painted at sub-cm detail; only painted
 *  cells bake (run-merged) and the overlay strides its grid, so this stays cheap. */
const GRID_MAX = 256;

// ── small vec helpers (kept local; the gizmo/select math live in their modules) ──
function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function clampInt(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

/** the painted cells: key `"faceIndex:cu:cv"` (a model-surface cell on the part) →
 *  slot id. Per-PART (one layer per part); the palette resolves slot → appearance. */
export type PaintCells = Record<string, number>;

/** one part the ray can hit (its live mesh + render lift on the grid + id). */
export type PaintTarget = { partId: string; mesh: EditMesh; lift: number };

/** A face hit: which part/face and the uniform-world cell under the cursor. */
export type FaceHit = { partIndex: number; faceIndex: number; cu: number; cv: number };
export type TexelRect = { x0: number; y0: number; x1: number; y1: number };

// ── screen → world ray (the inverse of meshSelect.makeProjector) ────────────────
// makeProjector builds vp = perspective·lookAt and returns world→pixel. To pick a
// face we need the reverse: a ray from the eye through the clicked pixel. The lookAt
// basis is orthonormal (s = right, u = up, f = forward = normalize(eye−target), the
// camera looks down −f), so a view-space direction maps to world by s·ex + u·ey +
// f·ez with the SAME f/aspect the projector uses — no matrix inverse needed.
export function screenRay(cam: CameraSnap, sx: number, sy: number): { o: V3; d: V3 } {
  const { eye, target } = cam;
  let fx = eye[0] - target[0], fy = eye[1] - target[1], fz = eye[2] - target[2];
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  let sxx = fz, syy = 0, szz = -fx; // up×f with up=(0,1,0)
  const sl = Math.hypot(sxx, syy, szz) || 1; sxx /= sl; syy /= sl; szz /= sl;
  const ux = fy * szz - fz * syy, uy = fz * sxx - fx * szz, uz = fx * syy - fy * sxx; // f×s
  const fp = 1 / Math.tan((cam.fov * DEG) / 2);
  const ndcx = (sx / (cam.w || 1)) * 2 - 1;
  const ndcy = 1 - (sy / (cam.h || 1)) * 2;
  const ex = (ndcx * cam.aspect) / fp, ey = ndcy / fp, ez = -1; // view dir, forward = −f
  const dx = sxx * ex + ux * ey + fx * ez;
  const dy = syy * ex + uy * ey + fy * ez;
  const dz = szz * ex + uz * ey + fz * ez;
  const dl = Math.hypot(dx, dy, dz) || 1;
  return { o: [eye[0], eye[1], eye[2]], d: [dx / dl, dy / dl, dz / dl] };
}

/** Möller–Trumbore (double-sided so back faces hit too — nearest t is what's
 *  visible). Returns t + barycentric (a:1−u−v, b:u, c:v) or null on a miss. */
function rayTri(o: V3, d: V3, a: V3, b: V3, c: V3): { t: number; u: number; v: number } | null {
  const e1 = sub(b, a), e2 = sub(c, a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-9) return null;
  const inv = 1 / det;
  const tv = sub(o, a);
  const u = dot(tv, p) * inv;
  if (u < -1e-5 || u > 1 + 1e-5) return null;
  const q = cross(tv, e1);
  const v = dot(d, q) * inv;
  if (v < -1e-5 || u + v > 1 + 1e-5) return null;
  const t = dot(e2, q) * inv;
  if (t <= 1e-4) return null;
  return { t, u, v };
}

/** The face's atlas texel rect from its STORED uv (the slot textureize packed it
 *  into) — the clamp box so a fill stays inside this face's region. */
export function faceTexelRect(mesh: EditMesh, faceIndex: number, texels: number): TexelRect | null {
  const face = mesh.faces[faceIndex];
  if (!face?.uv || face.uv.length < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [u, v] of face.uv) { const px = u * texels, py = v * texels; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
  return { x0, y0, x1, y1 };
}

// ── the uniform-world cell grid on a face ───────────────────────────────────────
// The face's slot in the atlas is its uv-rect; how big that rect is in WORLD units is
// the face's own scale (a thin face packs a thin slot). We derive the cell size in UV
// from that scale so a cell is always `cell` model-units on EVERY face: cuv = cell /
// (worldLen/uvLen) measured on the face's first edge (the box unwrap is isometric).
/** uv units per WORLD unit on a face, measured on its LONGEST uv edge — robust where
 *  the first edge happens to be degenerate (a thin/folded face), which used to return
 *  null → an unpaintable face (req_1299). The box unwrap is isometric, so one number
 *  describes the whole face. Shared by faceCellGrid (cell sizing) and surfaceBrushDabs
 *  (per-face brush radius), so the paint canvas and the 3D brush agree on scale. */
export function faceUvPerWorld(mesh: EditMesh, faceIndex: number): number {
  const face = mesh.faces[faceIndex];
  if (!face?.uv || face.uv.length < 3 || face.loop.length < 3) return 0;
  let bestUv = 0, uvPerWorld = 0;
  const n = face.loop.length;
  for (let i = 0; i < n; i += 1) {
    const a = mesh.verts[face.loop[i]], b = mesh.verts[face.loop[(i + 1) % n]];
    const wl = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const uv = face.uv[i], uvN = face.uv[(i + 1) % n];
    const ul = Math.hypot(uvN[0] - uv[0], uvN[1] - uv[1]);
    if (ul > bestUv && wl > 1e-9) { bestUv = ul; uvPerWorld = ul / wl; }
  }
  return uvPerWorld;
}

export type CellGrid = { cuv: number; u0: number; v0: number; u1: number; v1: number; nu: number; nv: number };
export function faceCellGrid(mesh: EditMesh, faceIndex: number, cell = PAINT_CELL_UNITS): CellGrid | null {
  const face = mesh.faces[faceIndex];
  if (!face?.uv || face.uv.length < 3 || face.loop.length < 3) return null;
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const [u, v] of face.uv) { if (u < u0) u0 = u; if (v < v0) v0 = v; if (u > u1) u1 = u; if (v > v1) v1 = v; }
  // world↔uv scale from the longest uv edge (see faceUvPerWorld).
  const uvPerWorld = faceUvPerWorld(mesh, faceIndex);
  // cuv = uv units per cell; fall back to the whole face = 1 cell if no usable edge.
  let cuv = uvPerWorld > 1e-9 ? uvPerWorld * cell : Math.max(u1 - u0, v1 - v0, 1e-6);
  if (!(cuv > 1e-9) || !Number.isFinite(u0)) return null;
  // NEVER let GRID_MAX silently truncate a big face (the "can't paint the end" bug,
  // req_1318): the cell COUNT was capped while the cell SIZE stayed fine, so the grid
  // only covered the first 256 cells from one corner and the far end had no cells to
  // paint into. Coarsen the cell so the grid always spans the WHOLE face within the cap
  // — cells get bigger on a huge face (loud), but every part stays reachable.
  const span = Math.max(u1 - u0, v1 - v0);
  if (span / cuv > GRID_MAX) cuv = span / GRID_MAX;
  const nu = Math.max(1, Math.min(GRID_MAX, Math.ceil((u1 - u0) / cuv)));
  const nv = Math.max(1, Math.min(GRID_MAX, Math.ceil((v1 - v0) / cuv)));
  return { cuv, u0, v0, u1, v1, nu, nv };
}

/** Re-key a part's paint from an OLD cell size to a NEW one, PRESERVING the painted
 *  regions (req_1358): changing the detail grid used to re-interpret the stored cu:cv
 *  against a different grid → the whole layout scrambled. Instead, for every NEW cell we
 *  sample the OLD cell that covers its centre, so a finer grid SUBDIVIDES the paint (more
 *  detail, same picture) and a coarser grid down-samples it — the image stays put. */
export function resamplePaint(mesh: EditMesh, paint: PaintCells, oldCell: number, newCell: number): PaintCells {
  const out: PaintCells = {};
  const faces = new Set<number>();
  for (const k in paint) faces.add(Number(k.slice(0, k.indexOf(':'))));
  for (const fi of faces) {
    const go = faceCellGrid(mesh, fi, oldCell);
    const gn = faceCellGrid(mesh, fi, newCell);
    if (!go || !gn) { for (const k in paint) if (Number(k.slice(0, k.indexOf(':'))) === fi) out[k] = paint[k]; continue; }
    for (let cv = 0; cv < gn.nv; cv += 1) for (let cu = 0; cu < gn.nu; cu += 1) {
      const cU = gn.u0 + (cu + 0.5) * gn.cuv, cV = gn.v0 + (cv + 0.5) * gn.cuv;
      const ocu = Math.max(0, Math.min(go.nu - 1, Math.floor((cU - go.u0) / go.cuv)));
      const ocv = Math.max(0, Math.min(go.nv - 1, Math.floor((cV - go.v0) / go.cuv)));
      const slot = paint[`${fi}:${ocu}:${ocv}`];
      if (slot !== undefined) out[`${fi}:${cu}:${cv}`] = slot;
    }
  }
  return out;
}

/** Raycast every part for the frontmost uv-mapped face under (sx,sy) and resolve the
 *  uniform-world cell the cursor sits on (barycentric → interpolated uv → cell). Glass
 *  faces and faces without uv are skipped (nothing to paint). */
export function pickFaceCell(targets: PaintTarget[], cam: CameraSnap, sx: number, sy: number, cell = PAINT_CELL_UNITS): FaceHit | null {
  const ray = screenRay(cam, sx, sy);
  let best: FaceHit | null = null;
  let bestT = Infinity;
  targets.forEach((tgt, partIndex) => {
    const m = tgt.mesh;
    for (let fi = 0; fi < m.faces.length; fi += 1) {
      const face = m.faces[fi];
      if (face.glass || !face.uv || face.uv.length < 3 || face.loop.length < 3) continue;
      const grid = faceCellGrid(m, fi, cell);
      if (!grid) continue;
      const lift = tgt.lift;
      const v0 = m.verts[face.loop[0]];
      const w0: V3 = [v0[0], v0[1] + lift, v0[2]];
      // fan-triangulate (v0, vi, vi+1) — the same winding editMeshToGeometry uses.
      for (let i = 1; i < face.loop.length - 1; i += 1) {
        const va = m.verts[face.loop[i]], vb = m.verts[face.loop[i + 1]];
        const wa: V3 = [va[0], va[1] + lift, va[2]];
        const wb: V3 = [vb[0], vb[1] + lift, vb[2]];
        const hit = rayTri(ray.o, ray.d, w0, wa, wb);
        if (!hit || hit.t >= bestT) continue;
        const ba = 1 - hit.u - hit.v;
        const uv0 = face.uv[0], uva = face.uv[i], uvb = face.uv[i + 1];
        const au = ba * uv0[0] + hit.u * uva[0] + hit.v * uvb[0];
        const av = ba * uv0[1] + hit.u * uva[1] + hit.v * uvb[1];
        const cu = clampInt(Math.floor((au - grid.u0) / grid.cuv), 0, grid.nu - 1);
        const cv = clampInt(Math.floor((av - grid.v0) / grid.cuv), 0, grid.nv - 1);
        bestT = hit.t;
        best = { partIndex, faceIndex: fi, cu, cv };
      }
    }
  });
  return best;
}

/** A face hit resolved to a continuous UV coordinate (0..1 atlas space), for the
 *  PIXEL painter — no cell grid. `u,v` is the exact texel the cursor sits on;
 *  `world` is the 3D point on the surface (lift included), so a 3D-surface brush can
 *  reach the faces NEIGHBOURING the hit one across an atlas seam (req_1580). */
export type FaceUVHit = { partIndex: number; faceIndex: number; u: number; v: number; world: V3 };

/** True when the model's faces do NOT each own a UNIQUE atlas island — i.e.
 *  painting one would paint others (req_1375, the "1 click → green in 4 places"
 *  bug). Catches three sharers: a face with no uv, a face whose uv fills ~the
 *  whole [0,1] square (the default mapping — every such face samples the entire
 *  texture), and two faces packed onto the SAME slot (congruent-face dedup /
 *  combine). When this is true, paint mode must re-pack with dedup OFF so every
 *  face is independently paintable. After such a pack it returns false (stable). */
export function paintUVsNeedRepack(meshes: EditMesh[]): boolean {
  const seen = new Set<string>();
  for (const m of meshes) {
    for (const face of m.faces) {
      if (face.glass || face.loop.length < 3) continue;
      if (!face.uv || face.uv.length < 3) return true; // unmapped → can't isolate it
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [u, v] of face.uv) { if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v; }
      const w = x1 - x0, h = y1 - y0;
      if (w > 0.97 && h > 0.97) return true; // ~full-square default → shares with every default face
      const key = `${x0.toFixed(4)},${y0.toFixed(4)},${w.toFixed(4)},${h.toFixed(4)}`;
      if (seen.has(key)) return true; // identical slot as another face → deduped/overlapping
      seen.add(key);
    }
  }
  return false;
}

/** Raycast for the SURFACE the cursor is over and return its interpolated UV.
 *
 *  Occlusion-correct (req_1373): tests the ray against EVERY non-glass face (not
 *  just uv-mapped ones) and keeps the nearest hit — the front-most surface. If that
 *  nearest face has no uv, returns null (the face isn't paintable) instead of
 *  punching THROUGH it to a uv-mapped face BEHIND. The old skip-no-uv-faces pick did
 *  exactly that: clicking a no-uv front face painted a hidden back face, so a dab
 *  "wouldn't paint" where you clicked and turned up arbitrarily elsewhere. Now the
 *  click lands on what you actually see, or nothing. */
export function pickFaceUV(targets: PaintTarget[], cam: CameraSnap, sx: number, sy: number): FaceUVHit | null {
  const ray = screenRay(cam, sx, sy);
  let bestT = Infinity;
  let bestUV: FaceUVHit | null = null; // populated only when the nearest face has uv
  targets.forEach((tgt, partIndex) => {
    const m = tgt.mesh;
    const lift = tgt.lift;
    for (let fi = 0; fi < m.faces.length; fi += 1) {
      const face = m.faces[fi];
      if (face.glass || face.loop.length < 3) continue; // glass: paint through it
      const v0 = m.verts[face.loop[0]];
      const w0: V3 = [v0[0], v0[1] + lift, v0[2]];
      const hasUV = !!face.uv && face.uv.length >= 3;
      for (let i = 1; i < face.loop.length - 1; i += 1) {
        const va = m.verts[face.loop[i]], vb = m.verts[face.loop[i + 1]];
        const wa: V3 = [va[0], va[1] + lift, va[2]];
        const wb: V3 = [vb[0], vb[1] + lift, vb[2]];
        const hit = rayTri(ray.o, ray.d, w0, wa, wb);
        if (!hit || hit.t >= bestT) continue;
        bestT = hit.t;
        if (hasUV) {
          const ba = 1 - hit.u - hit.v;
          const uv0 = face.uv![0], uva = face.uv![i], uvb = face.uv![i + 1];
          bestUV = {
            partIndex,
            faceIndex: fi,
            u: ba * uv0[0] + hit.u * uva[0] + hit.v * uvb[0],
            v: ba * uv0[1] + hit.u * uva[1] + hit.v * uvb[1],
            world: [ray.o[0] + ray.d[0] * hit.t, ray.o[1] + ray.d[1] * hit.t, ray.o[2] + ray.d[2] * hit.t],
          };
        } else {
          // A no-uv face is now the nearest surface — it OCCLUDES anything behind.
          bestUV = null;
        }
      }
    }
  });
  return bestUV;
}

// ── 3D surface brush (req_1580) ─────────────────────────────────────────────
// The pixel painter stamps into the atlas. A brush dab is a disc in UV/atlas space
// SCISSORED to ONE face's island — fine WITHIN a face, but a continuous stroke on a
// many-face mesh (a sphere has 256 tiny faces) crosses a face boundary almost every
// pixel, and surface-adjacent faces are scattered to NON-adjacent atlas islands. So a
// single-island dab leaves the seam unpainted (the stroke shreds, the "broken 67").
//
// The cure: treat the brush as a SPHERE of WORLD radius around the 3D hit point and
// stamp into EVERY face it reaches — each in its own UV island. A face's painted
// region is centred on the closest surface point to the hit and sized by how far the
// brush sphere still reaches there (sqrt(r²−d²)), so the paint flows continuously
// across the seam from both sides. The caller interpolates the stroke in SCREEN space
// (raycasting each step) — never in atlas space — so there's no cross-island streak.

function add3(a: V3, b: V3): V3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale3(a: V3, s: number): V3 { return [a[0] * s, a[1] * s, a[2] * s]; }
function dist2(a: V3, b: V3): number { const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; return dx * dx + dy * dy + dz * dz; }

/** Closest point on triangle (a,b,c) to p (Ericson, Real-Time Collision Detection):
 *  handles the vertex / edge / face Voronoi regions, so a brush near a shared edge
 *  resolves to the edge — exactly where seam continuity needs it. */
function closestOnTri(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add3(a, scale3(ab, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add3(a, scale3(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) return add3(b, scale3(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const denom = 1 / (va + vb + vc);
  return add3(a, add3(scale3(ab, vb * denom), scale3(ac, vc * denom)));
}

/** Barycentric of q within triangle (a,b,c) — for mapping a surface point back to uv. */
function baryOnTri(q: V3, a: V3, b: V3, c: V3): [number, number, number] {
  const v0 = sub(b, a), v1 = sub(c, a), v2 = sub(q, a);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1);
  const den = d00 * d11 - d01 * d01;
  if (Math.abs(den) < 1e-14) return [1, 0, 0];
  const wb = (d11 * d20 - d01 * d21) / den, wc = (d00 * d21 - d01 * d20) / den;
  return [1 - wb - wc, wb, wc];
}

/** One stamp the surface brush lays onto a face: the atlas UV centre, the radius in
 *  TEXTURE PIXELS for THIS face's island (a world-uniform brush, so it's the correct
 *  px size per face), and the face's island rect to scissor to. */
export type SurfaceDab = { u: number; v: number; radiusPx: number; clip: TexelRect | null };

/** Every face of `mesh` the brush sphere (centre `p` in world space, `worldRadius`)
 *  reaches, as a stamp in that face's own UV island. `lift` is the part's render lift
 *  (verts are compared in the same lifted world space as the ray hit). Skips glass /
 *  unmapped faces. The union of these stamps is a seam-continuous 3D brush. */
export function surfaceBrushDabs(mesh: EditMesh, lift: number, p: V3, worldRadius: number, texels: number): SurfaceDab[] {
  const out: SurfaceDab[] = [];
  if (!(worldRadius > 0)) return out;
  const r2 = worldRadius * worldRadius;
  for (let fi = 0; fi < mesh.faces.length; fi += 1) {
    const face = mesh.faces[fi];
    if (face.glass || !face.uv || face.uv.length < 3 || face.loop.length < 3) continue;
    const upw = faceUvPerWorld(mesh, fi);
    if (!(upw > 1e-9)) continue;
    // lifted face verts
    const lv = face.loop.map((vi) => { const w = mesh.verts[vi]; return [w[0], w[1] + lift, w[2]] as V3; });
    // cheap reject: centroid + bound radius vs the brush sphere.
    let cx = 0, cy = 0, cz = 0;
    for (const w of lv) { cx += w[0]; cy += w[1]; cz += w[2]; }
    const centroid: V3 = [cx / lv.length, cy / lv.length, cz / lv.length];
    let boundR = 0;
    for (const w of lv) boundR = Math.max(boundR, Math.hypot(w[0] - centroid[0], w[1] - centroid[1], w[2] - centroid[2]));
    const cd = Math.hypot(p[0] - centroid[0], p[1] - centroid[1], p[2] - centroid[2]);
    if (cd > worldRadius + boundR) continue;
    // closest surface point over the fan triangles (v0, vi, vi+1).
    let bestD2 = Infinity, bestTri = -1; let bestQ: V3 | null = null;
    for (let i = 1; i < lv.length - 1; i += 1) {
      const q = closestOnTri(p, lv[0], lv[i], lv[i + 1]);
      const d = dist2(p, q);
      if (d < bestD2) { bestD2 = d; bestTri = i; bestQ = q; }
    }
    if (bestTri < 0 || !bestQ || bestD2 > r2) continue;
    const effR = Math.sqrt(Math.max(0, r2 - bestD2)); // surface reach on this face
    if (effR <= 0) continue;
    const bary = baryOnTri(bestQ, lv[0], lv[bestTri], lv[bestTri + 1]);
    const uv0 = face.uv[0], uva = face.uv[bestTri], uvb = face.uv[bestTri + 1];
    out.push({
      u: bary[0] * uv0[0] + bary[1] * uva[0] + bary[2] * uvb[0],
      v: bary[0] * uv0[1] + bary[1] * uva[1] + bary[2] * uvb[1],
      radiusPx: Math.max(1, effR * upw * texels),
      clip: faceTexelRect(mesh, fi, texels),
    });
  }
  return out;
}

// ── Mirror painting (req_1538) ──────────────────────────────────────────────
// Symmetric painting: every brush dab is also stamped on the mesh's mirror-image
// face(s), so painting the left half paints the right (and up/down, front/back).
// Geometry mirror reflects in LOCAL space about c=0 (mirrorEditAxes/symmetrize); we
// do the SAME, which is why centering the model first (centerMesh) matters — an
// off-origin model would mirror onto empty space. A dab carries only its atlas
// texel, so we invert UV→surface point on its source face, reflect that point, then
// forward-map it back to whatever face now sits there and its atlas texel.

/** Forward map: a LOCAL point → the uv-mapped face it lies ON (nearest plane that
 *  contains it) and the interpolated atlas UV there. `eps` is the max distance off a
 *  face's plane to count as "on" it. Skips glass/unmapped faces. */
function localToFaceUV(mesh: EditMesh, p: V3, eps: number): { faceIndex: number; u: number; v: number } | null {
  let best: { faceIndex: number; u: number; v: number } | null = null;
  let bestDist = eps;
  for (let fi = 0; fi < mesh.faces.length; fi += 1) {
    const face = mesh.faces[fi];
    if (face.glass || !face.uv || face.uv.length < 3 || face.loop.length < 3) continue;
    const v0 = mesh.verts[face.loop[0]];
    for (let i = 1; i < face.loop.length - 1; i += 1) {
      const va = mesh.verts[face.loop[i]], vb = mesh.verts[face.loop[i + 1]];
      const n = cross(sub(va, v0), sub(vb, v0));
      const n2 = dot(n, n);
      if (n2 < 1e-12) continue;
      const dist = Math.abs(dot(sub(p, v0), n)) / Math.sqrt(n2);
      if (dist >= bestDist) continue;
      // barycentric of p projected onto the tri plane (areas via cross products).
      const wa = dot(n, cross(sub(vb, va), sub(p, va))) / n2;
      const wb = dot(n, cross(sub(v0, vb), sub(p, vb))) / n2;
      const wc = 1 - wa - wb;
      if (wa < -1e-3 || wb < -1e-3 || wc < -1e-3) continue;
      const uv0 = face.uv[0], uva = face.uv[i], uvb = face.uv[i + 1];
      best = { faceIndex: fi, u: wa * uv0[0] + wb * uva[0] + wc * uvb[0], v: wa * uv0[1] + wb * uva[1] + wc * uvb[1] };
      bestDist = dist;
    }
  }
  return best;
}

/** Every non-empty reflection of `p` across the given local axes about c=0 — matches
 *  the geometry mirror (one axis = 1 image, two = 3, three = 7). */
function reflections(p: V3, axes: (0 | 1 | 2)[]): V3[] {
  const out: V3[] = [];
  for (let mask = 1; mask < (1 << axes.length); mask += 1) {
    const q: V3 = [p[0], p[1], p[2]];
    for (let k = 0; k < axes.length; k += 1) if (mask & (1 << k)) q[axes[k]] = -q[axes[k]];
    out.push(q);
  }
  return out;
}

/** A mirror stamp: where (atlas px) + which UV island to scissor to. */
export type MirrorDab = { x: number; y: number; clip: TexelRect | null };

/** Given a primary dab at atlas texel (x,y), return the mirror dab(s) — its symmetric
 *  image(s) across `axes` on the same part — to stamp alongside it (req_1538). The dab
 *  has lost its face, so we find the source face by its UV island, invert to the local
 *  surface point, reflect it, and forward-map each reflection to its face + atlas texel.
 *  Empty when there's no symmetry plane or the dab sits on the plane (its own mirror). */
export function mirrorPaintDabs(targets: PaintTarget[], x: number, y: number, axes: (0 | 1 | 2)[], texels: number): MirrorDab[] {
  if (!axes.length) return [];
  const qu = x / texels, qv = y / texels;
  // resolve the source part+face: the UV island whose rect contains (qu,qv) AND whose
  // polygon actually owns the point (rect is the cheap filter, uvToWorld is the test).
  let src: { mesh: EditMesh; faceIndex: number; p: V3; scale: number } | null = null;
  outer:
  for (const tgt of targets) {
    const m = tgt.mesh;
    for (let fi = 0; fi < m.faces.length; fi += 1) {
      const r = faceTexelRect(m, fi, texels);
      if (!r || x < r.x0 - 0.5 || x > r.x1 + 0.5 || y < r.y0 - 0.5 || y > r.y1 + 0.5) continue;
      const inv = uvToWorld(m, m.faces[fi], qu, qv);
      if (!inv || !inv.inside) continue;
      const p = inv.world;
      // model scale → an on-plane epsilon proportional to it (handles props & cars).
      let lo = Infinity, hi = -Infinity;
      for (const v of m.verts) { for (let a = 0; a < 3; a += 1) { if (v[a] < lo) lo = v[a]; if (v[a] > hi) hi = v[a]; } }
      src = { mesh: m, faceIndex: fi, p, scale: Math.max(1e-3, hi - lo) };
      break outer;
    }
  }
  if (!src) return [];
  const eps = src.scale * 1e-3 + 1e-4;
  const out: MirrorDab[] = [];
  for (const q of reflections(src.p, axes)) {
    const hit = localToFaceUV(src.mesh, q, eps);
    if (!hit) continue;
    if (hit.faceIndex === src.faceIndex) continue; // on the plane → its own mirror, skip
    out.push({ x: hit.u * texels, y: hit.v * texels, clip: faceTexelRect(src.mesh, hit.faceIndex, texels) });
  }
  return out;
}

/** The cells a brush stamp covers, clamped to the face's cell bounds (so the stroke
 *  can't spill onto a neighbouring face — the per-face mask). `size` = brush RADIUS+1
 *  in cells: 1 → a single cell, 2 → a 3-wide disc, … A disc footprint keeps round
 *  brushes round. */
export function brushCells(hit: FaceHit, size: number, grid: CellGrid): Array<[number, number]> {
  const r = Math.max(0, Math.round(size) - 1);
  const out: Array<[number, number]> = [];
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (r > 0 && dx * dx + dy * dy > r * r + 0.25) continue; // disc, not square
      const cu = hit.cu + dx, cv = hit.cv + dy;
      if (cu < 0 || cu >= grid.nu || cv < 0 || cv >= grid.nv) continue; // clamp to the face
      out.push([cu, cv]);
    }
  }
  if (out.length === 0) out.push([hit.cu, hit.cv]);
  return out;
}

/** The brush-dab radius in FIXED grid cells (PAINT_GRID_UNITS) for a dab of `dabUnits`
 *  world-size, scaled by the brush multiplier. Face-independent: one fixed cell is the
 *  same world size on every face, so a dab spans the same cell count everywhere. This is
 *  how the "detail" slider maps to a footprint WITHOUT changing the stored grid — pass
 *  the result+1 to brushCells (which takes radius+1). */
export function dabRadiusCells(dabUnits: number, brushMult = 1, gridCell = PAINT_GRID_UNITS): number {
  return Math.max(0, Math.floor(dabUnits / gridCell / 2) + Math.max(1, Math.round(brushMult)) - 1);
}

/** Atlas-pixel rect for one cell, with SHARED-EDGE rounding so neighbouring cells
 *  abut exactly (no 1px gap → no pinstripes). uv→atlas is a pure `*texels` scale, so
 *  a cell maps to an axis-aligned rect; clamped to the face's slot. */
export function cellAtlasRect(grid: CellGrid, cu: number, cv: number, texels: number): { x: number; y: number; w: number; h: number } {
  const ax0 = Math.round((grid.u0 + cu * grid.cuv) * texels);
  const ax1 = Math.round(Math.min(grid.u0 + (cu + 1) * grid.cuv, grid.u1) * texels);
  const ay0 = Math.round((grid.v0 + cv * grid.cuv) * texels);
  const ay1 = Math.round(Math.min(grid.v0 + (cv + 1) * grid.cuv, grid.v1) * texels);
  return { x: ax0, y: ay0, w: Math.max(1, ax1 - ax0), h: Math.max(1, ay1 - ay0) };
}

/** Merge a face's cells into horizontal RUNS (one per maximal consecutive cu in a
 *  row) so a filled/large region bakes as a handful of boxes instead of thousands —
 *  keeps the atlas under the layout child cap (a full 32² face → 32 boxes, not 1024). */
export function cellRuns(cells: Array<[number, number]>): Array<{ cv: number; cu0: number; cu1: number }> {
  const byRow = new Map<number, number[]>();
  for (const [cu, cv] of cells) { let r = byRow.get(cv); if (!r) { r = []; byRow.set(cv, r); } r.push(cu); }
  const out: Array<{ cv: number; cu0: number; cu1: number }> = [];
  for (const [cv, cus] of byRow) {
    cus.sort((a, b) => a - b);
    let i = 0;
    while (i < cus.length) {
      const s = cus[i]; let e = cus[i]; i += 1;
      while (i < cus.length && cus[i] === e + 1) { e = cus[i]; i += 1; }
      out.push({ cv, cu0: s, cu1: e });
    }
  }
  return out;
}

/** Merge a face's cells into maximal 2D RECTANGLES (greedy: extend right, then down
 *  while the full width is present). A solid region bakes as ONE box — per-row runs
 *  left thin seams between hundreds of fine rows (req_1303), this removes them. */
export function cellRects(cells: Array<[number, number]>): Array<{ cu0: number; cv0: number; cu1: number; cv1: number }> {
  const has = new Set(cells.map(([cu, cv]) => `${cu},${cv}`));
  const used = new Set<string>();
  const rects: Array<{ cu0: number; cv0: number; cu1: number; cv1: number }> = [];
  const sorted = [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [cu, cv] of sorted) {
    if (used.has(`${cu},${cv}`)) continue;
    let cu1 = cu;
    while (has.has(`${cu1 + 1},${cv}`) && !used.has(`${cu1 + 1},${cv}`)) cu1 += 1;
    let cv1 = cv;
    for (let nv = cv + 1; ; nv += 1) {
      let full = true;
      for (let x = cu; x <= cu1; x += 1) if (!has.has(`${x},${nv}`) || used.has(`${x},${nv}`)) { full = false; break; }
      if (!full) break;
      cv1 = nv;
    }
    for (let y = cv; y <= cv1; y += 1) for (let x = cu; x <= cu1; x += 1) used.add(`${x},${y}`);
    rects.push({ cu0: cu, cv0: cv, cu1, cv1 });
  }
  return rects;
}

/** Atlas-pixel rect for a cell RECTANGLE [cu0..cu1]×[cv0..cv1] — seamless shared-edge
 *  rounding, clamped to the face slot. One box per solid region → no internal seams. */
export function rectAtlasRect(grid: CellGrid, cu0: number, cv0: number, cu1: number, cv1: number, texels: number): { x: number; y: number; w: number; h: number } {
  const ax0 = Math.round((grid.u0 + cu0 * grid.cuv) * texels);
  const ax1 = Math.round(Math.min(grid.u0 + (cu1 + 1) * grid.cuv, grid.u1) * texels);
  const ay0 = Math.round((grid.v0 + cv0 * grid.cuv) * texels);
  const ay1 = Math.round(Math.min(grid.v0 + (cv1 + 1) * grid.cuv, grid.v1) * texels);
  return { x: ax0, y: ay0, w: Math.max(1, ax1 - ax0), h: Math.max(1, ay1 - ay0) };
}

/** Map a UV point (normalized atlas coords) to a world point ON the face, via
 *  barycentric over the fan triangulation. `inside` is true when the UV lies within
 *  the face, so grid lines clip to the face. (Used by the overlay; pure.) */
export function uvToWorld(mesh: EditMesh, face: EditMeshFace, u: number, v: number): { world: V3; inside: boolean } | null {
  const uvs = face.uv; if (!uvs || uvs.length < 3) return null;
  const loop = face.loop;
  let best: { i: number; wa: number; wb: number; wc: number; score: number } | null = null;
  for (let i = 1; i + 1 < loop.length; i += 1) {
    const a = uvs[0], b = uvs[i], c = uvs[i + 1];
    const v0x = b[0] - a[0], v0y = b[1] - a[1], v1x = c[0] - a[0], v1y = c[1] - a[1], v2x = u - a[0], v2y = v - a[1];
    const d00 = v0x * v0x + v0y * v0y, d01 = v0x * v1x + v0y * v1y, d11 = v1x * v1x + v1y * v1y;
    const d20 = v2x * v0x + v2y * v0y, d21 = v2x * v1x + v2y * v1y;
    const den = d00 * d11 - d01 * d01;
    if (Math.abs(den) < 1e-14) continue;
    const wb = (d11 * d20 - d01 * d21) / den, wc = (d00 * d21 - d01 * d20) / den, wa = 1 - wb - wc;
    const score = Math.min(wa, wb, wc);
    if (!best || score > best.score) best = { i, wa, wb, wc, score };
  }
  if (!best) return null;
  const A = mesh.verts[loop[0]], B = mesh.verts[loop[best.i]], C = mesh.verts[loop[best.i + 1]];
  return {
    world: [best.wa * A[0] + best.wb * B[0] + best.wc * C[0], best.wa * A[1] + best.wb * B[1] + best.wc * C[1], best.wa * A[2] + best.wb * B[2] + best.wc * C[2]],
    inside: best.score >= -0.02,
  };
}
