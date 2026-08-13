// cart/editor/stage/penCurveModes.ts — curve interpretations for the pen tools (req_4324).
//
// The pen kit (runtime/paint/PenPathOverlay) stays curve-agnostic; the editor
// brings its curve kit (data/curves.ts) as pen MODES. Your clicks become control
// points and the mode says how they connect — preview and commit run the same
// interpret, so what you see is exactly the polyline that lands in the mesh:
//
//   SMOOTH — the spline passes through EVERY click (centripetal, cusp-proof).
//   ARC    — clicks consumed as a-b-c triples, each struck as a circular arc
//            through all three (arc3pt, chained; a leftover click continues
//            straight). Three clicks IS one arc.
//   HANG   — first and last clicks are the endpoints; a middle click sets how
//            far the chain sags below the chord. Click ABOVE the chord and the
//            same curve flips into an arch.
//
// Interpret functions work in overlay pixel space (y grows DOWN); the catenary
// solver thinks y-up, so HANG flips through and back.

import { arc3pt, catenary, curveThrough, type Vec2 } from '../data/curves';
import type { PenAnchor, PenCurveMode, PenPoint } from '@reactjit/runtime/paint';

export const PEN_CURVE_TUNING = {
  /** samples per spline segment in SMOOTH — dense enough for fair edges, under the pen's 64-point cap */
  smoothSamplesPerSegment: 12,
  /** samples per struck arc in ARC */
  arcSamples: 16,
  /** samples along a HANG chain */
  hangSamples: 32,
  /** default sag as a fraction of the span when only two points are clicked */
  hangDefaultSagRatio: 0.25,
} as const;

function asVec2(anchors: readonly PenAnchor[]): Vec2[] {
  return anchors.map((anchor) => ({ x: anchor.x, y: anchor.y }));
}

export function interpretSmooth(anchors: readonly PenAnchor[], closed: boolean): PenPoint[] {
  const points = asVec2(anchors);
  if (points.length < 2) return points;
  return curveThrough(points, { closed, samplesPerSegment: PEN_CURVE_TUNING.smoothSamplesPerSegment }) as PenPoint[];
}

/** a-b-c triples struck as arcs, chained: [P0 P1 P2] [P2 P3 P4] … — shared
 *  endpoints appear once. A single leftover point continues as a straight
 *  segment; a closed path returns to the first click along a straight seam. */
export function interpretArcChain(anchors: readonly PenAnchor[]): PenPoint[] {
  const points = asVec2(anchors);
  if (points.length < 3) return points;
  const out: PenPoint[] = [points[0]];
  let at = 0;
  while (at + 2 < points.length) {
    const arc = arc3pt(points[at], points[at + 1], points[at + 2], PEN_CURVE_TUNING.arcSamples);
    out.push(...arc.slice(1));
    at += 2;
  }
  if (at < points.length - 1) out.push(points[points.length - 1]);
  return out;
}

export function interpretHang(anchors: readonly PenAnchor[]): PenPoint[] {
  const points = asVec2(anchors);
  if (points.length < 2) return points;
  const from = points[0], to = points[points.length - 1];
  const span = Math.abs(to.x - from.x);
  // middle clicks vote on the sag: screen-space vertical drop below the chord
  // (positive = below = hanging; a click above the chord flips it into an arch)
  let sag = 0;
  for (let i = 1; i + 1 < points.length; i += 1) {
    const p = points[i];
    const t = span < 1e-6 ? 0.5 : (p.x - from.x) / (to.x - from.x);
    const chordY = from.y + (to.y - from.y) * t;
    if (Math.abs(p.y - chordY) > Math.abs(sag)) sag = p.y - chordY;
  }
  if (sag === 0) sag = span * PEN_CURVE_TUNING.hangDefaultSagRatio;
  // pixel space is y-down; the catenary solver is y-up — flip through and back
  const hung = catenary({ x: from.x, y: -from.y }, { x: to.x, y: -to.y }, sag, PEN_CURVE_TUNING.hangSamples);
  return hung.map((p) => ({ x: p.x, y: -p.y }));
}

/** The mode set both mesh pen tools (Path Plane, Pen Edges) receive. */
export const PEN_CURVE_MODES: readonly PenCurveMode[] = [
  { id: 'smooth', label: 'SMOOTH', interpret: interpretSmooth },
  { id: 'arc', label: 'ARC', interpret: interpretArcChain },
  { id: 'hang', label: 'HANG', interpret: interpretHang },
];
