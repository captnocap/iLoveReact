# Flockbook & World Simulation — Design Document

Consolidated from design sessions, 2026-07-25. Covers the model-package declaration
system, collision, the observation/surveillance pipeline (Flockbook), notoriety,
the crowd model, the two-tick world simulation, and retroactive investigation.
Pitch in one line: **Hitman had a baby with GTA.**

---

## 0. Design Laws

These recur through every system below. When a new mechanic is unclear, check it
against these.

1. **Store the cause, keep the effect derivable.** Record the small upstream thing
   (intent, parameters, schedule, observation); manufacture the big downstream thing
   (frames, footage, beliefs) on demand. Keyframes→animation, strokes→dither,
   inputs→Quake replay, schedules→city, observations→case files.
2. **Declarations, not behavior.** Model data carries inert facts interpreted by
   engine systems ("when X then Y" always means *parameterizing an existing
   capability*, never embedding logic). Every socket kind is owned by exactly one
   engine system with a closed schema. There is no generic "do anything" payload.
3. **The model package is the source of truth.** Anything true of *every instance*
   of a model lives in its package (Source-QC philosophy, fully integrated: our
   editor and runtime are one process). Per-placed-instance overrides live in world
   data. No engine-side sidecars that can drift.
4. **No compile gate means validation at save.** Source's studiomdl refused to
   compile garbage; we have no compile step, so the editor must validate at
   save/publish: schema checks per socket kind, required-socket lists per model
   kind, weight normalization, observables vocabulary membership.
5. **Consequences propagate at the speed of information, never the speed of the
   event.** Witness transport delay, feed latency, buffer expiry, body discovery —
   the world reacts to what it *knows*, and knowledge travels. The criminal
   playbook is manipulating the propagation graph: delay it, sever it, outrun it,
   poison it.
6. **Fidelity ladders everywhere.** A small budget of expensive-real things
   surrounded by cheap approximations, with promotion/demotion rules and hysteresis.
   Instances: wires (shader sway → verlet sim → constraint-entangled), people
   (filler → reactive → citizen), time (on-curve → displaced → jit), feeds
   (derivable → recorded → pinned).

---

## 1. Model Package: Declarations

The manifest (`data/models/*/manifest.json`) holds an independent skeleton with
stable bone IDs. Character packages additionally declare immutable RJMD v5
logical topology, semantic anatomy, stable object bindings, and an RJSK weight
artifact; display names and `mesh/parts.json` ordering never bind a character.
The package grows by adding **declaration blocks** — closed-schema data read by
specific systems:

- `observables` — identity tokens on clothing (see §5).
- `pockets` / inventory sockets — slot grids on wearables.
- emitter sockets — sound/light/particle the model pushes into the world.
- sensor sockets — cameras and anything else that pulls from the world.
- physics declarations — collision, cable/wire nature, breakable joints, windDrag,
  per-model gravity, etc.
- embedded assets — sounds/textures ship inside the package (self-contained model),
  deduplicated at load by content hash so 50 identical door-creaks load once.

### Sockets

A socket is a named node in the bone tree with an outward-facing job: a stable
attachment/reference point other content depends on. **Rig internals are private
implementation; sockets are public API.** Never rename/move a socket casually;
maintain required-socket lists per model kind (every player model must provide
`hand_right_grip`, every pole must provide `wire_anchor`, …).

Socket families (open-ended; the envelope `{kind, ...payload}` is what's fixed):

| Family | Examples |
|---|---|
| Mounting | weapon in hand, scope on rail, wheel on hub, hat on head |
| Interaction | grip points (drives hand IK), door handles, carry points, sit spots |
| Effects & senses | muzzle flash, exhaust smoke, eye/LoS origin, camera POV |
| Physics anchors | wire anchors, tow hooks, hinges, cloth pins, breakable base joints |
| Gameplay semantics | pockets, hitbox zone tags, loot spawn in furniture, cover points |
| Mating | socket-to-socket snapping for modular building (needs compatibility rules) |
| Sensors | Flockbook cameras: `{kind: "camera", fov, range, tickRate}` |

Clothing binds to the wearer's skeleton **by stable bone ID** (shared skeleton
contract); it contributes its own extra socket bones grafted onto the wearer's
tree at equip, pruned at unequip. Cross-item conflicts (jacket covering pants
pockets) resolve in game rules, never in model data.

