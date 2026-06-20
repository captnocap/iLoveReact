// intersections.ts — INTERSECTION POLICY (INTERSECTIONS-0619, req_1480).
//
// Roads are authored as strokes; junctions are DERIVED (roadData.deriveJunctions)
// where carriageways cross. This module owns the one thing a human DOES author at
// a junction — its control type — and the deterministic signage that follows from
// it: a stop sign or traffic light on each arm, and a street-name sign printing
// the crossing roads' names.
//
//   • CONTROL TYPE is the only authored bit, keyed by the stable junctionKey
//     (the box's rounded center cell). Absent = the leg-count default.
//   • PROPS ARE DERIVED, not placed: planIntersectionProps is a pure function of
//     (junctions, controls, road names) → generated props, each with a stable id
//     `gen:{junctionKey}:{side}:{role}` so re-derivation maps old→new cleanly.
//   • MANUAL MOVES ARE HONORED (user ruling, req_1480: "if i want to move things
//     around u dont stop it"): reconcileGenerated overlays per-id pose overrides
//     onto the fresh set, so a dragged prop keeps its pose while its TEXT and KIND
//     still refresh (rename a road → its sign reprints; flip to signals → the stop
//     becomes a light, even where you moved it).
//
// Positions are emitted in GLOBAL-CELL space (the RoadPoint frame, float = a
// fractional cell), frame-agnostic — the editor converts to placement graph units.
// Yaw uses the runtime convention (trafficControl.controlApproach): a control
// faces BACK against the traffic it governs, so the existing right-of-way gate
// associates a generated stop/light to the correct approach with no runtime change.

import {
  carriagewayTiles, clampProfile, deriveJunctions, LANE_TILES,
  type ApproachDir, type AuthorJunction, type JunctionSide, type RoadStroke,
} from './roadData';

export { deriveJunctions, junctionKey, type AuthorJunction, type JunctionLeg } from './roadData';

// ── the authored bit: a junction's control type ──────────────────────────────

export type IntersectionControl = 'uncontrolled' | 'allWayStop' | 'signals';

export const INTERSECTION_CONTROL_LABEL: Record<IntersectionControl, string> = {
  uncontrolled: 'Uncontrolled',
  allWayStop: '4-way stop',
  signals: 'Signals',
};

/** Predictable default when a junction has no override: any real crossing (3+
 *  arms) gets a 4-way stop; degenerate 2-arm overlaps stay uncontrolled. The
 *  user flips to signals per junction. */
export function defaultControl(j: AuthorJunction): IntersectionControl {
  return j.legs.length >= 3 ? 'allWayStop' : 'uncontrolled';
}

/** The effective control for a junction (override else default). */
export function controlFor(j: AuthorJunction, controls: ReadonlyMap<string, IntersectionControl>): IntersectionControl {
  return controls.get(j.key) ?? defaultControl(j);
}

// ── the derived props ─────────────────────────────────────────────────────────

export type GeneratedRole = 'control' | 'sign';
export type GeneratedKind = 'stopSign' | 'trafficLight' | 'streetSign';

export interface GeneratedProp {
  /** stable id: gen:{junctionKey}:{side}:{role} */
  id: string;
  junctionKey: string;
  side: JunctionSide;
  role: GeneratedRole;
  kind: GeneratedKind;
  /** prop CENTER in global-cell space (the RoadPoint frame; float) */
  gx: number;
  gz: number;
  /** world yaw, degrees (controlApproach convention: faces back against traffic) */
  rotationDeg: number;
  /** per-instance street-sign text (the crossing road names, multi-line) */
  text?: string;
}

const APPROACH_VEC: Record<ApproachDir, { dx: number; dz: number }> = {
  posX: { dx: 1, dz: 0 }, negX: { dx: -1, dz: 0 },
  posZ: { dx: 0, dz: 1 }, negZ: { dx: 0, dz: -1 },
};

/** Tiles back from the box edge the control sits (before the crosswalk band). */
const BACK_TILES = 1;
/** Tiles out past the right-hand curb of the incoming carriageway. */
const CURB_TILES = 1;
/** The street-name sign sits this far beyond the control, same corner. */
const SIGN_GAP_TILES = 1;

