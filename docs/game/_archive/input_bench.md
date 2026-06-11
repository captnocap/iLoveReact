# input_bench cart inventory

Source cart: `cart/input_bench/`

Reviewed: 2026-06-04

## High-level purpose

`input_bench` is a playable 3D input benchmark. It renders a small first-person/third-person arena and lets the user switch the player movement backend at runtime.

The benchmark asks one narrow question: how much cost and plumbing does each input path add when driving the same WASD movement controller?

The four active backend choices are:

- `JS`: direct JavaScript bus listeners plus JavaScript integration.
- `IFTTT`: `useIFTTT` key triggers plus the same JavaScript integration.
- `LuaJIT`: JavaScript key/yaw messages sent to an off-thread LuaJIT worker, with Lua integrating position and sending it back.
- `Zig`: host-side Zig reads SDL keyboard state directly, integrates position, and JavaScript polls the result.

The shared design is that all backends write the same mutable `Controller` shape. The 3D camera, visible figure, and HUD read from that one controller no matter which backend is active.

## Files involved

- `cart/input_bench/cart.json`: cart manifest and window size.
- `cart/input_bench/index.tsx`: active cart entry; owns the mutable controller, backend selection, camera mode, mouse look, render heartbeat, scene, and HUD.
- `cart/input_bench/types.ts`: shared backend names, camera modes, controller shape, controller initializer, and telemetry averaging helper.
- `cart/input_bench/keys.ts`: shared WASD key state shape and JavaScript movement integration formula.
- `cart/input_bench/backend_js.tsx`: direct `busOn('__keydown'/'__keyup')` backend.
- `cart/input_bench/backend_ifttt.tsx`: `useIFTTT('key:*')` backend.
- `cart/input_bench/backend_lua.tsx`: current LuaJIT off-thread worker backend.
- `cart/input_bench/backend_zig.tsx`: pure-Zig movement backend wrapper.
- `cart/input_bench/Hud.tsx`: overlay UI for backend switching, camera mode, reset, and telemetry.
- `cart/input_bench/scene.tsx`: static 3D arena and visible humanoid player figure.
- `cart/input_bench/index_old.tsx`: older entry version kept in-tree; it used one controller yaw/pitch pair instead of the newer camera-lab-compatible separate 1P/3P yaw state.
- `cart/input_bench/backend_lua_old.tsx`: older Lua backend kept in-tree; it emitted only on position changes and used an older strafe formula.
- `runtime/hooks/useIFTTT.ts`: provides `busOn`, `useIFTTT`, key trigger sources, and the key dispatch path used by JS and IFTTT backends.
- `runtime/hooks/useLuaWorker.ts`: typed imperative wrapper around the LuaJIT worker host functions.
- `framework/v8_bindings_input_bench.zig`: registers and implements `__input_bench_*` and `__bench_now_us` host functions.
- `framework/v8_bindings_lua.zig`: registers `__lua_*` host functions used by `useLuaWorker`.
- `framework/process/luajit_worker.zig`: LuaJIT worker thread, message queues, script storage, and Lua-callable host functions.
- `runtime/primitives.tsx`: provides `Box`, `Pressable`, `Row`, `Col`, `Text`, and `Scene3D`.
- `runtime/cameras/index.tsx`: provides `OrbitCamera` and `FirstPersonCamera`.
- `runtime/geometries/index.ts`: provides geometry defs used by the arena and humanoid figure.

## Manifest

`cart/input_bench/cart.json` names the cart `Input Bench`, describes the four runtime-swappable input backends, and requests a 1200 by 760 window.

The manifest describes this as an empirical benchmark for which runtime can take the most abuse for game input. That wording matters because the cart is intentionally a measurement rig, not a production movement controller.

## Active entry component

`cart/input_bench/index.tsx` exports the active `InputBench` component.

The entry owns:

- `ctrl`: a `useRef<Controller>` created by `makeController(SPAWN)`.
- `backend`: selected backend, initially `JS`.
- `cameraMode`: selected view mode, initially `3P`.
- a throwaway `force` state used as a render heartbeat.
- `luaAvailable`: whether `luaWorker.available()` reports that LuaJIT can be loaded.
- separate yaw/pitch state for 3P orbit camera and 1P first-person camera.
- pointer drag state for camera look.

