# physics_lab cart inventory

Source cart: `cart/physics_lab.tsx`

Reviewed: 2026-06-04

## High-level purpose

`physics_lab` is a 3D rigid-body-ish physics probe with a **dual backend**: the *same* toy world (one walkable player + a pile of tumbling item bodies in a walled square arena with three blocking volumes) is implemented twice — once in JavaScript inside the cart, and once in Zig on the host — and the cart can switch between them at runtime while showing per-frame microsecond timings for both. It is simultaneously:

1. a physics sandbox (gravity, restitution, off-center mass → spin kicks, sphere-vs-AABB, sphere-vs-sphere, player shoving objects),
2. a JS-vs-host benchmark harness (sim cost, bridge cost, delta), and
3. a gallery of ~19 multi-part "game item" models (knife, pistol, bat, cash, vehicle, sailboat, bottles, drugs, backpack, TV…) each defined as a composable mesh function.

The host side lives in `framework/v8_bindings_physics_lab.zig`. It once also carried the **real hmsc physics backend** (`__hmsc_physics_step`, heightfields); in WO-1 (2026-06-04) that sim graduated to `framework/game/physics.zig` (+ `movement.zig`) behind `-Dhas-game-physics`, and the lab file now holds ONLY the `__physics_lab_*` toy — this lab is the proving ground the game sim graduated from.

## Files touched by this behavior

- `cart/physics_lab.tsx`: everything cart-side — JS physics, item models, snapshot decoding, camera, HUD, frame loop.
- `framework/v8_bindings_physics_lab.zig`: the Zig twin. Registers (line 753-759) `__physics_lab_reset`, `__physics_lab_burst`, `__physics_lab_step` (CSV), `__physics_lab_step_buffer` (Float32 ArrayBuffer). The `__hmsc_*` functions that used to cohabit here are gone (WO-1): they live in `framework/game/physics.zig`, registered by `v8_bindings_game_physics.zig`.
- `framework/v8_bindings_input_bench.zig`: registers `__bench_now_us` (line 200) — the monotonic µs clock the cart prefers for timing.
- `framework/v8_bindings_core.zig`: registers `isKeyDown(scancode)` used for host-polled WASD/Space/Shift.
- `runtime/hooks/useIFTTT.ts`: `busOn` (line 207) — the cart subscribes to `__keydown`/`__keyup` bus channels; the host pushes packed key events via `G.__ifttt_onKeyDown/__ifttt_onKeyUp` (lines 371-372) which `emit()` onto those channels.
- `runtime/geometries/index.ts` (`@reactjit/geometries`): `Geometry.Box/Cylinder/Cone/Sphere/Torus`, plus the `mesh()` builder and `normalize` the cart uses to define **four custom geometries inline** (Blade, Sail, BoatHull, Surfboard).
- `runtime/primitives.tsx`: `Box`, `Row`, `Col`, `Text`, `Pressable`, `Scene3D.*` (Camera, Skybox, lights, Mesh).
- `framework/gpu/3d.zig`: consumes the `scene3d*` node props; not called directly.

## The dual-backend architecture (the load-bearing idea)

The cart holds one mutable sim state in a ref (`sim`, line 1048: player, balls, timings, contact counters). Each frame, exactly one backend advances it:

**JS backend** (`backend === 'js'`): `stepPhysics()` (line 784) runs 3 fixed sub-steps per frame entirely in JavaScript, mutating the ref'd `Player`/`Ball[]` in place. Timed with `nowUs()` around the call → `s.jsUs`.

**Host backend** (`backend === 'host'`): the cart calls one host function per frame, passing only `(cameraYawRadians, paused)`. The Zig side owns the *entire* sim — its own `g_player`/`g_balls` globals, its own dt computed from `std.time.nanoTimestamp()` (clamped 1–50 ms, line 698-704), its own 3 sub-steps, and **its own input**: it polls SDL directly via `SDL_GetKeyboardState` (line 269-273), so in host mode the JS-side key tracking is bypassed for movement. The cart then overwrites its JS-side state from the returned snapshot — JS becomes a pure *view* of the Zig sim.

The two implementations are line-for-line ports of each other: same constants (`GRAVITY 13.5`, `BALL_RESTITUTION 0.82`, `WALL_RESTITUTION 0.74`, `WORLD_HALF 6.2`, jump tuning, scancodes), same `collideCircleBlock` / `collideSphereBlock` / `resolveBallPair` / `kickSpin` / `stepPhysics` logic (TS lines 664-966 ↔ Zig lines 340-681), same hardcoded `blocks` array, and a **duplicated item-physics table** — the cart's `ITEM_CATALOG` (line 367, 19 entries with radius/mass/cog) is mirrored in Zig's `items` (line 120, same 19 r/m/cog triples, hand-synced; Zig knows nothing about labels, tones, or models — visuals stay cart-side, cross-referenced by `itemIndex`).

