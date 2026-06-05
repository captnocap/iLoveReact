# physics3d — Bullet 3D rigid-body integration (DORMANT — wired to nothing)

**Files:**
- `framework/phys/physics3d.zig` (~320 lines, the Zig module)
- `framework/ffi/physics3d_shim.h` (C API surface for `@cImport`)
- `framework/ffi/physics3d_shim.cpp` (~300 lines, the C++ → Bullet 3.25 implementation)

## Status first, because it changes everything

**This module is fully implemented and completely disconnected.** Verified by repo-wide grep (excluding `archive/`, `tsz/`, `love2d/`):

- The ONLY files mentioning `physics3d`/`phys3d` are the three above. Nothing imports `phys/physics3d.zig`.
- `build.zig` never compiles `physics3d_shim.cpp` and never links Bullet — no `has-physics3d` gate exists, no entry in `sdk/dependency-registry.json`.
- `framework/layout.zig`'s `Node` has **no** `physics3d_*` fields. The module's old header comment ("`Node.physics3d_world_id` indexes into the world pool", "each `<3D.Physics>` gets its own world") described wiring that **does not exist** — fixed 2026-06-04 (WO-1): the header now carries the R1 DORMANT-kept-for-clients banner and describes only what is really there.
- No JS primitive maps to it (`runtime/primitives.tsx` has `<Physics>` = 2D Box2D only), no `__phys3d_*` host fn is registered in `v8_app.zig` / `v8_runtime`.

**Provenance:** added in the Smith-era framework (`7640b6de9` "add blend2d, crashlog, physics3d, …"), lifted to repo root with the framework (`a18559bbf`), and survived the dead-code sweep (`05337961f`). It has never been reachable from a cart in the V8 era.

**What actually does 3D physics in the game today:** NOT this. The live path is the game sim in `framework/game/physics.zig` (+ `movement.zig`), registered by `framework/v8_bindings_game_physics.zig` behind `-Dhas-game-physics` — host fns `__hmsc_physics_step` (Float32 ArrayBuffer in/out), `__hmsc_register_heightfield`, `__hmsc_clear_heightfields` (honest `__game_physics_*` aliases registered alongside) — a hand-rolled flat-rect + heightfield-collider world (see memory: hmsc terrain is flat rects). The `__physics_lab_*` toy stays in `v8_bindings_physics_lab.zig`. hmsc chose a bespoke sim over Bullet (graduated out of the lab file in WO-1, 2026-06-04). Per **R1** this Bullet module is KEPT, dormant, for clients.

## What the module would do, in English

A fixed-pool manager that maps Bullet rigid bodies onto layout nodes' `scene3d_*` transform fields, so physics drives what `<Scene3D.Mesh>` renders.

### Architecture
- **Pool of 8 worlds** (`MAX_PHYSICS3D_WORLDS`), each its own independent Bullet `btDiscreteDynamicsWorld` with its own gravity vector — instance-safe so multiple `<Scene3D>`-with-physics regions could coexist. World id 0 is the default; every public fn has a `xxx()` (world 0) + `xxxFor(id, ...)` pair.
- **256 bodies per world** (`MAX_BODIES_PER_WORLD`), stored in a fixed array; body creation does a linear scan for the first inactive slot and returns the index as the body handle. No allocation, no growth.
- **Each `Body` holds a `*Node` pointer** — the layout node it animates.
- All units are **world units** (1 = 1), explicitly unlike the 2D engine's pixel conversion.

### The C shim layer (`framework/ffi/physics3d_shim.{h,cpp}`)
All Bullet C++ types are hidden behind opaque `void*` typedefs (`Phys3DWorld`, `Phys3DShape`, `Phys3DBody`) so Zig's `@cImport` never sees C++. The header explicitly mirrors `physics_shim.h` (the Box2D 2D shim) — same wrapper idiom, different engine. Surface: world create/destroy/step, shape constructors, body create/destroy, transform getters (`phys3d_body_get_x/y/z`, `phys3d_body_get_euler`), property setters, force/impulse, raycast.

