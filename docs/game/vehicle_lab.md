# vehicle_lab cart inventory

Source cart: `cart/vehicle_lab/`

Reviewed: 2026-06-04

## High-level purpose

`vehicle_lab` is a directory cart that prototypes a semantic 3D vehicle rig for the game work. It is not just a visual car viewer. Its main product is a reusable contract where every rendered vehicle part has a named gameplay counterpart: visible meshes, damage-capable hitboxes, critical parts, glass metadata, generated gas tank placement, and named anchors.

The cart presents one generated vehicle at a time and lets the user change style, service role, motion pose, gas tank placement, selected part, and damage state. The scene is rendered in `Scene3D`, while the left panel exposes the data contract in English labels and compact controls.

This lab fits the same pattern as the head/animation/game labs: author simple semantic parts now, then let future systems attach collision, damage, pathing, traffic, repair, AI targeting, and mission rules to the same names.

## Files involved

- `cart/vehicle_lab/cart.json`: cart manifest and launch size.
- `cart/vehicle_lab/index.tsx`: cart entry, exported vehicle data types, procedural vehicle generation, semantic mesh and hitbox builder, animation sampling hookup, damage controls, gas tank controls, and 3D scene UI.
- `cart/animationDsl.ts`: shared timeline parser and sampler used by this cart's vehicle pose system.
- `cart/hmsc/render3d/materials.ts`: shared material helpers used for auto glass and side glass.
- `runtime/primitives.tsx`: provides `Box`, `Row`, `Col`, `Text`, `Pressable`, and `Scene3D`; also maps `Scene3D.Mesh` material opacity into the host transparent render pass.
- `runtime/cameras/index.tsx`: provides `OrbitCamera`, which resolves to a `Scene3D.Camera`.
- `runtime/geometries/index.ts`: provides `Geometry.Box`, `Geometry.Cylinder`, and `Geometry.Sphere` generator definitions consumed by `Scene3D.Mesh`.
- `framework/gpu/3d.zig`: host-side 3D renderer that consumes the scene props emitted by `Scene3D`.

## Manifest

`cart/vehicle_lab/cart.json` names the cart `Vehicle Lab`, describes it as "A semantic vehicle rig lab with glass, wheels, hitboxes, and generated gas tank placement.", and requests a 1280 by 820 window.

The cart is a directory cart, so `cart/vehicle_lab/index.tsx` is the executable entry component.

## Imports and primitive surface

At `cart/vehicle_lab/index.tsx:8-13`, the cart imports React hooks, ReactJIT layout and 3D primitives, shared geometry generators, the orbit camera helper, the animation DSL helpers, and HMSC material helpers.

React hooks used:

- `useState`: vehicle document, pose, animation frame, run toggle, debug toggles, selected part, camera yaw, camera pitch, and camera distance.
- `useEffect`: starts and cleans up a JavaScript `setInterval` for animation playback while the lab is running.
- `useMemo`: memoizes parsed animation timelines, sampled pose actions, built vehicle meshes and hitboxes, and unique hitbox group labels.
- `useRef`: stores pointer drag state for orbiting the camera.
- `memo`: wraps `VehicleMeshes` so scene mesh generation is isolated from unrelated panel updates.

ReactJIT primitives used:

- `Row`: root split layout, button rows, property rows, and scene wrapper rows.
- `Col`: left control panel and grouped vertical sections.
- `Box`: dividers, spacing blocks, and the zoom control overlay.
- `Text`: headings, explanatory labels, stat readouts, and control text.
- `Pressable`: chips, toggles, damage buttons, camera drag surface, and zoom buttons.
- `Scene3D`: the right-side 3D viewport.
- `Scene3D.Camera`: emitted indirectly through `OrbitCamera`.
- `Scene3D.AmbientLight`, `Scene3D.DirectionalLight`, and `Scene3D.PointLight`: scene lighting.
- `Scene3D.Mesh`: every vehicle part, hitbox overlay, anchor marker, and floor slab.

Geometry generators used:

- `Geometry.Box`: body panels, windows, lights, doors, decals, stripes, hitboxes, anchors that are box-like, and the floor slab.
- `Geometry.Cylinder`: wheels, gas port, lightbar caps, hose reels, and other round equipment.
- `Geometry.Sphere`: small anchor markers.

There are no browser DOM primitives, CSS cascade assumptions, `document`, `window`, `fetch`, or `localStorage` calls in this cart.

## Exported data contract

The top of `cart/vehicle_lab/index.tsx` defines and exports the semantic data model that future game systems can reuse.

`VehicleStyleId` is the visual/body class:

- `sedan`
- `coupe`
- `wagon`
- `van`
- `pickup`
- `sports`
- `ambulance`
- `fire_truck`

`VehicleRoleId` is the gameplay/service class:

- `civilian`
- `police`
- `medical`
- `fire`

`VehiclePoseId` is the animation preset id:

- `parked`
- `roll`
- `turn`
- `bounce`
- `brake`

`DamageLevel` is a numeric part state: `0`, `1`, `2`, or `3`.

`VehiclePartId` is the named part vocabulary used by meshes, hitboxes, selection controls, and damage controls:

- `body`
- `cabin`
- `trunk`
- `bumper`
- `windshield`
- `driver_side`
- `passenger_side`
- `rear`
- `front_lights`
- `rear_lights`
- `driver_door`
- `passenger_door`
- `hood`
- `front_left_wheel`
- `front_right_wheel`
- `rear_left_wheel`
- `rear_right_wheel`
- `gas_tank`

`VehicleMesh` is the visual part shape. It carries:

- `id`: semantic part id.
- `label`: human label for UI/debugging.
- `kind`: `box`, `cylinder`, or `sphere`.
- `params`: geometry params passed to the generator.
- `position`, `rotation`, and `scale`: transform data.
- `material`: either a color string or an object carrying color, opacity, breakable state, and health metadata.

`VehicleHitbox` is the gameplay/collision part shape. It carries:

- `id`: semantic part id, intentionally matching the visual part vocabulary.
- `label`: human label.
- `position`, `rotation`, and `size`: hit volume transform.
- `damage`: current damage level for that part.
- `critical`: whether the part should matter more to future damage/collision rules.

`VehicleDoc` is the generated/editable vehicle source document. It stores style, role, seed, paint color, trim color, gas side, gas Z placement, and a sparse damage map keyed by part id.

`VehicleBuild` is the derived runtime build. It stores the rendered meshes, hitboxes, and anchors.

## Style and role registries

`VEHICLE_STYLES` at `cart/vehicle_lab/index.tsx:91-100` defines eight body styles. Each style gives the builder fixed dimensions:

- `label`: display label.
- `length`: full vehicle length.
- `width`: full vehicle width.
- `bodyH`: body height.
- `cabinH`: cabin height.
- `cabinZ`: cabin center along the vehicle length.
- `cabinD`: cabin depth.
- `wheelR`: wheel radius.
- `clearance`: vertical clearance from ground to body.

`VEHICLE_ROLES` at `cart/vehicle_lab/index.tsx:102-107` defines four roles:

- `civilian`: regular vehicles, broader style pool, generated paint and trim.
- `police`: sedan, wagon, or sports body; white paint and blue trim.
- `medical`: ambulance or van body; white paint and red trim.
- `fire`: fire truck or pickup body; red paint and yellow trim.

The role registry does two jobs. It constrains which styles make sense for the role, and it supplies default service livery colors.

## Pose and animation DSL usage

`VEHICLE_POSES` at `cart/vehicle_lab/index.tsx:109-115` maps pose ids to labels and animation DSL strings.

The DSL strings use bracket groups from `cart/animationDsl.ts`. Each action is shaped like:

```text
[duration,target,action]
```

Multiple simultaneous actions inside a bracket group are separated with semicolons.

The vehicle poses are:

- `parked`: `[1,vehicle,parked]`
- `roll`: `[0.8,wheels,spin_loop;0.8,vehicle,drive_loop]`
- `turn`: `[0.8,wheels,spin_loop;0.8,front_wheels,steer_loop;0.8,vehicle,drive_loop]`
- `bounce`: `[0.7,suspension,bounce_loop]`
- `brake`: `[0.8,vehicle,brake]`