---

## 2. Collision

**Two-layer principle: the box decides when to ask; the triangles decide the
answer.** Boxes are tripwires (broadphase), never walls. Player contact resolves
against the model's actual triangles — zero gap by construction, because the
surface that stops you is the surface being drawn. At ≤2k tris/model the cost is
negligible (box filter leaves single-digit triangle tests per query).

- `editor/model/meshCollision.ts` is the bake: per-part bounded box *tree*
  (budget 24, splits only where they materially tighten — diagonals split a lot,
  axis-aligned walls stay one box) + packed exact triangles.
- `editor/world/meshProps.ts` (v10 resident mesh format) already carries
  `collisionBoxes` + `collisionTriangles` with validation.
- **Rule going forward:** every prop's player contact must come from triangles;
  boxes are broadphase only. Any path that treats a box as the final answer is the
  "invisible force field" bug. (The legacy iteration stapled per-prop-kind AABBs —
  that pattern is what we're leaving behind.)
- Dynamic rigid bodies (thrown/stacked props) are the one case triangles don't
  serve — if that becomes real, add convex decomposition (V-HACD-style) as a
  model-package bake. Static/player contact never needs it.

---

## 3. Physics & Ambient Motion

- **Who drives the motion decides the tool:** animator's hands → bones (bendy =
  authoring convenience that bakes to plain segment chains); physics reacting to
  events → springs/sim; ambient endless motion → painted weights + shader math.
- **Shader wind** (grass, distant wires, flags): per-vertex flexibility weight —
  the weight-map machinery reused — offset by `sin(time + worldPos)`. It is a
  visual lie: gameplay never sees it. Fine for tier 0.
- **Wires/cables** that must interact: verlet point-chain with distance
  constraints; collides via the same box→triangle pipeline. Snags = runtime
  constraints; pole base = breakable constraint with declared `breakForce`.
  Fidelity ladder: dormant (shader) → simulated (verlet, near gameplay) →
  entangled (constraint-coupled to bodies; never demote while attached).
  Build release valves from day one: iteration caps, break-under-absurd-force,
  sleep distant tangles.
- Wind as a real force: a force field; each model's blob declares `windDrag`
  (same pattern as per-model gravity).

---

## 4. Flockbook: the Observation Pipeline

Flockbook is the in-world social platform + surveillance company. Core promise:
**the game's knowledge of people derives only from what sensors observed — never
from server omniscience.** The player games their identity against the network.

### Architecture

- **A camera is a replication viewer.** Frustum + range + occlusion, running the
  same visibility culling a multiplayer server runs per client. What passes the
  filter becomes its observation stream. Blind spots and disguises work *by
  construction* — the recording physically can't contain what failed the cull.
- **Observations are entity-state data, not pixels.** Low rate (~10 Hz reads as
  CCTV). Tiny storage; replayable by puppeting recorded actors; re-renderable
  from the camera POV to a texture → the 10pm news, zoom/slow-mo/chyrons free.
- **Record appearance by value, never by entity ref** — outfit changes must not
  retro-edit footage. Replay old clips in an isolated scene (world may have
  changed since).
- **Ring buffers + pinning.** Cameras hold the last N minutes; tagged gameplay
  events ("crime at X, time T") query which cameras had LoS and pin those
  segments permanently. News ranks pinned clips.
- **The API wall (hard rule).** Police, dossier, news, and player tools may only
  query the observation DB — never entity truth. The server knows everything; the
  honesty of the entire design is this one boundary. No pursuit edge-case ever
  "just peeks."

### Witnesses: the second sensor class

NPCs emit the same observation schema as cameras, with human failure modes:
partial capture (torso, no face), confidence decay, recall error, and **transport
delay** — a witness's observation exists only in them until they reach a
phone/officer. Interceptable: cut the call, catch the witness. Cameras are
precise/instant/fixed/blind-spotted; witnesses are mobile/fallible/slow/silenceable.

---

## 5. Identity, Observables, Notoriety

- **Clothing declares `observables`**: closed, deliberately coarse vocabulary
  (color tokens, garment classes, pattern, height bands). Observers sample worn
  equipment's declarations — disguise needs zero dedicated code; changing clothes
  genuinely changes the evidence trail. Coarse = computable matching + player can
  reason about their own cover.
