import type { DocIndex } from '../types';

export const camera_lab: DocIndex = {
  name: 'camera_lab',
  file: 'camera_lab.md',
  cart: 'cart/camera_lab.tsx',
  purpose: ['camera', 'rendering', 'input', 'character', 'geometry'],
  summary:
    'A single-file cart showcasing the shared @reactjit/cameras rig system: it swaps drop-in camera components (Orbit/Follow/TopDown/Isometric/FirstPerson/FreeFly/Cinematic) over one static scene, where every rig resolves to a common Solved {pos,target,fov} that drives both rendering and screen-to-ground picking.',
  interfaces: [
    {
      name: 'CameraLab',
      purpose: ['camera', 'rendering', 'input'],
      kind: 'component',
      sourceFile: 'cart/camera_lab.tsx',
      codeRef: 'cart/camera_lab.tsx:208',
      description:
        'Cart entry and all cart-specific UI, scene, input, camera selection, texture generation, FreeFly movement, and picking. State: rig, orbit yaw/pitch, look yaw/pitch, sway toggle, marker, clock. Refs: rectRef, dragRef, keysRef, freeRef, and rig/lookYaw/lookPitch mirrors for the animation loop.',
      dependsOn: ['CAMERAS', 'solveCamera', 'unprojectGround', 'sway', 'Figure', 'PalmTree', 'busOn'],
      consumes: ['__keydown', '__keyup'],
      status: 'lab',
    },
    {
      name: 'Solved',
      purpose: ['camera'],
      kind: 'data_model',
      sourceFile: 'runtime/cameras/types.ts',
      description:
        'The shared resolved camera currency: { pos: Vec3; target: Vec3; fov: number }. Both rendering (Scene3D.Camera) and picking (unprojectGround) consume it, so click-to-ground works across all rigs without per-rig picking code.',
      status: 'live',
    },
    {
      name: 'Vec3 / Rect / CameraDef / Modifier',
      purpose: ['camera', 'math'],
      kind: 'data_model',
      sourceFile: 'runtime/cameras/types.ts',
      description:
        'Shared camera type vocabulary. Vec3 is a three-number tuple; CameraDef is a rig definition with stable id, pure solver, and defaults; Modifier is a pure Solved->Solved function.',
      status: 'live',
    },
    {
      name: 'solveCamera',
      purpose: ['camera'],
      kind: 'utility',
      sourceFile: 'runtime/cameras/index.tsx',
      codeRef: 'runtime/cameras/index.tsx:50',
      description:
        'Spreads params over rig defaults, calls the rig solver, then applies modifiers in order, returning Solved. Used by both rendering and picking.',
      status: 'live',
    },
    {
      name: 'CameraRig',
      purpose: ['camera', 'rendering'],
      kind: 'component',
      sourceFile: 'runtime/cameras/index.tsx',
      codeRef: 'runtime/cameras/index.tsx:60',
      description:
        'Generic component that solves the rig and emits one <Scene3D.Camera position={s.pos} target={s.target} fov={s.fov} />.',
      status: 'live',
    },
    {
      name: 'OrbitCamera / FollowCamera / TopDownCamera / IsometricCamera / FirstPersonCamera / FreeFlyCamera / CinematicCamera',
      purpose: ['camera'],
      kind: 'component',
      sourceFile: 'runtime/cameras/index.tsx',
      codeRef: 'runtime/cameras/index.tsx:65',
      description:
        'The seven named drop-in camera components wrapping CameraRig (index.tsx:65-71). The scene stays the same; only the camera child changes.',
      status: 'live',
    },
    {
      name: 'CAMERAS',
      purpose: ['camera'],
      kind: 'registry',
      sourceFile: 'runtime/cameras/index.tsx',
      codeRef: 'runtime/cameras/index.tsx:75',
      description:
        'Shared registry mapping rig names to CameraDef objects (index.tsx:75-77). This cart uses it for picking.',
      status: 'live',
    },
    {
      name: 'Orbit rig',
      purpose: ['camera'],
      kind: 'utility',
      sourceFile: 'runtime/cameras/rigs/orbit.ts',
      description:
        'Pure solver: third-person orbital eye around a target from yaw, pitch, distance, zoom, fov.',
      status: 'live',
    },
    {
      name: 'Follow rig',
      purpose: ['camera'],
      kind: 'utility',
      sourceFile: 'runtime/cameras/rigs/follow.ts',
      description:
        'Pure solver: positions the eye behind a subject heading and looks at subject plus look height.',
      status: 'live',
    },
    {
      name: 'TopDown rig',
      purpose: ['camera'],
      kind: 'utility',
      sourceFile: 'runtime/cameras/rigs/topDown.ts',
      description:
        'Pure solver: eye above a target with a small off-vertical tilt to avoid look-at singularity.',
      status: 'live',
    },
    {
      name: 'Isometric rig',
      purpose: ['camera'],
      kind: 'utility',
      sourceFile: 'runtime/cameras/rigs/isometric.ts',
      description:
        'Pure solver: fixed isometric elevation with long distance and narrow fov (ARPG/isometric style).',
      status: 'live',
    },
    {
      name: 'FirstPerson rig',
      purpose: ['camera'],
      kind: 'utility',
      sourceFile: 'runtime/cameras/rigs/firstPerson.ts',
      description:
        'Pure solver: eye = subject position plus eye height, looks forward by facing/pitch.',
      status: 'live',
    },
    {
      name: 'FreeFly rig',
      purpose: ['camera', 'debug'],
      kind: 'utility',
      sourceFile: 'runtime/cameras/rigs/freeFly.ts',
      description:
        'Pure solver: uses the supplied position as the eye and looks forward by yaw/pitch (spectator/debug camera).',
      status: 'live',
    },
    {
      name: 'Cinematic rig',
      purpose: ['camera'],
      kind: 'utility',
      sourceFile: 'runtime/cameras/rigs/cinematic.ts',
      description:
        'Pure solver: picks film-style shots over time and returns the shot camera. Source notes camera roll as a framework gap.',
      status: 'live',
    },
    {
      name: 'unprojectGround',
      purpose: ['camera', 'interaction'],
      kind: 'utility',
      sourceFile: 'runtime/cameras/unproject.ts',
      codeRef: 'runtime/cameras/unproject.ts:16',
      description:
        'Generic screen-to-ground picking from Solved: reconstructs the view basis, creates a world ray from screen position and fov, marches against a height function, then bisects the hit. Default height function is y=0. Returns {x, y} where returned y is world z.',
      status: 'live',
    },
    {
      name: 'sway',
      purpose: ['camera'],
      kind: 'utility',
      sourceFile: 'runtime/cameras/modifiers.ts',
      codeRef: 'runtime/cameras/modifiers.ts:15',
      description:
        'Pure Solved->Solved modifier: orbits slightly around the target, pulses distance and height. Reads no globals; the cart owns the time input. Composes after rig solving.',
      status: 'live',
    },
    {
      name: 'useSmoothed',
      purpose: ['camera'],
      kind: 'hook',
      sourceFile: 'runtime/cameras/index.tsx',
      description:
        'Camera smoothing hook exported from runtime/cameras/index.tsx but not used by this cart.',
      status: 'dormant',
    },
    {
      name: 'busOn',
      purpose: ['input', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/useIFTTT.ts',
      description:
        'busOn(event, fn) is a facade over the shared FFI event bus subscribe. This cart subscribes to __keydown and __keyup for keyboard state.',
      consumes: ['__keydown', '__keyup'],
      status: 'live',
    },
    {
      name: 'buildHumanoidAtlasTexture',
      purpose: ['character', 'texture_bake', 'asset_pipeline'],
      kind: 'utility',
      sourceFile: 'cart/camera_lab.tsx',
      codeRef: 'cart/camera_lab.tsx:50',
      description:
        'Builds a procedural 64x64 RGBA texture object { width, height, hex } (8 hex chars per pixel, RRGGBBAA). Targets Geometry.HUMANOID_ATLAS quadrants (head/arms/torso/legs); paints skin, shirt, pants, eyes, hair band, brows, nose shadow, mouth, collar. Pure JS, no file IO.',
      status: 'lab',
    },
    {
      name: 'HUMANOID_TEXTURE',
      purpose: ['character', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/camera_lab.tsx',
      codeRef: 'cart/camera_lab.tsx:122',
      description:
        'The generated atlas texture stored once at module load (line 122), passed to the one-piece Geometry.Humanoid via the texture prop on Scene3D.Mesh.',
      status: 'lab',
    },
    {
      name: 'Geometry.Humanoid',
      purpose: ['character', 'geometry'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/Humanoid.ts',
      description:
        'The authored single-mesh one-piece humanoid and its atlas layout. A cleaner reusable avatar shape than manually stacking primitives; rendered with HUMANOID_TEXTURE.',
      status: 'live',
    },
    {
      name: 'HUMANOID',
      purpose: ['character', 'geometry'],
      kind: 'data_model',
      sourceFile: 'cart/camera_lab.tsx',
      codeRef: 'cart/camera_lab.tsx:132',
      description:
        'Local parts-array figure: 18 PartRow mesh parts (2 cylinder legs, 2 sphere shoes, box torso, torus belt, 2 sphere shoulders, 2 cylinder arms, 2 sphere hands, cylinder neck, sphere head, 2 box eyes, cone nose, cone hat). No animation; exists to contrast with the one-piece humanoid.',
      status: 'lab',
    },
    {
      name: 'Figure',
      purpose: ['character', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/camera_lab.tsx',
      codeRef: 'cart/camera_lab.tsx:155',
      description:
        'Maps each PartRow to a Scene3D.Mesh applying geometry, params, material, position=add(position, offset), rotation. The parts-based humanoid figure.',
      status: 'lab',
    },
    {
      name: 'PalmTree',
      purpose: ['rendering', 'geometry'],
      kind: 'component',
      sourceFile: 'cart/camera_lab.tsx',
      codeRef: 'cart/camera_lab.tsx:172',
      description:
        'Simple two-mesh prop (cylinder trunk + cone crown) using the same add(position, localOffset) pattern as Figure.',
      status: 'lab',
    },
    {
      name: 'RIGS / RigName',
      purpose: ['camera'],
      kind: 'registry',
      sourceFile: 'cart/camera_lab.tsx',
      codeRef: 'cart/camera_lab.tsx:182',
      description:
        'Local ordered toolbar list of rig names (Orbit/Follow/TopDown/Isometric/FirstPerson/FreeFly/Cinematic); RigName (line 183) is the union derived from it.',
      status: 'lab',
    },
    {
      name: 'ANIMATED / LOOK_RIG / BLURB / TARGET',
      purpose: ['camera', 'ui'],
      kind: 'registry',
      sourceFile: 'cart/camera_lab.tsx',
      codeRef: 'cart/camera_lab.tsx:186',
      description:
        'Local per-rig maps: ANIMATED (line 186) marks rigs needing an autonomous clock (Follow/FreeFly/Cinematic true); LOOK_RIG (line 191) marks rigs where drag drives look yaw/pitch (FirstPerson/FreeFly true); BLURB (line 196) one explanatory line per rig; TARGET (line 206) is [0,1,0] chest-level look point.',
      status: 'lab',
    },
    {
      name: 'paramsFor',
      purpose: ['camera'],
      kind: 'utility',
      sourceFile: 'cart/camera_lab.tsx',
      codeRef: 'cart/camera_lab.tsx:231',
      description:
        'Maps a local rig name to that rig parameter object (all angles in degrees): per-rig target/distance/height/tilt/fov etc.',
      status: 'lab',
    },
  ],
  patterns: [
    {
      name: 'Solved is the reusable camera currency',
      purpose: ['camera', 'interaction'],
      description:
        'Rendering and picking both consume the resolved Solved {pos,target,fov}. Picking should depend on resolved camera data, not rig identity, so click-to-ground works across all rigs.',
      examples: ['camera_lab', 'ragdoll_lab'],
      status: 'recurring',
    },
    {
      name: 'Pure-solver rigs swappable over one scene',
      purpose: ['camera'],
      description:
        'Each rig is a pure solver and can be swapped without changing scene code; the drop-in camera component is the only child that changes.',
      examples: ['camera_lab'],
      status: 'recurring',
    },
    {
      name: 'Modifiers compose after solving',
      purpose: ['camera'],
      description:
        'Pure Solved->Solved modifiers like sway compose after rig solving and read no globals; the cart owns the time input.',
      examples: ['camera_lab'],
      status: 'recurring',
    },
    {
      name: 'Memoized static scene under a changing camera',
      purpose: ['rendering', 'camera'],
      description:
        'useMemo([]) keeps the mesh element tree stable while camera state changes, reducing geometry shipping across the V8/Zig bridge. Geometry interning also dedupes generator output by key.',
      examples: ['camera_lab', 'input_bench', 'ragdoll_lab'],
      status: 'recurring',
    },
    {
      name: 'Input split by intent',
      purpose: ['input', 'camera'],
      description:
        'Pressable pointer events drive drag/tap; bus events (__keydown/__keyup) carry keyboard state. The cart does not use the isKeyDown host function.',
      examples: ['camera_lab'],
      status: 'recurring',
    },
    {
      name: 'Stale-closure dodge via mirrored refs',
      purpose: ['camera', 'game_loop'],
      description:
        'rigRef/lookYawRef/lookPitchRef mirror state so the animation loop reads current values without stale-closure problems.',
      examples: ['camera_lab', 'ragdoll_lab', 'input_bench'],
      status: 'recurring',
    },
    {
      name: 'JS-side FreeFly movement',
      purpose: ['camera', 'input', 'debug'],
      description:
        'A debug/spectator camera whose eye position is moved JavaScript-side from key state (W/S along look dir, A/D strafe, E/Space up, Q/Shift down, speed 11*dt), separate from character control.',
      examples: ['camera_lab'],
      status: 'recurring',
    },
    {
      name: 'Procedural atlas character texture',
      purpose: ['character', 'texture_bake', 'asset_pipeline'],
      description:
        'A procedural RGBA hex texture is enough to test textured character meshes without external assets.',
      examples: ['camera_lab'],
      status: 'recurring',
    },
    {
      name: 'Two humanoid construction strategies',
      purpose: ['character', 'geometry'],
      description:
        'Parts-based figure (18 stacked primitive meshes) vs one authored Geometry.Humanoid mesh with an atlas texture; the one-piece humanoid is the cleaner reusable avatar.',
      examples: ['camera_lab'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'Thin box ground, not a plane',
      purpose: ['rendering', 'camera'],
      description:
        'The ground uses a thin Geometry.Box at y=-0.1, not a plane, because top-down cameras back-face-cull a single-sided plane (black ground). Top-down rigs need ground that renders from above.',
      evidence: ['The ground uses a thin Geometry.Box, not a plane. The source comment says this avoids top-down back-face culling.'],
      severity: 'medium',
    },
    {
      name: 'Modifier keys not normal key names',
      purpose: ['input'],
      description:
        'Shift/Ctrl/Alt do not arrive as normal key names in the event payload; setk tracks them as __shift/__ctrl/__alt flags instead. Reading them as "shift"/"ctrl"/"alt" key names fails.',
      evidence: ['setk … tracks modifier flags as __shift, __ctrl, and __alt, because Shift/Ctrl/Alt do not arrive as normal key names in this event payload (camera_lab.tsx:255-261)'],
      severity: 'medium',
    },
    {
      name: 'unprojectGround returns world z as y',
      purpose: ['camera', 'interaction'],
      description:
        'unprojectGround returns {x, y} where the returned y corresponds to world z. The marker is placed at [marker.x, 0.06, marker.y]. Treating the returned y as world height plants the marker wrong.',
      evidence: ['It returns { x, y }, where returned y corresponds to world z (unproject.ts:16-82)'],
      severity: 'medium',
    },
    {
      name: 'useSmoothed exported but unused',
      purpose: ['camera', 'maintenance'],
      description:
        'useSmoothed exists in runtime/cameras/index.tsx but is not used by this cart; the cart does cart-side target smoothing in ragdoll_lab instead. Dormant export.',
      evidence: ['useSmoothed exists in runtime/cameras/index.tsx but is not used here'],
      severity: 'low',
    },
    {
      name: 'rAF absent; setTimeout fallback',
      purpose: ['camera', 'game_loop'],
      description:
        'The animation loop uses globalThis.requestAnimationFrame if available, otherwise setTimeout(fn,16); on this host rAF is absent. dt is clamped to a max of 0.05s.',
      evidence: ['uses globalThis.requestAnimationFrame if available, otherwise setTimeout(fn, 16); computes dt and clamps it to a maximum of 0.05 seconds'],
      severity: 'low',
    },
    {
      name: 'Cinematic rig has no roll support',
      purpose: ['camera'],
      description:
        'The cinematic rig source notes camera roll as a framework gap; no camera roll support exists.',
      evidence: ['No camera roll support; the cinematic rig source notes this as a framework gap.'],
      severity: 'low',
    },
  ],
};
