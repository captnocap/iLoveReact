// editors/model/meshSelect.tsx — face / edge / vertex selection for the Studio
// (req_0970, playbook Part 4 #5). A PERSISTENT mode toggle (Blockbench-style,
// USER req_0970): pick Vertex / Edge / Face and it stays in that mode; each mode
// keeps its own selection set. Overlays are 2D but projected through the SAME
// view/projection the host renders with — camera.zig's orbit eye + gpu/3d.zig's
// `m4perspective`/`m4lookAt` — so the dots/lines sit exactly on the rendered mesh
// AND draw on top (you can pick back-facing elements, like Blockbench). Picking
// is screen-space nearest, run from the viewport's onMouseDown; shift = add/
// toggle, plain click = replace, empty click = clear.

import { useInterval, useRerender } from '@reactjit/hooks';
import { Box } from '@reactjit/primitives';
import { meshEdges, faceCentroid, type Edge, type EditMesh, type V3 } from './editMesh';

const DEG = Math.PI / 180;
const VERT_PX = 11; // click radius for vertex pick
const EDGE_PX = 8;  // click distance for edge pick

const C_SEL = '#ffa733';
const C_VERT = '#d7e2f0';
const C_EDGE = '#4a6a93';
const C_WIRE = '#324559';
const C_DOT = '#8fa6c0';

// 'rig' authors the part's pivot + joints (req_1025); it selects rig handles, not
// mesh elements, so the element machinery (pickElement/applyPick/SelectionOverlay)
// treats it like 'object' (a no-op) — the viewport runs a dedicated rig branch.
// 'paint' colours the atlas texels directly on the 3D faces (meshPaint.tsx); like
// 'rig' it selects no mesh element, so the element machinery treats it as a no-op
// and the viewport runs a dedicated paint branch.
export type SelMode = 'object' | 'vertex' | 'edge' | 'face' | 'rig' | 'paint';
export type Selection = { verts: Set<number>; edges: Set<number>; faces: Set<number> };
export function emptySelection(): Selection { return { verts: new Set(), edges: new Set(), faces: new Set() }; }
export function selectionCount(s: Selection, mode: SelMode): number {
  return mode === 'vertex' ? s.verts.size : mode === 'edge' ? s.edges.size : mode === 'face' ? s.faces.size : 0;
}

export type CameraSnap = { eye: V3; target: V3; fov: number; aspect: number; w: number; h: number; near: number };

/** camera.zig orbitalEye, in JS — the eye the host derives from yaw/pitch/dist. */
export function orbitalEyeJS(target: V3, yawDeg: number, pitchDeg: number, dist: number): V3 {
  const yaw = yawDeg * DEG, el = pitchDeg * DEG;
  const horiz = dist * Math.cos(el), height = dist * Math.sin(el);
  return [target[0] - Math.sin(yaw) * horiz, target[1] + height, target[2] - Math.cos(yaw) * horiz];
}

type Proj = { x: number; y: number; depth: number; front: boolean };

/** Replicates gpu/3d.zig: vp = m4perspective(fov,aspect,near,far)·m4lookAt(eye,
 *  target,+Y). Returns world→viewport-pixel projection (origin top-left). */
