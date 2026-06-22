import type { DocIndex } from '../types';

// The Skybox & The Void doctrine. Source of truth:
// docs/game/SKYBOX_PLAYBOOK.md (consolidates USER ASKS req_1095 → req_1105).
//
// SEAM 1 BUILT (req_1653): the void-math + procedural shell + sky-drift are LIVE
// in the editor play renderer. cart/hmsc-int/game/void/{distance,distortion,
// shell}.ts + render3d/{VoidShell.tsx,skyDrift.ts}, wired in render3d/
// GameWorld3D.tsx; tests in game/void/void.test.ts (9/9). escape_depth reads
// REAL player distance for now (the treadmill, seam 2, swaps the source). The
// remaining interfaces below stay 'candidate' (design-first) until their seam.
// The hazards are the load-bearing invariants a worker must not violate.

export const skybox_void: DocIndex = {
  name: 'skybox_void',
  file: 'SKYBOX_PLAYBOOK.md',
  purpose: ['world_gen', 'rendering', 'perception', 'game_loop', 'vehicle'],
  summary:
    'DESIGN-INTENT doctrine (nothing built): the authored city is wrapped in a procedural SHELL — an endless hash-generated city (the archived hmsc_massive_map_lab pattern, zero storage, one-batch instanced draw) rendered as the outer ring of the SAME citywide map (V30, never a separate changelevel map). The shell is a second axis of play, not scenery: a roguelite "void run" the player discovers by refusing to stop driving. THE LAW (req_1104): "Outward travel stretches space. Inward travel folds it." One generator, four jobs — COAST (overt: another city across water, notoriety climbs, an ENGAGED apache blasts you, survive => achievement flag; stays Euclidean), ROAD INFINITY (covert: roads seam into endless sprawl, no notoriety, no warning, the believability-decay descent), LIVING NOWHERE (deterministic NPCs hydrate locally per V30 frozen activation; the SAME NPC recurs = the doppelganger horror tell), MOD CANVAS (V28/V29 huge bolted-on authorable space, procedural fill overridable). Believability decay is one scalar escape_depth = max(0, distance_from_core - safe_radius) driving a continuous voidDistortion() weight fan-out; named 10/25/50/75/100/150km tiers are achievement milestones not step-functions (100km = Truman tax: controls invert, people float, police radio your name). The road-void is a TREADMILL (psychological not physical distance): true position is clamped/folded near the authored seam, instruments lie independently (GPS says 87km, skyline over the fence), turning around collapses the route home — you were always 2 blocks out. No hand-outs: wrongness is positional but damage/resources heal only via consumables, so RESOURCE EXHAUSTION is the governor (no invisible wall). Plus the NIGHT ASSASSIN: the crime-for-hire app pointed inward — a hit on the player`s own head with rival bidders you can never outbid, an ENGAGED hunter pathing across the map at night, self-scaling with notoriety. Reuses existing stacks: sceneEnv sky/fog floats, perception notoriety, missions client/target, vehicle+stats survival, story flags, V20 store, Hud instruments.',
  interfaces: [
    {
      name: 'escape_depth',
      purpose: ['world_gen', 'game_loop'],
      kind: 'utility',
      description:
        'The ONE scalar that drives all void distortion. BUILT (seam 1): cart/hmsc-int/game/void/distance.ts — worldCore() derives the authored map RECTANGLE (not a circle) from the layout; escapeDepth = max(0, distanceOutsideCore - grace) is the straight-line gap PAST the rectangle edge (0 inside), reading REAL player distance. (A circumradius circle was the first cut and was WRONG — it enclosed a huge margin beyond every edge, so the void never started until far past the reachable area and the shell was invisible; req_1655.) In the treadmill model (seam 2, not yet) escape_depth becomes a VIRTUAL accumulator NOT the odometer — true position clamped near the authored seam. Single source of truth: instruments are lying views over it.',
      status: 'live',
    },
    {
      name: 'voidDistortion',
      purpose: ['world_gen', 'rendering', 'perception'],
      kind: 'utility',
      description:
        'Pure function escape_depth -> weight struct { trafficFlip, npcOrientCorrupt, controlInvert, skyDrift, dialogCorrupt, spawnWeird, roadRepeat, awarenessGlitch, instrumentLie }. BUILT (seam 1): cart/hmsc-int/game/void/distortion.ts — ONE continuous smoothstep curve read at nine onset windows (skyDrift earliest ~10km, controlInvert latest ~100km); the named tier-bands are achievement milestones not step-functions. Ships voidHash() (seeded, never Math.random) shared with the shell. Seam 1 wires exactly ONE consumer (skyDrift -> render3d/skyDrift.ts); every other weight is defined awaiting its seam. NO consumer hardcodes a km threshold.',
      status: 'live',
    },
    {
      name: 'VOID_TIERS',
      purpose: ['world_gen', 'game_loop'],
      kind: 'registry',
      description:
        'P2 tunable table of the named believability-decay milestones (10/25/50/75/100/150km) and per-band distortion weights. Bands are achievement-toast markers over ONE continuous curve, not six step-functions. 100km = the Truman tax band; 150km = the (flavor-only) ejection terminal.',
      status: 'candidate',
    },
    {
      name: 'procedural shell generator',
      purpose: ['world_gen', 'rendering'],
      kind: 'module',
      description:
        'The hash-deterministic city wrapping the authored core as the OUTER RING of the one citywide map. BUILT (seam 1): cart/hmsc-int/game/void/shell.ts regenerates the archived hmsc_massive_map_lab pattern (pure fn of coords via voidHash, zero storage, stride-9 ground+roads+buildings) and buildShellBatch() streams a chunk window that SKIPS chunks whose center is still inside the authored rectangle (no double-city over the authored map), so the void fills the horizon the moment you look past the edge. render3d/VoidShell.tsx draws it as ONE Scene3D.Instances, sized to the camera draw radius (geometry past it is culled) and memoized on the player CHUNK cell (re-rolls only on a 160m boundary crossing). Mounted in GameWorld3D so it shows in the live play/iso renderer. ALSO BAKED INTO /compiled (req_1656): the no-V8 world loader runs no React, so the editor VoidShell never executes there — the bake (compile/worldGeometry.pushVoidShell) lowers a FINITE ring (forEachShellRingBox, 8 chunks ≈ 1.28km past every edge) of the SAME generator into the gamefile instances at the authored ground height, plus compile/worldColliders.shellGroundHeightfield bakes ONE flat walkable plane so the player walks out past the edge instead of falling into nothing (wired in packageMap). The seam at the authored edge is closed (req_1657): the chunk skip drops only chunks whose CENTRE is inside the rect (boundary chunks straddle the edge so their ground meets the authored floor, no gap), buildings landing inside the rect are skipped, and the shell sinks ~10cm so the authored floor wins the overlap. Building VARIETY (req_1658): each baked building draws a hash-picked facade/masonry material (VOID_SHELL_FACADES — i-brick-apartment/shopfront/bodega/fire-escape/rollshutter/entrance, a-brick/concrete, h-stone-wall, e-stucco-facade) via the SAME internMaterial path the authored buildings use; ShellBoxEmit tags each box ground/road/building so only buildings skin. Visual proof: cart/void_probe.tsx (editor) + rjit game shot of the baked gamefile (compiled). NOT YET: scattered PROPS in the shell, the truly-infinite native streamed shell, the treadmill fold-region recycle (seam 2), and the coast water-gap cluster.',
      dependsOn: ['escape_depth'],
      status: 'live',
    },
    {
      name: 'Night Assassin / bounty-on-your-own-head',
      purpose: ['npc', 'perception', 'game_loop'],
      kind: 'module',
      description:
        'Replaces a curfew: the crime-for-hire contract system pointed inward. The player is a POSITION (missions/defs.ts client+target already supports it); at night an ENGAGED hunter spawns far and pathes toward the player; killing it reveals a job board for the player`s own head with rival bidders (validator: target != self). Self-scaling with CaaS activity + notoriety; losing bidders become an emergent rogues` gallery. On-doctrine with V22 PROTECT THE ZERO.',
      dependsOn: ['GAME_MISSIONS'],
      status: 'candidate',
    },
    {
      name: 'Endless Passenger (ride into the void)',
      purpose: ['npc', 'agent_llm', 'game_loop'],
      kind: 'module',
      description:
        'The narrative payload of the void (Spun-ending reference). An NPC asks for a ride into the void; the mission NEVER ENDS — a treadmill mission whose stated destination is always ahead and the fold (§4) guarantees no arrival (the recursion field makes never-arriving diegetic, not a softlock). The passenger talks forever via useAssistant (runtime/hooks/useAssistant.ts — streams; local_ai .gguf runs offline), toggled on as opt-in "game enrichment"; prompt it with the current wrongness so coherence rides voidDistortion.dialogCorrupt. With the toggle off it falls back to a canned/looping line pool — enrichment is optional, never required.',
      dependsOn: ['GAME_MISSIONS'],
      consumes: ['useAssistant'],
      status: 'candidate',
    },
    {
      name: 'Void Distance leaderboard record',
      purpose: ['persistence', 'game_loop'],
      kind: 'data_model',
      description:
        'A V20-store run record for the cursed-speedrun: furthest depth, time survived beyond safe radius, vehicle, seed/route direction, mods enabled, wrongness tier reached, cause of failure (crash/apache/starvation/void_ejection/car_folded/gave_up). Death/return also mints a V22 narrative hook (text, world_delta).',
      status: 'candidate',
    },
  ],
  patterns: [
    {
      name: 'Limitation-as-lore (procedural repetition reframed)',
      purpose: ['world_gen'],
      description:
        'The engine`s biggest limitation — procedural sameness — becomes its most original feature by framing decay as the simulation fraying because the player exceeded its believable bounds. The recurring NPC and the recycle seam are leaned into as the horror TELL, not hidden.',
      examples: ['SKYBOX_PLAYBOOK.md'],
      status: 'recurring',
    },
    {
      name: 'The escape that dead-ends (narrative spine)',
      purpose: ['game_loop', 'world_gen'],
      description:
        'The thematic WHY: the protagonist is always "looking to get away from this shitty place" and the world is built so escape always LOOKS in reach but both ends dead-end — the coast kills you for reaching, the road folds you home. Geography as metaphor for the life that won`t let you leave (opening arc req_0375); PROTECT-THE-ZERO (V22) as level design. The void is the central metaphor, not a bolted-on boundary. Build the seams bleak.',
      examples: ['SKYBOX_PLAYBOOK.md'],
      status: 'recurring',
    },
    {
      name: 'The Fold / treadmill (outward stretches, inward folds)',
      purpose: ['world_gen', 'vehicle'],
      description:
        'Road-void distance is psychological, not physical: true position clamped, scenery recycled, instruments lying, return collapses to a nearby seam. Bounds the simulation (perf win) while selling endless travel; resources stay real so death is real "100km out" while 2 blocks from home.',
      examples: ['SKYBOX_PLAYBOOK.md'],
      status: 'recurring',
    },
    {
      name: 'One scalar fans out to many systems',
      purpose: ['world_gen', 'rendering'],
      description:
        'escape_depth -> voidDistortion() -> per-consumer weights. The director/intensity pattern: a single registered value modulates traffic, NPC orientation, controls, sky, dialogue, spawns, road repetition, awareness, and instrument lies — none owning its own distance check (repo no-magic-values law).',
      examples: ['SKYBOX_PLAYBOOK.md'],
      promoteTo: 'voidDistortion',
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'Believability-decay is NOT notoriety',
      purpose: ['perception', 'world_gen'],
      description:
        'Two separate axes. Coast = overt social heat the player earned (notoriety -> apache). Road void = covert environmental decay (escape_depth) the player never agreed to, with NO warning UI. Conflating them kills the horror. At extreme depth the void corrupts the awareness system — that is the void acting on notoriety, not notoriety causing the void.',
      evidence: ['SKYBOX_PLAYBOOK.md §Design disciplines', 'req_1099', 'req_1101'],
      fix: 'Keep escape_depth and the notoriety blend as independent inputs; the road void must never raise a heat star.',
      severity: 'high',
    },
    {
      name: 'Instruments lie but never decide',
      purpose: ['ui', 'world_gen'],
      description:
        'There is ONE true escape_depth. Odometer/GPS/minimap/distance-meter are lying VIEWS over it via instrumentLie corruption and may disagree with each other and reality. If an instrument becomes its own source of truth, the treadmill and wrongness curve desync.',
      evidence: ['SKYBOX_PLAYBOOK.md §4', 'req_1104'],
      fix: 'Render reported distance through a per-instrument corruption fn; gameplay/wrongness always read the true accumulator.',
      severity: 'high',
    },
    {
      name: 'Distortion + fold inconsistency must be seeded, never random',
      purpose: ['chance', 'world_gen'],
      description:
        'The "sometimes 3 turns before the city appears" inconsistency and every distortion weight must be a pure seeded function of (depth, seed, position, time). Math.random breaks leaderboard fairness/replay and violates V30 f(seed,t,log).',
      evidence: ['SKYBOX_PLAYBOOK.md §4', 'req_1104'],
      severity: 'medium',
    },
    {
      name: 'No hand-outs: positional wrongness, consumable healing',
      purpose: ['game_loop'],
      description:
        'Environmental wrongness eases as you drive back (positional, f(escape_depth)) but player damage/resources do NOT auto-refund — healing is by food/items only. Resource exhaustion is the intended governor; do NOT add an auto-heal-on-return or an invisible distance wall. The return trip is the boss.',
      evidence: ['SKYBOX_PLAYBOOK.md §3', 'req_1102'],
      severity: 'high',
    },
    {
      name: 'LLM enrichment never touches numbers (V22 P2)',
      purpose: ['agent_llm', 'game_loop'],
      description:
        'The Endless Passenger / any useAssistant enrichment outputs TEXT ONLY — pure ambiance. It must never set flags, complete a mission, spend money, change state, or steer a mechanic except through a validated (text, world_delta) narrative hook. Free model text drives nothing but the player`s ears. Also: enrichment is opt-in with a canned/looping fallback — the mechanic must exist and ship/play offline without any model.',
      evidence: ['SKYBOX_PLAYBOOK.md §8', 'req_1108', 'DECISIONS V22'],
      fix: 'Route any world effect through the structured (text, world_delta) hook + validator; never parse mechanics out of free LLM text.',
      severity: 'high',
    },
    {
      name: 'The coast stays Euclidean — fold is road-only',
      purpose: ['world_gen'],
      description:
        'The treadmill/fold applies ONLY to the road void. The coast is a real water-gap crossing with a real achievement; if its geography folds, surviving the crossing means nothing.',
      evidence: ['SKYBOX_PLAYBOOK.md §1', 'req_1103'],
      severity: 'medium',
    },
  ],
};