### Capabilities (per public fn)
- **Init/teardown:** `init/initFor(gravity_xyz)` — idempotent (returns if already initialized); `deinit/deinitFor` destroys all bodies + shapes + the world. `anyInitialized()` for engine-side "is physics on at all" checks.
- **Body creation** (`createBody/createBodyFor`): body type `static_body | kinematic | dynamic` (u8 enum matching the shim's c_int), collider shape `box | sphere | cylinder | capsule | cone | plane` — sizes passed as full extents, halved at the shim boundary for box/cylinder. **`heightfield` is declared in the enum but returns `null`** — never implemented. Plane is hardcoded to ground (`normal (0,1,0), offset 0`).
- **Properties:** friction, restitution, linear+angular damping — per body.
- **Forces:** `applyForce`, `applyImpulse`, `setLinearVelocity` — per body.
- **Raycast:** segment from→to against one world, returns hit point + surface normal (`RayHit`) or null. (This would have been the picking/shooting primitive.)
- **Tick** (`tick(dt)` / `tickFor`): steps every initialized world (`phys3d_world_step`, max 10 substeps), then for every active body **writes the body's position and euler rotation directly into the node's `scene3d_pos_x/y/z` and `scene3d_rot_x/y/z` fields**. That's the whole render handoff: physics mutates the same node fields the reconciler's mesh props set, and `gpu/3d.zig` draws whatever is in them next frame.

### Defensive idioms throughout
Every per-body fn bounds-checks `idx` and the `active` flag, then silently no-ops on miss. World id is clamped (`@min(id, MAX-1)`) rather than rejected. Failed body creation destroys the shape it just made (no leak). Nothing panics; everything degrades to "do nothing."

## Contrast with the LIVE siblings (this is the glossary payload)

| | physics2d (LIVE) | physics3d (DORMANT) | hmsc host sim (LIVE) |
|---|---|---|---|
| Engine | Box2D | Bullet 3.25 | hand-rolled Zig |
| Wired via | Node props (`physics_world/body/collider` flags) read by `framework/engine.zig:561+`, gated `HAS_PHYSICS` | nothing | `__hmsc_*`/`__game_physics_*` host fns in `v8_bindings_game_physics.zig` (impl `framework/game/physics.zig`); `__physics_lab_*` toy in `v8_bindings_physics_lab.zig` |
| JS surface | `<Physics.World/Body/Collider>` primitive (`runtime/primitives.tsx:373`) | none (the imagined `<3D.Physics>` was never built) | cart JS calls host fns directly, packed f32 ArrayBuffer protocol |
| Render handoff | writes node layout fields | would write node `scene3d_*` fields | snapshot buffer → cart state → mesh props |
| Heightfield | n/a | enum case stubbed `null` | first-class (`__hmsc_register_heightfield`) |

The pointed historical note: the one collider hmsc's terrain actually needed — heightfield — is exactly the one this module never implemented. That, plus the bridge-crossing design difference (hmsc wanted one packed-buffer host fn per frame, not per-body node sync), is presumably why the game grew its own sim instead of lighting this up.

## Recurring shapes (glossary candidates)

1. **C-shim-over-C++-lib** — opaque `void*` handles + flat `extern "C"` fns so Zig `@cImport` stays C-only. Same idiom family: `physics_shim.h` (Box2D), `physics3d_shim.h` (Bullet). The shim halves box extents, converts enums to c_int.
2. **Fixed pool + linear-scan slot allocation** — `[MAX]struct{active:bool,...}` arrays, first-inactive-wins, index-as-handle, bounds-check + silent no-op on every access. The standard framework resource-pool shape (same in physics2d, GPU pools).
3. **Instance-pool with default-0 + `xxxFor(id)` API doubling** — every public fn exists as a world-0 convenience and an explicit-instance variant. Mirrors how multi-instance subsystems are exposed across the framework.
4. **Physics-writes-node-fields sync** — the simulation's output IS mutation of the same `Node` fields the reconciler sets from JSX props (`scene3d_pos/rot_*`). Render reads node state and doesn't know who wrote it. (Same contract as physics2d ↔ layout fields.)
5. **Doc-comment drift as a trap** — the module header confidently described `<3D.Physics>` and `Node.physics3d_world_id`, neither of which exist (header fixed 2026-06-04, WO-1). When auditing capability, trust grep over header comments.
6. **The bespoke-vs-library physics fork** — the repo's revealed preference: cross the JS↔host bridge once per frame with a packed buffer (hmsc sim) rather than maintain per-body node bindings to a general engine. Any future "real physics" effort should decide consciously between reviving this module or extending the hmsc sim.

## If someone wants to light it up

Minimum wiring: compile + link `physics3d_shim.cpp` + Bullet in `build.zig` behind a `has-physics3d` metafile gate (per the no-unconditional-imports rule), add `physics3d_*` Node fields to `framework/layout.zig`, add engine.zig create/tick/destroy plumbing mirroring the physics2d block at `engine.zig:561+`, and a `Scene3D.Physics`/`Scene3D.Body` prop-mapper in `runtime/primitives.tsx`. Plus implement the heightfield shape (Bullet `btHeightfieldTerrainShape`) or it still can't collide with hmsc terrain. Alternatively: declare it dead and delete all three files — but that's a user decision, not a doc's.
