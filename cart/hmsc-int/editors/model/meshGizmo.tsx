// editors/model/meshGizmo.tsx — the transform GIZMO (req_0983). The Blockbench
// move / resize tool: red/green/blue (X/Y/Z) handles anchored on the selection;
// you PULL a handle in its axis direction to move (arrows) or resize (squares)
// the selected element(s). The anchor is the selection's "best center" — the
// vertex itself / the edge midpoint / the face center, or the centroid of a
// multi-select. CRITICAL (USER): the arrows are NEVER hidden by geometry — this
// is a 2D overlay projected through the SAME view the host renders with (the
// meshSelect projector) and drawn as the viewport's LAST children, so it always
// sits on top, exactly like the selection overlay it rides beside.
//
// Pure helpers (hit-test + the screen-drag→world mapping) live here so the
// viewport's mouse handlers stay thin; the visual is a self-ticking overlay.

import { useInterval, useRerender } from '@reactjit/hooks';
import { Box } from '@reactjit/primitives';
import { facesUsingEdges, facesUsingVerts, meshEdges, type EditMesh, type V3 } from './editMesh';
import { makeProjector, type CameraSnap, type SelMode, type Selection } from './meshSelect';

const DEG = Math.PI / 180;

export type GizmoTool = 'move' | 'resize' | 'rotate';
export type GizmoAxis = 0 | 1 | 2;
/** a grabbed handle: an axis (+ which end), or the uniform center hub (resize).
 *  `dir` (req_1193) overrides the world axis with an arbitrary unit direction — the
 *  extrude-DEPTH handle drags along a face's NORMAL so you sink straight into an
 *  angled face (a tire) without cutting through. */
export type GizmoHit = { axis: GizmoAxis; sign: 1 | -1; uniform: boolean; dir?: V3 };

const ROTATE_RING_STEPS = 40; // segments per rotate ring

export const AXIS_DIR: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
export const AXIS_COLOR = ['#e0584e', '#5ec26a', '#4aa3ff'];

// fixed SCREEN sizes — the gizmo is zoom-independent (a constant handle size at
// any orbit distance), like Blockbench. P2-style named, no inline magic.
export const GIZMO = {
  armPx: 48,        // axis arm length, screen px
  headPx: 9,        // arrowhead reach / square handle half-size
  centerPx: 6,      // center hub radius
  grabPx: 14,       // click radius around a handle / along a shaft
  shaftThick: 2.5,
} as const;

// ── selection → the verts it moves + the anchor ───────────────────────────────

/** The vert indices a selection drives: the verts themselves (vertex mode), both
 *  endpoints of each selected edge, or every loop vert of each selected face. */
export function selectionVertIndices(m: EditMesh, mode: SelMode, sel: Selection): number[] {
  const out = new Set<number>();
  if (mode === 'vertex') { for (const v of sel.verts) out.add(v); }
  else if (mode === 'edge') { const E = meshEdges(m); for (const ei of sel.edges) { const e = E[ei]; if (e) { out.add(e[0]); out.add(e[1]); } } }
  else if (mode === 'face') { for (const fi of sel.faces) { const f = m.faces[fi]; if (f) for (const vi of f.loop) out.add(vi); } }
  return [...out];
}

/** Resolve the current selection to the FACE indices a Delete should remove
 *  (req_1020): face mode → the selected faces; vertex/edge mode → every face that
 *  USES a selected vertex/edge (Blockbench's "delete the connected faces"). */
export function selectionFaceIndices(m: EditMesh, mode: SelMode, sel: Selection): number[] {
  if (mode === 'face') return [...sel.faces].filter((i) => m.faces[i]);
  if (mode === 'vertex') return facesUsingVerts(m, sel.verts);
  if (mode === 'edge') {
    const E = meshEdges(m);
    const edges = [...sel.edges].map((ei) => E[ei]).filter(Boolean);
    return facesUsingEdges(m, edges);
  }
  return [];
}

type Proj = (p: V3) => { x: number; y: number; depth: number; front: boolean };

/** A world axis at the anchor, in screen space: the 2D unit direction + how many
 *  screen px one world unit spans there (for the drag→world mapping). */
