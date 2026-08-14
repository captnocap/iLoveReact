# Reuse Map — Keep the Pipeline, Replace the Wall Unit

## Canonical shapes to preserve

| Existing authority | Reuse decision | Target use |
| --- | --- | --- |
| `framework/game/build.zig` semantic `WallEdit`, gameplay tags, and catalog ownership | Reuse vocabulary; move wall-specific definitions behind `wall_types.zig` and re-export during migration. | Opening/profile semantics remain host-owned and data-driven. |
| `piecePlacementCommand.ts` / `pieceEditCommand.ts` forward/inverse transaction discipline | Reuse the atomic plan/apply/inverse pattern, not the index-based list patch. | `architectureCommand.ts` returns a source patch plus exact inverse and one journal entry. |
| `applicationCommands.ts` command-authority adapters | Reuse as the only React state mutation boundary. | Add one architecture adapter with revision checks and typed rejection mapping. |
| `worldStore.ts` strict parsing, malformed-document write protection, atomic/debounced save | Reuse without weakening. | v5 contains `architecture`; legacy migration runs before normal save and cannot overwrite an invalid original. |
| `livePush.ts` retained live-world ingress | Reuse as an output transport. | Push compiler-produced render/collider/material/door rows and reconcile affected hashes. |
| `live_inputs.zig` same-row preview render/collider behavior | Reuse for the first slice. | Geometry and collision bands from the wall section of one architecture compile bundle lower into existing instance rows. |
| `compile_cache.zig` / `chunk_dirty.zig` content-address and semantic dirtiness | Reuse directly. | Source/compiler/tuning/catalog hashes key wall render, collision, room, portal, nav, and audio outputs. |
| Existing mapfile/gamefile door, collider, mesh, room/nav/audio consumers | Reuse as frozen-runtime targets. | `wall_compile.zig` lowers into established runtime contracts. |
| `pieceSlots.ts` front/back material distinction | Reuse as migration meaning. | Map legacy front/back to stable directed-edge side A/B; future paint targets the source edge side. |
| `prefabs.ts` “capture composition, stamp as normal data” rule | Reuse and widen the payload. | Local wall graph stamps through normal wall mutation and weld logic. |
| `WorldViewport` floor-plane projection and pointer/camera infrastructure | Reuse interaction plumbing. | Pure wall/opening tool reducers consume its rays and dispatch semantic commands. |
| V24 `WorldMarker` room/portal distinction | Reuse the semantic family, not old implementation files. | Markers annotate derived faces/portals and reconcile through stable diagnostics. |
| Previous-era `edits.ts` behavior table | Port knowledge into the native canonical table. | One opening kind determines portal class, traversal, interaction, sight/sound, and default kit/profile values. |
| Previous-era `worldDoors.ts` / `worldColliders.ts` parity law | Re-express in native tests and compiler contracts. | Visible void, collider void, navigation portal, and door record come from one opening interval. |
| Active Studio `16 u = 1 m` scale (`stage_scale.zig`, `gizmo.zig`, `assetCatalog.ts`) | Extract the value into one game-owned architecture-scale authority; make Studio and the building compiler consume/read back that authority. | One exact X/Y/Z unit governs structural placement, opening occupancy, slabs, storeys, stairs, elevators, and roofs. |
| Model manifest `placeable` disk truth + boot scan | Extend with a distinct measured `architecture-kit` declaration. | Rebuild the installed build catalog on boot without localstore or folder-name authority. |
| `propExports.ts` explicit semantic roles | Reuse the declaration pattern, not the flat prop taxonomy. | Architecture export selects family/role/kind explicitly and writes it to the manifest. |
| `authoredRegistry.ts` one palette tile per exported model | Preserve the one-entry/skins-as-instance-wardrobe law; replace flat kind grouping for architecture kits. | Hierarchical categories organize large sets without paint variants exploding the palette. |

## Existing capabilities used as-is

- Host feature discovery and source-driven inclusion through the `game_build` ingredient.
- Binary host calls through `runtime/ffi`, with a new versioned wall packet instead of a new bridge mechanism.
- Current editor selection overlays, diagnostics surfaces, undo/redo shell, map document naming, and save scheduling.
- Studio package/mesh/material authoring for optional wall styles, jamb/casing kits, door leaves, window frames, trim, and props.
- `ReleaseFast` ship path and existing world-loader retained-resource lifecycle.

## Reuse with an adapter

### Catalog

The host remains catalog authority, but the wall palette reads two semantic projections:

- wall styles/profile defaults for drawing spans;
- opening kits with integer width/height, occupied/clearance masks, semantic compatibility, and asset-envelope validation.
- category paths, theme/gameplay tags, stable IDs, content hashes, and structured procedural query fields.

The adapter must stop indexing wall structure through a hand-maintained static ID list. Non-wall fixed pieces may keep catalog indices until their own migration.

### Live boxes

Existing 12-float box rows can render and collide with deterministic wall bands quickly. The adapter adds source/target identity outside the row or through a versioned affected-bundle envelope so an edit can replace only affected output. This is a migration/output format, not persisted architecture.

### Materials and facades

Current material refs and package assets stay valid. An adapter maps edge side A/B plus generated surface roles (`face`, `reveal`, `jamb`, `sill`, `header`, `cap`, `end`) to material assignments. Facade projection consumes derived plane IDs keyed to stable wall IDs.

### Ordinary wall-mounted pieces

