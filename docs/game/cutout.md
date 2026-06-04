# cutout cart inventory

Source cart: `cart/cutout/`

Reviewed: 2026-06-04

## High-level purpose

`cart/cutout` is a full image cutout and shader-quad-image editor. It is closer to a production tool than a small lab cart: it loads an image or creates a blank canvas, lets the user build a stack of mask layers, supports smart selection through either ImageMagick flood fill or MobileSAM/ONNX, lets the user clean masks with brush/lasso/refine tools, previews selected regions through GPU shader overlays, and exports PNG cutouts, pixel-icon JSON, or self-contained `.sqi.json` documents.

The active app is not browser React. It uses ReactJIT primitives (`Box`, `Row`, `Col`, `Canvas`, `Image`, `Paintable`, `Effect`, `Pressable`, `TextInput`, `TextArea`) and runtime hooks that bridge to host capabilities. It does not use DOM APIs, HTML canvas APIs, `document`, `window`, browser `fetch`, or `localStorage`.

The central design is a unified layer stack. Every layer owns two full-resolution GPU mask textures:

- `base`: smart-selection mask, rebuilt from the layer's click history.
- `brush`: manual override mask, written by brush/lasso/refine and composed on top of `base`.

The final removed region is the union of every visible layer's effective mask. The effective rule is: force-remove wins, force-keep cancels the base, otherwise the smart base decides.

## Files in this cart

- `cart/cutout/index.tsx`: app shell and main layout.
- `cart/cutout/state.ts`: active state model, mask editing, layer operations, backend wiring, autosave, restore, keyboard shortcuts, and exports.
- `cart/cutout/domain.ts`: shared type vocabulary for layer configs, composition layers, layer targets, and export surfaces.
- `cart/cutout/history.ts`: undo/redo stacks over session snapshots.
- `cart/cutout/session.ts`: active working-session document format, v2.
- `cart/cutout/session_old.ts`: legacy working-session document format, v1.
- `cart/cutout/sqi.ts`: self-contained shader quad image format.
- `cart/cutout/rle.ts`: compatibility shim that re-exports the shared workspace RLE codec.
- `cart/cutout/mask.ts`: pure CPU mask/geometry helpers.
- `cart/cutout/magick.ts`: ImageMagick subprocess helpers for image dimensions, grayscale loading, PGM mask encoding, and PNG compositing.
- `cart/cutout/icons.ts`: ImageMagick-based pixel-icon and base-matrix export helpers.
- `cart/cutout/theme.ts`: shared colors and layout sizes.
- `cart/cutout/backends/types.ts`: smart-selection backend interface.
- `cart/cutout/backends/flood.ts`: ImageMagick flood-fill backend.
- `cart/cutout/backends/sam.ts`: MobileSAM/ONNX backend adapter.
- `cart/cutout/components/TopBar.tsx`: title strip, file/export toolbar, brush-size slider, context menu, and host window controls.
- `cart/cutout/components/Tools.tsx`: left tool palette, erase/restore modes, clear/invert actions, and global color slots.
- `cart/cutout/components/Editor.tsx`: center canvas, source image/blank canvas, `Paintable` texture holders, mask shader overlays, pointer-to-source conversion, brush/lasso/smart input, cursor HUD, lasso preview, and click markers.
- `cart/cutout/components/Inspector.tsx`: right properties panel, backend settings, FX surface gallery, layer parameters, source/canvas properties, layer stack UI, and custom WGSL modal.
- `cart/cutout/components/MaskQuad.tsx`: shader overlay renderer and built-in mask surface catalog.
- `cart/cutout/components/ShaderQuadImage.tsx`: standalone renderer for `.sqi.json` documents.
- `cart/cutout/components/StatusBar.tsx`: bottom status strip and telemetry/read-only stats.
- `cart/cutout/components/Editor_old.tsx`: legacy editor snapshot for the previous mask architecture.
- `cart/cutout/components/Inspector_old.tsx`: legacy inspector snapshot for the previous mask architecture.
- `cart/cutout/state_old.ts`: legacy state hook for the previous global-brush plus smart-layer architecture.

There is no `cart/cutout/cart.json` in the current directory. The cart depends on the default directory-cart entry behavior through `index.tsx`.

## App shell

`cart/cutout/index.tsx:1-8` describes the intended layout: top file bar, left tool palette, center editor, right inspector, bottom status bar, fixed viewport, no scrolling.

`CutoutApp` at `cart/cutout/index.tsx:20-47`:

- calls `useCutoutState()` once and passes the resulting state object down to pure UI components;
- owns only `effectDraft`, the local modal state for adding custom FX;
- renders `TopBar`, `Tools`, `Editor`, `Inspector`, and `StatusBar`;
- renders `EffectModal` when the inspector opens a custom shader draft;
- wires `EffectModal.onAdd` to `s.addCustomSurface(label, shader)`, applies the new surface id to the draft target, then closes the modal.