The component does not store player position in React state. The player position is mutable data in `ctrl.current.x` and `ctrl.current.z`. This avoids pushing 60 movement updates per second through ordinary React state.

The component writes `ctrl.current.yaw` every render from the active camera state:

- In `1P`, heading is `-lookYaw * DEG`.
- In `3P`, heading is `orbitYaw * DEG`.

That conversion is the cart-level compatibility layer between camera rigs. The backends all receive one ground-plane yaw convention and do not need to know whether the view is first-person or third-person.

## Camera behavior

The cart supports two view modes.

`1P` mode:

- Uses `FirstPersonCamera`.
- Camera position is the player position.
- `eyeHeight` is 1.7.
- `facing` is `lookYaw`.
- `pitch` is `lookPitch`.
- `fov` is 75.
- The visible humanoid figure is hidden because the camera is inside it.

`3P` mode:

- Uses `OrbitCamera`.
- Target follows `[ctrl.x, 1.1, ctrl.z]`.
- `yaw` is `orbitYaw`.
- `pitch` is `orbitPitch`.
- `dist` is 7.
- `zoom` is 1.
- `fov` is 55.
- The humanoid figure is visible and faces `ctrl.yaw`.

Pointer drag is always JavaScript-owned:

- `onMouseDown` stores the pointer coordinate.
- `onMouseMove` computes deltas.
- In `1P`, horizontal drag increases `lookYaw`; upward drag increases view pitch by subtracting `dy`.
- In `3P`, horizontal drag increases `orbitYaw`; upward drag lifts orbit pitch.
- `1P` pitch is clamped from -80 to 80 degrees.
- `3P` pitch is clamped from 6 to 85 degrees.
- `onMouseUp` clears drag state.
- Escape also clears drag state through a `busOn('__keydown')` listener.

Mouse look is intentionally not part of the benchmark comparison. All backends share the same JavaScript-owned yaw.

## Render heartbeat

Because backends mutate `ctrl.current` in place, React does not automatically know when position changes. `index.tsx` starts a heartbeat loop in `useEffect`.

The heartbeat:

- uses `globalThis.requestAnimationFrame` when present.
- falls back to `setTimeout(fn, 16)`.
- increments a dummy state value.
- causes the HUD, figure, and camera props to re-read the mutable controller.

The active backend drivers run their own loops. The heartbeat is for repainting React output from the mutable controller, not for owning movement integration.

## Controller contract

`cart/input_bench/types.ts` defines `Controller`.

Fields:

- `x`, `z`: player position on the ground plane.
- `yaw`, `pitch`: camera/look values; `yaw` is the ground-plane heading the backends use.
- `speed`: movement speed in world units per second.
- `lastDx`, `lastDz`: last integrated movement delta.
- `lastFrameUs`: backend-reported microseconds for the most recent backend tick.
- `avgFrameUs`: exponential moving average of backend tick cost.
- `frames`: number of backend frames processed since mount or reset.
- `lastTickMs`: last wall-clock millisecond timestamp recorded by the backend.

`makeController(spawn)` initializes:

- position from `spawn`.
- `yaw` to `Math.PI`.
- `pitch` to -0.05.
- `speed` to 4.
- deltas and telemetry to zero.

`recordFrameCost(ctrl, us)` writes `lastFrameUs`, updates `avgFrameUs` with alpha 0.05, and increments `frames`.

This controller is the central recurring shape. Every backend mutates it; rendering and HUD read it.

## Shared movement math

`cart/input_bench/keys.ts` defines:

- `Keys`: `{ w, a, s, d }` booleans.
- `emptyKeys()`: returns all false.
- `integrate(keys, yaw, speed, dt)`: returns `{ dx, dz }`.

The movement formula:

- `w` increases forward.
- `s` decreases forward.
- `d` increases strafe.
- `a` decreases strafe.
- diagonal movement is normalized so diagonal speed does not exceed straight speed.
- `cos(yaw)` and `sin(yaw)` build the world-space direction.
- `dx = (fwd * sin(yaw) - strafe * cos(yaw)) * speed * dt`.
- `dz = (fwd * cos(yaw) + strafe * sin(yaw)) * speed * dt`.

