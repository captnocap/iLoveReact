import type { DocIndex } from '../types';

export const animation_lab: DocIndex = {
  name: 'animation_lab',
  file: 'animation_lab.md',
  cart: 'cart/animation_lab.tsx',
  purpose: ['animation', 'character', 'camera', 'input', 'rendering', 'game_loop'],
  loc: 683,
  summary:
    'A single-file 3D character animation lab that renders a primitive-mesh humanoid driven by procedural pose values, previewing movement actions and emotes with optional Zig-side drive-mode movement.',
  interfaces: [
    {
      name: 'AnimationLab',
      purpose: ['animation', 'character', 'game_loop'],
      kind: 'component',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:458',
      description:
        'Default-export cart component: owns action/cameraMode/frame state, the sim ref, the frame loop, drag handling, camera math, and the full UI tree.',
      dependsOn: ['AnimatedFigure', 'poseFor', 'Scene3D', 'Input bench'],
      status: 'lab',
    },
    {
      name: 'Pose',
      purpose: ['animation'],
      kind: 'data_model',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:123-135',
      description:
        'The whole animation data shape: rootPitch, bodyY, torsoLean, headNod, per-leg/knee/arm swing angles, and armLift. The compact record consumed by AnimatedFigure.',
      consumers: ['AnimatedFigure'],
      status: 'lab',
    },
    {
      name: 'poseFor',
      purpose: ['animation'],
      kind: 'utility',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:137-330',
      description:
        'Procedural animation table mapping (action, t, moving, driveJumpY) to a Pose using sine/cosine oscillators per action; not data loaded from files. Drive mode reuses walk/run generation.',
      consumers: ['AnimationLab'],
      status: 'lab',
    },
    {
      name: 'AnimatedFigure',
      purpose: ['character', 'animation', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:354-407',
      description:
        'Renders the full humanoid from independent Scene3D.Mesh parts each render; proportions are hardcoded inside it, no shared avatar data model. hideHead removes head/eyes/nose/hat for first-person drive.',
      dependsOn: ['Pose', 'LimbSegment', 'segmentPose', 'Scene3D'],
      consumes: ['Pose'],
      status: 'lab',
    },
    {
      name: 'LimbSegment',
      purpose: ['character', 'animation', 'geometry'],
      kind: 'component',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:332-352',
      description:
        'Wraps the shared limb math: computes a cylinder center/rotation via segmentPose then renders one Scene3D.Mesh using Geometry.Cylinder. Radius, length, material, swing, side angle, yaw, root pitch are props.',
      dependsOn: ['segmentPose'],
      status: 'lab',
    },
    {
      name: 'segmentPose',
      purpose: ['math', 'animation'],
      kind: 'utility',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:95-102',
      description:
        'Computes the center point, endpoint, and Euler rotation for a limb segment from a joint, length, swing angle, side angle, yaw, and root pitch.',
      consumers: ['LimbSegment', 'AnimatedFigure'],
      status: 'lab',
    },
    {
      name: 'Marker',
      purpose: ['rendering'],
      kind: 'component',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:409-416',
      description:
        'Renders a floor marker at the active figure position using a small cylinder disk plus a torus ring.',
      status: 'lab',
    },
    {
      name: 'EmoteFx',
      purpose: ['animation', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:418-456',
      description:
        'Renders extra procedural meshes for some emotes: cry tears, laugh halo/spheres, fart gas puffs, point accent cone; returns null for other actions.',
      status: 'lab',
    },
    {
      name: 'ACTIONS',
      purpose: ['animation', 'ui'],
      kind: 'registry',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:40-53',
      description:
        'The toolbar/action registry: each entry has id (the Action string), label (button text), and group (move|emote, used only for button background styling).',
      status: 'lab',
    },
    {
      name: 'Action',
      purpose: ['animation'],
      kind: 'data_model',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:10-12',
      description:
        'The complete action vocabulary as string literals (walk/run/jump/sit/sleep/drive + dance/cry/laugh/fart/point/wave); action identity is both state and display/control key.',
      status: 'lab',
    },
    {
      name: 'CameraMode',
      purpose: ['camera'],
      kind: 'data_model',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:13',
      description: "Either 'third' or 'first' — selects third-person chase or first-person view.",
      status: 'lab',
    },
    {
      name: 'Vec3',
      purpose: ['math'],
      kind: 'data_model',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:9',
      description:
        'A tuple of three numbers used for positions, rotations, directions, and scales.',
      status: 'lab',
    },
    {
      name: 'hostNumber / hostString / hostVoid',
      purpose: ['host_bridge'],
      kind: 'utility',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:104-121',
      description:
        'Local safety wrappers around globalThis host calls: coerce/validate the result and fall back when the function is missing or non-finite, so the cart still renders with no host present.',
      status: 'lab',
    },
    {
      name: 'rotateY / rotateX / orient / dirDown / point / add / clamp / rad / deg / angleDelta',
      purpose: ['math'],
      kind: 'utility',
      sourceFile: 'cart/animation_lab.tsx',
      codeRef: 'cart/animation_lab.tsx:55-93',
      description:
        'Pure JS math helpers: angle conversion, shortest wrapped angular delta (angleDelta prevents the long-way yaw rotation), Vec3 add, Y/X rotations, root-pitch-then-yaw orient, down-the-limb direction, and offset placement.',
      status: 'lab',
    },
    {
      name: '__input_bench_pos',
      purpose: ['input', 'physics', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_input_bench.zig',
      codeRef: 'framework/v8_bindings_input_bench.zig:121-176',
      description:
        'Main drive-mode integrator: advances Zig horizontal movement from W/S/A/D against g_yaw with internal dt, and returns a compact CSV string x,z,dx,dz,us. Reused from input benchmarking.',
      consumers: ['AnimationLab'],
      status: 'live',
    },
    {
      name: '__input_bench_reset',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_input_bench.zig',
      codeRef: 'framework/v8_bindings_input_bench.zig:84-91',
      description: 'Resets Zig input-bench position to (x, z); called on mount and when entering drive mode.',
      consumers: ['AnimationLab'],
      status: 'live',
    },
    {
      name: '__input_bench_set_enabled',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_input_bench.zig',
      codeRef: 'framework/v8_bindings_input_bench.zig:113-119',
      description: 'Enables/disables the input-bench backend; called on mount and cleanup.',
      consumers: ['AnimationLab'],
      status: 'live',
    },
    {
      name: '__input_bench_set_yaw',
      purpose: ['input', 'camera', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_input_bench.zig',
      codeRef: 'framework/v8_bindings_input_bench.zig:100-104',
      description: 'Sends current yaw (rad) to Zig each frame so movement integrates relative to camera yaw.',
      consumers: ['AnimationLab'],
      status: 'live',
    },
    {
      name: '__input_bench_set_speed',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_input_bench.zig',
      codeRef: 'framework/v8_bindings_input_bench.zig:106-111',
      description: 'Sends per-frame movement speed (walk or run units/s) to the Zig drive integrator.',
      consumers: ['AnimationLab'],
      status: 'live',
    },
    {
      name: 'isKeyDown',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_core.zig',
      codeRef: 'framework/v8_bindings_core.zig:790-814',
      description:
        'Core host function reading SDL keyboard state by scancode; used here every frame for Shift and Space. Declared in runtime/_generated_host_globals.d.ts:4-22.',
      consumers: ['AnimationLab'],
      status: 'live',
    },
    {
      name: 'Scene3D',
      purpose: ['rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:405-424',
      description:
        'ReactJIT primitive wrapper emitting host View nodes with scene3d* props; the actual render path is host-side wgpu in framework/gpu/3d.zig. Family: Camera, AmbientLight, DirectionalLight, PointLight, Mesh.',
      status: 'live',
    },
    {
      name: 'Scene3D.Mesh',
      purpose: ['rendering', 'geometry'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:535-700',
      description:
        'Maps geometry generator definitions and material/position/rotation/scale props into scene3dMesh fields. Used for every visible 3D object via the canonical @reactjit/geometries generator path.',
      consumers: ['AnimatedFigure', 'LimbSegment', 'Marker', 'EmoteFx'],
      status: 'live',
    },
    {
      name: 'Scene3D.Camera',
      purpose: ['camera', 'rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:454-465',
      description: 'Maps position/target/fov to scene3dCamera/scene3dPos*/scene3dLook*/scene3dFov; one active camera recalculated every render.',
      status: 'live',
    },
    {
      name: '@reactjit/geometries',
      purpose: ['geometry'],
      kind: 'registry',
      sourceFile: 'runtime/geometries/index.ts',
      description:
        'Geometry generator registry used by Scene3D.Mesh; this cart uses Box, Sphere, Cylinder, Cone, Torus. Canonical generator path, not legacy string geometry names.',
      consumers: ['AnimationLab'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Procedural pose vocabulary (Pose + poseFor)',
      purpose: ['animation', 'character'],
      description:
        'Animation represented as a small Pose record plus poseFor(action, t, ...) procedural table — no skeleton, clip format, keyframe interpolation, or IK.',
      examples: ['animation_lab'],
      status: 'recurring',
    },
    {
      name: 'Part-built humanoid from primitive meshes',
      purpose: ['character', 'rendering', 'geometry'],
      description:
        'A humanoid assembled as a collection of primitive Scene3D.Mesh parts each render, with no model importer or shared avatar data model — proportions hardcoded in the renderer.',
      examples: ['animation_lab'],
      promoteTo: 'reusable humanoid package',
      status: 'promote',
    },
    {
      name: 'Camera yaw as shared movement-direction source',
      purpose: ['camera', 'input'],
      description: 'Camera yaw doubles as the source of movement direction; visualYaw is a smoothed body-facing derivative.',
      examples: ['animation_lab'],
      status: 'recurring',
    },
    {
      name: 'Host-side horizontal movement, JS owns presentation',
      purpose: ['physics', 'input', 'host_bridge'],
      description:
        'Horizontal movement integrated in a Zig host backend while JavaScript keeps camera orientation, jump, pose choice, and all rendering state.',
      examples: ['animation_lab'],
      status: 'recurring',
    },
    {
      name: 'Mixed input: host polling + React pointer events',
      purpose: ['input'],
      description:
        'Keyboard read via host isKeyDown polling each frame; pointer drag handled by React primitive onMouseDown/Move/Up on the scene Pressable.',
      examples: ['animation_lab'],
      status: 'recurring',
    },
    {
      name: 'Refs + cheap frame counter to drive rendering',
      purpose: ['game_loop'],
      description:
        'Per-frame simulation lives in refs; an incrementing frame counter useState forces React renders without state churn.',
      examples: ['animation_lab'],
      status: 'recurring',
    },
    {
      name: 'rAF-or-setTimeout / performance-or-Date scheduling guard',
      purpose: ['game_loop'],
      description:
        'Frame loop uses globalThis.requestAnimationFrame if present else setTimeout(fn,16), and performance.now() if present else Date.now() — defensive against the cart host lacking rAF.',
      examples: ['animation_lab'],
      status: 'recurring',
    },
    {
      name: 'Host function wrapper with fallback',
      purpose: ['host_bridge'],
      description:
        'hostNumber/hostString/hostVoid check globalThis before calling a host function and fall back to zeros/defaults if missing, keeping the cart renderable without the host.',
      examples: ['animation_lab'],
      status: 'recurring',
    },
    {
      name: 'First-person avatar self-occlusion via head hiding',
      purpose: ['camera', 'rendering'],
      description:
        'hideHead removes head/eyes/nose/hat (keeps neck) in first-person drive so the camera does not sit inside the head mesh.',
      examples: ['animation_lab'],
      status: 'recurring',
    },
    {
      name: 'Preview lane for comparing animation states',
      purpose: ['animation', 'debug'],
      description: 'A row of five static-position figures shows walk/run/jump/sit/sleep simultaneously in one running scene.',
      examples: ['animation_lab'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: "Active pose differs from selected action in drive mode",
      purpose: ['animation'],
      description:
        "In drive mode the rendered pose may be 'walk' or 'run' even while the selected action is 'drive' — pose action is recomputed by speed (>4 = run) at cart/animation_lab.tsx:551.",
      evidence: ['cart/animation_lab.tsx:551', 'cart/animation_lab.tsx:546-560'],
      severity: 'low',
    },
    {
      name: 'Input bench is benchmarking code reused for gameplay',
      purpose: ['input', 'physics'],
      description:
        "The Zig drive integrator (framework/v8_bindings_input_bench.zig) is named for input benchmarking but is the production drive-mode movement backend here; the __input_bench_* naming hides its gameplay role.",
      evidence: ['framework/v8_bindings_input_bench.zig:121-176', 'animation_lab.md Glossary: Input bench'],
      severity: 'medium',
    },
    {
      name: 'Looks like a reusable humanoid primitive but is not',
      purpose: ['character', 'maintenance'],
      description:
        'AnimatedFigure resembles a reusable primitive but proportions are hardcoded and there is no shared avatar data model, package, customization, or equipment slots — copying it as a library would mislead.',
      evidence: ['cart/animation_lab.tsx:354-407', 'animation_lab.md: "No reusable humanoid package, despite resembling a reusable primitive."'],
      fix: 'Extract a real humanoid package with a shared avatar data model before reuse.',
      severity: 'medium',
    },
    {
      name: 'Two separate jump/dt integrators (JS vs Zig)',
      purpose: ['physics'],
      description:
        'Jump physics is JS-side with its own gravity while horizontal movement and dt clamping live in Zig (clamped 100ms there, 0.001-0.05s in JS) — two independent timesteps in one frame.',
      evidence: ['cart/animation_lab.tsx:526-533', 'framework/v8_bindings_input_bench.zig:121-176'],
      severity: 'low',
    },
    {
      name: 'Warmup HUD is purely informational',
      purpose: ['ui'],
      description:
        'The 25s warmup timer (held 5s after ending) does not gate input, animation, rendering, or physics — it is display-only and may be mistaken for a real readiness gate.',
      evidence: ['cart/animation_lab.tsx:659-683', 'animation_lab.md: "Warmup is informational only."'],
      severity: 'low',
    },
  ],
};