## State model

`cart/cutout/state.ts` is the single source of truth for active behavior. Its header at lines 1-25 explains the current architecture: one layer stack, two mask textures per layer, direct GPU writes for brush dabs, and RLE/readback only at commit/export boundaries.

Core types and constants:

- `Mode` at line 58: `erase` or `restore`.
- `Tool` at line 59: `brush`, `smart`, `hand`, `lasso`, or `refine`.
- `BackendName` at line 61: `flood` or `sam`.
- `OVERLAY_RES` at line 66: 128, used for `.sqi` layer masks and preview grids.
- backend defaults at lines 68-71: flood fuzz, flood reject radius, SAM threshold, and SAM mask candidate.
- brush sizes at line 72: `2`, `8`, `32`, `128`, `512`.
- brush override values at lines 76-79: force-remove writes `1.0`, force-keep writes `0.5`.

`Layer` at lines 83-97 has:

- `id`, `name`, and optional `groupName`;
- `config`, a `LayerConfig` from `domain.ts`;
- `baseId`, the paintable id for the smart-selection base texture;
- `brushId`, the paintable id for manual override texture;
- `clicks`, the smart-select click history.

Important local helpers:

- `baseIdFor` and `brushIdFor` at lines 99-100 build stable paintable ids from layer ids.
- `scaleMask` at lines 105-109 converts backend `0/1` masks to `0/255` bytes for R8 texture sampling.
- `effectiveMask` at lines 114-123 composes `base` and `brush` bytes into a binary CPU mask for export, snapshotting, merge, and invert.
- `defaultConfig` at lines 249-261 creates visual FX config for new layers from global defaults.
- `cloneConfig` at lines 263-265 copies layer config without sharing the color array.

`CutoutState` at lines 125-234 is the public state API consumed by components. It exposes source identity, status, tool config, lasso ops, layer ops, smart-selection controls, FX defaults, export actions, autosave metadata, undo/redo, and layer clipboard operations.

## Active state flow

`useCutoutState` starts at `cart/cutout/state.ts:267`.

Source state:

- `srcPath`, `stem`, `srcDims`, and `isBlank` at lines 268-273.
- `status`, `busy`, and `savedPath` at lines 274-276.
- `tool`, `mode`, `brushPx`, `lassoPoints`, and `maskVersion` at lines 277-281.

Layer state:

- `layers` and `setLayers` at lines 284-286.
- `activeLayer` and `setActiveLayer` at lines 287-293.
- pending CPU-to-GPU uploads at lines 295-309. These queue mask bytes until the matching `<Paintable>` nodes are mounted, then upload through `paintableOps(id).upload(bytes)`.

FX default state:

- `effectMode`, `effectColors`, `effectHueOffset`, `effectPhaseOffset`, and `effectDim` at lines 312-316.
- refs mirror those values at lines 317-321 so new layer creation can read current defaults inside callbacks.
- `customSurfaces` at line 322.

Dirty/snapshot state:

- `clipboard`, `lastSavedAt`, and `restoredFrom` at lines 324-326.
- mask dirty tracking at lines 328-341.
- `grayRef` caches source grayscale data for edge snapping at line 343.
- `tokenRef` and `smartTokenRef` protect async image/refine work from stale completions at lines 344-345.

Smart backend state:

- `samAvailable` at line 350 checks whether ONNX segmentation host support exists.
- `makeBackend` at lines 351-352 selects SAM only when available, otherwise flood.
- `backendRef` stores the active `SelectionBackend` at line 354.
- flood and SAM tunables live at lines 355-362.
- `buildBackendOpts` at lines 363-368 passes every backend option to the selected backend.

History:

- `useHistory()` is called at line 371.
- `commit` and `commitCoalesced` at lines 372-373 snapshot current session state before meaningful mutations.

## Ingestion and canvas creation

`ingest(path)` at `cart/cutout/state.ts:445-475` loads a source image:

- closes the current backend and resets source/layer state;
- sets `srcPath`, `stem`, and loading status;
- calls `identify(path)` from `magick.ts` to get image dimensions;
- creates the first layer and opens the active selection backend;
- loads grayscale image bytes asynchronously via `loadGrayImage` for edge-aware brush snapping.

`createBlankSurface(w, h)` at lines 477-497:

- clamps canvas dimensions;
- clears image path and backend state;
- creates a blank canvas with one layer;
- sets `isBlank` true and status text.

`setCanvasSize(w, h)` at lines 499-510:

- clamps dimensions to `16..4096`;
- resets layers to a fresh first layer;
- clears dirty state and bumps `maskVersion`.

`useFileDrop` at line 512 ingests a dropped file path.

## Brush, lasso, refine, and smart select

Brush/refine:

- `pressureRadius` at lines 515-519 turns pointer pressure into brush radius.
- `snapBrushPoint` at lines 520-526 optionally snaps brush/refine points to a strong Sobel gradient from the cached grayscale image.
- `beginStroke` at lines 528-534 commits a pre-stroke history snapshot and starts drawing.
- `endStroke` at lines 535-539 stops drawing and bumps the mask version.
- `paintDabAtSource` at lines 541-554 writes a circle directly to the active layer's `brushId` paintable through `paintableOps(layer.brushId).circle(...)`.
- `paintAtSource` at lines 555-574 interpolates dabs between pointer positions so fast strokes do not leave gaps.

Layer mask actions:

- `clearMask` at lines 576-585 clears both `base` and `brush` textures and click history for the active layer.
- `invertMask` at lines 587-603 reads the effective mask, inverts it into the base texture, clears brush overrides, and clears clicks.

Lasso:

- `addLassoPoint` at lines 606-616 adds source-coordinate vertices and auto-closes near the first point.
- `clearLasso` at line 617 clears pending vertices.
- `commitLasso` at lines 618-632 writes a polygon into the active layer's brush texture using `paintableOps(layer.brushId).polygon(...)`.

Smart select:

- `runRefine` at lines 635-654 calls `backendRef.current.refine(nextClicks, buildBackendOpts())`, uploads the returned mask to the active layer's `baseId`, and leaves brush overrides untouched.
- `addClick` at lines 656-663 records a keep/reject click on the active layer and immediately refines.
- `clearClicks` at lines 665-673 removes click history and clears the active layer base.

## Layer operations

Layer operations in `cart/cutout/state.ts` work on `layersRef.current` and use paintable readback/upload only at discrete operations:

- `addLayer` at lines 676-686 creates a new layer, selects it, and creates a blank canvas first if no source exists.
- `deleteLayer` at lines 688-701 removes a layer and clears its paintable textures.
- `duplicateLayer` at lines 703-721 reads base/brush textures, copies config and clicks, queues uploads for the new paintables, and inserts the duplicate after the source.
- `moveLayer` at lines 723-735 swaps layer order.
- `mergeLayer` at lines 737-761 unions the effective masks of layer `i` and the layer below into the lower layer base.
- `toggleLayerMute`, `setLayerName`, and `setLayerGroup` at lines 763-778 edit layer metadata.
- visual setters at lines 780-819 edit layer or global FX properties. Passing `i < 0` targets global defaults.
- `addCustomSurface` at lines 827-832 registers a custom WGSL surface with a generated `custom:<time>:<random>` id.

`setBackend` at lines 835-846 swaps between `flood` and `sam`, closes the old backend, opens the new one for the current source when possible, and refuses SAM when ONNX is unavailable. Cleanup at line 852 closes the backend on unmount.

## Exports and import

`composeExportMask` at `cart/cutout/state.ts:856-867` unions every unmuted layer's effective mask into one source-resolution `Uint8Array` where `1` means removed.

`saveCutout` at lines 882-894:

- requires a source image and non-empty mask;
- writes output to `cart/pixel_icons/<stem>.cutout.png`;
- delegates alpha composition to `compositeCutout` in `magick.ts`.

`saveIcons` at lines 896-907:

- requires a source image and non-empty mask;
- delegates to `exportIcons` in `icons.ts`;
- writes `cart/pixel_icons/<stem>.64.json`, `.128.json`, and `.512.json`.

`saveSqi` at lines 909-939:

- requires a source image and non-empty mask;
- bakes the base pixel matrix through `bakeMatrix`;
- converts each visible layer effective mask to a 128x128 cell set;
- calls `buildSqi` with layer configs and custom surfaces;
- writes `cart/pixel_icons/<stem>.sqi.json`.

`importSqi` at lines 941-992:

- optionally opens a Zenity picker via `execAsync`;
- reads and parses `.sqi.json`;
- creates a blank square canvas sized to the SQI document;
- adopts built-in/custom surfaces;
- inflates each SQI layer mask into a full-res base texture;
- queues paintable uploads and updates custom surface registry.

## Sessions, restore, undo/redo, and shortcuts

Session snapshots:

- `snapshotLayers` at `cart/cutout/state.ts:995-1005` synchronously reads each layer's base and brush textures through `paintableOps(...).readback()`.
- `buildCurrentSession` at lines 1007-1018 converts current app state into a `SessionDocument`.
- `applyDoc` at lines 1020-1074 restores a `SessionDocument`, reopens backend/grayscale resources, creates paintable upload work, restores layer state, FX defaults, custom surfaces, and status.

Autosave:

- restore-on-mount effect at lines 1076-1097 reads `cart/cutout/sessions/_last.txt`, then reads the pointed session file, parses it, and applies it.
- debounced autosave effect at lines 1099-1121 writes `cart/cutout/sessions/<stem>.session.json` and updates `_last.txt` after 600 ms.
- backend tunable changes trigger a debounced active-layer re-refine at lines 1123-1132.

