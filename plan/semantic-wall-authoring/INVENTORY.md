# Inventory — Semantic Wall Authoring

Scope: the active `cart/editor/` world-authoring surface, its runtime adapters, and the native build/world compiler seams that turn authored structure into live preview and shipped data. `cart/hmsc-int/` is reference-only under V32 and is inventoried separately; no target module may import it.

## Governing decisions

| Authority | Live ruling used by this plan |
| --- | --- |
| `docs/game/DECISIONS.md` V24 | A building is authored as semantic pieces. `WallEdit` names solid/opening/profile meaning. Pieces compile render geometry, collision, cover, sound, rooms, portals, navigation, and destruction. Creative Build and Sims Plan Build edit one model. |
| `docs/game/BUILDING-GRAMMAR.md` | Grid coordinates are a snapping substrate, not the object model. Prefabs decompose into normal semantic pieces. Materials skin semantic pieces without becoming gameplay authority. |
| `docs/game/DECISIONS.md` V29 | Dynamic generation is an editor/compiler capability. Shipped worlds reference baked, content-addressed artifacts; runtime geometry invention is prohibited. |
| `docs/game/DECISIONS.md` V32 | Going-forward implementation belongs in `cart/editor/` and its `/play` route. Previous carts are evidence, not build sites. |

## Existing scale and vertical-placement facts

| Active authority | Fact |
| --- | --- |
| `framework/gpu/stage_scale.zig` | `tile_meters = 1.0` and `units_per_meter = 16.0`; the existing Studio modeling unit is exactly `1/16 m`. |
| `framework/gpu/scene3d/gizmo.zig` | `STAGE_FINE_DIV = 16`; the center stage tile visibly carries the same 16-part subdivision. |
| `framework/gpu/scene3d/gizmo_drag.zig` | Ordinary translation uses `STAGE_TILE_M / 16`; Shift uses `1/64 m`; Ctrl/Alt selects freeform mesh dragging. |
| `cart/editor/data/assetCatalog.ts` | `U_PER_TILE = 16`; new primitive dimensions are authored in the same Studio units. |
| `framework/game/build.zig` | `liftedWallBaseY` scans overlapping floor/roof piece bounds and moves each wall-family piece to the highest qualifying plate top. Stored wall Y remains unchanged, so rendered base depends on neighboring boxes. |

The existing plan's provisional integer-millimeter source would round one Studio unit
(`62.5 mm`) and is therefore not exact. The target must use integer Studio/build units
for authored structural coordinates and dimensions. The current wall-lifting scan is
the concrete source of “on floor versus beside floor” ambiguity and is a named
severance target.

## Existing export and catalog facts

| Active authority | Fact |
| --- | --- |
| `cart/editor/data/modelPackage.ts` / `types.ts` | The on-disk model manifest owns one flat `ModelPlaceable` declaration. Current variants are `build-piece`, `prop`, `flora`, and `character`; there is no architecture-kit variant or category path. |
| `cart/editor/data/propExports.ts` | Prop export already proves the semantic pattern: an explicit role is selected at export and stored in the manifest; filenames do not infer behavior. |
| `cart/editor/data/buildExports.ts` | Door Wall and Garage Door Wall export as fixed wall-kind placeables carrying `WallEdit`; this is the whole-wall export assumption being retired. |
| `cart/editor/data/buildStarters.ts` | Door starters point at fixed catalog wall variants whose existing decomposition owns their dimensions. They do not measure a reusable door/window kit. |
| `cart/editor/world/authoredRegistry.ts` | Authored placeables use `model:<id>` or `prop:<id>` and are grouped only by base `BuildKind`; the palette has no typed subcategory hierarchy or procedural catalog query. |
| `cart/editor/data/initialState.ts` | Boot reconstructs authored placeables by scanning `manifest.placeable`, establishing the reusable disk-truth/install seam for architecture kits. |
| `cart/editor/shell/AppFrame.tsx` export branch | Export saves the resident model before reading bounds and writing the manifest. Door Wall additionally validates/compiles a named door-leaf part, but the output is still a static wall piece. |

The target keeps manifest disk truth, save-before-measure, explicit semantic roles,
content-addressed assets, and one palette tile per exported model. It replaces the flat
static-wall declaration with measured architecture-kit entries, category paths, and
structured catalog queries.

## Current source-of-truth path

The persisted authority is `WorldSave.version = 4` in `cart/editor/data/worldStore.ts`. Its `pieces: PlacedPiece[]` records are transform-only instances. A wall is therefore represented as one or more catalog modules, not as an architectural span. A door or window is a different `pieceId`, and `placementSlotKey` makes it replace the solid module occupying the same edge slot.

The live preview path is:

`BuildBar catalog row` → `WorldViewport` gesture → `pieces.resolvePlacement/resolveRunPlacements` → `piecePlacementCommand` → `EditorState.worldPieces` → `pieceVisualShapes`/`pieceInstanceRows` → `livePush` → `__compiled_world_set_live_pieces` → `world_loader/live_inputs.zig` render instances and colliders.

That path has no persisted edge endpoints, shared vertices, opening intervals, half-edge adjacency, room faces, or structural mutation receipt.

## Active editor inventory

| File | Size | Relevant units | Present responsibility and coupling |
| --- | ---: | --- | --- |
| `cart/editor/world/buildCatalog.ts` | 185 | `BuildKind`, `WallEdit`, `CatalogRow`, fallback rows, `catalogRows`, `catalogRowFor`, `catalogByKind` | Mirrors native catalog order and encodes door/window/garage walls as whole-wall catalog variants. This is the palette-level source of the static-wall assumption. |
| `cart/editor/world/pieces.ts` | 712 | `PlacedPiece`, `PlacementGesture`, `resolvePlacement`, `resolveRunPlacements`, `placementSlotKey`, `visibleStoreyPieces`, `pieceInstanceRows` | Defines the transform-only world-piece shape, fixed 3 m run placement, edge-slot replacement, picking helpers, and box decomposition. It currently mixes source records, snapping, authoring policy, presentation, and live wire emission. |
| `cart/editor/world/pieceShapes.ts` | 284 | `VisualShape`, `openingFor`, `pieceVisualShapes` | Produces one centered opening from `CatalogRow.edit`; opening dimensions are UI constants. Rendering geometry is coupled to the selected catalog row instead of mutable wall state. |
| `cart/editor/world/piecePlacementCommand.ts` | 362 | placement DTOs, validators, `PieceListPatch`, apply/inverse functions, `planPiecePlacement` | Strong atomic transaction seam for list placement and replacement. It cannot express vertex welding, edge splitting, opening redistribution, or multi-family patches. |
| `cart/editor/world/pieceEditCommand.ts` | 527 | edit/material DTOs, apply/inverse functions, move/rotate/spin/skin/delete planners | Strong edit journal seam, but its action vocabulary has no wall draw/split/opening/profile operations. |
| `cart/editor/world/prefabs.ts` | 210 | `WorldPrefabPiece`, `prefabFromPieces`, `stampWorldPrefab`, `resolvePrefabPlacement`, validator | Captures transform-local pieces and decomposes on stamp. It has no local structural vertex table and cannot preserve wall connectivity or opening attachment. |
| `cart/editor/world/pieceSlots.ts` | 123 | face-role and material-slot helpers | Existing `front`/`back` material distinction is the migration source for oriented wall side materials. |
| `cart/editor/world/pieceSkins.ts` | 231 | procedural skin assignment and validation | Consumes `PlacedPiece` and catalog semantics. It must remain a skin layer over structural authority. |
| `cart/editor/world/facadeBake.ts` | 230 | piece face projection and facade bake inputs | Assumes transform-oriented box faces. Wall-side projection must consume stable edge orientation and derived wall faces. |
| `cart/editor/world/livePush.ts` | 410 | `pushLiveWorld`, `pushResidentMeshes`, material/skin ingress | Sends decomposed boxes and authored meshes into the compiled-world live overlay. It is the reusable preview output seam, not an architectural source of truth. |
| `cart/editor/world/WorldViewport.tsx` | 1,664 | ray/pick logic, drag gesture, placement preview/commit, walls-down ingress | Owns the current click/drag placement interaction. A wall stroke currently expands into fixed modules; openings have no wall-local preview or projection. |
| `cart/editor/stage/WorldEditorSurface.tsx` | 131 | `WorldViewport` prop contract | Thin surface boundary for world authoring callbacks. |
| `cart/editor/stage/Stage.tsx` | 271 | world surface and `BuildBar` assembly | Passes `worldPieces`, armed catalog id, and placement callbacks; it needs a typed architecture tool contract rather than more wall-specific callback props. |
| `cart/editor/stage/BuildBar.tsx` | 206 | catalog categories and arm action | Shows each wall-opening variant as a separate placeable. It needs separate wall-style and opening-tool families. |
| `cart/editor/stage/WorldContextMenu.tsx` | 269 | piece quick verbs | Offers copy/prefab/rotate/delete/material actions, but no structural edit verbs. |
| `cart/editor/inspector/PieceBody.tsx` | 358 | selected-piece transforms/material controls | Treats every selection as a transform instance. It needs a dedicated wall/opening body whose fields map to architecture commands. |
| `cart/editor/data/types.ts` | 762 | `EditorState`, `ModelPlaceable`, `WorldObject` | `EditorState.worldPieces` is the active React authority. `ModelPlaceable.edit` only describes exported models. `WorldObject` is not the V24 `WorldMarker` family. |
| `cart/editor/data/worldStore.ts` | 449 | `WorldSave`, `validPiece`, parse/read/save/schedule/flush | Persists v4 transform-only pieces and validates them. It is the migration boundary for a source architecture document. |
| `cart/editor/data/applicationCommands.ts` | 1,172 | command adapters around placement and edit planners | Correct application boundary for native mutation receipts and state transitions. |
| `cart/editor/data/commands.ts` | 760 | command IDs and command registry shapes | Contains current world-piece verbs and static build-piece starter/export commands. It needs explicit architecture commands rather than implicit placement variants. |
| `cart/editor/data/editorEvents.ts` | 553 | editor event payloads and routing | Event contract will carry tool activation and mutation results; topology internals must not leak into generic UI events. |
| `cart/editor/data/initialState.ts` | 204 | boot state construction | Restores v4 pieces and manifest-backed placeables. It needs migrated architecture state and separate opening tools. |
| `cart/editor/model/buildPieceStarter.ts` | 188 | `pieceVisualShapes` → Studio mesh seed | Bakes static wall/door silhouettes into editable model documents. This remains useful for optional style/kit authoring but cannot remain required for placing an opening. |
| `cart/editor/shell/AppFrame.tsx` | 10,883 | command adapters around lines 900–1,200; persistence around 1,679; model export around 3,998–4,100; world interactions around 4,463–4,970; shell wiring around 10,300 | High-fragility coordinator. It currently owns state wiring and static Door Wall export special cases. Architectural algorithms must not be added here. |

