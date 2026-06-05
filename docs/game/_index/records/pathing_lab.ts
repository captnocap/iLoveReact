import type { DocIndex } from '../types';

export const pathing_lab: DocIndex = {
  name: 'pathing_lab',
  file: 'pathing_lab.md',
  cart: 'cart/pathing_lab/index.tsx',
  purpose: ['pathing', 'ai_navigation', 'vehicle', 'character', 'ragdoll', 'world_gen'],
  loc: 1230,
  summary:
    'The reference implementation of the road grammar (LOCKED lane/junction/crosswalk rules) running on host-side A* with deterministic car motion: a 44x44 hmsc-tile city published once to the Zig host, with vehicle_lab sedans and head_lab pedestrians that compute paths once and recompute only when the world changes under them, and car-vs-ped collisions handed to the Verlet ragdoll.',
  interfaces: [
    {
      name: '__path_set_grid',
      purpose: ['pathing', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_game_pathing.zig',
      description: 'Host binding that publishes the tile grid to the Zig pathing service.',
      consumers: ['runtime/pathing.ts'],
      status: 'live',
    },
    {
      name: '__path_set_profile',
      purpose: ['pathing', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_game_pathing.zig',
      description: 'Sets per-profile tile costs plus laneOffset / againstFlow / crossFlow tuning for an agent profile.',
      consumers: ['runtime/pathing.ts'],
      status: 'live',
    },
    {
      name: '__path_set_flows',
      purpose: ['pathing', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_game_pathing.zig',
      description: 'Publishes the flow table mapping lane-kind indices to directional flow.',
      consumers: ['runtime/pathing.ts'],
      status: 'live',
    },
    {
      name: '__path_find',
      purpose: ['pathing', 'ai_navigation', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_game_pathing.zig',
      description: 'A* + waypoint simplification; returns into reused scratch. CAPTURED (V5, 2026-06-05): implementation in framework/game/pathing.zig behind the game_pathing gate; legacy __path_* names persist, honest __game_pathing_* aliases added; lane discipline now applies host-side when kind classes are published.',
      consumers: ['runtime/pathing.ts'],
      status: 'live',
    },
    {
      name: '__path_fill_rect',
      purpose: ['pathing', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_game_pathing.zig',
      description: 'Grid patch: fills a rectangle of cells with a tile kind and bumps the generation counter.',
      consumers: ['runtime/pathing.ts'],
      status: 'live',
    },
    {
      name: '__path_update_cells',
      purpose: ['pathing', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_game_pathing.zig',
      description: 'Grid patch: updates individual cells and bumps the generation counter.',
      consumers: ['runtime/pathing.ts'],
      status: 'live',
    },
    {
      name: '__path_generation',
      purpose: ['pathing', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_game_pathing.zig',
      description: 'Monotone generation counter incremented on every grid patch; drives the disruption test.',
      consumers: ['runtime/pathing.ts'],
      status: 'live',
    },
    {
      name: 'runtime/pathing.ts',
      purpose: ['pathing', 'ai_navigation', 'host_bridge'],
      kind: 'module',
      sourceFile: 'runtime/pathing.ts',
      description:
        'JS face over __path_*: typed wrappers plus the disruption test. Every grid patch records a world-space change rect in a bounded ring (64); pathDisrupted(path, nextIdx) answers whether any change since the path generation touched the remaining waypoints, so one dropped barrier re-paths only the agents routed through it. Importing this file opts the cart into the pathing ingredient (metafile gate).',
      dependsOn: ['__path_set_grid', '__path_set_profile', '__path_set_flows', '__path_find', '__path_generation'],
      consumers: ['cart/pathing_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'pathDisrupted',
      purpose: ['pathing', 'ai_navigation'],
      kind: 'utility',
      sourceFile: 'runtime/pathing.ts',
      description:
        'Answers did any change since my path generation touch my REMAINING waypoints by intersecting the bounded change-rect ring against the agent remaining segments.',
      status: 'live',
    },
    {
      name: 'fillPathRect',
      purpose: ['pathing', 'interaction'],
      kind: 'utility',
      sourceFile: 'runtime/pathing.ts',
      description:
        'Typed wrapper over __path_fill_rect; patches the host grid (e.g. toggles a barrier wall) and bumps the generation.',
      dependsOn: ['__path_fill_rect'],
      status: 'live',
    },
    {
      name: 'runtime/motion.ts',
      purpose: ['vehicle', 'physics', 'math'],
      kind: 'module',
      sourceFile: 'runtime/motion.ts',
      description:
        'Deterministic motion along a polyline: trapezoidal velocity schedule (corner caps from turn angles -> backward brake pass -> forward throttle pass -> closed-form accel/cruise/brake phases). Position, speed, accel, and arc-distance are pure functions of time; only interruptions create new state.',
      consumers: ['cart/pathing_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'planMotion',
      purpose: ['vehicle', 'math'],
      kind: 'utility',
      sourceFile: 'runtime/motion.ts',
      description:
        'Builds the speed/distance schedule for a route polyline (the trapezoidal velocity plan consumed by sampleMotion).',
      status: 'live',
    },
    {
      name: 'sampleMotion',
      purpose: ['vehicle', 'math'],
      kind: 'utility',
      sourceFile: 'runtime/motion.ts',
      description:
        'sampleMotion(plan, t) is exact for ANY t: frame-rate independent, rewindable, identical on every machine. One read per tick, zero integration.',
      dependsOn: ['planMotion'],
      status: 'live',
    },
    {
      name: 'buildWorld',
      purpose: ['world_gen', 'pathing'],
      kind: 'utility',
      sourceFile: 'cart/pathing_lab/index.tsx',
      description:
        'Authors a Uint16Array of hmsc/world/tileKinds indices: six-wide lane trios (two 3-tile directional trios), junction tiles, crosswalk zebra bands, 2-wide sidewalks (ring-derived twice), wall rects, seeded bushes, and run-length-merged render strips.',
      dependsOn: ['tileKinds'],
      status: 'lab',
    },
    {
      name: 'profileCosts',
      purpose: ['pathing', 'ai_navigation'],
      kind: 'utility',
      sourceFile: 'cart/pathing_lab/index.tsx',
      description:
        'profileCosts(mode) evaluates the same formula as hmsc movementCostForCell (walkable/traversable/allowedModes gating, walkCost|vehicleCost x movementCost, door openCost, narrow-width tax) once per KIND, then multiplies by PROFILE_TUNING (the behavioral CAN->WOULD layer: walker sidewalk 0.45 / crosswalk 0.4 / road 12x; driver lanes/junction/crosswalk 1, shoulder 1.6x, off-road blocked).',
      status: 'lab',
    },
    {
      name: 'PROFILE_TUNING',
      purpose: ['pathing', 'ai_navigation'],
      kind: 'data_model',
      sourceFile: 'cart/pathing_lab/index.tsx',
      description:
        'The behavioral multiplier layer answering would a sane agent on top of can this agent. Crosswalk undercuts sidewalk to funnel crossings; road 12x makes jaywalking expensive. Explicitly the FLOW-HINT slice hmsc world/pathing.ts reserves.',
      status: 'lab',
    },
    {
      name: 'snapToLaneCenters',
      purpose: ['pathing', 'vehicle'],
      kind: 'utility',
      sourceFile: 'cart/pathing_lab/index.tsx',
      description:
        'CAPTURED host-side (V5, 2026-06-05 — framework/game/pathing.zig discipline passes; this cart-side copy is now behavior reference only). Post-pass snapping every road waypoint to the trio marked center line, deriving the side from DIRECTION OF TRAVEL (right-hand rule), not from whichever column A* wandered through. A position-based snap pinned flow-neutral crosswalk points to the wrong lane line (the |Vxx^| swerves).',
      status: 'lab',
    },
    {
      name: 'straightenJunctions',
      purpose: ['pathing', 'vehicle'],
      kind: 'utility',
      sourceFile: 'cart/pathing_lab/index.tsx',
      description:
        'CAPTURED host-side (V5, 2026-06-05 — framework/game/pathing.zig discipline passes; this cart-side copy is now behavior reference only). Post-pass replacing all in-box waypoints with the single lane-line apex (exit lane column x entry lane row), computed from the BOX geometry + entry/exit directions, never from raw waypoint coordinates. Probe-verified: coordinate-derived 8/41 routes violated; box-derived apexes 0/89.',
      status: 'lab',
    },
    {
      name: 'buildCarRoute',
      purpose: ['pathing', 'vehicle'],
      kind: 'utility',
      sourceFile: 'cart/pathing_lab/index.tsx',
      description:
        'Composes a drivable route: live position first (never snapped — the car merges onto the line over the first segment) + snapped points + dedupe + apexes + dedupe.',
      dependsOn: ['snapToLaneCenters', 'straightenJunctions'],
      status: 'lab',
    },
    {
      name: 'pickGoalAhead',
      purpose: ['pathing', 'vehicle', 'ai_navigation'],
      kind: 'utility',
      sourceFile: 'cart/pathing_lab/index.tsx',
      description:
        'Goal selection that is ahead-only AND flow-aligned: a goal lane flow must agree with the arrival bearing so no destination demands a reversal. A relaxed fallback after 28 tries can still hand a doubling-back goal.',
      status: 'lab',
    },
    {
      name: 'PlacedVehicle',
      purpose: ['vehicle', 'rendering', 'animation'],
      kind: 'component',
      sourceFile: 'cart/pathing_lab/index.tsx',
      description:
        'Feeds the vehicle DSL channels from physics: wheel spin_loop phase from the ODOMETER (distance/circumference), steer_loop from tangent error, brake nose-dip from the plan current decel. Mesh yaw +180 (vehicle_lab hood at -Z). ~45 meshes per car -> MAX_CARS 8 budget.',
      dependsOn: ['buildVehicle', 'sampleMotion'],
      status: 'lab',
    },
    {
      name: 'TrafficLights',
      purpose: ['vehicle', 'rendering'],
      kind: 'component',
      sourceFile: 'cart/pathing_lab/index.tsx',
      description:
        'One pole per junction with two 3-lamp heads running hmsc TRAFFIC_SIGNAL_CYCLE off trafficClockSeconds() — the SAME clock and phase function (axis 0/1 offset by a half period, hmsc signalPhaseOffsetSeconds) the cars yield check reads. Live phase readouts, not decoration.',
      dependsOn: ['traffic'],
      status: 'lab',
    },
    {
      name: 'buildVehicle / makeVehicle',
      purpose: ['vehicle', 'geometry'],
      kind: 'utility',
      sourceFile: 'cart/vehicle_lab',
      description:
        'vehicle_lab builders (with VEHICLE_STYLES and geometryFor) producing the sedan meshes driven by the deterministic motion plan.',
      consumers: ['cart/pathing_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'tileKinds',
      purpose: ['world_gen', 'pathing'],
      kind: 'registry',
      sourceFile: 'cart/hmsc/world/tileKinds',
      description:
        'hmsc tile-kind registry (tileKindDefinition().render, allowedModes, walkCost/vehicleCost/movementCost) that the lab authors the grid in and derives render strips and cost profiles from.',
      consumers: ['cart/pathing_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'traffic (trafficClockSeconds / TRAFFIC_SIGNAL_CYCLE)',
      purpose: ['vehicle', 'world_gen'],
      kind: 'module',
      sourceFile: 'cart/hmsc/world/traffic',
      description:
        'hmsc traffic clock + signal cycle (trafficClockSeconds, TRAFFIC_SIGNAL_CYCLE, signalPhaseOffsetSeconds) shared by the lab signals and the cars yield check so lamps and yielding read the same phase.',
      consumers: ['cart/pathing_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'OrbitCamera / solveCamera / unprojectGround',
      purpose: ['camera', 'interaction'],
      kind: 'utility',
      sourceFile: '@reactjit/cameras',
      description:
        'Cameras registry: OrbitCamera rig plus solveCamera(Orbit, ...) and the generic unprojectGround picking inverse used to turn a click into a ground tile (drag-vs-click disambiguated by a 6 px threshold).',
      consumers: ['cart/pathing_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'createRagdoll / stepRagdoll / ragdollImpulse',
      purpose: ['ragdoll', 'physics', 'character'],
      kind: 'utility',
      sourceFile: 'cart/head_lab',
      description:
        'head_lab Verlet ragdoll: seeded from the current mid-stride skeleton, kicked (pelvis/chest/head/hips) with the car velocity vector via ragdollImpulse (speed-gated), stepped with arena walls; settled (ragdollMaxMotion < 0.0025 for 45 ticks) -> bonesFromRagdoll capture.',
      dependsOn: ['buildSkeleton', 'placeBones'],
      consumers: ['cart/pathing_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'buildRigFrameFromBones / blendBones',
      purpose: ['character', 'animation', 'ragdoll'],
      kind: 'utility',
      sourceFile: 'cart/head_lab',
      description:
        'The head_lab bones-ARE-the-pose seam: each ped frame feeds bones (walk path, ragdoll, or smoothstepped get-up blendBones) into buildRigFrameFromBones carrying the full dressed figure (5 outfit presets, 4 generated characters with CharacterCaptures bakes parked offscreen).',
      consumers: ['cart/pathing_lab/index.tsx'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Pre-calculated until disrupted',
      purpose: ['pathing', 'ai_navigation'],
      description:
        'Compute once, follow, re-ask ONLY when a recorded change rect intersects your remaining route. Generation counter + bounded change ring + per-agent remaining-segments test. The repo standing answer to N-agent pathfinding cost.',
      examples: ['pathing_lab'],
      status: 'recurring',
    },
    {
      name: 'Deterministic motion plans',
      purpose: ['vehicle', 'math', 'animation'],
      description:
        'Position as a closed-form function of time between interruptions; interruptions re-anchor at the sampled state. Pairs with pre-calculated-until-disrupted in the time domain. Odometry-driven animation (wheel spin) falls out free.',
      examples: ['pathing_lab'],
      promoteTo: 'runtime/motion.ts',
      status: 'resolved',
    },
    {
      name: 'Publish-the-world-once host service',
      purpose: ['pathing', 'host_bridge'],
      description:
        'Cart authors the grid in JS, ships it via one host call, host owns the hot loop (A*). Same shape as __hmsc_register_heightfield (physics) and the instanced-batch ship (rendering): one bulk transfer, then queries.',
      examples: ['pathing_lab', 'hmsc_massive_map_lab'],
      status: 'recurring',
    },
    {
      name: 'Legality vs sanity cost split',
      purpose: ['pathing', 'ai_navigation'],
      description:
        'Tile definitions answer CAN, profile tuning answers WOULD. Behavioral shaping lives in multipliers (x0 block, <1 prefer, >1 discourage), never in new tile kinds.',
      examples: ['pathing_lab'],
      status: 'recurring',
    },
    {
      name: 'Grammar in the grid',
      purpose: ['pathing', 'world_gen'],
      description:
        'Direction (flow trios), intersections (junction tiles), crossing rules (crosswalk tiles) are all TILE DATA; geometry derives from clustering, never hardcoded. The road grammar is paint.',
      examples: ['pathing_lab'],
      status: 'recurring',
    },
    {
      name: 'Structural-over-observed derivation',
      purpose: ['pathing', 'vehicle'],
      description:
        'Twice burned, twice fixed: lane side from direction of travel (not observed column), apexes from box geometry (not observed waypoints). When A* output is legal-but-ambiguous, derive discipline from structure.',
      examples: ['pathing_lab'],
      status: 'recurring',
    },
    {
      name: 'Yield monitor + interruption taxonomy',
      purpose: ['vehicle', 'ai_navigation'],
      description:
        'tighter/cleared/creep as the only mutation triggers; everything else is read-only checking. A clean pattern for reactive control over deterministic plans.',
      examples: ['pathing_lab'],
      status: 'recurring',
    },
    {
      name: 'Cross-cart composition',
      purpose: ['character', 'vehicle', 'pathing'],
      description:
        'head_lab bones+ragdoll+figures, vehicle_lab builds+DSL channels, hmsc tile kinds+traffic clock, cameras registry picking, host pathing — one cart, six subsystems, no forks. The integration proof preceding hmsc adoption.',
      examples: ['pathing_lab'],
      status: 'recurring',
    },
    {
      name: 'Capability-missing banner',
      purpose: ['host_bridge', 'maintenance', 'ui'],
      description:
        'Probe the host fn (typeof __path_set_grid === function), render a rebuild banner instead of crashing. The Zig-binding-freshness footgun, handled in-product.',
      examples: ['pathing_lab'],
      status: 'recurring',
    },
    {
      name: 'Drag-vs-click threshold',
      purpose: ['interaction', 'input'],
      description:
        'moved < 6 px = click on the same Pressable — orbit and picking coexist on one surface.',
      examples: ['pathing_lab'],
      status: 'recurring',
    },
    {
      name: 'rAF-probe / sim-in-ref / seeded-PRNG / offscreen-capture repeats',
      purpose: ['game_loop', 'world_gen', 'character'],
      description:
        'Plus repeats: rAF-probe/setTimeout loop, sim-in-ref + dummy setTick, seeded PRNG, memo-d static world meshes, ref-mirrored UI state for the loop (uiRef), offscreen capture parking.',
      examples: ['pathing_lab'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'World re-publish wipes live barriers',
      purpose: ['pathing', 'host_bridge'],
      description:
        'The world re-publishes on every world/hostReady change. Both are stable here, but a hot-reload re-publish wipes live barriers from the host grid while s.barriers still lists them (cosmetic desync until cleared).',
      evidence: ['pathing_lab.md quirks; world-republish effect dependency'],
      severity: 'medium',
    },
    {
      name: 'Pedestrians use per-tick integration, not motion plans',
      purpose: ['character', 'pathing'],
      description:
        'The deterministic motion-plan treatment is cars-only so far; ped walking is per-tick integration. Unifying walkers onto plans is an open consolidation.',
      evidence: ['pathing_lab.md quirks; walk state 1.5 m/s waypoint-following'],
      fix: 'Open consolidation: move walkers onto runtime/motion.ts plans.',
      severity: 'low',
    },
    {
      name: 'pickGoalAhead fallback can double back',
      purpose: ['pathing', 'vehicle'],
      description:
        'The relaxed fallback can still hand a goal whose path doubles back if the strict pass exhausts 28 tries — rare on this map, worth knowing before porting to denser maps.',
      evidence: ['pathing_lab.md quirks'],
      severity: 'low',
    },
    {
      name: 'Traffic-light flip caught one tick late',
      purpose: ['vehicle'],
      description:
        'The traffic-light phase is read fresh each tick but cars only re-plan on interruption-class changes — a light flipping red between yield checks is caught next tick (16 ms), fine here.',
      evidence: ['pathing_lab.md quirks'],
      severity: 'low',
    },
    {
      name: '__path_* requires a dev-host rebuild',
      purpose: ['host_bridge', 'maintenance'],
      description:
        '__path_* is a Zig binding; the dev host must be REBUILT once after it lands. The cart shows a red banner if __path_set_grid is missing.',
      evidence: ['pathing_lab.md ship/dev header; capability-missing banner'],
      fix: 'Rebuild the dev host once after the binding lands; the in-cart banner flags the stale case.',
      severity: 'medium',
    },
  ],
};
