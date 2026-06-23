# HMSC-INT Architecture and Studio Asset Pipeline

Last updated: 2026-06-15

## Purpose

This document captures the current architecture direction for `cart/hmsc-int`,
the role of `editors/model/Studio.tsx`, and the intended compiled asset pipeline:
Studio-built shapes should compile into game asset files that behave like BSP
files, but for props, items, vehicles, vehicle parts, and clothing.

The core idea is:

```
editable source -> Compile -> cooked installable game asset -> referenced by maps/game data
```

The compiled asset is not a loose OBJ with sidecar metadata. It is a versioned,
runtime-oriented asset container with geometry, materials, collision, mounts,
and typed gameplay descriptor data.

## Ground Rules From The Game Architecture

The design follows the existing HMSC rulings:

- `hmsc-int` is the Hammer/Studio-style editor for the game platform.
- The engine is a stateless Zig runtime that runs data.
- A game is data, not per-game code.
- Compile bakes authoring data into installable runtime data.
- Missing behavior is added as an engine/game capability, then parameterized by
  asset data. It is not added as per-asset scripts.
- Map/game files should refer to compiled assets by id/hash wherever possible,
  instead of embedding duplicate geometry.
- Runtime dynamic shapes are not the default. Runtime variation should be
  transforms, instance parameters, uniforms, or newly installed authored assets.

That means a compiled `.prop`, `.item`, `.vehicle`, `.vehiclepart`, or
`.clothing` file should be treated like a cooked game artifact, not like an
editable project file.

## HMSC-INT In The Toolchain

`cart/hmsc-int` is the internal game-authoring cart. Its broad responsibilities
are:

- World authoring: painting tiles, terrain, zones, markers, placed objects, and
  build pieces.
- Build authoring: semantic walls, floors, ramps, roofs, doors, windows,
  prefab-like compositions, and gameplay overlays.
- Model authoring: Studio modeling for custom shapes and reusable assets.
- Character, clothing, item, vehicle, material, story, mission, cutscene, and
  settings authoring through workbench/editor surfaces.
- Preview and test: live preview uses the same game systems and render paths as
  the compiled game wherever possible.
- Compile: turns editor state into game data that the runtime can install and
  load.

The editor should not invent a second schema beside the game. Authoring surfaces
stage data that compile can lower into the same runtime systems the game uses.

## Existing Game Systems Relevant To Assets

The compiled asset pipeline touches several existing game domains:

- `game/kinds`: semantic registries for tiles, props, NPCs, roles, landforms,
  and other kind data.
- `game/items`: item definitions, item geometry, item slots, use data, and
  inventory-facing semantics.
- `game/vehicle`: vehicle documents, vehicle parts, sockets, build vocabulary,
  and runtime assembly rules.
- `game/figure`: character bodies, rigs, garments, parts, skeletons, clothing,
  and render surfaces.
- `game/build`: semantic architectural pieces and prefab-like compositions.
- `game/world`: world substrate, placements, landforms, colliders, cells, and
  runtime world data.
- `compile`: bakes the editor state into runtime-loadable game data.
- `runtime/workspace/rle.ts` and lump/container work: the existing direction for
  compact binary reference data and BSP-style lump containers.

The asset compiler should use these systems as capability boundaries. A custom
object compiled as an item should enter through item semantics. A custom car
door or tire should enter through vehicle-part semantics. A jacket should enter
through figure/clothing semantics.

## Studio Modeling Role

`cart/hmsc-int/editors/model/Studio.tsx` is the modeling surface. It should be
understood as the asset-source editor, comparable to the editable project side of
a traditional content pipeline.

Studio's source data is expected to include:

- Editable mesh or part geometry.
- Vertices, faces, normals, and UV data.
- Materials and texture atlas assignments.
- Pivot information.
- Named mounts/sockets.
- Selection/editing state.
- Possible rig/attachment authoring for clothing, characters, or vehicle parts.
- Preview metadata useful to the editor.

Studio source is not the runtime format. The source should remain friendly to
editing, undo, authoring history, and future tooling. Compile should turn that
source into a strict cooked asset.

## EditMesh As The Single Asset Modeling IR

`editors/model/editMesh.ts` should become the single intermediate
representation for authored asset geometry.

