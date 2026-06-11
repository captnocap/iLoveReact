import type { DocIndex } from '../types';

export const physics_lab: DocIndex = {
  name: 'physics_lab',
  file: 'physics_lab.md',
  cart: 'cart/physics_lab.tsx',
  purpose: ['physics', 'host_bridge', 'geometry', 'item', 'telemetry', 'camera'],
  summary:
    'A 3D rigid-body-ish physics probe with a dual backend — the same toy world (a walkable player + tumbling item bodies in a walled arena) implemented twice, once in JS and once in Zig on the host — switchable at runtime while showing per-frame microsecond timings for both. Since WO-1 (2026-06-04) the Zig file holds ONLY this toy: the game sim it incubated graduated to framework/game/physics.zig behind -Dhas-game-physics.',
  interfaces: [
    {
      name: 'stepPhysics',
      purpose: ['physics', 'game_loop'],
      kind: 'utility',
      sourceFile: 'cart/physics_lab.tsx',
      codeRef: 'cart/physics_lab.tsx:784',
      description:
        'The JS backend: 3 fixed sub-steps of dt/3 per frame, mutating the ref\'d Player/Ball[] in place — player movement, jump, body Euler integration + tumble, all contact resolution. Line-for-line port of the Zig twin.',
      status: 'lab',
    },
    {
      name: '__physics_lab_reset',
      purpose: ['physics', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_physics_lab.zig',
      codeRef: 'framework/v8_bindings_physics_lab.zig:753',
      description: 'Resets both the Zig sim and triggers a JS reset; called when switching to the host backend.',
      consumers: ['physics_lab'],
      status: 'lab',
    },
    {
      name: '__physics_lab_burst',
      purpose: ['physics', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_physics_lab.zig',
      description: 'Adds 4 balls to the Zig sim; mirrored by the cart\'s JS addBall to keep counts aligned for fair comparison.',
      consumers: ['physics_lab'],
      status: 'lab',
    },
    {
      name: '__physics_lab_step',
      purpose: ['physics', 'host_bridge', 'format'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_physics_lab.zig',
      description:
        'Host step returning the snapshot as a CSV string (fallback/debug); the cart parses it with a hand-rolled charCode-walking float scanner, no split/parseFloat. Tried only if the buffer fn is missing.',
      consumers: ['physics_lab'],
      status: 'lab',
    },
    {
      name: '__physics_lab_step_buffer',
      purpose: ['physics', 'host_bridge', 'format'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_physics_lab.zig',
      description:
        'Hot-path host step: Zig writes into a static g_snapshot f32 array (max 512 balls) and returns it as a zero-copy ArrayBuffer (setReturnF32Buffer); cart reads fields positionally.',
      consumers: ['physics_lab'],
      status: 'lab',
    },
    {
      name: '__bench_now_us',
      purpose: ['telemetry', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_input_bench.zig',
      codeRef: 'framework/v8_bindings_input_bench.zig:200',
      description: 'Monotonic µs clock the cart prefers for timing; nowUs() falls back to performance.now()*1000 then Date.now()*1000.',
      consumers: ['physics_lab'],
      status: 'live',
    },
    {
      name: 'isKeyDown',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_core.zig',
      description: 'Host-polled raw SDL scancode query used for WASD/Space/Shift; ORed with bus key state by inputDown().',
      consumers: ['physics_lab'],
      status: 'live',
    },
    {
      name: 'busOn',
      purpose: ['input', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/useIFTTT.ts',
      codeRef: 'runtime/hooks/useIFTTT.ts:207',
      description:
        'Subscribes the cart to __keydown/__keyup bus channels; the host pushes packed key events via G.__ifttt_onKeyDown/onKeyUp (lines 371-372) which emit() onto those channels.',
      consumes: ['__keydown', '__keyup'],
      consumers: ['physics_lab'],
      status: 'live',
    },
    {
      name: 'applyHostSnapshotBuffer',
      purpose: ['physics', 'format'],
      kind: 'utility',
      sourceFile: 'cart/physics_lab.tsx',
      codeRef: 'cart/physics_lab.tsx:585',
      description:
        'Wraps the returned ArrayBuffer in a Float32Array and reads the 12-float header + 9-float-per-ball records positionally; overwrites JS-side state from the host snapshot.',
      status: 'lab',
    },
    {
      name: 'applyHostSnapshot',
      purpose: ['physics', 'format'],
      kind: 'utility',
      sourceFile: 'cart/physics_lab.tsx',
      codeRef: 'cart/physics_lab.tsx:500',
      description:
        'CSV-string snapshot parser with an allocation-free charCode-walking float scanner (next()); no split, no parseFloat, no per-field allocation.',
      status: 'lab',
    },
    {
      name: 'ITEM_CATALOG',
      purpose: ['item', 'physics'],
      kind: 'registry',
      sourceFile: 'cart/physics_lab.tsx',
      codeRef: 'cart/physics_lab.tsx:367',
      description:
        '19-entry PhysicsItem[] joining physics (radius/mass/cog — mirrored in Zig items at line 120) to visuals (label/tone/model — cart-only) by itemIndex; the host knows only the triples.',
      status: 'lab',
    },
    {
      name: 'PhysicsItem',
      purpose: ['item', 'physics'],
      kind: 'data_model',
      sourceFile: 'cart/physics_lab.tsx',
      codeRef: 'cart/physics_lab.tsx:90',
      description:
        '{id, label, tone, radius, mass, cog, model} — the model is a function (ctx: ModelCtx) => JSX, not a component; a clean physics/visual split.',
      status: 'lab',
    },
    {
      name: 'ModelCtx',
      purpose: ['geometry', 'rendering'],
      kind: 'data_model',
      sourceFile: 'cart/physics_lab.tsx',
      description:
        '{origin, rotation, scale, active} threaded to Part — the cart\'s transform-hierarchy substitute since Scene3D has no parent/child transform nesting.',
      status: 'lab',
    },
    {
      name: 'Part',
      purpose: ['geometry', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/physics_lab.tsx',
      codeRef: 'cart/physics_lab.tsx:226',
      description:
        'Renders one Scene3D.Mesh with p/r/s baked through the ctx (local() rotates the offset by the body Euler, scales, translates; rot() adds rotations; scl() multiplies scale) — a poor-man\'s transform hierarchy in cart math.',
      status: 'lab',
    },
    {
      name: 'def (inline geometry registrar)',
      purpose: ['geometry'],
      kind: 'utility',
      sourceFile: 'cart/physics_lab.tsx',
      codeRef: 'cart/physics_lab.tsx:112',
      description:
        'Local def(id, defaults, generate) returning the registry-shaped {id, defaults, generate}; proves carts can author registry-compatible geometry without touching the framework.',
      status: 'lab',
    },
    {
      name: 'physics-lab/blade-v1',
      purpose: ['geometry'],
      kind: 'registry',
      sourceFile: 'cart/physics_lab.tsx',
      codeRef: 'cart/physics_lab.tsx:134',
      description: 'Inline custom geometry (Blade) built with mesh()/tri()/quad() flat-shaded normals; reusable as-is.',
      status: 'lab',
    },
    {
      name: 'sail-v1',
      purpose: ['geometry'],
      kind: 'registry',
      sourceFile: 'cart/physics_lab.tsx',
      description: 'Inline custom Sail geometry defined in the cart via def().',
      status: 'lab',
    },
    {
      name: 'boat-hull-v1',
      purpose: ['geometry'],
      kind: 'registry',
      sourceFile: 'cart/physics_lab.tsx',
      description: 'Inline custom BoatHull geometry defined in the cart via def().',
      status: 'lab',
    },
    {
      name: 'surfboard-v1',
      purpose: ['geometry'],
      kind: 'registry',
      sourceFile: 'cart/physics_lab.tsx',
      description: 'Inline custom Surfboard geometry defined in the cart via def().',
      status: 'lab',
    },
    {
      name: 'kickSpin',
      purpose: ['physics'],
      kind: 'utility',
      sourceFile: 'cart/physics_lab.tsx',
      codeRef: 'cart/physics_lab.tsx:653',
      description:
        'Heuristic torque (rotated COG) × (contact normal) × strength ÷ mass applied at every contact — the cheapest believable tumble; exists identically in TS and Zig, a candidate shared utility.',
      status: 'lab',
    },
    {
      name: 'BallMesh',
      purpose: ['rendering', 'item'],
      kind: 'component',
      sourceFile: 'cart/physics_lab.tsx',
      codeRef: 'cart/physics_lab.tsx:984',
      description:
        'Per-body presentation: model origin offset by the rotated COG, a fake contact-shadow cylinder whose z-scale shrinks with height, and an accent sphere marking the physics center.',
      status: 'lab',
    },
    {
      name: 'PlayerRig',
      purpose: ['rendering', 'character'],
      kind: 'component',
      sourceFile: 'cart/physics_lab.tsx',
      codeRef: 'cart/physics_lab.tsx:968',
      description: 'A 6-mesh stick figure with a walk-bob and a nose cone showing facing.',
      status: 'lab',
    },
    {
      name: 'nowUs',
      purpose: ['telemetry'],
      kind: 'utility',
      sourceFile: 'cart/physics_lab.tsx',
      codeRef: 'cart/physics_lab.tsx:421',
      description: 'Prefers host __bench_now_us, falls back to performance.now()*1000 then Date.now()*1000.',
      dependsOn: ['__bench_now_us'],
      status: 'lab',
    },
    {
      name: 'Geometry registry',
      purpose: ['geometry'],
      kind: 'registry',
      sourceFile: 'runtime/geometries/index.ts',
      description:
        '@reactjit/geometries Box/Cylinder/Cone/Sphere/Torus plus mesh()/normalize; the cart uses shared unit params (box1, cyl12/18, cone12, sphere12) scaled via transform per the intern-cache rule.',
      consumers: ['physics_lab'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Host twin',
      purpose: ['physics', 'host_bridge', 'telemetry'],
      description:
        'Port the JS sim to Zig function-for-function, keep constants duplicated and hand-synced, snapshot back as packed f32; its measured product is the timing HUD (sim vs bridge cost) that justified moving hmsc physics host-side.',
      examples: ['physics_lab'],
      status: 'recurring',
    },
    {
      name: 'Packed-f32-snapshot-over-ArrayBuffer (zero-copy) hot bridge + CSV charCode-scanner debug fallback',
      purpose: ['host_bridge', 'format'],
      description:
        'The established hot bridge format paired with the established debug fallback; same idioms as the input_bench CSV in animation_lab, the buffer being the evolution.',
      examples: ['physics_lab', 'animation_lab'],
      status: 'recurring',
    },
    {
      name: 'Physics triple + visual model function',
      purpose: ['item', 'physics', 'rendering'],
      description:
        '{radius, mass, cog} for the host plus a cart-owned visual model, joined by an index — a physics/visual split that recurs in combat_lab figures and scape3d thingymajiggers.',
      examples: ['physics_lab', 'combat_lab', 'scape3d'],
      status: 'recurring',
    },
    {
      name: 'Model-as-function with ModelCtx + Part (hand-rolled transform hierarchy)',
      purpose: ['geometry', 'rendering'],
      description:
        'Threading a {origin,rotation,scale} context to a Part that bakes parent transform into each Scene3D.Mesh; compare animation_lab segmentPose and head_lab parts — recurring evidence Scene3D wants nested transforms.',
      examples: ['physics_lab', 'animation_lab', 'head_lab'],
      promoteTo: 'Part',
      status: 'promote',
    },
    {
      name: 'Inline def() registry-compatible geometry',
      purpose: ['geometry'],
      description:
        'A cart authoring {id, defaults, generate} geometry locally — the registry\'s open authoring path works from inside a cart; Blade/Sail/BoatHull/Surfboard reusable as-is.',
      examples: ['physics_lab'],
      status: 'recurring',
    },
    {
      name: 'Ref-mirror-per-state game loop',
      purpose: ['game_loop'],
      description:
        'All sim data in refs (sim, keysRef, camRef, pausedRef, backendRef); React state only frame/paused/backend/cam, each copied into its ref by a small useEffect so the closed-over tick sees current values; setFrame bump forces render.',
      examples: ['physics_lab'],
      status: 'recurring',
    },
    {
      name: 'rAF-probe / setTimeout-16 loop',
      purpose: ['game_loop'],
      description: 'requestAnimationFrame if present else setTimeout(16) — this host has no rAF; universal across carts.',
      examples: ['physics_lab', 'planet_run'],
      status: 'recurring',
    },
    {
      name: 'Edge-detected jump with hold-boost',
      purpose: ['physics', 'input'],
      description:
        'Impulse on press edge then extra upward accel while held (≤0.18s) and still rising — the platformer-feel variable-jump-height recipe worth canonizing.',
      examples: ['physics_lab'],
      status: 'recurring',
    },
    {
      name: 'Same-Pressable pointer-capture camera drag',
      purpose: ['camera', 'input'],
      description:
        'onMouseDown/Move/Up on the same Pressable; drag writes camRef and setCam so the loop reads fresh values without waiting for render.',
      examples: ['physics_lab'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'Duplicated item table TS↔Zig, hand-synced',
      purpose: ['physics', 'item', 'maintenance'],
      description:
        'The cart\'s ITEM_CATALOG (19 r/m/cog triples) is mirrored in Zig\'s items array, hand-synced; Zig knows nothing about labels/tones/models. Editing one side without the other drifts the sim.',
      evidence: [
        'cart/physics_lab.tsx:367 (ITEM_CATALOG)',
        'framework/v8_bindings_physics_lab.zig:103 (items)',
      ],
      fix: 'A canonical physics module should generate or share one source of truth (the hmsc step already moved to config-in-the-call).',
      severity: 'high',
    },
    {
      name: 'Duplicated step logic and constants TS↔Zig',
      purpose: ['physics', 'maintenance'],
      description:
        'collideCircleBlock/collideSphereBlock/resolveBallPair/kickSpin/stepPhysics, GRAVITY/restitution/WORLD_HALF/jump tuning/scancodes, and the blocks array are all duplicated line-for-line between TS (664-966) and Zig (340-681).',
      evidence: [
        'cart/physics_lab.tsx:664-966',
        'framework/v8_bindings_physics_lab.zig:265-605',
      ],
      fix: 'Share one source of truth for constants and step logic.',
      severity: 'high',
    },
    {
      name: 'Host backend bypasses JS key tracking',
      purpose: ['input', 'physics'],
      description:
        'In host mode Zig polls SDL_GetKeyboardState directly (lines 194-198) so JS-side key tracking is bypassed for movement; only camera yaw crosses the bridge as input.',
      evidence: ['framework/v8_bindings_physics_lab.zig:194-198'],
      severity: 'medium',
    },
    {
      name: 'Snapshot is lossy by design',
      purpose: ['physics', 'format'],
      description:
        'The snapshot carries no velocities (JS mirror zeroes vx/vy/vz) and collapses angular velocity to a single magnitude stuffed into wx — enough for presentation, not for handing the sim back to JS. Host balls get synthetic host-${i} ids; the ball array is resized destructively to count.',
      evidence: ['cart/physics_lab.md "Lossy by design" snapshot section'],
      severity: 'medium',
    },
    {
      name: 'Stateful Zig lab vs stateless game step',
      purpose: ['physics', 'host_bridge'],
      description:
        'The lab fns are stateful (Zig owns g_player/g_balls/its own dt and SDL input); the game step (framework/game/physics.zig, formerly cohabiting this file as __hmsc_physics_step until the WO-1 graduation) is stateless-per-call (config-in, snapshot-out) — opposite ownership models.',
      evidence: ['cart/physics_lab.md "Contrast with the lab fns, which are stateful"'],
      severity: 'low',
    },
    {
      name: 'No real rigid-body dynamics',
      purpose: ['physics'],
      description:
        'No inertia tensors (spin kicks are a COG-torque heuristic), no friction cones, no resting-contact solver, no sleep states, no broadphase (O(n²) pairs); no standing on blocks and no heightfields in this lab world (flat floor only).',
      evidence: ['cart/physics_lab.md "No real rigid-body dynamics"'],
      severity: 'low',
    },
  ],
};