`parseAnimationDsl` in `cart/animationDsl.ts:99-121` parses bracket groups or pipe-separated chunks into timeline steps. `sampleAnimationTimeline` in `cart/animationDsl.ts:123-148` samples the current step at a given second and returns actions with `target`, `action`, `phase`, `weight`, and `args`.

The DSL parser already knows vehicle aliases at `cart/animationDsl.ts:68-78`:

- `car`, `auto`, and `body_shell` canonicalize to `vehicle`.
- `front_wheel` and `steering` canonicalize to `front_wheels`.
- `rear_wheel` canonicalizes to `rear_wheels`.
- `tire`, `tires`, and `wheel` canonicalize to `wheels`.
- `shock` and `shocks` canonicalize to `suspension`.

`VehicleLab` parses the selected pose's DSL with `useMemo`, samples it using the current seconds value, and passes the sampled actions into `buildVehicle`.

The animation clock is JavaScript-side. When `running` is true, a `setInterval` fires every 33 ms and increments `frame`. The cart converts frames to seconds with `(running ? frame : 0) / 60`. When the lab is paused, seconds go back to zero, so the displayed pose returns to its start position.

## Procedural vehicle generation

`makeVehicle(seed)` at `cart/vehicle_lab/index.tsx:173-192` creates a deterministic `VehicleDoc`.

Generation details:

- It creates a local seeded random function with `seededRandom(seed)`.
- It chooses a role from `ROLE_POOL`, where `civilian` appears more often than service roles.
- It chooses a style from that role's allowed style list.
- It chooses a body color from `COLORS`, unless the role is a service role with a fixed color.
- It chooses a trim color from `TRIMS`, unless the role is a service role with a fixed trim.
- It chooses `gasSide` as `driver` or `passenger`.
- It chooses `gasZ` with a rear-biased range. Wagons, vans, ambulances, and fire trucks bias the gas port farther back than shorter passenger cars.
- It initializes `damage` as an empty sparse map.

`generate()` in the UI creates a new seed with `Date.now()` and `Math.random()`, calls `makeVehicle`, resets the selected part to `gas_tank`, resets pose to `parked`, and stops animation playback.

Important distinction: generated vehicles are deterministic after the seed is known, but the UI seed source is intentionally non-deterministic.

## Geometry and material helpers

`geometryFor(kind)` at `cart/vehicle_lab/index.tsx:194-196` maps this cart's three local mesh kinds to shared generator definitions:

- `box` -> `Geometry.Box`
- `cylinder` -> `Geometry.Cylinder`
- `sphere` -> `Geometry.Sphere`

The geometry registry in `runtime/geometries/index.ts` defines generator objects with stable ids and pure `generate(params)` functions. `Scene3D.Mesh` detects geometry defs in `runtime/primitives.tsx:569-570`, interns generated vertex data, and ships interned geometry to the host. This cart does not hand-author vertex buffers.

Material helpers:

- `panelMaterial(base, damage)` returns the base color at damage 0, then darker shaded colors at damage 1 through 3.
- `glassMaterial(base, damage)` returns HMSC glass metadata with lower opacity and darker color as damage increases.
- `GLASS` uses `AutoGlass({ opacity: 0.48 })`.
- `SIDE_GLASS` uses `Glass({ color: '#1f3441', opacity: 0.42, health: 18 })`.
- `HEADLIGHT`, `TAILLIGHT`, and `GAS_PORT` are local material objects carrying color, opacity, breakable, and health fields.

In `cart/hmsc/render3d/materials.ts`, `Glass` and `AutoGlass` return material objects that combine render properties (`color`, `opacity`) with future gameplay properties (`breakable`, `health`). In `runtime/primitives.tsx:540-546`, `Scene3D.Mesh` reads object material opacity and forwards alpha below 1 through the transparent render path.

The `breakable` and `health` fields are metadata for future systems. In this cart they are authored and carried with the surface, but no damage simulation consumes them yet.

## Vehicle builder

