# voxel_stack_demo cart inventory

Source cart: `cart/voxel_stack_demo/` (`index.tsx`, 625 lines + `cart.json` manifest)

Reviewed: 2026-06-04

## High-level purpose

`voxel_stack_demo` is a self-contained Minecraft-lite ("Blockcraft"): a procedurally seeded voxel terrain you orbit around, click block faces to **build** (place a block from a finite inventory on the clicked face's adjacent cell) or **mine** (remove the block, banking its drop back into inventory). It is a pure gameplay-logic + rendering cart — **zero host function calls of its own**, no filesystem, no persistence, no keyboard, no frame loop. Every behavior is React state + declarative primitives; the only continuous interaction is mouse drag (orbit), wheel (zoom), and click (pick).

Its two framework-significant features: it is the first cart in this review set rendering through **`Scene3D.Instances`** (one instanced draw per block *kind* instead of one mesh node per block), and it does full 3D **ray/AABB face picking in cart JS** by hand-rolling the camera-inverse ray that the cameras registry builds internally but does not export.

## Files touched by this behavior

- `cart/voxel_stack_demo/index.tsx`: everything — block registry, world gen, picking math, scene, HUD.
- `cart/voxel_stack_demo/cart.json`: directory-cart manifest — `{ name: "Voxel Stack Demo", description, customChrome: false, width: 1280, height: 820 }`. (First manifest sighting in this review series: directory carts can declare window size + chrome to the host.)
- `runtime/primitives.tsx`: `Box/Row/Col/Text/Pressable` + `Scene3D` family. `Scene3D.Instances` (line 709) is the key one — see below. `Scene3D.Mesh` material accepts `{ color, opacity }` objects (translucent selection/ghost/handles).
- `runtime/cameras/` (`@reactjit/cameras`): `solveCamera` (index line 50) + `CAMERAS.Orbit` (`rigs/orbit.ts` — pure `solve({target, yaw°, pitch°, dist, zoom, fov}) → {pos, target, fov}`).
- `runtime/geometries/` (`@reactjit/geometries`): `Geometry.Box` only — unit params, scale via instance data.
- `framework/gpu/3d.zig`: consumes `scene3dInstanceData/Count/Stride` and the rest of the scene props; not called directly.
- `runtime/cameras/unproject.ts`: **not imported** — listed because the cart's `screenRay` duplicates its view-basis math (the divergence finding below).

## Host functions vs JavaScript functions

Host calls made by cart code: **none**. No `callHost`, no `busOn`, no `isKeyDown`, no fs/process/store. All input arrives as React primitive props on one `Pressable` wrapping the scene: `onLayout` (capture the scene rect for picking), `onMouseDown/Move/Up` (orbit drag + click), `onWheel` (zoom — first `onWheel` sighting in this review set). The host's involvement is entirely via the standard primitive prop pipeline (`scene3d*` props → `framework/gpu/3d.zig`).

Everything else is plain JS: sine/cosine terrain function, Set-based occupancy, slab-method ray intersection, hex→RGB float conversion, reduce/filter state updates.

## Data model

- `Block = { id, x, y, z, kind }` in a flat `Block[]` — no chunks, no octree, no typed arrays. `id` is a monotonic integer (next = max+1); identity for selection and React keys.
- `occupied: Set<string>` keyed `"x:y:z"` (`coordKey`) — rebuilt by `useMemo` on every blocks change; the collision/occupancy structure.
- `BLOCKS` registry (line 28): per-kind `{ label, color, opacity?, drop?, solid? }`. `opacity` drives translucent kinds (leaf 0.82, glass 0.42, water 0.48) through the scene3d transparency path. `drop` remaps what mining yields (grass → dirt). **`solid: false` on water is declared but never read — dead field** (no physics here to consume it).
- `Inventory = Record<BlockKind, number>`, seeded by `START_INVENTORY`; build decrements, mine increments the drop kind.
- `FACES`: the six axis-unit face descriptors `{ key, label, dx, dy, dz }` — shared vocabulary between picking (which face the ray entered), the face-handle gizmos, and placement (`add(block, face)`).

## World generation

`makeWorld()` (line 83): a 13×13 column field over `heightAt(x,z)` — a three-term sine/cosine wave rounded to int (range ≈ ±2). Layers per column: stone at y=-2, stone-or-dirt at y=-1, grass/dirt at 0, grass at 1 where the wave peaks; a water pond stamped into a fixed rectangle where the wave dips. Three procedural trees (`tree(x,z)`: 3 wood + diamond-shaped leaf canopy + cap) at fixed sites. A `put` guard set prevents double-occupancy during gen. Deterministic — same world every reset.

## Rendering — instancing by kind

`instanceBatches` (line 322, memoized on `blocks`): groups blocks by kind and packs each group into a flat stride-9 instance array `[x, y, z, sx=1, sy=1, sz=1, r, g, b]` (colors from `hexRgb` of the kind color). Each batch renders as

```tsx
<Scene3D.Instances geometry={Geometry.Box} params={{width:1,height:1,depth:1}}
                   data={batch.data} count={batch.count} stride={9} boundsRadius={40} />
```

`Scene3D.Instances` (`runtime/primitives.tsx:709-733`): requires a registry geometry generator, interns it (`internGeometry`), and **ships vertices only the first time a geometry key is seen** (`hasShipped`/`markShipped`) — subsequent nodes carry just `scene3dGeomKey`. Emits `scene3dInstanceData/Count/Stride` for the host's instanced draw. So the whole voxel field is ≤9 draw-ish nodes (one per kind present) regardless of block count, with one shared unit-cube vertex buffer — the unit-params + per-instance-scale rule applied at the instancing level.

Notable consequence: per-block translucency (`opacity`) is *not* in the stride-9 instance format — translucent kinds (glass/water/leaf) render **opaque** in the instanced field; opacity only appears on the singleton overlay meshes (selection ring, ghost, handles). Visual fidelity gap to know about before reusing this as "the voxel renderer."

No hidden-face culling or neighbor occlusion — buried blocks are full instances. Fine at ~300 blocks; the scaling answer if this grows is chunk meshing, not more instances.

Scene dressing: skybox (day params + `night={0}`), explicit `Scene3D.Fog near=42 far=78` color-matched to the horizon, ambient + directional + faint cyan point light, a dark base slab positioned just below the lowest block (`minY - 0.56`), camera `far={90}`.

## Picking — the hand-rolled ray

Click resolution is full 3D ray/AABB, all cart-side:

1. `screenRay(sx, sy, rect, cam)` (line 137): rebuilds the camera view basis (forward from `pos-target`, side = assume up≈+Y, up = f×s), converts the pixel to NDC, scales by `tan(fov/2)` and aspect, and returns a normalized world ray. **This duplicates the basis construction inside `runtime/cameras/unproject.ts:unprojectGround`** — the registry only exports the ground-plane intersection, not the ray itself, so any cart needing non-ground picking (this one needs *block face* hits) must re-roll it. Extraction candidate: export `screenRay(sx, sy, rect, solved)` from `@reactjit/cameras` and make `unprojectGround` a consumer.
2. `rayBlockFace(o, d, block)` (line 157): classic slab-method ray-vs-unit-AABB, tracking which axis/sign produced the entry `t` and mapping it to a `Face` (exit face if the origin is inside). Returns `{t, face}`.
3. `pickBlockFace` (line 193): linear scan over **all** blocks, nearest positive `t` wins. O(n) per click — no acceleration structure, appropriate at this scale.

Click-vs-drag discrimination: `onMouseDown` starts a drag record; `onMouseMove` accumulates `|dx|+|dy|` into `d.dist` while orbiting (yaw +0.4°/px, pitch −0.3°/px clamped 7–84°); `onMouseUp` treats the gesture as a *click* only if total travel < 6px (line 350). Wheel zoom steps `dist` ±1.1 clamped 8–28. The scene rect from `onLayout` converts global mouse coords to scene-local before ray construction.

Camera: `solveCamera(CAMERAS.Orbit, { target, yaw, pitch, dist, zoom: 1, fov: 48 })`, memoized; target = blocks' centroid with y clamped to [0, 2.2] (the camera doesn't chase tall towers). Degrees throughout, per the registry contract.