- **Identification is derived and fallible.** Observations are raw; the dossier
  matches them to citizen profiles and *can be wrong* — masks yield no face token,
  copied outfits frame innocents. The gap between observed and concluded is the
  game.
- **Notoriety is a belief database, not a meter.** Police hunt fused
  *descriptions* (case files): "green polo, slacks, ~180cm, last seen heading
  north." Pursuit = officers live-matching the description against what they
  observe. Escape = breaking the match, not waiting out a timer. Evidence
  persists; a single face-capture re-links everything later.
- **Pacing comes from evidence-quality decay** (witness confidence fades, cold
  cases downweight, corroboration thresholds gate response) — never a fading meter.
- **Continuity is observational (chain of custody).** Cameras log transitions
  ("green polo entered blue sedan"); descriptions link only if the transition was
  in view. Alley clothes-change or blind-spot car swap breaks the chain. Carried
  evidence (the polo in your backpack, via the pocket system) re-links it on a
  later stop-and-search.

### Police search model

Case file anchors a **probability cloud** at last confirmed sighting; it spreads
along the road network over time and is **pruned by negative evidence** (covered
corridors whose cameras reported nothing). Unwatched routes are where the cloud
leaks — learning the coverage map is core play. Cops can be genuinely, visibly
wrong, and the player can read and manufacture the wrongness.

---

## 6. Player-Side Feeds

- Players find exposed camera endpoints; feeds have **variable latency**
  (real-time to ~30s) — implemented as ring-buffer read offsets; per-endpoint
  declared or drifting. Player and police are symmetric consumers of the same DB
  through the same API wall.
- Emergent verbs: measure a feed's delay by waving at the camera; deep hacks
  inject pinned segments into live feeds (the *Speed* loop trick — just pointing
  the reader at a different buffer).

---

## 7. Crowd Model (IOI-style cognition LOD)

**Filler → reactive → citizen.** The city renders thousands; the game tracks a
few hundred citizens with identity/dossiers. Filler have no perception.

- **Filler contribute statistics, not observations.** They dress from the same
  observables vocabulary; the matcher uses area crowd-composition base rates for
  confidence. "Green polo downtown" = weak evidence; hi-viz vest = laser.
  Crowd-blending falls out, legibly.
- **Reaction ≠ testimony.** Filler can flee/scream and emit anonymous tips
  (location-only, no description payload). Crimes in filler crowds summon police
  to the *place* but feed nothing to the *description*. Venue choice by witness
  quality becomes play.
- **Citizen cognition is a rented slot** (spatial pool near player/events);
  dossier identity is cheap persistent data. Far citizens demote to statistical
  existence. *Flockbook tracks citizens; the engine tracks slots; the crowd is
  weather.*

---

## 8. Two-Tick World Simulation

- **World tick: 45/min** — samples deterministic NPC schedules. The timetable is
  the data ("Bob walks this sidewalk every Thursday 3pm"). Schedule = keyframes;
  the tick is curve-sampling, not simulation.
- **Jit tick: 180/min (4:1)** — runs player-derailed/engaged NPCs; the 3
  intermediate ticks recalibrate (rejoin schedule or stay engaged).
- Both are **cognition cadences only** — motion/render interpolate at frame rate
  between decision ticks.
- **NPC states are three rungs:** on-curve (derivable, free) → on-curve-shifted
  (displaced: `position = schedule(t − offset)`, ONE float of state, no jit
  needed once walking again) → off-curve (true jit, rents the 180 tick).
- Demotion out of jit requires a hysteresis window (N consecutive clean checks) —
  no mode ping-pong at a blocked path.
- **Rejoin at where-the-schedule-says-NOW, never resume-where-derailed**
  (self-healing; no cascading lateness). Killed NPC = **schedule tombstone**
  (permanent edit; never drainable).
- **Derivable footage:** undisturbed districts' camera observations are a pure
  function (schedule ∩ coverage) — synthesize past footage on demand; only
  jit/displaced/player segments need live recording.
- **Absence is evidence.** The schedule gives Flockbook a baseline of *expected*
  observations; a broken routine (Bob misses his 3pm pass) is itself an
  observation. Enables Hitman-style routine study and police pattern alerts.

