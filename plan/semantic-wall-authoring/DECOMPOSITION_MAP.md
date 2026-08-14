# Decomposition Map — Deep Wall Interfaces

## Dependency direction

```text
cart/editor UI
  → editor architecture commands/adapters
    → runtime/game/build.ts wire client
      → framework/game/building_architecture.zig facade
        → wall mutation + topology + compile modules
          → world compile/cache and live-output consumers
```

Source types and packet schemas may be imported upward. UI, React state, and renderer details may not be imported downward. `cart/hmsc-int/` is outside this graph.

## Native target modules

### `framework/game/architecture_scale.zig`

Owns the deep scale boundary: `units_per_meter = 16`, integer `ArchitectureUnit`
limits, checked unit-to-meter output conversion, and checked meter-to-unit legacy
migration. `framework/gpu/stage_scale.zig` imports this authority instead of owning a
second 16 constant. The building host exposes read-only scale metadata to TypeScript;
no UI module defines a competing structural unit.

### `framework/game/wall_types.zig`

Owns:

- IDs and integer-`u` source structs for vertices, edges, explicit absolute supports, side finishes, openings, wall anchors, source revisions, and tuning;
- semantic enums (`WallEdit`, profile, opening kind, facing side, hinge, portal class);
- native opening-kit rows with integer footprint/clearance masks and permitted wall profiles/thicknesses;
- command and typed rejection unions;
- patch/remap/dirty-target receipt structs;
- validation of scalar/range/reference limits that does not require topology.

Does not own allocation-heavy graph construction, V8 values, rendering rows, or world-loader state.

### `framework/game/building_catalog.zig`

Owns strict architecture-kit manifest projections, family/role compatibility,
measurement-to-cell validation, stable catalog identity, category paths, tag indexes,
canonical structured queries, content-hash bindings, and opening-kit lookup. It does
not scan directories or parse behavior from IDs. `wall_mutation` receives a validated
catalog snapshot and never imports editor package code.

### `framework/game/wall_mutation.zig`

Owns:

- `applyCommand(allocator, source, command) -> MutationResult` as the sole structural write interface;
- whole-`u` validation, exact endpoint reuse, and explicit magnet-target IDs;
- segment intersection ordering and edge splitting;
- property copying and stable child-ID derivation;
- opening/anchor cell redistribution;
- insertion/move/delete/profile/material commands;
- complete forward/inverse patch construction and stale-revision rejection.

Depends on `wall_types` and narrow geometric predicates. It asks `wall_topology` to validate the candidate result before returning success.

### `framework/game/wall_topology.zig`

Owns:

- normalized per-floor planar graph construction;
- widened-integer orientation/intersection predicates over persisted `u` coordinates;
- directed half-edge twins and angular ordering;
- deterministic `next`/`prev` linking and face traversal;
- exterior/hole/bounded-face classification;
- face signatures, edge lineage indexes, and diagnostics.

Its graph/DCEL types are derived, allocator-owned values. They never appear in JSON or editor state.

### `framework/game/wall_geometry.zig`

Owns:

- wall-local axes, side planes, offset-line junctions, miter-limit/bevel fallback;
- opening-kit cell/mask validation and interval subtraction;
- front/back bands, reveals, jambs, sills, headers, half-wall caps, and end caps;
- planar UV/material-role coordinates;
- collider/cover bands derived from the same partitions;
- wall-face and opening hit tests that return stable source IDs/local coordinates.

It accepts validated source plus derived topology and produces renderer-neutral geometry records. It does not know about V8 or React.

### `framework/game/wall_compile.zig`

Owns:

- `compile(allocator, source, options) -> ArchitectureCompileBundle.wall section`;
- orchestration of topology and geometry;
- door/portal, navigation blocker, sound/sightline, derived room face, wall-anchor transform, render, collider, and material outputs;
- deterministic serialization order and per-target hashes;
- affected-bounds incremental compile selection;
- lowering helpers for existing live boxes and frozen world targets.

This is the parity boundary: preview and package compilation call the same compiler and consume different lowerings of one bundle.

### `framework/game/building_architecture.zig`

Owns the small public facade:

```zig
pub fn validateSource(...)
pub fn applyCommand(...)
pub fn compile(...)
pub fn raycast(...)
pub fn openingSlots(...)
pub fn migrateLegacyModules(...)
```

It owns the versioned `ArchitectureSource`, `ArchitectureCommand`, and `ArchitectureCompileBundle` envelopes, re-exports public wall source/result types, and hides the module decomposition from bindings and world compiler callers. Dual-sided slab, vertical-link, and top-roof families extend this facade after the wall slice; they do not create sibling host/compiler roots.

## Existing native units

### `framework/game/build.zig` — 1,025 lines, high fragility

Keep:

- non-wall `BuildPieceKind`, catalog rows, snap defaults, fixed-piece placement/raycast, roof sizing, and generic connectivity needed by ordinary pieces;
- the public `WallEdit` alias/re-export during migration.

