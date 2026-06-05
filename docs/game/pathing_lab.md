# pathing_lab — host A* + road grammar + deterministic traffic, all systems integrated

**Cart file:** `cart/pathing_lab/index.tsx` (single file, ~1,230 lines)
**Ship:** `./scripts/ship pathing_lab` · Dev: `./scripts/dev pathing_lab` (NOTE: `__path_*` is a Zig binding — the dev host must be REBUILT once after it lands; the cart shows a red banner if `__path_set_grid` is missing)
**Capability under test:** the host `__path_*` fns via `runtime/pathing.ts`. CAPTURED (V5, 2026-06-05): the implementation now lives in `framework/game/pathing.zig` behind `framework/v8_bindings_game_pathing.zig` (`v8_bindings_pathing.zig` deleted; the `__path_*` names persist + honest `__game_pathing_*` aliases), and this lab's lane discipline moved HOST-side — see `cart/hmsc-int/game/pathing.CAPTURE.md`.
**Imports from everywhere (this is the integration cart):** head_lab (`parts`, `ragdoll`, `hed`, `figureRender`), `vehicle_lab` (`buildVehicle`/`makeVehicle`/`VEHICLE_STYLES`/`geometryFor`), hmsc (`world/tileKinds`, `world/traffic`), `runtime/motion.ts`, `runtime/pathing.ts`, `@reactjit/cameras` (`OrbitCamera` + `solveCamera`/`unprojectGround` for click-picking)

## What it is, in one sentence

The reference implementation of the **road grammar** (the user-specified, LOCKED lane/junction/crosswalk rules) running on **host-side A\*** with **deterministic car motion**: a 44×44 city block authored in real hmsc tile kinds, published once to the Zig host, with vehicle_lab sedans and head_lab pedestrians that compute paths once and only recompute when the world actually changes under them — and a car that clips a pedestrian hands the body to the Verlet ragdoll, which settles, gets up, and asks for a fresh path home.

## Architecture: who owns what

- **Host (Zig, now `framework/game/pathing.zig` via the `v8_bindings_game_pathing.zig` registrar):** the grid (`__path_set_grid`), per-profile tile costs (`__path_set_profile` with laneOffset/againstFlow/crossFlow), the flow table (`__path_set_flows`), A* + waypoint simplification (`__path_find` — returns into reused scratch), grid patches (`__path_fill_rect`/`__path_update_cells`), and a monotone `__path_generation` counter.
- **`runtime/pathing.ts` (JS face):** typed wrappers + the **disruption test**: every grid patch records a world-space change rect in a bounded ring (64); `pathDisrupted(path, nextIdx)` answers "did any change since my path's generation touch my REMAINING waypoints" — so one dropped barrier re-paths only the agents actually routed through it. Importing this file is what opts the cart into the `pathing` ingredient (metafile gate).
- **`runtime/motion.ts`:** deterministic motion along a polyline — trapezoidal velocity schedule (corner caps from turn angles → backward brake pass → forward throttle pass → closed-form accel/cruise/brake phases). `sampleMotion(plan, t)` is exact for ANY t: frame-rate independent, rewindable, identical on every machine. Position, speed, accel, and arc-distance (odometry) are pure functions of time; **only interruptions create new state**.
- **The cart:** world authoring, behavioral cost shaping, lane discipline post-processing, the yield monitor, goal selection, agent state machines, rendering.

## The world — road grammar in tile kinds (the LOCKED grammar, in code)

`buildWorld()` authors a Uint16Array of `hmsc/world/tileKinds` indices:

- **Lane trios:** road bands are SIX cells wide = two 3-tile directional trios (`laneWest×3 | laneEast×3` horizontal; `laneSouth×3 | laneNorth×3` vertical, right-hand rule). The in-code comment preserves the two hard-won rules: (1) a 1-tile lane can't fit a 1.8 m sedan → oncoming traffic froze nose-to-nose (the citywide gridlock); (2) **the WHOLE trio carries flow** — flow-less 'road' shoulders were a legal wrong-way loophole A* happily exploited.
- **Junction tiles:** crossings are painted `'junction'` (flow-neutral) — *the grid itself knows where intersections are*. Junction boxes are then **clustered from the tiles** by flood-fill (works for any map shape, not just these bands).
- **Crosswalks:** zebra bands 2 cells deep just OUTSIDE every junction edge — simultaneously the only sane pedestrian crossing AND the cars' stop line.
- **Sidewalks 2 tiles wide:** the ring-derivation pass runs twice (second ring seeds off the first) so walkers can pass each other and every crosswalk mouth lands on pavement.
- Plus wall rects (buildings), seeded bushes, and run-length-merged render strips (rows of same-kind tiles → one box mesh each; colors/heights from `tileKindDefinition().render`).

## Cost profiles — legality from hmsc, sanity from the lab

