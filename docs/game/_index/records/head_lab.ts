import type { DocIndex } from '../types';

export const head_lab: DocIndex = {
  name: 'head_lab',
  file: 'head_lab.md',
  cart: 'cart/head_lab/index.tsx',
  purpose: ['character', 'animation', 'ragdoll', 'geometry', 'texture_bake', 'interaction'],
  loc: 4200,
  summary:
    'The character subsystem for the whole game effort: every body part is the same sculptable Globe wearing a different silhouette profile on a shared equirect unwrap where paint space IS texture space IS sculpt space, with an editor cart (index.tsx) on top of a kit (parts/hed/ragdoll/figureRender) that planet_run, ragdoll_lab, combat_lab and pathing_lab import.',
  interfaces: [
    {
      name: 'HedDocument',
      purpose: ['character', 'format', 'texture_bake'],
      kind: 'data_model',
      sourceFile: 'cart/head_lab/hed.ts',
      description:
        'The .hed head document: kind:\'hed\', version:1 magic (cheap wrong-file rejection, same convention as .sqi.json), skin color, displacement amount, skull scaleY, a 48x24 quantized signed-byte sculpt grid (hand-sculpt residue), and N feature layers.',
      consumers: ['cart/head_lab/index.tsx', 'cart/head_lab/figureRender.tsx'],
      status: 'live',
    },
    {
      name: 'HedLayer',
      purpose: ['character', 'texture_bake', 'format'],
      kind: 'data_model',
      sourceFile: 'cart/head_lab/hed.ts',
      description:
        'A feature layer = shapes (+ color | null + signed depth + feather). color:null = depth-only invisible relief (brow ridge, cheekbones, eye sockets). depth:0 = paint-only (eye whites, iris, tears). Shapes are ellipses/rects in unwrap UV with optional mirror (auto-stamp across u=0.5 — eyes, brows, ears).',
      dependsOn: ['HedDocument'],
      status: 'live',
    },
    {
      name: 'shapeCoverage',
      purpose: ['character', 'geometry', 'math'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/hed.ts',
      description:
        'Seam wrapping helper: wraps u-distance (du > 0.5 -> 1 - du) so a shape at u=0 (the BACK of the head — the seam) stays one round piece. Back hair is literally a rect at cx=0.',
      status: 'live',
    },
    {
      name: 'hedDepthGrid',
      purpose: ['character', 'geometry', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/hed.ts',
      description:
        'Composites sculpt residue + every layer\'s feathered depth stamp into one clamped -1..1 grid of 48x24 — fed directly to Geometry.Globe\'s displace param.',
      dependsOn: ['HedDocument', 'HedLayer'],
      consumes: ['Geometry.Globe'],
      status: 'live',
    },
    {
      name: 'generateFace',
      purpose: ['character', 'world_gen', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/hed.ts',
      description:
        'generateFace(seed, {style}): mulberry32 PRNG -> masculine/feminine proportion ranges, palette picks (5 skins/6 hairs/5 eyes/4 lips), 7 hair styles (gender-weighted pools), optional smile/stubble, and ~14 anatomy layers placed at canonical positions (brow ridge relief -> carved sockets -> painted eyes -> nose as color+bulge coherence demo -> cheeks/chin/jaw relief -> ears at u=0.25/0.75 with depth 0.4 stick-out). Same seed = same face, forever.',
      dependsOn: ['HedDocument', 'HedLayer'],
      consumers: ['cart/head_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'animateHed',
      purpose: ['character', 'animation', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/hed.ts',
      description:
        'animateHed(doc, anim, phase): face animation as a pure document transform — returns a new doc with affected layers replaced. talk (4-frame jaw flap with teeth on full-open), yell, chew (cheek wad bulging side to side — a depth-only layer), cry (sad brows, lids, frown, two tears). Deterministic per (anim, phase) so texture/mesh keys stay content-addressed: a looping animation cycles N cached bakes, not Nxtime.',
      dependsOn: ['HedDocument'],
      consumers: ['cart/head_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'PART_PRESETS',
      purpose: ['character', 'geometry'],
      kind: 'registry',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'Per-part Globe profile + scaleX/Y/Z for the six part ids (head, torso, pipe, hand, foot, finger). The scaleY comment block encodes the detached-wrist lesson: Globe profiles thin the radial silhouette ONLY; length comes from scaleY alone, so no dragged/generated/clothing-shrunk profile can ever shorten a limb.',
      status: 'live',
    },
    {
      name: 'buildSkeleton',
      purpose: ['character', 'animation', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'buildSkeleton(shape, pose, phase, actions) -> 25 named bones (BoneId), each {position, rotation, scale, thickness, hitbox}. Forward-kinematic chains hand-built in local space using segmentEnd and pitchBetween. All rotation math composes in the host\'s Ry.Rx.Rz order (rotateEulerVec implements it explicitly).',
      dependsOn: ['BODY_SHAPES', 'RigTimelineAction', 'rotateEulerVec'],
      status: 'live',
    },
    {
      name: 'BODY_SHAPES',
      purpose: ['character'],
      kind: 'registry',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        '8 body shapes (neutral/female/male/tall/short/heavy/skinny/bodybuilder) — pure multiplier records (height, shoulder, hip, torsoWide, limbLong, limbThick, head, hand, foot, plus stance for the femur angle: wide hips + sub-1 stance = knees converge).',
      status: 'live',
    },
    {
      name: 'actionWeight/actionPhase/actionOsc/actionArg',
      purpose: ['character', 'animation'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'The action-query helpers: query the RigTimelineAction list by (family, action, side) with target matching (right_arm, both_fists...). ~30 actions wired — punch (5 styles with chamber/thrust/follow-through keyframes blended by smoothstepped phase), guard, point, salute, wave_loop, swing_loop, kick, stomp_loop, crouch/sit/lay, nod/shake/twist/bounce loops, and a full hand layer (clench, open, pinch, middle finger, thumbs-up, wiggle/crawl/jazz loops).',
      dependsOn: ['RigTimelineAction'],
      consumers: ['buildSkeleton'],
      status: 'live',
    },
    {
      name: 'assemblyFromSkeleton',
      purpose: ['character', 'geometry', 'rendering'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'Maps bones -> part instances (which Globe goes where, with thickness making the same pipe sculpt render slimmer as a forearm than a thigh).',
      dependsOn: ['buildSkeleton', 'PART_PRESETS'],
      status: 'live',
    },
    {
      name: 'fingerFan',
      purpose: ['character', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'Hangs 4 fingers + thumb off each palm\'s actual half-extents, with curl/extend/live-wiggle math per digit.',
      dependsOn: ['buildSkeleton'],
      status: 'live',
    },
    {
      name: 'anatomyFromSkeleton',
      purpose: ['character', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'Joint sockets: deltoid balls, elbow/hip/knee balls, pelvis egg, plus pecs (bodybuilder) and belly (heavy). All positioned bone-relative (offsetBone), preserving the phantom-shoulders lesson: absolute offsets strand anatomy at the origin when bones go world-space (ragdoll).',
      dependsOn: ['buildSkeleton', 'offsetBone'],
      status: 'live',
    },
    {
      name: 'buildClothing',
      purpose: ['character', 'geometry', 'rendering'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'Clothing as primitive meshes (box/sphere/cone/cylinder specs, NOT Globes): 6 tops, 5 independent bottoms with DEFAULT_BOTTOMS snapping, 4 clothing prints (StaticSurface-baked tee graphics via clothingSkinTextureKey), 4 accessories. Leg tubes lerp along the ACTUAL hip->knee->ankle chain wearing the leg bones\' rotations; thigh tubes start at t=-0.35 to kill the groin gap; female briefs are their own garment.',
      dependsOn: ['buildSkeleton', 'clothingSkinTextureKey'],
      status: 'live',
    },
    {
      name: 'buildHitboxes',
      purpose: ['character', 'damage', 'interaction'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'Every bone\'s hitbox box — combat_lab\'s bone-hitbox source.',
      dependsOn: ['buildSkeleton'],
      consumers: ['cart/combat_lab'],
      status: 'live',
    },
    {
      name: 'anchorsFromSkeleton',
      purpose: ['character', 'interaction', 'npc'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        '10 semantic interaction anchors (face, face_grab, eyes, mouth, neck, palms, grab origins) each with role/radius/priority/accepts verb list ([\'grab_face\',\'cover_mouth\',\'shove\']...) — the Hitman-style interaction targeting layer.',
      dependsOn: ['buildSkeleton'],
      status: 'live',
    },
    {
      name: 'buildRigFrame',
      purpose: ['character', 'rendering', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'THE entry point: bones + assembly + clothing + anatomy + hitboxes + anchors in one BodyRigFrame.',
      dependsOn: [
        'buildSkeleton',
        'assemblyFromSkeleton',
        'buildClothing',
        'anatomyFromSkeleton',
        'buildHitboxes',
        'anchorsFromSkeleton',
      ],
      status: 'live',
    },
    {
      name: 'buildRigFrameFromBones',
      purpose: ['character', 'ragdoll', 'rendering'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'The physics seam: same BodyRigFrame from a CUSTOM bones record; pose/phase never enter because the bones ARE the pose. This is what lets the ragdoll drive the whole dressed figure.',
      dependsOn: ['assemblyFromSkeleton', 'buildClothing', 'anatomyFromSkeleton', 'buildHitboxes', 'anchorsFromSkeleton'],
      consumers: ['cart/ragdoll_lab', 'cart/head_lab/ragdoll.ts'],
      status: 'live',
    },
    {
      name: 'buildBody/parseBody/serializeBody',
      purpose: ['character', 'format', 'persistence'],
      kind: 'data_model',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'The .body documents: whole character (per-part sculpts + profiles + face layers + shape/clothing/pose/heldItem) under the same kind/version conventions.',
      emits: ['cart/heads/body_<stamp>.body.json'],
      status: 'live',
    },
    {
      name: 'createRagdoll',
      purpose: ['ragdoll', 'physics', 'character'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/ragdoll.ts',
      description:
        'createRagdoll(liveBones) seeds particles from any mid-animation frame (rest lengths from the canonical stand skeleton, so a mid-punch handoff never snaps segment sizes). 15 joints become particles (per-joint mass, ground-collision radius); 24 distance constraints become the skeleton.',
      dependsOn: ['buildSkeleton'],
      status: 'live',
    },
    {
      name: 'stepRagdoll',
      purpose: ['ragdoll', 'physics'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/ragdoll.ts',
      description:
        'Position-based Verlet step: 6 relaxation iterations, ground plane with friction+restitution, optional arena walls, and a terminal-velocity clamp (MAX_SPEED 32 — the comment records the lab\'s maiden flight where stacked uppercut impulses launched the body out of the world).',
      dependsOn: ['createRagdoll'],
      status: 'live',
    },
    {
      name: 'ragdollImpulse',
      purpose: ['ragdoll', 'physics', 'damage'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/ragdoll.ts',
      description: 'Applies an impulse to the ragdoll particles (e.g. from a punch/hit).',
      dependsOn: ['createRagdoll'],
      status: 'live',
    },
    {
      name: 'bonesFromRagdoll',
      purpose: ['ragdoll', 'character', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/ragdoll.ts',
      description:
        'Rebuilds a full bone record from ragdoll particles (limb orientation = +Y along the joint line — valid because pipes are radially symmetric, no twist tracking). Feeds buildRigFrameFromBones so the whole dressed figure tumbles.',
      dependsOn: ['stepRagdoll'],
      consumes: ['buildRigFrameFromBones'],
      status: 'live',
    },
    {
      name: 'offsetBones/placeBones/blendBones',
      purpose: ['character', 'animation', 'ragdoll'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/ragdoll.ts',
      description:
        'Shared placement utilities every figure-placing cart uses: offsetBones, placeBones (yaw+translate a skeleton — exact because of host Ry.Rx.Rz order), blendBones (shortest-arc per-component lerp — the ragdoll->stand get-up blend).',
      consumers: ['cart/planet_run', 'cart/combat_lab', 'cart/pathing_lab', 'cart/ragdoll_lab'],
      status: 'live',
    },
    {
      name: 'ragdollMaxMotion/ragdollCenter',
      purpose: ['ragdoll', 'physics'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/ragdoll.ts',
      description: 'ragdollMaxMotion = at-rest detector; ragdollCenter = center-of-mass of the ragdoll particles.',
      status: 'live',
    },
    {
      name: 'parseAnimationDsl',
      purpose: ['animation', 'scripting', 'vehicle'],
      kind: 'dsl',
      sourceFile: 'cart/animationDsl.ts',
      codeRef: 'cart/head_lab/animDsl.ts',
      description:
        'Parses the one-line animation language [duration,target,action,args;parallel...],[next step...] — steps sequential, ; actions parallel within a step, step duration = max of its actions. Normalizes via a big alias table (arm->both_arms, l_fist->left_fist, plus vehicle aliases car/wheels/steering/suspension — the same DSL drives vehicle_lab).',
      consumers: ['cart/head_lab/index.tsx', 'cart/vehicle_lab'],
      status: 'live',
    },
    {
      name: 'sampleAnimationTimeline',
      purpose: ['animation', 'scripting'],
      kind: 'utility',
      sourceFile: 'cart/animationDsl.ts',
      description:
        'sampleAnimationTimeline(timeline, seconds) finds the active step and returns SampledAction[] with phase (0..1 through the action) and weight = sin(phase.pi) — the universal ease-in-out envelope.',
      dependsOn: ['parseAnimationDsl'],
      status: 'live',
    },
    {
      name: 'isAnimationTimelineLooping',
      purpose: ['animation'],
      kind: 'utility',
      sourceFile: 'cart/animationDsl.ts',
      description: 'Any _loop action (or shake_in_air) makes the whole timeline loop.',
      status: 'live',
    },
    {
      name: 'ANIM_PRESETS',
      purpose: ['animation', 'scripting'],
      kind: 'registry',
      sourceFile: 'cart/head_lab/index.tsx',
      description: '~30 preset DSL strings shipped by the editor, from point to faceGrab to dance.',
      dependsOn: ['parseAnimationDsl'],
      status: 'live',
    },
    {
      name: 'animDsl',
      purpose: ['animation', 'maintenance'],
      kind: 'import',
      sourceFile: 'cart/head_lab/animDsl.ts',
      codeRef: 'cart/head_lab/animDsl.ts:1',
      description: 'Pure re-export of cart/animationDsl.ts (the real animation DSL module). 1 line.',
      status: 'live',
    },
    {
      name: 'buildPartRender',
      purpose: ['character', 'rendering', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/figureRender.tsx',
      description:
        'buildPartRender(doc, faceDepth, cartKey, seed) -> per-part {params, dynKey, texKey}: game-distance LODs (lighter than the lab\'s), head gets the face displacement + doc scaleY, dyn keys follow the "<slotId>~<version>" contract (3d.zig dynSlotLocate — the ~ is REQUIRED or the host silently drops the mesh), head texture key is per-seed, all other parts share ONE skin bake.',
      dependsOn: ['HedDocument'],
      consumers: ['cart/planet_run', 'cart/ragdoll_lab', 'cart/combat_lab', 'cart/pathing_lab'],
      status: 'live',
    },
    {
      name: 'CharacterCaptures',
      purpose: ['character', 'texture_bake', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/head_lab/figureRender.tsx',
      description:
        'The two offscreen StaticSurface bakes (face unwrap composition + plain skin) parked at left:-99999; memo\'d, bake-once.',
      status: 'live',
    },
    {
      name: 'FigureMeshes',
      purpose: ['character', 'rendering', 'geometry'],
      kind: 'component',
      sourceFile: 'cart/head_lab/figureRender.tsx',
      description:
        '<FigureMeshes rig parts yawDeg lift offset> — assembly + anatomy as Geometry.Globe meshes with dynamicKey + textureKey, clothing as primitive meshes, whole-body yaw applied by rotating positions about Y and adding yawDeg to each ry (exact under host order).',
      dependsOn: ['buildPartRender', 'buildRigFrame', 'CharacterCaptures'],
      consumers: ['cart/planet_run', 'cart/ragdoll_lab', 'cart/combat_lab', 'cart/pathing_lab'],
      status: 'live',
    },
    {
      name: 'usePaintable',
      purpose: ['texture_bake', 'input', 'rendering'],
      kind: 'hook',
      sourceFile: 'runtime/hooks/usePaintable.ts',
      description:
        'Paints strokes straight into a per-part GPU texture via host fns __paintable_circle/clear/upload/readback; importing the hook flips the build gate. ONE readback per stroke on mouse-up; React sees nothing until release.',
      consumes: ['__paintable_circle', '__paintable_clear', '__paintable_upload', '__paintable_readback'],
      consumers: ['cart/head_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'DEPTH_OVERLAY_WGSL',
      purpose: ['shader', 'rendering', 'ui'],
      kind: 'shader',
      sourceFile: 'cart/head_lab/index.tsx',
      description:
        'The unwrap painter overlay: ONE <Effect> quad sampling TWO paintable textures (textures=[paints[selPart].id, relief.id]) — live stroke heat (blue=raise/orange=carve), contour rings of the current combined relief (topo line every 1/12 depth), and unwrap guide meridians.',
      dependsOn: ['usePaintable'],
      status: 'live',
    },
    {
      name: 'setLatch / __latchSet',
      purpose: ['input', 'ui', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'cart/head_lab/index.tsx',
      description:
        'The latch system: setLatch -> host global __latchSet writes host-side numeric latches referenced from styles as \'latch:key\' strings — live visual feedback with ZERO React re-renders, state committed only on release. Sliders and outline drags write latches live.',
      consumes: ['__latchSet'],
      status: 'live',
    },
    {
      name: 'SHAPE_REGIONS / stampGrid',
      purpose: ['character', 'geometry', 'ui'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/index.tsx',
      description:
        'Region sliders: SHAPE_REGIONS are named anatomy zones per part (brow/eyes/nose/cheeks..., chest/belly/waist/hips...) that stamp parabolic-falloff bumps into the grid via stampGrid.',
      status: 'live',
    },
    {
      name: 'HeldGameItem',
      purpose: ['item', 'rendering', 'character'],
      kind: 'component',
      sourceFile: 'cart/head_lab/index.tsx',
      description:
        'Renders an imported item\'s model(ctx) at the right hand with a per-item scale table — cross-cart item-model reuse (the scape3d hand-authored 3D item-model idea, hmsc-side). Imports ITEMS + TextureSources from cart/game_item_gallery.',
      imports: ['ITEMS', 'TextureSources'],
      consumes: ['cart/game_item_gallery'],
      status: 'live',
    },
    {
      name: 'useFileDrop',
      purpose: ['persistence', 'input', 'asset_pipeline'],
      kind: 'hook',
      sourceFile: 'cart/head_lab/index.tsx',
      description:
        'Routes .body.json -> whole character load, .hed.json -> head load, anything else -> face photo (an <Image> composited under the layers in the unwrap — paint depth over a photo).',
      dependsOn: ['parseBody', 'HedDocument'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Shared-unwrap-space documents (.hed/.body/.sqi family)',
      purpose: ['format', 'character', 'texture_bake', 'persistence'],
      description:
        'Color+depth from the SAME shapes in the SAME UV space; kind+version magic; quantized signed-byte grids; JSON on disk; drop-back-in round-trip. THE content format pattern.',
      examples: ['head_lab', '.hed', '.body', '.sqi'],
      status: 'recurring',
    },
    {
      name: 'One surface, many silhouettes',
      purpose: ['geometry', 'character'],
      description:
        'Every body part is the same Globe + profile; sculpt once, reuse mirrored/repeated. Radial-only profiles (length never coupled) is load-bearing.',
      examples: ['head_lab', 'PART_PRESETS'],
      promoteTo: 'PART_PRESETS',
      status: 'recurring',
    },
    {
      name: 'Content-addressed bake keys',
      purpose: ['texture_bake', 'rendering', 'animation'],
      description:
        'Texture/dyn keys as pure functions of inputs; animations cycle N cached bakes. The anti-stale-bake discipline.',
      examples: ['head_lab', 'figureRender', 'carve_lab'],
      status: 'recurring',
    },
    {
      name: 'GPU-paint / readback-on-release',
      purpose: ['texture_bake', 'input', 'rendering'],
      description:
        'usePaintable host textures for live brushing, ONE readback per stroke, React state only at commit. Sibling of the latch system and the ref+flush camera (massive_map_lab): the repo-wide keep-high-frequency-input-out-of-React family.',
      examples: ['head_lab', 'massive_map_lab'],
      promoteTo: 'usePaintable',
      status: 'recurring',
    },
    {
      name: 'Host latches (\'latch:key\' styles + __latchSet)',
      purpose: ['input', 'ui', 'host_bridge'],
      description: 'Live UI feedback with zero re-renders; commit on release.',
      examples: ['head_lab'],
      promoteTo: 'setLatch / __latchSet',
      status: 'recurring',
    },
    {
      name: 'Bones-as-interface',
      purpose: ['character', 'ragdoll', 'animation', 'rendering'],
      description:
        'Skeleton record in/out everywhere: poses build bones, ragdoll rebuilds bones, buildRigFrameFromBones dresses ANY bones. Physics, animation and rendering decouple through one type.',
      examples: ['head_lab', 'ragdoll_lab', 'combat_lab'],
      promoteTo: 'buildRigFrameFromBones',
      status: 'recurring',
    },
    {
      name: 'Animation DSL',
      purpose: ['animation', 'scripting', 'vehicle'],
      description:
        '[dur,target,action;...] strings -> sampled actions with sin-envelope weights -> skeleton modulation. Shared body/face/vehicle vocabulary (the alias table already speaks car).',
      examples: ['head_lab', 'vehicle_lab'],
      promoteTo: 'parseAnimationDsl',
      status: 'recurring',
    },
    {
      name: 'Semantic anchors',
      purpose: ['interaction', 'npc', 'character'],
      description:
        'Named, role-tagged, verb-accepting interaction points on the body (face_grab accepts grab_face/cover_mouth/shove) — the interaction-targeting layer combat/scape want.',
      examples: ['head_lab', 'combat_lab', 'scape'],
      promoteTo: 'anchorsFromSkeleton',
      status: 'recurring',
    },
    {
      name: 'Verlet-in-cart physics',
      purpose: ['ragdoll', 'physics'],
      description:
        'Particles+constraints in TS as the standing answer to "no 3D physics in the host" (vs the dormant Bullet module).',
      examples: ['head_lab', 'ragdoll_lab'],
      promoteTo: 'createRagdoll',
      status: 'recurring',
    },
    {
      name: 'Editor-cart pattern',
      purpose: ['ui', 'maintenance'],
      description:
        'The lab IS the editor; game carts import the kit (figureRender), not the editor. Extraction happened at the second consumer.',
      examples: ['head_lab', 'ragdoll_lab'],
      status: 'recurring',
    },
    {
      name: 'Memo\'d mesh bundle vs camera state',
      purpose: ['rendering', 'ui'],
      description:
        'Isolate sculpt-heavy mesh subtrees from orbit-drag re-renders via one useMemo\'d props bundle (same perf isolation hmsc\'s GameWorld3D uses).',
      examples: ['head_lab', 'hmsc'],
      status: 'recurring',
    },
    {
      name: 'interval clocks, not rAF-probe',
      purpose: ['animation', 'game_loop', 'ui'],
      description:
        'This cart drives animation with setInterval at three rates (150/90/50 ms); the rAF-probe is the GAME loop idiom, intervals are the EDITOR idiom.',
      examples: ['head_lab'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'editor/kit duplicate types and helpers',
      purpose: ['maintenance'],
      description:
        'index.tsx and figureRender.tsx each define their own PartRender type, clothingGeometry helper, and layer-paint component (HedLayerPaint vs FaceLayerPaint — near-identical); the editor predates the kit extraction and was never re-pointed at it. Mild drift hazard, flagged for the consolidation pass.',
      evidence: [
        'index.tsx and figureRender.tsx each define PartRender / clothingGeometry / HedLayerPaint vs FaceLayerPaint',
      ],
      fix: 'Re-point the editor at the figureRender kit during the consolidation pass.',
      severity: 'medium',
    },
    {
      name: 'PART_LOD defined twice with different values',
      purpose: ['maintenance', 'rendering'],
      description:
        'PART_LOD exists twice with different values (editor close-up LODs in index.tsx vs game-distance LODs in figureRender.tsx) — intentional, but the same name in two files invites confusion.',
      evidence: ['PART_LOD in index.tsx (close-up) vs figureRender.tsx (game-distance)'],
      severity: 'medium',
    },
    {
      name: 'hooks-in-a-loop (usePaintable per PART_IDS)',
      purpose: ['maintenance'],
      description:
        'The hooks-in-a-loop pattern (usePaintable per PART_IDS entry) is safe only because PART_IDS is a module constant — preserved by an eslint-disable with the reasoning inline.',
      evidence: ['usePaintable called per PART_IDS entry with inline eslint-disable'],
      fix: 'Do not make PART_IDS dynamic; it must stay a module constant.',
      severity: 'high',
    },
    {
      name: 'paints rebuilt every render, captured by effect closures',
      purpose: ['maintenance'],
      description:
        'paints is rebuilt every render and captured by useEffect closures — works because handles are stable per id, but it reads as a trap.',
      evidence: ['paints rebuilt every render, captured by useEffect closures'],
      severity: 'medium',
    },
    {
      name: 'skeleton is forward-kinematics only (no IK)',
      purpose: ['character', 'animation'],
      description:
        'No IK; foot placement during posture drops (sit/lay) is hand-tuned, not solved.',
      evidence: ['skeleton FK-only; sit/lay foot placement hand-tuned'],
      severity: 'low',
    },
    {
      name: 'anatomy dyn-key suffix asymmetry editor vs kit',
      purpose: ['maintenance', 'rendering'],
      description:
        'anatomy dyn keys get .anatomy.${i} suffixes in the editor\'s PartMeshes but NOT in figureRender\'s FigureMeshes (it reuses the part\'s dynKey directly — fine, same geometry, but the asymmetry is another editor/kit drift datum).',
      evidence: ['editor PartMeshes adds .anatomy.${i}; FigureMeshes reuses part dynKey directly'],
      severity: 'low',
    },
    {
      name: 'dyn key ~ separator is REQUIRED',
      purpose: ['rendering', 'host_bridge'],
      description:
        'dyn keys must follow the "<slotId>~<version>" contract (3d.zig dynSlotLocate) — the ~ is REQUIRED or the host silently drops the mesh.',
      evidence: ['figureRender.tsx buildPartRender dyn keys follow "<slotId>~<version>"; 3d.zig dynSlotLocate'],
      fix: 'Always include the ~ separator in dynamicKey strings.',
      severity: 'high',
    },
    {
      name: 'paintables must sit outside flex flow',
      purpose: ['rendering', 'ui'],
      description:
        'Paintable host nodes parked in an absolute box at -99999 — a bare host node in the flow takes proportional-fallback space and blows up the layout (in-file comment preserves this footgun).',
      evidence: ['index.tsx in-file comment: paintables parked at -99999 outside flex flow'],
      fix: 'Keep paintable/StaticSurface bake nodes in an absolute box at left:-99999, never in flow.',
      severity: 'high',
    },
  ],
};
