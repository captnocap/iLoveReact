// editors/model/meshPaint.tsx — PAINT mode for the Studio (Phase 5c, the in-app
// texture painter). USER model: with a texture made, EVERY face becomes a
// NORMALIZED GRID of cells (the atlas texels its UV slot covers); a thin/slanted
// face's cells are slivers because the geometry packs a thin slot — expected.
// Painting a face writes the texels INSIDE that face's slot only, so a stroke at
// the edge NEVER bleeds into a neighbouring face (every face owns a disjoint atlas
// region, padded by textureize). The grid IS the texture's texel grid; painting a
// cell colours the atlas region the face samples, so it shows on the 3D model live.
//
// This module is the pure paint math + the hovered-face grid overlay. The viewport
// (Studio.tsx) raycasts on press/drag, the renderer (TextureAtlas.tsx) draws the
// painted cells into the offscreen atlas. Self-contained: reuses meshSelect's camera
// projection (the SAME view the host renders), adding the INVERSE (screen → world
// ray) so a click lands on the exact face + texel under the cursor.

import { useInterval, useRerender } from '@reactjit/hooks';
import { Box } from '@reactjit/primitives';
import { makeProjector, type CameraSnap } from './meshSelect';
import { faceNormal, type EditMesh, type V2, type V3 } from './editMesh';

const DEG = Math.PI / 180;
/** never draw more than this many grid divisions on a hovered face (sanity). */
const GRID_MAX = 48;

// ── small vec helpers (kept local; the gizmo/select math live in their modules) ──
function sub(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: V3, b: V3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

/** the painted cells: key `"tx:ty"` (atlas texel) → colour hex. Global to the atlas
 *  because every face's slot is a disjoint texel rect — the key needs no face id. */
export type PaintCells = Record<string, string>;

/** one part the ray can hit (its live mesh + render lift on the grid + id). */
export type PaintTarget = { partId: string; mesh: EditMesh; lift: number };

/** A face hit: which part/face, the texel under the cursor, and the face's atlas
 *  texel rect (the clamp box so a brush can't spill past the face's slot). */
export type FaceHit = { partIndex: number; faceIndex: number; tx: number; ty: number; rect: TexelRect };
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
 *  into) — the clamp box so a brush stays inside this face's region. */
export function faceTexelRect(mesh: EditMesh, faceIndex: number, texels: number): TexelRect | null {
  const face = mesh.faces[faceIndex];
  if (!face?.uv || face.uv.length < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [u, v] of face.uv) { const px = u * texels, py = v * texels; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
  return { x0, y0, x1, y1 };
}

/** Raycast every part for the frontmost uv-mapped face under (sx,sy) and resolve
 *  the exact atlas TEXEL the cursor sits on (barycentric → interpolated uv → texel).
 *  Glass faces and faces without uv are skipped (nothing to paint). */
export function pickFaceTexel(targets: PaintTarget[], cam: CameraSnap, sx: number, sy: number, texels: number): FaceHit | null {
  const ray = screenRay(cam, sx, sy);
  let best: FaceHit | null = null;
  let bestT = Infinity;
  targets.forEach((tgt, partIndex) => {
    const m = tgt.mesh;
    for (let fi = 0; fi < m.faces.length; fi += 1) {
      const face = m.faces[fi];
      if (face.glass || !face.uv || face.uv.length < 3 || face.loop.length < 3) continue;
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
        const rect = faceTexelRect(m, fi, texels)!;
        const tx = clampTexel(Math.floor(au * texels), rect.x0, rect.x1);
        const ty = clampTexel(Math.floor(av * texels), rect.y0, rect.y1);
        bestT = hit.t;
        best = { partIndex, faceIndex: fi, tx, ty, rect };
      }
    }
  });
  return best;
}

function clampTexel(t: number, lo: number, hi: number): number {
  const a = Math.floor(lo), b = Math.ceil(hi) - 1;
  return Math.max(a, Math.min(b > a ? b : a, t));
}

/** The cells a brush stamp covers, clamped to the face's slot (so the stroke can't
 *  spill into the neighbouring face). `size` = brush RADIUS+1 in cells: 1 → a single
 *  cell, 2 → a 3-wide disc, 3 → 5-wide, … (each size is distinct — the old mapping
 *  made 1 and 2 identical, so painting read as thin pinlines). A disc footprint keeps
 *  round brushes round on big faces. */
