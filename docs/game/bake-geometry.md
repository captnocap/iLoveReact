# bake-geometry command inventory

Source file: `cli/commands/bake-geometry.ts`

Reviewed: 2026-06-04

## High-level purpose

`bake-geometry` is a build-time CLI command for precomputing ReactJIT 3D geometry. It takes a JSON manifest of geometry ids and params, runs the corresponding `@reactjit/geometries` generator functions under the CLI runtime, and writes `runtime/geometries/_baked.generated.ts`.

The generated file exports a `BAKED` map. At runtime, `runtime/geometries/intern.ts` imports that map and pre-seeds its geometry cache. When a cart renders a `Scene3D.Mesh` with the same geometry id and params, runtime interning finds a cache hit and does not call the geometry generator inside V8.

This command is not a cart and renders nothing itself. It is part of the game/tooling pipeline for making static `Scene3D` meshes cheaper at app startup and during render.

## Files involved

- `cli/commands/bake-geometry.ts`: the command being reviewed. Parses args, reads the manifest, validates geometry ids, bakes entries, writes or checks the generated seed.
- `cli/main.ts`: registers the command as `rjit bake-geometry`.
- `cli/commands/bake-geometry-auto.ts`: scans cart source files and emits a manifest that can be consumed by this command.
- `cli/commands/ship.ts`: currently calls `bake-geometry-auto`, then calls `bake-geometry`, before bundling a cart.
- `cli/host/argv.ts`: provides `parseArgs`.
- `cli/host/fs.ts`: provides CLI filesystem wrappers over host functions.
- `cli/host/log.ts`: provides stdout/stderr wrappers.
- `runtime/geometries/index.ts`: provides `GEOMETRIES`, the registry from geometry id to generator definition.
- `runtime/geometries/intern.ts`: provides `bakeEntry`, `InternedGeometry`, `internKey`, runtime cache pre-seeding, and runtime fallback generation.
- `runtime/geometries/_baked.generated.ts`: the generated seed file. It is committed empty so imports always resolve.
- `runtime/geometries/BAKE.md`: design note for the build-time geometry bake pipeline.
- `runtime/primitives.tsx`: consumes `internGeometry` in `Scene3D.Mesh`, so baked entries affect actual cart rendering through that path.

## Command registration

`cli/main.ts:5` imports `cli/commands/bake-geometry.ts`.

`cli/main.ts:28-48` includes `'bake-geometry': bakeGeometry` in the command map. Running `rjit bake-geometry ...` dispatches to `run(argv)` in this file.

`cli/main.ts:64` passes `process.argv.slice(2)` to the command. Errors thrown out of the command are caught at `cli/main.ts:67-70`, printed as `rjit: <message>`, and exit with code `1`.

## Inputs

The command accepts these flags via `parseArgs` at `cli/commands/bake-geometry.ts:31-33`:

- `--manifest <path>`: JSON file containing bake items.
- `--out <path>`: optional seed output path. Defaults to `runtime/geometries/_baked.generated.ts`.
- `--check`: compare generated content with the current seed file instead of writing.
- `--clear`: generate an empty seed without requiring a manifest.

The manifest item shape is declared at `cli/commands/bake-geometry.ts:26-29`:

```ts
interface ManifestItem {
  geometry: string;
  params: Record<string, unknown>;
}
```

The intended manifest format is:

```json
[
  { "geometry": "Box", "params": { "width": 1, "height": 1, "depth": 1 } }
]
```

`geometry` must match a key in `GEOMETRIES` from `runtime/geometries/index.ts:109-111`. Current registered ids are `Box`, `Sphere`, `Head`, `Carve`, `Globe`, `Plane`, `Cylinder`, `Cone`, `Torus`, `Heightfield`, and `Humanoid`.

## Host functions and CLI wrappers

The command does not call `globalThis` host functions directly. It uses CLI host wrappers.

Filesystem:

- `fsExists` from `cli/host/fs.ts` calls `__fs_exists`.
- `fsRead` from `cli/host/fs.ts` calls `__fs_read` and throws `FsError` if the host returns `null`.
- `fsWrite` from `cli/host/fs.ts` calls `__fs_write` and throws `FsError` if the host returns false.

Logging:

- `err` from `cli/host/log.ts` calls `__writeStderr`.
- `out` from `cli/host/log.ts` calls `__writeStdout`.

Argument parsing:

- `parseArgs` from `cli/host/argv.ts` is pure JavaScript. It supports bool/string/number flags and positionals.
- Unknown flags throw an error from `parseArgs`. This command does not catch that locally, so `cli/main.ts` catches it and exits `1`.

No browser APIs are used. No DOM, `fetch`, `window`, `document`, local storage, or runtime React primitives are involved.