### Displacement & healing ("only cut when the camera isn't rolling")

While observed, displaced Bob stays delayed toward the same goal. Resets to
schedule-truth may only happen where no observation channel exists:

- "Observed" includes player presence, **player-viewed feeds covering Bob or his
  path**, and — the stronger rule — **any recorded coverage**, because every ring
  buffer has a potential future audience.
- **Healing gradient:** private interiors (no cameras) heal instantly → unwatched
  exteriors heal after N out-of-range → covered streets heal only after the
  relevant buffer expires unpinned → pinned segments never heal. *Crimes freeze
  local reality around them. Surveillance ossifies reality — the world can only
  quietly self-correct where it isn't watched.*
- Prefer **displacement drain** over binary snap: while unobserved, the offset
  decays at a plausible catch-up rate (few× walk speed). Brief phase-outs drain
  seconds (exploit protection without a timer); footage seams shrink from
  "teleported" to "Bob hurried."
- Gaps are self-balancing: they contain residents (witnesses — hiding in Bob's
  apartment blocks his reset AND makes him a caller), and activity in gaps
  summons police = **mobile sensors** into the gap. No evidence-free space, only
  sensor-type changes.

---

## 9. Retroactive Investigation ("latency to crime")

Body discovery = event pin + estimated time-of-death window → a **retroactive
query** over existing observations: entry/exit ledger around location × window,
continuity diff, candidate pool. Investigations are queries, not new systems.
One new fact re-labels days of stored observations — the DB never changes, its
*meaning* does (design law #1 paying off).

- **Buffer clock = perfect-crime timer.** Body found after buffers expired
  unpinned → cold case. Concealment is evidence destruction by delay (dumpster
  vs. river). Asymmetry: derivable schedule-footage of the undisturbed never
  expires; recorded footage of anomalies (jit NPCs, players — i.e., the guilty)
  fades on the buffer timer. Old murders are investigated through absence
  patterns, not footage.
- **Wearing dead Bob's clothes forges his liveness.** Belief layer keeps Bob
  alive-but-strange (off-schedule; the social platform generates missed
  check-ins, friends posting). When the body surfaces: every post-death
  Bob-signature observation reclassifies to "someone wearing the deceased" — the
  disguise self-authored a timestamped multi-day trail. Instant high-notoriety
  target.
- **Forensic window width is the difficulty dial:** wide window → big entry/exit
  candidate pool diluted by crowd base rates; fresh corpse → narrow and sharp.

---

## 10. Build Order

Each piece testable alone, in dependency order:

1. **`observables` block in the clothing schema** — pure format work, no runtime.
2. **Camera sensor socket kind** (`{kind: "camera", fov, range, tickRate}`) in
   the model package + editor placement UI.
3. **Schedule format + world-tick sampler** (deterministic city; derivable
   positions; tombstones).
4. **Jit promotion/demotion** with hysteresis + the displacement float + drain.
5. **Per-camera visibility sampler → ring buffers** (+ derivable-footage query
   for undisturbed schedule NPCs).
6. **Event pinning + feed reader** (offsets give hacked-feed latency for free).
7. **Description matcher / case files** (fusion, base rates from crowd
   composition, probability cloud with negative-evidence pruning).
8. **Retroactive query** (entry/exit ledger, reclassification pass).

Standalone quick win, independent of all of the above: ensure prop player-contact
resolves against `collisionTriangles` everywhere (boxes broadphase-only), and
that every exported model gets a `meshCollision.ts` bake into its package.

## 11. Code Touchpoints (current iteration = `editor/`)

- `editor/model/meshCollision.ts` — collision bake (box tree + exact triangles).
- `editor/world/meshProps.ts` — v10 resident mesh format; already carries
  `collisionBoxes` + `collisionTriangles` with validation.
- `editor/world/pieceShapes.ts` — editor-owned piece decomposition.
- `editor/data/models/*/manifest.json` — skeleton, and the future home of
  declaration blocks (`data` field currently unused; `decompositions` field
  reserved).
- `hmsc-int/` is the **legacy first iteration** — do not build against it; its
  prop-kind AABB collision (`placed.ts`/`footprint.ts`) is the pattern being
  replaced.
