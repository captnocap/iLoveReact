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

ANSWER: The correct answer isnt here really. C and A are both correct. if you look at the physics_lab this is correct for jumping and gravity and collisions but the ragdoll is also correct for its ragdoll nature and the hitboxes. the ragdoll doesnt have movement or jumping though, so it cant be called the approach, and the physics_lab has no rag doll or hitboxes with the player model we want so its not the correct approach either. but they both are. and then the bullet physics in the combat_lab are still undetermined at this time
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

ANSWER: A
Q2b. Damage-zone naming, pick the spelling: `armL/armR/legL/legR` (hmsc) or
`lArm/rArm/lLeg/rLeg` (head_lab)? head
Q2c. Hit volumes: head_lab's oriented boxes or hmsc's capsules? head

### Q3. Camera
- **A) The registry** — `runtime/cameras/` (`@reactjit/cameras`): pure
  `solve(params)→{pos,target,fov}`, drop-in Orbit/Follow/TopDown/Iso/FirstPerson/
  FreeFly/Cinematic, picking inverts via `unprojectGround`. ~10 cart consumers.
- **B) Hand-rolled trig per cart** — hmsc_scale_lab `cameraFromOrbit`,
  hmsc_massive_map_lab dual-rig, animation_lab, hmsc's own `camera.ts` gameplay cam.
- **C) combat_lab's ADS aim rig** — the only camera that can aim above the horizon
  (fixes hmsc's measured "aim ceiling"); currently cart-local.

Consensus lean: A as the one true system; absorb C into it as a rig; delete B holdouts.

ANSWER: A but C revealed why A is shit i could barely hit head height before hitting a ceiling when aiming
Q3b. Absorb the aim rig into the registry as `AimCamera`/Follow-with-aim? yes
Q3c. Export the generic `screenRay` from the registry (kills 3 hand-rolled copies)? i think so? 

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

ANSWER: We want C performance, with D and A harmonized. the A system is what we are clearly following for gameplay, the tile system IS the system. we want to juice the fuck out of it so we can have a game map the size of gta vice city

### Q5. Pathing / traffic
- **A) Host A\*** — `framework/v8_bindings_pathing.zig` (`__path_*`) +
  `runtime/pathing.ts` (pre-calculated-until-disrupted) + `runtime/motion.ts`
  (deterministic plans). Proven in pathing_lab with full road grammar.
- **B) hmsc's current JS pathing** — `cart/hmsc/world/pathing.ts`
  (movementCostForCell per A* node, JS-side).

Consensus lean: A becomes THE traffic backend; the lane-discipline JS
(snapToLaneCenters / straightenJunctions) migrates host-side or into runtime/pathing.ts
so the road grammar's lessons live once.

ANSWER: whatever we were doing in pathing_lab is the START. we need a real traffic system and a real civilian system. there are parts of this inside of combat_lab also.
Q5b. Walkers join cars on deterministic motion plans (currently cars-only)? the idea is to do this: to have all of npc pathing be deterministic up until there is a change in their game state. this ideally looks like: all paths are precomputed, and the players effect in the world is what changes it. this is why we are building a full dynamic npc state, which you can see inside of combat lab as a start of it along with pathing_lab 

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

ANSWER: A, but the dsl was just me also quickly passing off an idea. the real format for this is to RLE it and keep the animation data very relational so that its quick, no hiccups

### Q7. Movement / input integration
Where does WASD become velocity?

- **A) JS-side** — keysRef polled by the cart tick, cart integrates (planet_run,
  pathing_lab peds, scape, most carts).
- **B) Host-side integrator** — `framework/v8_bindings_input_bench.zig`
  (`__input_bench_*`): Zig WASD movement, live as animation_lab's drive mode.
