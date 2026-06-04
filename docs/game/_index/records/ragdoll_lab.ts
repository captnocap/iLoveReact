import type { DocIndex } from '../types';

export const ragdoll_lab: DocIndex = {
  name: 'ragdoll_lab',
  file: 'ragdoll_lab.md',
  cart: 'cart/ragdoll_lab/index.tsx',
  purpose: ['ragdoll', 'physics', 'damage', 'animation', 'character', 'camera'],
  summary:
    'A systems rehearsal that answers "when something hits the body, where did it hit, how hard, and what does the body do" end-to-end: bone-level hitbox locational damage, a pure-JS Verlet ragdoll seeded from the live animated pose on impact, and recovery that blends the settled pose back to standing.',
  loc: 583,
  interfaces: [
    {
      name: 'RagdollLab',
      purpose: ['ragdoll', 'physics', 'damage', 'game_loop'],
      kind: 'component',
      sourceFile: 'cart/ragdoll_lab/index.tsx',
      codeRef: 'cart/ragdoll_lab/index.tsx:114',
      description:
        'Cart entry: damage model, sim state machine, frame loop, car collision, controls/diagram/hit-log UI, orbit input, scene composition. Sim state lives in one mutable object behind simRef (type Sim); React state holds only UI knobs and a frame counter; the loop runs clock -> dt -> bones -> car+collision -> physics+settle -> camera chase -> setTick.',
      dependsOn: ['Sim', 'createRagdoll', 'stepRagdoll', 'bonesFromRagdoll', 'buildSkeleton', 'buildRigFrameFromBones', 'CarMeshes', 'FigureMeshes', 'OrbitCamera'],
      consumes: ['__keydown'],
      status: 'lab',
    },
    {
      name: 'Sim',
      purpose: ['ragdoll', 'physics', 'game_loop'],
      kind: 'data_model',
      sourceFile: 'cart/ragdoll_lab/index.tsx',
      codeRef: 'cart/ragdoll_lab/index.tsx:114',
      description:
        'The single mutable sim object held behind simRef: mode, clocks, ragdoll, car, HP, hit log, camera target. The sim-in-refs/render-by-tick-counter shape; UI values the loop needs are mirrored into uiRef so the closed-over tick closure reads live values.',
      status: 'lab',
    },
    {
      name: 'boneRegion',
      purpose: ['damage'],
      kind: 'utility',
      sourceFile: 'cart/ragdoll_lab/index.tsx',
      codeRef: 'cart/ragdoll_lab/index.tsx:65',
      description:
        'Maps the 25 BoneIds to one of six damage regions (head/torso/lArm/rArm/lLeg/rLeg) by name pattern (arm-segment name list + l/r prefix).',
      status: 'lab',
    },
    {
      name: 'BONE_JOINTS',
      purpose: ['damage', 'ragdoll'],
      kind: 'registry',
      sourceFile: 'cart/ragdoll_lab/index.tsx',
      codeRef: 'cart/ragdoll_lab/index.tsx:73',
      description:
        'Bone->joint kick map: which ragdoll joints a struck bone transfers impulse to (segment bones kick both endpoint joints, e.g. a forearm hit kicks elbow+hand).',
      status: 'lab',
    },
    {
      name: 'CarMeshes',
      purpose: ['vehicle', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/ragdoll_lab/car.tsx',
      description:
        'The boxy sedan as 9 Scene3D.Meshes (chassis, cabin, glass with opacity 0.85 on the transparent pass, 4 cylinder wheels, 2 headlights). Pure visual; the collision box (CAR_HALF/CAR_CENTER_Y) lives in index.tsx. Rotated yawDeg={dir*90} so its long z axis lies along the x-axis collision box.',
      status: 'lab',
    },
    {
      name: 'createRagdoll',
      purpose: ['ragdoll', 'physics'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/ragdoll.ts',
      description:
        'createRagdoll(bones): seeds 15 particle positions from the live pose, but takes rest lengths from the canonical stand skeleton (buildSkeleton("neutral","stand")) so a mid-punch handoff never snaps segment lengths.',
      status: 'lab',
    },
    {
      name: 'stepRagdoll',
      purpose: ['ragdoll', 'physics'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/ragdoll.ts',
      codeRef: 'cart/head_lab/ragdoll.ts:167',
      description:
        'The Verlet step: integrate (gravity -10.5, air damping 0.995, per-step displacement clamped to 32 m/s), 6 relaxation passes over 24 distance constraints, ground plane at each joint radius (restitution 0.3, keep 55% tangential), optional soft arena walls via arenaHalf (cart passes 15.5).',
      status: 'lab',
    },
    {
      name: 'ragdollImpulse',
      purpose: ['ragdoll', 'physics'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/ragdoll.ts',
      description:
        'ragdollImpulse(r, joint, v, dt): applies an impulse as prev -= v*dt. Must use the same dt as stepRagdoll or every kick is silently rescaled.',
      status: 'lab',
    },
    {
      name: 'bonesFromRagdoll',
      purpose: ['ragdoll', 'animation'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/ragdoll.ts',
      description:
        'Rebuilds all 25 bones from the 15 particles: orientations are +Y along the joint-to-joint line (alignY, no twist tracking since limbs are radially symmetric pipes), positions interpolate along segments (forearm 0.42 elbow->hand, wrist 0.85), scale/thickness/hitbox copied from the stand template, feet flattened to 0.35 of shin pitch.',
      status: 'lab',
    },
    {
      name: 'offsetBones / placeBones / blendBones',
      purpose: ['animation', 'character'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/ragdoll.ts',
      description:
        'Bone-record utility belt. offsetBones translates a pose to an origin; placeBones prepends a yaw transform; blendBones(a, b, t) interpolates two poses (recovery uses smoothstep(t) over RECOVER_SECONDS 0.85).',
      status: 'lab',
    },
    {
      name: 'buildSkeleton',
      purpose: ['animation', 'character'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'buildSkeleton(shape, pose, phase) -> Record<BoneId, SkeletonBone> (25 bones, each {position, rotation, scale, thickness, hitbox}). The animation producer of the bones record; gait phase advances on scaled time so slow-mo slows the walk.',
      status: 'live',
    },
    {
      name: 'buildRigFrameFromBones',
      purpose: ['character', 'rendering', 'damage'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      codeRef: 'cart/head_lab/parts.ts:1317',
      description:
        "buildRigFrameFromBones(bones, 'neutral', 'tee', 'plain', ['cap'], 'jeans') -> BodyRigFrame {bones, assembly, anatomy, clothing, hitboxes, anchors}. The single sink of the bones record; every downstream layer is bones-driven (design seam noted at parts.ts:1312), so a physics solver only has to produce bone positions/rotations.",
      status: 'live',
    },
    {
      name: 'BodyRigFrame',
      purpose: ['character', 'damage'],
      kind: 'data_model',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'The full dressed rig: { bones, assembly, anatomy, clothing, hitboxes, anchors }. hitboxes is an oriented box per bone (the locational-damage surface tested against the car AABB).',
      status: 'live',
    },
    {
      name: 'generateFace',
      purpose: ['character', 'asset_pipeline'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/hed.ts',
      codeRef: 'cart/head_lab/hed.ts:338',
      description:
        "generateFace(seed, {style:'masculine'}) procedurally authors a .hed face document: shapes at anatomical unwrap positions plus seeded variation; color and relief share coordinates by construction.",
      status: 'live',
    },
    {
      name: 'hedDepthGrid',
      purpose: ['character', 'geometry', 'asset_pipeline'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/hed.ts',
      codeRef: 'cart/head_lab/hed.ts:153',
      description:
        'hedDepthGrid(doc) flattens a .hed document layers+sculpt into the 48x24 signed depth grid that the head mesh displaces by.',
      status: 'live',
    },
    {
      name: '.hed document',
      purpose: ['character', 'format', 'asset_pipeline'],
      kind: 'data_model',
      sourceFile: 'cart/head_lab/hed.ts',
      description:
        'The .hed face document format: layered face description authored procedurally by generateFace and flattened to a depth grid by hedDepthGrid.',
      status: 'live',
    },
    {
      name: 'buildPartRender',
      purpose: ['character', 'rendering'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/figureRender.tsx',
      description:
        "buildPartRender(doc, faceDepth, slotPrefix, seed) -> per-part {params, dynKey, texKey}: every body part is a Geometry.Globe with a silhouette profile (head also carries depth grid + displacement); dynKey follows the host's <slotId>~<version> dyn-slot contract; texKey points at a baked texture.",
      status: 'live',
    },
    {
      name: 'CharacterCaptures',
      purpose: ['character', 'texture_bake', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/head_lab/figureRender.tsx',
      description:
        'Parks offscreen StaticSurface bakes (the 512x256 face unwrap as skin base + .hed layers as absolute Boxes, plus a plain skin tile) that part meshes sample by textureKey. Same bake-once discipline as the hmsc face pool.',
      status: 'live',
    },
    {
      name: 'FigureMeshes',
      purpose: ['character', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/head_lab/figureRender.tsx',
      description:
        'Renders the rig as Scene3D meshes: maps rig.assembly + rig.anatomy (joint sockets) to Globe meshes (material="#ffffff" so textures read true) and rig.clothing to primitive meshes.',
      status: 'live',
    },
    {
      name: 'OrbitCamera',
      purpose: ['camera'],
      kind: 'component',
      sourceFile: 'runtime/cameras/index.tsx',
      codeRef: 'runtime/cameras/index.tsx:60',
      description:
        'The @reactjit/cameras registry rig: rigs/orbit.ts is a pure solve({target,yaw,pitch,dist,zoom,fov}) -> {pos,target,fov}; index.tsx:60-65 wraps it as a component emitting one Scene3D.Camera. First lab in the series to use the registry rig instead of a hand-rolled cameraFromOrbit; the cart adds target smoothing with k = 1 - e^(-5*dtReal).',
      status: 'live',
    },
    {
      name: 'DamageDiagram',
      purpose: ['damage', 'ui'],
      kind: 'component',
      sourceFile: 'cart/ragdoll_lab/index.tsx',
      description:
        'The 2D twin of the 3D hitboxes: the same six regions as absolute-positioned boxes wearing the same hpColor (green->amber->red two-segment hex lerp).',
      status: 'lab',
    },
    {
      name: 'mixHex / hpColor',
      purpose: ['color', 'ui'],
      kind: 'utility',
      sourceFile: 'cart/ragdoll_lab/index.tsx',
      codeRef: 'cart/ragdoll_lab/index.tsx:88',
      description:
        'mixHex (index.tsx:88) is the general two-color hex lerp; hpColor maps HP to a green/amber/red tint. One of 4+ parallel hex-channel utilities across the figure stack.',
      status: 'lab',
    },
  ],
  patterns: [
    {
      name: 'Sim-in-refs loop',
      purpose: ['game_loop', 'physics'],
      description:
        'The real-time cart pattern: mutable sim object in a useRef, scheduler = rAF-guard -> setTimeout(16), dt from performance.now clamped [0.001, 0.05], UI state mirrored into refs for the loop, setTick(t=>t+1) as the only render trigger.',
      examples: ['ragdoll_lab', 'input_bench'],
      promoteTo: 'useGameLoop',
      status: 'promote',
    },
    {
      name: 'Bones record as figure lingua franca',
      purpose: ['character', 'animation', 'ragdoll'],
      description:
        'Record<BoneId, SkeletonBone> produced by three sources (buildSkeleton animation, bonesFromRagdoll physics, blendBones blend) and consumed by one sink (buildRigFrameFromBones). Mode switches swap the producer; everything downstream is oblivious. The shape any future animation system should preserve.',
      examples: ['ragdoll_lab', 'head_lab', 'pathing_lab', 'combat_lab', 'planet_run'],
      status: 'recurring',
    },
    {
      name: 'Animation->physics->animation round trip',
      purpose: ['animation', 'physics', 'ragdoll'],
      description:
        'Seed particles from the live pose (handoff frame), run physics, detect rest by max joint motion, blend back to the authored pose. Each leg is a named function with a small contract; portable to any game entity.',
      examples: ['ragdoll_lab'],
      status: 'recurring',
    },
    {
      name: 'Slow-motion = scaled dt with impulse-dt invariant',
      purpose: ['physics', 'game_loop'],
      description:
        'Time dilation falls out of one dt multiplier only because impulses and steps share dt. Real-time/sim-time split: dtReal for UI/camera/flash windows, dt for sim.',
      examples: ['ragdoll_lab'],
      status: 'recurring',
    },
    {
      name: 'Locational damage as region map over bone hits',
      purpose: ['damage'],
      description:
        'bone -> region -> multiplier -> once-per-event set. The model the actual game will need; must be reconciled with hmsc DamageZone/ZONE_DAMAGE raycast model before a third variant appears.',
      examples: ['ragdoll_lab', 'combat_lab'],
      status: 'recurring',
    },
    {
      name: 'Prepend-a-yaw local transform',
      purpose: ['math', 'character', 'vehicle'],
      description:
        'Rotate local offsets about Y, add yawDeg to each ry under the host Ry*Rx*Rz order. car.tsx place(), FigureMeshes place()/turn(), and placeBones are three implementations of the same transform.',
      examples: ['ragdoll_lab'],
      promoteTo: 'placeLocal',
      status: 'promote',
    },
    {
      name: 'Two parallel humanoid stacks',
      purpose: ['character', 'damage', 'maintenance'],
      description:
        'The head_lab figure (sculptable Globe parts, .hed faces, 25 named bones, box hitboxes, Verlet ragdoll) vs the hmsc humanoid (fixed primitive parts, baked face decals, 6 capsule zones, no physics) implement the same concepts twice with different vocabularies. The biggest convergence candidate the glossary effort has surfaced.',
      examples: ['ragdoll_lab', 'pathing_lab', 'combat_lab', 'planet_run', 'hmsc'],
      status: 'recurring',
    },
    {
      name: 'Re-rolled V3 math and darken-hex helpers',
      purpose: ['math', 'color', 'maintenance'],
      description:
        'lerp3 defined twice in this dependency chain (index.tsx:103, ragdoll.ts:87); darken-a-hex exists 4+ times (darkHex, darkShoe, darken, mixHex); sub/len3/mid3/lerp3 re-rolled per file. Want to be one color utility and one V3 math module.',
      examples: ['ragdoll_lab'],
      status: 'avoid',
    },
  ],
  hazards: [
    {
      name: 'Impulse-dt invariant',
      purpose: ['physics', 'ragdoll'],
      description:
        'ragdollImpulse(..., dt) and stepRagdoll(r, dt) must share the same (possibly slow-mo-scaled) dt, or every kick energy is silently rescaled (slow-mo would change impact energy, not just playback speed).',
      evidence: ['index.tsx:403 comment: impulses and stepRagdoll must use the same dt'],
      severity: 'high',
    },
    {
      name: 'Dyn-key ~ separator is load-bearing',
      purpose: ['rendering', 'character'],
      description:
        'dynamicKey = "<slotId>~<version>" for live/sculpted geometry; the host keeps one reusable GPU slot per id. A missing ~ silently drops the mesh (no error).',
      evidence: ['dynKey ragdoll_lab.head~4242 — the ~ is load-bearing; without it the host silently drops the mesh'],
      severity: 'high',
    },
    {
      name: 'Damage-region naming is reversed vs hmsc',
      purpose: ['damage', 'maintenance'],
      description:
        'ragdoll_lab regions are lArm/rArm/lLeg/rLeg while hmsc DamageZone is armL/armR/legL/legR — the same six-region model with reversed naming. An agent porting between stacks will mismatch fields.',
      evidence: ["ragdoll_lab's regions are lArm/rArm/lLeg/rLeg while hmsc's DamageZone is armL/armR/legL/legR"],
      fix: 'Converge the two locational-damage vocabularies before a third variant appears.',
      severity: 'high',
    },
    {
      name: 'car.tsx header comment is stale',
      purpose: ['vehicle', 'maintenance'],
      description:
        'car.tsx header says the sedan is shared and "pathing_lab drives fleets of them," but pathing_lab now imports buildVehicle from cart/vehicle_lab/; CarMeshes has exactly one consumer (this cart). Car geometry/metrics are fragmenting across index.tsx collision constants, car.tsx visual, vehicle_lab, and HMSC_SCALE.car.',
      evidence: ['car.tsx header comment says the sedan is shared … pathing_lab drives fleets of them, but pathing_lab imports buildVehicle from cart/vehicle_lab/'],
      severity: 'medium',
    },
    {
      name: 'rAF absent; Verlet displacement clamp required',
      purpose: ['game_loop', 'physics'],
      description:
        'rAF does not exist on this host so the cart always runs on setTimeout(16). Unbounded Verlet launched the body out of the world on the maiden flight; the per-step displacement clamp to 32 m/s (ragdoll.ts:167) is the fix because impulses stack.',
      evidence: ['on this host rAF does not exist', 'ragdoll.ts:167 comment: unbounded Verlet launched the body out of the world on the maiden flight'],
      severity: 'medium',
    },
    {
      name: 'Collision box never rotates',
      purpose: ['physics', 'vehicle'],
      description:
        'The car collision AABB (CAR_HALF x-major, center y=0.7) never rotates — only +/-x travel exists. The visual car is rotated yawDeg=dir*90 to match. Adding non-x travel would break the box-vs-box test silently.',
      evidence: ['the collision box never rotates — only +/-x travel exists; the visual car is rotated so its long (z) axis lies along x'],
      severity: 'medium',
    },
    {
      name: 'Once-per-region-per-launch damage',
      purpose: ['damage'],
      description:
        'regionsHit resets per launch so a car shredding 8 leg bones charges the leg once. Code expecting per-bone damage accrual will under-count.',
      evidence: ['Once per region per launch: a car shredding through 8 leg bones charges the leg once'],
      severity: 'low',
    },
    {
      name: 'No self-collision or joint limits',
      purpose: ['ragdoll', 'physics'],
      description:
        'The ragdoll has no self-collision and no joint-angle limits (knees bend backward freely). Acceptable at lab fidelity but worth knowing before it graduates to the game.',
      evidence: ['The ragdoll has no self-collision and no joint-angle limits (knees bend backward freely)'],
      severity: 'low',
    },
    {
      name: 'Stale-closure dodge via actionsRef',
      purpose: ['game_loop', 'input'],
      description:
        'The one-time __keydown subscription reads through actionsRef.current (refreshed every render, index.tsx:294-295) so the handler never goes stale. Reading captured variables directly instead would freeze at first mount.',
      evidence: ['Handlers read through actionsRef.current (refreshed every render, line 294-295) so the one-time subscription never goes stale'],
      severity: 'low',
    },
  ],
};