`profileCosts(mode)` evaluates **the same formula as hmsc's JS `movementCostForCell`** (walkable/traversable/allowedModes gating, walkCost|vehicleCost × movementCost, door openCost, narrow-width tax) once per KIND instead of once per A* node — then multiplies by `PROFILE_TUNING`, the behavioral layer answering "would a sane agent" on top of "can this agent": walkers get sidewalk 0.45 / crosswalk 0.4 (the zebra undercuts even the sidewalk, funneling every crossing onto it) and road 12× ("jaywalking into 50 km/h traffic stops being a lifestyle"); drivers get lanes/junction/crosswalk at 1, shoulder 1.6×, and everything off-road hard-blocked. This is explicitly the FLOW-HINT slice hmsc's `world/pathing.ts` reserves.

**The flow table** maps lane-kind indices to `PATH_FLOW.posX/negX/posZ/negZ`; the vehicle profile sets `againstFlow: 30, crossFlow: 30` — the comment records that at 4× a mid-block U-turn was CHEAPER than going around the block ("rational asshole behavior"). Direction changes happen in flow-neutral junction tiles, where they belong. Pedestrians get `laneOffset: 0.18` (host shifts waypoints toward travel-right so opposite walkers take opposite edges); vehicles get laneOffset 0 because the lane-center tile IS the lane line.

## Lane discipline — two JS post-passes over host paths (with probe-verified history)

1. **`snapToLaneCenters`:** A* may route through any of a trio's three columns (uniform cost) — cars ended up riding side by side. Snap every road waypoint to the trio's marked center line, deriving the side **from direction of travel** (right-hand rule), not from whichever column A* wandered through — a position-based snap pinned flow-neutral crosswalk points to the WRONG lane line (the "|Vxx^| swerves").
2. **`straightenJunctions`:** A* staircases through flow-neutral boxes have equal cost, and the tie-break cut the near corner — dragging left turns across the oncoming half. Replace all in-box waypoints with the single **lane-line apex** (exit lane's column × entry lane's row — early for a right turn, deep past center for a left), computed from the BOX's own geometry + entry/exit directions, NEVER from raw waypoint coordinates (coordinate-derived apexes compounded junction by junction until cars rode the sidewalk line — **probe-verified: 8/41 routes violated; box-derived apexes: 0/89**).

`buildCarRoute` = live position first (never snapped — the car merges onto the line over the first segment) + snapped points + dedupe + apexes + dedupe.

## Cars — "pre-calculated until disrupted" squared

A car is a vehicle_lab build driven by a **deterministic motion plan**: route from host pathing, speed/distance schedule from `planMotion`, and per tick exactly ONE `sampleMotion(plan, now)` read — zero integration. On top:

- **Yield monitor** (checks the world, touches the plan only on change): nearest-reason-to-stop in meters ahead, min over (a) pedestrians in the corridor; (b) **a walker ON a crosswalk owns the road** — stop short of the whole zebra band regardless of the light; (c) queue-ahead cars (same-direction filter, crossing tie-break by index when both stopped); (d) red/caution signals — the stop line is BEFORE the crosswalk band, not the box edge, and caution inside the too-late window rolls through. A `reckless` toggle disables ped/crosswalk yielding ("the old chaos").
- **Interruption rules — the ONLY plan writes:** `tighter` (new/closer obstacle), `cleared` (light green / ped moved on), `creep` (queue advanced while nearly stopped) → re-plan over `slicePoints(route, progress, targetEndS)` re-anchored at the sampled state; arrival → null plan → next tick picks a fresh goal. An `interruptions` counter is the lab's headline stat.
- **Goal selection is ahead-only AND flow-aligned** (`pickGoalAhead`): a goal "15 m ahead on the westbound lane" is geometrically ahead but legally requires driving past it and U-turning — so a goal's lane flow must agree with the arrival bearing; then no destination ever demands a reversal.
- **Rendering:** `PlacedVehicle` feeds the vehicle's DSL channels from physics — wheel `spin_loop` phase from the ODOMETER (distance/circumference — deterministic), `steer_loop` from tangent error, `brake` nose-dip from the plan's current decel. Mesh yaw +180 (vehicle_lab hood at −Z, same convention as the figure). Cars are ~45 meshes each → MAX_CARS 8 is an explicit budget.
- **Signals:** `TrafficLights` renders one pole per junction with two 3-lamp heads running hmsc's `TRAFFIC_SIGNAL_CYCLE` off `trafficClockSeconds()` — the SAME clock and phase function the cars' yield check reads (axis 0/1 offset by a half period, exactly hmsc's `signalPhaseOffsetSeconds`). The lamps are live phase readouts, not decoration.

## Pedestrians — walk / ragdoll / recover state machine

- **walk:** host path (PED_PROFILE) waypoint-following at 1.5 m/s with yaw easing; goals from the sidewalk pool.
- **Collision → ragdoll:** a car over 2.5 m/s whose corridor overlaps a walking ped builds the CURRENT mid-stride skeleton (`buildSkeleton('neutral','walk', gait)` → `placeBones`), seeds `createRagdoll` from it, and kicks pelvis/chest/head/hips with the car's velocity vector (`ragdollImpulse`) — speed-gated so a stopped bumper nudges nobody into orbit.
- **ragdoll:** `stepRagdoll` with arena walls; settled (`ragdollMaxMotion < 0.0025` for 45 ticks) → capture `bonesFromRagdoll` as recoverFrom, stand-pose-at-rest-position as recoverTarget.
- **recover:** 0.8 s smoothstepped `blendBones` get-up, then back to walk — with `path = null`, so the next tick asks the host for a fresh route home.
- Every frame, each ped's bones (whichever source) feed `buildRigFrameFromBones` — the head_lab "bones ARE the pose" seam carrying the full dressed figure (5 outfit presets, 4 generated characters with `CharacterCaptures` bakes parked offscreen).

## Disruption — the click

Click a tile (orbit-drag vs click disambiguated by a 6 px movement threshold) → `unprojectGround` through `solveCamera(Orbit, ...)` (the cameras registry's generic picking inverse) → toggle a barrier: `fillPathRect(cx, cz, 1, 1, wall)` patches the HOST grid and bumps the generation. The tick's disruption sweep runs only when the generation moved, calls `pathDisrupted` per agent, and re-paths (peds) or marks `pathDirty` (cars — reroute+replan next tick, same goal). Repath/interruption/hit counters + a 6-line event log narrate it on the panel.

## What it does NOT use

No hmsc humanoid (head_lab kit), no `__hmsc_*` physics, no localstore, no telemetry hook (its counters are its own), no StaticSurface beyond CharacterCaptures, no Tailwind. Notably: ped-vs-ped collision, car-vs-car contact physics, and any persistence are out of scope.

## Recurring shapes (glossary candidates)

1. **Pre-calculated until disrupted** — compute once, follow, re-ask ONLY when a recorded change rect intersects your remaining route. Generation counter + bounded change ring + per-agent remaining-segments test. The repo's standing answer to N-agent pathfinding cost.
2. **Deterministic motion plans** — position as a closed-form function of time between interruptions; interruptions re-anchor at the sampled state. Pairs with #1 as "plan once" for the time domain. Odometry-driven animation (wheel spin) falls out free.
3. **Publish-the-world-once host service** — cart authors the grid in JS, ships it via one host call, host owns the hot loop (A*). Same shape as `__hmsc_register_heightfield` (physics) and the instanced-batch ship (rendering): one bulk transfer, then queries.
4. **Legality vs sanity cost split** — tile definitions answer CAN, profile tuning answers WOULD. Behavioral shaping lives in multipliers (×0 block, <1 prefer, >1 discourage), never in new tile kinds.
5. **Grammar in the grid** — direction (flow trios), intersections (junction tiles), crossing rules (crosswalk tiles) are all TILE DATA; geometry derives from clustering, never hardcoded. The road grammar is paint.
6. **Structural-over-observed derivation** — twice burned, twice fixed: lane side from direction of travel (not observed column), apexes from box geometry (not observed waypoints). When A* output is legal-but-ambiguous, derive discipline from structure.
7. **Yield monitor + interruption taxonomy** — tighter/cleared/creep as the only mutation triggers; everything else is read-only checking. A clean pattern for "reactive control over deterministic plans."
8. **Cross-cart composition** — head_lab bones+ragdoll+figures, vehicle_lab builds+DSL channels, hmsc tile kinds+traffic clock, cameras registry picking, host pathing — one cart, six subsystems, no forks. The integration proof preceding hmsc adoption.
9. **Capability-missing banner** — probe the host fn (`typeof __path_set_grid === 'function'`), render a rebuild banner instead of crashing. The Zig-binding-freshness footgun, handled in-product.
10. **Drag-vs-click threshold** (moved < 6 px = click) on the same Pressable — orbit and picking coexist on one surface.
11. Plus repeats: rAF-probe/setTimeout loop, sim-in-ref + dummy setTick, seeded PRNG, memo'd static world meshes, ref-mirrored UI state for the loop (`uiRef`), offscreen capture parking.

## Quirks / honest caveats

- The traffic-light phase is read fresh each tick but cars only re-plan on interruption-class changes — a light flipping red between yield checks is caught next tick (16 ms), fine here.
- Ped walking is per-tick integration (not motion plans) — the deterministic treatment is cars-only so far; unifying walkers onto plans is an open consolidation.
- `pickGoalAhead`'s relaxed fallback can still hand a goal whose path doubles back if the strict pass exhausts 28 tries — rare on this map, worth knowing before porting to denser maps.
- Lane discipline (snap + apex) is cart-side JS over host paths; if hmsc adopts host pathing for traffic, this logic should move into the host or `runtime/pathing.ts` rather than be copy-pasted per cart — it encodes the road grammar's hardest-won lessons (the two probe-verified bug histories are in comments at `snapToLaneCenters` and `straightenJunctions`).
- World re-publishes on every `world`/`hostReady` change — both stable here, but the effect dependency means a hot-reload re-publish wipes live barriers from the host grid while `s.barriers` still lists them (cosmetic desync until cleared).
