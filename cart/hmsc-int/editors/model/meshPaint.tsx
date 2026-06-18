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
export type CellGrid = { cuv: number; u0: number; v0: number; u1: number; v1: number; nu: number; nv: number };
export function faceCellGrid(mesh: EditMesh, faceIndex: number, cell = PAINT_CELL_UNITS): CellGrid | null {
  const face = mesh.faces[faceIndex];
  if (!face?.uv || face.uv.length < 3 || face.loop.length < 3) return null;
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (const [u, v] of face.uv) { if (u < u0) u0 = u; if (v < v0) v0 = v; if (u > u1) u1 = u; if (v > v1) v1 = v; }
  // world↔uv scale from the LONGEST uv edge — robust where the first edge happens to
  // be degenerate (a thin/folded face), which used to return null → an unpaintable
  // face (req_1299). uvPerWorld = uvLen/worldLen on that edge.
  let bestUv = 0, uvPerWorld = 0;
  const n = face.loop.length;
  for (let i = 0; i < n; i += 1) {
    const a = mesh.verts[face.loop[i]], b = mesh.verts[face.loop[(i + 1) % n]];
    const wl = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const uv = face.uv[i], uvN = face.uv[(i + 1) % n];
    const ul = Math.hypot(uvN[0] - uv[0], uvN[1] - uv[1]);
    if (ul > bestUv && wl > 1e-9) { bestUv = ul; uvPerWorld = ul / wl; }
  }
  // cuv = uv units per cell; fall back to the whole face = 1 cell if no usable edge.
  const cuv = uvPerWorld > 1e-9 ? uvPerWorld * cell : Math.max(u1 - u0, v1 - v0, 1e-6);
  if (!(cuv > 1e-9) || !Number.isFinite(u0)) return null;
  const nu = Math.max(1, Math.min(GRID_MAX, Math.ceil((u1 - u0) / cuv)));
  const nv = Math.max(1, Math.min(GRID_MAX, Math.ceil((v1 - v0) / cuv)));
  return { cuv, u0, v0, u1, v1, nu, nv };
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

/** Atlas-pixel rect for a horizontal run of cells [cu0..cu1] on row cv — seamless
 *  shared-edge rounding, like cellAtlasRect but spanning the run. */
export function runAtlasRect(grid: CellGrid, cu0: number, cu1: number, cv: number, texels: number): { x: number; y: number; w: number; h: number } {
  const ax0 = Math.round((grid.u0 + cu0 * grid.cuv) * texels);
  const ax1 = Math.round(Math.min(grid.u0 + (cu1 + 1) * grid.cuv, grid.u1) * texels);
  const ay0 = Math.round((grid.v0 + cv * grid.cuv) * texels);
  const ay1 = Math.round(Math.min(grid.v0 + (cv + 1) * grid.cuv, grid.v1) * texels);
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
