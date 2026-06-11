# animation_lab cart inventory

Source cart: `cart/animation_lab.tsx`

Reviewed: 2026-06-04

## High-level purpose

`animation_lab` is a single-file 3D character animation lab. It renders a low-poly humanoid made from primitive `Scene3D.Mesh` parts and drives those parts with procedural pose values. It is not using skeletal animation, imported models, texture atlases, sprite sheets, DOM APIs, browser storage, fetch, or file IO. The cart is a React/V8 cart that emits ReactJIT primitives and relies on the Zig host for input state, the `Scene3D` render path, and one optional drive-mode movement integrator.

The main player figure can preview movement actions (`walk`, `run`, `jump`, `sit`, `sleep`, `drive`) and emotes (`dance`, `cry`, `laugh`, `fart`, `point`, `wave`). A static preview lane shows five example figures at once. Drive mode uses Zig-side WASD integration for horizontal movement, while JavaScript keeps camera orientation, jump height, pose choice, and all rendering state.

## Files touched by this behavior

- `cart/animation_lab.tsx`: the cart itself. Contains the UI, action list, pose math, procedural humanoid renderer, camera math, frame loop, drag handling, warmup HUD, and calls into host functions.
- `runtime/primitives.tsx`: provides `Box`, `Row`, `Col`, `Text`, `Pressable`, and `Scene3D`. `Scene3D` and its child components become host layout nodes with `scene3d*` props that `framework/gpu/3d.zig` consumes.
- `runtime/geometries/index.ts`: provides the geometry generator registry used by `Scene3D.Mesh`. This cart uses `Box`, `Sphere`, `Cylinder`, `Cone`, and `Torus`.
- `framework/v8_bindings_input_bench.zig`: implements the drive-mode host functions called from this cart: `__input_bench_reset`, `__input_bench_set_yaw`, `__input_bench_set_speed`, `__input_bench_set_enabled`, and `__input_bench_pos`.
- `framework/v8_bindings_core.zig`: registers the core `isKeyDown` host function used for Shift and Space checks.
- `framework/gpu/3d.zig`: renders the final `Scene3D` tree by reading the `scene3d*` fields from host nodes. The cart does not call it directly.

## Imports and primitive surface

At `cart/animation_lab.tsx:5-7`, the cart imports React hooks, ReactJIT primitives, and the geometry registry.

React hooks used:

- `useState`: stores selected action, selected camera mode, and an incrementing frame counter.
- `useRef`: stores mutable simulation state, the latest selected action for the animation loop, and drag state without causing state churn.
- `useEffect`: starts and cleans up the animation loop and enables/disables the Zig input-bench backend.

ReactJIT primitives used:

- `Box`: root layout container and a small spacer in the toolbar.
- `Row`: toolbar rows, overlay label row.
- `Col`: top toolbar column and warmup overlay.
- `Text`: all visible labels.
- `Pressable`: action buttons, camera toggle, and the full scene interaction surface.
- `Scene3D`: the 3D viewport.
- `Scene3D.Camera`: one active camera, recalculated every render.
- `Scene3D.AmbientLight`, `Scene3D.DirectionalLight`, `Scene3D.PointLight`: scene lighting.
- `Scene3D.Mesh`: every visible 3D object.

Geometry generators used:

- `Geometry.Box`: floor, grid lines, torso, eyes.
- `Geometry.Sphere`: shoes, shoulders, hands, head, tears, laugh accents, gas puffs.
- `Geometry.Cylinder`: limb segments, neck, marker disk.
- `Geometry.Cone`: nose, hat, pointing arrow.
- `Geometry.Torus`: belt, marker ring, laugh halo.

## Data types and constants

`Vec3` at `cart/animation_lab.tsx:9` is a tuple of three numbers and is used for positions, rotations, directions, and scales.

`Action` at `cart/animation_lab.tsx:10-12` is the complete action vocabulary for the lab. The actions are string literals, so action identity is both state and display/control key.

`CameraMode` at `cart/animation_lab.tsx:13` is either `third` or `first`.

Palette constants at `cart/animation_lab.tsx:15-30` split into UI colors and humanoid material colors. Materials are plain hex strings. There are no material objects except the runtime supports them elsewhere.

Input and physics constants at `cart/animation_lab.tsx:32-38` define SDL scancode numbers for Space and Shift, jump speed, gravity, warmup duration, and how long the warmup-ended message stays visible.

`ACTIONS` at `cart/animation_lab.tsx:40-53` is the toolbar/action registry. Each entry has:

- `id`: the `Action` string used for behavior.
- `label`: visible button text.
- `group`: `move` or `emote`, used only for button background styling.

