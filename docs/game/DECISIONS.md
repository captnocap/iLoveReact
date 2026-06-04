# DECISIONS — the ground-floor questionnaire

Purpose: resolve every documented conflict in the game corpus by pointing at the
winning implementation. Answers here become the **baked-in ground floor** for the
ground-up rebuild: one coherent lab-loading interface on top, where testing a new
idea is a short React file — not a new cart that re-rolls a camera, a loop, and a
figure.

How to answer: each question lists candidate implementations as letters with file
references. Write the letter (or a combo like "C = A's surface + B's input") in
the ANSWER slot. "Consensus lean" = what the five recurrence reports converged on;
it is advisory only. Sources: docs/game/*.md, _reports/CONSENSUS.md, _index/.

---

## TIER A — SUBSTRATE (everything else builds on these)

### Q1. 3D physics substrate
Who simulates the game world's bodies?

- **A) The hmsc host sim** — `framework/v8_bindings_physics_lab.zig` (`__hmsc_physics_step`,
  `__hmsc_register_heightfield`): domain-specific, heightfield-aware, packed-f32
  buffer once per frame. LIVE — drives hmsc today via `cart/hmsc/state/hostPhysics.ts`.
- **B) Bullet** — `framework/phys/physics3d.zig` + C shim: general rigid bodies,
  raycast, 8 worlds × 256 bodies. DORMANT — wired to nothing; heightfield stubbed null.
- **C) Verlet-in-cart** — `cart/head_lab/ragdoll.ts`: 15 particles / 24 constraints,
  bones-in/bones-out. LIVE for ragdolls (ragdoll_lab, combat_lab, pathing_lab).
- **D) Layered (the de-facto today):** A for world/locomotion/terrain + C for body
  physics, B stays dormant/deleted.

Consensus lean: D (it's what already ships), with honest renames either way.

ANSWER: ______
If D: keep Bullet dormant for a future revival, or delete the trio? ______

### Q2. Humanoid / player model
One figure stack for every human in the game.

- **A) head_lab kit** — `cart/head_lab/{parts.ts, figureRender.tsx, hed.ts, ragdoll.ts}`:
  sculptable Globe parts, generated/sculpted `.hed` faces, 25 named bones,
  box hitboxes, full clothing/accessories, Verlet ragdoll, semantic anchors.
  Consumers: planet_run, ragdoll_lab, combat_lab, pathing_lab.
- **B) hmsc humanoid** — `cart/hmsc/render3d/humanoid/`: fixed primitive parts,
  baked face decals, 6 capsule damage zones, palette recolors, no physics.
  Consumers: hmsc, hmsc_scale_lab, hmsc_massive_map_lab.
- **C) The combat_lab hybrid** — head_lab geometry/bones/ragdoll + hmsc's
  ZONE_DAMAGE vocabulary (its `boneZone()` already does the rename).
- (For deletion regardless: bodylab's third `solveHumanoid`, the inline parts-array
  copies in animation_lab / camera_lab / input_bench.)

Consensus lean: C — "head_lab geometry + hmsc damage vocabulary".

ANSWER: ______
Q2b. Damage-zone naming, pick the spelling: `armL/armR/legL/legR` (hmsc) or
`lArm/rArm/lLeg/rLeg` (head_lab)? ______
Q2c. Hit volumes: head_lab's oriented boxes or hmsc's capsules? ______

### Q3. Camera
- **A) The registry** — `runtime/cameras/` (`@reactjit/cameras`): pure
  `solve(params)→{pos,target,fov}`, drop-in Orbit/Follow/TopDown/Iso/FirstPerson/
  FreeFly/Cinematic, picking inverts via `unprojectGround`. ~10 cart consumers.
- **B) Hand-rolled trig per cart** — hmsc_scale_lab `cameraFromOrbit`,
  hmsc_massive_map_lab dual-rig, animation_lab, hmsc's own `camera.ts` gameplay cam.
- **C) combat_lab's ADS aim rig** — the only camera that can aim above the horizon
  (fixes hmsc's measured "aim ceiling"); currently cart-local.

Consensus lean: A as the one true system; absorb C into it as a rig; delete B holdouts.

ANSWER: ______
Q3b. Absorb the aim rig into the registry as `AimCamera`/Follow-with-aim? ______
Q3c. Export the generic `screenRay` from the registry (kills 3 hand-rolled copies)? ______

### Q4. World substrate (how the game world is represented & rendered)
- **A) hmsc's system** — tile-kind registries + StaticSurface-baked tile/facade
  textures + per-mesh structures + host heightfield colliders (see-it==walk-it).
- **B) scape's one-quad** — entire tile world in ONE Effect shader (per-fragment
  inverse projection, heightfield-march building extrusion). 2D/2.5D.
- **C) Instanced batches** — `Scene3D.Instances` stride-9, proven at Miami scale
  (hmsc_massive_map_lab: 12.8km × 8km, one draw call).
- **D) Bake direction** — React-authored 3D transpiled to baked Zig world data
  (`feedback_react_3d_is_authoring_not_runtime`; `cli/commands/bake-geometry-auto.ts`).

Note: these compose (A for close-range + C for mass + D as the end-state). The
question is what the GROUND FLOOR commits to for THE game.

ANSWER: ______

### Q5. Pathing / traffic
- **A) Host A\*** — `framework/v8_bindings_pathing.zig` (`__path_*`) +
  `runtime/pathing.ts` (pre-calculated-until-disrupted) + `runtime/motion.ts`
  (deterministic plans). Proven in pathing_lab with full road grammar.
- **B) hmsc's current JS pathing** — `cart/hmsc/world/pathing.ts`
  (movementCostForCell per A* node, JS-side).

Consensus lean: A becomes THE traffic backend; the lane-discipline JS
(snapToLaneCenters / straightenJunctions) migrates host-side or into runtime/pathing.ts
so the road grammar's lessons live once.

ANSWER: ______
Q5b. Walkers join cars on deterministic motion plans (currently cars-only)? ______

### Q6. Animation
- **A) The DSL** — `cart/animationDsl.ts`: `[dur,target,action;...]` strings,
  sin-envelope sampling, alias table already speaks body+vehicle+face.
  Consumers: head_lab, planet_run, vehicle_lab, pathing_lab.
- **B) Per-cart pose tables** — animation_lab's `poseFor`, bodylab's `drivePose`
  (predate the DSL).
- **C) hmsc's gait** — `render3d/humanoid/pose.ts` drivePose (walk cycles; feeds
  the skeleton directly, not via DSL).

Consensus lean: A is the one animation path; B retires. C (gait) stays a pose
*generator* under A's action layer — gait and DSL actions already compose in
head_lab's buildRigFrame.

ANSWER: ______

### Q7. Movement / input integration
Where does WASD become velocity?

- **A) JS-side** — keysRef polled by the cart tick, cart integrates (planet_run,
  pathing_lab peds, scape, most carts).
- **B) Host-side integrator** — `framework/v8_bindings_input_bench.zig`
  (`__input_bench_*`): Zig WASD movement, live as animation_lab's drive mode.
- **C) Host physics owns it** — movement folded into `__hmsc_physics_step`'s
  input Float32Array (hmsc's actual gameplay path).

Consensus lean: none — this fork was surfaced but not adjudicated.

ANSWER: ______

### Q8. Game loop
No conflict — unanimous extraction. Confirm: build `useGameLoop` (rAF-probe →
setTimeout(16) guard + dt-clamp + tick-counter + uiRef mirror) and rebuild all
real-time carts on it; editors keep `setInterval` clocks.

CONFIRM (y/n): ______

---

## TIER B — SYSTEM MERGES

### Q9. Chance / hit-% engine
- **A) scape's** — `cart/scape/systems/chance.ts`: multiplier `ChanceBreakdown`
  (legible WHY-is-it-33%), weapon RangeProfile, tile LoS w/ glass windows.
- **B) hmsc's** — `cart/hmsc/npc/systems/chance.ts`: `hitChance({rangeMeters,
  coverFraction,…})`; combat_lab built the missing `coverFractionOf` producer.
- **C) The documented hybrid** — scape's breakdown surface + hmsc/combat_lab's
  cover-fraction input. Ground-truth-vs-display-warp law stays either way.

Consensus lean: C.

ANSWER: ______

### Q10. Vehicle
- **A) vehicle_lab** — `cart/vehicle_lab/`: `VehicleDoc` + `buildVehicle` +
  semantic `VehiclePartId` (meshes/hitboxes/anchors share one vocabulary),
  styles/roles registries, DSL channels (wheels/steer/brake). Consumer: pathing_lab.
- **B) ragdoll_lab's CarMeshes** — `cart/ragdoll_lab/car.tsx` + separate CAR_HALF
  collision constants. One consumer (itself).
- **C) hmsc's structure cars** — `cart/hmsc/render3d/structures/Car.tsx` + `HMSC_SCALE.car`.

Consensus lean: A is the vehicle module; B/C consume or retire.

ANSWER: ______

### Q11. Item / prop models
- **A) game_item_gallery** — `ITEMS` registry, `model(ctx)` fns (head_lab already
  consumes for held items).
- **B) physics_lab's ITEM_CATALOG** — physics triple host-side + visuals cart-side,
  hand-synced TS↔Zig.
- **C) scape's item modules** — per-item module owning look (WGSL-as-data) + UI + type.
- **D) scape3d's thingymajigger doctrine** — one self-contained file per placed
  object owning mesh+size (memory: migration complete there; scape3d is outside
  this corpus but the doctrine is portable).

ANSWER: ______

### Q12. Perception / NPC awareness
- **A) combat_lab's ladder** — FoV cones, tile-noise hearing, stimulus/lastKnown
  split, upward escalation (the user-specified Hitman model).
- **B) scape's consequence layer** — WitnessMemory / the Case (has consequences,
  no perception).
- **C) Connect them** — A produces, B consumes: one detective loop.

ANSWER: ______

---

## TIER C — CONFIRMATIONS (unanimous, no real competitor — object or initial)

| # | Item | Action |
|---|------|--------|
| C1 | Physics bindings honesty split | `v8_bindings_hmsc_physics.zig` extracted; DORMANT banner (or delete per Q1) on phys/physics3d.zig; fictional header removed | ____ |
| C2 | `__fs_write_bytes`/`__fs_copy` host fn | kill the 3 UTF-8-writeFile workarounds | ____ |
| C3 | One color utility + one V3/clamp/lerp3 math module | retire 8+ re-rolls | ____ |
| C4 | Pixel-icon codec module (`encode/decodeMatrix` + `.64.json`) | one home beside matrix.ts | ____ |
| C5 | `PLAYER_VISUAL_*` exported from the figure module | rulers derive, never transcribe; delete the drifted ScaleLabScene orphan | ____ |
| C6 | Stale-claims pass | car.tsx header, AGENTS.md MapCanvas, massive_map 8192/4096 labels, dead mesh trio, vestigial pixel editor | ____ |
| C7 | Scene3D nested transforms (or one blessed `Part`/`placeLocal` helper) | retire 5+ ModelCtx re-rolls | ____ |
| C8 | `Boxxx` blessed as the 2D batch primitive | pairs with Scene3D.Instances | ____ |
| C9 | YXZ euler knowledge (`T·Ry·Rx·Rz·S`) gets one canonical home + shared `eulerFromQuat` | ____ |
| C10 | Doctrine written down: see-it==hit-it; ground-truth-vs-display; game-loop vs editor-clock idioms | ____ |

---

## TIER D — THE LAB HARNESS (the rebuild target)

### Q13. What is the "one coherent lab loading interface"?
Existing machinery that could be the shell:

- **A) The dev host's own tabs** — `rjit dev <cart>` already pushes carts as tabs
  into one running host with hot reload. The harness = a convention + shared kit,
  not a new shell.
- **B) A labs cart with a registry** — one cart, `LABS` registry (the
  labDefinitions / shitcoin-app-registry pattern), each lab = one exported
  component; picker UI; ships as one binary.
- **C) Cartridge loader** — `runtime/cartridge_loader.ts` (`<Cartridge src>`):
  one host cart dynamically evals lab files as guest modules.

ANSWER: ______

### Q14. What's in the baked ground floor every lab gets for free?
(Mark each in/out — this defines the "short React file" contract.)

- useGameLoop (Q8): ____
- Camera registry incl. aim rig + screenRay picking (Q3): ____
- The figure stack (Q2) with CharacterCaptures auto-mounted: ____
- Vehicle module (Q10): ____
- Host physics + heightfield registration (Q1): ____
- Host pathing + motion plans (Q5): ____
- Animation DSL (Q6): ____
- kinds registries (tiles/props/NPCs) as importable data: ____
- Lab chrome kit (Chip/Knob/MeterRow/panel) + lab environment (skybox/lights/ground): ____
- Telemetry panel + copy-diagnostics button: ____
- Effect/StaticSurface texture system with bake-once discipline baked in: ____

### Q15. Where does the ground floor live?
- **A) `runtime/game/`** — alongside the platform's runtime/ (game = factor of reactjit).
- **B) `cart/game/`** — a cart-side shared package the labs and the game import.
- **C) Split**: engine-grade pieces (loop, cameras, math) → runtime/; game-semantic
  pieces (figure, kinds, chance) → cart/game/.

ANSWER: ______

---

When answered: this file gets a `## VERDICTS` section recording each decision +
rationale, and becomes the constitution for the rebuild. Every lab rebuilt on the
ground floor cites it; anything contradicting a verdict is a bug.