Keep the ordinary `PlacedPiece` asset and instance path. Add a semantic anchor reference; derive its transform from the wall compiler. This avoids creating a second prop system and allows detachment back to a world transform.

### Storey and slab attachment

Reuse command receipts and dependency dirtiness, not the current overlap scan. A
storey datum plus slab thickness derives top/bottom planes; `WallSupport` names either
an absolute base or one slab with `on-top`/`at-edge`. Slab edits use stable dependency
IDs to update or reject attached walls atomically.

## Static assumptions to retire

| Legacy assumption | Exact severance |
| --- | --- |
| `wall.concrete.doorway`, `openDoorway`, `garageDoor`, `window`, `doubleWindow`, `brokenWindow` are structural placeables | Remove them from the active wall palette/catalog projection after v4 migration fixtures pass. Preserve aliases only inside the legacy decoder until its retirement date. |
| A wall is one `PlacedPiece` with x/z/yaw and fixed `W = [3,3,.005]` | New placements write `ArchitectureSource`; v5 validators reject wall-kind records in ordinary `pieces`. |
| A long wall is a run of 3 m modules | Delete wall use of `resolveRunPlacements` and `supportsRunPlacement`; wall stroke commits one graph mutation. |
| Edge occupancy is `placementSlotKey`, so a window replaces a wall | Reject wall IDs from list placement and delete wall slot replacement tests after equivalent architecture-command tests are green. |
| `CatalogRow.edit` selects one centered opening | Remove structural consumption of `CatalogRow.edit`; opening anchors live on source edges and native kits own exact footprints/clearance masks. |
| `pieceVisualShapes` and `pieceInstanceRows` author wall bands in TS | Delete wall branches after native bundle preview is active. Keep non-wall branches. |
| Whole-wall Studio export is required to get a door/window | Remove Door Wall/Garage Door Wall as architecture export targets. Keep generic model/package authoring; add dedicated Door Kit/Window Kit/Wall Style exports only with an active catalog consumer. |
| Fixed-box host raycast can identify every wall | Route wall picking through derived wall-face hit records; keep fixed-box raycast for ordinary pieces. |
| `PlacedBuildPiece.edit` is enough mutable state | Retain only for v4 decode/non-wall compatibility; one edge owns zero-to-many openings. |
| `liftedWallBaseY` chooses the highest overlapping support plate | Remove it from structural preview/compile and delete it with fixed floor/wall severance. No target helper may infer wall support from AABBs or rise tolerances. |
| Opening dimensions live in `pieceShapes.ts` UI meter constants or in mesh bounds | Migrate each legacy edit to a native integer-`u` opening kit. Source instances store only `kitId` plus wall-surface anchor/orientation. |
| `model:<id>` / `prop:<id>` prefix and flat `BuildKind` grouping are enough catalog structure | Keep these namespaces for ordinary placeables; architecture kits use typed manifest fields plus category paths and never overload `prop:`. |
| Door Wall/Garage Door Wall are Studio export targets | Replace them with Architecture Kit → Wall Style/Door/Window/Arch/Trim exports whose measured products install into the active architecture catalog. |

## Do not reuse

- Do not import `cart/hmsc-int/game/build/*` or `markers.ts`; port concepts into active/native owners with current contracts.
- Do not persist or replay generated DCEL arrays from a previous compile.
- Do not copy the supplied research’s miter equation as the sole junction algorithm.
- Do not make shader stencil/depth masks the semantic cutout authority.
- Do not add a TypeScript topology fallback when the native binding is absent. The editor build dependency must include `game_build`, and absence is a surfaced capability error.
- Do not serialize raw V8 handles, native pointers, render row indices, half-edge indices, or face indices into `world.json`.
- Do not treat room detection output as a replacement for explicit gameplay room markers.
- Do not add curves by saving tessellated micro-edges. A future curve record owns its control geometry and lowers through the same compiler.
- Do not persist architecture in integer millimeters or floating-point meters. One `u` is 62.5 mm; integer millimeters necessarily drift.
- Do not let Studio/free-placement modifiers bypass structural source validation. Off-lattice structure requires a separately designed source variant.
- Do not infer family, role, opening kind, or procedural tags from filenames, folders, labels, or colon-separated catalog IDs.
- Do not use the whole-mesh AABB as an opening cutout when casing, handles, leaves, or decoration extend beyond the semantic mount envelope.

## Canonical behavior tables

The native wall tuning/catalog table is the sole owner for:

- 16 units per meter and exact structural snap rules;
- minimum spans and integer opening clearance masks;
- standard wall heights/thicknesses and half-wall caps in `u`;
- opening kit footprints, masks, permitted wall profiles/thicknesses, and asset envelope;
- portal class, collision, cover, sight, sound, traversal, interaction, leaf/panel behavior;
- miter limit, bevel fallback, UV scale, and compile version.

The UI receives read-only catalog rows for labels, grouping, previews, and editable allowed fields. Tests may assert values returned by the host; they must not duplicate behavioral constants in fixtures other than explicit wire/version fixtures.

## Reuse conclusion

The repository already has the correct outer architecture: semantic commands, durable source, live compiler ingress, content-addressed freezing, and runtime consumers. The refactor must replace the inner structural representation and make the native architecture compiler the deep authority. Walls establish the root; dual-sided slabs, slab-mutating vertical links, and top roofs extend it in that order. None may replace the editor, model pipeline, world format family, or runtime loader wholesale.
