# game_item_gallery cart inventory

Source cart: `cart/game_item_gallery/`

Reviewed: 2026-06-04

## High-level purpose

`game_item_gallery` is a low-poly 3D item viewer. It shows one hand-authored game prop at a time in a `Scene3D` stage, lets the user rotate the camera by dragging, and presents a scrollable picker of all available props. The gallery is a catalog of reusable item shapes, not a gameplay loop: there is no player controller, physics, inventory system, save state, network IO, filesystem IO, or external asset loading.

The cart is important because it demonstrates several ways a game prop can become readable without importing models:

- simple geometry generators from `@reactjit/geometries`;
- local custom geometry definitions for shapes that are not covered by boxes, cylinders, spheres, cones, or torus meshes;
- `StaticSurface` UI subtrees used as 2D textures on 3D meshes;
- `Effect` WGSL surfaces used as procedural textures;
- a `Filter` postprocess used inside a generated TV texture;
- an `OrbitCamera` rig controlled from React state.

Most logic is JavaScript/React code in `cart/game_item_gallery/index.tsx`. The heavy rendering behavior is declarative and host-backed through ReactJIT primitives.

## Files touched by this behavior

- `cart/game_item_gallery/cart.json`: cart manifest. Gives the display name, description, and default window size.
- `cart/game_item_gallery/index.tsx`: the cart implementation. Contains all item models, geometry helper definitions, shader strings, texture-source surfaces, the `Scene3D` stage, drag-to-orbit handling, item picker UI, and the exported item registry.
- `runtime/primitives.tsx`: provides `Box`, `Col`, `Row`, `Text`, `Pressable`, `ScrollView`, `Scene3D`, `StaticSurface`, `Filter`, and `Effect`. This cart depends on those primitives for both UI and 3D rendering.
- `runtime/cameras/index.tsx`: provides `OrbitCamera`, which solves yaw, pitch, distance, target, zoom, and fov into a `Scene3D.Camera`.
- `runtime/geometries/`: provides the geometry generator registry and intern path used by `Scene3D.Mesh`.
- `framework/gpu/3d.zig`: consumes the host node fields emitted by `Scene3D` primitives and renders the 3D stage. The cart does not call this file directly.

## Manifest

`cart/game_item_gallery/cart.json:1-6` declares:

- `name`: `Game Item Gallery`.
- `description`: `A low-poly 3D gallery of hand-authored game item models.`
- `width`: `1280`.
- `height`: `780`.

There are no manifest icons, permissions, host function declarations, or asset paths.

## Imports and primitive surface

`cart/game_item_gallery/index.tsx:1-5` imports React hooks, ReactJIT primitives, geometry helpers, and `OrbitCamera`.

React hooks used:

- `useState`: stores the selected item id, orbit yaw, orbit pitch, and `tvTick`.
- `useRef`: stores drag state between pointer events without causing re-renders for every assignment.
- `useEffect`: starts a JavaScript timer loop for the animated TV screen crawl and cleans it up on unmount.

ReactJIT primitives used:

- `Box`: root background, labels, panels, texture-surface layout, and simple UI rectangles.
- `Row`: horizontal label rows and generated texture rows.
- `Col`: title stack, side panel, item list, and TV crawl column.
- `Text`: all visible labels and generated texture text.
- `Pressable`: scene drag surface and item-selection buttons.
- `ScrollView`: right-side item list.
- `Scene3D`: the 3D viewport.
- `Scene3D.Skybox`: procedural sky/background for the stage.
- `Scene3D.AmbientLight`, `Scene3D.DirectionalLight`, `Scene3D.PointLight`: gallery lighting.
- `Scene3D.Mesh`: every visible 3D mesh.
- `StaticSurface`: offscreen/keyed 2D surfaces that become texture sources for meshes.
- `Filter`: CRT postprocess inside the TV screen texture source.
- `Effect`: WGSL-generated procedural texture surfaces for cash, football, and basketball.

Geometry APIs used:

- `Geometry.Box`
- `Geometry.Cylinder`
- `Geometry.Cone`
- `Geometry.Sphere`
- `Geometry.Torus`
- `mesh()` and `normalize()` for custom mesh generation.

## Exported shape

The current file exports some data for reuse or tests:

- `V3` at `cart/game_item_gallery/index.tsx:7`: a `[number, number, number]` tuple used for positions, rotations, and scales.
- `ModelCtx` at line 8: `{ origin, yaw, scale, active }`, the shared placement context for all item model functions.
- `ModelFn` at line 9: a function that accepts `ModelCtx` and returns React children.
- `Item` at line 441: `{ id, label, tone, note, model }`.
- `ITEMS` at lines 443-463: the full item registry.
- `TextureSources` at line 524: reusable texture-source subtree.
- the default `GameItemGallery` component at line 699.

## Texture keys and sizes

Texture keys at `cart/game_item_gallery/index.tsx:12-24` are string ids used to connect `StaticSurface` outputs to `Scene3D.Mesh textureKey` props.

- `CIG_TEXTURE_KEY`: front face for cigarette pack.
- `CIG_SIDE_TEXTURE_KEY`: side warning/barcode face for cigarette pack.
- `CIG_TOP_TEXTURE_KEY`: top seal face for cigarette pack.
- `CIG_BACK_TEXTURE_KEY`: back contents face for cigarette pack.
- `CIG_BOTTOM_TEXTURE_KEY`: bottom tax-stamp face for cigarette pack.
- `TV_SCREEN_TEXTURE_KEY`: CRT-filtered TV screen texture.
- `CASH_TEXTURE_KEY`: procedural cash texture.
- `BEER_TEXTURE_KEY`: beer bottle label.
- `LIQUOR_TEXTURE_KEY`: liquor bottle label.
- `PILL_TEXTURE_KEY`: pill bottle label.
- `MEDKIT_TEXTURE_KEY`: med kit cross texture.
- `FOOTBALL_TEXTURE_KEY`: procedural football texture.
- `BASKETBALL_TEXTURE_KEY`: procedural basketball texture.

`TEX_W` and `TEX_H` at lines 25-26 are both `256`. Every generated texture surface in this cart uses a 256 by 256 layout.

## Procedural shaders

The cart defines three WGSL fragment shader strings. These are JavaScript string constants handed to the `Effect` primitive, then compiled/executed by the runtime GPU effect path.

- `CASH_SHADER` at `cart/game_item_gallery/index.tsx:28-42`: reads `in.uv`, creates a green paper base, adds bands, border/edge ink, oval detail, and sine-line variation. Used by the cash stack surface at lines 630-634.
- `FOOTBALL_SHADER` at lines 44-57: creates brown leather variation, white side stripes, a central seam, laces, and lace ticks. Used by the football surface at lines 684-688.
- `BASKETBALL_SHADER` at lines 59-72: creates orange pebble variation and black seam bands/arcs. Used by the basketball surface at lines 690-694.

Each shader declares `@group(0) @binding(1) var<storage, read> ys: array<f32>;`, matching the `Effect` primitive's optional data-buffer convention, but this cart passes only `data={[0]}` and does not use meaningful dynamic shader data.

## Local mesh helpers

The custom geometry path starts at `cart/game_item_gallery/index.tsx:74`.

- `def(id, defaults, generate)` at lines 74-76 returns an object with the geometry-def shape expected by `Scene3D.Mesh`.
- `sub` at line 78 subtracts `V3` tuples.
- `cross` at lines 79-81 computes a cross product.
- `nrm` at lines 82-85 computes a face normal using `cross`, `sub`, and `normalize`.
- `tri` at lines 86-89 appends one triangle to a `mesh()` builder with a shared normal and UVs.
- `quad` at lines 90-94 appends two triangles as a rectangle.

Custom geometry definitions:

- `Blade` at lines 96-110: a wedge/triangular prism for a knife blade.
- `Sail` at lines 112-125: a thin triangular sail with front, back, and edge faces.
- `BoatHull` at lines 127-142: a low-poly hull with a rectangular top and keel faces.
- `Surfboard` at lines 144-165: an oval extruded board built from a configurable segment loop.

These generators run in JavaScript through the `@reactjit/geometries` registry. The runtime then interns the result and ships vertex buffers to the host render path.

## Transform helpers

The item model functions use a shared local-to-world transform API:

- `local(ctx, p)` at `cart/game_item_gallery/index.tsx:167-173`: scales a local point, rotates it around Y by `ctx.yaw`, and offsets it by `ctx.origin`.
- `scl(ctx, s)` at lines 174-177: applies `ctx.scale` to a scalar or vector scale.
- `rot(ctx, r)` at lines 178-180: adds `ctx.yaw` to the mesh's Y rotation.
- `Part` at lines 181-190: small wrapper around `Scene3D.Mesh` that applies `local`, `scl`, and `rot`.

This means each item is written in compact local coordinates. The model function does not know the absolute gallery position or final item scale.

## Shared geometry aliases

At `cart/game_item_gallery/index.tsx:193-203`, the file creates short aliases and repeated params:

- `box`: `Geometry.Box`.
- `cyl`: `Geometry.Cylinder`.
- `cone`: `Geometry.Cone`.
- `sphere`: `Geometry.Sphere`.
- `torus`: `Geometry.Torus`.
- `box1`: unit box params.
- `cyl12`: cylinder, 12 segments.
- `cyl18`: cylinder, 18 segments.
- `cone12`: cone, 12 segments.
- `sphere12`: sphere with radius `0.5`, 16 segments, 10 rings.

These aliases are JavaScript conveniences only. The host ultimately sees generated geometry keys and mesh props.

## Item model functions

Each model function accepts `ModelCtx` and returns one or more `Scene3D.Mesh` nodes, usually through `Part`.

- `Knife` at `cart/game_item_gallery/index.tsx:205-211`: custom `Blade` mesh plus box handle and guard.
- `Pistol` at lines 213-219`: three boxes for slide/body, barrel/front, and angled grip.
- `Pitchfork` at lines 221-228`: cylinder shaft, box crossbar, and four cone prongs generated by mapping over x offsets.
- `Bat` at lines 230-235`: two angled cylinders for barrel and narrower handle.
- `Cash` at lines 237-250`: green base box plus a thin textured `Geometry.Box` using `CASH_TEXTURE_KEY`.
- `Vehicle` at lines 252-260`: blocky car body/cabin/window plus two visible cylinder wheels.
- `SailBoat` at lines 262-269`: custom `BoatHull`, mast cylinder, and two custom `Sail` meshes.
- `Surf` at lines 271-277`: custom `Surfboard` plus colored stripe boxes.
- `Football` at lines 279-291`: textured `Geometry.Sphere` scaled into an oval using `FOOTBALL_TEXTURE_KEY`.
- `Basketball` at lines 293-305`: textured `Geometry.Sphere` using `BASKETBALL_TEXTURE_KEY`.
- `PillBottle` at lines 307-320`: textured cylinder using `PILL_TEXTURE_KEY` plus a cap cylinder.
- `BeerBottle` at lines 322-336`: textured cylinder body using `BEER_TEXTURE_KEY`, green neck, and gold cap.
- `LiquorBottle` at lines 338-351`: textured square bottle body using `LIQUOR_TEXTURE_KEY` plus cylinder neck.
- `Pills` at lines 353-362`: three loose capsule cylinders generated from local `pillData`.
- `Weed` at lines 364-381`: several sphere buds plus leaf shapes using the custom `Surfboard` geometry at small scale.
- `Cigarettes` at lines 383-395`: pack body, five semantic textured faces, and loose cigarette/filter cylinders.
- `Backpack` at lines 397-405`: box body and pouch, torus straps, and a small cylinder pull/zipper detail.
- `MedKit` at lines 407-420`: textured box using `MEDKIT_TEXTURE_KEY` plus a cylinder handle.
- `Tv` at lines 422-439`: box body, textured TV screen using `TV_SCREEN_TEXTURE_KEY`, two knob cylinders, and two stand boxes.

The cart uses both direct `Scene3D.Mesh` calls and the local `Part` wrapper. Direct calls appear when a mesh needs a `textureKey`; `Part` does not expose `textureKey`.

## Item registry

`ITEMS` at `cart/game_item_gallery/index.tsx:443-463` is the data registry that drives both the picker and the model selection.

Each item has:

- `id`: stable selection key.
- `label`: visible item name.
- `tone`: accent color for the side panel, picker dot, and active pedestal.
- `note`: short model description shown in the picker.
- `model`: function reference to render the item.

Registered ids:

- `knife`
- `pistol`
- `pitchfork`
- `bat`
- `cash`
- `vehicle`
- `sailboat`
- `surfboard`
- `football`
- `basketball`
- `pillbottle`
- `beer`
- `liquor`
- `pills`
- `weed`
- `cigarettes`
- `backpack`
- `medkit`
- `tv`

This registry is the strongest reusable game concept in the file: item identity, label, accent tone, description, and renderer are already one coherent data shape.

## Pedestal and 3D scene

`Pedestal` at `cart/game_item_gallery/index.tsx:465-470` renders two stacked boxes under the current item. It uses `ctx.active` and `item.tone` to color the active base.

`GalleryScene` at lines 472-498 owns the 3D stage:

- creates `ctx` as `{ origin: [0, 0.18, 0], yaw: 0, scale: 1.95, active: true }`;
- renders a full-size `Scene3D` with background `#111827`;
- uses `OrbitCamera target={[0, 0.72, 0]} yaw={yaw} pitch={pitch} dist={4.6} zoom={1} fov={38}`;
- configures a procedural `Scene3D.Skybox`;
- adds ambient, directional, and two point lights;
- renders a large floor box;
- renders the pedestal;
- calls `item.model(ctx)` to render the selected prop.

Camera solving happens through `OrbitCamera`, implemented in `runtime/cameras/index.tsx:60-65`. That component solves the orbit rig in JavaScript and emits `Scene3D.Camera`.

## Picker UI

`ItemButton` at `cart/game_item_gallery/index.tsx:500-522` renders one selectable item row:

- outer `Pressable` handles selection.
- row background/border changes when active.
- a colored dot uses `item.tone`.
- label uses bold weight when active.
- note text fades when inactive.

The default component lays out the picker at lines 750-774:

- absolute right panel;
- current item label and note at top;
- `ScrollView` with `showScrollbar`;
- `ITEMS.map(...)` creates one `ItemButton` per registry entry.

The top-left title stack at lines 745-748 displays `Game Item Gallery` and the instruction `single-item close view - drag the scene to orbit`.

## TextureSources

`TextureSources` at `cart/game_item_gallery/index.tsx:524-697` renders hidden texture sources. It accepts:

- `tvTick`: timer value used for the TV crawl.
- `itemId`: optional filter. If omitted, all texture sources render. If present, only texture sources needed for that item render.

`show(...ids)` at line 526 implements the optional filter: `!itemId || ids.includes(itemId)`.

Current default app behavior at line 776 calls `<TextureSources tvTick={tvTick} />` without `itemId`, so every texture source is present. The filter support is available but not used by the default gallery render.

Static surface groups:

- Cigarette pack front at lines 529-544: red/cream label with `RJIT`, `FILTER`, and `UI TEXTURE`.
- Cigarette side at lines 546-560: warning text, lines, and barcode-like bars.
- Cigarette top at lines 562-572: open/seal label.
- Cigarette back at lines 574-586: contents panel and lot text.
- Cigarette bottom at lines 588-598: tax-stamp panel.
- TV screen at lines 600-628: `StaticSurface` containing a `Filter shader="crt"` subtree. The content is a fake transmission screen with a vertically moving crawl based on `crawlTop`.
- Cash at lines 630-634: `StaticSurface` containing `Effect shader={CASH_SHADER}`.
- Beer label at lines 636-646: label surface with `PIER 18` and `LAGER`.
- Liquor label at lines 648-659: purple/gold label with `NO. 7`, `VELVET`, and `RESERVE`.
- Pill bottle label at lines 661-671: prescription-style label.
- Med kit at lines 673-682: white surface with red cross shapes.
- Football at lines 684-688: `Effect shader={FOOTBALL_SHADER}`.
- Basketball at lines 690-694: `Effect shader={BASKETBALL_SHADER}`.

All `StaticSurface` nodes are positioned offscreen with `left: -99999` and fixed `width`/`height`, but they remain in the React tree so the runtime can render and cache them.

## Default component state and events

`GameItemGallery` starts at `cart/game_item_gallery/index.tsx:699`.

State:

- `selected` at line 700: current item id, initially `knife`.
- `orbitYaw` at line 701: camera yaw in degrees, initially `35`.
- `orbitPitch` at line 702: camera pitch in degrees, initially `28`.
- `tvTick` at line 703: crawl/timer value for TV texture, initially `0`.
- `dragRef` at line 704: last pointer coordinate while dragging.
- `current` at line 705: current `Item`, found from `ITEMS`, falling back to `ITEMS[0]`.

Timer:

- `useEffect` at lines 707-715 starts a JavaScript `setTimeout` loop.
- Each tick increments `tvTick` by `2` modulo `360`.
- The loop interval is `40` ms.
- Cleanup clears the last timeout handle.

Drag handling:

- `onDown` at lines 717-719 stores the pointer x/y from the event payload.
- `onMove` at lines 720-731 computes dx/dy, updates the stored pointer, adds `dx * 0.38` to yaw, and clamps pitch between `8` and `70` after applying `dy * 0.28`.
- `onUp` at line 732 clears the drag ref.
- The full-scene `Pressable` at lines 736-743 receives `onMouseDown`, `onMouseMove`, and `onMouseUp`.

Selection:

- `ItemButton` presses call `setSelected(item.id)` at line 770.
- Selecting changes `current`, side-panel text/accenting, and the item model passed into `GalleryScene`.

## Host function and runtime boundary

Direct global host functions used by this cart:

- None.

Not used:

- no `__exec`;
- no `__fs_readfile`, `__fs_writefile`, `__fs_list_json`, or `__fs_exists`;
- no `__store_get` or `__store_set`;
- no `__http_get`, `__http_post`, or async HTTP host calls;
- no crypto host functions;
- no clipboard host functions;
- no `__openWindow`;
- no `__mermaidRender`;
- no direct `__registerDispatch`;
- no direct `__hostFlush`;
- no direct `__jsTick`;
- no direct `window`, `document`, `fetch`, `localStorage`, or DOM APIs.

JavaScript/runtime functions used:

- React hooks (`useState`, `useRef`, `useEffect`).
- JavaScript math (`Math.PI`, `Math.sin`, `Math.cos`, `Math.max`, `Math.min`).
- JavaScript array methods (`map`, `find`, `includes`).
- JavaScript timers (`setTimeout`, `clearTimeout`). In ReactJIT, due timers are ultimately serviced by the runtime tick bridge, but the cart code itself uses the JS timer API and does not call `__jsTick`.
- Event handlers on ReactJIT primitives (`onPress`, `onMouseDown`, `onMouseMove`, `onMouseUp`).

Host-backed primitive behavior:

- `Scene3D` is defined in `runtime/primitives.tsx:443-447` and emits a host `View` with `scene3d: true`.
- `Scene3D.Camera` is defined in `runtime/primitives.tsx:454-466` and emits camera props such as `scene3dPosX`, `scene3dLookX`, and `scene3dFov`.
- `Scene3D.Skybox` is defined in `runtime/primitives.tsx:478-492` and emits procedural sky uniforms.
- `Scene3D.Mesh` is defined in `runtime/primitives.tsx:535-708`. It accepts geometry definitions from `@reactjit/geometries`, runs/interns generators in JavaScript, and emits host mesh props. For `textureKey`, it emits `scene3dTexKey`.
- `StaticSurface` is defined in `runtime/primitives.tsx:327-348`. It emits a host `View` marked `staticSurface: true` with a stable key, so the subtree can collapse into a render-to-texture surface.
- `Filter` is defined in `runtime/primitives.tsx:359-364`. It emits a host `View` with `filterName` and `filterIntensity`.
- `Effect` is defined in `runtime/primitives.tsx:886-887`. It emits an `Effect` host node and maps `data` to `effectData`.
- `OrbitCamera` is defined in `runtime/cameras/index.tsx:60-65`. It solves camera params in JavaScript and emits `Scene3D.Camera`.

## What is JavaScript-authored versus host-authored

JavaScript-authored in `cart/game_item_gallery/index.tsx`:

- item registry and selection state;
- all item model composition;
- all local transforms;
- custom mesh generator definitions;
- shader source strings;
- texture surface UI layout trees;
- drag math and pitch clamping;
- TV crawl timer value;
- side panel and item picker UI.

Runtime/host-backed:

- event dispatch into `Pressable` handlers;
- layout and painting of primitives;
- `StaticSurface` render-to-texture capture and cache;
- `Filter` postprocessing;
- `Effect` shader execution;
- geometry vertex upload/cache;
- `Scene3D` camera, lighting, skybox, mesh drawing, texture binding, and final 3D render.

There is no imported model loader, no image-file texture loader, and no browser canvas API. Meshes and textures are created from React/JavaScript declarations and then rendered by the host.

## Reusable concepts found here

- Item registry: a single exported `ITEMS` array binds gameplay identity, UI presentation, description, and model renderer.
- Model context: `ModelCtx` lets every prop be authored in local coordinates and later placed/scaled/rotated by the gallery.
- Semantic texture keys: texture identity is named by purpose, not by file path.
- React UI as texture: `StaticSurface` turns ordinary ReactJIT layout into labels, packaging, and screens for 3D props.
- Procedural texture effects: `Effect` allows small WGSL shaders to become materials without image assets.
- Custom geometry defs: simple local mesh generators fill gaps between primitive shapes and full model imports.
- Declarative camera rig: `OrbitCamera` keeps camera math reusable and separate from scene content.
- Single-item inspection stage: the cart isolates a selected item for close reading rather than showing all props at once.

## Glossary

- `GameItemGallery`: default exported cart component. Owns selected item state, orbit state, TV tick state, layout, and texture sources.
- `V3`: local tuple type for 3D values.
- `ModelCtx`: placement context shared by item renderers.
- `ModelFn`: type alias for any item model renderer.
- `Item`: registry entry shape for one prop.
- `ITEMS`: full item registry used by UI and rendering.
- `tone`: per-item accent color used in the UI and pedestal.
- `note`: short descriptive text shown under an item label.
- `textureKey`: string attached to a mesh so the host can sample a keyed texture surface.
- `StaticSurface`: hidden or visible subtree rendered/cached as a texture source.
- `Effect`: GPU shader surface used to generate a texture procedurally.
- `Filter`: postprocess wrapper for a subtree; here it is used for CRT treatment.
- `OrbitCamera`: reusable camera component that solves orbit params to a `Scene3D.Camera`.
- `Part`: local helper that wraps `Scene3D.Mesh` and applies `ModelCtx` transforms.
- `def`: local helper that creates a geometry-definition object with `id`, `defaults`, and `generate`.
- `mesh()`: geometry builder from `@reactjit/geometries`.
- `Blade`: custom wedge blade geometry.
- `Sail`: custom triangular sail geometry.
- `BoatHull`: custom low-poly hull geometry.
- `Surfboard`: custom oval extruded board geometry, reused for surfboard and weed leaves.
- `CASH_SHADER`: WGSL shader for cash/bill texture.
- `FOOTBALL_SHADER`: WGSL shader for football texture.
- `BASKETBALL_SHADER`: WGSL shader for basketball texture.
- `TextureSources`: component that declares every generated texture source used by item meshes.
- `tvTick`: state value incremented by timer and used to scroll the TV transmission content.
- `crawlTop`: computed y-position for TV crawl content.
- `show(...ids)`: optional texture-source filter inside `TextureSources`.
- `Pedestal`: active item display base.
- `GalleryScene`: 3D stage containing camera, skybox, lights, floor, pedestal, and selected item.
- `ItemButton`: selectable row in the item picker.
- `selected`: selected item id state.
- `orbitYaw`: camera yaw state in degrees.
- `orbitPitch`: camera pitch state in degrees.
- `dragRef`: mutable storage for the last pointer coordinate during drag.

## Notable limitations and integration notes

- `TextureSources` supports `itemId`, but the default cart render does not pass it. The app currently renders all texture source subtrees all the time.
- `Part` does not accept `textureKey`, so textured meshes are direct `Scene3D.Mesh` calls instead of using the helper.
- `ModelCtx.active` is used by `Pedestal`; individual model functions do not branch on it.
- Most item models only show the front/primary readable side. Vehicle wheels, for example, are only defined for one visible side.
- The gallery's camera orbit is manual state math, while camera solving itself is delegated to `OrbitCamera`.
- The cart has no centralized material system. Colors are inline hex strings in each model and texture surface.
- Generated texture text is decorative/in-world material content. It is not data-driven localization or gameplay text.
