// editors/model/meshRig.tsx — the `rig` mode overlay (req_1025): a part's PIVOT
// (its rotation origin / upward connection — "here is where I connect, everything
// downstream follows the joint") + its JOINTS (typed sockets that own a spin
// `axis` + a rotation `limit` — "turn 90° forward, 90° back" / full for tires).
// Pure pick helper + a self-ticking 2D overlay projected through the SAME view the
// host renders with (like meshSelect/meshGizmo), so handles sit on the model and
// never hide behind geometry. Design: ../MESH_EDITOR_PLAYBOOK.md Part 6.

import { useInterval, useRerender } from '@reactjit/hooks';
import { Box, Text } from '@reactjit/primitives';
import { jointTravelDegrees, type EditMesh, type LightRig, type MountPoint, type V3 } from './editMesh';
import { anchorFacing, anchorRole, isAnchor } from './anchors';
import { makeProjector, type CameraSnap } from './meshSelect';

const DEG = Math.PI / 180;

/** which rig handle is selected: the part's one pivot, a joint by name, or — for an
 *  authored light (req_2063) — its TIP (move the light) or its AIM (point a spot).
 *  Lights ride the EXACT same handle machinery the pivot does: drag the tip to move
 *  it, drag the aim ball to aim it, instead of typing x/y/z. */
export type RigSel =
  | { kind: 'pivot' }
  | { kind: 'joint'; name: string }
  | { kind: 'lightTip'; id: string }
  | { kind: 'lightAim'; id: string };

/** One light's draggable handles in WORLD space (lift baked in). `aim` is null for
 *  an omni bulb (nothing to point). */
export type LightHandle = { id: string; kind: 'point' | 'spot'; color: string; tip: V3; aim: V3 | null };

const PIVOT_COLOR = '#ff8a3d';
const JOINT_COLOR = '#4aa3ff';
const ANCHOR_COLOR = '#3fd6c0'; // teal — a FIXED seat/anchor (req_1244), vs the blue rotating joint
const LIGHT_COLOR = '#ffd27d'; // warm — an authored light handle (req_2063)
const SEL_COLOR = '#ffd24a';
const AXIS_M = 0.18;   // how far the spin-axis arrow reaches, in meters
/** how far a spot's AIM handle floats from its tip, in world units (req_2063). The
 *  distance is cosmetic — only the tip→aim DIRECTION is read back as the light dir. */
export const AIM_LEN_M = 0.7;
const GRAB_PX = 16;    // screen-space pick radius around a handle

type Proj = (p: V3) => { x: number; y: number; depth: number; front: boolean };