## Local math utilities

These are pure JavaScript helpers in `cart/animation_lab.tsx`.

- `clamp` at line 55 clamps camera pitch during drag.
- `rad` and `deg` at lines 56-57 convert between degrees and radians.
- `angleDelta` at line 58 returns the shortest wrapped angular delta and prevents visual yaw from rotating the long way around.
- `add` at lines 60-62 adds two `Vec3` tuples.
- `rotateY` at lines 64-68 applies yaw rotation around the Y axis.
- `rotateX` at lines 70-74 applies pitch/root rotation around the X axis.
- `orient` at lines 76-78 applies root pitch then yaw to a local vector.
- `dirDown` at lines 80-89 converts a limb swing angle and side angle into a world-space "down the limb" direction.
- `point` at lines 91-93 places a local offset relative to a base point using yaw/root pitch.
- `segmentPose` at lines 95-102 computes the center point, endpoint, and Euler rotation for a limb segment from a joint, length, swing angle, side angle, yaw, and root pitch.

The cart's character rig is therefore math-driven. It computes mesh transforms directly; there is no retained skeleton object, no animation clip format, no keyframe interpolation layer, and no inverse kinematics.

## Host function wrappers

`hostNumber`, `hostString`, and `hostVoid` at `cart/animation_lab.tsx:104-121` are local safety wrappers around `globalThis`.

- `hostNumber(name, fallback, ...args)` calls a named global host function, coerces the result to a number, and falls back when the function is missing or non-finite.
- `hostString(name, fallback, ...args)` calls a named global host function and falls back unless the result is a string.
- `hostVoid(name, ...args)` calls a named global host function only if it exists.

This makes the cart resilient if a host function is not present. In missing-host scenarios, the cart still renders and falls back to zeros/defaults.

Host functions used by this cart:

- `__input_bench_reset(x, z)`: called on mount and when entering drive mode. Implemented in `framework/v8_bindings_input_bench.zig:84-91`.
- `__input_bench_set_enabled(bool)`: called on mount and cleanup. Implemented in `framework/v8_bindings_input_bench.zig:113-119`.
- `__input_bench_set_yaw(rad)`: called every frame in drive mode so Zig can integrate movement relative to camera yaw. Implemented in `framework/v8_bindings_input_bench.zig:100-104`.
- `__input_bench_set_speed(units_per_s)`: called every frame in drive mode with walk or run speed. Implemented in `framework/v8_bindings_input_bench.zig:106-111`.
- `__input_bench_pos()`: called every frame in drive mode. It advances Zig's horizontal movement simulation and returns `x,z,dx,dz,us`. Implemented in `framework/v8_bindings_input_bench.zig:121-176`.
- `isKeyDown(scancode)`: called every frame for Shift and Space. Registered in `framework/v8_bindings_core.zig:790-814` and declared in `runtime/_generated_host_globals.d.ts:4-22`.

Not used:

- No filesystem host functions.
- No store/local persistence host functions.
- No HTTP host functions.
- No clipboard host functions.
- No `__exec`.
- No explicit `__registerDispatch`; input events are expressed as React primitive props.

## Pose model

`Pose` at `cart/animation_lab.tsx:123-135` is the whole animation data shape. It has:

- `rootPitch`: whole-body pitch in degrees.
- `bodyY`: vertical body offset.
- `torsoLean`: torso pitch in degrees.
- `headNod`: head pitch in degrees.
- `leftLeg`, `rightLeg`: thigh swing angles.
- `leftKnee`, `rightKnee`: bend amounts subtracted from lower-leg swing.
- `leftArm`, `rightArm`: upper-arm swing angles.
- `armLift`: side-angle modifier for arm lift/spread.

`poseFor(action, t, moving, driveJumpY)` at `cart/animation_lab.tsx:137-330` maps an action and elapsed time to a `Pose`. It is a procedural animation table, not data loaded from files.

Action behavior:

- `dance` at lines 138-154 uses fast sine/cosine oscillators for bounce, torso sway, alternating legs, and raised arms.
- `cry` at lines 156-171 uses a sob oscillator, bowed torso, nodding head, near-static legs, and hands up near the face.
- `laugh` at lines 173-188 uses a pulsing laugh oscillator, backwards lean, head tilt, slight bounce, and animated arms.
- `fart` at lines 190-205 creates an asymmetric crouched stance with one leg bent more than the other.
- `point` at lines 207-221 holds a static pose with the right arm extended.
- `wave` at lines 223-238 swings the right arm with a sine oscillator.
- `sit` at lines 240-255 lowers the body, folds both legs sharply, and adds slight breathing motion to torso lean.
- `sleep` at lines 257-272 pitches the whole root forward by 82 degrees and uses a small breathing oscillator.
- `jump` at lines 274-291 is a looping preview jump with phase, air height, crouch at takeoff/landing, tucked knees, and raised arms.
- `drive` while idle at lines 293-307 is a neutral standing pose with optional `driveJumpY`.
- default walk/run at lines 309-330 uses a sine phase. `run` increases phase speed, leg/arm amplitude, bounce, knee bend, torso lean, and arm lift.

