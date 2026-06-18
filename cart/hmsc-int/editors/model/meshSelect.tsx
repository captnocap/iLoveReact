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
import { Box, Boxxx, Graph, type BoxxxRect } from '@reactjit/primitives';
import { meshEdges, faceCentroid, faceNormal, type Edge, type EditMesh, type V3 } from './editMesh';

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

export function SelectionOverlay(props: {
  mesh: EditMesh;
  partLift: number;
  mode: SelMode;
  selection: Selection;
  camSnap: () => CameraSnap;
  /** HOST-OWNED DRAG (req_1270): during a gizmo drag the bench never re-renders,
   *  so `mesh` is frozen at the grab pose. When set, the live dragged mesh is read
   *  from this ref each self-tick instead, so the wireframe tracks the deforming
   *  mesh at 30Hz with zero parent renders. Topology is unchanged mid-drag, so the
   *  selection indices still map. Null between drags → fall back to `mesh`. */
  liveMeshRef?: { current: EditMesh | null };
}) {
  // Self-tick so the overlay mirrors the host/ref-driven spin without the parent
  // re-rendering; isolated → never touches the Scene3D tree.
  const repaint = useRerender();
  useInterval(repaint, 33);
  if (props.mode === 'object') return null;

  const { mode, selection, partLift } = props;
  const mesh = props.liveMeshRef?.current ?? props.mesh;
  // Bake the part's render lift into the projector ONCE so EVERY projected element
  // — verts, edges, AND face-centroid dots — shares it. Adding the lift only to the
  // verts left the face dots projecting from un-lifted local space, putting them
  // half a model-height off (top-face dot at the model center, bottom-face dot a
  // half-height below the model) — req_1014. One lift point = the dots can't drift.
  const snap = props.camSnap();
  const baseProj = makeProjector(snap);
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

  // BATCHED (req_1275): the wireframe used to be ONE <Box> per edge + per dot —
  // ~2000 reconciler nodes for a dense mesh, capped at MAX_CHILDREN=512 (only a
  // third of the wireframe drew) and melting fps (22fps/54ms) from laying out +
  // painting 512 absolute boxes every frame. Now it's a handful of BATCHED GPU
  // nodes: edges → <Graph.Polyline segments> (one instanced capsule per edge, in
  // ONE node — no cap, analytic AA), dots → ONE <Boxxx> (instanced rects). The
  // per-edge scatter that choked the frame is gone.
  // DEPTH CUE (req_1276): the 2D overlay has no depth test against the solid mesh,
  // so far-side edges draw at full strength on top of near ones — you can't tell
  // the face you're looking at from the back of the object. Fix: classify every
  // face as front- or back-FACING (its outward normal vs the eye), then DIM the
  // geometry that belongs only to back faces so the near side reads bright and the
  // far side recedes. An edge/vert is "front" if ANY adjacent/owning face faces the
  // camera (so silhouette edges stay crisp). Selected geometry always draws bright
  // (you want to see your selection through the model).
  const eye = snap.eye;
  const faceFront: boolean[] = new Array(mesh.faces.length);
  const frontVert: boolean[] = new Array(mesh.verts.length).fill(false);
  const edgeFront = new Map<string, boolean>();
  mesh.faces.forEach((f, i) => {
    const c = faceCentroid(mesh, f), n = faceNormal(mesh, f);
    // outward normal · (eye - centroid) > 0 ⇒ the face turns toward the camera.
    const front = n[0] * (eye[0] - c[0]) + n[1] * (eye[1] - (c[1] + partLift)) + n[2] * (eye[2] - c[2]) > 0;
    faceFront[i] = front;
    const loop = f.loop;
    for (let k = 0; k < loop.length; k += 1) {
      const va = loop[k], vb = loop[(k + 1) % loop.length];
      if (front) frontVert[va] = true;
      const key = va < vb ? `${va}:${vb}` : `${vb}:${va}`;
      edgeFront.set(key, (edgeFront.get(key) ?? false) || front);
    }
  });

  const frontWire: number[] = []; // edges on a camera-facing face — bright
  const backWire: number[] = [];  // edges only on far faces — dimmed/recede
  const selPts: number[] = [];    // selected edges / selected-face outline — always bright, on top
  edges.forEach((e, i) => {
    const a = P[e[0]], b = P[e[1]];
    if (!a.front || !b.front) return; // skip edges crossing behind the camera
    const key = e[0] < e[1] ? `${e[0]}:${e[1]}` : `${e[1]}:${e[0]}`;
    const sel = (mode === 'edge' && selection.edges.has(i)) || (mode === 'face' && selFaceEdges.has(key));
    if (sel) selPts.push(a.x, a.y, b.x, b.y);
    else (edgeFront.get(key) ? frontWire : backWire).push(a.x, a.y, b.x, b.y);
  });
  const base = mode === 'edge' ? C_EDGE : C_WIRE;
  const frontWireColor = base + 'e6'; // ~0.90 — the side you're looking at
  const backWireColor = base + '2b';  // ~0.17 — the far side, ghosted

  // Dots → one Boxxx batch. A ring (unselected) is a dark fill + colored border; a
  // selected dot is a solid fill. radius = half-size → a circle. Back-facing dots
  // fade the same way the wire does so they read as "behind".
  const dots: BoxxxRect[] = [];
  const pushDot = (x: number, y: number, on: boolean, color: string, front: boolean) => {
    const r = on ? 5.5 : 4;
    if (on) { dots.push({ x: x - r, y: y - r, w: r * 2, h: r * 2, radius: r, bg: color }); return; }
    const a = front ? 'ff' : '5e'; // back rings ~0.37
    dots.push({ x: x - r, y: y - r, w: r * 2, h: r * 2, radius: r, bg: '#0b1320' + (front ? 'ff' : 'a0'), border: color + a, borderW: 2 });
  };
  if (mode === 'face') {
    mesh.faces.forEach((f, i) => {
      const c = proj(faceCentroid(mesh, f));
      if (!c.front) return;
      const on = selection.faces.has(i);
      pushDot(c.x, c.y, on, on ? C_SEL : C_DOT, faceFront[i]);
    });
  } else if (mode === 'vertex') {
    P.forEach((q, i) => {
      if (!q.front) return;
      const on = selection.verts.has(i);
      pushDot(q.x, q.y, on, on ? C_SEL : C_VERT, frontVert[i]);
    });
  }

  // ONE full-fill container → the overlay is a SINGLE child of the viewport (never
  // spilling the layout MAX_CHILDREN=512 cap onto the toolbars, req_1179/1180).
  // The Graph wraps the polylines with an identity view (viewZoom 1, originTopLeft)
  // so `points` are plain viewport pixels — the same px makeProjector emits. Boxxx
  // paints relative to its own top-left, which (inset 0) is the viewport origin too.
  // Child order = paint order: back wire UNDER front wire UNDER the selection.
  // `pointerEvents:'none'` keeps picking/orbit reaching the viewport beneath.
  const w = snap.w, h = snap.h;
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'visible' }}>
      <Graph style={{ width: w, height: h }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
        {backWire.length ? <Graph.Polyline segments points={backWire} stroke={backWireColor} strokeWidth={1.0} /> : null}
        {frontWire.length ? <Graph.Polyline segments points={frontWire} stroke={frontWireColor} strokeWidth={1.3} /> : null}
        {selPts.length ? <Graph.Polyline segments points={selPts} stroke={C_SEL} strokeWidth={2.6} /> : null}
      </Graph>
      {dots.length ? <Boxxx boxes={dots} style={{ position: 'absolute', left: 0, top: 0, width: w, height: h }} /> : null}
    </Box>
  );
}