That does not mean every world system becomes a mesh editor. Semantic systems
stay semantic:

- Build pieces remain `game/build` data.
- Map paint remains map/world data.
- Terrain, roads, water, zones, rooms, triggers, and markers remain world
  systems.
- Prefabs made from semantic build pieces continue to decompose to those pieces.

The consolidation target is narrower and stricter: when the thing is an authored
asset shape that may compile as a prop, item, vehicle, vehicle part, clothing
piece, or other reusable model, its editable geometry should enter Studio as
`EditMesh`.

This makes `EditMesh` the one shape language for asset authoring:

```
existing 3D source -> import/capture adapter -> saved StudioModel scene -> EditMesh parts
EditMesh -> preview/lower/compile -> cooked asset lumps
```

In this document, "import" does not mean adding another authoring approach to the
editor. It means one-way capture into a saved Studio model/scene:

1. Read an existing prop, recipe, assistant scene, voxel blockout, imported OBJ,
   or other source.
2. Convert it into `StudioModel` data containing named `EditMesh` parts.
3. Save that scene through `modelStream`.
4. Continue editing, compiling, and cataloging only from the saved Studio scene.

After an approach can produce a saved Studio scene and that scene can compile,
the old approach should stop being a live authoring path. It may remain as a
read-only capture source until the user deletes or archives it, but new work
should not extend it and compiled assets should not point back to it.

## Existing 3D Approaches To Import

The repo currently has several useful 3D approaches. The goal is to capture the
value from each into `EditMesh`, then retire the duplicate authoring surface or
duplicate runtime path.

The output of every import is a Studio scene saved in the model library. The old
source is consumed to create that scene; it is not kept as a co-equal source of
truth.

## Settled Import Policy

These policies are settled for the first prop/model consolidation pass:

- Existing props import as one saved Studio scene per prop kind.
- Imported scenes live in the same Studio model library as handmade scenes.
  There is no special imported shelf or second library.
- The importer may preserve, merge, split, or restructure source parts as needed.
  There is no guarantee that old part boundaries survive the import.
- Source part ids, recipe ids, and old material/texture target names should be
  kept as metadata when useful, but metadata does not constrain the new scene.
- There is no side-by-side parity review requirement before retiring an old prop
  path. The goal is to get the old shape into Studio, save it, compile it, and
  make Studio the only continuing authoring path.
- Existing material slots should be carried into Studio material slots. The
  importer does not need a new material system.
- Import reports are metadata on the saved Studio scene. They do not need to be a
  first-class UI surface unless debugging later proves that useful.
- Missing Studio primitives come first. If an old source needs a sphere, torus,
  or another unsupported shape, add the native `EditMesh` constructor first; do
  not start migration by inventing a fallback asset format or a second authoring
  path.

### Studio Native Meshes

Status: already the target.

`Studio.tsx`, `studioModel.ts`, `modelStream.ts`, `Outliner.tsx`, `UVPanel.tsx`,
`TextureAtlas.tsx`, `textureize.ts`, `meshSelect.tsx`, `meshGizmo.tsx`, and
`meshRig.tsx` should remain the asset-modeling spine.

The source of truth is:

- `StudioModel`: a model document containing ordered parts.
- `StoredPart`: a named part with an `EditMesh`.
- `EditMesh`: vertices, n-gon faces, UVs, material slots, pivot, and mounts.
- Lowering: `editMeshToGeometry` for preview and cooked mesh output.

All imported asset shapes should become Studio parts, not parallel model records.

### Primitive Scene3D Meshes

Sources include raw `Scene3D.Mesh` uses in labs, viewers, quick prototypes, and
assistant-generated scenes.

Import rule:

- A source group becomes one saved Studio model.
- Each source mesh becomes one named Studio part unless the importer deliberately
  merges parts and reports that merge.
- `Box` -> `cuboid`.
- `Cylinder` -> `cylinder` with segment count preserved when known.
- `Cone` -> `cone`.
- `Plane` -> `plane`.
- `Sphere` -> native `EditMesh` sphere constructor.
- `Torus` -> native `EditMesh` torus constructor.
- Any other primitive -> add the native `EditMesh` constructor first, then
  import.

