import type { DocIndex } from '../types';

export const bake_geometry: DocIndex = {
  name: 'bake_geometry',
  file: 'bake-geometry.md',
  purpose: ['geometry', 'asset_pipeline', 'host_bridge', 'format'],
  summary:
    'A build-time CLI command that takes a JSON manifest of geometry ids and params, runs the matching @reactjit/geometries generators, and writes runtime/geometries/_baked.generated.ts so runtime interning gets cache hits instead of regenerating in V8.',
  interfaces: [
    {
      name: 'bake-geometry',
      purpose: ['geometry', 'asset_pipeline', 'format'],
      kind: 'module',
      sourceFile: 'cli/commands/bake-geometry.ts',
      codeRef: 'cli/commands/bake-geometry.ts:31-78',
      description:
        'The rjit bake-geometry command. Parses flags, reads/validates a manifest, bakes each entry via bakeEntry, and writes or --check-compares the generated seed. A manifest-to-seed compiler; renders nothing and scans no source.',
      dependsOn: ['GEOMETRIES', 'bakeEntry', 'emitSeed', 'parseArgs', 'fsRead', 'fsWrite', 'fsExists'],
      consumes: ['--manifest', 'runtime/geometries/index.ts'],
      emits: ['runtime/geometries/_baked.generated.ts'],
      consumers: ['cli/main.ts', 'cli/commands/ship.ts'],
      status: 'live',
    },
    {
      name: 'run',
      purpose: ['geometry', 'asset_pipeline'],
      kind: 'utility',
      codeRef: 'cli/commands/bake-geometry.ts:31-78',
      description:
        'Entry function dispatched by cli/main.ts. Parses flags, sets seedPath (default runtime/geometries/_baked.generated.ts), reads a manifest unless --clear, bakes each item, emits seed, then writes or checks. Exit codes: 0 ok/clean, 1 unknown id or check drift, 2 missing/invalid manifest.',
      dependsOn: ['bakeEntry', 'emitSeed', 'GEOMETRIES'],
      status: 'live',
    },
    {
      name: 'ManifestItem',
      purpose: ['geometry', 'format'],
      kind: 'data_model',
      codeRef: 'cli/commands/bake-geometry.ts:26-29',
      description: 'Manifest item shape { geometry: string; params: Record<string, unknown> }. geometry must match a key in GEOMETRIES.',
      status: 'live',
    },
    {
      name: 'emitSeed',
      purpose: ['geometry', 'format'],
      kind: 'utility',
      codeRef: 'cli/commands/bake-geometry.ts:80-108',
      description:
        'Emits the TypeScript seed: a DO NOT EDIT header, the BakedEntry type, and export const BAKED. Empty when no entries; otherwise a map keyed by JSON.stringify(e.key) with intentionally dense one-line vertices arrays.',
      emits: ['runtime/geometries/_baked.generated.ts'],
      status: 'live',
    },
    {
      name: 'BAKED',
      purpose: ['geometry', 'format'],
      kind: 'data_model',
      sourceFile: 'runtime/geometries/_baked.generated.ts',
      description:
        'Generated Record<string, BakedEntry> map that pre-seeds the runtime geometry intern cache. Committed empty so imports always resolve; ship restores the empty seed after bundling.',
      consumers: ['runtime/geometries/intern.ts'],
      status: 'live',
    },
    {
      name: 'BakedEntry',
      purpose: ['geometry', 'format'],
      kind: 'data_model',
      sourceFile: 'runtime/geometries/_baked.generated.ts',
      description: 'Emitted type { key: string; vertices: number[]; count: number; bounds: number } for one precomputed geometry cache entry.',
      status: 'live',
    },
    {
      name: 'GEOMETRIES',
      purpose: ['geometry'],
      kind: 'registry',
      sourceFile: 'runtime/geometries/index.ts',
      codeRef: 'runtime/geometries/index.ts:109-111',
      description:
        'Registry from geometry id to generator def (id, generate(params), defaults, optional hostKind). Registered ids: Box, Sphere, Head, Carve, Globe, Plane, Cylinder, Cone, Torus, Heightfield, Humanoid. bake-geometry uses it only by string id.',
      consumers: ['bake-geometry', 'bake-geometry-auto'],
      status: 'live',
    },
    {
      name: 'bakeEntry',
      purpose: ['geometry'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/intern.ts',
      codeRef: 'runtime/geometries/intern.ts:78-83',
      description:
        'Computes key=internKey(def, params), calls def.generate({...defaults, ...params}), and returns { key, vertices (Array.from positions), count, bounds }. Shared by build-time bake and runtime fallback.',
      dependsOn: ['internKey'],
      status: 'live',
    },
    {
      name: 'internKey',
      purpose: ['geometry', 'format'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/intern.ts',
      codeRef: 'runtime/geometries/intern.ts:59-62',
      description:
        'Merges defaults and params then builds def.id + | + stable(resolved). The critical shared identity function; build-time and runtime must use the same key or the bake silently becomes useless.',
      dependsOn: ['stable'],
      status: 'live',
    },
    {
      name: 'stable',
      purpose: ['format', 'geometry'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/intern.ts',
      codeRef: 'runtime/geometries/intern.ts:46-51',
      description:
        'Recursively sorts object keys before stringifying so two params objects with the same logical values but different key order produce the same bake key.',
      status: 'live',
    },
    {
      name: 'internGeometry',
      purpose: ['geometry'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/intern.ts',
      codeRef: 'runtime/geometries/intern.ts:85-93',
      description:
        'Runtime path: computes the same key and checks the cache (pre-seeded from BAKED). Hit returns the baked entry; miss calls bakeEntry at runtime and caches it. Used by Scene3D.Mesh, so this command directly affects mesh startup cost.',
      consumers: ['runtime/primitives.tsx'],
      status: 'live',
    },
    {
      name: 'InternedGeometry',
      purpose: ['geometry', 'format'],
      kind: 'data_model',
      sourceFile: 'runtime/geometries/intern.ts',
      description: 'Runtime/build shared object shape containing a key, vertices, vertex count, and bounds radius.',
      status: 'live',
    },
    {
      name: 'bake-geometry-auto',
      purpose: ['geometry', 'asset_pipeline', 'ai_edit'],
      kind: 'module',
      sourceFile: 'cli/commands/bake-geometry-auto.ts',
      description:
        'Producer that scans cart source files for Scene3D.Mesh and Scene3D.Instances JSX with statically resolvable geometry/params and writes a manifest of { geometry, params } entries; the bake-geometry backend does not care how the manifest was produced.',
      emits: ['--manifest'],
      consumers: ['cli/commands/ship.ts'],
      status: 'live',
    },
    {
      name: 'bakeGeometryForCart',
      purpose: ['geometry', 'asset_pipeline'],
      kind: 'utility',
      sourceFile: 'cli/commands/ship.ts',
      codeRef: 'cli/commands/ship.ts:165-186',
      description:
        'Ship-time wrapper: builds a temp manifest at /tmp/reactjit-<cart>-geometry-bake.json, saves the previous seed, runs bake-geometry-auto then bake-geometry, and returns a cleanup fn restoring the previous seed after bundling.',
      dependsOn: ['bake-geometry', 'bake-geometry-auto'],
      status: 'live',
    },
    {
      name: 'parseArgs',
      purpose: ['format'],
      kind: 'utility',
      sourceFile: 'cli/host/argv.ts',
      description: 'Pure-JS flag parser supporting bool/string/number flags and positionals. Unknown flags throw and escape to cli/main.ts which exits 1.',
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Manifest-to-seed compiler',
      purpose: ['geometry', 'asset_pipeline', 'format'],
      description:
        'Manual manifests, auto-generated manifests, and future const-taint manifests all flow through the same bakeEntry and emitSeed path; the command has a narrow role and does not scan source.',
      examples: ['bake-geometry', 'bake-geometry-auto'],
      status: 'recurring',
    },
    {
      name: 'Generator as pure function',
      purpose: ['geometry'],
      description:
        'Geometry generators are treated as pure functions of resolved params; this assumption is foundational for baking and for build-time/runtime key agreement.',
      examples: ['bake-geometry', 'GEOMETRIES'],
      status: 'recurring',
    },
    {
      name: 'Topology baked, transforms stay dynamic',
      purpose: ['geometry', 'rendering'],
      description: 'The command bakes vertices only, not position/rotation/scale or animation state; static mesh topology is separated from dynamic transforms.',
      examples: ['bake-geometry'],
      status: 'recurring',
    },
    {
      name: 'Additive optimization seed',
      purpose: ['geometry', 'asset_pipeline'],
      description:
        'A missing baked entry does not break rendering; it only loses the build-time optimization, falling back to runtime generation. The seed is committed empty and ship restores it.',
      examples: ['bake-geometry'],
      status: 'recurring',
    },
    {
      name: 'Drift gate via --check',
      purpose: ['geometry', 'maintenance'],
      description: '--check regenerates content without writing and returns drift status, acting as a reproducibility gate.',
      examples: ['bake-geometry'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'internKey must match build-time and runtime',
      purpose: ['geometry', 'format'],
      description:
        'internKey is the critical shared identity function; if build-time and runtime keys diverge the bake silently becomes useless (cache miss, no error).',
      evidence: ['bake-geometry.md: Build-time and runtime must use the same key or the bake silently becomes useless', 'runtime/geometries/intern.ts:59-62'],
      severity: 'high',
    },
    {
      name: 'No manifest schema validation',
      purpose: ['format', 'geometry'],
      description:
        'The manifest uses plain JSON.parse with no schema validation beyond the later geometry lookup and item.params ?? {}. Malformed items can fail later or behave unexpectedly if item.geometry is missing or not a string.',
      evidence: ['cli/commands/bake-geometry.ts:46-52', 'cli/commands/bake-geometry.ts:115'],
      severity: 'medium',
    },
    {
      name: 'Non-array manifest escapes local catch',
      purpose: ['format'],
      description:
        'The code assumes the parsed value is iterable (for...of at line 53). Valid JSON that is not an array throws outside the local parse try/catch and escapes to cli/main.ts (caught there, exit 1).',
      evidence: ['cli/commands/bake-geometry.ts:53', 'bake-geometry.md: that error is not caught by the local parse try/catch'],
      severity: 'medium',
    },
    {
      name: 'No deduplication of manifest entries',
      purpose: ['geometry', 'format'],
      description: 'The command does not deduplicate duplicate manifest entries before emitting the seed.',
      evidence: ['bake-geometry.md What this file does not do: It does not deduplicate duplicate manifest entries before emitting'],
      severity: 'low',
    },
    {
      name: '--clear ignores --manifest silently',
      purpose: ['geometry'],
      description: '--clear and --manifest together are allowed by the parser; with --clear set the manifest is ignored without warning and an empty seed is produced.',
      evidence: ['cli/commands/bake-geometry.ts:65-73', 'bake-geometry.md Check and clear modes'],
      severity: 'low',
    },
    {
      name: 'Heightfield hostKind is the registry outlier',
      purpose: ['geometry'],
      description:
        'Geometry defs may carry an optional hostKind, currently used only by Heightfield for host-regenerated heightfields in runtime paths; baking bakes by string id and does not special-case it.',
      evidence: ['bake-geometry.md Geometry registry lookup: optional hostKind: currently used by Heightfield'],
      severity: 'low',
    },
  ],
};
