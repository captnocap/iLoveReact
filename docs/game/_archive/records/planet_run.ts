import type { DocIndex } from '../types';

export const planet_run: DocIndex = {
  name: 'planet_run',
  file: 'planet_run.md',
  cart: 'cart/planet_run/index.tsx',
  purpose: ['game_loop', 'character', 'camera', 'shader', 'world_gen', 'animation'],
  loc: 720,
  summary:
    'A complete coin-rush mini-game whose central trick is that the player never moves: they walk in place at the north pole of a small planet and the entire world — a shader-textured Globe plus every tree, rock, tuft and coin pinned to it — rolls underneath via an accumulated quaternion.',
  interfaces: [
    {
      name: 'FollowCamera',
      purpose: ['camera'],
      kind: 'component',
      sourceFile: 'runtime/cameras/rigs/follow.ts',
      codeRef: 'runtime/cameras/index.tsx:66',
      description:
        'Chase rig from @reactjit/cameras (pure solve(params)) trailing the heading at distance 5.8, height 2.9, half-tracking the hop; the first surveyed cart using the cameras registry instead of hand-rolled trig.',
      consumers: ['planet_run'],
      status: 'live',
    },
    {
      name: 'PLANET_WGSL',
      purpose: ['shader', 'world_gen', 'texture_bake'],
      kind: 'shader',
      sourceFile: 'cart/planet_run/index.tsx',
      description:
        'An fbm continents/ocean/ice-caps fragment shader baked ONCE (512×256 equirect) inside a StaticSurface; longitude fed as cos/sin so u=0 and u=1 match (no back seam); all helpers wear a pr_ prefix to avoid colliding with the prepended effect_math.wgsl library.',
      status: 'live',
    },
    {
      name: 'terrainAt',
      purpose: ['world_gen', 'math'],
      kind: 'utility',
      sourceFile: 'cart/planet_run/index.tsx',
      description:
        'JS mirror of the shader noise (prHash/prVnoise/prFbm + the Globe-unwrap inverse phi=π/2−2πu) answering "is this direction on land?" so props only spawn on continents that visibly exist on the baked texture.',
      status: 'live',
    },
    {
      name: 'eulerYXZ',
      purpose: ['math', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/planet_run/index.tsx',
      description:
        'Decomposes the planet quaternion\'s matrix to euler degrees in exactly the host\'s mesh-rotation order (model = T·Ry·Rx·Rz·S per 3d.zig makeInstance), so the planet mesh takes rotation={planetEuler} like any mesh with no host quaternion support.',
      status: 'live',
    },
    {
      name: 'quatAxisAngle/quatMul/quatNormalize/quatRotate',
      purpose: ['math', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/planet_run/index.tsx',
      description:
        'The cart\'s own ~100-line quaternion/matrix library: walking pre-multiplies quatAxisAngle onto q to roll the surface backward; surface objects stored as planet-local unit dirs are rotated by q each frame.',
      status: 'live',
    },
    {
      name: 'alignRotation',
      purpose: ['math', 'rendering'],
      kind: 'utility',
      sourceFile: 'cart/planet_run/index.tsx',
      description: 'Points a mesh +Y along the surface normal at a given world direction.',
      status: 'live',
    },
    {
      name: 'coinRotation',
      purpose: ['math', 'rendering'],
      kind: 'utility',
      sourceFile: 'cart/planet_run/index.tsx',
      description:
        'Upright disc spun about the normal: align · Ry(spin) · Rz(90°) composed in 3×3 land then decomposed via eulerYXZ.',
      status: 'live',
    },
    {
      name: 'generateWorld',
      purpose: ['world_gen'],
      kind: 'utility',
      sourceFile: 'cart/planet_run/index.tsx',
      description:
        'Re-run via useMemo on seed change (R rerolls): seededRandom PRNG + randomDir, rejection-sampling scatter for coins/trees/rocks/tufts past the terrainAt land bar with pole/spacing/crowding guards; also generates the character. A new seed = a new planet AND a new person.',
      dependsOn: ['terrainAt', 'seededRandom', 'generateFace'],
      status: 'live',
    },
    {
      name: 'seededRandom',
      purpose: ['world_gen', 'math'],
      kind: 'utility',
      sourceFile: 'cart/planet_run/index.tsx',
      description: 'A mulberry32-style integer-mixing PRNG (Math.imul xorshift) so each seed is a reproducible planet.',
      status: 'live',
    },
    {
      name: 'buildRigFrame',
      purpose: ['character', 'animation'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'head_lab\'s dressed-rig builder, called buildRigFrame(\'neutral\', pose, rigPhase, actions, \'armor\', \'plain\', [], \'slacks\'); gait pose and DSL actions compose into one action list.',
      consumers: ['planet_run', 'head_lab', 'ragdoll_lab'],
      status: 'live',
    },
    {
      name: 'FigureMeshes',
      purpose: ['character', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/head_lab/figureRender.tsx',
      description: 'Renders the rig part meshes inside the Scene3D with rig/parts/yawDeg/lift.',
      consumers: ['planet_run', 'head_lab', 'ragdoll_lab'],
      status: 'live',
    },
    {
      name: 'CharacterCaptures',
      purpose: ['character', 'texture_bake'],
      kind: 'component',
      sourceFile: 'cart/head_lab/figureRender.tsx',
      description:
        'Parked in the 2D tree, bakes the offscreen face-unwrap + skin StaticSurface the part meshes sample (headTexKey/skinTexKey) — same contract as hmsc\'s HumanoidFaceCaptures, different kit.',
      consumers: ['planet_run', 'head_lab'],
      status: 'live',
    },
    {
      name: 'buildPartRender',
      purpose: ['character', 'rendering'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/figureRender.tsx',
      description: 'Produces per-part Globe params + dyn/texture keys from a face doc + depth map.',
      consumers: ['planet_run', 'head_lab'],
      status: 'live',
    },
    {
      name: 'generateFace',
      purpose: ['character', 'world_gen'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/hed.ts',
      description: 'generateFace(seed, {style}) → face document; paired with hedDepthGrid for the depth map.',
      consumers: ['planet_run', 'head_lab'],
      status: 'live',
    },
    {
      name: 'hedDepthGrid',
      purpose: ['character', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/hed.ts',
      description: 'Builds the face depth map fed into buildPartRender.',
      consumers: ['planet_run', 'head_lab'],
      status: 'live',
    },
    {
      name: 'parseAnimationDsl',
      purpose: ['animation', 'scripting'],
      kind: 'dsl',
      sourceFile: 'cart/animationDsl.ts',
      description:
        'Parses one-line declarative timelines (e.g. \'[0.5,right_arm,lift_and_bend;0.5,right_fist,clench]\') at module scope; head_lab\'s animDsl.ts is a pure re-export shim.',
      consumers: ['planet_run', 'head_lab'],
      status: 'live',
    },
    {
      name: 'sampleAnimationTimeline',
      purpose: ['animation', 'scripting'],
      kind: 'dsl',
      sourceFile: 'cart/animationDsl.ts',
      description:
        'Samples a parsed timeline at t−eventStart and merges the actions into buildRigFrame\'s action list, so gameplay events (fist pump, win dance, defeat sit) drive the rig.',
      consumers: ['planet_run', 'head_lab'],
      status: 'live',
    },
    {
      name: 'animDsl (re-export shim)',
      purpose: ['animation', 'maintenance'],
      kind: 'import',
      sourceFile: 'cart/head_lab/animDsl.ts',
      description: 'Pure re-export of cart/animationDsl.ts; the real module is animationDsl.ts.',
      consumers: ['planet_run'],
      status: 'live',
    },
    {
      name: 'busOn',
      purpose: ['input', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/useIFTTT.ts',
      description:
        'Subscribes to __keydown/__keyup; keysRef map (plus a __shift synthetic) is polled by the tick; restart keys fire on keydown directly through beginRoundRef (latest-closure ref).',
      consumes: ['__keydown', '__keyup'],
      consumers: ['planet_run'],
      status: 'live',
    },
    {
      name: 'Globe',
      purpose: ['geometry', 'rendering'],
      kind: 'geometry',
      sourceFile: 'runtime/geometries',
      description:
        'The planet mesh, equirect-unwrapped to match the shader bake (phi=π/2−2πu); sampled by the baked planet texture via textureKey and rotated by planetEuler.',
      consumers: ['planet_run'],
      status: 'live',
    },
    {
      name: 'Scene3D.Fog',
      purpose: ['rendering'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      description:
        'Used as <Scene3D.Fog enabled={false} /> — the only off switch for the always-on distance fog; correct here so the planet stays crisp against space.',
      consumers: ['planet_run'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Move-the-world-not-the-player',
      purpose: ['game_loop', 'world_gen'],
      description:
        'The player is fixed at the origin/pole; world state is one transform (a quaternion here) everything else derives from — the sphere-world variant of hmsc\'s flat "world flows past".',
      examples: ['planet_run', 'hmsc'],
      status: 'recurring',
    },
    {
      name: 'Quaternion accumulate → euler extract matched to host order',
      purpose: ['math', 'geometry'],
      description:
        'JS owns orientation as a quat and converts to YXZ-degree eulers because the host rotation prop is the only interface; the YXZ order knowledge (3d.zig T·Ry·Rx·Rz·S) is load-bearing and lives only in cart comments.',
      examples: ['planet_run'],
      promoteTo: 'eulerYXZ',
      status: 'promote',
    },
    {
      name: 'Shader/JS twin terrain',
      purpose: ['shader', 'world_gen'],
      description:
        'Bake terrain in WGSL, hand-mirror the noise in JS for gameplay queries (spawn-on-land) — the see-it==walk-it contract, lab-grade; hmsc solved the same host-side with one height fn in mesh AND collider.',
      examples: ['planet_run', 'hmsc'],
      status: 'recurring',
    },
    {
      name: 'Bake-once StaticSurface',
      purpose: ['shader', 'texture_bake', 'rendering'],
      description:
        'Memo\'d capture component + useMemo\'d data/style so the surface bakes once and never again — the disciplined opposite of billboard_demo\'s animate-by-rebake, obeying static_surface_inline_props_rebake.',
      examples: ['planet_run', 'billboard_demo'],
      status: 'recurring',
    },
    {
      name: 'Sim-in-ref + dummy setTick',
      purpose: ['game_loop'],
      description:
        'Mutable sim object in a ref, one state-bump per tick to trigger render, all view math derived inline per render — THE cart game-loop state shape.',
      examples: ['planet_run', 'massive_map_lab', 'physics_lab'],
      status: 'recurring',
    },
    {
      name: 'keysRef polled by tick',
      purpose: ['input', 'game_loop'],
      description:
        '__keydown/__keyup bus → boolean map in a ref → the loop polls; discrete actions (restart) fire on the event itself through a latest-closure ref (the Pressable-stale-closure defense applied to bus handlers).',
      examples: ['planet_run', 'physics_lab'],
      status: 'recurring',
    },
    {
      name: 'Seeded PRNG + rejection-sampling scatter',
      purpose: ['world_gen', 'math'],
      description:
        'A Math.imul mixer seeded for reproducible worlds; placement = loop {random candidate, reject by pole/spacing/land/crowding} with a guard counter.',
      examples: ['planet_run'],
      status: 'recurring',
    },
    {
      name: 'Animation-DSL event riding',
      purpose: ['animation', 'scripting'],
      description:
        'Gameplay events record a start time; render samples timeline(t−start) and merges into the rig — declarative one-string animations as game feedback.',
      examples: ['planet_run'],
      status: 'recurring',
    },
    {
      name: 'rAF-probe / setTimeout-16',
      purpose: ['game_loop'],
      description: 'Fourth consecutive cart; universal — requestAnimationFrame if present else setTimeout(16).',
      examples: ['planet_run', 'physics_lab'],
      status: 'recurring',
    },
    {
      name: 'Fragment-for-multi-mesh under Scene3D',
      purpose: ['rendering'],
      description:
        'Multi-mesh world objects (tree trunk+canopy) must be Fragments under Scene3D, never wrapper Views — the 3D pass reads meshes off the scene\'s DIRECT children, so a wrapper hides both meshes.',
      examples: ['planet_run'],
      status: 'recurring',
    },
    {
      name: 'Diegetic 3D UI',
      purpose: ['ui', 'rendering'],
      description: 'The compass is a mesh in the scene positioned by gameplay math (bearing of nearest coin), not a HUD element.',
      examples: ['planet_run'],
      status: 'recurring',
    },
    {
      name: 'Phase state machine + overlay-last',
      purpose: ['ui', 'game_loop'],
      description:
        'A ready/playing/won/lost enum with full-screen translucent phase overlays rendered as the root\'s final children per the overlays-last hit-test rule.',
      examples: ['planet_run'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'Shader/JS terrain twin silently lies if one side edited',
      purpose: ['shader', 'world_gen', 'maintenance'],
      description:
        'prHash/prVnoise/prFbm/terrainAt in JS mirror the shader math exactly including the Globe-unwrap inverse; the shader is source of truth, the JS a hand-kept copy — edit one side and the other silently lies (props spawn off the visible land).',
      evidence: ['planet_run.md "edit one side and the other silently lies"'],
      fix: 'Keep both noise implementations in lockstep; ideally share one source.',
      severity: 'high',
    },
    {
      name: 'pr_ prefix required on all shader helpers',
      purpose: ['shader'],
      description:
        'The Effect pipeline prepends the shared effect_math.wgsl library (fbm/snoise/voronoi/...); a bare fn fbm redefinition hard-crashes shader-module creation, so all helpers wear a pr_ prefix.',
      evidence: ['planet_run.md "Namespace collision rule"', 'framework/gpu/effect_math.wgsl'],
      severity: 'high',
    },
    {
      name: 'YXZ euler order knowledge lives only in cart comments',
      purpose: ['math', 'geometry', 'maintenance'],
      description:
        'eulerYXZ must decompose to YXZ degrees in exactly the host order model=T·Ry·Rx·Rz·S (3d.zig makeInstance); this load-bearing order knowledge is duplicated in cart-side comments, not a shared utility.',
      evidence: ['planet_run.md "the YXZ order knowledge (3d.zig T·Ry·Rx·Rz·S) is load-bearing and currently lives in cart-side comments"'],
      severity: 'medium',
    },
    {
      name: 'Whole scene re-renders every ~16ms',
      purpose: ['rendering', 'game_loop'],
      description:
        'The dummy setTick recomputes ~50 meshes\' props per frame; fine at this scale but the pattern the baked-world direction (feedback_react_3d_is_authoring_not_runtime) exists to outgrow.',
      evidence: ['planet_run.md "The whole scene re-renders every ~16 ms"'],
      severity: 'low',
    },
    {
      name: 'Module-scope DSL parse crashes at load on syntax error',
      purpose: ['animation', 'scripting'],
      description:
        'parseAnimationDsl calls run at bundle eval (module scope) — cheap, but a DSL syntax error crashes at load, not at use.',
      evidence: ['planet_run.md "a DSL syntax error crashes at load, not at use"'],
      severity: 'low',
    },
    {
      name: 'Two humanoid systems split now load-bearing in two shipped surfaces',
      purpose: ['character', 'maintenance'],
      description:
        'The repo has hmsc render3d/humanoid (hmsc + its labs) and head_lab figureRender (planet_run, ragdoll_lab, head_lab); this cart is the head_lab kit\'s reference consumer. A consolidation flag.',
      evidence: ['planet_run.md "two humanoid systems" caveat'],
      severity: 'medium',
    },
    {
      name: 'No collision with props',
      purpose: ['physics'],
      description: 'Trees and rocks are scenery you walk through; coins are the only interactive surface objects. Hop is ~5 lines of in-cart ballistics, no host physics.',
      evidence: ['planet_run.md "No collision with props"'],
      severity: 'low',
    },
    {
      name: 'space key-name uncertainty fallbacks',
      purpose: ['input'],
      description:
        'keys.space/keys.spacebar fallbacks (primary is \' \') suggest uncertainty about the host\'s key-name for space; harmless belt-and-suspenders.',
      evidence: ['planet_run.md "keys.space/keys.spacebar fallbacks"'],
      severity: 'low',
    },
    {
      name: 'figureYaw = headingDeg + 180 (parts face −Z at yaw 0)',
      purpose: ['character', 'rendering'],
      description: 'figureYaw adds 180° because head_lab parts face −Z at yaw 0; a coordinate-convention gotcha when reusing the kit.',
      evidence: ['planet_run.md "figureYaw = headingDeg + 180 because parts face −Z at yaw 0"'],
      severity: 'low',
    },
    {
      name: 'Import-path variant @reactjit/runtime/primitives',
      purpose: ['maintenance'],
      description:
        'This cart imports @reactjit/runtime/primitives (full path) where other carts write @reactjit/primitives; both resolve through the --alias:@reactjit=runtime catch-all but the inconsistency is worth noting.',
      evidence: ['planet_run.md "Import-path variant worth noting"'],
      severity: 'low',
    },
  ],
};
