import type { DocIndex } from '../types';

export const bodylab: DocIndex = {
  name: 'bodylab',
  file: 'bodylab.md',
  cart: 'cart/bodylab/index.tsx',
  purpose: ['character', 'animation', 'geometry', 'rendering', 'camera'],
  summary:
    'A character body-type explorer that displays six stylized humanoid figures side-by-side, each built from the same parametric skeleton with different proportions/palettes/head styles/accessories, demonstrating the primitive-cluster approach: a character is many individual Scene3D.Mesh nodes positioned and rotated each frame by a parametric solver rather than one baked Geometry.Humanoid mesh.',
  interfaces: [
    {
      name: 'FigureDef',
      purpose: ['character'],
      kind: 'data_model',
      sourceFile: 'cart/bodylab/index.tsx',
      codeRef: 'cart/bodylab/index.tsx:43',
      description:
        'A figure descriptor: {id, label, desc, proportions: BodyProportions, palette: HumanoidPalette}. Six figures (samir/daniel/theo/maya/rosa/nia) are defined inline (lines 43-329), each spreading DEFAULT_PROPORTIONS and overriding specific fields.',
      dependsOn: ['BodyProportions', 'HumanoidPalette'],
      status: 'lab',
    },
    {
      name: 'BodyProportions',
      purpose: ['character', 'geometry'],
      kind: 'data_model',
      sourceFile: 'cart/bodylab/humanoid.tsx',
      description:
        'A flat struct of ~20 numbers defining a character\'s skeletal proportions: silhouette widths (shoulder/hip/leg), vertical joint heights (hip/shoulder/neck/headCenter/hat), torso dims, limb segment lengths (thigh/shin/upperArm/foreArm), radius multipliers (head/limb/joint/foot), female-form volume spheres (chest/butt), waist taper, plus headStyle and modelStyle enums.',
      status: 'lab',
    },
    {
      name: 'HumanoidPalette / MaterialSlot',
      purpose: ['character', 'color'],
      kind: 'data_model',
      sourceFile: 'cart/bodylab/humanoid.tsx',
      description:
        'A color map keyed by semantic MaterialSlot (skin, shirt, pants, shoe, hat, hair, eye, belt, nose, marker, accent, metal, trim). The palette maps slots to hex colors; HumanoidFigure resolves material from palette[slot] with fallback to palette.shirt.',
      status: 'lab',
    },
    {
      name: 'drivePose',
      purpose: ['animation', 'character'],
      kind: 'utility',
      sourceFile: 'cart/bodylab/humanoid.tsx',
      codeRef: 'cart/bodylab/humanoid.tsx:218',
      description:
        'drivePose(t, moving, running): a pure function converting animation time into a HumanoidPose (rootPitch/bodyY/torsoLean/headNod, per-leg/knee/arm angles, armLift). moving=false returns a static idle pose; moving=true computes a sinusoidal gait (legs swing oppositely, knees bend on back-swing, arms swing opposite legs, body bobs, torso leans forward, head nods counter to the bounce). phase = t*5.0 (walk) or t*8.6 (run).',
      status: 'lab',
    },
    {
      name: 'solveHumanoid',
      purpose: ['character', 'geometry', 'animation'],
      kind: 'utility',
      sourceFile: 'cart/bodylab/humanoid.tsx',
      codeRef: 'cart/bodylab/humanoid.tsx:263',
      description:
        'The rig solver: solveHumanoid(base, yawDegrees, pose, prop) -> {parts: RigPart[], eye: Vec3Tuple}. Computes joint world positions, solves limb segments (thigh/shin/upperArm/foreArm), then pushes a flat array of RigPart objects (legs, optional female butt/chest volumes, torso, waist, arms, head, head-style cluster, model-style accessories). All positions transformed by yawRadians + rootPitch. Uses math helpers radians/degrees/add/rotateY/rotateX/orient/point/downDirection/segmentPose/limbPart.',
      dependsOn: ['drivePose', 'BodyProportions'],
      status: 'lab',
    },
    {
      name: 'RigPart',
      purpose: ['character', 'geometry', 'rendering'],
      kind: 'data_model',
      sourceFile: 'cart/bodylab/humanoid.tsx',
      description:
        'A single body part descriptor: {geometry: GeometryDef, params, position: Vec3Tuple, rotation?: Vec3Tuple, slot: MaterialSlot}. Geometries come from @reactjit/geometries: Box, Sphere, Cylinder, Cone, Torus.',
      dependsOn: ['MaterialSlot'],
      status: 'lab',
    },
    {
      name: 'HumanoidFigure',
      purpose: ['character', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/bodylab/humanoid.tsx',
      codeRef: 'cart/bodylab/humanoid.tsx:796',
      description:
        'The React renderer: takes {rig, palette, marker} and emits one Scene3D.Mesh per RigPart (material from palette[slot] with shirt fallback). Optional marker is a ground selection ring (cylinder + torus). Keys parts by array index — stable enough because the parts array is rebuilt every frame.',
      dependsOn: ['solveHumanoid', 'HumanoidPalette'],
      consumes: ['Scene3D.Mesh'],
      status: 'lab',
    },
    {
      name: 'BodyLab',
      purpose: ['ui', 'camera', 'rendering', 'animation'],
      kind: 'component',
      sourceFile: 'cart/bodylab/index.tsx',
      codeRef: 'cart/bodylab/index.tsx:339',
      description:
        'Main component: owns selection/moving/autoRotate/orbitYaw/orbitPitch/dist/clock state; camera controls (orbit drag, scroll zoom [4,22], auto-rotate at 12 deg/sec, reset, selection drift via smoothTargetX easing); a memoized staticScene (lights + ground slab + per-figure platform cylinders); and per-frame renders 6 HumanoidFigures with phase-offset (i*0.85) gaits at yaw 180.',
      dependsOn: ['drivePose', 'solveHumanoid', 'HumanoidFigure', 'OrbitCamera'],
      status: 'lab',
    },
    {
      name: 'OrbitCamera / Orbit rig',
      purpose: ['camera'],
      kind: 'component',
      sourceFile: 'runtime/cameras/rigs/orbit.ts',
      codeRef: 'runtime/cameras/index.tsx',
      description:
        'Camera rig from @reactjit/cameras solving eye position from target + yaw + pitch + dist. Targets [smoothTargetX.current, 1.15, 0] for selection drift.',
      consumers: ['cart/bodylab/index.tsx', 'cart/head_lab', 'cart/carve_lab'],
      status: 'live',
    },
    {
      name: 'internGeometry',
      purpose: ['geometry', 'rendering'],
      kind: 'utility',
      sourceFile: 'runtime/geometries/intern.ts',
      description:
        'JS-side geometry interning: isGeometryDef() gates, internGeometry(geometry, params) computes a stable key so identical body parts (all eyes Box same size, all thighs Cylinder similar radius) share vertex buffers across the bridge; both JS cache and host GPU cache deduplicate heavily. Transform props (position/rotation) still cross the bridge every frame for every moving part.',
      consumers: ['cart/bodylab/humanoid.tsx'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Primitive-cluster character',
      purpose: ['character', 'geometry', 'rendering'],
      description:
        'A character built from many small primitive meshes (spheres, cylinders, boxes, cones, tori) positioned by a solver, rather than a single baked mesh (Geometry.Humanoid). Enables dynamic posing; costs more bridge nodes and draw calls (~30-50 parts/figure, ~180-300 mesh nodes for 6 figures).',
      examples: ['bodylab'],
      promoteTo: 'solveHumanoid',
      status: 'recurring',
    },
    {
      name: 'Pure pose function -> solver -> renderer',
      purpose: ['animation', 'character', 'rendering'],
      description:
        'drivePose (time -> joint angles) -> solveHumanoid (proportions+pose+yaw -> RigPart[] world transforms) -> HumanoidFigure (RigPart[] -> Scene3D.Mesh). A pure-function pipeline decoupling gait, rig, and render. Parallels head_lab\'s bones-as-interface but with its own data model (no skeleton record shared).',
      examples: ['bodylab', 'head_lab'],
      status: 'recurring',
    },
    {
      name: 'Phase-offset gaits',
      purpose: ['animation'],
      description: 'Each figure adds i*0.85 to the animation clock so their gaits desynchronize and they do not march in lockstep.',
      examples: ['bodylab'],
      status: 'recurring',
    },
    {
      name: 'smoothTargetX ref-drift camera',
      purpose: ['camera', 'rendering'],
      description:
        'A useRef exponentially eases toward the selected figure\'s X (read directly in render, not via state) so the camera drifts without per-frame re-renders; the clock state from the rAF loop drives the actual re-render.',
      examples: ['bodylab'],
      status: 'recurring',
    },
    {
      name: 'rAF-or-setTimeout game clock',
      purpose: ['animation', 'game_loop'],
      description:
        'requestAnimationFrame with a setTimeout(16) fallback, dt from performance.now()/Date.now() clamped to 50ms to avoid spiral on lag; increments clock state each frame; effect re-binds only when autoRotate changes (alive flag handles cleanup).',
      examples: ['bodylab'],
      status: 'recurring',
    },
    {
      name: 'useMemo static scene',
      purpose: ['rendering'],
      description:
        'Lights and ground wrapped in useMemo([], ...) so they never rebuild their React subtree every frame; only emit transform props once.',
      examples: ['bodylab'],
      status: 'recurring',
    },
    {
      name: 'Geometry interning for shared vertex buffers',
      purpose: ['geometry', 'rendering'],
      description:
        'Identical (geometry, params) pairs cache to a stable key so repeated body parts share vertex buffers across the bridge and on the GPU; only transform props cross per frame.',
      examples: ['bodylab'],
      promoteTo: 'internGeometry',
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'array-index keys on per-frame-rebuilt parts',
      purpose: ['rendering', 'maintenance'],
      description:
        'HumanoidFigure keys parts by array index only (no stable id) — the doc claims this is "stable enough" because the parts array is rebuilt every frame in fixed order. Reordering or conditionally-emitted parts could mis-diff.',
      evidence: ['bodylab.md HumanoidFigure: "since the parts array is rebuilt every frame, index is stable enough for reconciler diffing"'],
      severity: 'medium',
    },
    {
      name: 'transform props cross the bridge every tick',
      purpose: ['rendering', 'geometry'],
      description:
        'Geometry interning dedupes vertex buffers, but position/rotation change every frame for every moving part, so all transform props cross the bridge every tick (~180-300 moving nodes). Cost is the primitive-cluster trade-off.',
      evidence: ['bodylab.md: "transform props (position, rotation) change every frame for every moving part, so those cross the bridge every tick"'],
      severity: 'low',
    },
    {
      name: 'not Geometry.Humanoid',
      purpose: ['character', 'geometry'],
      description:
        'This is explicitly NOT the single baked Geometry.Humanoid mesh — it is the primitive-cluster approach. Do not confuse the two when porting.',
      evidence: ['bodylab.md "Important" callout + "What this cart does NOT do" first bullet'],
      severity: 'low',
    },
    {
      name: 'no IK, no picking, no textures',
      purpose: ['character', 'animation', 'rendering'],
      description:
        'No inverse kinematics (limb angles driven by sinusoidal gait, not foot-placement targets); no picking/raycasting (selection via UI cards, not 3D clicks); no textures (solid hex colors); no shadow casting; no fog/skybox; no host functions at all.',
      evidence: ['bodylab.md "What this cart does NOT do"'],
      severity: 'low',
    },
  ],
};