## Main run flow

`run(argv)` is defined at `cli/commands/bake-geometry.ts:31-78`.

1. Parse flags.
2. Set `seedPath` from `--out`, falling back to `runtime/geometries/_baked.generated.ts`.
3. Initialize `entries` as an empty `InternedGeometry[]`.
4. If `--clear` is not set, require and read a manifest.
5. Parse the manifest as JSON.
6. For each manifest item, look up `GEOMETRIES[item.geometry]`.
7. If the geometry id is unknown, print a message listing known ids and return `1`.
8. If valid, call `bakeEntry(def, item.params ?? {})` and push the result.
9. Emit TypeScript seed content with `emitSeed(entries)`.
10. If `--check` is set, compare the emitted content to the current file and return clean/drift status.
11. Otherwise write the seed file and print how many geometries were baked.

Exit codes:

- `0`: successful write, successful clear, or clean check.
- `1`: unknown geometry id or check drift.
- `2`: missing manifest, missing manifest file, or invalid manifest JSON.
- `1` via top-level catch: thrown parser/filesystem errors not caught by this command.

## Manifest handling

The manifest is read at `cli/commands/bake-geometry.ts:46-52`.

It uses plain `JSON.parse(fsRead(manifestPath))`. There is no schema validation beyond the later geometry lookup and `item.params ?? {}`. This means malformed item objects can fail later or behave unexpectedly if `item.geometry` is missing or not a string. Unknown ids are explicitly handled.

The code assumes the top-level parsed value is iterable because it immediately does `for (const item of items)` at line 53. If the JSON is syntactically valid but not an array, that error is not caught by the local parse `try/catch`; it escapes to `cli/main.ts`.

## Geometry registry lookup

`GEOMETRIES` comes from `runtime/geometries/index.ts`.

That registry is built from geometry definitions shaped like:

- `id`: stable geometry id used in the intern key.
- `generate(params)`: pure generator returning vertex data.
- `defaults`: default params merged into caller params.
- optional `hostKind`: currently used by `Heightfield` for host-regenerated heightfields in runtime paths.

`bake-geometry` uses the registry only by string id. It does not inspect cart source, JSX, imports, or `Scene3D.Mesh` elements. Source discovery belongs to `bake-geometry-auto`.

## Bake entry behavior

`bakeEntry` is imported from `runtime/geometries/intern.ts` at `cli/commands/bake-geometry.ts:22`.

`runtime/geometries/intern.ts:78-83` defines it:

- It computes `key = internKey(def, params)`.
- It calls `def.generate({ ...defaults, ...params })`.
- It returns `{ key, vertices, count, bounds }`.
- `vertices` is `Array.from(data.positions)`, converting a `Float32Array` to a plain number array for generated TypeScript.
- `count` is the vertex count.
- `bounds` is the geometry bounds radius.

`internKey` at `runtime/geometries/intern.ts:59-62` merges defaults and params, then builds `def.id + '|' + stable(resolved)`.

`stable` at `runtime/geometries/intern.ts:46-51` recursively sorts object keys before stringifying. This matters because two params objects with the same logical values but different key order must produce the same bake key.

## Generated seed content

`emitSeed(entries)` is defined at `cli/commands/bake-geometry.ts:80-108`.

It emits a TypeScript file with:

- a "DO NOT EDIT" header,
- explanatory comments,
- `export type BakedEntry = { key: string; vertices: number[]; count: number; bounds: number };`,
- `export const BAKED: Record<string, BakedEntry> = ...`.

If there are no entries, lines 94-98 emit:

```ts
export const BAKED: Record<string, BakedEntry> = {};
```

If entries exist, lines 99-105 emit a map object. Each entry is keyed by `JSON.stringify(e.key)` and contains its own key, count, bounds, and a compact one-line `vertices` array. The source comment at lines 100-102 says density is preferred over readability because the file is generated and embedded in the bundle.

The current checked-in `runtime/geometries/_baked.generated.ts` is empty and matches the empty seed shape.

## Runtime effect

`runtime/geometries/intern.ts:20` imports `BAKED` from `_baked.generated`.

`runtime/geometries/intern.ts:37-42` creates a cache and preloads every baked entry:

```ts
for (const key of Object.keys(BAKED)) cache.set(key, BAKED[key]!);
```

`internGeometry` at `runtime/geometries/intern.ts:85-93` computes the same key and checks the cache. If found, it returns the baked entry. If not found, it calls `bakeEntry` at runtime and caches the result.

`runtime/primitives.tsx` uses `internGeometry` inside `Scene3D.Mesh` for the canonical geometry-def path. That means the output of this CLI command directly affects `Scene3D.Mesh` startup cost: static baked meshes skip generator execution in V8, while unbaked meshes still work through fallback generation.

