# camera_lab cart inventory

Source cart: `cart/camera_lab.tsx`

Reviewed: 2026-06-04

## High-level purpose

`camera_lab` is a single-file cart that showcases the shared `@reactjit/cameras` camera rig system. It builds one static 3D scene, then swaps different drop-in camera components over that same scene: `Orbit`, `Follow`, `TopDown`, `Isometric`, `FirstPerson`, `FreeFly`, and `Cinematic`.

The central point of the cart is that each camera rig resolves to the same common shape, called `Solved`: `{ pos, target, fov }`. The cart uses that `Solved` both to render `<Scene3D.Camera>` and to unproject a screen click onto the ground. Because picking depends only on `Solved`, the click-to-ground marker works across all rigs without per-rig picking code.

The cart also compares two humanoid construction strategies in one scene: a parts-based character made from separate primitive meshes, and a single authored `Geometry.Humanoid` mesh with a generated atlas texture.

## Files involved

- `cart/camera_lab.tsx`: cart entry and all cart-specific UI, scene, input, camera selection, texture generation, FreeFly movement, and picking behavior.
- `runtime/cameras/index.tsx`: exports camera components, `CAMERAS`, `solveCamera`, `unprojectGround`, and modifiers such as `sway`.
- `runtime/cameras/types.ts`: defines `Vec3`, `Rect`, `Solved`, `CameraDef`, and `Modifier`.
- `runtime/cameras/rigs/orbit.ts`: third-person orbital rig.
- `runtime/cameras/rigs/follow.ts`: chase/follow rig.
- `runtime/cameras/rigs/topDown.ts`: tactical overhead rig.
- `runtime/cameras/rigs/isometric.ts`: fixed-angle ARPG/isometric-style rig.
- `runtime/cameras/rigs/firstPerson.ts`: eye-level subject rig.
- `runtime/cameras/rigs/freeFly.ts`: spectator/debug free camera rig.
- `runtime/cameras/rigs/cinematic.ts`: film-shot director rig.
- `runtime/cameras/unproject.ts`: generic screen-to-ground picking from `Solved`.
- `runtime/cameras/modifiers.ts`: pure `Solved -> Solved` camera modifiers, including `sway`.
- `runtime/hooks/useIFTTT.ts`: exports `busOn`, which this cart uses for keydown/keyup event subscriptions.
- `runtime/primitives.tsx`: provides `Box`, `Row`, `Col`, `Text`, `Pressable`, and `Scene3D`.
- `runtime/geometries/index.ts`: provides geometry defs used by meshes.
- `runtime/geometries/Humanoid.ts`: defines the authored single-mesh humanoid and its atlas layout.
- `framework/gpu/3d.zig`: host-side wgpu renderer that consumes the `scene3d*` props emitted by `Scene3D`.

## Imports and primitive surface

At `cart/camera_lab.tsx:18-27`, the cart imports React hooks, ReactJIT primitives, the geometry registry, the camera package, and `busOn`.

React hooks used:

- `useState`: selected rig, orbit yaw/pitch, look yaw/pitch, sway toggle, marker position, and animation clock.
- `useRef`: scene rectangle, drag state, key state, FreeFly position, and live mirrored state for the animation loop.
- `useEffect`: subscribes to keyboard bus events and conditionally starts an animation loop.
- `useMemo`: memoizes the static scene so camera changes do not rebuild the mesh element tree.

ReactJIT primitives used:

- `Box`: full root container and toolbar spacer.
- `Row`: toolbar rows.
- `Col`: top control bar.
- `Text`: title, description, button labels, current rig blurb.
- `Pressable`: rig buttons, sway toggle, reset button, and the scene input surface.
- `Scene3D`: the 3D viewport.
- `Scene3D.Camera`: emitted indirectly by camera components from `@reactjit/cameras`.
- `Scene3D.AmbientLight`, `Scene3D.DirectionalLight`, `Scene3D.PointLight`: lighting.
- `Scene3D.Mesh`: all scene objects and the click marker.

Geometry generators used:

- `Geometry.Box`: torso pieces, eye boxes, ground slab, building.
- `Geometry.Sphere`: shoes, shoulders, hands, head in the parts figure.
- `Geometry.Cylinder`: limbs, neck, palm trunks, round building, marker.
- `Geometry.Cone`: nose, hat, palm crowns.
- `Geometry.Torus`: parts-figure belt.
- `Geometry.Humanoid`: authored one-piece humanoid mesh.