Transforms must be baked into vertex positions during import unless the source
part is intentionally preserved as a separate Studio part. Materials become
material slots. Source ids become part names where possible.

The old raw `Scene3D.Mesh` surface is not a durable asset format. It is a capture
source.

### Assist3D Scene JSON

`assist3d/scene.ts` currently defines a small assistant-authored scene schema:
`Box`, `Sphere`, `Cylinder`, `Cone`, `Torus`, and `Plane` meshes with params,
material, position, rotation, and scale.

That schema is useful as an AI prompt/output vocabulary, but it should not remain
an asset format beside Studio.

Import rule:

- Assistant output writes the simple JSON scene as it does today.
- An `Import to Studio` step converts the whole `SceneSpec` into one saved Studio
  model.
- Every `MeshSpec` becomes a named Studio part.
- The result is saved through `modelStream` and appears in the Studio model
  library.
- Further edits happen only through Studio/EditMesh.
- Compiling an assistant scene requires first importing it into Studio.

Retirement rule:

- `assist3d` may remain a prompt-to-blockout generator.
- The exported/compiled artifact must come from the Studio model, not raw
  `assist3d/scene.json`.
- Any object explorer/viewer for assistant meshes should offer conversion into
  Studio instead of becoming another asset editor.

### Prop Recipes And DataProp

The prop recipe path is valuable because it already expresses many props as data
parts and shares render/bake behavior through `resolvePropParts`,
`DataProp`, and `TexturedParts`.

Import rule:

- An existing prop kind or recipe imports into one saved Studio model/scene.
- Each `PropPartSpec` may become a Studio part, or multiple source parts may be
  merged into fewer cleaner Studio parts. Preservation is allowed but not
  required.
- `shape: box` becomes a cuboid mesh.
- `shape: cylinder8` or `cylinder16` becomes a cylinder mesh with matching sides.
- `shape: sphere` becomes a native `EditMesh` sphere.
- `local`, `size`, and `rotation` bake into part geometry or part transform.
- `partId` becomes import metadata, the Studio part name, or a texture target
  label when useful.
- `color` becomes the initial material slot.
- Existing per-part texture targets become UV/material data on the imported
  mesh.

Retirement rule:

- During migration, prop recipes can be treated as source generators.
- After import, new authored props should be Studio models compiled to `.prop`.
- The duplicate bespoke per-prop render/compiler dispatch should shrink to a
  loader for compiled prop assets.
- Existing recipe files may remain only as seeds, tests, or migration fixtures.

### Imported OBJ/GLB Props

`render3d/props/ImportedProp.tsx` and raw assets such as `.obj`, `.mtl`, or
`.glb` should be import sources, not special runtime exceptions.

Import rule:

- Each imported file becomes one saved Studio model unless the user explicitly
  splits it.
- OBJ/GLB meshes become one or more Studio parts.
- Vertex positions, normals, UVs, material assignments, and object/group names
  are preserved where possible.
- Triangles may remain triangular faces in `EditMesh`.
- Quads/ngons should be preserved if the importer can recover them; otherwise
  triangulated import is acceptable.
- Materials and texture refs become material/atlas data.
- Scale and up-axis conversion must be explicit in the import summary.

Retirement rule:

- Runtime should not need a separate "imported prop" path once compiled asset
  loading exists.
- Imported files are external source inputs. The cooked game consumes the
  compiled Studio asset.

### Item Sculpt And Voxel Blockout

The item workbench already has item, sculpt, and voxel lenses. Voxel blockout
data is stored as dimensions, cell size, and placed blocks.

Import rule:

- A voxel/sculpt source imports into a saved Studio model for the item shape.
- Voxel blockouts lower to an exposed-face `EditMesh`.
- Each visible face becomes a face loop with UV/material data.
- `cellSizeMeters` is preserved as import metadata and baked into vertex scale.
- Block kind becomes material slot or face material.
- Sculpt displacement, when present, becomes either vertex offsets or a named
  sculpt layer on the `EditMesh` once that layer exists.

Retirement rule:

- Voxel blockout may remain a fast authoring lens for rough item shapes, but the
  shape it produces should immediately materialize as a saved Studio model made
  of `EditMesh` parts.