The comment in `keys.ts` explains the strafe sign. In this engine convention, world +X renders as screen-left for the relevant camera math, so strafe uses the opposite sign needed to make the D key walk screen-right.

The same formula is mirrored in `backend_lua.tsx` and `framework/v8_bindings_input_bench.zig`. That keeps the benchmark focused on input dispatch and runtime overhead instead of measuring slightly different movement math.

## JS backend

`cart/input_bench/backend_js.tsx` is the baseline backend.

Behavior:

- Subscribes to `__keydown` and `__keyup` through `busOn`.
- Keeps a local `Keys` cell created by `emptyKeys()`.
- Sets the matching `w`, `a`, `s`, or `d` boolean on key edges.
- Runs a per-frame scheduler using `requestAnimationFrame` or `setTimeout`.
- Uses `__bench_now_us()` for high-resolution timing and elapsed time.
- Calls shared `integrate(keys, ctrl.yaw, ctrl.speed, dt)`.
- Mutates `ctrl.x`, `ctrl.z`, `ctrl.lastDx`, and `ctrl.lastDz`.
- Records frame cost with `recordFrameCost`.
- Cleans up bus listeners and stops its loop on unmount.

This backend uses direct JavaScript event bus subscription plus JavaScript math. It does not use `useIFTTT`, LuaJIT, or Zig movement functions.

## IFTTT backend

`cart/input_bench/backend_ifttt.tsx` benchmarks the declarative `useIFTTT` key trigger path.

Behavior:

- Keeps `keysRef.current` as the mutable WASD cell.
- Registers eight `useIFTTT` triggers:
  - `key:w`
  - `key:up:w`
  - `key:a`
  - `key:up:a`
  - `key:s`
  - `key:up:s`
  - `key:d`
  - `key:up:d`
- Each trigger only mutates the same key cell.
- The integration loop is otherwise the same as the JS backend.
- Uses `__bench_now_us()` for timing and `dt`.
- Calls shared `integrate(...)`.
- Records frame cost with `recordFrameCost`.

This isolates the cost of the IFTTT key registration, prefix lookup, and dispatch path against the direct bus listener path.

The runtime `useIFTTT` implementation registers `key:` and `key:up:` sources. When possible, key specs are registered with the Zig-side IFTTT key matcher through `__ifttt_key_register`; it can fall back to JS `__keydown`/`__keyup` bus subscriptions for unsupported key specs.

## LuaJIT backend

`cart/input_bench/backend_lua.tsx` runs movement integration inside an off-thread LuaJIT worker.

The backend imports `luaWorker` from `runtime/hooks/useLuaWorker.ts`. That wrapper calls host functions:

- `__lua_available()`
- `__lua_start()`
- `__lua_stop()`
- `__lua_eval(code)`
- `__lua_send_msg(msg)`
- `__lua_recv_msg()`
- `__lua_elapsed_us()`
- `__lua_send(count)`
- `__lua_recv_count()`
- `__lua_set_n(n)`

Active Lua backend mount sequence:

- Checks `luaWorker.available()`.
- Calls `luaWorker.eval(LUA_SCRIPT)` before start.
- Calls `luaWorker.start()`.
- If unavailable or start fails, calls `onUnsupported()`, which marks Lua unavailable and switches back to `JS`.
- Sends reset and speed messages to seed the worker with current position and speed.
- Subscribes to keydown and keyup through `busOn`.
- Sends key edge messages only when key state changes.
- Starts a JavaScript per-frame loop to send yaw changes and drain worker output.

Message protocol from JavaScript to Lua:

- `k:w:1`: keydown for W.
- `k:s:0`: keyup for S.
- `y:1.5708`: heading yaw in radians.
- `r:0.0:-8.0`: reset position to x,z and clear keys.
- `s:4.0`: set movement speed.

Message protocol from Lua to JavaScript:

- `H:hello`: startup beacon.
- `E:<error>`: runtime error caught by Lua `pcall`.
- `p:<x>,<z>,<iter>`: latest position and a running Lua loop iteration count.