Move/remove:

- wall source structs and edit semantics move to `wall_types.zig`;
- wall-specific gameplay lowering delegates to `wall_compile.zig`;
- fixed wall variant rows remain only behind the v4 migration reader until severance;
- new semantic walls bypass `liftedWallBaseY` immediately; floor severance deletes `liftedWallBaseY`, `liftWallsOntoFloors`, and their rise/epsilon scan constants after legacy parity is closed;
- no graph or interval algorithm is added to this already broad file.

### `framework/v8_bindings_game_build.zig` — 285 lines, high fragility

Keep catalog/bootstrap and non-wall placement functions. Add marshal-only calls to `building_architecture` through a versioned, sectioned binary packet with explicit header, counts, byte lengths, source revision, and family/target tags. Packet decoding rejects unknown versions and trailing/short data. No topology branch lives in the binding.

If registration clarity requires a second file, create `framework/v8_bindings_game_walls.zig` and register it under the existing `game_build` ingredient; do not create a second source-driven feature.

### `framework/world_loader/live_inputs.zig` — 970 lines, high fragility

Do not teach this file wall semantics. It receives renderer/collider lowerings from `ArchitectureCompileBundle`. Add focused family decoders such as `framework/world_loader/live_wall_bundle.zig`; `live_inputs.zig` remains lifecycle/retained-state orchestration.

### Frozen world writer/loader modules — high consequence

Add target-specific lowering functions beside the existing format owners. The wall compiler emits semantic records; mapfile/gamefile writers serialize them with existing version/hash discipline. Runtime loaders continue to read frozen render/collider/door/room/nav/audio families and do not link editor mutation code.

## Active editor target modules

### `cart/editor/world/architecture.ts`

Owns TypeScript source DTOs, discriminated tool selection, derived summary DTOs, stable selection refs (`wall-edge`, `wall-opening`, `wall-vertex`, ordinary piece), and clone helpers. It mirrors the versioned native public schema but has no geometric algorithms.

`EditorState` gains one `architecture: ArchitectureSource`; ordinary props and non-architectural instances remain in `worldPieces`. Version 1 moves walls into `architecture.walls`; later versions move slab, vertical-link, and top-roof structural records into their own architecture families. This avoids optional endpoint/opening/footprint/path/profile fields on unrelated props while preserving one transactional building document.

### `cart/editor/world/architectureHost.ts`

Owns the editor-facing wrapper over `runtime/game/build.ts`: serialize source/commands, validate result packet versions and IDs, decode receipts/compile summaries, and translate native rejection codes. It has no React imports and no fallback topology implementation.

### `cart/editor/world/architectureCatalog.ts`

Owns the TypeScript DTO projection of installed architecture-kit manifests,
hierarchical category/search views, and structured native catalog-query requests. It
does not measure geometry, derive footprints, parse semantic meaning from IDs, or
maintain a second kit registry.

### `cart/editor/world/architectureCommand.ts`

Owns command IDs and application contracts for draw wall, delete edge/vertex, set profile/height/thickness/style, assign side finish, insert/move/delete/configure opening, attach/detach wall-mounted item, and prefab graph stamp. The floor extension adds explicit `attach-wall-on-top` and `attach-wall-at-edge` commands; no generic “attach wall” command may guess the join. It applies native forward/inverse patches to `ArchitectureSource` and exposes one `planArchitectureCommand` entry point.

This replaces wall-specific use of `PieceListPatch`; ordinary placements continue through `piecePlacementCommand.ts`.

### `cart/editor/world/wallPreview.ts`

Owns conversion of decoded `ArchitectureCompileBundle.wall` rows into the existing `livePush` inputs, selection/pick proxy records, diagnostic overlays, and transient stroke/opening previews. It never computes permanent geometry or collision. Any preview approximation is visually marked and commit still uses the native authority.

### `cart/editor/world/wallTools.ts`

Owns pure interaction state machines for wall draw and opening placement: pointer phases, active floor plane, 1/16 m lattice coordinates, explicit magnet target, cancellation, native opening-slot selection, and command construction. It consumes native pick/projection results; it does not inspect graph adjacency or infer fit from mesh bounds.

### `cart/editor/world/wallMigration.ts`

Owns v4 DTO recognition and migration orchestration. Structural grouping and conversion are performed by `building_architecture.migrateLegacyWallModules`; TypeScript only supplies strict parsed legacy rows, applies returned source/non-wall partitions, and formats diagnostics. It is deleted when the legacy-read window is intentionally closed.

## Existing TypeScript units

### `cart/editor/world/pieces.ts` — 712 lines, high fragility

Retain ordinary piece transforms, terrain leveling, non-wall placement, selection utilities, and ordinary instance-row emission. Remove walls from `supportsRunPlacement`, `resolveRunPlacements`, `placementSlotKey`, `pieceInstanceRows`, and fixed-box picking. Move common coordinate/ID helpers to a neutral module only when both ordinary pieces and architecture actually consume them.

