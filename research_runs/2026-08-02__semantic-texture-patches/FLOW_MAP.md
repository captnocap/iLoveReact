# Phase 3 — Live Flow Map

## Reusable image to model atlas

`File/Explorer image import` -> `ImportImageDialog` -> `saveExactImage` -> `cart/editor/data/textures/<slug>/image.*` -> `loadTexturePackages` -> **missing link** -> `ModelView.addUvTextureLayer(path)` -> `importUvTextureWorkspaceLayer` -> model-local content-hashed PNG -> `UvEditor` image/UV transforms -> `compileUvTextureLayers` -> `__model_atlas_workspace_apply` -> `atlases/base.png` -> one runtime model texture.

The missing link is the only new data route. Image decoding, storage, UV manipulation, compositing, and runtime atlas application are already live.

## Procedural material generation

`materials/*.wgsl` -> `build-shaders.ts` + append-only `ids.json` -> `_generated/registry.ts` + `_generated/dispatch.ts` -> `compose.ts`.

From `compose.ts` the live paths branch:

- `groundFormula.ts` -> map ground material bindings and ground formula.
- `regionFormula.ts` -> rig face slots with per-frame object-projected materials.
- `textures/shaders.ts` -> model/facade paint browsers and paint bakes.
- `ShaderGridBatch`/`MaterialPickerPopover` -> thumbnails only.

The 392 candidates have no direct code literal, saved model value, or transitive dependency. Their only live path is dynamic enumeration by the catalog itself.

## Dead/redundant path after migration

Generated novelty material -> `ShaderSpec` -> model paint thumbnail -> bake a tiny procedural appearance into the atlas. This path is replaced for reusable modeled parts by imported texture patch -> isolated UV placement -> atlas compile. The actual paint engine remains because imported ShaderSpecs, stencils, mission codes, and deliberate procedural brushes still use it.