Undo/redo:

- `undo` at lines 1135-1142 and `redo` at lines 1143-1150 apply snapshots from `history.ts` while temporarily suppressing autosave.
- `copyLayer`, `pasteLayer`, and `cutLayer` at lines 1153-1181 implement an in-cart layer clipboard with base/brush byte copies, config, and clicks.

Keyboard:

- `useIFTTT` bindings at lines 1183-1200 handle undo/redo, copy/cut/paste, tool hotkeys (`b`, `h`, `s`, `l`, `f`), mode hotkeys (`e`, `r`), lasso commit/cancel, and brush-size step keys (`[` and `]`).

File picker:

- `pickFile` at lines 1229-1239 uses `execAsync` to run a Zenity image picker and ingests the selected path.

## Domain types

`cart/cutout/domain.ts` centralizes shared shapes so state, session, and SQI export do not drift.

- Re-exports backend click types and mask surface types at lines 18-31.
- `LayerConfig` at lines 39-55 is the per-layer visual config: surface mode, blend, hue offset, phase offset, muted flag, color slots, and dim alpha.
- `BlendMode` and `BLEND_MODES` at lines 57-58 are `normal`, `add`, `multiply`, and `screen`.
- `CompositionLayer` at lines 64-75 models a composited layer entry with id, kind, name, group, source index, and visibility.
- `LayerTarget` at lines 84-87 is a typed target model for global/paint/smart.
- `layerTargetToIndex` at lines 89-95 maps those targets to the legacy numeric convention.
- `Surface` at lines 110-112 is the export-only self-contained surface union.
- `inflateSurface` at lines 114-119 converts a `SurfaceId` plus custom surface gallery into a self-contained export surface.
- `adoptSurface` at lines 124-133 imports a self-contained SQI surface into the in-memory custom surface gallery.

## Smart-selection backends

`cart/cutout/backends/types.ts` defines the backend contract:

- `ClickLabel` at line 9: `keep` or `reject`.
- `ClickPoint` at lines 11-15: source-pixel x/y plus label.
- `BackendOpts` at lines 22-29: flood fuzz, reject disk fraction, SAM threshold, and SAM mask index.
- `RefineResult` at lines 31-44: source-resolution mask, optional per-keep overlay layer cell sets, and overlay resolution.
- `SelectionBackend` at lines 46-62: `name`, `open`, `refine`, and `close`.

`cart/cutout/backends/flood.ts` is the always-available backend:

- imports `run`, `readFile`, `writeFile`, and `mkdir` host hooks at lines 12-13.
- `createFloodBackend` at lines 33-194 returns a backend object.
- `open` at lines 39-44 stores the source path/dims and creates `/tmp/_reactjit_cutout`.
- `refine` at lines 45-188 recomputes from complete click history each time.
- keep clicks call ImageMagick flood-fill at lines 78-98 using a magenta sentinel, fuzz tolerance, and PGM grid output.
- reject clicks draw a disk mask at lines 105-120 instead of flood-filling.
- final mask composition at lines 140-176 unions keeps and subtracts rejects.
- per-keep grid masks are parsed into `Set<number>` at lines 178-185.
- `parseP2PGM` at lines 201-214 parses ASCII PGM into `Uint8Array`.
- `parseP2PGMToCellSet` at lines 219-229 parses ASCII PGM into overlay cell indices.

`cart/cutout/backends/sam.ts` is the MobileSAM/ONNX backend:

- imports `openImage`, `refineSegment`, `closeImage`, and `isSegmentAvailable` from `useSegment` at lines 17-23.
- `createSamBackend` at lines 32-97 returns a backend object.
- `open` at lines 39-59 creates scratch dir, checks ONNX availability, closes any prior handle, and opens the source image.
- `refine` at lines 60-87 clamps clicks, passes threshold/mask index to `refineSegment`, and returns one fused mask with no per-keep layers.
- `close` at lines 88-95 releases the segment handle.

## ImageMagick and export helpers

`cart/cutout/magick.ts` is the ImageMagick seam:

- `SCRATCH_DIR` at line 7 is `/tmp/_reactjit_cutout`.
- `identify(path)` at lines 13-20 runs `magick identify -format '%w %h'`.
- `loadGrayImage(path, dims)` at lines 30-47 writes a raw grayscale file through ImageMagick, reads it back with the filesystem hook, and returns a `Uint8Array`.
- `encodeMaskPGM` at lines 52-62 builds a binary PGM string. It inverts the cart mask convention so ImageMagick alpha composition gets opaque/transparent correctly.
- `compositeCutout` at lines 67-89 writes a mask PGM and runs ImageMagick `CopyOpacity` to produce a PNG cutout.

`cart/cutout/icons.ts` bakes cutouts into pixel-icon matrices:

- `ICON_SIZES` at line 18 are `64`, `128`, and `512`.
- `ICON_QUANTIZE_COLORS` at line 19 is `64`.
- `parseTxt` at lines 32-55 parses ImageMagick `txt:` enumeration into a palette and pixel matrix.
- `bakeOne` at lines 78-98 runs ImageMagick to apply alpha, resize, quantize, and emit `txt:`.
- `bakeMatrix` at lines 111-118 writes one PGM mask and returns an encoded matrix for SQI base image embedding.
- `exportIcons` at lines 126-156 writes `cart/pixel_icons/<stem>.<size>.json` for each requested size.

`cart/cutout/mask.ts` is pure JavaScript/CPU logic:

- `paintCircle` at lines 5-27 fills a circle in a row-major `Uint8Array`.
- `sobelMagnitudeSq` at lines 29-43 computes a Sobel gradient magnitude.
- `snapToStrongGradient` at lines 45-75 finds the strongest nearby gradient for edge snapping.
- `paintCircleEdgeAware` at lines 81-108 paints only flatter pixels below a gradient threshold.
- `fillPolygon` at lines 110-146 scanline-fills a polygon.
- `hasAnyErased` at lines 148-151 checks whether a mask has any non-zero byte.
- `sampleToCells` at lines 155-181 downsamples a hi-res mask to a cell set.
- `rowRuns` at lines 187-199 coalesces cell sets into row runs. In the active editor path, shader texture sampling has replaced most old per-cell box usage, but the helper remains available.

`cart/cutout/rle.ts` simply re-exports `@reactjit/workspace/rle` at line 7. The local RLE codec was promoted to shared workspace code.

## Session format

`cart/cutout/session.ts` defines the active v2 working-session format.

On disk:

- `cart/cutout/sessions/_last.txt`
- `cart/cutout/sessions/<stem>.session.json`

Key definitions:

- `SESSION_VERSION` at line 43 is `2`.
- `SessionLayer` at lines 50-58 stores id, name, group, config, optional RLE base mask, optional RLE brush override, and click history.
- `SessionDocument` at lines 60-96 stores source identity, tool config, layer stack, active layer, effect defaults, custom surfaces, backend choice, and backend tunables.
- `SESSION_DIR`, `SESSION_LAST_POINTER`, and `sessionPathFor` are at lines 98-101.
- `LayerSnapshot` at lines 109-117 is the in-memory input shape for building a session.
- `buildSession` at lines 177-213 encodes layer base masks as binary RLE and brush overrides as arbitrary-value grid RLE.
- `parseSession` at lines 215-223 accepts only kind `cutout-session` and version 2.
- `serializeSession` at lines 225-227 is JSON stringify.
- `inflateSessionLayers` at lines 232-250 decodes RLE masks back into bytes for paintable upload.

`cart/cutout/session_old.ts` is the legacy v1 session format. It stored a global `mask`, `hasBrushLayer`, click history, overlay cell layers, layer configs, custom surfaces, and optional composition layers. It exports `inflateSessionMasks`, not the active v2 `inflateSessionLayers`. It is not imported by the active app path.

## SQI format and renderer

`cart/cutout/sqi.ts` defines `.sqi.json`, a self-contained shader quad image:

- the file stores a quantized base pixel matrix plus N shader FX layers;
- no external image path is required;
- built-in surfaces are stored by name, custom surfaces inline id/label/WGSL;
- storage uses the shared RLE row encoding from `rle.ts`.

Important definitions:

- `SqiLayer` at lines 49-70 stores id, label, mask rows, surface, hue offset, phase offset, dim, muted, blend, and optional color slots.
- `SqiDocument` at lines 72-86 stores kind `sqi`, version, metadata, thumbnail, size, stem, base matrix, and layers.
- `buildSqi` at lines 124-160 converts layer masks/configs/custom surfaces into a v2 document.
- `parseSqi` at lines 162-189 validates versions 1 and 2 and normalizes older custom surface fields.
- `serializeSqi` at lines 191-193 JSON-stringifies the document.
- `buildThumbnail` at lines 195-208 creates a smaller matrix thumbnail from the base.

`cart/cutout/components/ShaderQuadImage.tsx` is the drop-in renderer:

- accepts either a parsed `SqiDocument` or a filesystem `src` path at lines 25-31.
- reads and parses `src` with `readFile`/`parseSqi` at lines 38-47.
- renders a fixed-size `Box` with `BaseQuad` and one `LayerQuad` per unmuted layer at lines 70-80.
- `BASE_SHADER` at lines 88-110 renders the encoded base pixel matrix from a storage buffer.
- `BaseQuad` at lines 123-146 decodes matrix rows, packs palette/pixels, and renders an `Effect`.
- `LayerQuad` at lines 153-172 decodes mask rows and delegates overlay rendering to `MaskQuad`.

## Editor and rendering path