## Gameplay logic

`placeOnFace(block, face)` (line 457) — the single click handler for both tools:

- Always: select the clicked block, remember the clicked face (`activeFace` drives the gizmo + ghost).
- **Mine**: refuse bedrock (`y <= -2`) and water (`status: 'Locked'`); otherwise filter the block out, increment `inventory[drop ?? kind]`, select the newest remaining block.
- **Build**: target cell = clicked block + face delta. Occupied → just select the occupant (`'Occupied'`). Empty but out of stock → `'No <kind>'`. Else append `{id: max+1, ...pos, kind: activeKind}`, decrement inventory, select the new block.

`status` is a one-string feedback channel rendered in the HUD (also `'Miss'` on empty-space clicks, `'Selected #n'` from the Recent list). `reset()` rebuilds the deterministic world and restores all six state slots.

Selection visualization, all singleton translucent meshes layered over the instanced field:
- 1.08³ white (build) / red (mine) shell around the selected block;
- six `FaceHandle` slabs floating 0.56 out from each face (thin 0.08 along their axis), the active face brighter and tinted by the active kind (or red in mine mode);
- in build mode, a 0.96³ **ghost preview** at the placement cell — active kind's color at 0.38 opacity, or red at 0.24 if the cell is occupied.

## UI structure

Root `Box` with the scene `Pressable` filling it and three absolutely-positioned HUD panels as **later siblings** (the overlays-last hit-test rule): left control panel (title + status, Build/Mine/Reset buttons, 7-slot `HOTBAR` with swatch + count — selecting a slot also switches to build —, BLOCKS/HEIGHT/TOOL meters with HEIGHT turning green at y≥8), right "Recent" panel (last 12 blocks, newest first, click to select), bottom selected-info bar (id, swatch, kind, coords, `activeFace label > preview coords` with occupancy tint). Local `Button`/`HotbarSlot`/`BlockButton` are styled Pressable wrappers; inline styles only, translucent hex backgrounds (`#0f1110e6`) for the panel glass effect.

