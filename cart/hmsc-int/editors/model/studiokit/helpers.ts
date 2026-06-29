// editors/model/studio/helpers.ts — Studio's pure, stateless helpers.
//
// Lifted VERBATIM from editors/model/Studio.tsx (req_1390): clamping, the
// gizmo-step snap, the units↔meters basis (16 units = 1 tile = 1 m), part
// placement, and the loop-cut axis resolution. No React, no behavior change —
// just relocated so they can be shared and unit-tested independently.

import { faceCentroid, faceNormal, facesWithTag, type EditMesh } from '../editMesh';
import { STUDIO } from './config';
import type { RigSel } from '../meshRig';

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Same rig handle? (the pivot is singular; joints compare by name.) */
export function sameRigSel(a: RigSel | null, b: RigSel | null): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'joint') return a.name === (b as { kind: 'joint'; name: string }).name;
  if (a.kind === 'lightTip' || a.kind === 'lightAim') return a.id === (b as { kind: 'lightTip' | 'lightAim'; id: string }).id;
  return true; // pivot — only one
}

/** A fresh joint name unique within the mesh: joint_1, joint_2, … (req_1025). */
export function nextJointName(mesh: EditMesh): string {
  const used = new Set((mesh.mounts ?? []).map((m) => m.name));
  for (let i = 1; ; i += 1) { const n = `joint_${i}`; if (!used.has(n)) return n; }
}

/** Snap a value to the gizmo step grid (req_1023): no modifier → `step`, Shift →
 *  `fine`, Alt → freeform (returned unchanged). Used by every gizmo drag so the
 *  default is stepped, never freeform. */
export function snapToStep(value: number, step: number, fine: number, mods: { shift: boolean; alt: boolean }): number {
  if (mods.alt) return value;
  const s = mods.shift ? fine : step;
  return s > 0 ? Math.round(value / s) * s : value;
}

/** modeling units → world meters: 16 units = 1 tile = tileMeters (req_0973). */
export function unitsToMeters(u: number): number {
  return (u * STUDIO.tileMeters) / STUDIO.unitsPerTile;
}
/** world meters → modeling units (the inverse — the gizmo readout speaks units). */
export function metersToUnits(m: number): number {
  return (m * STUDIO.unitsPerTile) / STUDIO.tileMeters;
}
/** a compact signed unit string for the drag readout: "+3u", "−2.5u", "+0u". */
export function fmtUnits(u: number): string {
  const r = Math.round(u * 100) / 100;
  const abs = Math.abs(r);
  const body = Number.isInteger(abs) ? abs.toFixed(0) : String(abs);
  return `${r < 0 ? '−' : '+'}${body}u`;
}

export function nowMs(): number {
  return (globalThis as any).performance?.now?.() ?? Date.now();
}

/** schedule one frame — host rAF if present, else a 16 ms timer (the cart V8
 *  host has no requestAnimationFrame, per reactjit_no_raf). */
export function schedFrame(fn: () => void): void {
  const h = globalThis as any;
  if (h.requestAnimationFrame) h.requestAnimationFrame(fn); else setTimeout(fn, 16);
}

/** Where a part rests: lift its lowest vert to y=0 (sits ON the grid), and its
 *  rendered vertical span. Parts authored centered at origin → lift by half. */
export function partPlacement(mesh: EditMesh): { lift: number; height: number } {
  let lo = Infinity, hi = -Infinity;
  for (const v of mesh.verts) { lo = Math.min(lo, v[1]); hi = Math.max(hi, v[1]); }
  if (!Number.isFinite(lo)) return { lift: 0, height: 0 };
  return { lift: -lo, height: hi - lo };
}

export type LoopCutAxis = { axis: 0 | 1 | 2; lo: number; hi: number; sizeMeters: number; sizeUnits: number; unitsPerMeter: number };

/** Resolve the loop-cut axis from the clicked face + direction. The cut SPLITS
 *  the selected face, so the axis is one of the face's two IN-PLANE axes (NOT its
 *  normal — cutting ⟂ the normal would slab toward the face and leave it whole).
 *  Direction 0/1 picks which in-plane axis, matching Blockbench (req_0990). */
export function loopCutAxisInfo(mesh: EditMesh, faceIndex: number, dir: 0 | 1): LoopCutAxis | null {
  const face = mesh.faces[faceIndex];
  if (!face) return null;
  const n = faceNormal(mesh, face);
  const na: 0 | 1 | 2 = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
  const inPlane = ([0, 1, 2] as (0 | 1 | 2)[]).filter((a) => a !== na); // the face's two edge axes
  const axis = inPlane[dir] ?? inPlane[0];
  // The span is the SELECTED FACE's extent on the cut axis — NOT the whole mesh —
  // so a cut on an already-cut half subdivides THAT half (req_1006). Using the
  // whole mesh placed the second cut at the first cut's plane → no visible change.
  let lo = Infinity, hi = -Infinity;
  for (const vi of face.loop) { const v = mesh.verts[vi]; if (v[axis] < lo) lo = v[axis]; if (v[axis] > hi) hi = v[axis]; }
  const unitsPerMeter = STUDIO.unitsPerTile / STUDIO.tileMeters;
  return { axis, lo, hi, sizeMeters: hi - lo, sizeUnits: (hi - lo) * unitsPerMeter, unitsPerMeter };
}

/** After a loop cut, the selected face has split into pieces all carrying tag 1;
 *  keep just ONE — the piece on the −axis (lo) side — so the selection halves
 *  with the face (and shrinks as offset rises) instead of re-covering it whole. */
export function lcKeptFace(cutMesh: EditMesh, axis: 0 | 1 | 2): number {
  const tagged = facesWithTag(cutMesh, 1);
  if (tagged.length <= 1) return tagged[0] ?? -1;
  let best = tagged[0], bestC = Infinity;
  for (const i of tagged) { const c = faceCentroid(cutMesh, cutMesh.faces[i])[axis]; if (c < bestC) { bestC = c; best = i; } }
  return best;
}