`buildVehicle(doc, actions)` at `cart/vehicle_lab/index.tsx:220-545` is the main semantic builder. It converts one `VehicleDoc` plus sampled animation actions into a `VehicleBuild`.

Inputs:

- `doc`: selected style, role, seed, paint, trim, gas placement, and damage map.
- `actions`: sampled animation actions from the shared DSL.

Outputs:

- `meshes`: visible 3D vehicle parts and debug/service details.
- `hitboxes`: semantic gameplay boxes aligned with visible panels.
- `anchors`: named points for future occupants, interaction, towing, gas targeting, and repair/hood actions.

The builder starts by reading sampled animation actions:

- `wheels spin_loop` rotates wheels by `phase * 720`.
- `front_wheels steer_loop` steers front wheels with `sin(phase * 2pi) * 24`.
- `suspension bounce_loop` moves the whole vehicle vertically by `weight * 0.045`.
- `vehicle drive_loop` adds a smaller vertical motion with `weight * 0.012`.
- `vehicle brake` pitches the nose down with `weight * -3`.

It then derives style dimensions, body positions, door positions, axle positions, service-vehicle flags, role metadata, and cascading damage values.

Local builder helpers:

- `add(...)`: pushes one `VehicleMesh`.
- `box(...)`: pushes one `VehicleHitbox`.
- `scar(...)`: adds small dark damage decals for damaged panels.
- `crack(...)`: adds thin light crack decals for damaged glass.
- `sideStripe(...)`: adds role livery stripes.
- `sideMark(...)`: adds service lettering or symbols as box decals.

## Visual vehicle parts

The builder creates visual parts in semantic groups.

Main shell:

- Ordinary cars receive a body box, hood box, lower body trim, front bumper, rear bumper, and optional damage scars.
- Boxy service vehicles use taller rear modules and flatter main bodies.
- Fire trucks receive a distinct hood and body proportions.

Cargo and rear area:

- Pickups receive a bed, bed rails, and a tailgate.
- Ambulances and fire trucks receive a rear module, module roof, rear door, side compartments, rear step, and role equipment.
- Ordinary vehicles receive a trunk piece and rear glass.

Cabin and glass:

- `cabin` is a body-colored cabin block.
- `windshield` is a translucent auto-glass panel.
- `rear` glass is treated as part of the rear semantic part.
- `driver_side` and `passenger_side` glass use side glass material.
- Damaged glass receives crack decals.

Doors and lights:

- `driver_door` and `passenger_door` are visible side panels.
- `front_lights` and `rear_lights` are translucent breakable material objects.

Gas tank:

- `gas_tank` is shown as a small side cylinder.
- Its side comes from `doc.gasSide`.
- Its front/back placement comes from `doc.gasZ`.
- Its material darkens at damage 2 or higher.

Service details:

- Police vehicles get side stripes, `POLICE` side marks, a roof lightbar, front push bumper, and grille/bumper details.
- Medical vehicles get red side stripes, red cross marks, roof lightbar, rear medical stripe, and ambulance side marks.
- Fire vehicles get yellow side stripes, fire lettering, ladder/equipment pieces, hose reels, lightbar, and extra fire truck equipment.

Wheels:

- Four semantic wheel ids are created: front left, front right, rear left, and rear right.
- Wheel meshes are cylinders rotated onto the axle.
- Front wheels receive steering rotation from the sampled animation action.
- All wheels receive spin rotation from the sampled animation action.
- Damage reduces the tire radius slightly and adds flat-tire detail at damage 2 or higher.
- Fire trucks receive tandem rear wheel duplicates for the service vehicle silhouette, but the semantic wheel ids stay the four main ids.

## Hitbox contract

Gameplay hitboxes are authored after the visible vehicle pieces. They are not inferred by the host and they are not generated from mesh bounds. The builder explicitly creates semantic hitboxes with matching part ids.

Hitboxes include:

- `body`
- `cabin`
- `trunk`
- `bumper`
- `hood`
- `windshield`
- `driver_side`
- `passenger_side`
- `rear`
- `driver_door`
- `passenger_door`
- `front_lights`
- `rear_lights`
- `gas_tank`
- `front_left_wheel`
- `front_right_wheel`
- `rear_left_wheel`
- `rear_right_wheel`