const genId = (key: string, side: JunctionSide, role: GeneratedRole): string => `gen:${key}:${side}:${role}`;

/** Distinct, non-empty road names meeting at a junction (stable arm order). */
export function junctionRoadNames(j: AuthorJunction): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const leg of j.legs) {
    const n = leg.roadName?.trim();
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}

/** Every generated prop for the network: a control + a street sign on each arm
 *  of every junction (skipping the control on uncontrolled junctions, and the
 *  sign where no road is named). Pure. */
export function planIntersectionProps(
  junctions: readonly AuthorJunction[],
  controls: ReadonlyMap<string, IntersectionControl>,
  strokes: readonly RoadStroke[],
): GeneratedProp[] {
  const byId = new Map(strokes.map((s) => [s.id, s] as const));
  const out: GeneratedProp[] = [];
  for (const j of junctions) {
    if (j.legs.length === 0) continue;
    const ctrl = controlFor(j, controls);
    const signText = junctionRoadNames(j).join('\n') || undefined;
    for (const leg of j.legs) {
      const stroke = byId.get(leg.roadId);
      const halfCarriage = stroke ? carriagewayTiles(clampProfile(stroke.profile)) / 2 : LANE_TILES / 2;
      const a = APPROACH_VEC[leg.approach];
      const right = { dx: -a.dz, dz: a.dx }; // right hand of travel (right-hand traffic)
      // the right-hand corner just before the box on this arm
      const cornerGx = leg.gx + 0.5 - a.dx * BACK_TILES + right.dx * (halfCarriage + CURB_TILES);
      const cornerGz = leg.gz + 0.5 - a.dz * BACK_TILES + right.dz * (halfCarriage + CURB_TILES);
      const rotationDeg = Math.atan2(a.dx, a.dz) * 180 / Math.PI;
      if (ctrl !== 'uncontrolled') {
        out.push({
          id: genId(j.key, leg.side, 'control'), junctionKey: j.key, side: leg.side, role: 'control',
          kind: ctrl === 'signals' ? 'trafficLight' : 'stopSign',
          gx: cornerGx, gz: cornerGz, rotationDeg,
        });
      }
      if (signText) {
        out.push({
          id: genId(j.key, leg.side, 'sign'), junctionKey: j.key, side: leg.side, role: 'sign',
          kind: 'streetSign',
          gx: cornerGx + right.dx * SIGN_GAP_TILES, gz: cornerGz + right.dz * SIGN_GAP_TILES,
          rotationDeg, text: signText,
        });
      }
    }
  }
  return out;
}

// ── honoring manual moves ─────────────────────────────────────────────────────

export interface GenPoseOverride { gx: number; gz: number; rotationDeg: number; }

/** Overlay per-id manual poses onto the freshly-planned props. A dragged prop
 *  keeps its pose; its text/kind still come from `fresh`, so renaming a road or
 *  flipping the control type still updates a prop you moved. Overrides for props
 *  that no longer exist (junction deleted) simply find no match and drop. */
export function reconcileGenerated(
  fresh: readonly GeneratedProp[],
  overrides: ReadonlyMap<string, GenPoseOverride>,
): GeneratedProp[] {
  if (!overrides.size) return [...fresh];
  return fresh.map((p) => {
    const o = overrides.get(p.id);
    return o ? { ...p, gx: o.gx, gz: o.gz, rotationDeg: o.rotationDeg } : p;
  });
}

/** Prune pose overrides whose generated prop no longer exists (keeps the saved
 *  override map from accreting orphans across road edits). */
export function pruneOverrides(
  fresh: readonly GeneratedProp[],
  overrides: ReadonlyMap<string, GenPoseOverride>,
): Map<string, GenPoseOverride> {
  const live = new Set(fresh.map((p) => p.id));
  const out = new Map<string, GenPoseOverride>();
  for (const [id, o] of overrides) if (live.has(id)) out.set(id, o);
  return out;
}