- **C) Host physics owns it** — movement folded into `__hmsc_physics_step`'s
  input Float32Array (hmsc's actual gameplay path).

Consensus lean: none — this fork was surfaced but not adjudicated.

ANSWER: B was good, but i cant say i used it enough to say it performed well at scale. the C i used the most, and i think both of them as the same thing

### Q8. Game loop
No conflict — unanimous extraction. Confirm: build `useGameLoop` (rAF-probe →
setTimeout(16) guard + dt-clamp + tick-counter + uiRef mirror) and rebuild all
real-time carts on it; editors keep `setInterval` clocks.

CONFIRM (y/n): so idk yet. I do know I want to have the game loop be a set amount of ticks per minute, where every npc state updates to an event channel the likes of useIFTTT and then that is how the behavior is reactive from the players interaction. Something like ~45 ticks a minute with forceful updates (player shoots another player, this is a forced game state tick that can be considered as expected for mutation, otherwise the game state follow a very deterministic path

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

ANSWER: hybrid, and we need to lab this extensively

### Q10. Vehicle
- **A) vehicle_lab** — `cart/vehicle_lab/`: `VehicleDoc` + `buildVehicle` +
  semantic `VehiclePartId` (meshes/hitboxes/anchors share one vocabulary),
  styles/roles registries, DSL channels (wheels/steer/brake). Consumer: pathing_lab.
- **B) ragdoll_lab's CarMeshes** — `cart/ragdoll_lab/car.tsx` + separate CAR_HALF
  collision constants. One consumer (itself).
- **C) hmsc's structure cars** — `cart/hmsc/render3d/structures/Car.tsx` + `HMSC_SCALE.car`.

Consensus lean: A is the vehicle module; B/C consume or retire.

ANSWER: A, this is where our models are coming from like head_lab; as for scale IDK if correct yet, many of the cars need work.

### Q11. Item / prop models
- **A) game_item_gallery** — `ITEMS` registry, `model(ctx)` fns (head_lab already
  consumes for held items).
- **B) physics_lab's ITEM_CATALOG** — physics triple host-side + visuals cart-side,
  hand-synced TS↔Zig.
- **C) scape's item modules** — per-item module owning look (WGSL-as-data) + UI + type.
- **D) scape3d's thingymajigger doctrine** — one self-contained file per placed
  object owning mesh+size (memory: migration complete there; scape3d is outside
  this corpus but the doctrine is portable).

ANSWER: A but idk what B had, i just know that all of A is not to correct scale. the boat is smaller than the player model hand in head_lab alone. 

### Q12. Perception / NPC awareness
- **A) combat_lab's ladder** — FoV cones, tile-noise hearing, stimulus/lastKnown
  split, upward escalation (the user-specified Hitman model).
- **B) scape's consequence layer** — WitnessMemory / the Case (has consequences,
  no perception).
- **C) Connect them** — A produces, B consumes: one detective loop.

ANSWER: C, again we need to work on this, and there is still more internal tooling to make for story/mission/dialog alone. 

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

ANSWER: fresh rewrite of everything. start from the internal tooling and what exists in there today, that is the most concrete 'human has been able to interface and declare where things actually live and how it looks' so this is what i want the end result to look like:
- i can load into the internal tool
- there is a route to labs
- this is a collection of every lab i can instantly load into
- they are short react files, the entire game system is built into the internal tool so that a lab becomes a short scene setup 
- i can leave notes on a lab that the ai who helps is always aware of when referencing
- nothing gets recreated


### Q14. What's in the baked ground floor every lab gets for free?
(Mark each in/out — this defines the "short React file" contract.)

- useGameLoop (Q8): in
- Camera registry incl. aim rig + screenRay picking (Q3): in
- The figure stack (Q2) with CharacterCaptures auto-mounted: in
- Vehicle module (Q10): in
- Host physics + heightfield registration (Q1): in
- Host pathing + motion plans (Q5): in
- Animation DSL (Q6): in
- kinds registries (tiles/props/NPCs) as importable data: in
- Lab chrome kit (Chip/Knob/MeterRow/panel) + lab environment (skybox/lights/ground): in
- Telemetry panel + copy-diagnostics button: in
- Effect/StaticSurface texture system with bake-once discipline baked in: in

### Q15. Where does the ground floor live?
- **A) `runtime/game/`** — alongside the platform's runtime/ (game = factor of reactjit).
- **B) `cart/game/`** — a cart-side shared package the labs and the game import.
- **C) Split**: engine-grade pieces (loop, cameras, math) → runtime/; game-semantic
  pieces (figure, kinds, chance) → cart/game/.

ANSWER: its all the same thing to me. we can keep as hmsc-int and build from there. hmsc should be a compiled game output FROM hmsc-int is the end goal, not needing to write the game as a seperate game. 

---

## VERDICTS (ruled 2026-06-04 — this is the constitution)

Anything contradicting a verdict is a bug. Open items listed at the bottom.

