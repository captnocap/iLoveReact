import type { DocIndex } from '../types';

export const input_bench: DocIndex = {
  name: 'input_bench',
  file: 'input_bench.md',
  cart: 'cart/input_bench/index.tsx',
  purpose: ['input', 'telemetry', 'game_loop', 'host_bridge', 'scripting', 'camera'],
  summary:
    'A playable 3D input benchmark that swaps the WASD movement backend at runtime (JS bus, IFTTT triggers, off-thread LuaJIT worker, host-side Zig) over one shared mutable Controller, comparing the cost and plumbing each input path adds.',
  interfaces: [
    {
      name: 'InputBench',
      purpose: ['input', 'game_loop', 'telemetry'],
      kind: 'component',
      sourceFile: 'cart/input_bench/index.tsx',
      description:
        'Active cart entry; owns the mutable controller ref, backend selection, camera mode, mouse look, render heartbeat, scene composition, and HUD. Player position lives in ctrl.current (not React state); writes ctrl.current.yaw every render from the active camera state.',
      dependsOn: ['Controller', 'makeController', 'backend_js', 'backend_ifttt', 'backend_lua', 'backend_zig', 'Hud', 'Figure', 'Arena', 'OrbitCamera', 'FirstPersonCamera'],
      status: 'lab',
    },
    {
      name: 'Controller',
      purpose: ['input', 'telemetry'],
      kind: 'data_model',
      sourceFile: 'cart/input_bench/types.ts',
      description:
        'Central recurring shape: mutable movement state object with x/z position, yaw/pitch, speed, lastDx/lastDz, lastFrameUs/avgFrameUs/frames telemetry, lastTickMs. Every backend mutates it; rendering and HUD read it. yaw is the ground-plane heading all backends consume.',
      consumers: ['backend_js', 'backend_ifttt', 'backend_lua', 'backend_zig', 'Hud', 'Figure'],
      status: 'lab',
    },
    {
      name: 'makeController',
      purpose: ['input'],
      kind: 'utility',
      sourceFile: 'cart/input_bench/types.ts',
      description:
        'Controller initializer: position from spawn, yaw to Math.PI, pitch to -0.05, speed to 4, deltas and telemetry to zero.',
      status: 'lab',
    },
    {
      name: 'recordFrameCost',
      purpose: ['telemetry'],
      kind: 'utility',
      sourceFile: 'cart/input_bench/types.ts',
      codeRef: 'cart/input_bench/types.ts',
      description:
        'recordFrameCost(ctrl, us) writes lastFrameUs, updates avgFrameUs as an exponential moving average with alpha 0.05, and increments frames. Called by every backend.',
      consumers: ['backend_js', 'backend_ifttt', 'backend_lua', 'backend_zig'],
      status: 'lab',
    },
    {
      name: 'BackendName',
      purpose: ['input'],
      kind: 'data_model',
      sourceFile: 'cart/input_bench/types.ts',
      description: 'Union of backend names: JS, IFTTT, LuaJIT, Zig.',
      status: 'lab',
    },
    {
      name: 'CameraMode',
      purpose: ['camera'],
      kind: 'data_model',
      sourceFile: 'cart/input_bench/types.ts',
      description: 'Union of camera view modes: 1P (first-person) and 3P (third-person orbit).',
      status: 'lab',
    },
    {
      name: 'integrate',
      purpose: ['input', 'math'],
      kind: 'utility',
      sourceFile: 'cart/input_bench/keys.ts',
      codeRef: 'cart/input_bench/keys.ts:159',
      description:
        'integrate(keys, yaw, speed, dt) -> {dx, dz}: shared WASD movement formula. Forward from w/s, strafe from d/a, diagonal normalized so diagonal speed does not exceed straight speed. dx=(fwd*sin(yaw)-strafe*cos(yaw))*speed*dt; dz=(fwd*cos(yaw)+strafe*sin(yaw))*speed*dt. Mirrored in backend_lua.tsx and v8_bindings_input_bench.zig.',
      consumers: ['backend_js', 'backend_ifttt'],
      status: 'lab',
    },
    {
      name: 'Keys',
      purpose: ['input'],
      kind: 'data_model',
      sourceFile: 'cart/input_bench/keys.ts',
      description: 'Shared WASD key state shape { w, a, s, d } of booleans.',
      status: 'lab',
    },
    {
      name: 'emptyKeys',
      purpose: ['input'],
      kind: 'utility',
      sourceFile: 'cart/input_bench/keys.ts',
      description: 'Returns a Keys cell with all four booleans false.',
      status: 'lab',
    },
    {
      name: 'backend_js',
      purpose: ['input', 'game_loop'],
      kind: 'component',
      sourceFile: 'cart/input_bench/backend_js.tsx',
      description:
        'Baseline backend: subscribes to __keydown/__keyup via busOn, keeps a local Keys cell, runs a per-frame scheduler (rAF or setTimeout), times with __bench_now_us, calls shared integrate, mutates ctrl, records frame cost. No useIFTTT/LuaJIT/Zig.',
      consumes: ['__keydown', '__keyup', '__bench_now_us'],
      dependsOn: ['integrate', 'recordFrameCost', 'Keys'],
      status: 'lab',
    },
    {
      name: 'backend_ifttt',
      purpose: ['input', 'game_loop'],
      kind: 'component',
      sourceFile: 'cart/input_bench/backend_ifttt.tsx',
      description:
        'Benchmarks the declarative useIFTTT key trigger path. Registers eight triggers (key:w/a/s/d and key:up:w/a/s/d), each mutating one shared key cell; integration loop is otherwise identical to backend_js. Isolates IFTTT key registration, prefix lookup, and dispatch cost against the direct bus path.',
      consumes: ['key:w', 'key:up:w', 'key:a', 'key:up:a', 'key:s', 'key:up:s', 'key:d', 'key:up:d', '__bench_now_us'],
      dependsOn: ['useIFTTT', 'integrate', 'recordFrameCost'],
      status: 'lab',
    },
    {
      name: 'backend_lua',
      purpose: ['input', 'scripting', 'game_loop'],
      kind: 'component',
      sourceFile: 'cart/input_bench/backend_lua.tsx',
      description:
        'Runs movement integration inside an off-thread LuaJIT worker via luaWorker. Evals LUA_SCRIPT, starts the worker, seeds reset+speed, subscribes to keydown/keyup, sends key-edge and yaw messages, drains worker output. JS->Lua protocol (k:/y:/r:/s:); Lua->JS protocol (H:/E:/p:). lastFrameUs measures JS-side plumbing only, not the Lua loop cost.',
      consumes: ['__keydown', '__keyup', '__bench_now_us', '__lua_available', '__lua_start', '__lua_stop', '__lua_eval', '__lua_send_msg', '__lua_recv_msg', '__lua_elapsed_us', '__lua_send', '__lua_recv_count', '__lua_set_n'],
      dependsOn: ['luaWorker', 'recordFrameCost'],
      status: 'lab',
    },
    {
      name: 'backend_zig',
      purpose: ['input', 'host_bridge', 'game_loop'],
      kind: 'component',
      sourceFile: 'cart/input_bench/backend_zig.tsx',
      description:
        'Wraps host-side movement in v8_bindings_input_bench.zig. On mount calls __input_bench_reset/set_speed/set_enabled; per frame publishes yaw on change, calls __input_bench_pos(), parses the returned x,z,dx,dz,us CSV, updates ctrl, records frame cost. On unmount stops loop and disables. Falls back to performance.now() if Zig timing not parseable.',
      consumes: ['__input_bench_set_enabled', '__input_bench_set_yaw', '__input_bench_set_speed', '__input_bench_reset', '__input_bench_pos'],
      dependsOn: ['recordFrameCost'],
      status: 'lab',
    },
    {
      name: 'Hud',
      purpose: ['ui', 'telemetry'],
      kind: 'component',
      sourceFile: 'cart/input_bench/Hud.tsx',
      description:
        'Overlay UI: top bar with title, usage text, 1P/3P camera buttons, reset, backend buttons (JS/IFTTT/LuaJIT/Zig), disabled-Lua label, backend blurb. Telemetry panel shows active backend, last/avg frame cost in us, frame count, position, yaw in degrees, Lua iteration counter. Reads the mutable controller during heartbeat renders; owns no movement state.',
      status: 'lab',
    },
    {
      name: 'Figure',
      purpose: ['character', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/input_bench/scene.tsx',
      description:
        'Third-person humanoid figure: takes position, yawRad, optional hidden; returns null when hidden. Humanoid part table copied from camera_lab. Rotates each local part offset around Y by player yaw, adds to player position, rotates each mesh by its own rotation plus player yaw in degrees. Built from cylinder legs, sphere shoes, box torso, torus belt, sphere shoulders, cylinder arms, sphere hands, cylinder neck, sphere head, box eyes, cone nose, cone hat.',
      status: 'lab',
    },
    {
      name: 'Arena',
      purpose: ['rendering', 'world_gen'],
      kind: 'component',
      sourceFile: 'cart/input_bench/scene.tsx',
      description:
        'Static memoized (useMemo deps []) 3D arena: static lights, thin box ground (not a plane), box/cylinder/sphere/torus/palm obstacles, flat-cylinder origin marker. Stable so its mesh tree does not change each frame.',
      status: 'lab',
    },
    {
      name: 'useLuaWorker / luaWorker',
      purpose: ['scripting', 'host_bridge'],
      kind: 'module',
      sourceFile: 'runtime/hooks/useLuaWorker.ts',
      description:
        'NOT a React hook despite the name: exports an imperative luaWorker object, a typed wrapper around the __lua_* host functions. Underlying worker lazily dlopens libluajit-5.1, runs a real OS thread, exposes Lua-callable host_running/host_recv_msg/host_send_msg, stores the script in a 16384-byte buffer, uses string message queues (1024 slots x 512 bytes each direction). Also has atomic-counter mode but input_bench uses string mode.',
      consumers: ['backend_lua'],
      dependsOn: ['__lua_available', '__lua_start', '__lua_stop', '__lua_eval', '__lua_send_msg', '__lua_recv_msg', '__lua_elapsed_us', '__lua_send', '__lua_recv_count', '__lua_set_n'],
      status: 'live',
    },
    {
      name: 'useIFTTT / busOn',
      purpose: ['input', 'host_bridge'],
      kind: 'module',
      sourceFile: 'runtime/hooks/useIFTTT.ts',
      description:
        'Provides busOn, useIFTTT, key trigger sources, and the key dispatch path used by the JS and IFTTT backends. Registers key: and key:up: sources; prefers the Zig-side IFTTT key matcher via __ifttt_key_register, falling back to __keydown/__keyup bus subscriptions for unsupported specs.',
      consumers: ['backend_js', 'backend_ifttt', 'backend_lua', 'InputBench'],
      emits: ['__keydown', '__keyup'],
      status: 'live',
    },
    {
      name: '__bench_now_us',
      purpose: ['telemetry', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_input_bench.zig',
      codeRef: 'framework/v8_bindings_input_bench.zig:365',
      description:
        'Returns high-resolution microseconds since first call using std.time.nanoTimestamp() minus an origin so the returned double stays precise. Used by JS, IFTTT, and Lua backends for timing.',
      consumers: ['backend_js', 'backend_ifttt', 'backend_lua'],
      status: 'live',
    },
    {
      name: '__input_bench_*',
      purpose: ['input', 'host_bridge', 'physics'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_input_bench.zig',
      description:
        'Host-side movement state and API: __input_bench_set_enabled/set_yaw/set_speed/reset/pos. On each pos() call Zig reads SDL keyboard state via SDL_GetKeyboardState, checks W/A/S/D scancodes, normalizes diagonals, mirrors the keys.ts formula, clamps dt to 100ms, updates g_x/g_z/g_last_dx/g_last_dz, measures elapsed us, and formats a compact CSV (x,z,dx,dz,us) to avoid JSON.parse in the hot path.',
      consumers: ['backend_zig'],
      status: 'live',
    },
    {
      name: '__lua_*',
      purpose: ['scripting', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_lua.zig',
      description:
        'Host functions backing useLuaWorker: __lua_available/start/stop/eval/send_msg/recv_msg/elapsed_us/send/recv_count/set_n. Registered in v8_bindings_lua.zig; the worker thread lives in framework/process/luajit_worker.zig.',
      consumers: ['useLuaWorker'],
      status: 'live',
    },
    {
      name: 'luajit_worker',
      purpose: ['scripting', 'host_bridge', 'game_loop'],
      kind: 'module',
      sourceFile: 'framework/process/luajit_worker.zig',
      description:
        'LuaJIT worker thread: message queues, fixed 16384-byte script storage, 1024-slot/512-byte string queues per direction, lazy dlopen of libluajit-5.1 (.so.2/.so/.dylib variants), no-op disabled mode when LuaJIT not loadable, Lua-callable host globals. A concrete off-thread scripting runtime with bounded queues and cart-owned lifecycle.',
      status: 'live',
    },
    {
      name: 'OrbitCamera / FirstPersonCamera',
      purpose: ['camera'],
      kind: 'component',
      sourceFile: 'runtime/cameras/index.tsx',
      description:
        'Registry camera rigs used by the cart. 3P mode uses OrbitCamera (target [ctrl.x,1.1,ctrl.z], yaw orbitYaw, pitch orbitPitch, dist 7, zoom 1, fov 55); 1P mode uses FirstPersonCamera (position = player, eyeHeight 1.7, facing lookYaw, pitch lookPitch, fov 75).',
      status: 'live',
    },
    {
      name: 'LUA_SCRIPT',
      purpose: ['scripting', 'input', 'math'],
      kind: 'dsl',
      sourceFile: 'cart/input_bench/backend_lua.tsx',
      description:
        'The Lua program run inside the worker: owns kw/ka/ks/kd key cell and x/z/yaw/speed, loops while host_running(), drains messages via host_recv_msg(), computes dt from os.clock() clamped to 0.1s, mirrors the normalized WASD formula from keys.ts, emits a p:x,z,iter position about every 100000 iterations, wraps the loop in pcall and emits E: on errors.',
      status: 'lab',
    },
    {
      name: 'index_old',
      purpose: ['input', 'maintenance'],
      kind: 'component',
      sourceFile: 'cart/input_bench/index_old.tsx',
      description:
        'Older cart entry kept in-tree. Spawn {x:0,z:-6}; yaw/pitch lived directly on ctrl.current; drag mutated ctrl.current.yaw/pitch directly; 1P and 3P shared one yaw/pitch source. Superseded by the active index.tsx with separate camera-lab-compatible 1P/3P yaw state.',
      status: 'deprecated',
    },
    {
      name: 'backend_lua_old',
      purpose: ['input', 'scripting', 'maintenance'],
      kind: 'component',
      sourceFile: 'cart/input_bench/backend_lua_old.tsx',
      description:
        'Older Lua backend kept in-tree. Emitted only on position change, no idle emits, reset message was bare r (not r:x:z), position message was bare x,z (not p:x,z,iter), no H:/E: messages, older strafe formula (dx=fwd*sy+strafe*cy, dz=fwd*cy-strafe*sy), timed with performance.now() instead of __bench_now_us(). Superseded.',
      status: 'deprecated',
    },
  ],
  patterns: [
    {
      name: 'Mutable controller',
      purpose: ['input', 'game_loop'],
      description:
        'One shared mutable object (Controller behind a ref) as the real-time movement state, avoiding 60-updates/sec React state churn while still letting React render from it on a heartbeat.',
      examples: ['input_bench', 'ragdoll_lab'],
      promoteTo: 'Controller',
      status: 'recurring',
    },
    {
      name: 'Backend driver component',
      purpose: ['input', 'game_loop'],
      description:
        'A small mounted component owning one input pipeline lifecycle; switching backends remounts the driver so cleanup removes listeners, stops workers, or disables host integration.',
      examples: ['input_bench'],
      status: 'recurring',
    },
    {
      name: 'Input dispatch path',
      purpose: ['input'],
      description:
        'The route from raw key press to key state. This cart compares four: direct bus, IFTTT registry, Lua message queue, and Zig SDL state.',
      examples: ['input_bench'],
      status: 'recurring',
    },
    {
      name: 'Integration formula',
      purpose: ['input', 'math'],
      description:
        'The shared movement math converting WASD plus yaw into dx,dz. Keeping it shared or mirrored across JS/Lua/Zig is essential for fair benchmarking.',
      examples: ['input_bench'],
      promoteTo: 'integrate',
      status: 'recurring',
    },
    {
      name: 'Mouse-owned heading',
      purpose: ['camera', 'input'],
      description:
        'Mouse look stays in JavaScript for all backends; backends only receive the already-normalized ground-plane yaw. The cart maps 1P/3P view state into one backend heading.',
      examples: ['input_bench'],
      status: 'recurring',
    },
    {
      name: 'Render heartbeat',
      purpose: ['game_loop'],
      description:
        'A scheduled dummy state increment (rAF or setTimeout(16)) that makes React re-read mutable non-React state so HUD/figure/camera repaint.',
      examples: ['input_bench', 'ragdoll_lab'],
      promoteTo: 'useGameLoop',
      status: 'promote',
    },
    {
      name: 'Self-reported frame cost',
      purpose: ['telemetry'],
      description:
        'Each backend writes lastFrameUs/avgFrameUs; the meaning differs per backend (e.g. Lua measures only JS-side plumbing), so comparisons must know what each backend times.',
      examples: ['input_bench'],
      status: 'recurring',
    },
    {
      name: 'Off-thread Lua worker',
      purpose: ['scripting', 'host_bridge'],
      description:
        'An off-thread script runtime with bounded string queues and explicit cart-owned lifecycle; a candidate pattern for game scripting but the cart also shows its complexity and failure modes.',
      examples: ['input_bench'],
      status: 'recurring',
    },
    {
      name: 'Zig host controller',
      purpose: ['input', 'host_bridge'],
      description:
        'A host-side movement loop that reads SDL directly and exposes a compact CSV polling API to JavaScript.',
      examples: ['input_bench'],
      status: 'recurring',
    },
    {
      name: 'Scene/logic separation',
      purpose: ['rendering', 'game_loop'],
      description:
        'The arena is static and memoized; the movement state lives outside the scene tree; the figure and camera are views over the controller.',
      examples: ['input_bench', 'camera_lab', 'ragdoll_lab'],
      status: 'recurring',
    },
    {
      name: 'Old implementation snapshot',
      purpose: ['maintenance'],
      description:
        'The _old files preserve previous design choices (single yaw/pitch controller state, older Lua emit/parse behavior) as history, not the active path.',
      examples: ['input_bench'],
      status: 'avoid',
    },
  ],
  hazards: [
    {
      name: 'useLuaWorker is not a hook',
      purpose: ['scripting', 'maintenance'],
      description:
        'runtime/hooks/useLuaWorker.ts is named like a React hook but exports an imperative luaWorker object, not a use* hook. Calling it like a hook (in render, under rules-of-hooks) is wrong.',
      evidence: ['runtime/hooks/useLuaWorker.ts is not a React hook despite its name; exports an imperative luaWorker object'],
      severity: 'high',
    },
    {
      name: 'Lua lastFrameUs measures plumbing, not Lua loop',
      purpose: ['telemetry'],
      description:
        'For the Lua backend, lastFrameUs is the JS-side cost of messaging and parsing for the active frame; it does NOT measure the Lua integration loop internal cost. Lua behavior appears only indirectly as position freshness/lag and luaIter.',
      evidence: ['Important measurement distinction: lastFrameUs for Lua is the JavaScript-side cost of messaging and parsing'],
      severity: 'high',
    },
    {
      name: 'rAF absent on this host',
      purpose: ['game_loop'],
      description:
        'globalThis.requestAnimationFrame does not exist on the cart V8 host; the heartbeat and backend loops fall back to setTimeout(fn,16). Code assuming rAF will not schedule.',
      evidence: ['uses globalThis.requestAnimationFrame when present; falls back to setTimeout(fn, 16)'],
      severity: 'medium',
    },
    {
      name: 'Three mirrored copies of the movement formula',
      purpose: ['input', 'math', 'maintenance'],
      description:
        'The integrate formula is mirrored in keys.ts, backend_lua.tsx (LUA_SCRIPT), and v8_bindings_input_bench.zig. They must stay in sync or the benchmark stops comparing the same movement; the _old Lua backend already drifted to a different strafe sign.',
      evidence: ['The same formula is mirrored in backend_lua.tsx and framework/v8_bindings_input_bench.zig', 'backend_lua_old used an older strafe formula: dx = fwd * sy + strafe * cy'],
      fix: 'Keep one canonical formula; the _old strafe-sign drift is the cautionary example.',
      severity: 'medium',
    },
    {
      name: 'Strafe sign is convention-dependent',
      purpose: ['input', 'math'],
      description:
        'The strafe sign in integrate is deliberately opposite the naive one: in this engine convention world +X renders as screen-left for the relevant camera math, so strafe is negated to make D walk screen-right. Naively "fixing" the sign breaks it.',
      evidence: ['keys.ts:171 comment: world +X renders as screen-left, so strafe uses the opposite sign needed to make D walk screen-right'],
      severity: 'medium',
    },
    {
      name: 'Mouse look excluded from benchmark',
      purpose: ['telemetry', 'camera'],
      description:
        'Mouse look is intentionally NOT part of the backend comparison; all backends share the same JS-owned yaw. Treating telemetry as covering the full input path would overstate what the backend measures.',
      evidence: ['Mouse look is intentionally not part of the benchmark comparison'],
      severity: 'low',
    },
    {
      name: 'Cart is a measurement rig, not a controller',
      purpose: ['input', 'telemetry'],
      description:
        'The manifest and design intend input_bench as an empirical benchmark, not a production movement controller; reusing it whole as a game controller mixes four experimental runtime paths into one cart.',
      evidence: ['the cart is intentionally a measurement rig, not a production movement controller'],
      severity: 'low',
    },
  ],
};