- There should not be a separate voxel asset compiler beside the Studio asset
  compiler.
- Saved items should point at compiled asset ids or Studio model sources, not a
  second geometry document type long term.

This does not overrule the map-authoring voxel alternative. It only says
asset-shape voxel blockouts converge into `EditMesh` before asset compile.

### Building And Structure Meshes

Some world structures have sculpted render meshes in `render3d/buildingModels`,
`render3d/structures`, and related building render code.

Import rule:

- If the structure is a reusable asset-like object, import its visual parts into
  a saved Studio model as `EditMesh` parts.
- If the structure is semantic architecture, keep it in `game/build` and compile
  it through the build-piece pipeline.
- Do not collapse walls, doors, windows, rooms, portals, or cover semantics into
  opaque Studio meshes.

Retirement rule:

- Bespoke structure meshes should either become Studio-authored assets or remain
  generated output from semantic build data.
- They should not remain a third category of hand-authored runtime model code.

### Humanoid, Clothing, And Figure Parts

Humanoid render parts, garment shapes, face/head pieces, and clothing meshes
should import into Studio when they are authored as asset shapes.

Import rule:

- Body/garment mesh parts become a saved Studio model with Studio parts.
- Skeleton attachment anchors become mounts.
- Garment pivots and body-slot anchors become `EditMesh` pivot/mount data.
- Material regions become material slots and UV islands.
- Clothing-specific fields live in the `.clothing` descriptor, not in ad-hoc
  render code.

Retirement rule:

- The figure system remains the runtime owner for bodies, skeletons, pose, gait,
  and clothing application.
- Clothing shape authoring converges on Studio/EditMesh.
- Figure runtime code consumes compiled clothing/body assets by descriptor and
  mount data.

### Vehicle Parts And Vehicle Labs

Vehicle body parts, wheels, fenders, doors, seats, lights, and cosmetic panels
should converge into Studio-authored parts.

Import rule:

- A vehicle body or vehicle-part source imports into a saved Studio model.
- Each part mesh becomes a Studio part.
- Wheel centers, hinge points, seat anchors, and attachment sockets become mounts.
- Rotating parts get pivots.
- Joint travel/limits live on mounts where appropriate.
- Vehicle-part classification lives in the `.vehiclepart` descriptor.

Retirement rule:

- Vehicle behavior stays in `game/vehicle`.
- Vehicle shape authoring and part geometry converge on Studio/EditMesh.
- The vehicle compiler assembles compiled vehicle and vehicle-part assets from
  Studio geometry plus vehicle descriptors.

### Runtime Geometry Primitives

`@reactjit/geometries` primitives are the render/lowering vocabulary, not a
separate asset authoring schema.

Import rule:

- Primitive generators can seed saved Studio models and parts.
- `EditMesh` lowers back to `GeometryData` for preview.
- New primitive needs should be added as `EditMesh` constructors when they are
  authoring primitives.

Retirement rule:

- Runtime primitives remain useful as implementation helpers.
- Asset source should not be stored as arbitrary primitive calls once imported.

### Terrain, Roads, Water, And World Surfaces

Terrain heightfields, roads, junctions, water, grass population, and map paint
surfaces are not Studio asset meshes by default.

They remain world/map systems because their meaning comes from the world
substrate, pathing, materials, flow, occupancy, and gameplay overlays.

Only reusable decorative or interactive objects extracted from those systems
should become Studio assets.

## Import Adapter Requirements

Every importer into `EditMesh` should produce an import report:

- Source kind and source path/id.
- Saved Studio model id/name.
- Number of imported parts.
- Whether source parts were preserved, merged, or split.
- Unsupported source features.
- Scale and axis conversion.
- Materials/textures captured.
- Mounts/pivots inferred or missing.
- Whether the import is compile-ready.

Every importer should also be pure enough to test headlessly. The target tests
are:

- Import produces valid `EditMesh` topology.
- Lowering through `editMeshToGeometry` succeeds.
- Bounds match source within tolerance.
- Material/part ids survive.
- UVs survive when the source had UVs.
- Unsupported features fail loud instead of being silently dropped.

Importers must write into `modelStream` through normal Studio model events, so
undo, library rows, hot reload, and later compile all see the same saved Studio
scene. An importer that only renders an old source in the Studio viewport is not
complete.