## Runtime and native inventory

| File | Size | Relevant units | Present responsibility and coupling |
| --- | ---: | --- | --- |
| `runtime/game/build.ts` | 146 | `BUILD_CATALOG_IDS`, five-float `BuildPieceLite`, raycast/validate wrappers | Thin host door, but the hand-mirrored catalog order and transform-only wire silently discard `PlacedBuildPiece.edit`. A versioned architecture wire must replace the mirrored index contract for walls. |
| `framework/game/build.zig` | 1,025 | `WallEdit`, `BuildPieceDef`, `PlacedBuildPiece.edit`, `applyWallEdit`, `effectiveTags`, fixed catalog, placement/raycast/connectivity | Native semantic vocabulary already includes `solid`, `slidingDoor`, and `halfHeight`, but geometry and picking still assume fixed 3 m oriented boxes. This file is already broad and must delegate graph/geometry work to focused modules. |
| `framework/v8_bindings_game_build.zig` | 285 | catalog readback, validate binding, five-float raycast wire, registrar | Thin binding candidate. It must marshal versioned wall source and mutation/compile receipts without implementing topology. |
| `framework/v8_ingredients.zig` / `build.zig` | registrar and build graph | `game_build` feature registration and test targets | New wall bindings stay behind the existing source-driven `game_build` ingredient. A dedicated native wall test target is required. |
| `framework/v8_bindings_compiled_world.zig` | live-world host ingress | `__compiled_world_set_live_pieces` and related setters | Existing destination for live derived render rows. Extend only if a richer versioned wall preview packet materially replaces box rows. |
| `framework/world_loader/live_inputs.zig` | 970 | `PendingLive`, `setLivePieces`, `applyPendingLive`, `applyLiveColliders`, wall hiding | Converts the same box rows into visible instances and colliders. That parity is valuable, but its fixed row contract has no semantic wall/opening data. |
| `framework/world/compile_cache.zig` / `framework/world/chunk_dirty.zig` | compile cache and invalidation | semantic targets including room/portal outputs | Reusable content-address and dirty-target infrastructure for derived wall artifacts. |
| `framework/world/mapfile.zig` and gamefile writer/loader modules | frozen-world formats | collider, door, mesh, and world data lumps | Shipped-world output authorities. Wall compilation must lower into these existing runtime-consumed families, not introduce runtime-authored geometry. |

## Tests and missing coverage

| Existing test | Covers | Missing wall proof |
| --- | --- | --- |
| `cart/editor/world/pieces.test.ts` (226) | snapping, run placement, visibility, decomposition | arbitrary spans, intersection splitting, opening-local placement, deterministic output |
| `cart/editor/world/piecePlacementCommand.test.ts` (247) | atomic placement/replacement and validation | multi-family graph patch and inverse receipt |
| `cart/editor/world/pieceEditCommand.test.ts` (282) | transform/material command reversibility | edge/profile/opening mutations and split remapping |
| `cart/editor/world/prefabs.test.ts` (47) | simple local transform capture/stamp | connected local wall graph and opening preservation |
| framework inline `build.zig` tests | catalog, tags, fixed-piece placement/raycast | native graph normalization, faces, openings, geometry, and determinism at the layer where logic lives |
| `framework/testing/unit/world_*` tests | frozen/live world formats and loader behavior | compiled wall packet parity across render, collision, doors, rooms, nav/audio targets |