## Palette and texture generation

Color constants are declared at `cart/camera_lab.tsx:29-40`. They split into UI colors and character material colors.

`buildHumanoidAtlasTexture` at `cart/camera_lab.tsx:50-120` builds a procedural 64 by 64 RGBA texture object:

- Return shape: `{ width: number; height: number; hex: string }`.
- Pixel data is a continuous hex string with 8 characters per pixel: `RRGGBBAA`.
- It targets `Geometry.HUMANOID_ATLAS`, where quadrants represent head, arms, torso, and legs.
- It paints skin, shirt, pants, eyes, hair band, brows, nose shadow, mouth, and collar.
- It is pure JavaScript and does not use file IO or image assets.

`HUMANOID_TEXTURE` at line 122 stores the generated texture once at module load. It is passed to the single-mesh `Geometry.Humanoid` at lines 365-370 through the `texture` prop on `Scene3D.Mesh`.

In `runtime/primitives.tsx:550-561`, `Scene3D.Mesh` accepts a texture object shaped like `{ width, height, hex }`, validates its dimensions and hex length, and forwards texture data through `scene3dTexW`, `scene3dTexH`, and `scene3dTexData`.

## Parts-based humanoid

`PartRow` at `cart/camera_lab.tsx:130` is the parts figure data shape:

```ts
type PartRow = { shape: any; params: any; material: string; offset: Vec3; rotation?: Vec3 };
```

`HUMANOID` at `cart/camera_lab.tsx:132-151` is an array of 18 mesh parts:

- 2 cylinder legs.
- 2 sphere shoes.
- 1 box torso.
- 1 torus belt.
- 2 sphere shoulders.
- 2 cylinder arms.
- 2 sphere hands.
- 1 cylinder neck.
- 1 sphere head.
- 2 box eyes.
- 1 cone nose.
- 1 cone hat.

`add` at line 153 adds two `Vec3` tuples.

`Figure` at `cart/camera_lab.tsx:155-170` maps each `PartRow` to a `Scene3D.Mesh`. It applies:

- `geometry={p.shape}`,
- `params={p.params}`,
- `material={p.material}`,
- `position={add(position, p.offset)}`,
- `rotation={p.rotation ?? [0, 0, 0]}`.

This figure has no animation. It exists to show a character assembled from primitive shapes and to contrast with the one-piece humanoid.

## Palm tree helper

`PalmTree` at `cart/camera_lab.tsx:172-179` renders a simple two-mesh prop:

- A cylinder trunk.
- A cone crown.

It uses the same `add(position, localOffset)` pattern as `Figure`.

## Camera rig registry in the cart

`RIGS` at `cart/camera_lab.tsx:182` is the toolbar order and local rig vocabulary:

- `Orbit`
- `Follow`
- `TopDown`
- `Isometric`
- `FirstPerson`
- `FreeFly`
- `Cinematic`

`RigName` at line 183 is derived from that tuple.

`ANIMATED` at `cart/camera_lab.tsx:186-189` marks rigs that need an autonomous clock:

- `Follow`: true.
- `FreeFly`: true.
- `Cinematic`: true.
- `Orbit`, `TopDown`, `Isometric`, `FirstPerson`: false.

The clock also runs when `swayOn` is true.

`LOOK_RIG` at `cart/camera_lab.tsx:191-194` marks rigs where drag changes free look yaw/pitch instead of orbit yaw/pitch:

- `FirstPerson`: true.
- `FreeFly`: true.
- all others: false.

`BLURB` at `cart/camera_lab.tsx:196-204` stores one line of visible explanatory text per rig.

`TARGET` at `cart/camera_lab.tsx:206` is `[0, 1, 0]`, the chest-level look point for orbit-style rigs.

## Main component state

`CameraLab` starts at `cart/camera_lab.tsx:208`.

State:

- `rig` at line 209 starts as `Orbit`.
- `orbitYaw` and `orbitPitch` at lines 211-212 control orbit-style camera heading/elevation.
- `lookYaw` and `lookPitch` at lines 214-215 control first-person/free-fly look.
- `swayOn` at line 216 toggles camera sway modifier.
- `marker` at line 217 stores ground-pick result as `{ x, y }` or `null`.
- `clock` at line 218 is seconds elapsed for animated rigs and sway.

Refs:

- `rectRef` at line 220 stores the scene surface rectangle for unprojection.
- `dragRef` at line 221 stores last drag point and accumulated drag distance.
- `keysRef` at line 222 stores keydown state from the event bus.
- `freeRef` at line 223 stores the FreeFly camera eye position.
- `rigRef`, `lookYawRef`, and `lookPitchRef` at lines 226-228 mirror state so the animation loop reads current values without stale closure problems.

## Camera params and modifiers

`paramsFor(name)` at `cart/camera_lab.tsx:231-242` maps a local rig name to that rig's parameter object. All angles are in degrees.

Per-rig params:

- `Orbit`: target chest, yaw, pitch, distance 7, zoom 1, fov 55.
- `Follow`: target chest, heading derived from `clock * 38`, distance 6, height 3, lookHeight 1.1, fov 55.
- `TopDown`: target chest, height 13, tilt 12, heading from orbit yaw, fov 50.
- `Isometric`: target chest, yaw from orbit yaw, distance 17, fov 26.
- `FirstPerson`: ground position `[0, 0, 5.5]`, eyeHeight 1.7, facing/look yaw, pitch, fov 72.
- `FreeFly`: position from `freeRef.current`, look yaw, look pitch, fov 62.
- `Cinematic`: subject at origin facing 0 and time `clock`.

`mods` at line 243 returns `[sway(1, clock)]` when sway is on and an empty list otherwise.

`sway` comes from `runtime/cameras/modifiers.ts:15-31`. It is a pure modifier over `Solved`: it orbits slightly around the target, pulses distance, and pulses height. It reads no globals; the cart owns the time input.

## Shared camera infrastructure

`runtime/cameras/types.ts` defines `Solved` as `{ pos: Vec3; target: Vec3; fov: number }`.

Each camera rig is a pure solver:

- `Orbit` in `runtime/cameras/rigs/orbit.ts`: calculates an orbital eye around a target from yaw, pitch, distance, zoom, and fov.
- `Follow` in `runtime/cameras/rigs/follow.ts`: positions the eye behind a subject heading and looks at subject plus look height.
- `TopDown` in `runtime/cameras/rigs/topDown.ts`: positions the eye above a target with a small off-vertical tilt to avoid look-at singularity.
- `Isometric` in `runtime/cameras/rigs/isometric.ts`: uses a fixed isometric elevation with long distance and narrow fov.
- `FirstPerson` in `runtime/cameras/rigs/firstPerson.ts`: sets eye to subject position plus eye height and looks forward by facing/pitch.
- `FreeFly` in `runtime/cameras/rigs/freeFly.ts`: uses supplied position as the eye and looks forward by yaw/pitch.
- `Cinematic` in `runtime/cameras/rigs/cinematic.ts`: picks film-style shots over time and returns the shot's camera.

`solveCamera` in `runtime/cameras/index.tsx:50-55` spreads params over rig defaults, calls the rig solver, then applies modifiers in order.

`CameraRig` in `runtime/cameras/index.tsx:60-63` solves the rig and emits one `<Scene3D.Camera position={s.pos} target={s.target} fov={s.fov} />`.

Named drop-ins at `runtime/cameras/index.tsx:65-71` wrap `CameraRig`: `OrbitCamera`, `FollowCamera`, `TopDownCamera`, `IsometricCamera`, `FirstPersonCamera`, `FreeFlyCamera`, and `CinematicCamera`.

`CAMERAS` at `runtime/cameras/index.tsx:75-77` maps rig names to `CameraDef` objects. This cart uses it for picking.

## Keyboard and animation loop

The `useEffect` at `cart/camera_lab.tsx:246-305` subscribes to keyboard events and conditionally starts the animation loop.

`busOn` comes from `runtime/hooks/useIFTTT.ts`. That file exposes `busOn(event, fn)` as a facade over the shared FFI event bus `subscribe`. This cart subscribes to:

- `__keydown`
- `__keyup`

`setk` at `cart/camera_lab.tsx:255-261` lowercases the event key and writes boolean key state into `keysRef.current`. It also tracks modifier flags as `__shift`, `__ctrl`, and `__alt`, because Shift/Ctrl/Alt do not arrive as normal key names in this event payload.

If the active rig is not animated and sway is off, the effect still subscribes to keys but does not start a clock loop.

If a clock is needed, the effect:

- uses `globalThis.requestAnimationFrame` if available, otherwise `setTimeout(fn, 16)`;
- uses `globalThis.performance.now()` if available, otherwise `Date.now()`;
- computes `dt` and clamps it to a maximum of 0.05 seconds;
- updates FreeFly position if the current rig is `FreeFly`;
- increments `clock` by `dt`;
- reschedules itself.