export function brushTexels(tx: number, ty: number, size: number, rect: TexelRect): Array<[number, number]> {
  const r = Math.max(0, Math.round(size) - 1);
  const x0 = Math.floor(rect.x0), x1 = Math.ceil(rect.x1) - 1, y0 = Math.floor(rect.y0), y1 = Math.ceil(rect.y1) - 1;
  const out: Array<[number, number]> = [];
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (r > 0 && dx * dx + dy * dy > r * r + 0.25) continue; // disc, not square
      const px = tx + dx, py = ty + dy;
      if (px < x0 || px > x1 || py < y0 || py > y1) continue; // clamp to the slot
      out.push([px, py]);
    }
  }
  if (out.length === 0) out.push([tx, ty]);
  return out;
}

/** Merge painted cells into horizontal RUNS of one colour per row — far fewer
 *  rendered boxes than one-per-texel (a full 64² face = ~64 boxes, not 4096), which
 *  keeps the atlas capture under the layout child cap. */
export function paintRuns(paint: PaintCells): Array<{ x: number; y: number; w: number; color: string }> {
  const rows = new Map<number, Array<{ x: number; color: string }>>();
  for (const key in paint) {
    const sep = key.indexOf(':');
    const x = Number(key.slice(0, sep)), y = Number(key.slice(sep + 1));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    let row = rows.get(y); if (!row) { row = []; rows.set(y, row); }
    row.push({ x, color: paint[key] });
  }
  const runs: Array<{ x: number; y: number; w: number; color: string }> = [];
  for (const [y, row] of rows) {
    row.sort((a, b) => a.x - b.x);
    let i = 0;
    while (i < row.length) {
      const startX = row[i].x, color = row[i].color;
      let w = 1; i += 1;
      while (i < row.length && row[i].x === startX + w && row[i].color === color) { w += 1; i += 1; }
      runs.push({ x: startX, y, w, color });
    }
  }
  return runs;
}

// ── The hovered-face grid overlay ───────────────────────────────────────────────
// Draws the NORMALIZED grid on the face under the cursor (quad faces — boxes, the
// common case) so the user SEES the cells they'll paint, plus the cell under the
// cursor highlighted. Bilinear over the face's 4 corners (matched to its uv-rect
// corners) maps a grid coordinate back to a world point; everything projects through
// the SAME view the host renders (so the grid sits ON the rendered face). Non-quad
// faces just get an outline (the grid math is quad-only for v1).

type Proj = { x: number; y: number; front: boolean };

function Line(props: { a: Proj; b: Proj; color: string; thick: number; opacity?: number }) {
  if (!props.a.front || !props.b.front) return null;
  const dx = props.b.x - props.a.x, dy = props.b.y - props.a.y;
  const len = Math.hypot(dx, dy) || 0.001;
  const angle = Math.atan2(dy, dx) / DEG;
  return <Box style={{ position: 'absolute', left: (props.a.x + props.b.x) / 2 - len / 2, top: (props.a.y + props.b.y) / 2 - props.thick / 2, width: len, height: props.thick, borderRadius: props.thick / 2, backgroundColor: props.color, opacity: props.opacity ?? 1, transform: { rotate: angle } }} />;
}

/** The hovered-face grid overlay. REF-DRIVEN (req_1203): it reads the live hover via
 *  `getHover()` and self-ticks, so moving the cursor or painting never re-renders the
 *  parent viewport — the perf-critical decoupling. `grid` is the global texel grid the
 *  whole atlas is divided into; a face sits on it and clips cells (a triangle cuts
 *  through squares). Always mounted in paint mode; renders nothing when nothing is hit. */