**V1 — Physics is ONE COHERENT SYSTEM, host-side. (REVISED 2026-06-04, second pass.)**
Original ruling said "two layers"; the user corrected it: the right option is ONE
coherent layer/system, not two. The hmsc host sim (physics_lab lineage, `__hmsc_*`)
is the system — locomotion, gravity, collision, AND it absorbs what the ragdoll
side actually contributes, which on honest inspection is: (a) the player model we
want (that's V2's figure, which is data, not physics) and (b) hitboxes. The
ragdoll *effect* itself is a significant but small slice — the player can't even
move/play in it. The Verlet solver is cart-side JavaScript and "likely problematic
the moment it takes a real load" (P1 agrees) — so its BEHAVIOR is the porting
reference, its implementation is not kept: ragdoll becomes a feature of the one
host system, written in Zig, validated by P4 behavior tests against what the JS
solver does today. The bones-in/bones-out seam survives as the interface — the
figure never knows who computed its bones.
Projectile ("bullet") physics remains UNDETERMINED pending the SHOW-ME lab.

**V2 — Player model: the head_lab kit, outright (overrides the consensus lean).**
`cart/head_lab/{parts.ts, figureRender.tsx, hed.ts, ragdoll.ts}` is THE figure
stack. Damage-zone spelling: head_lab's `lArm/rArm/lLeg/rLeg`. Hit volumes:
head_lab's oriented boxes. hmsc's `render3d/humanoid/` retires (its consumers
migrate); bodylab's third solver and the inline parts-array copies
(animation_lab/camera_lab/input_bench) are deleted.

**V2-AMENDED (2026-06-04, second pass): AUTHOR IN JS, BAKE INTO THE HOST.**
head_lab is the choice as the AUTHORING system — but if the model stays
evaluation-based at runtime "we are going to have a real problem." Ruling:
author it in JavaScript (the head_lab editor, the `.hed`/`.body` documents, the
seeded generators — "the variety of life is the right shape"), then the models
are COMPILED (baked) into the host. The game-runtime figure is host-side data —
geometry, textures, skeleton, hitboxes — instantiated by the one physics system
(V1) and the animation system (V6), not re-evaluated through JS per figure per
frame. The current JS evaluation path (per-frame `buildRigFrame`, dyn-geometry
slots, on-the-fly face bakes) remains the EDITOR/LAB preview path only — never
the game path. The bake must preserve the generated variety: seeds/documents in,
compiled population out. (This is P1 applied to characters, and the existing
bake direction — `feedback_react_3d_is_authoring_not_runtime` — made law.)

