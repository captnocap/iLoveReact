import type { DocIndex } from '../types';

export const physics3d: DocIndex = {
  name: 'physics3d',
  file: 'physics3d.md',
  purpose: ['physics', 'host_bridge', 'maintenance'],
  loc: 320,
  summary:
    'A fully implemented but completely disconnected Bullet 3.25 rigid-body module — a fixed-pool manager that would map Bullet bodies onto layout nodes scene3d_* transform fields so physics drives what Scene3D.Mesh renders — wired to nothing in the V8 era.',
  interfaces: [
    {
      name: 'physics3d.zig',
      purpose: ['physics', 'host_bridge'],
      kind: 'module',
      sourceFile: 'framework/phys/physics3d.zig',
      description:
        'The Zig module (~320 lines). A pool of 8 worlds (MAX_PHYSICS3D_WORLDS), each its own btDiscreteDynamicsWorld with its own gravity; world id 0 is default and every public fn has a xxx()/xxxFor(id,...) pair. 256 bodies per world (MAX_BODIES_PER_WORLD) in a fixed array, first-inactive-slot allocation, index-as-handle. Each Body holds a *Node pointer it animates. All units are world units (1=1). tick(dt)/tickFor steps every initialized world then writes each active body position+euler directly into the node scene3d_pos_x/y/z and scene3d_rot_x/y/z fields. Exposes init/deinit, anyInitialized, createBody, friction/restitution/damping setters, applyForce/applyImpulse/setLinearVelocity, and raycast. Nothing imports it.',
      dependsOn: ['physics3d_shim.h', 'physics3d_shim.cpp'],
      status: 'dormant',
    },
    {
      name: 'physics3d_shim.h',
      purpose: ['physics', 'host_bridge'],
      kind: 'module',
      sourceFile: 'framework/ffi/physics3d_shim.h',
      description:
        'C API surface for @cImport. Hides all Bullet C++ types behind opaque void* typedefs (Phys3DWorld, Phys3DShape, Phys3DBody) so Zig @cImport never sees C++. Explicitly mirrors physics_shim.h (the Box2D 2D shim). Surface: world create/destroy/step, shape constructors, body create/destroy, transform getters (phys3d_body_get_x/y/z, phys3d_body_get_euler), property setters, force/impulse, raycast.',
      status: 'dormant',
    },
    {
      name: 'physics3d_shim.cpp',
      purpose: ['physics', 'host_bridge'],
      kind: 'module',
      sourceFile: 'framework/ffi/physics3d_shim.cpp',
      description:
        'The C++ -> Bullet 3.25 implementation (~300 lines). Shape constructors box|sphere|cylinder|capsule|cone|plane with sizes as full extents halved at the shim boundary for box/cylinder; plane hardcoded to ground (normal (0,1,0), offset 0). heightfield is declared in the enum but returns null — never implemented. World step uses max 10 substeps. Failed body creation destroys the shape it just made (no leak).',
      status: 'dormant',
    },
    {
      name: '__hmsc_physics_step',
      purpose: ['physics', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_physics_lab.zig',
      description:
        'The LIVE 3D physics path (NOT physics3d). Host fn taking a Float32 ArrayBuffer in and out, a hand-rolled flat-rect + heightfield-collider world. The bridge is crossed once per frame with a packed buffer rather than per-body node sync. This is what hmsc actually uses.',
      consumers: ['cart/hmsc'],
      status: 'live',
    },
    {
      name: '__hmsc_register_heightfield',
      purpose: ['physics', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_physics_lab.zig',
      description:
        'LIVE host fn registering a heightfield terrain collider — first-class here, exactly the collider physics3d never implemented (its enum case returns null).',
      consumers: ['cart/hmsc'],
      status: 'live',
    },
    {
      name: '__hmsc_clear_heightfields',
      purpose: ['physics', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_physics_lab.zig',
      description: 'LIVE host fn clearing registered heightfield colliders before re-registering the current set.',
      consumers: ['cart/hmsc'],
      status: 'live',
    },
    {
      name: '__physics_lab_step',
      purpose: ['physics', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_physics_lab.zig',
      description:
        'LIVE host fn family (__physics_lab_reset/burst/step/step_buffer) for the hand-rolled hmsc sim world.',
      status: 'live',
    },
    {
      name: 'physics2d <Physics.World/Body/Collider>',
      purpose: ['physics'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:373',
      description:
        'The LIVE 2D sibling: Box2D engine wired via Node props (physics_world/body/collider flags) read by engine.zig:561+ gated HAS_PHYSICS, render handoff writes node layout fields. The <Physics> primitive is 2D Box2D only; there is no <3D.Physics> primitive.',
      dependsOn: ['framework/engine.zig'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'C-shim-over-C++-lib',
      purpose: ['physics', 'host_bridge'],
      description:
        'Opaque void* handles + flat extern "C" fns so Zig @cImport stays C-only. Same idiom family: physics_shim.h (Box2D), physics3d_shim.h (Bullet). The shim halves box extents and converts enums to c_int.',
      examples: ['physics3d', 'physics2d'],
      status: 'recurring',
    },
    {
      name: 'Fixed pool + linear-scan slot allocation',
      purpose: ['physics', 'maintenance'],
      description:
        '[MAX]struct{active:bool,...} arrays, first-inactive-wins, index-as-handle, bounds-check + silent no-op on every access. The standard framework resource-pool shape, same in physics2d and GPU pools.',
      examples: ['physics3d', 'physics2d'],
      status: 'recurring',
    },
    {
      name: 'Instance-pool with default-0 + xxxFor(id) API doubling',
      purpose: ['physics', 'host_bridge'],
      description:
        'Every public fn exists as a world-0 convenience and an explicit-instance variant. Mirrors how multi-instance subsystems are exposed across the framework.',
      examples: ['physics3d'],
      status: 'recurring',
    },
    {
      name: 'Physics-writes-node-fields sync',
      purpose: ['physics', 'rendering'],
      description:
        'The simulation output IS mutation of the same Node fields the reconciler sets from JSX props (scene3d_pos/rot_*). Render reads node state and does not know who wrote it. Same contract as physics2d <-> layout fields.',
      examples: ['physics3d', 'physics2d'],
      status: 'recurring',
    },
    {
      name: 'Doc-comment drift as a trap',
      purpose: ['maintenance'],
      description:
        'The module header confidently describes <3D.Physics> and Node.physics3d_world_id, neither of which exist. When auditing capability, trust grep over header comments.',
      examples: ['physics3d'],
      status: 'avoid',
    },
    {
      name: 'The bespoke-vs-library physics fork',
      purpose: ['physics', 'host_bridge'],
      description:
        'The repo revealed preference: cross the JS<->host bridge once per frame with a packed buffer (hmsc sim) rather than maintain per-body node bindings to a general engine. Any future real-physics effort should consciously choose reviving this module or extending the hmsc sim.',
      examples: ['physics3d', 'hmsc'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'physics3d is fully implemented but wired to nothing',
      purpose: ['physics', 'maintenance'],
      description:
        'The module is complete yet completely disconnected. Only physics3d.zig, physics3d_shim.h, physics3d_shim.cpp mention it; nothing imports phys/physics3d.zig. build.zig never compiles the cpp and never links Bullet (no has-physics3d gate, no sdk/dependency-registry.json entry). No JS primitive maps to it, no __phys3d_* host fn is registered. It has never been reachable from a cart in the V8 era.',
      evidence: [
        'physics3d.md: repo-wide grep excluding archive/tsz/love2d',
        'build.zig never compiles physics3d_shim.cpp, never links Bullet',
        'runtime/primitives.tsx <Physics> = 2D Box2D only',
      ],
      fix: 'Either wire it up (build gate, layout fields, engine plumbing, JS prop-mapper, implement heightfield) or declare it dead and delete all three files — a user decision.',
      severity: 'high',
    },
    {
      name: 'Stale/aspirational module header comment',
      purpose: ['physics', 'maintenance'],
      description:
        'The header comment ("Node.physics3d_world_id indexes into the world pool", "each <3D.Physics> gets its own world") describes wiring that does not exist — carried over from the Smith era. layout.zig Node has no physics3d_* fields.',
      evidence: ['physics3d.md: framework/layout.zig Node has no physics3d_* fields; comment is aspirational/stale'],
      fix: 'Trust grep over header comments; correct or remove the comment if the module is kept.',
      severity: 'high',
    },
    {
      name: 'heightfield collider shape stubbed to null',
      purpose: ['physics'],
      description:
        'heightfield is declared in the collider-shape enum but createBody returns null for it — never implemented. This is exactly the collider hmsc terrain needed, a key reason the game grew its own sim. plane is also hardcoded to ground (normal (0,1,0), offset 0).',
      evidence: ['physics3d.md: heightfield declared in enum but returns null'],
      fix: 'Implement via Bullet btHeightfieldTerrainShape if reviving, or it still cannot collide with hmsc terrain.',
      severity: 'medium',
    },
  ],
};
