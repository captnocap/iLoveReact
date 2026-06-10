import type { Building, GameState, GridCell, Landform, WorldProp } from '../design';
import { buildingFootprint, buildingHeightMeters } from './buildings';
import { landformKindDef, landformSurfaceTop } from './landforms';
import { buildingKindDefinition } from './buildingKinds';
import { propFootprint, propTopMeters } from './props';
import { propKindDefinition } from './propKinds';
import { tileKindAtCell } from './grid';
import { tileKindDefinition } from './tileKinds';
import { nearestRoad, MAX_ROAD_DISTANCE_METERS } from './buildingPlacement';
import { HMSC_SCALE } from './scale';
import { rectsOverlap, rectGap, rectCenter, type Rect } from './rects';

// Placement sanity checks — the "did the AI place this somewhere stupid?" pass.
// Buildings already have hard placement RULES (world/buildingPlacement.ts rejects
// overlaps / on-road / too-sparse at place time). This module is the broader,
// non-blocking AUDIT: it reads a placed (or proposed) thing and calls out the
// problems an unattended/AI placement misses — the wrong tile under it, a footprint
// touching its neighbours, or a building so short it reads as a crate next to the
// ~2 m player. Pure + JSX-free (peer of buildingKinds/propKinds), so the console
// command and the place commands both run it.
//
// Every layer's thing is normalized to ONE PlacementSubject so the rules never
// branch on building-vs-prop; adding a new placeable layer = one more adapter.

export type PlacementSeverity = 'error' | 'warn' | 'info';

export type PlacementIssue = {
  severity: PlacementSeverity;
  code: string;
  message: string;
};

// The normalized view of anything placed in the world (building / prop / landform),
// flattened to the fields the rules actually read. `id` lets the rules skip the
// subject when scanning its neighbours; a dry-run preview passes a sentinel id that
// matches nothing in the world.
export type PlacementSubject = {
  layer: 'building' | 'prop' | 'landform';
  id: string;
  label: string;
  footprint: Rect;       // world meters
  heightMeters: number;
  solid: boolean;        // occupies space / collides (building, solid prop)
  enterable: boolean;    // a doorway the player must fit through (buildings only)
};

export function buildingSubject(b: Building): PlacementSubject {
  return {
    layer: 'building',
    id: b.id,
    label: b.label || buildingKindDefinition(b.kind).label,
    footprint: buildingFootprint(b),
    heightMeters: buildingHeightMeters(b),
    solid: true,
    enterable: b.enclosure === 'hollow' || b.enclosure === 'interior',
  };
}

export function propSubject(p: WorldProp): PlacementSubject {
  const def = propKindDefinition(p.kind);
  // Non-solid props (bushes) have no collision footprint; give them a nominal
  // square so spacing/tile checks still have an extent to sample.
  const fp = propFootprint(p);
  const r = Math.max(def.footprintRadiusMeters, 0.25);
  return {
    layer: 'prop',
    id: p.id,
    label: def.label,
    footprint: fp ?? { minX: p.x - r, minZ: p.z - r, maxX: p.x + r, maxZ: p.z + r },
    heightMeters: propTopMeters(p) - p.y,
    solid: def.solid,
    enterable: false,
  };
}

export function landformSubject(lf: Landform): PlacementSubject {
  const def = landformKindDef(lf.kind);
  const r = def ? def.footprintRadius(lf.params, lf.field) : 1;
  return {
    layer: 'landform',
    id: lf.id,
    label: lf.label,
    footprint: { minX: lf.centerX - r, minZ: lf.centerZ - r, maxX: lf.centerX + r, maxZ: lf.centerZ + r },
    heightMeters: landformSurfaceTop(lf, lf.centerX, lf.centerZ) - lf.baseY,
    solid: false,
    enterable: false,
  };
}

// The cells to sample for "what's under it": footprint center plus the four corners
// pulled half a tile inward (so a footprint flush against a road edge still reads
// the road). Deduped by cell key; placement always sits on floor y=0.
function sampleCells(f: Rect): GridCell[] {
  const c = rectCenter(f);
  const inset = 0.5;
  const points: Array<[number, number]> = [
    [c.x, c.z],
    [f.minX + inset, f.minZ + inset],
    [f.maxX - inset, f.minZ + inset],
    [f.minX + inset, f.maxZ - inset],
    [f.maxX - inset, f.maxZ - inset],
  ];
  const seen = new Set<string>();
  const cells: GridCell[] = [];
  for (const [x, z] of points) {
    const cell: GridCell = { x: Math.floor(x), y: 0, z: Math.floor(z) };
    const key = `${cell.x},${cell.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push(cell);
  }
  return cells;
}

// What surface a solid thing is standing on. A road/asphalt band under a building or
// a solid prop is the classic blind-placement bug ("dropped a house in the middle
// of the street"); water under anything means it's floating on the lake; no tile at
// all means it hangs over the void.
function tileUnderRule(state: GameState, subject: PlacementSubject): PlacementIssue[] {
  const issues: PlacementIssue[] = [];
  let anyGround = false;
  const roadCells: string[] = [];
  let onWater = false;
  for (const cell of sampleCells(subject.footprint)) {
    const kind = tileKindAtCell(state, cell);
    if (!kind) continue;
    anyGround = true;
    const surface = tileKindDefinition(kind).surface.material;
    if (surface === 'water') onWater = true;
    if (surface === 'road') roadCells.push(`${cell.x},${cell.z}`);
  }
  if (onWater) {
    issues.push({ severity: 'error', code: 'on-water', message: `${subject.label} sits on/over water — it'll float or sink.` });
  }
  if (!anyGround) {
    issues.push({ severity: 'warn', code: 'over-void', message: `${subject.label} has no ground tile under it — it hangs over the void (lay a surface first).` });
  }
  // Only flag the road for things that block the lane. A bush in the gutter is fine.
  if (subject.solid && roadCells.length > 0) {
    issues.push({
      severity: 'warn',
      code: 'on-road',
      message: `${subject.label} sits on a road tile (${roadCells.join(' ')}) — it blocks the driving lane. Move it onto the sidewalk/lot.`,
    });
  }
  return issues;
}

