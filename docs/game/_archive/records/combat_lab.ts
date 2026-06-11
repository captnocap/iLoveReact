import type { DocIndex } from '../types';

export const combat_lab: DocIndex = {
  name: 'combat_lab',
  file: 'combat_lab.md',
  cart: 'cart/combat_lab/index.tsx',
  purpose: ['damage', 'perception', 'chance', 'camera', 'npc', 'ragdoll'],
  loc: 1842,
  summary:
    'The integration prototype for HMSC combat: player-vs-bot line-of-sight, aiming, shooting, locational damage, death ragdolls, and Hitman-style NPC perception all running together in one arena, joining the head_lab figure stack with four hmsc registries the way the actual game will.',
  interfaces: [
    {
      name: '__mouse_capture',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_core.zig',
      codeRef: 'framework/v8_bindings_core.zig:808',
      description:
        'Host pointer-lock binding. Driven by React state mouseFocused via an effect (click scene -> capture, Esc -> release, unmount cleanup -> release). While captured the OS cursor is gone and the host accumulates relative deltas.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: '__mouse_delta',
      purpose: ['input', 'host_bridge', 'camera'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_core.zig',
      codeRef: 'framework/v8_bindings_core.zig:809',
      description:
        'Returns {dx, dy} accumulated since last read; polled once per tick and integrated into yaw/pitch accumulators (cameraAimRef) with hmsc maxMouseDeltaPixels (220) spike filter and per-axis sensitivities. Wrapped defensively as readHostMouseDelta (missing binding -> {0,0}).',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'getMouseRightDown',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_core.zig',
      codeRef: 'framework/v8_bindings_core.zig:807',
      description:
        'Polled RMB button state, read every tick: RMB = aiming. Wrapped by readHostNumber (missing -> fallback).',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'getMouseDown',
      purpose: ['input', 'host_bridge'],
      kind: 'host_fn',
      description:
        'Polled LMB button state from the pointer-payload set, read every tick: LMB while aiming = autofire (cooldown-gated). Wrapped by readHostNumber.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'coverFractionOf',
      purpose: ['chance', 'perception', 'physics'],
      kind: 'utility',
      sourceFile: 'cart/combat_lab/index.tsx',
      description:
        "The missing producer chance.ts needs, built here. coverFractionOf(eye, targetBones) casts eye->sample segments to 9 points riding the target's own bones (head twice, shoulders, torso, pelvis, thighs, a shin); blocked/total = the coverFraction input. Riding bones means crouching genuinely pulls samples under cover. The rendered boxes ARE the tested AABBs.",
      dependsOn: ['hitChance', 'BodyHitbox'],
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'lab',
    },
    {
      name: 'hitChance',
      purpose: ['chance', 'damage'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/npc/systems/chance.ts',
      description:
        'hitChance({rangeMeters, coverFraction, targetCrouched, shooterSkill}) -> skill sets the base (0.35-0.95), range bleeds it (full <4m, ~0 by 40m), cover cuts up to 80%, crouched x0.7. The probabilistic path ground truth. Header rule: any perceived odds display warps this, never recomputes.',
      consumes: ['coverFractionOf'],
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'rollHit',
      purpose: ['chance', 'damage'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/npc/systems/chance.ts',
      description: 'Decides whether a probabilistic bot->player shot lands, given hitChance odds.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'rollZone',
      purpose: ['chance', 'damage'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/npc/systems/chance.ts',
      description:
        'Picks the hit zone for a landed probabilistic shot: torso 0.5, legs 0.12x2, arms 0.09x2, head 0.08 (the AI aims center mass).',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'zoneDamage',
      purpose: ['damage'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/npc/systems/damage.ts',
      description:
        'zoneDamage(baseDamage, zone) = base x ZONE_DAMAGE[zone]. The file is the declared join point of the two shot paths: one health subtraction, death decided in one place.',
      dependsOn: ['ZONE_DAMAGE'],
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'ZONE_DAMAGE',
      purpose: ['damage'],
      kind: 'registry',
      sourceFile: 'cart/hmsc-int/render3d/humanoid/hitbox.ts',
      description:
        'The shared zone-multiplier table (head x2.5, torso x1, arms x0.55, legs x0.7) from the hmsc humanoid module, now scaling head_lab hitbox hits too via boneZone()s bone->zone rename. Both shot paths and both figure stacks speak this one damage language.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'DamageZone',
      purpose: ['damage'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/render3d/humanoid/skeleton.ts',
      description: 'The DamageZone type (head|torso|armL|armR|legL|legR).',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'kinds.ts (NPC kind registry)',
      purpose: ['npc', 'perception', 'damage'],
      kind: 'registry',
      sourceFile: 'cart/hmsc-int/npc/kinds.ts',
      description:
        'Per-kind health/speeds/faction/canFight/weaponDamage and the NpcPerceptionProfile. Includes the lab-driven paramedic kind. The cart bots read all stats from here unmodified.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'NpcPerceptionProfile',
      purpose: ['perception', 'npc'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/npc/kinds.ts',
      description:
        'Per-kind perception data: vision range/FoV, hearing acuity, reactionSeconds. Drives the cone test, suspicion fill rate, and hearing reception scaling.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'HMSC_GAMEPLAY_CAMERA',
      purpose: ['camera'],
      kind: 'registry',
      sourceFile: 'cart/hmsc-int/gameplay/camera.ts',
      description:
        'Every mouse-look/follow-cam constant: 0.0032 rad/px yaw, smoothing 24/s, follow dist 5.9m / height 3.05m, aim shoulder shift 0.62m, FoVs. The follow cam used verbatim at rest.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'clampCameraValue',
      purpose: ['camera', 'math'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/gameplay/camera.ts',
      description: 'Camera value clamp helper from the hmsc gameplay camera module.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'angleDeltaDegrees',
      purpose: ['camera', 'math'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/gameplay/camera.ts',
      description: 'Shortest-arc yaw smoothing helper; yaw/pitch chase their accumulators via this.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'TILE_KIND_DEFINITIONS',
      purpose: ['perception', 'rendering', 'world_gen'],
      kind: 'registry',
      sourceFile: 'cart/hmsc-int/world/tileKinds.ts',
      description:
        'Each floor patch is a real tile kind; its npc.noise (road 0.7, mud 0.15-0.25) scales footstep carry AND its render.color paints the patch. One definition drives both what you see and what bots hear.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'buildSkeleton',
      purpose: ['character', 'animation'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'Builds the figure skeleton, now with the kneel pose plus the CROUCH_ACTION body-crouch timeline action for the full crouch.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'buildRigFrameFromBones',
      purpose: ['character', 'rendering'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/parts.ts',
      description: 'Per-actor shape/top/skin/accessories/bottoms rig frame builder.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'BodyHitbox',
      purpose: ['damage', 'character'],
      kind: 'data_model',
      sourceFile: 'cart/head_lab/parts.ts',
      description:
        'Per-bone oriented boxes, the damage surface. The ray is transformed into box-local space by inverting the host Ry.Rx.Rz rotation order and slab-tested against +/-size/2.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'placeBones',
      purpose: ['character', 'ragdoll'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/ragdoll.ts',
      description:
        'yaw+translate bone placement, the placement used for every walking actor here. Part of the createRagdoll/stepRagdoll/ragdollImpulse/ragdollMaxMotion/bonesFromRagdoll/placeBones/blendBones ragdoll kit.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'generateFace',
      purpose: ['character', 'rendering'],
      kind: 'utility',
      sourceFile: 'cart/head_lab/hed.ts',
      description:
        'generateFace(seed, style) produces per-actor faces. Part of the buildPartRender/CharacterCaptures/FigureMeshes kit with cartKey combatlab.',
      consumers: ['cart/combat_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'boneZone',
      purpose: ['damage'],
      kind: 'utility',
      sourceFile: 'cart/combat_lab/index.tsx',
      description:
        "Maps a struck bone to a DamageZone. A near-copy of ragdoll_lab's boneRegion (same ARM_MARKS array, same logic) renamed into hmsc's zone vocabulary (armL not lArm) so both figure stacks finally speak one damage language. The convergence move ragdoll_lab predicted.",
      dependsOn: ['DamageZone', 'ZONE_DAMAGE'],
      status: 'lab',
    },
    {
      name: 'SegmentMesh',
      purpose: ['rendering', 'geometry'],
      kind: 'component',
      sourceFile: 'cart/combat_lab/index.tsx',
      description:
        'The unit-geometry workhorse: renders A->B as a unit Y-cylinder via swing/yaw rotation + [r, length, r] scale. Used by all per-frame-sized fx (tracers, cover rays, cone edges).',
      dependsOn: ['UNIT_CYL'],
      status: 'lab',
    },
    {
      name: 'readHostMouseDelta',
      purpose: ['input', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'cart/combat_lab/index.tsx',
      description: 'Defensive wrapper around __mouse_delta; missing binding -> {0,0}.',
      consumes: ['__mouse_delta'],
      status: 'lab',
    },
    {
      name: 'readHostNumber',
      purpose: ['input', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'cart/combat_lab/index.tsx',
      description: 'Defensive wrapper around polled host number bindings (mouse buttons); missing -> fallback.',
      consumes: ['getMouseRightDown', 'getMouseDown'],
      status: 'lab',
    },
    {
      name: 'NoiseEvent',
      purpose: ['perception', 'npc'],
      kind: 'data_model',
      sourceFile: 'cart/combat_lab/index.tsx',
      description:
        'A transient stimulus {p, radiusMeters, salience, kind} (footsteps and gunshots). Born unprocessed, heard by every bot exactly once on the next tick (the processed flag), drawn for 0.6s as an expanding ring at its true carry radius.',
      status: 'lab',
    },
    {
      name: 'SHOOTER_SKILL',
      purpose: ['chance', 'npc'],
      kind: 'registry',
      sourceFile: 'cart/combat_lab/index.tsx',
      description:
        "Local per-kind shooter-skill table carried with an eviction note: kinds.ts doesn't carry skill yet, delete this table when it graduates there.",
      status: 'lab',
    },
    {
      name: 'FIRE_COOLDOWN',
      purpose: ['chance', 'npc'],
      kind: 'registry',
      sourceFile: 'cart/combat_lab/index.tsx',
      description: 'Local per-kind fire-cooldown table carried with a graduate-to-registry eviction note.',
      status: 'lab',
    },
  ],
  patterns: [
    {
      name: 'keysRef polled by tick (held-key tracking)',
      purpose: ['input', 'game_loop'],
      description:
        "This cart tracks held keys (keysRef) via busOn('__keydown') and '__keyup'  the first in the doc series to consume keyup  for WASD movement and hotkeys.",
      examples: ['combat_lab'],
      promoteTo: 'useGameLoop',
      status: 'recurring',
    },
    {
      name: 'one resolved camera per tick',
      purpose: ['camera', 'game_loop'],
      description:
        'One s.cam resolved once in the loop and read by render, fire ray, and crosshair targeting  never re-derive the bullet from yaw/pitch. The anti-divergence pattern; the same discipline solves bones/rigs once per tick into bonesRef/rigsRef shared by AI, raycasts, and render.',
      examples: ['combat_lab'],
      status: 'recurring',
    },
    {
      name: 'crash-proof tick + frame-counter debug strip',
      purpose: ['game_loop', 'debug'],
      description:
        "step() runs inside try/catch; an exception is console.error'd (the only console level that reaches the dev terminal) and the loop keeps scheduling  a thrown frame used to silently kill the rAF chain. The debug strip renders s.frame so a frozen counter is visible evidence of a dead loop. Every loop cart should adopt this.",
      examples: ['combat_lab'],
      status: 'recurring',
    },
    {
      name: 'see-it==hit-it (the rendered thing IS the tested thing)',
      purpose: ['rendering', 'physics', 'damage'],
      description:
        'Cover boxes = ray AABBs, floor patches = noise definitions, hitboxes = damage surface, camera axis = bullet line. Recurs at every level; matches the terrain see-it==walk-it rule. Should be a named project principle.',
      examples: ['combat_lab'],
      status: 'recurring',
    },
    {
      name: 'registry as the tuning surface (struct stores kind, registry gives meaning)',
      purpose: ['npc', 'world_gen'],
      description:
        'kinds.ts and tileKinds.ts are consumed unmodified; every lab-local table (SHOOTER_SKILL, FIRE_COOLDOWN, MOVE_NOISE, weapons) carries an explicit graduate-me-to-the-registry note. The project load-bearing data architecture.',
      examples: ['combat_lab'],
      status: 'recurring',
    },
    {
      name: 'geometric-out / probabilistic-in (asymmetric combat thesis)',
      purpose: ['chance', 'damage', 'perception'],
      description:
        'Player shots are skill (aim, geometric ray); incoming shots are odds (exposure management, dice). The scape perception split (ground truth vs display warp) restated in chance.ts header and honored by the HUD.',
      examples: ['combat_lab', 'scape'],
      status: 'recurring',
    },
    {
      name: 'unit geometry + scale transforms',
      purpose: ['rendering', 'geometry'],
      description:
        'Anything sized per-frame uses module-constant unit params (UNIT_CYL/BOX/SPHERE/TORUS = one intern entry each) + a scale transform. A continuous float in params would mint a fresh vertex buffer every frame and OOM V8 in minutes.',
      examples: ['combat_lab'],
      promoteTo: 'SegmentMesh',
      status: 'resolved',
    },
    {
      name: 'fixed-shape scene children',
      purpose: ['rendering'],
      description:
        'Per-bot health bars, suspicion bars, ground rings stay mounted when a bot dies and hide via opacity (never unmount); unmounting would shift Scene3D flattened child list mid-stream and corrupt trailing siblings. All variable-length fx collapse into one keyed fx[] list rendered last.',
      examples: ['combat_lab'],
      status: 'recurring',
    },
    {
      name: 'stimulus vs lastKnown separation',
      purpose: ['perception', 'npc', 'ai_navigation'],
      description:
        'stimulus = where to look/investigate (sound, glimpse, report); lastKnown = the last confirmed player position (full sight, being shot, notify report). Hostiles hunt lastKnown never the live position  break line of sight and they run to where you were.',
      examples: ['combat_lab'],
      status: 'recurring',
    },
    {
      name: 'awareness ladder',
      purpose: ['perception', 'npc'],
      description:
        'calm -> spooked (0.33: freeze+face) -> alert (0.66: investigate) -> hostile/panic by kind, driven by a 0..1 suspicion accumulator with thresholds 0.33/0.66/1.0, dwell timers, and decay 0.12/s.',
      examples: ['combat_lab'],
      status: 'recurring',
    },
    {
      name: 'lab-chrome kit re-rolled (Chip/Knob/MeterRow)',
      purpose: ['ui'],
      description:
        'Chip exists in both labs with slightly different styling; the lab-chrome kit (Chip/Knob/MeterRow) keeps being re-rolled per lab.',
      examples: ['combat_lab', 'ragdoll_lab'],
      promoteTo: 'lab-chrome kit',
      status: 'promote',
    },
    {
      name: 'shared lab environment fragment (Skybox/lights)',
      purpose: ['rendering'],
      description:
        'The Skybox/lights block is copy-identical to ragdoll_lab (same zenith/horizon/sun numbers)  a shared lab environment fragment is forming.',
      examples: ['combat_lab', 'ragdoll_lab'],
      promoteTo: 'lab environment fragment',
      status: 'promote',
    },
  ],
  hazards: [
    {
      name: 'aiming from aimForward(yaw,pitch) diverges from the crosshair',
      purpose: ['camera', 'damage'],
      description:
        "Deriving the fire ray from aimForward(yaw, pitch) instead of the camera screen-center axis diverges from the crosshair line by meters at combat range. What's under the crosshair must be what gets hit. Fire, render, and crosshair-targeting must all read the one camera resolved per tick (s.cam).",
      evidence: ['combat_lab.md: The two shot paths section; the original-sin comment in cart/combat_lab/index.tsx'],
      fix: 'Set origin = s.cam.position, dir = normalize(s.cam.target - origin). One s.cam per tick feeds render, fire ray, and crosshair-target highlight.',
      severity: 'high',
    },
    {
      name: 'aim ceiling (the follow cam cannot aim)',
      purpose: ['camera'],
      description:
        "hmsc's shipped follow cam composes pitch by sliding the look target around a fixed-height camera, so its screen axis can never rise above the horizon; at full up-pitch it still points slightly down and the crosshair at 30m sat at ~0.8m, below an enemy's head.",
      evidence: ['combat_lab.md:82, glossary Aim ceiling'],
      fix: 'Use the true ADS aim rig (RMB): orbit a shoulder-shifted crouch-aware pivot with a genuinely pitched forward axis, 2.4m back, pitch clamps widened to +/-~60. Re-clamp the accumulator every tick.',
      severity: 'high',
    },
    {
      name: 'Shift arrives as raw SDL keysyms, not "shift"',
      purpose: ['input'],
      description:
        "Shift arrives from the key decoder as raw SDL keysyms (sdl:1073742049/sdl:1073742053) rather than 'shift', so the cart tracks it both by those codes and by the shiftKey modifier flag on other key events.",
      evidence: ['combat_lab.md:54, preserved comment in cart/combat_lab/index.tsx'],
      severity: 'medium',
    },
    {
      name: 'thrown frame silently kills the rAF chain',
      purpose: ['game_loop', 'debug'],
      description:
        'A thrown frame used to silently kill the rAF/setTimeout chain and freeze the cart with zero output, because console.log (severity < warn) never reaches the dev terminal.',
      evidence: ['combat_lab.md:56'],
      fix: 'Wrap step() in try/catch, console.error the exception, keep scheduling, and render s.frame so a frozen counter is visible.',
      severity: 'medium',
    },
    {
      name: 'BONE_JOINTS and boneZone duplicated from ragdoll_lab',
      purpose: ['damage', 'maintenance'],
      description:
        'BONE_JOINTS (25-entry bone->joint kick map) is duplicated verbatim from ragdoll_lab/index.tsx; boneZone is a near-copy of ragdoll_lab boneRegion (same ARM_MARKS, same logic, different output vocabulary). Both want to live in head_lab/ragdoll.ts. mixHex/hpColor also copied verbatim from ragdoll_lab.',
      evidence: ['combat_lab.md:97'],
      fix: 'Move BONE_JOINTS and the bone-record helpers into head_lab/ragdoll.ts next to the other bone helpers.',
      severity: 'medium',
    },
    {
      name: 'SETTLE_MOTION/SETTLE_TICKS settle block repeated',
      purpose: ['ragdoll', 'maintenance'],
      description:
        'SETTLE_MOTION/SETTLE_TICKS (0.0025/55) and the settle-detection block are repeated from ragdoll_lab; a ragdollSettled(r, ticksRef) helper is implied.',
      evidence: ['combat_lab.md:98'],
      fix: 'Extract a ragdollSettled(r, ticksRef) helper.',
      severity: 'low',
    },
    {
      name: 'two definitions of eyeOf',
      purpose: ['perception', 'character'],
      description:
        'eyeOf (head + 0.06) here vs the hmsc skeleton rig.eye  two definitions of where a humanoid sees from, one per stack.',
      evidence: ['combat_lab.md:99'],
      severity: 'low',
    },
    {
      name: 'FLOOR_ZONES linear-scan noise lookup will not scale to the tile grid',
      purpose: ['perception', 'world_gen'],
      description:
        'FLOOR_ZONES are free rectangles, not grid tiles; the noise lookup (floorKindAt linear scan) is fine for a lab but will not scale to the game tile grid (the game already has world/grid.ts).',
      evidence: ['combat_lab.md:102'],
      fix: 'Use the game tile grid (world/grid.ts) when this lifts into hmsc.',
      severity: 'low',
    },
    {
      name: 'bot kind != behavior is a switch statement (parameters from kinds.ts)',
      purpose: ['npc'],
      description:
        'Bot kind-to-behavior dispatch is a switch statement in the cart for now, though every parameter reads from kinds.ts.',
      evidence: ['combat_lab.md:76'],
      severity: 'low',
    },
    {
      name: 'player hitboxes render but are never ray-tested',
      purpose: ['damage'],
      description:
        "The player's own hitboxes render (B) but nothing ray-tests them  incoming fire is dice-only, per design.",
      evidence: ['combat_lab.md:112'],
      severity: 'low',
    },
  ],
};