`cart/cutout/components/Editor.tsx` owns the center workspace.

Coordinate system:

- screen coordinates come from pointer events;
- `screenToWorld` at lines 29-37 calls the host function `__canvas_screen_to_graph`;
- `toSource` at lines 47-55 converts world coordinates to source image pixels and rejects out-of-bounds events.

Rendering:

- when `s.srcDims` exists, a `Canvas` fills the editor at lines 93-133.
- `Canvas.Node` at line 95 is centered at world origin with `gw`/`gh` equal to source dimensions.
- source images render through `Image` at lines 96-98.
- blank canvases render a checkerboard-like `BlankSurface` at lines 340-377.
- every layer mounts two invisible host `Paintable` primitives at lines 105-110, one for `baseId` and one for `brushId`.
- visible layers render a `MaskQuad` at lines 111-129 with `paintableId`, `overrideId`, FX mode, custom shader, hue/phase/dim, colors, and blend.
- `ClickMarkers` at lines 382-408 shows active layer smart-selection clicks.
- `LassoPreview` at lines 308-338 draws pending lasso path and vertices.

Input:

- the overlay `Pressable` appears at lines 141-185 for every tool except `hand`; hand mode leaves the underlying `Canvas` free to pan/zoom.
- `onMouseDown` at lines 153-176 handles smart clicks, lasso vertices, and stroke start.
- `onPointerMove` and `onMouseMove` at lines 148-152 and 177-181 paint while drawing.
- `onMouseUp`/`onMouseLeave` end strokes at lines 182-183.
- `BrushCursor` at lines 191-240 draws screen-space cursor feedback.
- `EditorHud` at lines 242-300 describes current tool, mode, active layer, and action.

## MaskQuad shader system

`cart/cutout/components/MaskQuad.tsx` is the reusable overlay shader component.

Vocabulary:

- `MaskSurface` at line 32: `rainbow`, `plasma`, `voronoi`, `fbm`, `solid`, `edges`.
- `SurfaceId` at line 33: built-in surface or custom string.
- `BlendMode` at line 34: `normal`, `add`, `multiply`, `screen`.
- `CustomSurface` at lines 35-39: id, label, shader.
- `MASK_SURFACES` at line 50 exports the built-in list.
- `NUM_COLOR_SLOTS` at line 64 is `2`.
- `SLOT_LABELS` at line 66 are `Primary` and `Secondary`.
- `SLOT_DEFAULTS` at line 71 defaults every slot to white.

Shader path:

- `COMMON_PRELUDE` at lines 95-145 defines the cells-mode storage-buffer helpers.
- `SHADER_BODY` at lines 151-188 defines per-surface body snippets.
- `SURFACE_FLAGS` at lines 192-199 defines pulse/interior/edge alpha rules.
- `buildShader` at lines 201-257 creates cells-mode WGSL for cell-set masks.
- `SHADER_CACHE` at lines 263-270 caches built-in cells-mode shaders.
- `TEX_COMMON_PRELUDE` at lines 283-336 defines texture-mode bindings and helpers. It samples `mask_tex` and `smart_tex`, where `smart_tex` is reused as the brush override texture.
- `buildTextureShader` at lines 338-393 creates texture-mode WGSL.
- `TEX_SHADER_CACHE` at lines 395-402 caches built-in texture-mode shaders.

`MaskQuad` at lines 443-524:

- packs header values, color slots, and optionally cells into a numeric `data` array;
- uses texture mode when `paintableId` is present;
- chooses built-in cached WGSL or custom WGSL;
- passes `textures={[paintableId, overrideId ?? '']}` to `Effect` in texture mode;
- renders one absolute-positioned `Effect` with the requested world size.

This is the major reusable game concept in the cart: a mask can become a visible animated/materialized region without changing the underlying mask data.

## UI components

`cart/cutout/components/TopBar.tsx`:

- title strip and action toolbar are rendered by `TopBar` at lines 14-146.
- `windowDrag={true}` is set on the title row at line 27.
- file actions at lines 98-114 call `createBlankSurface`, `pickFile`, `importSqi`, `saveCutout`, and `saveSqi`.
- `BrushSlider` at lines 148-239 changes brush size through mouse drag and nudge buttons.
- `WindowControls` at lines 375-383 calls host functions `__window_minimize`, `__window_maximize`, and `__window_close` through `callHost`.
- `ContextMenu` at lines 414-443 provides workspace/tab menu items, with recent files and multi-tab entries reserved/disabled.

`cart/cutout/components/Tools.tsx`:

- `TOOLS` at lines 13-19 declares hand, brush, refine brush, lasso, and smart select.
- `MODES` at lines 21-24 declares erase/remove and restore.
- `PALETTE` at lines 26-32 declares quick color swatches.
- `Tools` at lines 34-116 renders the left rail, calls `s.setTool`, `s.setMode`, `s.clearMask`, `s.invertMask`, and `s.setEffectColor`.

