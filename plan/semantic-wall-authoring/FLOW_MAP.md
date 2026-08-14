# Flow Map — Semantic Wall Authoring

## Current wall placement

```text
buildCatalog.ts fallback/host catalog
  └─ one row per solid/door/window wall variant
      └─ BuildBar arms pieceId
          └─ WorldViewport click/drag
              ├─ resolvePlacement() → one transform-only PlacedPiece
              └─ resolveRunPlacements() → N fixed 3 m PlacedPieces
                  └─ AppFrame.placePieces()
                      └─ applicationCommands → planPiecePlacement()
                          ├─ placementSlotKey() replaces occupied edge module
                          ├─ EditorState.worldPieces + undo/redo
                          └─ scheduleWorldSave() → world.json v4
```

Consequences fan out from `worldPieces`:

```text
worldPieces
  ├─ pieceVisualShapes(def.edit) → visible centered opening bands
  ├─ pieceInstanceRows() → livePush → live_inputs → preview boxes + colliders
  ├─ face/material helpers → live material skin boxes
  ├─ viewport fixed-box pick and selection
  ├─ prefabFromPieces()/stampWorldPrefab()
  ├─ facade face projection
  └─ Studio starter/export path → optional authored whole-wall mesh
```

The opening is the wall variant. Returning later to “add a window” replaces the wall module; it does not mutate a structural record. Room topology and portal lineage do not exist in this path.

Current vertical placement adds a second derived source of position:

```text
stored wall piece Y + all neighboring floor/roof boxes
  → liftedWallBaseY scans plan overlap and a rise tolerance
  → highest qualifying plate.topY wins
  → preview/runtime wall base differs from persisted wall Y
```

That branch cannot distinguish “wall rests on slab” from “slab meets wall edge.” It
also makes storey spacing depend on plate thickness and neighborhood contents.

## Target authority chain

```text
UI intent
  → versioned ArchitectureCommand
    → runtime/game/build.ts thin marshal
      → native wall mutation authority
        → validation + planar normalization
          → complete MutationReceipt or typed rejection
            → applicationCommands atomic apply/inverse
              → EditorState.architecture source revision
                ├─ worldStore v5 persistence
                ├─ native ArchitectureCompileBundle for live preview
                └─ compile-cache dirty targets for frozen build
```

The only arrows into persisted architecture state are successful command receipts and deterministic v4 migration. UI components, render helpers, and world-loader code never mutate source records directly.

## Wall draw flow

1. `BuildBar` arms `{ tool: 'wall', styleId, snapMode, profile }` rather than a door/window wall catalog id.
2. `WorldViewport` projects pointer-down and pointer-current onto the active floor plane. It displays a transient stroke only; it does not create module pieces.
3. On commit, `ArchitectureCommand.drawWall` carries source revision, floor, integer-`u` endpoints, an explicit absolute base, style/profile, height, and thickness.
4. The native mutation authority requires whole `u` coordinates, exactly reuses coincident endpoints or an explicitly magnet-targeted vertex ID, finds proper intersections with widened integer predicates, and splits crossed edges in stable parametric order.
5. Edge splitting copies structural properties, partitions child openings/anchors, and emits old-edge → child-edge remaps. A cutout intersected by the new junction is rejected with a typed clearance error.
6. The authority rebuilds affected adjacency/faces and returns the entire source patch, inverse patch, affected bounds, and dirty targets.
7. The application layer commits the receipt as one undoable state transition.
8. The live derived compiler emits only the affected floor/chunks; `livePush` publishes their render/collider/material/door rows.
9. Persistence writes the source graph and revision. Derived topology remains cache data.

## Opening insert/move/delete flow

1. `BuildBar` or wall inspector arms an opening kit and semantic kind.
2. `WorldViewport` ray-picks derived wall faces and receives `{ edgeId, side, worldPoint }`.
3. The adapter asks native `openingSlots(edgeId, kitId)` for exact available wall-surface anchors and previews the nearest returned `(columnU, rowU)`; it does not infer fit from the kit mesh.
4. `ArchitectureCommand.insertOpening` carries `edgeId`, source revision, semantic kind/kit, integer column/row anchor, facing side, and hinge. Width, height, sill behavior, occupied cells, and clearance cells remain owned by the kit.
5. Native validation expands the kit masks and checks edge existence, complete-column bounds, wall profile/thickness, floor rules, and exact disjointness from sibling occupied/clearance cells.
6. Success inserts a stable child record; move and delete use the same command/receipt path. Failure returns a specific displayable rejection and makes no source change.
7. The derived compiler subtracts opening intervals once, then emits front/back bands, inner reveals, jamb/sill/header/cap surfaces, collider bands, navigation portal data, door data, sound/sightline state, and material roles from the same opening.

## Procedural opening flow

```text
edgeId + opening kitId
  → native catalog resolves measured kit footprint/masks
  → native openingSlots()
    → edge complete-column bounds
    → subtract kit end-clearance mask
    → subtract sibling occupied/clearance masks
    → filter profile and thickness compatibility
    → ordered (columnU,rowU) candidates
      → generator selects by seed/grammar
      → ordinary insertOpening command
      → ordinary receipt, preview, compile, and freeze paths
```

Procedural placement has no privileged bypass and performs no geometry probing. Given
the same source revision and kit catalog hash, interactive and procedural callers see
the same candidate list and the same typed rejection for a stale choice.

## Architecture-kit export and catalog flow