export function axisScreen(anchorW: V3, u: V3, proj: Proj): { ax: number; ay: number; dx: number; dy: number; pxPerUnit: number; front: boolean } {
  const eps = 0.01;
  const a = proj(anchorW);
  const b = proj([anchorW[0] + u[0] * eps, anchorW[1] + u[1] * eps, anchorW[2] + u[2] * eps]);
  const vx = b.x - a.x, vy = b.y - a.y;
  const lenPerEps = Math.hypot(vx, vy);
  const pxPerUnit = lenPerEps / eps;
  const inv = lenPerEps > 1e-4 ? 1 / lenPerEps : 0;
  return { ax: a.x, ay: a.y, dx: vx * inv, dy: vy * inv, pxPerUnit, front: a.front && b.front };
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ── Rotate rings (req_1057) ──────────────────────────────────────────────────
// One world circle per axis (in the plane perpendicular to that axis), sized so it
// reads ~armPx on screen. Drag a ring to spin the selection about its axis.

/** World radius that projects to ~armPx at the anchor (gizmo stays screen-sized). */
function ringRadiusWorld(anchorW: V3, proj: Proj): number {
  for (const ax of AXIS_DIR) { const s = axisScreen(anchorW, ax, proj); if (s.pxPerUnit > 1e-4) return GIZMO.armPx / s.pxPerUnit; }
  return 0;
}

/** A point on the `axis` ring at parameter `t` (radians), in world space. */
function ringPointWorld(anchorW: V3, axis: GizmoAxis, R: number, t: number): V3 {
  const c = Math.cos(t) * R, s = Math.sin(t) * R;
  if (axis === 0) return [anchorW[0], anchorW[1] + c, anchorW[2] + s]; // about X → (y,z)
  if (axis === 1) return [anchorW[0] + c, anchorW[1], anchorW[2] + s]; // about Y → (x,z)
  return [anchorW[0] + c, anchorW[1] + s, anchorW[2]];                 // about Z → (x,y)
}

/** The `axis` ring projected to screen points (with front flags). */
export function ringScreen(anchorW: V3, axis: GizmoAxis, R: number, proj: Proj, steps = ROTATE_RING_STEPS): { x: number; y: number; front: boolean }[] {
  const out: { x: number; y: number; front: boolean }[] = [];
  for (let k = 0; k < steps; k += 1) { const p = proj(ringPointWorld(anchorW, axis, R, (k / steps) * Math.PI * 2)); out.push({ x: p.x, y: p.y, front: p.front }); }
  return out;
}

/** Signed area of a projected ring — its screen winding sign maps a screen-angle
 *  drag to a world-angle direction (no camera view-dir needed). */
export function ringSignedArea(pts: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}

/** Sign (+1/−1) mapping a screen-angle delta about the anchor to a world rotation
 *  about `axis` — frozen at drag start so the spin direction stays stable. */
export function rotationSign(anchorW: V3, axis: GizmoAxis, proj: Proj): number {
  const R = ringRadiusWorld(anchorW, proj);
  if (R <= 0) return 1;
  return Math.sign(ringSignedArea(ringScreen(anchorW, axis, R, proj))) || 1;
}

/** Hit-test the gizmo handles at (cx,cy). Rotate → nearest ring; else center hub
 *  (resize → uniform) then each axis arm (tip OR shaft). null = a miss. */
export function pickGizmoHandle(anchorW: V3, tool: GizmoTool, proj: Proj, cx: number, cy: number): GizmoHit | null {
  const a = proj(anchorW);
  if (!a.front) return null;
  if (tool === 'rotate') {
    const R = ringRadiusWorld(anchorW, proj);
    if (R <= 0) return null;
    let best: GizmoHit | null = null;
    let bestD = GIZMO.grabPx;
    for (let axis = 0; axis < 3; axis += 1) {
      const pts = ringScreen(anchorW, axis as GizmoAxis, R, proj);
      let d = Infinity;
      for (let i = 0; i < pts.length; i += 1) { const p = pts[i], q = pts[(i + 1) % pts.length]; if (!p.front && !q.front) continue; d = Math.min(d, segDist(cx, cy, p.x, p.y, q.x, q.y)); }
      if (d < bestD) { bestD = d; best = { axis: axis as GizmoAxis, sign: 1, uniform: false }; }
    }
    return best;
  }
  if (tool === 'resize' && Math.hypot(cx - a.x, cy - a.y) <= GIZMO.centerPx + 4) {
    return { axis: 0, sign: 1, uniform: true };
  }
  let best: GizmoHit | null = null;
  let bestD = GIZMO.grabPx;
  for (let axis = 0; axis < 3; axis += 1) {
    const s = axisScreen(anchorW, AXIS_DIR[axis], proj);
    if (!s.front || s.pxPerUnit <= 0) continue;
    const signs: (1 | -1)[] = tool === 'resize' ? [1, -1] : [1];
    for (const sign of signs) {
      const hx = s.ax + s.dx * GIZMO.armPx * sign;
      const hy = s.ay + s.dy * GIZMO.armPx * sign;
      const d = Math.min(Math.hypot(cx - hx, cy - hy), segDist(cx, cy, s.ax, s.ay, hx, hy));
      if (d < bestD) { bestD = d; best = { axis: axis as GizmoAxis, sign, uniform: false }; }
    }
  }
  return best;
}

/** Screen-drag → signed world distance along the axis grabbed at drag start.
 *  Project the cursor delta onto the start-frozen axis screen direction, divide
 *  by the px-per-unit at the start (so perspective at the anchor is honored). */
export function dragWorldDistance(startAxis: { dx: number; dy: number; pxPerUnit: number }, dcx: number, dcy: number): number {
  if (startAxis.pxPerUnit <= 0) return 0;
  const along = dcx * startAxis.dx + dcy * startAxis.dy;
  return along / startAxis.pxPerUnit;
}

// ── Extrude-depth (normal) handle (req_1193) ─────────────────────────────────────
// A single double-ended arrow along a face's NORMAL: pull OUT to extrude the face,
// push IN to inset / cut a recess — straight along the surface even when it's angled
// (a tire sidewall), so you sink a groove without punching through the far side. The
// drag reuses the move math (dragWorldDistance + the frozen axis frame), just with
// the normal as the direction instead of a world axis.

const NORMAL_COLOR = '#ff8a3d'; // the face-highlight orange — distinct from X/Y/Z.

/** True if (cx,cy) grabs the normal-depth arrow (either end) at `anchorW`. */
export function pickNormalHandle(anchorW: V3, dir: V3, proj: Proj, cx: number, cy: number): boolean {
  const s = axisScreen(anchorW, dir, proj);
  if (!s.front || s.pxPerUnit <= 0) return false;
  for (const sign of [1, -1]) {
    const hx = s.ax + s.dx * GIZMO.armPx * sign, hy = s.ay + s.dy * GIZMO.armPx * sign;
    if (Math.min(Math.hypot(cx - hx, cy - hy), segDist(cx, cy, s.ax, s.ay, hx, hy)) <= GIZMO.grabPx) return true;
  }
  return false;
}

/** The normal-depth arrow overlay (self-ticking, drawn over the gizmo). */
export function NormalHandle(props: { anchorW: V3; dir: V3; camSnap: () => CameraSnap; active?: boolean }) {
  const repaint = useRerender();
  useInterval(repaint, 33);
  const proj = makeProjector(props.camSnap());
  const s = axisScreen(props.anchorW, props.dir, proj);
  if (!s.front || s.pxPerUnit <= 0) return null;
  const c = props.active ? '#ffd24a' : NORMAL_COLOR;
  const out: any[] = [];
  for (const sign of [1, -1] as const) {
    const hx = s.ax + s.dx * GIZMO.armPx * sign, hy = s.ay + s.dy * GIZMO.armPx * sign;
    out.push(<Arm key={`narm${sign}`} ax={s.ax} ay={s.ay} bx={hx} by={hy} color={c} />);
    out.push(<ArrowHead key={`nhd${sign}`} x={hx} y={hy} dx={s.dx * sign} dy={s.dy * sign} color={c} />);
  }
  return <>{out}</>;
}

// ── The overlay ────────────────────────────────────────────────────────────────

function Arm(props: { ax: number; ay: number; bx: number; by: number; color: string }) {
  const dx = props.bx - props.ax, dy = props.by - props.ay;
  const len = Math.hypot(dx, dy) || 0.001;
  const angle = Math.atan2(dy, dx) / DEG;
  return <Box style={{ position: 'absolute', left: (props.ax + props.bx) / 2 - len / 2, top: (props.ay + props.by) / 2 - GIZMO.shaftThick / 2, width: len, height: GIZMO.shaftThick, borderRadius: GIZMO.shaftThick / 2, backgroundColor: props.color, transform: { rotate: angle }, pointerEvents: 'none' }} />;
}

/** An arrowhead at the tip — a chevron of two short lines opening back along the
 *  axis, so MOVE reads as an arrow (vs RESIZE's square). */
function ArrowHead(props: { x: number; y: number; dx: number; dy: number; color: string }) {
  const base = Math.atan2(props.dy, props.dx);
  const wing = 26 * DEG;
  const L = GIZMO.headPx + 3;
  const mk = (a: number, k: string) => {
    const ex = props.x - Math.cos(a) * L, ey = props.y - Math.sin(a) * L;
    return <Arm key={k} ax={props.x} ay={props.y} bx={ex} by={ey} color={props.color} />;
  };
  return <>{mk(base - wing, 'l')}{mk(base + wing, 'r')}</>;
}

function Square(props: { x: number; y: number; color: string }) {
  const s = GIZMO.headPx;
  return <Box style={{ position: 'absolute', left: props.x - s, top: props.y - s, width: s * 2, height: s * 2, borderRadius: 2, backgroundColor: props.color, borderWidth: 1, borderColor: '#0b1320', pointerEvents: 'none' }} />;
}

export function TransformGizmo(props: { anchorW: V3; tool: GizmoTool; camSnap: () => CameraSnap; activeAxis?: GizmoHit | null }) {
  // self-tick so the gizmo mirrors the host/ref-driven spin without re-rendering
  // the parent (and thus the Scene3D tree), exactly like SelectionOverlay.
  const repaint = useRerender();
  useInterval(repaint, 33);

  const proj = makeProjector(props.camSnap());
  const a = proj(props.anchorW);
  if (!a.front) return null;

  const out: any[] = [];
  // ROTATE: three axis rings (a Line per ring segment); the active axis glows.
  if (props.tool === 'rotate') {
    const R = ringRadiusWorld(props.anchorW, proj);
    if (R > 0) {
      for (let axis = 0; axis < 3; axis += 1) {
        const active = props.activeAxis && props.activeAxis.axis === axis;
        const c = active ? '#ffd24a' : AXIS_COLOR[axis];
        const pts = ringScreen(props.anchorW, axis as GizmoAxis, R, proj);
        for (let i = 0; i < pts.length; i += 1) {
          const p = pts[i], q = pts[(i + 1) % pts.length];
          if (!p.front || !q.front) continue; // hide the back half (depth read)
          out.push(<Arm key={`ring${axis}.${i}`} ax={p.x} ay={p.y} bx={q.x} by={q.y} color={c} />);
        }
      }
    }
    out.push(<Box key="rhub" style={{ position: 'absolute', left: a.x - 3, top: a.y - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#cfe2ff', pointerEvents: 'none' }} />);
    return <>{out}</>;
  }
  for (let axis = 0; axis < 3; axis += 1) {
    const s = axisScreen(props.anchorW, AXIS_DIR[axis], proj);
    if (!s.front || s.pxPerUnit <= 0) continue;
    const color = AXIS_COLOR[axis];
    const signs: (1 | -1)[] = props.tool === 'resize' ? [1, -1] : [1];
    for (const sign of signs) {
      const active = props.activeAxis && !props.activeAxis.uniform && props.activeAxis.axis === axis;
      const c = active ? '#ffd24a' : color;
      const hx = s.ax + s.dx * GIZMO.armPx * sign;
      const hy = s.ay + s.dy * GIZMO.armPx * sign;
      out.push(<Arm key={`arm${axis}.${sign}`} ax={s.ax} ay={s.ay} bx={hx} by={hy} color={c} />);
      if (props.tool === 'move') out.push(<ArrowHead key={`hd${axis}`} x={hx} y={hy} dx={s.dx} dy={s.dy} color={c} />);
      else out.push(<Square key={`sq${axis}.${sign}`} x={hx} y={hy} color={c} />);
    }
  }
  // center hub — a solid ball in resize (the uniform handle), a hollow ring in move.
  const uActive = props.activeAxis?.uniform;
  out.push(
    <Box
      key="hub"
      style={{ position: 'absolute', left: a.x - GIZMO.centerPx, top: a.y - GIZMO.centerPx, width: GIZMO.centerPx * 2, height: GIZMO.centerPx * 2, borderRadius: GIZMO.centerPx, backgroundColor: props.tool === 'resize' ? (uActive ? '#ffd24a' : '#bfe6ee') : '#0b1320', borderWidth: 2, borderColor: uActive ? '#ffd24a' : '#cfe2ff', pointerEvents: 'none' }}
    />,
  );
  return <>{out}</>;
}
