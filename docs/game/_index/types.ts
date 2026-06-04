// docs/game/_index — the queryable extraction layer over docs/game/*.md
//
// Unit of extraction: one DocIndex per audit doc. Inside it:
//   - InterfaceRecord  — a NAMED thing in code (component, hook, host fn,
//     utility, DSL, data model, registry). Has a location. Queryable.
//   - PatternRecord    — a repeated SHAPE that may not have a single API yet
//     ("keysRef polled by tick"). Carries a promoteTo target when it should
//     become an interface.
//   - HazardRecord     — the stuff agents need most: naming lies, drift,
//     footguns, invariants that silently break ("Scene3D only sees direct
//     mesh children", "host rotation order is T·Ry·Rx·Rz·S").
//
// Source of truth for every record is the markdown corpus in docs/game/ —
// records cite what the docs claim; re-verify against source before load-
// bearing changes (the docs were themselves source-verified at write time).
//
// Query idea: "show me everything with purpose includes 'camera'" →
// FollowCamera (planet_run), OrbitCamera (carve_lab/head_lab), the manual
// orbit trig holdouts, the aim rig, unprojectGround/screenRay... — which
// tells you camera is a recurring abstraction and what should be canonical.

/** Controlled vocabulary. Extend deliberately, never ad hoc per record. */
export type Purpose =
  | 'camera'
  | 'input'
  | 'physics'
  | 'damage'
  | 'ragdoll'
  | 'animation'
  | 'pathing'
  | 'rendering'
  | 'geometry'
  | 'shader'
  | 'texture_bake'
  | 'character'
  | 'npc'
  | 'building'
  | 'voxel'
  | 'vehicle'
  | 'item'
  | 'world_gen'
  | 'perception'
  | 'chance'
  | 'interaction'
  | 'asset_pipeline'
  | 'ai_edit'
  | 'agent_llm'
  | 'scripting'
  | 'file_watch'
  | 'persistence'
  | 'networking'
  | 'host_bridge'
  | 'game_loop'
  | 'telemetry'
  | 'math'
  | 'color'
  | 'format'
  | 'ui'
  | 'debug'
  | 'maintenance'
  | 'ai_navigation';

export type SymbolKind =
  | 'import'        // a re-export / import surface (e.g. an alias shim)
  | 'hook'          // a real React hook (use* that actually hooks)
  | 'host_fn'       // a __* V8 binding registered by the host
  | 'component'     // a React component / primitive wrapper
  | 'utility'       // a plain function / helper module
  | 'dsl'           // a parsed mini-language
  | 'data_model'    // a document format / type vocabulary (.hed, VehicleDoc)
  | 'registry'      // a kind→meaning table (ITEMS, BLOCKS, tileKinds)
  | 'shader'        // a WGSL surface (Effect source, mega-shader)
  | 'module';       // a whole file/subsystem exposed as one thing

export type InterfaceStatus =
  | 'live'        // shipping in a game cart or consumed by 2+ carts
  | 'lab'         // proven in a lab, not yet adopted by a game
  | 'dormant'     // fully written, wired to nothing
  | 'deprecated'  // superseded; kept as breadcrumb (_old family)
  | 'candidate';  // declared/typed but not implemented (design-first)

export type InterfaceRecord = {
  name: string;               // "FollowCamera"
  purpose: Purpose[];
  kind: SymbolKind;
  sourceFile?: string;        // "runtime/cameras/rigs/follow.ts"
  codeRef?: string;           // "runtime/cameras/index.tsx:66" when the doc gives one
  description: string;
  imports?: string[];         // what it pulls in
  dependsOn?: string[];       // other InterfaceRecord names / subsystems it needs
  emits?: string[];           // bus channels / events / files it produces
  consumes?: string[];        // bus channels / host fns / files it reads
  consumers?: string[];       // carts/modules the docs say use it
  status: InterfaceStatus;
};

export type PatternStatus =
  | 'recurring'   // observed shape, no decision yet
  | 'promote'     // should become a named interface (see promoteTo)
  | 'avoid'       // an anti-pattern; prefer the named alternative
  | 'resolved';   // already has a canonical interface — holdouts should migrate

export type PatternRecord = {
  name: string;               // "keysRef polled by tick"
  purpose: Purpose[];
  description: string;
  examples: string[];         // doc/cart names exhibiting it
  promoteTo?: string;         // "useGameLoop"
  status: PatternStatus;
};

export type HazardSeverity = 'low' | 'medium' | 'high';

export type HazardRecord = {
  name: string;               // "doc-comment drift"
  purpose: Purpose[];
  description: string;
  evidence: string[];         // doc citations / file:line claims
  fix?: string;
  severity: HazardSeverity;
};

export type DocIndex = {
  name: string;               // "planet_run"
  file: string;               // "planet_run.md"
  cart?: string;              // "cart/planet_run/index.tsx" (omit for pure modules)
  purpose: Purpose[];         // what the whole cart/module is about
  loc?: number;               // approx lines of code the doc reports
  summary: string;            // one sentence, the doc's "in one sentence"
  interfaces: InterfaceRecord[];
  patterns: PatternRecord[];
  hazards: HazardRecord[];
};
