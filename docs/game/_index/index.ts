// docs/game/_index — aggregate over the live DocIndex records + query helpers.
//
// DEMOLITION-0610 (USER ASK req_0610/req_0611): the ~30 per-cart records for
// the deleted standalone lab/demo carts retired to docs/game/_archive/records/
// alongside their .md docs. A deleted cart cannot keep a live index record —
// the maintenance contract runs in reverse. What remains is the game itself
// (game_* doors, hmsc_int the tool) + the framework/CLI docs.
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

import { bake_geometry } from './records/bake_geometry';
import { editor_face_paint } from './records/editor_face_paint';
import { editor_stickers } from './records/editor_stickers';
import { editor_flora } from './records/editor_flora';
import { editor_hot_reload } from './records/editor_hot_reload';
import { editor_map_documents } from './records/editor_map_documents';
import { editor_map_paint_history } from './records/editor_map_paint_history';
import { editor_sections } from './records/editor_sections';
import { editor_transport_paths } from './records/editor_transport_paths';
import { game_activities } from './records/game_activities';
import { game_build } from './records/game_build';
import { game_animation } from './records/game_animation';
import { editor_deej } from './records/editor_deej';
import { editor_pen_device } from './records/editor_pen_device';
import { game_cutscene } from './records/game_cutscene';
import { game_missions } from './records/game_missions';
import { game_world } from './records/game_world';
import { hmsc_int } from './records/hmsc_int';
import { physics3d } from './records/physics3d';
import { skybox_void } from './records/skybox_void';
import { request_ledger } from './records/request_ledger';

export type {
  DocIndex, InterfaceRecord, PatternRecord, HazardRecord,
  Purpose, SymbolKind, InterfaceStatus, PatternStatus, HazardSeverity,
};

export const ALL_DOCS: DocIndex[] = [
  bake_geometry, editor_deej, editor_pen_device, editor_face_paint, editor_flora, editor_stickers, editor_hot_reload, editor_map_documents, editor_map_paint_history, editor_sections, editor_transport_paths, game_activities, game_animation, game_build, game_cutscene,
  game_missions, game_world, hmsc_int, physics3d, skybox_void, request_ledger,
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