The Lua script:

- owns its own `kw`, `ka`, `ks`, `kd` key cell.
- owns `x`, `z`, `yaw`, and `speed`.
- loops while `host_running()` is true.
- drains all queued messages using `host_recv_msg()`.
- computes `dt` using `os.clock()`.
- clamps `dt` to 0.1 seconds.
- mirrors the same normalized WASD movement formula as `keys.ts`.
- increments an iteration counter every loop.
- emits position about every 100000 iterations instead of every loop.
- wraps the loop in `pcall` and emits `E:` on errors.

JavaScript frame work for the Lua backend:

- Uses `__bench_now_us()` to time JS-side plumbing.
- Sends `y:<yaw>` only if yaw changed.
- Drains all queued worker messages.
- Keeps the latest `p:` message and ignores older position messages in the same frame.
- Parses x, z, and iteration from that message.
- Updates `ctrl.lastDx`, `ctrl.lastDz`, `ctrl.x`, `ctrl.z`, and `ctrl.luaIter`.
- Logs `H:` and `E:` messages to `globalThis.console` if available.
- Records JavaScript-side plumbing time with `recordFrameCost`.
- Stops the Lua worker and removes bus listeners on unmount.

Important measurement distinction: `lastFrameUs` for Lua is the JavaScript-side cost of messaging and parsing for the active frame. It does not directly measure the Lua integration loop's internal cost. Lua behavior appears indirectly as position freshness/lag and `luaIter`.

## Lua worker implementation

`runtime/hooks/useLuaWorker.ts` is not a React hook despite its name. It exports an imperative `luaWorker` object.

The underlying worker in `framework/process/luajit_worker.zig`:

- lazily loads `libluajit-5.1` with `dlopen`.
- tries names such as `libluajit-5.1.so.2`, `libluajit-5.1.so`, `libluajit.so.2`, `libluajit.so`, and `libluajit-5.1.dylib`.
- returns disabled/no-op values if LuaJIT is not loadable.
- starts a real OS thread for the Lua script.
- exposes Lua-callable globals such as `host_running`, `host_recv_msg`, and `host_send_msg`.
- stores the script in a fixed 16384 byte buffer.
- uses string message queues with 1024 slots and 512 bytes per slot in each direction.
- also has atomic counter mode, but `input_bench` uses the string message mode.

This matters for game work because it is a concrete example of an off-thread scripting runtime with bounded queues and explicit lifecycle ownership from the cart.

## Zig backend

`cart/input_bench/backend_zig.tsx` wraps host-side movement implemented in `framework/v8_bindings_input_bench.zig`.

Host functions declared by the backend:

- `__input_bench_set_enabled(b)`
- `__input_bench_set_yaw(rad)`
- `__input_bench_set_speed(s)`
- `__input_bench_reset(x, z)`
- `__input_bench_pos()`

Backend mount sequence:

- Calls `__input_bench_reset(ctrl.x, ctrl.z)`.
- Calls `__input_bench_set_speed(ctrl.speed)`.
- Calls `__input_bench_set_enabled(true)`.
- Starts a per-frame JavaScript scheduler.

Per-frame behavior:

- If `ctrl.yaw` changed, calls `__input_bench_set_yaw(ctrl.yaw)`.
- Calls `__input_bench_pos()`.
- Parses the returned CSV string.
- Updates `ctrl.x`, `ctrl.z`, `ctrl.lastDx`, and `ctrl.lastDz`.
- Uses Zig's reported microseconds from the CSV when available.
- Falls back to JavaScript `performance.now()` timing if Zig timing is not parseable.
- Records frame cost with `recordFrameCost`.

Unmount behavior:

- Stops the JavaScript loop.
- Calls `__input_bench_set_enabled(false)`.

The CSV returned by Zig is:

```text
x,z,dx,dz,us
```

`framework/v8_bindings_input_bench.zig` owns the Zig state:

- `g_x`, `g_z`: player position.
- `g_last_dx`, `g_last_dz`: last movement delta.
- `g_yaw`: latest JS-published camera yaw.
- `g_speed`: movement speed.
- `g_enabled`: whether integration should run.
- `g_last_ns`: internal dt clock.

