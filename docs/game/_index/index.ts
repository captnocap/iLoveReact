// docs/game/_index — aggregate over all 38 DocIndex records + query helpers.
//
// Usage (from a cart, a script under tools/v8cli, or just by reading):
//   import { byPurpose, byStatus, hazardsBySeverity } from 'docs/game/_index';
//   byPurpose('camera')        → every camera-ish named thing across the corpus
//   byStatus('dormant')        → everything fully written but wired to nothing
//   hazardsBySeverity('high')  → the stuff that misleads agents into wrong code
//
// Records are extracted from the docs/game/*.md audit corpus (docs taken at
// face value; the docs themselves were source-verified at write time).

import type {
  DocIndex, InterfaceRecord, PatternRecord, HazardRecord,
  Purpose, SymbolKind, InterfaceStatus, PatternStatus, HazardSeverity,
} from './types';

import { animationDsl } from './records/animationDsl';
import { animation_lab } from './records/animation_lab';
import { bake_geometry } from './records/bake_geometry';
import { billboard_demo } from './records/billboard_demo';
import { bodylab } from './records/bodylab';
import { boxxx_demo } from './records/boxxx_demo';
import { camera_lab } from './records/camera_lab';
import { carve_lab } from './records/carve_lab';
import { combat_lab } from './records/combat_lab';
import { composer } from './records/composer';
import { cutout } from './records/cutout';
import { effect_fills } from './records/effect_fills';
import { game_item_gallery } from './records/game_item_gallery';
import { game_activities } from './records/game_activities';
import { game_animation } from './records/game_animation';
import { game_cutscene } from './records/game_cutscene';
import { game_missions } from './records/game_missions';
import { game_world } from './records/game_world';
import { geometry_demo } from './records/geometry_demo';
import { head_lab } from './records/head_lab';
import { hmsc } from './records/hmsc';
import { hmsc_int } from './records/hmsc_int';
import { hmsc_massive_map_lab } from './records/hmsc_massive_map_lab';
import { hmsc_scale_lab } from './records/hmsc_scale_lab';
import { input_bench } from './records/input_bench';
import { pathing_lab } from './records/pathing_lab';
import { physics3d } from './records/physics3d';
import { physics_lab } from './records/physics_lab';
import { pixel_icon_demo } from './records/pixel_icon_demo';
import { pixel_icon_gallery } from './records/pixel_icon_gallery';
import { planet_run } from './records/planet_run';
import { ragdoll_lab } from './records/ragdoll_lab';
import { render_perf_lab } from './records/render_perf_lab';
import { scape } from './records/scape';
import { shitcoin } from './records/shitcoin';
import { skybox_demo } from './records/skybox_demo';
import { vehicle_lab } from './records/vehicle_lab';
import { voxel_stack_demo } from './records/voxel_stack_demo';

export type {
  DocIndex, InterfaceRecord, PatternRecord, HazardRecord,
  Purpose, SymbolKind, InterfaceStatus, PatternStatus, HazardSeverity,
};

export const ALL_DOCS: DocIndex[] = [
  animationDsl, animation_lab, bake_geometry, billboard_demo, bodylab,
  boxxx_demo, camera_lab, carve_lab, combat_lab, composer, cutout,
  effect_fills, game_item_gallery, game_activities, game_animation, game_cutscene, game_missions, game_world, geometry_demo, head_lab, hmsc, hmsc_int,
  hmsc_massive_map_lab, hmsc_scale_lab, input_bench, pathing_lab, physics3d,
  physics_lab, pixel_icon_demo, pixel_icon_gallery, planet_run, ragdoll_lab,
  render_perf_lab, scape, shitcoin, skybox_demo, vehicle_lab, voxel_stack_demo,
];

// ── flattened views (each row carries its owning doc) ───────────────────────

export type OwnedInterface = InterfaceRecord & { doc: string };
export type OwnedPattern = PatternRecord & { doc: string };
export type OwnedHazard = HazardRecord & { doc: string };