FreeFly movement at `cart/camera_lab.tsx:274-299` is JavaScript-side:

- W/S move along the full look direction, including pitch.
- A/D strafe horizontally.
- E or Space move upward in world Y.
- Q or Shift move downward in world Y.
- Speed is `11 * dt`.
- The result is stored in `freeRef.current`.

This cart does not use the `isKeyDown` host function. It uses event-bus key state instead.

## Pointer drag and picking

Pointer handling is local JavaScript on the scene `Pressable`.

`onDown` at `cart/camera_lab.tsx:308` stores the initial pointer position and starts `dist` at 0.

`onMove` at `cart/camera_lab.tsx:309-322` updates the drag state:

- It accumulates drag distance as absolute dx plus absolute dy.
- If the current rig is a look rig, it updates `lookYaw` and `lookPitch`.
- Otherwise it updates `orbitYaw` and `orbitPitch`.
- Look pitch clamps to -80..80 degrees.
- Orbit pitch clamps to 6..85 degrees.

`onUp` at `cart/camera_lab.tsx:323-334` treats the input as a tap if accumulated drag distance is under 6:

- It reads the latest scene rect from `rectRef`.
- It subtracts rect origin from event coordinates to get local screen coordinates.
- It solves the current camera using `solveCamera(CAMERAS[rig], paramsFor(rig), mods())`.
- It calls `unprojectGround(sx, sy, r, solved)`.
- It stores the result in `marker`.

`unprojectGround` in `runtime/cameras/unproject.ts:16-82` reconstructs the view basis from the same `Solved` camera, creates a world ray from screen position and fov, marches the ray against a height function, then bisects the hit point. In this cart the default height function is used, so the ground is y=0. It returns `{ x, y }`, where returned `y` corresponds to world z.

`onLayout` at `cart/camera_lab.tsx:429` updates `rectRef` with `{ x, y, width, height }` from the scene `Pressable`.

## Camera component switch

`camera()` at `cart/camera_lab.tsx:336-348` builds props from the active rig params plus modifiers, then returns the corresponding camera component:

- `OrbitCamera`
- `FollowCamera`
- `TopDownCamera`
- `IsometricCamera`
- `FirstPersonCamera`
- `FreeFlyCamera`
- `CinematicCamera`

This is the "drop-in" demonstration: the scene remains the same; only the camera child changes.

## Static scene

The scene fragment is created with `useMemo` at `cart/camera_lab.tsx:350-377` and has an empty dependency array.

The memoized scene contains:

- Ambient light.
- Directional light.
- Two point lights.
- A large thin ground box at y=-0.1.
- The left parts-based `Figure` at `[-1.5, 0, 0]`.
- The right one-piece `Geometry.Humanoid` mesh at `[1.5, 0, 0]` with `HUMANOID_TEXTURE`.
- Two `PalmTree` props.
- A box building.
- A cylinder building.

The ground uses a thin `Geometry.Box`, not a plane. The source comment says this avoids top-down back-face culling.

The memoization is performance-significant. It keeps the mesh element tree stable while camera state changes, reducing repeated geometry shipping across the V8/Zig bridge. Runtime geometry interning in `runtime/primitives.tsx:563-680` also deduplicates generator output by geometry key, but keeping the scene stable avoids creating needless mesh prop churn.

## UI layout

The returned tree starts at `cart/camera_lab.tsx:379`.

Root:

- Full-size `Box` with column layout.
- Top `Col` control bar.
- Main `Pressable` scene area.

Control bar:

- Title row at lines 383-385.
- Rig buttons generated from `RIGS` at lines 387-404.
- Selecting a rig updates `rig` and clears the marker.
- Sway toggle at lines 406-416.
- Reset button at lines 417-422.
- Current rig blurb at line 424.

Scene area:

- `Pressable` captures layout, mouse down, mouse move, and mouse up.
- `Scene3D` at line 435 fills the area.
- `{camera()}` at line 436 emits the active camera.
- `{scene}` at line 437 emits the memoized static scene.
- If `marker` is set, line 439 renders a cylinder marker at `[marker.x, 0.06, marker.y]`.

## Runtime rendering path

The cart uses `Scene3D` declaratively. `runtime/primitives.tsx:405-424` documents that `Scene3D` emits host `View` nodes carrying `scene3d*` props. The real renderer is host-side wgpu in `framework/gpu/3d.zig`.