## Retirement Gate For Old 3D Paths

An old 3D authoring path can be removed or frozen when:

1. Required `EditMesh` primitives for that source exist.
2. Its useful source data can import into a saved Studio model made of
   `EditMesh` parts.
3. The imported model previews correctly in the Studio native-camera viewport.
4. The imported model lowers to cooked asset lumps.
5. The relevant descriptor flow compiles it as `.prop`, `.item`, `.vehicle`,
   `.vehiclepart`, or `.clothing`.
6. Existing material slots and useful source metadata are carried into the saved
   scene.
7. Tests prove the conversion path.
8. The old route/file/path is marked retired, deleted, or moved to archive as a
   read-only reference.

The goal is not to keep every old shape system alive forever, and it is not to
prove a pixel-perfect side-by-side parity mode. The goal is to capture useful
source data into the one coherent Studio/EditMesh pipeline, save it as a Studio
scene, compile from there, and then remove the duplicate source of truth.

## Viewport Rule

Any imported or replacement 3D editor/viewer must use the ruled native camera
path:

- `Scene3D.Camera nativeCamera`
- `GAME_NATIVE_CAMERA.forNode(...)`
- JS sends rig/input changes.
- Zig owns per-frame solve/smoothing/interpolation.

No new JS-driven per-frame viewport camera path should be added while importing
old 3D approaches. If an old viewer depends on JS camera driving, conversion to
the Studio viewport is part of its retirement.

## Compile Button Workflow

The intended authoring UX is:

1. Build or import a shape in Studio.
2. Hit `Compile`.
3. Choose the output asset kind.
4. Fill out the fields required for that kind.
5. Compile emits a cooked asset file.
6. The asset is installed into the content store.
7. Maps, items, vehicles, clothing systems, and game data reference the compiled
   asset by id/hash.

The first menu should ask what the shape is becoming:

- Prop
- Item
- Vehicle
- Vehicle part
- Clothing

Each choice exposes a different typed descriptor. The geometry may be shared,
but the gameplay meaning is not.

## Asset Kind Descriptors

### Prop

A prop descriptor answers world-object questions:

- Is it static or dynamic?
- Does it block movement?
- Does it block sight or sound?
- Is it locked?
- Can it be opened?
- Does it have storage?
- Is it destructible?
- Does it provide cover?
- Does it have interaction points?
- Does it have physics mass or only baked collision?
- Which sockets/mounts are exposed for attachments?

The compiled output would usually be `.prop`.

### Item

An item descriptor answers inventory and use questions:

- Is it one-handed or two-handed?
- Is it equippable?
- Which slot does it occupy?
- Is it ammo, a weapon, a tool, a consumable, or a held prop?
- Does it have damage data?
- Does it have ammo data?
- Does it have durability?
- Does it have use actions?
- What are the grip points?
- What are the first-person/third-person hold offsets?
- What model or collision proxy is used when dropped?

The compiled output would usually be `.item`.

### Vehicle

A vehicle descriptor answers assembled-vehicle questions:

- Seat positions.
- Driver/passenger roles.
- Wheel sockets.
- Suspension points.
- Steering behavior parameters.
- Engine/fuel/electric capability data.
- Storage compartments.
- Damage regions.
- Door, hood, trunk, and panel sockets.
- Camera anchors.
- Exit/enter interaction points.

The compiled output would usually be `.vehicle`.

### Vehicle Part

A vehicle-part descriptor answers part attachment questions:

- Part class: tire, wheel, fender, door, hood, trunk, bumper, engine, seat,
  window, light, panel, or cosmetic piece.
- Compatible mount/socket types.
- Required orientation.
- Whether it affects physics, collision, mass, handling, or only visuals.
- Damage behavior.
- Replacement rules.
- Variant/style tags.

The compiled output could be `.vehiclepart` or a shorter extension if the tool
settles on one.

### Clothing

A clothing descriptor answers character attachment questions:

- Body slot: head, torso, legs, feet, hands, face, accessory, etc.
- Layering rule.
- Fit/body-shape compatibility.
- Skeleton or attachment anchors.
- Deformation or skinning data.
- Armor/warmth/concealment/gameplay tags.
- Material behavior.
- Hidden body regions, if the garment replaces body visibility.
- First-person and third-person visibility rules.