// Scale against the player. The ~2 m player is the fixed human anchor; a building
// shorter than that reads as a crate, and one that can't clear a doorway can't be
// walked into. Buildings only — a hydrant is SUPPOSED to be knee-high.
function scaleVsPlayerRule(_state: GameState, subject: PlacementSubject): PlacementIssue[] {
  if (subject.layer !== 'building') return [];
  const issues: PlacementIssue[] = [];
  const person = HMSC_SCALE.visualHumanMaxMeters; // ~2.0 m, the tall-person anchor
  const door = HMSC_SCALE.doorHeightMeters;       // 2.4 m doorway clearance
  const h = subject.heightMeters;
  if (subject.enterable && h < door) {
    issues.push({
      severity: 'error',
      code: 'too-short-to-enter',
      message: `${subject.label} is ${h.toFixed(1)} m tall but a doorway needs ${door.toFixed(1)} m — too short to walk into. Add a storey.`,
    });
  } else if (h < person + 0.1) {
    issues.push({
      severity: 'warn',
      code: 'shorter-than-player',
      message: `${subject.label} is only ${h.toFixed(1)} m tall — shorter than the ~${person.toFixed(1)} m player. It'll read as a crate, not a building.`,
    });
  }
  // A tall sliver on a tiny base looks like a pole, not a tower.
  const span = Math.min(subject.footprint.maxX - subject.footprint.minX, subject.footprint.maxZ - subject.footprint.minZ);
  if (span > 0 && span < 4 && h > span * 6) {
    issues.push({
      severity: 'info',
      code: 'thin-tower',
      message: `${subject.label} is ${h.toFixed(1)} m tall on a ${span.toFixed(1)} m base — a very thin sliver; widen the footprint or it looks like a pole.`,
    });
  }
  return issues;
}

// Footprint touching a neighbour. Solid things shouldn't interpenetrate (you'd
// clip through the seam); flush edge-to-edge is allowed (rectsOverlap is strict).
function overlapRule(state: GameState, subject: PlacementSubject): PlacementIssue[] {
  if (!subject.solid) return [];
  const issues: PlacementIssue[] = [];
  for (const p of state.world.props) {
    if (p.id === subject.id) continue;
    const def = propKindDefinition(p.kind);
    if (!def.solid) continue;
    const fp = propFootprint(p);
    if (fp && rectsOverlap(subject.footprint, fp)) {
      issues.push({ severity: 'warn', code: 'overlap-prop', message: `${subject.label} overlaps prop ${p.id} (${def.label}) — they're stacked on the same spot.` });
    }
  }
  return issues;
}

// Distance from the road network. A building marooned far from any street reads as
// sparse (the same MAX_ROAD_DISTANCE_METERS the placement policy enforces, surfaced
// as advice for forced/edited buildings). Props can be anywhere, so they're exempt.
function roadDistanceRule(state: GameState, subject: PlacementSubject): PlacementIssue[] {
  if (subject.layer !== 'building') return [];
  const near = nearestRoad(state.world, subject.footprint);
  if (!near) {
    return [{ severity: 'info', code: 'no-roads', message: `${subject.label}: the world has no roads yet, so "near a street" can't be checked.` }];
  }
  if (near.distance > MAX_ROAD_DISTANCE_METERS) {
    return [{
      severity: 'warn',
      code: 'far-from-road',
      message: `${subject.label} is ${near.distance.toFixed(1)} m from the nearest road (max ${MAX_ROAD_DISTANCE_METERS} m) — feels sparse, stranded off the street grid.`,
    }];
  }
  return [];
}

type PlacementRule = (state: GameState, subject: PlacementSubject) => PlacementIssue[];

const PLACEMENT_RULES: PlacementRule[] = [tileUnderRule, scaleVsPlayerRule, overlapRule, roadDistanceRule];

// Run every rule against a subject and collect the issues, errors first. The
// subject's own id is skipped by the neighbour-scanning rules, so this is safe to
// call AFTER the thing is placed (auto-warn) or on a not-yet-placed preview.
export function checkPlacement(state: GameState, subject: PlacementSubject): PlacementIssue[] {
  const order: Record<PlacementSeverity, number> = { error: 0, warn: 1, info: 2 };
  return PLACEMENT_RULES
    .flatMap((rule) => rule(state, subject))
    .sort((a, b) => order[a.severity] - order[b.severity]);
}

const SEVERITY_GLYPH: Record<PlacementSeverity, string> = { error: '✗', warn: '⚠', info: '·' };

// Console lines for a set of issues (one per line, glyph-prefixed). Empty in →
// empty out, so a clean placement adds no noise to the place command's output.
export function formatPlacementIssues(issues: PlacementIssue[]): string[] {
  return issues.map((issue) => `${SEVERITY_GLYPH[issue.severity]} ${issue.message}`);
}