export const ALL_INTERFACES: OwnedInterface[] = ALL_DOCS.flatMap(
  (d) => d.interfaces.map((i) => ({ ...i, doc: d.name })),
);
export const ALL_PATTERNS: OwnedPattern[] = ALL_DOCS.flatMap(
  (d) => d.patterns.map((p) => ({ ...p, doc: d.name })),
);
export const ALL_HAZARDS: OwnedHazard[] = ALL_DOCS.flatMap(
  (d) => d.hazards.map((h) => ({ ...h, doc: d.name })),
);

// ── queries ──────────────────────────────────────────────────────────────────

/** Every named interface tagged with this purpose, across the corpus. */
export function byPurpose(p: Purpose): OwnedInterface[] {
  return ALL_INTERFACES.filter((i) => i.purpose.includes(p));
}

export function byKind(k: SymbolKind): OwnedInterface[] {
  return ALL_INTERFACES.filter((i) => i.kind === k);
}

/** byStatus('dormant') → fully written, wired to nothing (the physics3d query). */
export function byStatus(s: InterfaceStatus): OwnedInterface[] {
  return ALL_INTERFACES.filter((i) => i.status === s);
}

export function patternsByPurpose(p: Purpose): OwnedPattern[] {
  return ALL_PATTERNS.filter((r) => r.purpose.includes(p));
}

/** patternsByStatus('promote') → the extraction queue, with promoteTo targets. */
export function patternsByStatus(s: PatternStatus): OwnedPattern[] {
  return ALL_PATTERNS.filter((r) => r.status === s);
}

/** hazardsBySeverity('high') → the stuff that misleads agents into wrong code. */
export function hazardsBySeverity(s: HazardSeverity): OwnedHazard[] {
  return ALL_HAZARDS.filter((h) => h.severity === s);
}

export function hazardsByPurpose(p: Purpose): OwnedHazard[] {
  return ALL_HAZARDS.filter((h) => h.purpose.includes(p));
}

/** Case-insensitive substring search over interface names. */
export function findInterface(name: string): OwnedInterface[] {
  const n = name.toLowerCase();
  return ALL_INTERFACES.filter((i) => i.name.toLowerCase().includes(n));
}

/** Which docs/carts consume a named interface (per the docs' claims). */
export function consumersOf(name: string): string[] {
  const n = name.toLowerCase();
  const out = new Set<string>();
  for (const i of ALL_INTERFACES) {
    if (i.name.toLowerCase() === n) for (const c of i.consumers ?? []) out.add(c);
    if ((i.dependsOn ?? []).some((d) => d.toLowerCase() === n)) out.add(i.doc);
  }
  return [...out].sort();
}

/** Same name defined/claimed in 2+ docs — the duplication radar. */
export function duplicateNames(): { name: string; docs: string[] }[] {
  const seen = new Map<string, Set<string>>();
  for (const i of ALL_INTERFACES) {
    const k = i.name.toLowerCase();
    if (!seen.has(k)) seen.set(k, new Set());
    seen.get(k)!.add(i.doc);
  }
  return [...seen.entries()]
    .filter(([, docs]) => docs.size > 1)
    .map(([name, docs]) => ({ name, docs: [...docs].sort() }))
    .sort((a, b) => b.docs.length - a.docs.length);
}

/** Purpose → interface count, descending — the "what is this project made of" tally. */
export function purposeTally(): { purpose: Purpose; count: number }[] {
  const tally = new Map<Purpose, number>();
  for (const i of ALL_INTERFACES) {
    for (const p of i.purpose) tally.set(p, (tally.get(p) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([purpose, count]) => ({ purpose, count }))
    .sort((a, b) => b.count - a.count);
}

/** One-line corpus stats. */
export function stats() {
  return {
    docs: ALL_DOCS.length,
    interfaces: ALL_INTERFACES.length,
    patterns: ALL_PATTERNS.length,
    hazards: ALL_HAZARDS.length,
    dormant: byStatus('dormant').length,
    deprecated: byStatus('deprecated').length,
    promote: patternsByStatus('promote').length,
    highHazards: hazardsBySeverity('high').length,
  };
}