The bake is additive. A missing baked entry does not break rendering; it only loses the build-time optimization.

## Ship-time integration

`cli/commands/ship.ts:41-43` calls `bakeGeometryForCart` before bundling.

`bakeGeometryForCart` at `cli/commands/ship.ts:165-186` does this:

- Builds a temp manifest path under `/tmp/reactjit-<cart>-geometry-bake.json`.
- Sets the seed path to `runtime/geometries/_baked.generated.ts`.
- Reads and saves the previous seed.
- Runs `tools/rjit bake-geometry-auto <cart.entry> --out <manifestPath>`.
- Runs `tools/rjit bake-geometry --manifest <manifestPath> --out <seedPath>`.
- Returns a cleanup function that restores the previous seed after bundling.

So the ship command currently uses this backend automatically. The repository seed stays unchanged after bundling because `ship` restores it.

## Relationship to bake-geometry-auto

`bake-geometry-auto` is a producer. `bake-geometry` is the backend.

`cli/commands/bake-geometry-auto.ts` scans cart source files for `Scene3D.Mesh` and `Scene3D.Instances` JSX elements whose `geometry` and `params` are statically resolvable under its current literal-detection rules. It writes a manifest of `{ geometry, params }` entries.

This command does not care how the manifest was produced. Manual manifests, auto-generated manifests, and future const-taint manifests all flow through the same `bakeEntry` and `emitSeed` path.

## Check and clear modes

`--check` at `cli/commands/bake-geometry.ts:65-73` generates content but does not write. It reads the current seed path if it exists, compares the exact string, prints `bake-geometry: clean` on match, and returns `1` on drift.

`--clear` skips manifest loading and leaves `entries` empty. Without `--check`, it writes the empty seed. With `--check`, it checks whether the target seed already equals the empty seed.

`--clear` and `--manifest` together are allowed by the parser. The code ignores the manifest when `--clear` is set.

## What this file does not do

- It does not scan cart source files.
- It does not evaluate JSX.
- It does not inspect `Scene3D.Mesh` props.
- It does not run TypeScript compiler APIs.
- It does not call Zig or GPU rendering code directly.
- It does not upload vertices to the host.
- It does not write a binary geometry blob.
- It does not deduplicate duplicate manifest entries before emitting.
- It does not validate manifest schema beyond JSON parsing and geometry id lookup.
- It does not permanently modify the seed during `ship`; `ship` restores the previous seed after bundling.
- It does not support per-cart seed files unless the caller provides `--out`.

## Integration-relevant observations

- The geometry id and params object are the core stable contract between carts, build tooling, and runtime.
- `internKey` is the critical shared identity function. Build-time and runtime must use the same key or the bake silently becomes useless.
- Geometry generators are treated as pure functions. This assumption is foundational for baking.
- Static mesh topology is separated from dynamic transforms. The command bakes vertices, not position/rotation/scale or animation state.
- The generated seed is TypeScript source, not a separate asset format. That keeps bundling simple.
- The output is intentionally dense because it is machine-generated and embedded.
- `--check` is a drift gate for reproducibility.
- `--clear` keeps the always-imported generated module valid even when no geometry is baked.
- The command has a narrow role: it is a manifest-to-seed compiler.

## Glossary

Baked entry: One precomputed geometry cache entry with `key`, `vertices`, `count`, and `bounds`.

BAKED map: Exported object from `_baked.generated.ts` that seeds runtime geometry cache.

Bounds: The geometry bounds radius used by runtime/host render paths for culling and scene extent logic.

Clear mode: `--clear`, which emits an empty seed.

Drift: A mismatch between generated seed content and the seed currently on disk.

Geometry def: Registry object with `id`, `generate`, and `defaults`.

Geometry id: Stable string key such as `Box` or `Humanoid`, used to look up a geometry def.

Geometry registry: `GEOMETRIES` from `runtime/geometries/index.ts`.

Intern key: Stable string identity for a geometry id plus resolved params.

InternedGeometry: Runtime/build shared object shape containing a key, vertices, vertex count, and bounds radius.

Manifest: JSON array of geometry bake requests.

Runtime fallback: `internGeometry` calling `bakeEntry` during app runtime when no baked cache entry exists.

Seed file: `runtime/geometries/_baked.generated.ts`.

Ship-time bake: The `ship.ts` step that temporarily generates a seed before bundling and restores the old seed afterward.

Stable stringify: Recursive sorted-key stringification used by `internKey`.

Vertices: Flat interleaved geometry data generated by the geometry def and embedded as a number array.