On each `__input_bench_pos()` call, Zig:

- reads SDL keyboard state directly with `SDL_GetKeyboardState`.
- checks SDL scancodes for W, A, S, and D.
- normalizes diagonal input.
- mirrors the same movement formula as `keys.ts`.
- clamps paused/large dt to 100 ms.
- updates position and last delta.
- measures elapsed host time in microseconds.
- formats a small CSV string to avoid `JSON.parse` in the hot path.

`__bench_now_us()` is implemented in the same Zig file. It returns high-resolution microseconds since the first call, using `std.time.nanoTimestamp()` and subtracting an origin so the returned double remains precise.

## HUD

`cart/input_bench/Hud.tsx` renders an overlay on top of the scene.

Top bar:

- title text.
- short usage text.
- camera mode buttons for `1P` and `3P`.
- reset button.
- backend buttons for `JS`, `IFTTT`, `LuaJIT`, and `Zig`.
- disabled Lua label when `luaAvailable` is false.
- backend-specific blurb.

Telemetry panel:

- active backend.
- last frame cost in microseconds.
- rolling average in microseconds.
- backend frame count.
- current position.
- current yaw in degrees.
- Lua iteration counter when backend is `LuaJIT`.
- note that microseconds are backend self-reported per-frame work, not the rAF interval.

The HUD reads the mutable controller during normal React renders caused by the heartbeat. It does not own movement state.

## Scene

`cart/input_bench/scene.tsx` defines the static 3D arena and the third-person figure.

`Figure`:

- takes `position`, `yawRad`, and optional `hidden`.
- returns `null` when hidden.
- uses the humanoid part table copied from `camera_lab`.
- rotates each local part offset around Y by the player yaw.
- adds the rotated offset to the player position.
- rotates each mesh by its own part rotation plus player yaw in degrees.

The humanoid is built from primitive geometry parts:

- cylinder legs.
- sphere shoes.
- box torso.
- torus belt.
- sphere shoulders.
- cylinder arms.
- sphere hands.
- cylinder neck.
- sphere head.
- box eyes.
- cone nose.
- cone hat.

`Arena`:

- is memoized with `useMemo(..., [])`.
- contains static lights.
- uses a thin box as ground instead of a plane.
- places box, cylinder, sphere, torus, and palm obstacles around the arena.
- renders an origin marker as a flat cylinder.

The arena is static so its mesh element tree does not need to change each frame. Only the player figure and camera follow the mutable controller.

## Old files

`cart/input_bench/index_old.tsx` is an older entry implementation.

Differences from the active `index.tsx`:

- spawn was `{ x: 0, z: -6 }` instead of `{ x: 0, z: -8 }`.
- yaw and pitch lived directly on `ctrl.current`.
- mouse drag mutated `ctrl.current.yaw` and `ctrl.current.pitch` directly.
- camera conversion derived `yawDeg` and `pitchDeg` from the controller.
- first-person and third-person cameras shared the same yaw/pitch source.

The active file replaced this with separate camera-lab-compatible yaw/pitch state for 1P and 3P, then maps that view state into one backend heading.

`cart/input_bench/backend_lua_old.tsx` is an older Lua worker backend.

Differences from the active `backend_lua.tsx`:

- Lua emitted only when position changed enough to matter.
- idle players did not emit regular position/status messages.
- reset message was just `r`, not `r:x:z`.
- Lua's position message was bare `x,z`, not tagged `p:x,z,iter`.
- it did not emit startup `H:` or error `E:` messages.
- it used an older strafe formula: `dx = fwd * sy + strafe * cy`, `dz = fwd * cy - strafe * sy`.
- JavaScript timing used `performance.now()` instead of `__bench_now_us()`.

The active Lua backend adds better diagnostics, position seeding, iteration visibility, regular emits, and formula parity with `keys.ts` and Zig.

## Host and JavaScript boundary

Direct host functions used through declarations in this cart:

- `__bench_now_us()`: called by JS, IFTTT, and Lua backends for high-resolution timing.
- `__input_bench_reset(x, z)`: called by Zig backend on mount.
- `__input_bench_set_yaw(rad)`: called by Zig backend when JS-owned yaw changes.
- `__input_bench_set_speed(s)`: called by Zig backend on mount.
- `__input_bench_set_enabled(b)`: called by Zig backend on mount/unmount.
- `__input_bench_pos()`: called by Zig backend every frame to advance and read position.

Direct host functions used through `luaWorker`:

- `__lua_available()`
- `__lua_start()`
- `__lua_stop()`
- `__lua_eval(code)`
- `__lua_send_msg(msg)`
- `__lua_recv_msg()`
- `__lua_elapsed_us()`
- `__lua_send(count)`
- `__lua_recv_count()`
- `__lua_set_n(n)`

Host-backed functions used indirectly through `useIFTTT`:

- key trigger registration and dispatch can go through `__ifttt_key_register`, `__ifttt_key_unregister`, and related IFTTT host functions.
- global key events are exposed to JavaScript as `__keydown` and `__keyup` bus events through the IFTTT/event bridge.

JavaScript/runtime work:

- React state for UI/backend/camera selection.
- mutable controller ownership.
- direct bus key listeners for JS and Lua backends.
- IFTTT trigger registration for the IFTTT backend.
- requestAnimationFrame or setTimeout scheduling.
- pointer drag camera control.
- WASD integration for JS and IFTTT.
- Lua worker message send/drain/parse.
- Zig CSV parse.
- HUD rendering.

Host/Zig work:

- SDL keyboard state read for the Zig backend.
- host-side movement integration for the Zig backend.
- high-resolution timing for `__bench_now_us`.
- LuaJIT library loading, worker thread lifecycle, and message queues.
- Scene3D rendering, camera rendering, event delivery, and mesh drawing.

Browser APIs not used:

- `document`
- `window`
- `fetch`
- `localStorage`

The cart does use `globalThis` to find `requestAnimationFrame`, `performance.now`, and `console`.

## Recurring concepts surfaced by this cart

Mutable controller:

One shared object used as the real-time movement state. It avoids React state churn while still letting React render from it on a heartbeat.

Backend driver component:

A small mounted component that owns one input pipeline lifecycle. Switching backends remounts the driver and lets cleanup remove listeners, stop workers, or disable host integration.

Input dispatch path:

The route from raw key press to key state. This cart compares direct bus, IFTTT registry, Lua message queue, and Zig SDL state.

Integration formula:

The movement math that converts WASD plus yaw into `dx,dz`. Keeping it shared or mirrored is essential for fair benchmarking.

Mouse-owned heading:

Mouse look stays in JavaScript for all backends. Backends only receive the already-normalized ground-plane yaw.

Render heartbeat:

A scheduled dummy state update that makes React re-read mutable non-React state.

Self-reported frame cost:

Each backend writes `lastFrameUs` and `avgFrameUs`. The meaning differs by backend, so comparisons need to know what each backend times.

Lua worker:

An off-thread script runtime with bounded string queues and explicit lifecycle. It is a candidate pattern for game scripting experiments, but this cart also shows the complexity and failure modes.

Zig host controller:

A host-side movement loop that reads SDL directly and exposes a compact polling API to JavaScript.

IFTTT key source:

A declarative trigger registration path that can route key events through Zig-side key matching or JS bus fallback.

Scene/logic separation:

The arena is static and memoized; the active movement state lives outside the scene tree; the figure and camera are views over the controller.

Old implementation snapshot:

The `_old` files preserve previous design choices, especially single yaw/pitch controller state and older Lua emit/parsing behavior. They are useful history but not the active cart path.

## Integration notes

The most reusable shapes for future game work are:

- `Controller`
- `BackendName`
- `CameraMode`
- `integrate(keys, yaw, speed, dt)`
- the backend driver component pattern
- the heartbeat pattern for mutable real-time state

For a real game, the clean separation would be:

- input capture owns key/button state.
- camera code owns view-specific yaw/pitch.
- a movement/controller module owns integration.
- rendering reads a stable pose.
- telemetry is an optional observer.

`input_bench` already follows that split closely, except it keeps all four experimental runtime paths in one cart so their costs can be compared side by side.