export function makeProjector(cam: CameraSnap): (p: V3) => Proj {
  const { eye, target } = cam;
  // m4lookAt: f = normalize(eye - target); s = up×f; u = f×s; up = (0,1,0).
  let fx = eye[0] - target[0], fy = eye[1] - target[1], fz = eye[2] - target[2];
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  let sx = fz, sy = 0, sz = -fx; // up×f with up=(0,1,0)
  const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
  const ux = fy * sz - fz * sy, uy = fz * sx - fx * sz, uz = fx * sy - fy * sx; // f×s
  const tS = -(sx * eye[0] + sy * eye[1] + sz * eye[2]);
  const tU = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  const tF = -(fx * eye[0] + fy * eye[1] + fz * eye[2]);
  const f = 1 / Math.tan((cam.fov * DEG) / 2);
  const { aspect, w, h, near } = cam;
  return (p: V3): Proj => {
    const ex = sx * p[0] + sy * p[1] + sz * p[2] + tS;
    const ey = ux * p[0] + uy * p[1] + uz * p[2] + tU;
    const ez = fx * p[0] + fy * p[1] + fz * p[2] + tF;
    const cw = -ez; // m4perspective row3 = [0,0,-1,0]
    if (cw <= near) return { x: 0, y: 0, depth: cw, front: false };
    const ndcx = ((f / aspect) * ex) / cw;
    const ndcy = (f * ey) / cw;
    return { x: (ndcx * 0.5 + 0.5) * w, y: (0.5 - ndcy * 0.5) * h, depth: cw, front: true };
  };
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function pointInPoly(px: number, py: number, pts: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Nearest element under (cx,cy) in viewport pixels. `proj` must already fold in
 *  the part's render lift. Returns the element index, or null on a miss. */
export function pickElement(mesh: EditMesh, mode: SelMode, proj: (p: V3) => Proj, edges: readonly Edge[], cx: number, cy: number): number | null {
  if (mode === 'vertex') {
    let best = -1, bestD = VERT_PX;
    for (let i = 0; i < mesh.verts.length; i += 1) {
      const q = proj(mesh.verts[i]);
      if (!q.front) continue;
      const d = Math.hypot(q.x - cx, q.y - cy);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best >= 0 ? best : null;
  }
  if (mode === 'edge') {
    let best = -1, bestD = EDGE_PX;
    for (let i = 0; i < edges.length; i += 1) {
      const a = proj(mesh.verts[edges[i][0]]), b = proj(mesh.verts[edges[i][1]]);
      if (!a.front || !b.front) continue;
      const d = segDist(cx, cy, a.x, a.y, b.x, b.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best >= 0 ? best : null;
  }
  if (mode === 'face') {
    let best = -1, bestDepth = Infinity;
    for (let i = 0; i < mesh.faces.length; i += 1) {
      const loop = mesh.faces[i].loop;
      const pts: { x: number; y: number }[] = [];
      let ok = true;
      for (const vi of loop) { const q = proj(mesh.verts[vi]); if (!q.front) { ok = false; break; } pts.push(q); }
      if (!ok || pts.length < 3) continue;
      if (pointInPoly(cx, cy, pts)) {
        const c = proj(faceCentroid(mesh, mesh.faces[i]));
        if (c.front && c.depth < bestDepth) { bestDepth = c.depth; best = i; }
      }
    }
    return best >= 0 ? best : null;
  }
  return null;
}

/** Fold a pick into the selection: shift toggles, plain click replaces, a miss
 *  (hit=null) clears the active set unless shift is held. Returns a new Selection. */
export function applyPick(sel: Selection, mode: SelMode, hit: number | null, shift: boolean): Selection {
  const key = mode === 'vertex' ? 'verts' : mode === 'edge' ? 'edges' : 'faces';
  const cur = new Set(sel[key as keyof Selection] as Set<number>);
  if (hit == null) { if (!shift) cur.clear(); }
  else if (shift) { if (cur.has(hit)) cur.delete(hit); else cur.add(hit); }
  else { cur.clear(); cur.add(hit); }
  return { ...sel, [key]: cur } as Selection;
}

// ── The overlay ──────────────────────────────────────────────────────────────

function Line(props: { ax: number; ay: number; bx: number; by: number; color: string; thick: number; opacity?: number }) {
  const dx = props.bx - props.ax, dy = props.by - props.ay;
  const len = Math.hypot(dx, dy) || 0.001;
  const angle = Math.atan2(dy, dx) / DEG;
  return <Box style={{ position: 'absolute', left: (props.ax + props.bx) / 2 - len / 2, top: (props.ay + props.by) / 2 - props.thick / 2, width: len, height: props.thick, borderRadius: props.thick / 2, backgroundColor: props.color, opacity: props.opacity ?? 1, transform: { rotate: angle } }} />;
}

function Dot(props: { x: number; y: number; r: number; color: string; ring?: boolean }) {
  return <Box style={{ position: 'absolute', left: props.x - props.r, top: props.y - props.r, width: props.r * 2, height: props.r * 2, borderRadius: props.r, backgroundColor: props.ring ? '#0b1320' : props.color, borderWidth: props.ring ? 2 : 0, borderColor: props.color }} />;
}

export function SelectionOverlay(props: {
  mesh: EditMesh;
  partLift: number;
  mode: SelMode;
  selection: Selection;
  camSnap: () => CameraSnap;
}) {
  // Self-tick so the overlay mirrors the host/ref-driven spin without the parent
  // re-rendering; isolated → never touches the Scene3D tree.
  const repaint = useRerender();
  useInterval(repaint, 33);
  if (props.mode === 'object') return null;

  const { mesh, mode, selection, partLift } = props;
  // Bake the part's render lift into the projector ONCE so EVERY projected element
  // — verts, edges, AND face-centroid dots — shares it. Adding the lift only to the
  // verts left the face dots projecting from un-lifted local space, putting them
  // half a model-height off (top-face dot at the model center, bottom-face dot a
  // half-height below the model) — req_1014. One lift point = the dots can't drift.
  const baseProj = makeProjector(props.camSnap());
  const proj = (p: V3): Proj => baseProj([p[0], p[1] + partLift, p[2]]);
  const P = mesh.verts.map((v) => proj(v));
  const edges = meshEdges(mesh);

  // which edges belong to a selected face (for the face-mode outline highlight)
  const selFaceEdges = new Set<string>();
  if (mode === 'face') {
    for (const fi of selection.faces) {
      const loop = mesh.faces[fi]?.loop ?? [];
      for (let i = 0; i < loop.length; i += 1) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        selFaceEdges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
      }
    }
  }

  const out: any[] = [];

  // wireframe edges (always — context), highlighted in edge mode / for selected faces
  edges.forEach((e, i) => {
    const a = P[e[0]], b = P[e[1]];
    if (!a.front || !b.front) return;
    const key = e[0] < e[1] ? `${e[0]}:${e[1]}` : `${e[1]}:${e[0]}`;
    const edgeSel = mode === 'edge' && selection.edges.has(i);
    const faceSel = mode === 'face' && selFaceEdges.has(key);
    const color = edgeSel || faceSel ? C_SEL : (mode === 'edge' ? C_EDGE : C_WIRE);
    const thick = edgeSel || faceSel ? 2.6 : 1.2;
    out.push(<Line key={`e${i}`} ax={a.x} ay={a.y} bx={b.x} by={b.y} color={color} thick={thick} opacity={edgeSel || faceSel ? 1 : 0.7} />);
  });

  if (mode === 'face') {
    mesh.faces.forEach((f, i) => {
      const c = proj(faceCentroid(mesh, f));
      if (!c.front) return;
      const on = selection.faces.has(i);
      out.push(<Dot key={`f${i}`} x={c.x} y={c.y} r={on ? 5.5 : 4} color={on ? C_SEL : C_DOT} ring={!on} />);
    });
  }

  if (mode === 'vertex') {
    P.forEach((q, i) => {
      if (!q.front) return;
      const on = selection.verts.has(i);
      out.push(<Dot key={`v${i}`} x={q.x} y={q.y} r={on ? 5.5 : 4} color={on ? C_SEL : C_VERT} ring={!on} />);
    });
  }

  // ISOLATE the overlay's many elements (one Line per edge + per-vert/face Dots) in
  // ONE full-fill container so they count as a SINGLE child of the viewport — NOT
  // hundreds of flattened direct siblings. A dense (loop-cut) mesh used to spill past
  // the layout MAX_CHILDREN=512 cap and EVICT the trailing siblings — the toolbars —
  // so "all my tools vanished after a cut" (req_1179/1180). `pointerEvents:'none'`
  // keeps picking/orbit reaching the viewport beneath; `overflow:'visible'` so lines
  // at the edges aren't clipped. (>512 elements now only drop a few wireframe lines
  // INSIDE the overlay — never the tools.)
  return <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'visible' }}>{out}</Box>;
}