## What is not here

- No host calls, no persistence (world resets on relaunch), no save/load despite being an editor-shaped toy.
- No keyboard input, no player avatar, no physics/gravity (blocks float where placed), no water flow.
- No textures — flat per-kind colors; no per-instance opacity (see rendering note).
- No chunking/meshing/culling; no spatial index for picking.
- No use of `unprojectGround`, `Scene3D` `onClick`-style host picking, or `__path_*` — picking is pure cart math.
- `solid` field and `water` inventory slot (always 0, not in HOTBAR) are scaffolding for mechanics that don't exist yet.

## Integration-relevant observations

- **`Scene3D.Instances` + group-by-kind + stride-9 `[pos, scale, rgb]`** is the proven cheap path for many-identical-meshes worlds — directly relevant to hmsc props/voxel experiments (`cart/hmsc-int/VoxelHybridRoute.tsx` is the sibling exploration). The ship-vertices-once intern behavior means instanced fields are nearly free to re-render on data change.
- **The picking gap is real**: the cameras registry owns the camera inverse but only exposes ground picking; this cart proves the demand for an exported generic `screenRay`. Three code bodies now build the same view basis (unproject.ts, this cart, scape3d's original projection.ts it was lifted from).
- **Face vocabulary** (`FACES` six-delta table + entry-face slab test + face-adjacent placement) is the reusable voxel-editing core — the same shapes any block editor (hmsc-int voxel route) needs.
- **Click-vs-drag via travel threshold** on a single Pressable (rather than separate click handling) is the established gesture pattern for orbit-plus-pick scenes; same idea as physics_lab's drag but with the 6px click gate added.
- **cart.json manifest** (window size, chrome) is how directory carts parameterize the host window — worth standardizing across the game carts.
- **Block registry with `drop`/`solid`/`opacity`** is a miniature of the hmsc kind-registry idea (kind-derived behavior in one table); `solid` being dead here shows the table is ahead of the mechanics.
- Inventory + drops close the build/mine resource loop in ~30 lines — a clean reference for "finite resources" before any real survival system exists.

## Glossary

Active face: The most recently clicked `Face`; drives the gizmo highlight, the ghost position, and where Build places.

Block kind: One of 9 string keys into the `BLOCKS` registry (color/opacity/drop/solid per kind).

cart.json: Directory-cart manifest declaring window name/size/chrome to the host.

Click gate: The <6px total-travel threshold distinguishing a pick click from an orbit drag on mouseup.

Drop: The kind banked into inventory when a block is mined (`BLOCKS[kind].drop ?? kind`); grass drops dirt.

Face / FACES: The six axis-unit face descriptors `{key, label, dx, dy, dz}` shared by picking, gizmos, and placement.

Face handle: The thin translucent slab gizmo floating off each face of the selected block; active one tinted.

Ghost preview: The translucent cube at the would-be placement cell; red when the cell is occupied.

Hotbar: The 7 placeable kinds with live inventory counts; selecting one also switches the tool to Build.

Instance batch: One kind's flat stride-9 array `[x,y,z,1,1,1,r,g,b]` rendered by a single `Scene3D.Instances`.

Occupancy key: `"x:y:z"` string in the `occupied` Set — the world's collision/duplicate test.

Orbit rig: `CAMERAS.Orbit` — pure solve of `{target, yaw°, pitch°, dist, zoom, fov}` to `{pos, target, fov}`.

Ship-once vertices: `Scene3D.Instances`' intern behavior — geometry vertices cross the bridge only the first time a geometry key is used; later nodes send just the key.

Slab test: The per-axis ray/AABB entry-exit interval intersection in `rayBlockFace`, tracking which face the ray entered.

screenRay: The cart's hand-rolled pixel→world ray (camera basis + NDC + fov scale) — duplicate of the unexported math inside `unprojectGround`.