`cart/cutout/components/Inspector.tsx`:

- `Inspector` at lines 73-197 renders the right panel with `Tool`, `FX`, and `Source` tabs, a resizable layer section, and an overlay during resize.
- `ToolProperties` at lines 199-227 shows current mask state, backend, click count, layer count, clear-click action, backend picker, and tunables.
- `BackendPicker` at lines 232-275 switches flood/SAM and disables SAM when ONNX is unavailable.
- `BackendTunables` at lines 280-359 exposes flood fuzz/reject radius or SAM threshold/mask candidate.
- `SurfaceProperties` at lines 361-429 targets global defaults or a specific layer, renders built-in/custom surface cards, and opens the custom effect modal.
- `ParametersBlock` at lines 437-550 edits color slots, hue offset, phase, dim, blend mode, and layer visibility.
- `SourceProperties` at lines 706-748 shows source path or blank status, canvas size editor, and last saved outputs.
- `CanvasSizeEditor` at lines 754-779 edits dimensions explicitly on submit.
- `AdvancedProperties` at lines 811-844 contains ONNX runtime test UI, but it is not rendered by the active tab switch.
- `LayersPanel` at lines 877-935 lists layers and renders add/duplicate/move/merge/delete controls.
- `LayerRow` at lines 1007-1060 shows surface preview, rename control, group tag, and visibility toggle.
- `SurfacePreview` at lines 1217-1265 renders a small `MaskQuad` preview.
- `EffectModal` at lines 1267-1423 edits a custom WGSL shader and previews it through `MaskQuad`.

`cart/cutout/components/StatusBar.tsx`:

- `StatusBar` at lines 16-65 renders status text and cells for FPS, zoom, canvas, size estimate, mask, layers, clicks, and saved age.
- uses `useTelemetry({ kind: 'fps' })` and `useTelemetry({ kind: 'canvas' })` at lines 24-25, polling every 1000 ms.
- `estimateFileSize` at lines 144-153 uses a rough pixel/layer estimate for status display only.

`cart/cutout/theme.ts`:

- `COLORS` at lines 5-20 centralizes the dark UI palette.
- `SIZES` at lines 22-29 centralizes title/action/top/bottom/tool/inspector dimensions.

## Legacy files

The active app imports `state.ts`, `Editor.tsx`, `Inspector.tsx`, and `session.ts`. The `_old` files remain in the folder but are not imported by the active path.

- `state_old.ts`: previous `useCutoutState` model. It used a global source-resolution mask/paint layer plus smart overlay cell layers and a smart-union paintable. It had `compositionLayers`, `smartLayerMeta`, `maskId`, and `smartUnionId` concepts that the active unified layer stack replaced.
- `session_old.ts`: previous v1 session document. It stored one global `mask`, a `hasBrushLayer` flag, global click history, overlay-res layer masks, and `compositionLayers`.
- `Editor_old.tsx`: previous editor UI. It mounted a global `Paintable` for `s.maskId` and another `Paintable` for `s.smartUnionId`, and imported `rowRuns`.
- `Inspector_old.tsx`: previous inspector UI. It resembles the current inspector but still knew about a brush-layer target and old active-layer semantics.

These files are useful reference material for the migration from "global brush plus smart layers" to "every layer has base plus brush textures." They should not be treated as the current behavior unless an import is changed back to them.

## Host function and runtime boundary

Direct `callHost` use:

- `cart/cutout/components/Editor.tsx:34-36` calls `__canvas_screen_to_graph` to convert OS screen coordinates into `Canvas` world coordinates.
- `cart/cutout/components/TopBar.tsx:378-380` calls `__window_minimize`, `__window_maximize`, and `__window_close`.

Runtime hooks and host-backed APIs:

- `readFile`, `writeFile`, and `mkdir` from `runtime/hooks/fs.ts` wrap host functions `__fs_read`, `__fs_write`, and `__fs_mkdir`.
- `run` and `execAsync` from `runtime/hooks/process.ts` run subprocesses through process host bindings. This cart uses them for `magick` and `zenity`.
- `useFileDrop` receives host file-drop paths.
- `usePaintable` and `paintableOps` call paintable host functions such as `__paintable_circle`, `__paintable_polygon`, `__paintable_clear`, `__paintable_upload`, and `__paintable_readback`.
- `useSegment` helpers call ONNX/MobileSAM host bindings when available.
- `useTelemetry` polls host telemetry for FPS and canvas zoom.
- `useIFTTT` subscribes to the global key trigger bus for shortcuts.
- `Effect` is a host-backed GPU surface; it maps `data` to `effectData` and can sample `textures`.
- `Paintable` is a host-backed invisible R8 texture owner.
- `Canvas` and `Canvas.Node` are host-backed pan/zoom/world-coordinate surfaces.