`Scene3D.Camera` in `runtime/primitives.tsx:454-465` maps `position`, `target`, and `fov` to host camera fields.

`Scene3D.Mesh` in `runtime/primitives.tsx:535-708` maps geometry defs, params, transforms, material, and optional texture data into host mesh fields.

This cart uses the canonical `@reactjit/geometries` generator path, not legacy string geometry names.

## Host functions and browser-like globals

Direct host function calls:

- None in `cart/camera_lab.tsx`.

Indirect host/runtime paths:

- `busOn` subscribes through the shared IFTTT/FFI event bus. Keyboard payloads originate from the runtime/host event system.
- `Scene3D` primitives emit host layout nodes consumed by the Zig/wgpu renderer.
- `Pressable` mouse/layout props are handled by the ReactJIT host event system.
- `Scene3D.Mesh` texture data is forwarded through runtime primitive props to the host renderer.

Browser-like globals used:

- `globalThis.requestAnimationFrame`, if present.
- `setTimeout` fallback for scheduling.
- `globalThis.performance.now`, if present.
- `Date.now` fallback for time.

Not used:

- No `document`.
- No `window`.
- No `fetch`.
- No filesystem calls.
- No store/local persistence.
- No clipboard.
- No HTTP.
- No shell execution.
- No direct `isKeyDown`.

## What is not here

- No cart folder or manifest. This is a single-file cart.
- No nested `AGENTS.md` applies to this path.
- No imported image/model assets.
- No external 3D model format.
- No animation clips or skeletal animation.
- No collision or physics system.
- No terrain height data; picking uses flat ground.
- No entity system.
- No camera smoothing hook; `useSmoothed` exists in `runtime/cameras/index.tsx` but is not used here.
- No camera roll support; the cinematic rig source notes this as a framework gap.
- No host-side movement controller; FreeFly movement is JavaScript-side.

## Integration-relevant observations

- `Solved` is the reusable camera currency. Rendering and picking both use it.
- Rigs are pure solvers and can be swapped without changing scene code.
- Picking should depend on resolved camera data, not rig identity.
- Modifiers like `sway` compose after rig solving and stay pure.
- A memoized static scene is useful when the camera changes frequently.
- Input can be split by intent: `Pressable` pointer events for drag/tap, bus events for keyboard state.
- The one-piece `Geometry.Humanoid` is a cleaner reusable avatar shape than manually stacking primitives.
- Procedural atlas generation is enough to test textured character meshes without external assets.
- Top-down cameras need ground surfaces that render from above; this cart uses a thin box instead of a plane.
- FreeFly demonstrates a debug/spectator camera pattern that is separate from character control.

## Glossary

ANIMATED: Local map that decides whether a rig needs a running clock loop.

BLURB: Local rig-name-to-description map shown in the control bar.

CAMERAS: Shared registry from camera id to `CameraDef`.

CameraDef: Shared camera rig definition with stable id, pure solver, and defaults.

CameraRig: Generic component that solves a camera and emits `Scene3D.Camera`.

Cinematic rig: Camera solver that chooses film-style shots over time.

Drag distance: Accumulated pointer movement used to distinguish tap from drag.

FreeFly: Debug/spectator rig whose eye position is directly controlled by keyboard and mouse.

HUMANOID: Local parts-array figure made from 18 separate primitive mesh parts.

HUMANOID_TEXTURE: Procedural 64 by 64 RGBA hex texture for the one-piece humanoid.

LOOK_RIG: Local map that decides whether drag changes look yaw/pitch or orbit yaw/pitch.

Marker: Cylinder mesh placed at the clicked ground location.

Modifier: Pure function from `Solved` to `Solved`, such as `sway`.

Orbit yaw/pitch: Local state for rigs that orbit or spin around a target.

Pressable scene surface: Full scene input area that captures layout, pointer drag, and tap.

RigName: Local union type derived from `RIGS`.

RIGS: Local ordered list of available camera rig names.

Scene rect: Layout rectangle used to convert pointer coordinates into local screen coordinates.

Solved: Shared resolved camera object `{ pos, target, fov }`.

Sway: Pure camera modifier that adds subtle orbital/zoom/height drift.

TARGET: Chest-level target point `[0, 1, 0]`.

Unproject ground: Convert a screen point through a solved camera into a ground-plane hit.

Vec3: Three-number tuple used for positions, offsets, directions, and camera values.