Drive mode reuses walk/run pose generation while moving. The chosen pose action is computed later at `cart/animation_lab.tsx:551`: if drive speed is over 4 it poses as `run`, otherwise `walk`.

## Humanoid construction

The figure is built from independent mesh parts every render.

`LimbSegment` at `cart/animation_lab.tsx:332-352` wraps the shared limb math. It computes a cylinder center and rotation via `segmentPose`, then renders one `Scene3D.Mesh` using `Geometry.Cylinder`. Limb radius, length, material, swing, side angle, yaw, and root pitch are props.

`AnimatedFigure` at `cart/animation_lab.tsx:354-407` renders the full humanoid:

- It offsets the origin by `pose.bodyY`.
- It computes hip and shoulder joints from local offsets.
- It computes thigh, shin, upper-arm, and forearm segment endpoints before rendering so later parts can attach to the prior segment's endpoint.
- Legs are four cylinders, with sphere shoes placed at shin endpoints.
- Torso is a `Geometry.Box`.
- Belt is a `Geometry.Torus`.
- Shoulders and hands are spheres.
- Arms are four cylinders.
- Neck is a cylinder.
- Head is a sphere, eyes are two boxes, nose is a cone, and hat is a cone.
- `hideHead` removes head, eyes, nose, and hat but still renders the neck. It is used in first-person drive mode so the camera does not sit inside the head mesh.

Important limitation: there is no shared avatar data model here. The humanoid's proportions are hardcoded inside `AnimatedFigure`, and each mesh part directly receives its final transform.

`Marker` at `cart/animation_lab.tsx:409-416` renders a floor marker at the active figure position using a small cylinder disk plus a torus ring.

`EmoteFx` at `cart/animation_lab.tsx:418-456` renders extra procedural meshes for some emotes:

- `cry`: two blue falling tear spheres.
- `laugh`: yellow torus halo plus two yellow spheres near the head.
- `fart`: three green pulsing gas spheres behind the body.
- `point`: an accent cone pointing forward.
- Other actions return `null`.

## Main component state

The default export `AnimationLab` starts at `cart/animation_lab.tsx:458`.

React state:

- `action` at line 459 starts as `walk`.
- `cameraMode` at line 460 starts as `third`.
- `frame` at line 461 increments every tick and is displayed in the overlay.

Mutable refs:

- `actionRef` at line 463 mirrors `action` so the animation loop sees current action without being recreated.
- `sim` at lines 464-469 stores mutable simulation data:
  - `x`, `z`: horizontal position.
  - `yaw`: camera/player yaw source.
  - `visualYaw`: smoothed body-facing yaw.
  - `pitch`: first-person camera pitch.
  - `t`: elapsed time in seconds.
  - `jumpY`, `jumpV`: JavaScript vertical jump state.
  - `moving`: movement flag.
  - `speed`: movement speed estimate.
  - `zigUs`: microseconds reported by the Zig input bench call.
- `drag` at line 470 stores last pointer position while dragging.

The current action is copied into `actionRef.current` every render at line 472.

## Frame loop and simulation

The `useEffect` at `cart/animation_lab.tsx:474-544` owns the frame loop.

Setup:

- Resets Zig input-bench state to `(0, 0)`.
- Enables the input-bench backend.
- Uses `globalThis.requestAnimationFrame` if available, otherwise `setTimeout(fn, 16)`.
- Uses `globalThis.performance.now()` if available, otherwise `Date.now()`.

Each tick:

- Computes `dt` in seconds and clamps it between 0.001 and 0.05.
- Adds `dt` to `sim.current.t`.
- Reads whether the current action is `drive`.
- Reads Shift with `isKeyDown(SCAN_LSHIFT)` or `isKeyDown(SCAN_RSHIFT)`.
- Reads jump request with `isKeyDown(SCAN_SPACE)`.

Drive branch at `cart/animation_lab.tsx:496-513`:

- Sends current yaw to Zig via `__input_bench_set_yaw`.
- Sends speed to Zig via `__input_bench_set_speed`, using `6.4` with Shift and `2.8` otherwise.
- Reads `__input_bench_pos()` and parses its CSV string into `x`, `z`, `dx`, `dz`, and `us`.
- Copies finite `x` and `z` values into JS sim state.
- Estimates speed as `Math.hypot(dx, dz) / dt`.
- Marks moving if speed is above `0.05`.
- Smooths `visualYaw` toward movement direction when moving.
- Stores `zigUs` for display.
- Starts JavaScript jump velocity when Space is down and the player is grounded.

Non-drive branch at `cart/animation_lab.tsx:513-524`:

- Chooses preview speed by action: `run` is `2.2`, `walk` is `0.9`, everything else is `0`.
- For `walk`, `run`, and `jump`, moves the character on a small sine/cosine path.
- Marks only `walk` and `run` as moving.
- Sets `visualYaw` to face away from camera yaw for movement previews.
- Clears `zigUs`.

Jump integration at `cart/animation_lab.tsx:526-533` is JavaScript-side. It applies gravity to `jumpV`, adds velocity to `jumpY`, and clamps back to ground at `0`.

Finally, the loop increments `frame` at line 535 to force a React render and schedules the next tick. Cleanup cancels the scheduled tick and disables the Zig input-bench backend.

## Zig input bench behavior

The host-side drive integrator is in `framework/v8_bindings_input_bench.zig`.

It keeps global Zig state for `x`, `z`, last deltas, yaw, speed, enabled flag, and last timestamp at lines 43-50. It reads SDL keyboard state directly using `SDL_GetKeyboardState` in `keyDown` at lines 76-80.

`hostPos` at `framework/v8_bindings_input_bench.zig:121-176` is the main host function:

- It advances only when enabled.
- It computes an internal `dt` from a Zig monotonic timestamp.
- It clamps `dt` to 100 ms.
- It reads W/S into forward and A/D into strafe.
- It normalizes diagonals.
- It converts forward/strafe through `g_yaw`.
- It integrates horizontal `x` and `z`.
- It records last frame `dx` and `dz`.
- It returns a compact CSV string `x,z,dx,dz,us`.

The cart does not ask this host backend to handle jumping, camera pitch, pose state, UI state, or rendering.

## Camera and interaction

Camera values are calculated in JavaScript at `cart/animation_lab.tsx:546-560`.

- `poseAction` selects the actual pose to render. In drive mode, moving chooses walk/run by speed; otherwise it uses the selected action directly.
- `activePose` is the result of `poseFor`.
- `playerYaw` is smoothed movement yaw in drive mode and camera-opposite yaw otherwise.
- Third-person camera sits behind and above the player using `sin(yaw)` and `cos(yaw)`.
- First-person camera is placed near head height using `point`.
- First-person target projects forward from yaw and uses `pitch` to tilt vertically.
- Third-person target looks at the player center.
- First-person FOV is `76`; third-person FOV is `54`.

Pointer interaction is handled by React primitive events on the scene `Pressable`:

- `onMouseDown` at line 562 stores the initial drag point.
- `onMouseMove` at lines 563-572 updates yaw and pitch while dragging.
- `onMouseUp` at line 573 clears drag state.

Dragging is entirely JavaScript-side. The cart does not use host mouse globals like `getMouseX`, `getMouseY`, `getMouseDown`, or `__mouse_delta`.

## UI layout

The returned tree starts at `cart/animation_lab.tsx:575`.

Root layout:

- Full-size `Box`.
- Top `Col` toolbar with a title row and controls row.
- Main `Pressable` fills remaining space and contains the `Scene3D` plus overlays.

Toolbar:

- Title text at lines 579-580.
- Action buttons at lines 583-607, generated from `ACTIONS`.
- Selecting an action updates React state.
- Selecting `drive` also clears jump state and resets the Zig input-bench position to the current JS position.
- Camera toggle at lines 609-614 switches `third` and `first`.
- Status text at lines 615-617 either shows drive instructions and Zig timing or preview instructions.

Scene:

- Full-size `Scene3D` at line 627.
- One `Scene3D.Camera` at line 628.
- Ambient, directional, and two point lights at lines 629-632.
- A floor box at line 634.
- Grid line boxes at lines 635-636.
- Active player marker at line 637.
- Active animated player figure at line 639.
- Active emote effects at line 640.
- Five preview-lane figures at lines 642-646.

Overlays:

- Bottom-left preview labels and frame counter at lines 649-657.
- Bottom-right warmup panel at lines 659-683.

Warmup:

- `WARMUP_SECONDS` is `25`.
- `WARMUP_END_HOLD_SECONDS` is `5`.
- The panel shows active warmup until `t` reaches 25 seconds, then shows ended state for 5 more seconds.
- Warmup is informational only. It does not gate input, animation, rendering, or physics.

## Runtime rendering path

The cart's `Scene3D` usage is declarative. In `runtime/primitives.tsx:405-424`, `Scene3D` is documented as a wrapper that emits host `View` nodes with `scene3d*` props. The actual render path is host-side wgpu in `framework/gpu/3d.zig`.

`Scene3D.Camera` in `runtime/primitives.tsx:454-465` maps `position`, `target`, and `fov` to `scene3dCamera`, `scene3dPos*`, `scene3dLook*`, and `scene3dFov`.

`Scene3D.Mesh` in `runtime/primitives.tsx:535-700` maps geometry generator definitions and material/position/rotation/scale props into `scene3dMesh`, geometry keys, vertices when needed, color channels, transform channels, and texture fields.

This cart uses the canonical `@reactjit/geometries` generator path, not legacy string geometry names.

## What is not here

- No cart folder or manifest. This is a single-file cart.
- No nested `AGENTS.md` for this path.
- No imported art assets.
- No external model format.
- No sprite animation.
- No CSS cascade or className use.
- No browser APIs such as `document`, `window`, `fetch`, or `localStorage`.
- No persistent state.
- No networking.
- No file reads/writes.
- No audio.
- No collision system.
- No terrain system beyond a flat floor and grid.
- No entity/component registry.
- No shared animation DSL.
- No avatar customization or equipment slots.
- No reusable humanoid package, despite resembling a reusable primitive.

## Integration-relevant observations

The cart demonstrates several reusable concepts that are likely fundamental across the game labs:

- A procedural pose vocabulary can be represented as a small `Pose` record plus `poseFor(action, t, ...)`.
- A part-built humanoid can be rendered as a collection of primitive meshes without a model importer.
- Camera yaw can be the shared source of movement direction.
- Horizontal movement can live in a Zig host backend while JavaScript owns presentation state.
- `Scene3D` mesh transforms are the common output shape for character, effect, marker, floor, and preview-lane rendering.
- Input can be mixed: host polling for keyboard state plus React primitive events for pointer drag.
- Preview lanes are useful for comparing animation states in one running scene.
- First-person mode needs avatar self-occlusion handling, here solved by hiding the head mesh.
- Per-frame state can be stored in refs and pushed to React through a cheap frame counter.

## Glossary

Action: The high-level selected animation intent. In this cart, actions are string literals such as `walk`, `drive`, or `wave`.

Action group: A toolbar-only grouping of actions into `move` or `emote`.

Active pose: The `Pose` currently rendered for the main figure. In drive mode it may be `walk` or `run` even while `action` is `drive`.

AnimatedFigure: The local component that turns a `Pose` into a humanoid made from `Scene3D.Mesh` parts.

Arm lift: Pose field that modifies arm side angles, making arms spread or raise.

BodyY: Pose field for vertical root/body offset.

Camera mode: Either third-person chase view or first-person view.

Drive mode: The action where horizontal movement is sourced from the Zig input-bench host functions.

Emote: Non-locomotion action, including `dance`, `cry`, `laugh`, `fart`, `point`, and `wave`.

Emote FX: Extra non-body meshes attached to emotes, such as tears, halo, gas puffs, or pointing cone.

Frame counter: React state incremented each tick to force render and displayed in the overlay.

Host function wrapper: Local helper that checks `globalThis` before calling a host function and falls back if missing.

Input bench: Zig-side WASD movement backend originally from input benchmarking, reused here for drive mode.

Limb segment: A cylinder mesh positioned between a joint and an endpoint computed from swing/side angles.

Marker: The floor disk and torus showing the active figure's current horizontal position.

Pose: The compact procedural animation data record consumed by `AnimatedFigure`.

Preview lane: The row of five static-position figures showing walk, run, jump, sit, and sleep simultaneously.

Root pitch: Whole-body pitch in degrees, used most visibly by sleep.

Scene3D: ReactJIT primitive that emits host scene nodes for the wgpu 3D renderer.

Segment pose: The computed center, endpoint, and rotation of a limb cylinder.

Sim ref: Mutable JavaScript object containing position, yaw, pitch, time, jump, motion, and host timing state.

Visual yaw: Smoothed body-facing yaw, separate from raw camera yaw.

Warmup HUD: Informational 25-second timer overlay retained for 5 seconds after ending.

Zig timing: The microsecond measurement returned by `__input_bench_pos` and displayed in drive mode.