The compiled output would usually be `.clothing`.

## BSP-For-Assets Model

The useful mental model is: `.bsp`, but for game assets.

Traditional map pipeline:

```
editable map source -> compile -> .bsp -> game loads cooked map
```

HMSC asset pipeline:

```
Studio source -> compile -> .prop/.item/.vehicle/.clothing -> game loads cooked asset
```

The asset file should be:

- Versioned.
- Binary and runtime-oriented.
- Lump/table based.
- Forward-compatible where possible.
- Content-addressed after install.
- Validated before use.
- Referenced by maps and game data.
- Independent of editor-only source state.

Unknown lumps should be skippable so older loaders can ignore newer editor
metadata when safe. Required gameplay/schema versions still need hard validation.

## Proposed Asset Container Shape

A compiled asset can use a BSP-style lump directory:

```
HEADER
  magic
  version
  asset kind
  schema version
  content hash
  flags

LUMP_DIRECTORY
  lump id
  offset
  byte length
  encoding
  required/optional flag

MESH
  raw aligned vertex/index data
  normals
  tangents if needed
  UV sets

MATERIALS
  material records
  atlas refs
  texture refs
  shader/material params

COLLISION
  bounds
  hulls
  primitive colliders
  interaction volumes
  cover/occlusion hints if applicable

MOUNTS
  pivot
  sockets
  grips
  wheel anchors
  clothing anchors
  named attachment points

GAMEPLAY_DESCRIPTOR
  prop, item, vehicle, vehicle-part, or clothing fields

DEPENDENCIES
  referenced assets/textures/materials by hash/id

PREVIEW
  thumbnail
  editor summary
  bounds
  optional LOD metadata
```

The exact lump ids can be settled later. The important rule is that geometry,
materials, collision, mounts, and gameplay meaning are separate typed sections,
all packed into one installable asset.

## Source Versus Compiled Artifact

Studio source and compiled assets should not be confused.

Source should optimize for:

- Editing.
- Undo.
- Human-readable diffs where useful.
- Loose/incomplete state.
- Tool-only metadata.
- Future conversion and recompile.

Compiled assets should optimize for:

- Fast validation.
- Fast loading.
- Stable binary layout.
- Runtime references.
- Deduplication.
- Strict schema.
- Minimal parsing.
- No editor-only baggage.

This is the same distinction as VMF/MAP source versus BSP output, or Blender
source versus a cooked engine asset.

## Content Addressing And Installation

Compile should install compiled assets into the content store before maps or
game files consume them.

Expected behavior:

- The compiled byte content produces a hash id.
- Installing the same asset twice is idempotent.
- Different maps can reference the same asset without copying it.
- A map bundle may include embedded asset blobs when needed, but references are
  the default.
- The reference list doubles as a dependency manifest.
- Validation happens before runtime use.

This matches the map-format direction: install assets first, then load bodies
that are mostly references.

## One Shape, Multiple Compiles

The same Studio shape may produce multiple compiled assets.

Example:

```
source: studio/chair.model

compile as prop:
  chair.prop
  static seating prop, blocks movement, provides cover, has sit point

compile as item:
  chair.item
  two-handed carry object, throwable, damage on impact
```

The mesh and texture data may be identical or content-addressed to the same
underlying geometry blob. The descriptor is what changes the game meaning.

This is important because geometry does not define gameplay. Gameplay meaning
comes from the chosen compile target and the descriptor fields.

## No Per-Asset Scripts

Compiled asset files should not contain arbitrary scripts.

Allowed:

- Data fields.
- Engine-known behavior ids.
- Parameters for engine capabilities.
- References to shared capabilities.
- Static authored metadata.

Not allowed:

- Custom JavaScript in an asset.
- Custom Lua or other per-asset script payloads.
- Runtime code hidden inside `.item` or `.prop`.
- Behavior that exists only because one asset smuggled in a new interpreter.

If an asset needs a behavior the engine cannot express, that is a missing engine
or game capability. Add the capability, then expose it as compile-time data.

## Relationship To Maps

Maps should not embed every asset's full geometry in every placement. They
should reference compiled asset ids.