Critical hitboxes:

- `hood`
- `gas_tank`
- all four wheel hitboxes

The hitboxes intentionally use proud boxes that are visible and selectable as debugging geometry. In the scene, a selected hitbox is rendered as a stronger orange transparent box. When `showHitboxes` is enabled, all hitboxes are rendered as transparent overlays:

- undamaged non-critical parts use a cool blue overlay.
- damaged parts use an orange overlay.
- critical parts use a red overlay.

This is the clearest recurring concept in the cart: visual meshes and gameplay volumes share names but remain separate authored data.

## Anchors

`VehicleBuild.anchors` contains named points that are not collision boxes.

Anchors created by `buildVehicle`:

- `driverSeat`: inside the left/front cabin.
- `passengerSeat`: inside the right/front cabin.
- `hoodLatch`: near the front hood line.
- `gasPort`: exactly tied to generated gas side and gas Z placement.
- `towRear`: behind the vehicle rear.

When `showAnchors` is enabled, `VehicleMeshes` renders these as small spheres. `gasPort` is yellow and the other anchors are green.

These anchors are likely future connection points for entering vehicles, targeting fuel systems, towing, repair, prompts, AI behavior, and mission scripting.

## Damage model

Damage is stored in `VehicleDoc.damage` as a sparse record keyed by `VehiclePartId`. Missing entries mean damage level 0.

Helper behavior:

- `damageOf(doc, id)` reads the sparse map and defaults to 0.
- `maxDamage(doc, ids)` cascades multiple part damage values into one worst visible state.
- `setPartDamage(id, level)` writes a part damage level and deletes the key when the level is 0.
- `nudgeSelectedDamage(delta)` increments or decrements the currently selected part's damage, clamped from 0 to 3.
- `randomDamage()` loops all semantic parts and assigns random damage with a weighted chance toward undamaged or light damage.

Visible damage effects:

- Body panels darken as their damage level rises.
- Glass becomes darker and more transparent as damage rises.
- Damaged panels can receive scar decals.
- Damaged glass can receive crack decals.
- Wheel damage shrinks tire radius and adds flat-tire visual detail.
- Gas port material darkens at heavy damage.

No physics, collision response, health decrement, or shatter simulation runs in this cart. The cart authors the data and preview visuals needed by those systems.

## UI controls

The default `VehicleLab` component at `cart/vehicle_lab/index.tsx:627-839` renders a two-panel interface.

Left panel controls:

- Header with purpose text.
- Style chips from `VEHICLE_STYLES`.
- Service role chips from `VEHICLE_ROLES`.
- Motion pose chips from `VEHICLE_POSES`.
- A run/pause chip that toggles the JavaScript animation interval.
- Debug toggles for hitboxes and anchors.
- Generate button for a new seeded vehicle.
- Paint button for deterministic-ish repainting from the current seed and `Date.now()`.
- Gas side chips for driver/passenger.
- Gas Z nudge control with minus and plus buttons.
- Hitbox selection chips generated from the built hitbox ids.
- Repair, damage, and wreck buttons for the selected part.
- Direct damage level chips from 0 through 3.
- A text contract panel showing style, role, scale, size, wheel radius, current DSL, seed, gas tank placement, selected part, and selected damage.

Right panel:

- A `Pressable` scene surface handles pointer down/move/up/leave for camera orbit.
- `Scene3D` renders grid, lights, camera, floor, and vehicle.
- A bottom-right zoom control adjusts orbit distance.

The small control components are:

- `Chip`: a styled `Pressable` used for toggles and choices.
- `Knob`: a text label with minus and plus `Pressable` buttons.

## Camera and scene behavior

The camera is an `OrbitCamera` with target `[0, 0.8, 0]`, yaw and pitch from state, distance from state, and `fov={42}`.

Pointer dragging on the scene updates orbit state:

- horizontal movement changes yaw by `dx * 0.38`.
- vertical movement changes pitch by `dy * 0.3`.
- pitch is clamped from 5 to 82 degrees.

The zoom knob changes distance in 0.5 increments and clamps it from 4 to 14.