export function PaintGridOverlay(props: {
  parts: PaintTarget[];
  getHover: () => FaceHit | null;
  grid: number;
  color: string;
  camSnap: () => CameraSnap;
}) {
  // self-tick so the grid tracks the live hover + an orbiting camera with no parent render.
  const repaint = useRerender();
  useInterval(repaint, 33);

  const texels = props.grid;
  const out: any[] = [];
  const hover = props.getHover();
  const target = hover ? props.parts[hover.partIndex] : null;
  const face = target && hover ? target.mesh.faces[hover.faceIndex] : null;
  if (target && hover && face) {
    const mesh = target.mesh, lift = target.lift, faceIndex = hover.faceIndex;
  const baseProj = makeProjector(props.camSnap());
  const proj = (p: V3): Proj => { const q = baseProj([p[0], p[1] + lift, p[2]]); return { x: q.x, y: q.y, front: q.front }; };

  // the face outline (always — context, even for non-quad faces).
  const loopW = face.loop.map((vi) => mesh.verts[vi]);
  for (let i = 0; i < loopW.length; i += 1) {
    out.push(<Line key={`o${i}`} a={proj(loopW[i])} b={proj(loopW[(i + 1) % loopW.length])} color="#7fd6c0" thick={1.6} opacity={0.9} />);
  }

  const rect = faceTexelRect(mesh, faceIndex, texels);
  const isQuad = face.loop.length === 4 && !!face.uv && face.uv.length === 4 && !!rect;
  if (isQuad && rect) {
    const rw = rect.x1 - rect.x0 || 1, rh = rect.y1 - rect.y0 || 1;
    // match each world corner to its uv-rect corner (su,sv ∈ {0,1}).
    const corner: (V3 | null)[] = [null, null, null, null]; // code = (su>0.5)+2*(sv>0.5)
    for (let k = 0; k < 4; k += 1) {
      const uv = face.uv![k];
      const su = (uv[0] * texels - rect.x0) / rw, sv = (uv[1] * texels - rect.y0) / rh;
      corner[(su > 0.5 ? 1 : 0) + (sv > 0.5 ? 2 : 0)] = mesh.verts[face.loop[k]];
    }
    const c00 = corner[0], c10 = corner[1], c01 = corner[2], c11 = corner[3];
    if (c00 && c10 && c01 && c11) {
      const bilerp = (a: number, b: number): V3 => {
        const top: V3 = [c00[0] + (c10[0] - c00[0]) * a, c00[1] + (c10[1] - c00[1]) * a, c00[2] + (c10[2] - c00[2]) * a];
        const bot: V3 = [c01[0] + (c11[0] - c01[0]) * a, c01[1] + (c11[1] - c01[1]) * a, c01[2] + (c11[2] - c01[2]) * a];
        return [top[0] + (bot[0] - top[0]) * b, top[1] + (bot[1] - top[1]) * b, top[2] + (bot[2] - top[2]) * b];
      };
      const nx = Math.max(1, Math.min(GRID_MAX, Math.round(rw)));
      const ny = Math.max(1, Math.min(GRID_MAX, Math.round(rh)));
      for (let i = 1; i < nx; i += 1) { const a = i / nx; out.push(<Line key={`gv${i}`} a={proj(bilerp(a, 0))} b={proj(bilerp(a, 1))} color="#5fe0bf" thick={1.0} opacity={0.7} />); }
      for (let j = 1; j < ny; j += 1) { const b = j / ny; out.push(<Line key={`gh${j}`} a={proj(bilerp(0, b))} b={proj(bilerp(1, b))} color="#5fe0bf" thick={1.0} opacity={0.7} />); }
      // the cell under the cursor — outline it bright in the current paint colour, with
      // a filled dot at its centre so it's unmistakable where a dab will land.
      {
        const a0 = (hover.tx - rect.x0) / rw, a1 = (hover.tx + 1 - rect.x0) / rw;
        const b0 = (hover.ty - rect.y0) / rh, b1 = (hover.ty + 1 - rect.y0) / rh;
        const q = [bilerp(a0, b0), bilerp(a1, b0), bilerp(a1, b1), bilerp(a0, b1)].map(proj);
        for (let i = 0; i < 4; i += 1) out.push(<Line key={`hc${i}`} a={q[i]} b={q[(i + 1) % 4]} color={props.color} thick={2.6} />);
        const ctr = proj(bilerp((a0 + a1) / 2, (b0 + b1) / 2));
        if (ctr.front) out.push(<Box key="hcdot" style={{ position: 'absolute', left: ctr.x - 4, top: ctr.y - 4, width: 8, height: 8, borderRadius: 4, backgroundColor: props.color, borderWidth: 1, borderColor: '#0008' }} />);
      }
    }
  }
  }

  return <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'visible' }}>{out}</Box>;
}