/** Unit-length copy of v (or +Y if degenerate). */
function unit3(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Every light's WORLD-space handles (tip + aim) for a part at `lift` (req_2063). */
export function lightHandles(m: EditMesh, lift: number): LightHandle[] {
  return (m.lights ?? []).map((l) => {
    const tip: V3 = [l.position[0], l.position[1] + lift, l.position[2]];
    const aim: V3 | null = l.kind === 'spot'
      ? (() => { const d = unit3(l.dir ?? [0, -1, 0]); return [tip[0] + d[0] * AIM_LEN_M, tip[1] + d[1] * AIM_LEN_M, tip[2] + d[2] * AIM_LEN_M]; })()
      : null;
    return { id: l.id, kind: l.kind, color: l.color, tip, aim };
  });
}

/** World positions of every rig handle (the part `lift` already baked in) — the
 *  pick + the overlay share this so a handle and its hit-box never drift. A part
 *  with no pivot (a car body — pivots are opt-in, req_1054) passes `pivotLocal`
 *  null and gets no pivot handle. */
export function rigHandles(m: EditMesh, pivotLocal: V3 | null, lift: number): { pivot: V3 | null; joints: { name: string; pos: V3; mount: MountPoint }[] } {
  const pivot: V3 | null = pivotLocal ? [pivotLocal[0], pivotLocal[1] + lift, pivotLocal[2]] : null;
  const joints = (m.mounts ?? []).map((mt) => ({ name: mt.name, pos: [mt.position[0], mt.position[1] + lift, mt.position[2]] as V3, mount: mt }));
  return { pivot, joints };
}

/** Screen-space nearest rig handle under (cx,cy) — the pivot or a joint by name,
 *  or null (a miss → orbit). Nearest wins; the pivot (when present) is included
 *  like any handle. `pivotW` is null on a pivot-less part. */
export function pickRigHandle(pivotW: V3 | null, joints: { name: string; pos: V3 }[], lights: LightHandle[], proj: Proj, cx: number, cy: number): RigSel | null {
  let best: RigSel | null = null;
  let bestD = GRAB_PX;
  if (pivotW) { const p = proj(pivotW); if (p.front) { const d = Math.hypot(cx - p.x, cy - p.y); if (d < bestD) { bestD = d; best = { kind: 'pivot' }; } } }
  for (const j of joints) {
    const q = proj(j.pos);
    if (!q.front) continue;
    const d = Math.hypot(cx - q.x, cy - q.y);
    if (d < bestD) { bestD = d; best = { kind: 'joint', name: j.name }; }
  }
  // Light handles: the aim ball is checked first so it stays grabbable even when it
  // overlaps the tip at a steep angle (the tip is the bigger target behind it).
  for (const lt of lights) {
    if (lt.aim) {
      const a = proj(lt.aim);
      if (a.front) { const d = Math.hypot(cx - a.x, cy - a.y); if (d < bestD) { bestD = d; best = { kind: 'lightAim', id: lt.id }; } }
    }
    const t = proj(lt.tip);
    if (t.front) { const d = Math.hypot(cx - t.x, cy - t.y); if (d < bestD) { bestD = d; best = { kind: 'lightTip', id: lt.id }; } }
  }
  return best;
}

// ── overlay drawing ──────────────────────────────────────────────────────────

function Ball(props: { x: number; y: number; r: number; color: string; hollow?: boolean }) {
  return <Box style={{ position: 'absolute', left: props.x - props.r, top: props.y - props.r, width: props.r * 2, height: props.r * 2, borderRadius: props.r, backgroundColor: props.hollow ? '#0b1320cc' : props.color, borderWidth: 2, borderColor: props.color, pointerEvents: 'none' }} />;
}

// a FIXED-marker glyph (a hollow square) — reads as "doesn't rotate", vs Ball's
// round joint handle. Used for anchors (seats / cargo slots, req_1244).
function Square(props: { x: number; y: number; r: number; color: string }) {
  return <Box style={{ position: 'absolute', left: props.x - props.r, top: props.y - props.r, width: props.r * 2, height: props.r * 2, borderRadius: 2, backgroundColor: '#0b1320cc', borderWidth: 2, borderColor: props.color, pointerEvents: 'none' }} />;
}

function Line(props: { ax: number; ay: number; bx: number; by: number; color: string; thick?: number }) {
  const dx = props.bx - props.ax, dy = props.by - props.ay;
  const len = Math.hypot(dx, dy) || 0.001;
  const t = props.thick ?? 2;
  return <Box style={{ position: 'absolute', left: (props.ax + props.bx) / 2 - len / 2, top: (props.ay + props.by) / 2 - t / 2, width: len, height: t, borderRadius: t / 2, backgroundColor: props.color, transform: { rotate: Math.atan2(dy, dx) / DEG }, pointerEvents: 'none' }} />;
}

function Tag(props: { x: number; y: number; text: string; color: string }) {
  return (
    <Box style={{ position: 'absolute', left: props.x + 10, top: props.y - 8, paddingLeft: 5, paddingRight: 5, paddingTop: 1, paddingBottom: 1, borderRadius: 4, backgroundColor: '#0b1320e6', borderWidth: 1, borderColor: props.color, pointerEvents: 'none' }}>
      <Text fontSize={9} color={props.color} style={{ fontFamily: 'monospace', fontWeight: '700' }}>{props.text}</Text>
    </Box>
  );
}

/** The rig overlay: the pivot ball + every joint (ring + spin-axis arrow + a
 *  type·travel label). Self-ticks so it tracks the orbit without re-rendering the
 *  Scene3D tree (the SelectionOverlay/TransformGizmo idiom). `pivotW`/`joints`
 *  carry the live (draft-aware) world positions; the parent re-renders on drag. */
export function RigOverlay(props: { pivotW: V3 | null; joints: { name: string; pos: V3; mount: MountPoint }[]; lights?: LightHandle[]; sel: RigSel | null; camSnap: () => CameraSnap }) {
  const repaint = useRerender();
  useInterval(repaint, 33);
  const proj = makeProjector(props.camSnap());
  const out: any[] = [];

  // Authored lights (req_2063): a TIP handle (move the light) + for a spot an AIM
  // arrow ending in a draggable ball (point it). Drawn first so the pivot/joints
  // sit on top. The tip wears the light's own colour so you can tell them apart.
  for (const lt of props.lights ?? []) {
    const t = proj(lt.tip);
    if (!t.front) continue;
    const tipSel = props.sel?.kind === 'lightTip' && props.sel.id === lt.id;
    const aimSel = props.sel?.kind === 'lightAim' && props.sel.id === lt.id;
    if (lt.aim) {
      const a = proj(lt.aim);
      if (a.front) {
        out.push(<Line key={`la${lt.id}`} ax={t.x} ay={t.y} bx={a.x} by={a.y} color={aimSel ? SEL_COLOR : LIGHT_COLOR} thick={2} />);
        out.push(<Ball key={`lab${lt.id}`} x={a.x} y={a.y} r={aimSel ? 4 : 3} color={aimSel ? SEL_COLOR : LIGHT_COLOR} />);
      }
    }
    // tip: a ring in the light's colour (selected → amber), with a small filled core.
    out.push(<Ball key={`ltr${lt.id}`} x={t.x} y={t.y} r={6} color={tipSel ? SEL_COLOR : LIGHT_COLOR} hollow />);
    out.push(<Ball key={`ltc${lt.id}`} x={t.x} y={t.y} r={2.5} color={lt.color} />);
    if (tipSel || aimSel) out.push(<Tag key={`ll${lt.id}`} x={t.x} y={t.y} text={lt.kind === 'spot' ? 'light · drag tip / aim' : 'light'} color={SEL_COLOR} />);
  }

  // mounts first (so the pivot draws on top — it's the primary handle). Each is
  // selected via the shared name-addressed handle path (RigSel.kind 'joint'),
  // regardless of whether it's a rotating joint or a fixed anchor.
  for (const j of props.joints) {
    const a = proj(j.pos);
    if (!a.front) continue;
    const selected = props.sel?.kind === 'joint' && props.sel.name === j.name;
    const anchor = isAnchor(j.mount);
    const color = selected ? SEL_COLOR : (anchor ? ANCHOR_COLOR : JOINT_COLOR);
    // the direction arrow: a joint's SPIN axis, or an anchor's FACING. Both are
    // the mount's `axis`, drawn the same way — only the meaning (+ glyph) differ.
    const ax = anchor ? anchorFacing(j.mount) : (j.mount.axis ?? [0, 1, 0]);
    const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    const tip: V3 = [j.pos[0] + (ax[0] / al) * AXIS_M, j.pos[1] + (ax[1] / al) * AXIS_M, j.pos[2] + (ax[2] / al) * AXIS_M];
    const b = proj(tip);
    if (b.front) { out.push(<Line key={`ja${j.name}`} ax={a.x} ay={a.y} bx={b.x} by={b.y} color={color} thick={2.5} />); out.push(<Ball key={`jt${j.name}`} x={b.x} y={b.y} r={2.5} color={color} />); }
    // a fixed anchor reads as a SQUARE (doesn't rotate); a joint as a round ring.
    out.push(anchor
      ? <Square key={`jr${j.name}`} x={a.x} y={a.y} r={5} color={color} />
      : <Ball key={`jr${j.name}`} x={a.x} y={a.y} r={5} color={color} hollow />);
    // label by the PLACEMENT NAME (USER) — 'back_left' / 'driver' — with a quiet
    // suffix: the joint's travel, or the anchor's role, so the binding reads off
    // the model.
    const suffix = anchor ? anchorRole(j.mount) : (jointTravelDegrees(j.mount) >= 360 ? 'full' : `${Math.round(jointTravelDegrees(j.mount))}°`);
    out.push(<Tag key={`jl${j.name}`} x={a.x} y={a.y} text={`${j.name}  ·  ${suffix}`} color={color} />);
  }

  // the pivot — a filled ball + a crosshair so it reads as the rotation origin.
  // Absent on a pivot-less part (a car body is joints-only, req_1054).
  const p = props.pivotW ? proj(props.pivotW) : null;
  if (p && p.front) {
    const selected = props.sel?.kind === 'pivot';
    const color = selected ? SEL_COLOR : PIVOT_COLOR;
    out.push(<Line key="pvx" ax={p.x - 9} ay={p.y} bx={p.x + 9} by={p.y} color={color} thick={1.5} />);
    out.push(<Line key="pvy" ax={p.x} ay={p.y - 9} bx={p.x} by={p.y + 9} color={color} thick={1.5} />);
    out.push(<Ball key="pv" x={p.x} y={p.y} r={4} color={color} />);
    out.push(<Tag key="pvl" x={p.x} y={p.y} text="pivot" color={color} />); // always labeled
  }
  return <>{out}</>;
}