The scene uses a dark background, a visible grid, no axes, one ambient light, one directional light, one point light, and a floor slab.

## Host and JavaScript boundary

Direct host functions used by this cart: none.

The cart does not call:

- `globalThis.__exec`
- `globalThis.__fs_readfile`
- `globalThis.__fs_writefile`
- `globalThis.__store_get`
- `globalThis.__store_set`
- `globalThis.__http_get`
- `globalThis.__http_post`
- `globalThis.__clipboard_get`
- `globalThis.__clipboard_set`
- `globalThis.__openWindow`
- `globalThis.__registerDispatch`

JavaScript/runtime work done inside the cart:

- React state and memo calculations.
- Seeded random generation.
- Math-based procedural vehicle layout.
- Animation DSL parsing and sampling through shared JavaScript helpers.
- JavaScript `setInterval` for the preview animation clock.
- Pointer event handlers on `Pressable` for camera orbit.

Host-backed work used through primitives:

- `Pressable` events are delivered through the ReactJIT event path.
- `Scene3D.Mesh` props are converted into host scene props.
- Shared geometry defs are generated/interned in JavaScript, then drawn by the host 3D renderer.
- Mesh opacity below 1 is routed into the host transparent render path.
- `OrbitCamera` resolves to a `Scene3D.Camera` element, and the host renders the scene from that camera.

The important line is that game semantics are authored in TypeScript, while rendering, hit testing, and GPU drawing are host-backed through the primitive system.

## Recurring concepts surfaced by this cart

Semantic part id:

The repeated name that joins visuals, hitboxes, selection UI, damage state, and future gameplay rules. `gas_tank`, `hood`, and wheel ids are the strongest examples.

Vehicle document:

The source-of-truth object describing style, role, seed, color, trim, gas placement, and damage. The builder can recreate a whole visible/debug vehicle from this document.

Builder:

A pure-ish function that turns a document and sampled animation actions into meshes, hitboxes, and anchors. This is likely the reusable shape other game systems should target.

Mesh:

Visible 3D output. Meshes can be semantic body parts, decals, equipment, service livery, wheels, floor, hitbox overlays, or anchors.

Hitbox:

Explicit gameplay volume with a semantic id, size, damage value, and critical flag. It is separate from visual geometry.

Anchor:

Named point of interaction or attachment, separate from both mesh and hitbox. Seats, gas port, tow point, and hood latch are anchors.

Critical part:

A hitbox flag for parts that should matter more to future damage or gameplay systems. Current examples are hood, gas tank, and wheels.

Gas tank placement:

A generated and editable gameplay target. It has side, Z placement, visual port mesh, critical hitbox, and matching gasPort anchor.

Service role:

A gameplay/livery category that constrains style selection and changes paint, trim, markings, roof equipment, and vehicle silhouette.

Damage cascade:

A visual grouping rule where one visible panel may respond to the worst damage level across multiple semantic parts.

Transparent material:

An object material with `opacity < 1`, usually from HMSC glass helpers. It is rendered as glass today and carries breakable/health metadata for future damage systems.

Animation action:

A sampled DSL result with target/action/phase/weight. The vehicle builder interprets only the targets/actions it understands.

Pose:

A named UI preset that maps to an animation DSL string. Poses are compact authoring data rather than hardcoded frame functions.

Orbit debug viewer:

The cart's camera mode for inspecting the generated contract. It is user-facing lab UI, not part of the vehicle data model.

## Integration notes

The most reusable unit is not the `VehicleLab` React component. It is the trio of:

- `VehicleDoc`
- `buildVehicle(doc, actions)`
- the shared `VehiclePartId` vocabulary

Those are the shapes future HMSC vehicle work can connect to without depending on the debug panel.

The current builder already has a useful separation:

- generation creates a document.
- animation sampling creates action values.
- building creates meshes, hitboxes, and anchors.
- rendering maps those build products to `Scene3D.Mesh`.
- UI edits mutate the document and selected debug state.

The likely consolidation target is a shared vehicle module that owns the data types, style/role registries, generation, and builder, with this lab remaining as one editor/viewer for that module.