Not used directly:

- no `globalThis.__...` calls in cart code;
- no browser `document`;
- no browser `window`;
- no browser `fetch`;
- no `localStorage`;
- no HTTP hooks;
- no clipboard hooks;
- no `Scene3D`.

## JavaScript-authored versus host-authored

JavaScript/TypeScript authored:

- app layout and component tree;
- layer stack data model;
- source/layer/session/SQI document formats;
- state transitions and history snapshots;
- mask composition rules for export/snapshot;
- ImageMagick command assembly and output parsing;
- flood backend orchestration;
- SAM backend option mapping;
- mask shader WGSL strings and storage-buffer packing;
- UI controls and keyboard shortcut bindings.

Host-backed:

- filesystem reads/writes and directory creation;
- subprocess execution for ImageMagick and Zenity;
- file drop events;
- canvas pan/zoom and screen-to-world conversion;
- paintable texture allocation, circle/polygon writes, clear/upload/readback;
- Effect shader compilation/execution and texture sampling;
- ONNX/MobileSAM image open/refine/close;
- window minimize/maximize/close;
- telemetry polling;
- primitive event dispatch.

## Glossary

- `CutoutApp`: default app component and layout shell.
- `useCutoutState`: active state hook and behavior API.
- `Layer`: one editable mask layer with `base` and `brush` paintable ids.
- `base`: smart-selection mask channel.
- `brush`: manual override channel.
- `effective mask`: composed result of `base` plus `brush`.
- `Mode`: erase/remove or restore.
- `Tool`: hand, brush, refine, lasso, or smart.
- `OVERLAY_RES`: 128x128 export/preview mask resolution.
- `Paintable`: invisible host R8 texture owner.
- `paintableOps`: imperative host-backed texture operations.
- `MaskQuad`: GPU shader overlay for a mask.
- `MaskSurface`: built-in visual surface mode.
- `SurfaceId`: built-in surface id or custom surface id.
- `CustomSurface`: user-authored WGSL surface.
- `LayerConfig`: visual config attached to every layer.
- `BlendMode`: preview blend mode for a layer.
- `SelectionBackend`: smart-selection interface.
- `FloodBackend`: ImageMagick flood-fill backend.
- `SamBackend`: MobileSAM/ONNX backend.
- `ClickPoint`: source-pixel smart-select point.
- `keep`: smart-select click label that adds a region.
- `reject`: smart-select click label that subtracts/corrects a region.
- `lassoPoints`: pending polygon vertices in source coordinates.
- `maskVersion`: throttled version bump that makes visual dependents update.
- `stem`: sanitized source/document name used for output paths.
- `SessionDocument`: autosaved working editor document.
- `SqiDocument`: self-contained shader quad image artifact.
- `EncodedMatrix`: shared RLE/palette pixel matrix.
- `Static surface`: not used in this cart; cutout uses `Effect` and `Paintable` instead.
- `__canvas_screen_to_graph`: host coordinate conversion function for Canvas.
- `__paintable_*`: host texture mutation/readback functions hidden behind `paintableOps`.

## Reusable concepts for game unification

- Layer as gameplay/render concept: `Layer` ties identity, user-facing name, mask data, click history, and material config together.
- Dual-source mask composition: generated base plus manual override is a strong pattern for tools where procedural output needs hand correction.
- Declarative artifact format: `.sqi.json` contains base pixels, layer masks, and shader surfaces with no external asset dependencies.
- Shader surface registry: built-in and custom WGSL surfaces share one `SurfaceId`/`CustomSurface` model.
- Host texture as state: `Paintable` keeps high-frequency pixel edits outside React state but still lets React declare where the texture exists.
- Backend interface: `SelectionBackend` keeps UI independent from flood/SAM implementation details.
- Session snapshot model: the same serializable document powers autosave, restore, and undo/redo.
- Source coordinate discipline: `Editor` explicitly separates screen, Canvas world, and source pixel coordinates.

## Notable limitations and risks

- `AdvancedProperties` and its ONNX runtime test UI exist in `Inspector.tsx` but are not rendered by the active tab switch.
- `saveCutout`, `saveIcons`, and `saveSqi` require `srcPath`, so blank canvases are editable but not currently exportable through those paths.
- `MaskQuad` supports both cell-set and texture modes; the active editor uses texture mode, while SQI rendering uses cell-set mode.
- SAM returns one fused mask and no per-keep overlay layers; flood can emit per-keep cell sets, though the active unified layer state uploads only the fused result to the layer base.
- ImageMagick and Zenity are external subprocess dependencies. Missing commands surface as failed process results/status text.
- Session v2 intentionally does not parse v1 sessions; `session_old.ts` remains for reference, not migration.
- The app writes outputs and sessions inside the repo (`cart/pixel_icons`, `cart/cutout/sessions`), so generated artifacts can appear as working tree changes.