**V3 — Camera: the registry, but the aim rig exposed it.**
`@reactjit/cameras` is the one system — with the hard finding that the shipped
Follow rig is inadequate for combat ("could barely hit head height before hitting
a ceiling"). The ADS aim rig from combat_lab is absorbed into the registry as a
first-class rig. `screenRay` gets exported (unprojectGround becomes a consumer).
Hand-rolled trig holdouts are deleted.

**V4 — World: the tile system IS the system; juice it to Vice City scale.**
hmsc's tile-kind model (A) is the gameplay substrate — that is what we are
following. The rendering must reach instanced-batch performance (C) harmonized
with the bake direction (D): target is a game map the size of GTA Vice City.
Authoring stays tiles; rendering gets juiced until that map runs.

**V5 — Pathing/NPC: pathing_lab is the START of the real thing.**
Host A* + deterministic motion plans are the foundation for a REAL traffic system
and a REAL civilian system (combat_lab holds more of the NPC-state pieces). The
doctrine: ALL NPC pathing is deterministic until a game-state change — paths
precomputed, and the player's effect on the world is what invalidates them. Full
dynamic NPC state is the goal; combat_lab + pathing_lab are its two seeds.

**V6 — Animation: DSL semantics win; the string format does not.**
The action vocabulary/alias system of `cart/animationDsl.ts` is the path, but the
bracket-string format was a quick pass-off. The real format: RLE'd, relational
animation data — quick, no hiccups. Redesign the storage/runtime representation,
keep the action semantics. Per-cart pose tables retire; gait stays a pose
generator under the action layer.

**V7 — Movement: host-side; B and C are the same thing.**
WASD-becomes-velocity lives in the host. The input_bench integrator (B) and the
physics-step movement (C) unify into ONE host-side movement integrator inside the
physics step. JS keysRef remains only as input transport, never as the integrator.

**V8 — Game loop: two clocks; the game-state tick is the architecture.**
The render-loop hook (useGameLoop) is NOT yet ruled. What IS ruled: the game
state runs on a fixed cadence (~45 state-ticks per minute) where every NPC state
update publishes to an event channel (useIFTTT-like), and player interaction is
what makes behavior reactive. Player actions (e.g. shooting someone) force an
immediate state tick — the expected mutation points. Otherwise the game state
follows a deterministic path. Frame loop (rendering/sim) and game-state tick are
distinct clocks.

**V9 — Chance: the hybrid — and lab it extensively.**
scape's ChanceBreakdown legibility + hmsc/combat_lab's cover-fraction input, one
engine, ground-truth-vs-display law intact. Needs a dedicated lab for extensive
tuning before it's trusted.

**V10 — Vehicle: vehicle_lab is the source, like head_lab is for people.**
`VehicleDoc`/`buildVehicle`/semantic part ids are the model. Scale is NOT yet
verified correct, and many cars need work. CarMeshes and the hmsc structure cars
retire into it.

**V11 — Items: game_item_gallery, with a mandatory scale audit.**
The ITEMS registry is the source — but its scale is known-broken (the boat is
smaller than the player model's hand). Every item gets audited against the scale
contract. physics_lab's catalog folds in after review.

**V12 — Perception: connect the two halves into one detective loop.**
combat_lab's perception ladder produces; scape's consequence layer (WitnessMemory/
the Case) consumes. More internal tooling is still needed for story/mission/dialog.

**V16 — Cutscenes: live, declarative, never baked. (Added 2026-06-04, second pass.)**
The gameplay-scene vision: piece together head_lab (talking faces), tile
coordinates, cameras, the animation DSL, and pathing — correctly — and a whole
cutscene becomes a SIMPLE TYPESCRIPT FILE: what tile-space the camera occupies at
what time, the dialog, the movement of models, everything. Cutscenes are never
baked in — they are live, in the game, and therefore show the player's current
state (clothes, model changes). Implications:
- camera_lab's breadth of rigs/PoVs is RETAINED for cinematic work (this answers
  why the registry keeps more than the gameplay cams — cutscene PoV needs them).
- The composition is natively deterministic: motion plans are closed-form in t,
  DSL timelines sample at t, camera solves are pure — a cutscene is one clock
  driving all of them (the RLE/determinism value, resolution #6, applied to
  scenes).
- "Never baked" applies to the SCENE, not the actors: V2-amended figures are
  still baked host data — the cutscene drives those live instances.
- This is a ground-floor consumer: the cutscene file format is a lab to build in
  the rebuilt harness (V13), sitting beside story/mission/dialog tooling (V12).

**V17 — The lab shape: GAME_* standard imports + scaffold script. (Added 2026-06-04.)**
A new lab is a SCAFFOLD FROM A SCRIPT, so every lab carries the same shape:

    import { GAME_PHYSICS, GAME_PATHING, GAME_INPUT, GAME_CAMERA, ... } from <the ground floor>

The GAME_* names are STANDARD — the canonical list is STRUCTURE.md's
`game/index.ts` door (the V14 ground floor plus the later-added systems). Everything
arrives ready to use; the lab just exports itself and can be loaded (the V13
labs route). Host changes to test = rebuild the host — fine, that's the deal.
**Installing this shape is the FIRST build task of the rebuild** — the shape
must be a real thing before any lab is rebuilt onto it.

**V17-LIFECYCLE (clarified 2026-06-04): capture → rewrite → archive.**
ALL existing labs will be rewritten as the new lab approach. Old lab carts are
SOURCES to capture from, never things to migrate in place. Once a system is
captured — and after the ENTIRE declared corpus is captured — the labs are
rewritten as new drop-ins and the old carts are ARCHIVED: locked up and away,
read-only, the `archive/`/`tsz/` treatment. After that, "make a lab" is ONE
COHERENT IDEA — there is the lab shape and there is the archive, never an old
approach and a new one. An agent extending an old lab cart instead of
capturing it has gone wrong. (One deliberate carve-out: Milestone 0's
build-order step 6 rebuilds the FIRST lab early as the contract proof — that
single early rebuild is the explicit exception to the after-the-ENTIRE-corpus
rule.)

**V17-TRIAGE (clarified 2026-06-04): some "labs" are dev tooling — they become
editors/ routes, and capture means REWRITING, never moving files.**
head_lab is both an idea AND the place characters get built: its kit captures
into `game/figure/`, its authoring interface is REMADE as an `editors/` route
INSIDE the tool (not ad-hoc external tooling beside it), and only the
test-scene idea becomes a lab. Every old cart triages into some combination of
SYSTEM (`game/`), EDITOR (`editors/`), LAB (`labs/`), or archive-only. And in
every case the files are REWRITTEN — the existing files are sparse, spread-out
logic; they are behavior references only (the V1 Verlet relationship), written
fresh to the constitution's bar (P2/P3/P4). A `git mv` into the new structure
is the capture done wrong.

**V18 — Game Zig is organized, properly named, and CONDITIONAL all the way through. (Added 2026-06-04.)**
"reactjit is the same project and isn't the same project": the framework is
mostly organized (the `v8_bindings_<capability>.zig` convention + `gpu/`,
`phys/`, `ffi/` subdirs) — EXCEPT the recent game changes, which are ad-hoc.
The game's Zig follows the same convention as the rest of the framework:
implementation logic lives in a proper module home (e.g. `framework/game/` —
physics, movement, pathing already half-exists in `v8_bindings_pathing.zig`),
bindings files are thin registrars with honest capability names
(`v8_bindings_game_physics.zig`, not `v8_bindings_physics_lab.zig`;
movement out of `v8_bindings_input_bench.zig`). This executes C1/R1's rename
mandate as part of a real structure, not a one-off rename.

AND the host-binding/source-code rule applies STRICTLY across the board: the
game is a gated INGREDIENT like every other capability. A 2D interface cart has
no use for anything the game introduces, so it is all conditional — exactly how
the greater system already works: declared in `sdk/dependency-registry.json`,
flipped by the metafile-gate walker when a cart actually imports the `GAME_*`
ground floor, compiled behind `has-game*` gates in build.zig (never an
unconditional `addImport`). Importing `cart/hmsc-int/game/` (the `@game` alias)
is what opts a binary into
the game's bindings; sweatshop/tui/chat carts pay zero bytes and zero host fns
for the game's existence. Follow this through all the way — no exceptions, no
"cheap dep" carve-outs.

**V8-CLARIFIED (2026-06-04, third pass): the tick is a RECONCILIATION cadence,
not a simulation rate.** ~45/min means MINUTE (state ticks are strategic; frames
are the other clock). The world runs on closed-form plans sampled at render; the
tick drains scheduled invalidations and verifies state-vs-plan alignment.
Perturbations compute their blast radius AT INSERTION TIME (plans are queryable
futures — intersect, don't discover); unaffected entities are never iterated.
Forced ticks = perturbation insertion. The cadence bounds indirect-consequence
staleness (~1.3s worst case); force-vs-wait rule: visible/audible direct contact
forces, everything else drains. The user's framing: 45 predetermined check-ins
that ensure game state is aligned with the world — derailed cars get fucked up
while cars outside the causal cone never know anything happened.

**V21 — Population homeostasis (the NPC "GC") + ambient pathing as a token
dictionary. (Added 2026-06-04, from the design session.)**
The ambient world maintains DISTRIBUTIONS, not individuals. NPCs are seeded
samples (district × time × slot), spawned/collected at the perception boundary,
in fixed pools with zero allocation (death = slot return + GENERATION BUMP —
all future-scheduled references are (slot, generation) handles; stale events
drop on mismatch). Identity exists only by PROMOTION — witness, mission, story,
cascade (the V12 reference set) — and decays back to ambient when references
expire. Massacres depress local population on a tunable refill curve (P2 knob),
never instant. Game state = seed + perturbation log + tenured set; everything
ambient is derivable, therefore stateless, therefore never saved.
AMBIENT PATHING (the user's model): NPCs never pathfind — they do NEXT-TOKEN
SELECTION over a baked dictionary of many small MICRO-PATHS (segments +
junction transition tables, distilled at bake time from offline goal-directed
simulation; V4 bake doctrine applied to motion). The machine picks the next
most probable micro-path in accordance with the player's state changes to the
world: perturbation = mask the blocked tokens + renormalize (no detour
computation); temperature per archetype/district/hour is a P2 tuning knob;
heat (wanted level) is one more conditioning column — cops up, civilians toward
zero, convergence bias toward the player; promotion budget caps how many cops
are real agents vs crowd texture. Identity is lazily evaluated: distribution at
distance, instance in the bubble, individual under attention; no-doubles
constraint within one attention window; spawn-bias plays (the GTA rare-car
effect) are deliberate, scriptable knobs.
SHOW-ME: what counts as a promotion-worthy interaction is a game-feel question
— a lab, not an architecture ruling.

**V19 — The compile is always green and LLM-callable. (Added 2026-06-04.)**
It would suck ass to build something great and discover at the compile button
that the game output isn't carrying the feature or doesn't work at all. So:
- The game compile is a CLI any LLM can run at any time — compile constantly,
  "make sure it compiles" is a standing duty, not a milestone gate.
- LLMs can also LOAD RUNTIME TESTS into the output — compile → boot headless →
  run behavior tests (P4) → exit with a verdict. The dev flow never waits on
  the user to press a button.
- A feature isn't "done in the tool" — it's done when the COMPILED GAME carries
  it and the verify run proves it.
- **GREEN HAS AN EXPLICIT MEANING (clarified 2026-06-04).** The entire testing
  surface is REPLAYABLE all the time and DEEP: if we need to test anything, we
  can SCRIPT it. The console commands already in hmsc move into the internal
  tooling (`game/commands/`) and double as the test scripting language — a
  verify script is a recorded/saved command sequence, replayed headless.

**V20 — Persistence: stateless, micro-saved, with an UNBREAKABLE total history. (Added 2026-06-04.)**
The workspace behavior (stateless design, saved at every micro change,
historical undo) is the floor — extended:
- History is PERSISTENT ACROSS ALL SESSIONS, one total undo chain that CANNOT
  break when something new is introduced. Ten days of bad changes → step right
  back to the point it went bad, with zero "did I save it in that state"
  anxiety. Disk cost is accepted for development.
- The storage shape: a LOG THAT SPLITS ITS CONCERNS — a state update writes to
  its specific workspace storage (per-concern append-only streams: world edits,
  character edits, tuning changes, ...), never one monolithic blob.
- Why this satisfies "can't break": append-only streams are never rewritten —
  an undo point is a log position; a NEW feature adds a NEW stream and old
  streams stay valid forever (schema evolution by addition, not migration).
- What the game LOADS is not the history: compile/ consumes materialized
  snapshots of the streams. The log is for the tool and the time machine;
  the snapshot is for the game.
- Streams are NOT git-tracked (gitignored; explicit backup/export story —
  git is the code time machine, streams are the content time machine). And
  **the snapshot system GROWS with the addition of any tracking**: a new
  stream without snapshot support is an incomplete change.
- This is the storage twin of V8's event-channel state tick and R6's
  RLE/determinism — the whole system is event-shaped; storage just stops
  pretending otherwise.

**Tier C — accepted by default** (no objection raised). C1's dormant-vs-delete
choice for Bullet inherits Q1's open item; until ruled, the loud DORMANT banner
applies.

**V13/V15 — The harness: a fresh rewrite anchored on the internal tool.**
hmsc-int (the internal tooling) is the most concrete "human has declared where
things actually live" surface, so it is the home. The end state:
- load into the internal tool → a **labs route**
- the labs route is a collection of every lab, instantly loadable
- labs are SHORT React files — the entire game system is built into the internal
  tool, so a lab is just a scene setup
- **per-lab notes** persist and are always surfaced to any AI referencing the lab
- nothing gets recreated
And the endgame inversion: **hmsc the game is a COMPILED OUTPUT of hmsc-int** —
the game is not written as a separate cart; the tool emits it.

**V15-TRANSITION (clarified 2026-06-04): `cart/hmsc` is an EXTRACTION SURFACE.**
Everything is going into one thing — hmsc-int. The playable hmsc is a capture
source exactly like the labs: feature development on it stops; new game work
happens inside hmsc-int's structure; hmsc ends as compile/'s output.

**V14 — The ground floor (everything a lab gets for free): ALL IN.**
useGameLoop-equivalent, camera registry (incl. aim rig + screenRay), the head_lab
figure stack with auto-mounted captures, vehicle module, host physics +
heightfields, host pathing + motion plans, animation system, kinds registries,
lab chrome kit + environment, telemetry + copy-diagnostics, the texture system
with bake-once discipline.

### Open items — RESOLVED (2026-06-04 second pass)

1. **Bullet (the library): KEEP BOTH, let the client decide.** The game uses the
   hmsc phys, not Bullet. And the verdict on naming is blunt: "physics_lab.zig is
   a horrible name" — the C1 honesty split is confirmed and urgent.
2. **Projectile model: UNDECIDED — "someone needs to show me both."** → SHOW-ME
   task: a lab demonstrating geometric vs probabilistic shot paths side by side.
   Note: "this could be bullet tbh" — the projectile sim is a possible revival
   use-case for the dormant Bullet library; include it as a third contender if
   it earns it.
3. **Render-loop hook: ruled to be ruled BY A LAB.** "This is what labs are for
   and why we are doing what we are doing" — the difference between the shapes
   and how other game mechanics play into them isn't knowable on paper. A
   loop-shapes lab joins the SHOW-ME queue; until it rules, the ground floor's
   loop API stays deliberately MINIMAL so nothing is preempted.
4. **Scale: the WORLD SCALE IS SET. 1 tile = 1 meter.** Player collider = 1.65m
   (verified: `HMSC_SCALE.playerCapsuleHeightMeters`, `cart/hmsc/world/scale.ts:8`);
   the 2.04m in the scale labs is the VISUAL head-top (stylized-tall) — collider
   and visual are different layers, both canonical. Vehicle scale/quality is
   ongoing work against this fixed contract, not a blocker.
5. **Items: the IDEAS are on point; the SCALE is trash.** game_item_gallery's
   concepts stay; every model needs real scale work against the 1-tile=1m contract.
6. **RLE/determinism is a GAMEPLAY-WIDE design value, not just animation.**
   "Anything we can do to bring RLE design into the gameplay shape is key —
   determinism is fast, and a lot of things are heavily reused, not unknown."
   Treat as an extension of P1: represent repeated/known sequences as runs, not
   per-frame computation. Applies to animation, NPC schedules, traffic, ambient
   behavior.
7. **screenRay: proceed** (internal code dedup — three carts hand-rolled the same
   click-into-3D math; this just gives it one home. No gameplay implication).

### SHOW-ME queue (demos owed to the user before ruling)
- Projectile lab: geometric vs probabilistic vs (maybe) Bullet-driven, side by side.
- Render-loop hook: 2–3 example shapes.

---

## ARCHITECTURAL PRINCIPLES (ruled 2026-06-04 — apply to every verdict's implementation)

**P1 — Zig owns the brute work. JS authors data; it does not run data.**
No matter how anything folds, the heavy runtime of data is controlled from Zig.
JavaScript has proven to be a really nice AUTHORING layer for data and a bad
RUNTIME for it (the corpus is the evidence: per-frame bridge re-ships, re-render
storms, every perf lab's conclusion). Implementation rule: if a system moves data
every frame, its hot loop is Zig; the JS side declares, authors, and tunes.

**P2 — Every value is exposed for the game compile. No private constants.**
Every number, value, name — all of it — arrives at an interface (the internal
tool) where it can be changed at any time → compile and go. If the physics has
numbers, they surface in the tuning interface. The failure mode this kills:
"have the AI go change a private value and slowly iterate." A constant buried in
code that affects game behavior is a bug per this principle — it must live in
data (registries / documents / tuning tables) that the compile consumes.

**P3 — Deep interfaces, readable code, good structure.**
Small, strict surfaces hiding substantial implementation; names that carry their
meaning; validation at the boundary so interiors stay simple. The ground-floor
modules are written to this bar — they are the foundation everything cites.

**P4 — Behavior-level tests, dual-sided.**
Both runtime testing AND local TypeScript + Zig test suites that validate
BEHAVIOR — written so they survive interface changes. Tests assert what the
system does (the jump arc, the hit chance at range X under cover Y, the path
around a dropped barrier), not what its functions are called. Every ground-floor
module ships with both sides.

**P5 — The core shape is protected; new ideas slot in without touching it.**
The reason all of this lives in the internal tooling: the game's mechanics are
still being constructed — cutscenes (V16) are just a start. So the system must
satisfy two demands at once: (1) everything is NOT a pain in the ass to interface
with — a new idea is a short file in a lab slot, consuming the ground floor
through its deep interfaces (P3); and (2) experimenting can never hurt the core
shape of the game already established — a lab consumes the ground floor, it never
forks or mutates it. The graduation loop: experiments are written at production
quality (the house rule — disposability is in the IDEA, not the implementation),
and when one wins, it graduates INTO the ground floor through this constitution
(a new verdict), not around it. The ground floor only ever grows by verdict;
labs are where everything else lives until then.

**P6 — The lab corpus IS the regression suite; breaks force real choices.**
How we know the system is built the way we want: a new feature is introduced
somewhere, proves to be THE approach, graduates — and then re-running the
PREVIOUS labs reveals it breaks behavior somewhere. That break is not an error
to silently patch; it is a choice that really matters, surfaced to be ruled on
(keep the old behavior, adopt the new, or split them deliberately). Graduation
protocol: promote → re-run the whole lab corpus → every behavior change becomes
an explicit decision → THEN it's done. The compounding benefit runs both ways:
every lab already made benefits from future ones, because they all consume the
same ground floor — improve the figure once, every lab with a figure improves.
(The per-lab notes from V13 are what make "broken" detectable: each lab records
what it is supposed to demonstrate, so a behavior change against the note is
visible to human and AI alike.)

**V22 — The design-session doctrine (recorded 2026-06-04, fourth pass).**
- **Game modes are distribution presets.** SAMP/VCMP's 15 years A/B-tested the
  verb space: role, rob, chase, evade, race, jump, accumulate. Each is a
  conditioning preset of the V21 machine, not a new system.
- **The opening:** sky-ramp dream cold open (the apex verb, then repossessed) →
  wake high/broke in the apartment → fired → demoralizing job hunt → delivery
  gig (the tutorial wearing a job costume; the unfair-rating beat MUST cost
  visible money before the pivot) → geometry-manufactured backseat-tweaker scare
  (player-authored crash; calm pitch if they keep control) → Crime-as-a-Service.
  The real sky ramp exists in the map, unmarked (community mythology asset).
- **The protagonist is event-sourced.** No backstory: player and character
  knowledge identical at frame zero; the apartment PROPS the biography (3-4
  artifacts, never explained). PROTECT THE ZERO: no chosen-one reveal, ever —
  the platform harvests, it doesn't recruit. Cast = all new faces; relationships
  accumulate only from witnessed in-log events; character intros = feature
  unlocks.
- **CaaS dailies are LLM-generated mission ROWS.** Closed schema (verb set +
  validated slots); the darknet-gig frame launders generator text (UGC
  aesthetic — even failure modes are in-fiction). Generation offline →
  validator proves the row against the queryable future (methods_hinted are
  AFFORDANCES GUARANTEED — chance-engine LoS checks etc.) → the V19 verify bot
  PLAYS every daily headless before players see it. The LLM never touches
  numbers (P2: tuning tables price the gig; the platform diegetically reprices
  the client's offer). exposure_penalty = modifiers on the V12 consequence
  engine, never a second truth. narrative_hooks are (text, world_delta) pairs —
  a hook without a delta is the world calling the app a liar. Fields: client
  (two-sided missions fall out free), completion predicate (methods stay free),
  expiry semantics, collateral policy (civilian kills dock the rating),
  seed + embedding fingerprint (dedup window = no-doubles for narrative).
  Completion/rating data feeds tomorrow's generation weights — the mission
  generator and the fiction's antagonist are the same machine.
- **Positions vs occupants (the Hitman identity model).** The world is a roster
  of POSITIONS (behavior loop + location + schedule + faction — baked, tenured
  data); people are seeded OCCUPANTS. Kill vacates the post; homeostasis
  refills it; replacements can know they're replacements ("covering for
  Marcus"). Vacancy is a world state — the exploitable window; per-position
  refill curves are P2 tunables. Contracts declare binding: PERSON (grievance —
  follows him, voids on unrelated death) or POSITION (racket — re-arms against
  the replacement).
- **Replayability:** maps are machines that produce runs (content = verbs ×
  map). Mission replay is DIEGETIC — posts refill, contracts re-list; canon is
  the V20 trunk, replays are branches from snapshots (the save system and the
  replay system are the same system). Failure degrades, never ends (alert =
  perturbation; fail screens only for impossible predicates). Per-method
  recognition lives in the app's ratings. Player-spawned ramps/toybox = just
  perturbations; gate as progression per district.
- **Multiplayer is latent:** the ambient world is f(seed, t, log) ⇒
  deterministic lockstep; the network would carry only the log.
- **Behavioral cloning:** capture the dev's (later, consenting players')
  movement into the path dictionary — human traces EXTEND the token vocabulary
  beyond the nav graph (desire paths; flee-sessions are the highest-value
  capture). Context-tag sessions; every mined token is replayed headless by the
  NPC figure body before entering the dictionary (the verify bot is the
  bouncer); provenance tags forever.