### `cart/editor/world/pieceShapes.ts` — 284 lines, high fragility

Retain shapes for floors/roofs/ramps/stairs/fences and legacy v4 migration snapshots during the migration window. Delete `openingFor(def.edit)` and wall bands after `wallPreview` consumes native compile output. This file must not retain a second implementation for migrated walls.

### Placement/edit command files — 889 combined lines, high fragility

Retain their ordinary list transaction and material transaction behavior. Route wall selection actions into `architectureCommand.ts`; validators reject wall catalog variants from new placement commands once migration is active. Shared journal envelope types may be extracted, but wall graph patches remain typed and cannot be squeezed into an index-based `PieceListPatch`.

### `cart/editor/data/worldStore.ts` — 449 lines, high fragility

Advance to v5 with `architecture` beside ordinary `pieces`. Extract strict architecture DTO validation into `architecture.ts` or `architecturePersistence.ts`; retain document-name, malformed-file protection, queued atomic save, and legacy version dispatch here. `sameWorldSnapshot`, `snapshot`, `scheduleWorldSave`, and `flushWorldSave` gain one architecture reference argument through a named options/document object instead of another long positional parameter.

### `cart/editor/world/livePush.ts` — 410 lines, high fragility

Split ordinary-piece push from wall-bundle push. Keep resident authored meshes and material registry behavior. Replace full-world wall regeneration with affected-target reconciliation keyed by source IDs/hashes. No opening dimensions or miter math enters this file.

### `cart/editor/world/WorldViewport.tsx` — 1,664 lines, high fragility

Extract wall/opening gesture reducers to `wallTools.ts`. `WorldViewport` retains pointer event capture, camera ray construction, floor-plane projection, transient overlay rendering, and dispatch to typed callbacks. Selection becomes a discriminated source ref. The component must not walk DCEL arrays, find intersections, or build wall geometry.

### `cart/editor/shell/AppFrame.tsx` — 10,883 lines, highest fragility

Add one architecture command adapter alongside existing command authorities and one derived-preview effect alongside `pushLiveWorld`. Replace direct wall piece edit callbacks with typed architecture dispatch. Pass an `ArchitectureController` object through `Stage` instead of multiplying callbacks. Remove special-case Door Wall structural export after optional kit export has a named replacement. No native packet parsing, topology, geometry, migration grouping, or opening validation belongs in `AppFrame`.

### Stage, palette, menu, and inspector components

- `Stage.tsx` and `WorldEditorSurface.tsx` pass `ArchitectureController`, source summaries, and discriminated selection.
- `BuildBar.tsx` renders wall styles and opening kits as different tool groups.
- those groups nest through catalog `categoryPath` and use the same entry snapshot supplied to procedural queries; they do not flatten every wall asset into one list.
- `WorldContextMenu.tsx` exposes verbs applicable to the selected edge/opening/profile.
- `PieceBody.tsx` remains ordinary-piece UI; new `WallBody.tsx` and `WallOpeningBody.tsx` own architecture fields and call controller commands.

### Prefabs, materials, facades, and anchors

- `prefabs.ts` evolves to a union payload with an explicit local wall graph; stamping calls `ArchitectureCommand.stampPrefab`.
- `pieceSlots.ts` contributes the current `front`/`back` migration mapping; new wall side helpers live in `architecture.ts`.
- `pieceSkins.ts` skins style/kit/material assets but does not decide collision or opening type.
- `facadeBake.ts` consumes derived stable wall face records for projections.
- wall-mounted ordinary pieces retain their normal piece identity plus an optional semantic wall anchor record; their world transform is derived at apply/compile boundaries.

## Deep boundary invariants

1. There is one mutable wall source document and one native compiler.
2. No target code imports `cart/hmsc-int/`, `love2d/`, `tsz/`, or `archive/`.
3. No persisted record contains DCEL adjacency or generated mesh/collider rows.
4. Every structural command is revision-checked, atomic, invertible, and returns stable remaps.
5. Every packet is versioned and length-validated before allocation or use.
6. Preview and frozen compilation share source validation, topology, opening partition, and gameplay lowering.
7. React components exchange semantic intents and summaries, not native graph internals.
8. Shipped runtime modules consume frozen outputs and never import wall mutation code.
9. Persisted structural coordinates/dimensions are whole `u` values; no integer-millimeter or float-meter source field exists.
10. Opening fit is native kit-mask occupancy, shared by interactive and procedural callers.
11. A wall base is absolute or names one slab plus `on-top`/`at-edge`; no overlap scan can alter it.
12. Architecture-kit footprints come from saved-model measurements with outward rounding; no default door/window size exists in UI or plan constants.
13. Catalog IDs/paths organize and reference entries, while typed fields alone govern behavior and procedural eligibility.