## Snapshot formats — two host→JS channels

Both step functions advance the world, then serialize: header `t, contacts, peakContacts, px, py, pz, pvy, pyaw, onGround, moving, count, hostUs` then per ball `x, y, z, r, itemIndex, rx, ry, rz, |spin|` (9 floats).

- **Hot path — `__physics_lab_step_buffer`**: Zig writes into a static `g_snapshot` f32 array (max 512 balls) and returns it as a **zero-copy ArrayBuffer** (`setReturnF32Buffer`, line 251, wraps the Zig memory in a no-op-deleter backing store). The cart wraps it in `new Float32Array(buffer)` and reads fields positionally (`applyHostSnapshotBuffer`, cart line 585).
- **Fallback/debug — `__physics_lab_step`**: same data as a CSV string. The cart parses it with a hand-rolled charCode-walking float scanner (`applyHostSnapshot`'s `next()`, cart line 500) — no `split`, no `parseFloat`, no per-field allocation. Tried first only if the buffer fn is missing (cart line 1097-1103).

Lossy by design: the snapshot carries no velocities (JS mirror zeroes vx/vy/vz) and collapses angular velocity to a single magnitude stuffed into `wx` — enough for presentation, not for handing the sim back to JS. Host balls get synthetic ids `host-${i}`; the cart's ball array is resized destructively to match `count`.

Timing decomposition (cart lines 1095-1105, HUD line 1204-1209): `hostUs` = Zig's self-measured sim time (inside the snapshot); `hostTotalUs` = JS-measured wall time around the whole call; `hostBridgeUs = total − sim` = V8 bridge + serialization + parse cost; `delta vs JS` compares last samples of both backends. `nowUs()` (cart line 421) prefers host `__bench_now_us`, falls back to `performance.now()*1000`, then `Date.now()*1000`.

## Input — three sources, deliberately mixed

- **Bus events**: `busOn('__keydown'/'__keyup')` (cart line 1081-1082) maintain `keysRef` keyed by lowercase `event.key`, plus a `__shift` pseudo-key from `event.shiftKey`. Origin: host pushes packed key codes into `G.__ifttt_onKeyDown`, decoded and `emit()`-ed by `useIFTTT.ts:371`.
- **Host polling**: `inputDown()` (cart line 649) ORs the bus state with `isKeyDown(scancode)` — raw SDL scancodes (`SCAN_W 26` etc., duplicated as constants in both TS and Zig). Arrow keys ride the bus only.
- **Host-mode shortcut**: in host backend, Zig's `stepPhysics` reads `SDL_GetKeyboardState` itself — only camera yaw crosses the bridge as input.

Camera orbit drag is React-side: `onMouseDown/Move/Up` on the **same** `Pressable` (the pointer-capture rule), yaw `+0.25°/px`, pitch clamped 12–68°, fixed distance 10.2, target = player chest height. The drag handler writes `camRef` *and* `setCam` so the loop reads fresh values without waiting for the render.

## JS physics details (what the sim actually does)

`stepPhysics` (cart 784-966), 3 sub-steps of `dt/3`, dt clamped to `MAX_DT 0.05`:

- **Player**: camera-relative WASD basis; exponential velocity blend toward target speed (`dt*18` lerp); shortest-arc yaw turn toward heading (`dt*14`); `Math.pow(0.001, dt)` ground drag when idle. Jump = impulse `5.65` on press edge (`jumpWasDown` edge detect) + **variable-height hold boost** (`JUMP_HOLD_ACCEL 19.5` for up to `0.18s` while rising). Flat ground at y=0; AABB world walls; circle-vs-block side pushes (`collideCircleBlock` ignores blocks once you're above them — `p.y > block.h + 0.02` — but there is no standing-on-block support in this lab; that capability arrives in the hmsc step).
- **Bodies**: Euler integration; Euler-angle tumble (`rx/ry/rz` integrated from `wx/wy/wz`); angular drag `0.28^dt`. Every contact (floor, 4 walls, blocks, player, other balls) calls `kickSpin()` (line 653) — torque = (rotated COG) × (contact normal) ÷ mass — so **off-center mass converts linear hits into believable tumbling**, which is the physical point of the item catalog's `cog` field.
- **Player↔ball**: 2D (XZ) circle overlap with a vertical band check; positional split 70/30 ball/player; shove impulse = player's velocity along the normal + 1.2 baseline.
- **Ball↔ball**: O(n²) pairwise impulse resolution with inverse-mass-weighted separation, restitution 0.82, spin kicks both sides.
- `contacts` counts every resolved contact per frame; `peakContacts` is a decaying max (`*0.965`).

## Item catalog and inline custom geometry

`PhysicsItem` (line 90): `{ id, label, tone, radius, mass, cog, model }`. The **model is a function** `(ctx: ModelCtx) => JSX` — not a component — receiving `{ origin, rotation, scale, active }`.

Composition helpers: `Part` (line 226) renders one `Scene3D.Mesh` with its `p`/`r`/`s` transformed through the ctx (`local()` rotates the offset by the body's Euler rotation, scales, then translates; `rot()` adds rotations; `scl()` multiplies scale) — i.e. a **poor-man's transform hierarchy** done in cart math, since `Scene3D` has no parent/child transform nesting. All 19 models are built from shared param objects (`box1`, `cyl12/18`, `cone12`, `sphere12` — unit-ish params, scale via transform, honoring the intern-cache rule).

Four custom geometries are defined **inline in the cart** with a local `def(id, defaults, generate)` (line 112) returning the registry-shaped `{id, defaults, generate}` object, built with `mesh()`/`tri()`/`quad()` helpers (flat-shaded normals from cross products): `physics-lab/blade-v1`, `sail-v1`, `boat-hull-v1`, `surfboard-v1` (lines 134-202). This proves carts can author registry-compatible geometry without touching the framework — the framework knows zero shape names.

Per-body presentation (`BallMesh`, line 984): the model's origin is offset by the *rotated* COG so the visual pivots around its center of gravity; a squashed dark cylinder at y≈0.026 is a **fake contact shadow** whose z-scale shrinks with height (`1 − y*0.08`); a small accent sphere marks the physics center. `PlayerRig` (line 968) is a 6-mesh stick figure with a walk-bob (`|sin(t*10)|*0.035`) and a nose cone showing facing.

## Frame loop and React structure

One `useEffect` (line 1075) owns everything: bus subscriptions, `requestAnimationFrame` if present else `setTimeout(16)` (this host has no rAF), per-tick backend dispatch, then `setFrame(n+1 & 0xffffff)` to force a render. All sim data lives in refs (`sim`, `keysRef`, `camRef`, `pausedRef`, `backendRef`); React state is only `frame`, `paused`, `backend`, `cam` — the ref-mirror-per-state pattern (each `useEffect` at lines 1060-1073 copies state into its ref so the closed-over tick sees current values).

Backend default: `'host'` if `hasHostPhysics()` (either step fn registered), else `'js'` (line 1041). Switching to host fires `__physics_lab_reset(ballCount)`. `reset` resets **both** sides; `burst` adds 4 balls to **both** sides regardless of active backend, keeping counts roughly aligned for fair comparison. Pause is honored by both (host receives it as arg 2 and skips integration but still returns a snapshot).

UI: top bar (`Col`) with title, control `Btn`s (pause/reset/+balls/JS phys/HOST phys) and 11 `Meter`s; the scene fills the rest inside the drag `Pressable`; bottom-left absolute overlay shows backend/grounded/gravity and restitution/peak. Scene dressing: `Scene3D.Skybox` (zenith/horizon/ground + sun params), ambient + directional + 2 point lights, floor slab, grid line boxes, 4 wall slabs, 3 block volumes.

## The former cohabitant: the game sim (graduated in WO-1, not used by this cart)

`framework/v8_bindings_physics_lab.zig` HOSTED the production hmsc step until WO-1 (2026-06-04) moved it to `framework/game/physics.zig` (registrar `v8_bindings_game_physics.zig`, gate `-Dhas-game-physics`) — kept documented here because this lab is where it grew up, but **this cart never calls it**: `__hmsc_physics_step(Float32Array) → ArrayBuffer` is a *stateless-per-call* (config-in, snapshot-out) player+entity step with banded solid rects (walk-under platforms via the 9th `floor` float), oriented (yawed) rects rotated into local frame, registered heightfield terrain with slope-limit walls (`__hmsc_register_heightfield`, bilinear sampling + central-difference normals), per-surface friction/restitution, and step-height ground support. Contrast with the lab fns, which are *stateful* (Zig owns the world). Consumed by `cart/hmsc-int/state/hostPhysics.ts`.

## What is not here

- No filesystem, storage, networking, audio, or `__exec`.
- No persistence — reset rebuilds the seeded 5-ball scene (`makeBalls`, identical seeds in TS line 428 and Zig `seedBalls` line 315).
- No real rigid-body dynamics: no inertia tensors (spin kicks are a COG-torque heuristic), no friction cones, no resting-contact solver, no sleep states, no broadphase (O(n²) pairs).
- No standing on blocks, no heightfields in *this* lab's world (flat floor only — the heightfield machinery in the same Zig file serves hmsc).
- No mouse-look pointer capture/host mouse globals — drag is React prop events.
- No Tailwind; inline styles only.

## Integration-relevant observations

- **The "host twin" pattern is fully worked here**: port the JS sim to Zig function-for-function, keep constants duplicated and synced by hand, snapshot back as packed f32. Its measured product is the timing HUD — sim vs bridge cost is exactly the data that justified moving hmsc physics host-side.
- **Packed-f32-snapshot-over-ArrayBuffer (zero-copy)** is the established hot bridge format; **CSV with a charCode scanner** is the established debug fallback. Same pair of idioms as the input_bench CSV in animation_lab — buffer is the evolution.
- **Physics item = `{radius, mass, cog}` + a visual model function** is a clean physics/visual split that recurs (combat_lab figures, scape3d thingymajiggers): the host needs only the physics triple; the cart owns appearance, joined by an index.
- **`kickSpin` (COG-cross-normal torque heuristic)** is the cheapest believable tumble — a candidate shared utility; it exists identically in TS and Zig already.
- **Model-as-function with `ModelCtx` + `Part`** is another hand-rolled transform-hierarchy workaround (compare animation_lab's `segmentPose` and head_lab parts) — recurring evidence that `Scene3D` wants nested transforms or a shared part-composition helper.
- **Inline `def()` geometry** shows the registry's open authoring path works from inside a cart; the `Blade/Sail/BoatHull/Surfboard` generators are reusable as-is.
- **Duplicated item table (TS↔Zig) and duplicated step logic** are the cost of the twin pattern — any future canonical physics module should generate or share one source of truth (the hmsc step already moved to config-in-the-call instead of duplicated constants).
- Edge-detected jump with hold-boost (variable jump height) is the platformer-feel jump recipe, worth canonizing for the game.

## Glossary

Backend: Which implementation advances the sim this frame — `'js'` (cart-side `stepPhysics`) or `'host'` (Zig `__physics_lab_step*`). Default host when available.

Ball / body: One physics object — position, velocity, Euler rotation + angular velocity, radius, mass, COG, plus `itemIndex` linking to its catalog entry.

Block / blocking volume: A static AABB obstacle (`{x, z, hx, hz, h}`), hardcoded identically in TS and Zig; side-collides players (circle) and balls (sphere).

Bridge cost (`hostBridgeUs`): JS-measured wall time of the host step call minus the host's self-reported sim time — serialization + V8 boundary overhead.

Burst: Add 4 new bodies to both sims (`__physics_lab_burst` + JS `addBall`), spawn parameters derived from sim time.

COG (center of gravity): Per-item offset `Vec3`; rotated into world space and crossed with each contact normal in `kickSpin` to turn impacts into spin. Also offsets the visual model so it pivots around the physics center.

Contact shadow: The squashed dark cylinder under each body/player whose scale shrinks with height — a paint trick, not a light.

Contacts / peak contacts: Per-frame resolved-contact count; peak is a 0.965-decay running max.

CSV scanner: The allocation-free charCode-walking float parser (`next()` in `applyHostSnapshot`) for the string snapshot fallback.

Host twin: The Zig re-implementation of the cart's sim (same constants, same functions, own SDL input, own clock) selected by the HOST backend.

Item catalog: The 19-entry `PhysicsItem[]` joining physics (`radius/mass/cog` — mirrored in Zig) to visuals (`label/tone/model` — cart-only) by index.

Jump hold: Variable jump height — impulse on press edge, then extra upward accel while held (≤0.18 s) and still rising.

ModelCtx / Part: The cart's transform-hierarchy substitute — a `{origin, rotation, scale}` context threaded to `Part`, which bakes parent transform into each `Scene3D.Mesh`'s props.

Snapshot: The host→JS world serialization — 12-float header + 9 floats per ball; ArrayBuffer (hot) or CSV (fallback). Velocities omitted; spin reduced to magnitude.

Spin kick (`kickSpin`): Heuristic torque — (rotated COG) × (contact normal) × strength ÷ mass — applied at every contact.

Sub-steps: Both backends integrate 3 equal sub-steps per frame for stability at the same advertised dt.

Zero-copy buffer: `setReturnF32Buffer` wrapping Zig's static snapshot array in a no-op-deleter V8 BackingStore — the host→JS hot path with no copy on the Zig side.