```text
File → Export → Architecture Kit → family/role/semantic category
  → save current resident model
  → measure visible semantic mount envelope in Studio u
  → floor minima / ceil maxima into conservative lattice footprint
  → validate pivot, named parts, material roles, clearance, tags, category path
  → write manifest.placeable.as = architecture-kit
  → content-address/install mesh + material + animation products
  → publish typed ArchitectureCatalogEntry
      ├─ hierarchical BuildBar categories/search
      ├─ architecture inspectors/tools
      └─ deterministic procedural catalog query
```

The readable catalog ID/path organizes the entry; explicit family/role/kind fields
control behavior. Re-export atomically advances the stable catalog entry to a new
content hash only after measurement and compile validation succeed. The complete
schema and query flow are in `contracts/build_catalog.md`.

## Topology and room flow

```text
source vertices + directed wall edges
  → validate references/lengths/floor partitions
  → sort outgoing half-edges by deterministic angle key
  → link twin/next/prev in derived DCEL
  → traverse cycles once
  → signed area + containment classify bounded faces/exterior/holes
  → stable face signature from ordered directed edge lineage
  → DerivedRoomFace[] + diagnostics
      ├─ room/ceiling/floor consumers
      ├─ cutaway/visibility consumers
      └─ stable boundary/lineage API for the separate WorldMarker lane
```

The first slice stops at deterministic room-face facts. It does not create room-role records inside the wall graph or repurpose the active editor's generic `WorldObject`. The later V24 WorldMarker lane consumes the boundary/lineage API and owns retain/migrate/unresolved policy.

## Side materials and wall-mounted anchors

The stored edge direction defines side A and side B. Derived half-edge orientation maps those source slots to interior/exterior faces without swapping on reload. Paint commands target `{ edgeId, side }`, not a transient box face.

Wall-mounted items use `{ edgeId, side, columnU, rowU, normalOffsetU }`. Edge split receipts remap them mechanically to one child edge and adjusted column; a junction through the item’s occupied cells rejects the split. World-space transforms are derived for preview and frozen output.

## Storey and wall-support flow

```text
Storey.walkPlaneU + FloorSlab.thicknessU
  → slabTopU = walkPlaneU
  → slabBottomU = walkPlaneU - thicknessU
      ├─ WallSupport.absolute → wallBaseU = authored baseYU
      ├─ WallSupport.slab/on-top → wallBaseU = slabTopU
      └─ WallSupport.slab/at-edge → wallBaseU = slabBottomU
```

“Attach on top” and “Attach at edge” are separate architecture commands. They name the
slab and join in source, return a complete dependent patch, and are individually
undoable. Slab create/move/delete follows dependency IDs; no path scans bounds for a
replacement support. Storey duplication computes the new datum from
`walkPlaneU + floorToFloorU`, then derives slab and wall surfaces from that datum once.

## Prefab flow

```text
selected ordinary pieces + selected wall subgraph
  → prefab capture
      ├─ local ordinary transforms
      ├─ local vertex table
      ├─ local edges/openings/side finishes
      └─ local wall anchors
  → prefab stamp command
      → transform local graph
      → run normal weld/intersection mutation
      → return one receipt
      → decompose into ordinary source families
```

The prefab is never a permanent gameplay object. Stamping uses the same wall authority as hand drawing, so it cannot bypass topology validation.

## Save/load and migration flow

```text
world.json v4
  → parse strict legacy piece records
  → group compatible fixed wall modules by floor/style/orientation/adjacency
  → convert each maximal run to vertices + edge(s)
  → convert edit-specific module ids to catalog opening-kit children at integer wall-surface anchors
  → validate through native architecture authority
  → produce in-memory v5 source document + migration diagnostics
  → save v5 only after a normal successful save action
```

Non-wall pieces retain their IDs and source records. Ambiguous legacy overlaps remain explicit migration errors with the original file write-protected; migration does not guess and overwrite.

On v5 load, strict TS shape validation precedes native semantic validation. A stale/malformed architecture graph is never passed onward as trusted source.

## Live preview flow

```text
source revision + affected bounds
  → native ArchitectureCompileBundle.wall targets
      ├─ render boxes/mesh patches + material roles
      ├─ collider bands
      ├─ door/portal records
      ├─ room faces + diagnostics
      └─ source hash + per-target hashes
  → runtime adapter validates packet version/stride/counts
  → livePush replaces affected retained outputs
  → world_loader displays and collides against the same bundle
```

The initial bundle contains only wall targets and may lower render and collision bands into existing live box ingress. Dual-sided slab, vertical-link, and top-roof sections join the same versioned bundle later. If a compact mesh packet is introduced, both paths remain compiler outputs from the same bundle; TS does not recreate structural geometry math.

## Frozen compile and `/play` flow

```text
saved v5 architecture source
  → native normalization and wall compile
  → compile_cache keys = source hash + compiler version + tuning/catalog hashes
  → content-addressed generated wall assets
  → existing frozen-world targets
      ├─ render/mesh instances
      ├─ colliders + cover
      ├─ doors + navigation portals/blockers
      ├─ room/visibility/audio data
      └─ material assignments
  → gamefile/mapfile package
  → /play reads frozen products only
```

Opening drag and wall mutation run only in the editor/test environment. `/play` can animate door transforms/state and renderer parameters, but cannot re-topologize walls or mint geometry.

## Error and diagnostic flow

Every failed mutation returns `{ code, message, entityIds, worldPoint? }`. The adapter maps known codes to UI messages and highlight overlays. Unknown packet versions, invalid counts, stale source revisions, and native validation failures are hard failures at the deep boundary. They do not fall back to a second TypeScript topology algorithm.

Compile diagnostics are attached to stable source IDs and targets, so selecting an error can focus the responsible edge/opening/room marker in the editor.