A map placement should look conceptually like:

```
asset: hash/chair_prop
position: x, y, z
rotation: yaw/pitch/roll
scale or allowed instance params
instance overrides
```

The asset owns its cooked geometry, material defaults, collision, and gameplay
descriptor. The placement owns where and how this instance appears in the world.

This keeps large maps small and lets shared assets amortize across maps.

## Relationship To The Existing Compile Path

The current compile direction already treats the game as baked data:

- Editor data is staged in hmsc-int.
- Compile produces runtime-loadable game data.
- Map/world output uses reference-oriented binary/RLE concepts.
- The loader constructs the game from data.

The Studio asset compiler should become another compile input beside world,
build, items, vehicles, clothing, and texture/material data.

Conceptually:

```
hmsc-int data streams/snapshots
  world data
  build pieces
  model sources
  item descriptors
  vehicle descriptors
  clothing descriptors
  materials/textures
        |
        v
Compile
        |
        v
installable assets + map/game RLE data
        |
        v
Zig loader/runtime
```

## Authoring Capability Target

The full authoring target is:

- Build a shape in Studio.
- Define pivots and sockets.
- Paint or assign textures.
- Preview collision and bounds.
- Choose compile kind.
- Fill out kind-specific gameplay fields.
- Validate required fields before compile.
- Generate a cooked asset file.
- Install it into the content store.
- Make it available in the relevant palette/catalog.
- Place it in the world or equip/attach/use it through the game system that owns
  that asset kind.

The editor should make the asset's meaning explicit at compile time. A tire is
not just a cylinder mesh. It is a vehicle part with wheel/tire mount rules and
maybe handling implications. A jacket is not just a torso mesh. It is clothing
with slots, layers, body fit, and figure attachment data.

## Validation Rules

Every compile target should validate the descriptor against its required fields.

Examples:

- A prop with storage must define storage capacity and interaction rules.
- A locked prop must define lock kind or lock state data.
- A weapon item must define grip, damage, and use/ammo behavior.
- A vehicle must define enough sockets/seats to be usable.
- A tire must define a compatible wheel socket.
- Clothing must define body slot and attachment data.

Validation should fail loud during compile. Runtime should not discover that a
compiled asset is missing basic required data.

## Practical Implementation Shape

A likely implementation path:

1. Keep Studio source as the editable model document.
2. Add an asset compile dialog in Studio.
3. Define a common `CompiledAssetDescriptor` envelope.
4. Define per-kind descriptor schemas for prop, item, vehicle, vehicle part, and
   clothing.
5. Lower Studio geometry into mesh/material/collision/mount lumps.
6. Lower the selected descriptor into the gameplay descriptor lump.
7. Write a versioned binary lump container.
8. Install the output by content hash.
9. Add palette/catalog ingestion so compiled assets appear in the right editor
   shelves.
10. Add loader validation and tests for each kind.

The first version can be deliberately small. The key is to establish the source
versus cooked boundary and the common container contract early.

## Open Design Choices

These choices can be settled during implementation:

- Final file extensions for vehicle parts: `.vehiclepart`, `.vpart`, or another
  convention.
- Whether the compiled files are separate standalone files, entries inside a
  PAK-style bundle, or both.
- Exact binary lump ids.
- Required versus optional lump policy.
- How LODs are authored and stored.
- Whether descriptors are text keyvalues, binary schema rows, or a hybrid.
- Which fields are engine-level and which are HMSC-specific game data.
- How imported OBJ/GLTF assets map into Studio source before compile.

The important settled direction is not the spelling of every field. It is that
assets compile into cooked data containers and the game consumes those containers
by reference.

## Summary

The desired system should behave like BSP files for assets:

- Studio is the editable source.
- Compile chooses the asset kind and captures gameplay meaning.
- The output is a cooked, versioned, installable file.
- The file contains separate lumps for geometry, materials, collision, mounts,
  dependencies, preview data, and a typed gameplay descriptor.
- Maps and game data reference compiled assets by id/hash.
- Behavior is engine capability plus data, not scripts hidden in assets.

That gives HMSC a real mod/content pipeline: author visually, compile strictly,
install once, reference everywhere, and let the stateless runtime construct the
game from data.
