# Phase 1 — Inventory

Ownership categories used below: `catalog` is user-facing material metadata; `generator` owns source-to-registry conversion; `generated-runtime` is derived GPU data; `editor-ui` presents or edits materials; `package-data` persists reusable or model-local image data; `runtime-consumer` renders selected recipes; `tests` verify contracts.

## Measured catalog

- `cart/editor/render3d/shaders/materials/*.wgsl`: 410 tracked material sources, 16,662 total lines. Headers classify 325 as `surface`, 58 as `composition`, and 27 as `gradient`; all 410 declare `@name`, `@board`, and `@kind`.
- The 410 files occupy 15 boards: neon_surface 59, environment 57, props 54, wood_brick_stone 43, wallpapers 41, gradients 29, metal_yard 27, liminal 25, street_ground 12, neon_rot 12, second_pass 11, contraband 11, wall_props 10, condemned 10, facades 9.
- Exact function and ShaderSpec string-literal search outside the catalog/generator finds 18 material functions with direct dependencies: `alley_concrete`, `asphalt`, `brick`, `concrete`, `grass`, `lava_plasma`, `mud`, `plaza_terrazzo`, `refuse`, `road`, `rot_siding`, `sand`, `sidewalk`, `sidewalk_grid`, `sidewalk_pavers`, `sidewalk_utility`, `water`, `wood`.
- The direct set is closed under material-to-material calls: `alley_concrete -> concrete` and `sidewalk_utility -> sidewalk_grid` are the only internal edges. `rot_siding` is retained because `b-rot-siding` is the Color Studio's exact default ShaderSpec id.
- Exact JSON-value search finds model data referring to `grass` and `lava_plasma`; no saved generated ShaderSpec id was found in `cart/editor/data/**/*.json`.

## Files and ownership

| Path | Lines | Ownership | Purpose | Fragility |
|---|---:|---|---|---|
| `cart/editor/render3d/shaders/materials/*.wgsl` | 16,662 / 410 files | generator input | One independently deletable material function per file | high: generated registry and every shader consumer derive from the folder |
| `cart/editor/render3d/shaders/build-shaders.ts` | 393 | generator | Validates headers, preserves stable numeric ids, extracts palette slots, emits registry and dispatch | high: sole parser/emitter |
| `cart/editor/render3d/shaders/boards.ts` | 43 | catalog | Stable 15-board numeric taxonomy | high: GPU ids include board index |
| `cart/editor/render3d/shaders/helpers.wgsl` | 285 | generator input | Shared WGSL helpers used by retained functions | high: all generated functions compile with it |
| `cart/editor/render3d/shaders/_generated/ids.json` | generated table | generated-runtime | Append-only stable `(fn, board, index)` tombstones | high: saved numeric bindings depend on it |
| `cart/editor/render3d/shaders/_generated/registry.ts` | 1,290 | generated-runtime | 410 material metadata rows and board view | high: catalog, ground, and live regions import it |
| `cart/editor/render3d/shaders/_generated/dispatch.ts` | 15,853 | generated-runtime | Shared helpers, all functions, and dispatch | high: GPU compile source |
| `cart/editor/render3d/shaders/index.ts` | 112 | generated-runtime | Exposes `FILL_FUNCS`, `FILL_MAIN_SRC`, `FILL_SHADER` | high: common entry contract |
| `cart/editor/render3d/shaders/compose.ts` | 153 | runtime-consumer | Splits generated source and composes only requested functions | high: ground, thumbnails, and live regions call it |
| `cart/editor/textures/shaders.ts` | 501 | catalog | Builds `ShaderSpec`s, presets, categories, imported-spec registry, lookup/groups | high: many UI and bake callers |
| `cart/editor/textures/shaderPick.ts` | 34 | catalog | Converts a spec/variant into brush data | medium |
| `cart/editor/data/texturePackage.ts` | 222 | package-data | Existing reusable imported-image package and dynamic ShaderSpec adapter | high: canonical shared image asset already exists |
| `cart/editor/dialogs/ImportImageDialog.tsx` | 119 | editor-ui | Existing pixel-vs-exact image import decision | medium |
| `cart/editor/data/uvTextureWorkspace.ts` | 328 | package-data | Pure signed layer document, transforms, hit testing, compositing | high: model-local authoring document |
| `cart/editor/data/uvTextureWorkspaceStore.ts` | 160 | package-data | Content-hashed model-local PNG installation and workspace IO | high: integrity boundary |
| `cart/editor/inspector/UvEditor.tsx` | 2,274 | editor-ui | UV selection/transform, face isolation, image-layer placement, compile controls | high: target interaction surface |
| `cart/editor/stage/ModelView.tsx` | 5,036 | runtime-consumer | Live atlas bridge; add/edit/compile image layers | high: host mutation boundary |
| `cart/editor/inspector/ModelShaderBucket.tsx` | 288 | editor-ui | Model brush procedural/imported material browser | medium |
| `cart/editor/shell/PaintSidePanel.tsx` | 388 | editor-ui | Canvas/facade shader ink browser | medium |
| `cart/editor/render3d/groundFormula.ts` | 496 | runtime-consumer | Ground defaults, saved bindings, per-used-set composition | high: world rendering |
| `cart/editor/render3d/regionFormula.ts` | 134 | runtime-consumer | Per-model live animated material regions | high: placed model rendering |
| `cart/editor/inspector/RigSection.tsx` | 438 | editor-ui | Binds live materials to face slots | medium |
| `cart/editor/stage/MapTexturePicker.tsx` | 68 | editor-ui | Chooses ground material bindings | medium |
| `cart/editor/shell/MaterialPickerPopover.tsx` | 101 | editor-ui | Shared ground/live material picker | medium |
| `cart/editor/shell/ShaderGridBatch.tsx` | 113 | editor-ui | Batches procedural thumbnail draws | medium |
| `cart/editor/render3d/groundFormula.test.ts` | 120 | tests | Stable ids/composition/fallback contracts | high test coverage |
| `cart/editor/model/modelTextureSlots.test.ts` | existing | tests | Face-slot compile contract | medium |
| `cart/editor/inspector/uvWorkspace.test.ts` | 28 | tests | UV workspace interaction contract | medium |
| `cart/editor/textures/texturePackage.test.ts` | new | tests | Exact-image patch catalog contract | medium |

## Existing capabilities (facts)

- Imported exact images already persist once under `cart/editor/data/textures/<slug>/image.<ext>` and load through `loadTexturePackages()`.
- UV image sources already persist as immutable SHA-256 PNGs under each model's `atlases/uv-sources/`; the workspace manifest retains editable layer placement and compiles to one atlas.
- The UV editor already receives the 3D selection as `selectedIslands`/`selectedFaces`, can transform multi-island selections, and has one-face double-click isolation.
- There is no current UI path from an imported texture package to a model UV workspace layer. Adding a layer always opens a file picker or accepts a raw path through the bridge.
- Procedural materials and imported images currently share `ShaderSpec` and the same browser shelves; the generated materials account for nearly all entries.
