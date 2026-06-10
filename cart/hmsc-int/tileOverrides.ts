// tileOverrides.ts — per-cell property OVERRIDES, layered on top of a cell's tile
// kind WITHOUT changing the kind.
//
// A tile cell paints a KIND (grass, mud, …); the kind carries a full default
// profile (friction, walkable, cover, …) from tileKinds.ts. An override patches
// individual properties for one specific cell — e.g. "this patch of road has
// friction 0.2" — while the cell stays road. So you can select a mix of kinds and
// force one property across all of them; the underlying kinds are untouched.
//
// Storage is a flat map: global-cell key → { dotted-path → value }. Effective value
// at a cell = override[path] ?? kindDefault(path). Serialized as a small array in
// the map payload (see index.tsx); it's the "per-instance overrides" the mapStore
// header flagged as a later feature.

import type { TileKind } from './design';
import { tileKindDefinition } from './world/tileKinds';

// A selected cell: global cell coords (gx,gz across chunks) + the kind painted
// there (null = empty), captured at click time so the panel can show baselines.
export interface SelCell {
  gx: number;
  gz: number;
  kind: TileKind | null;
}

export type OverrideValue = number | boolean;
export type CellOverride = Record<string, OverrideValue>; // dotted path → value
export type OverrideStore = Map<string, CellOverride>;     // cellKey → patch

export const cellKey = (gx: number, gz: number): string => `${gx},${gz}`;

// The properties exposed for bulk override, grouped for the panel. Mirrors the
// gameplay-relevant scalars/bools of TileKindDefinition (paths are dotted into it).
export interface OverridableProp {
  path: string;
  label: string;
  ctl: 'scalar' | 'num' | 'bool';
  group: string;
  min?: number;
  max?: number;
  step?: number;
  viz?: 'opacity' | 'light';
}

export const OVERRIDABLE: OverridableProp[] = [
  { path: 'surface.friction', label: 'friction', ctl: 'scalar', group: 'SURFACE', min: 0, max: 1, step: 0.05 },
  { path: 'surface.lateralGrip', label: 'latGrip', ctl: 'scalar', group: 'SURFACE', min: 0, max: 1, step: 0.05 },
  { path: 'surface.restitution', label: 'restitution', ctl: 'scalar', group: 'SURFACE', min: 0, max: 1, step: 0.05 },
  { path: 'surface.walkSpeedMultiplier', label: 'walk×', ctl: 'num', group: 'SURFACE', min: 0, max: 4, step: 0.1 },
  { path: 'surface.runSpeedMultiplier', label: 'run×', ctl: 'num', group: 'SURFACE', min: 0, max: 4, step: 0.1 },
  { path: 'surface.vehicleSpeedMultiplier', label: 'veh×', ctl: 'num', group: 'SURFACE', min: 0, max: 4, step: 0.1 },
  { path: 'pathing.walkable', label: 'walkable', ctl: 'bool', group: 'PATHING' },
  { path: 'pathing.movementCost', label: 'moveCost', ctl: 'num', group: 'PATHING', min: 0, max: 10, step: 0.5 },
  { path: 'pathing.blocksLineOfSight', label: 'blocksLoS', ctl: 'bool', group: 'PATHING' },
  { path: 'cover.protection', label: 'protection', ctl: 'scalar', group: 'COVER', min: 0, max: 1, step: 0.05 },
  { path: 'cover.concealment', label: 'conceal', ctl: 'scalar', group: 'COVER', min: 0, max: 1, step: 0.05 },
  { path: 'visibility.opacity', label: 'opacity', ctl: 'scalar', group: 'VISIBILITY', min: 0, max: 1, step: 0.05, viz: 'opacity' },
  { path: 'visibility.lightTransmission', label: 'lightThru', ctl: 'scalar', group: 'VISIBILITY', min: 0, max: 1, step: 0.05, viz: 'light' },
];

export function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

// The kind's default value for a path (the baseline an override replaces).
export function defValue(kind: TileKind, path: string): OverrideValue | undefined {
  const v = getByPath(tileKindDefinition(kind), path);
  return typeof v === 'number' || typeof v === 'boolean' ? v : undefined;
}

// ── Serialize / deserialize (flat array in the map payload) ──────────────────

export interface OverrideSnap {
  c: string;            // cellKey "gx,gz"
  p: CellOverride;      // dotted path → value
}

export function serializeOverrides(store: OverrideStore): OverrideSnap[] {
  const out: OverrideSnap[] = [];
  for (const [c, p] of store) if (Object.keys(p).length) out.push({ c, p: { ...p } });
  return out;
}

export function deserializeOverrides(snaps: OverrideSnap[] | undefined): OverrideStore {
  const m: OverrideStore = new Map();
  for (const s of snaps ?? []) if (s && s.c && s.p) m.set(s.c, { ...s.p });
  return m;
}