There is no dedicated `test-game-build`/`test-building-architecture` Zig target today. Creating the general architecture target with wall coverage first is part of the refactor, not optional TS-only coverage.

## Previous-era reference inventory — never import

| Reference | Reusable knowledge only |
| --- | --- |
| `cart/hmsc-int/game/build/edits.ts` | One semantic edit table ties opening/profile meaning to portals, sightline, traversal, interaction, and panel style. |
| `cart/hmsc-int/game/build/placed.ts` | Visual band and collider derivation once came from the same edit semantics; it also contains wall-end/join experience. It remains fixed-module code. |
| `cart/hmsc-int/game/markers.ts` | V24 room and portal marker vocabulary and validation. Markers identify gameplay meaning; they are not substitutes for detected topology. |
| `cart/hmsc-int/game/compile/worldDoors.ts` and `worldColliders.ts` | Editor/compile parity laws: doors and colliders derive from the same semantic source. |

## Adjacent floor and roof facts

These families are follow-ons, not additions to the wall first slice. They constrain the wall foundation now:

| Family | Active shape | Prior-era reference fact | Required compatibility seam |
| --- | --- | --- | --- |
| Floor | `resolveRunPlacements` fills an axis-aligned rectangle with independent 3 m `PlacedPiece` plates; `pieceShapes.ts` renders each as a box slab; `placementSlotKey` replaces same-kind plates by cell. There is no polygon, hole, room binding, stair void, or shared boundary. | `microGrid.ts` gave each 3 m plate a 3×3 field of 1 m semantic surface cells. The V24 ruling makes the 1 m grid a gameplay/snap substrate rather than the authored object model. | Preserve 1 m surface intent as a sparse field on first-class floor regions. Room-fill is an authoring command/binding, not automatic floor existence. Floors extend `ArchitectureSource` and `ArchitectureCompileBundle`. |
| Stairs/ramps | Active stairs are fixed 3 m or 1.2×3 m catalog transforms rendered as five box steps; placement deliberately leaves the floor slab underneath intact. Ramps are fixed 3 m slope records. Neither owns or requests a slab cutout, landing clearance, entry/exit anchor, or cross-level dependency. | Previous-era collision correctly treated stairs/ramps as walkable heightfields and identified them as vertical links, but geometry and navigation still assumed the authored model’s fixed footprint/orientation. | A first-class vertical-link assembly owns a parametric/kit path, start/end landing anchors, clearance envelope, served levels, and link-owned slab cutouts. Spiral/L/U/straight stairs and ramps are placed/configured in-world; exit direction is placement state, not baked model foresight. |
| Elevator | Active editor placement is one fixed 3×3 open-front frame per storey with no slab mutation. Native tuning describes one segment; the active editor has no shaft/stop source record. | Previous-era `elevators.ts` grouped float-aligned stacked pieces into derived shafts/stops and moved one live car; the explicit ruling keeps elevator a first-class vertical-link piece, never a prefab. | Preserve the world-configured stacking UX, but each placed/extended segment mutates one stable elevator shaft assembly. The command cuts every crossed slab, installs stop/landing openings, and derives shaft walls, doors, car path, collision, navigation, room/audio/visibility separation, and frozen records. |
| Roof | Active editor rows are 3 m flat/gable/shed catalog variants. `pieceShapes.ts` approximates shed/gable roofs with one or two ramp boxes and rectangular “gable end” boxes. Active `PlacedPiece` has no `roofSpan`; native `PlacedBuildPiece.roofSpan` and `RoofShape` never cross the editor wire. Hip/pyramid math exists only as bounds/rise, not correct roof surfaces. | Previous-era placement allowed a rectangular width/depth override and pitch/profile lookup, still as one module rather than a footprint/plane system. | Roofs become first-class footprint/profile records after floors. Correct arbitrary-footprint planes, ridges, hips, valleys, eaves, fascia/soffit, holes, materials, collision, nav, and frozen output extend the same native architecture compiler. |

The wall plan therefore creates a general `building_architecture.zig` facade and sectioned `ArchitectureCompileBundle`; wall-only topology and geometry remain focused modules behind it. The implementation order is walls → dual-sided floor slabs → vertical links that mutate those slabs → topmost weather roofs.

## Inventory conclusion

The reusable pipeline is the transaction → persisted document → derived live output → frozen compile chain. The replaceable assumption is the unit of authorship: today a wall is a transform instance selected from a variant catalog; the target is a stable semantic edge with mutable openings and derived topology. The DCEL is absent from the codebase and must be built once in the native build authority rather than re-created in TypeScript.
