# Model Blueprints — portable stats & metadata for RJMD

**Status:** design agreed + build plan, awaiting Stage 1 start (req_4744–req_4749, 2026-08-25)
**Provenance:** synthesized from two independent research passes (glTF/VRM/USD/OMI prior art; semantics-first primitives design) plus a two-agent code survey of the actual RJMD pipeline and game runtime. The full research crossover lives in the req_4744 conversation; this doc is the durable spec + plan.

---

## 0. The one rule

> **The model owns the blueprint; the game owns the simulation.**

Blueprint = author intent: base values, templates, requirements, physics, affordances, progression *rules*.
Simulation = runtime state: current HP, earned XP, durability-now, owner, rolls, timers.

Runtime state never enters a shared RJMD. Blueprint data never blocks rendering. Nothing in a model document ever executes.

### Rulings this plan encodes (Stage 0 lands them in DECISIONS.md)

1. **V28 clarification** (user, req_4745, verbatim intent): the "game is data, no per-game code" verdict targets **hot-loaded code riding in game data** — no map, prop, or model may carry a script into someone's game space. **Pre-compiled per-game carts are completely different and totally allowed.** A racing game is its own shipped cart with its own compiled sim + adapter code, built on the shared framework.
2. **Threat model** (user, req_4746): the UE5 Steam-Workshop incident — RATs hidden inside complex Blueprints — is the exact failure being avoided. The safety property is **no interpreter in the loader**: blueprint data is parsed into typed values, structurally validated, and anything unrecognized is inert bytes that get preserved, never dispatched. No expression grammar, ever — even a "tiny sandboxed" one re-creates the Blueprint attack surface.
3. **Draft new verdict — the blueprint layer** (for the user's sign-off at Stage 0): model documents may carry declarative, namespaced, **advisory** stat blueprints. Games may consume, remap, scale, or ignore them. Unknown namespaces are preserved verbatim on save (opaque carriage — stored, never interpreted, never even deserialized beyond JSON values). The model owns the blueprint; the game owns the simulation.

### Why (the three audiences)

- **Modders/modelers** (req_4749 — "the bigger thing"): custom assets for a game with **zero code**. Model + fill in the Studio stats panel = the entire mod workflow. Because assets carry no executable anything, mods are safe by construction and shareable at Workshop scale without the Workshop attack surface.
- **Game devs** (req_4748): a dev's model ecosystem (vendor-namespaced stats) outlives any one game. Other games consume it by adding adapter logic in their own compiled cart — no permission, no shared code. Vendor vocabularies that prove out get promoted into standard `rj.profile.*` (the glTF vendor→EXT→KHR ladder, inside one platform).
- **Agents:** the same schemas + game target files that make modding no-code make stats **agent-authorable** — schema-gated output, report-verified acceptance, no judgment calls in the harness.

And the headline property: **tuning a stat is a document edit, never a rebuild.** No path from a blueprint value touches Zig compilation.

---

## 1. Design (unified spec, condensed)

### Layers

```
Layer 0  Core RJMD (unchanged)      geometry, materials, semantics, stable IDs, topology
Layer 1  Blueprint envelope         version, units, provenance, declared namespaces
Layer 2  Standard profiles          rj.core.* / rj.physics.* / rj.profile.*
Layer 3  Vendor extensions          com.<author>.<domain>.* — opaque, preserved, never executed
```

### Envelope

```jsonc
"blueprint": {
  "version": 1,
  "units": { "length": "m", "mass": "kg", "time": "s", "angle": "rad" },   // mandatory for dimensional values
  "namespaces": ["rj.core", "rj.physics", "rj.profile.vehicle", "com.captnocap.fartracer"],
  "profiles": [ { "id": "rj.profile.vehicle", "version": 1 } ],
  "provenance": { "author": "…", "generator": "Studio", "license": "…", "intent": "mid-tier junker" },
  "stats": [ /* StatAttachment[] */ ],
  "physics": [ /* PhysicsAttachment[] */ ],
  "extensions": { "com.author.x": { /* opaque */ } }
}
```

No `enforcement` flag — the format is advisory-only. Per-requirement `advisory: true` + `onUnmet` *hints* carry author intent; the host always decides.

### Value model — three encodings

1. **Physical (SI)** wherever real: `{ "id": "rj.core.item.mass", "value": 1.4, "unit": "kg" }`. Universal meaning.
2. **Semantic absolute:** author-domain number with a precise semantic id but non-universal scale (`damage: 32`). Preserves source fidelity.
3. **Portable intent:** normalized rating/ratio riding alongside: `"portable": { "rating": 0.62, "relativeTo": "rj.profile.actor.health.baseline", "ratio": 0.32 }`. A receiving game maps the rating into its own band, derives from the ratio, or ignores both. Optional `roll: { min, max, tier }` for loot-style instantiation.

Standardize a value only when its semantics exist independent of one game; otherwise standardize the container and let profiles define vocabulary. No universal STR/DEX — genre names live in optional profiles (`rj.profile.character`), never core.

### Mechanical primitives (what attachments are made of)

`attribute` · `resource` (value + capacity) · `rating` [0,1] · `tag` (hierarchical dotted, GAS-style matching) · `requirement` (declarative predicate) · `cost` (resource per trigger) · `modifier` (add/mul/override) · `grant` (tag/modifier while equipped/etc.) · `unlock` · `curve` (data table, never a formula) · `yield` · `physics`.

Requirements are data: `{ "kind": "stat", "id": "rj.profile.actor.strength", "op": ">=", "value": 10, "advisory": true, "onUnmet": "penalty" }`. Progression carries **templates** (pools, rank caps, cost curves, milestones) — never earned state.

### Scoping — the RJMD advantage

Attachments target the durable identities the format already maintains (survive rename/reorder):

```ts
type BlueprintScope =
  | { kind: "document" }
  | { kind: "object";           objectId: string }   // rangeObjectIds: blade, engine, wheel
  | { kind: "semanticRegion";   regionId: number }   // blade edge, seat, breakable glass
  | { kind: "semanticInstance"; instanceId: number } // wheel #1..#4
  | { kind: "material";         materialId: number } // rubber friction, metal restitution
  | { kind: "contactRig";       rigId: string };     // grip, sit point, driving position
```

v1 ships `document` + `object`; the other scopes land with their first real consumer.

### Standard profiles (v1 set)

| Profile | Fields | Grounding |
|---|---|---|
| `rj.physics.rigidBody` | bodyType, mass, density, centerOfMass, inertia, damping | USD Mass/RigidBodyAPI |
| `rj.physics.material` | staticFriction, dynamicFriction, restitution, density, **explicit** combine modes, surfaceType tag | USD MaterialAPI, KHR/OMI |
| `rj.core.item` | mass, durability capacity, stackability, value hint, rarity tag, carry/equip tags | Minecraft components |
| `rj.profile.vehicle` | mass, drive/grip/handling ratings, top-speed + accel ratings, per-axle hints | feeds `CarTuning` |

Precedence rules are deterministic (USD-derived): explicit mass > density-derived; child scope > parent scope. Later: `rj.core.interaction`, `rj.profile.{combat,resource,equipment,progression,character}`.

### Audio (`rj.core.audio`) — sounds travel with the model (req_4754–req_4757)

Same split as geometry vs. paint: **bytes in the package, meaning in the blueprint.**

- **WAV files are package files, never doc bytes:** `<pkg>/audio/<slug>.wav`; `audio` joins `MODEL_PACKAGE_SUBDIRS` (`modelPackage.ts:36`) beside `mesh/atlases/paints/shaders` — the same law as the paint atlas.
- **The blueprint declares the association** — an event → clip map, pure data:

```jsonc
{ "scope": { "kind": "document" },
  "profile": { "id": "rj.core.audio", "version": 1 },
  "events": {
    "weapon.fire":    { "clips": ["shot_1","shot_2"], "pick": "random", "gainDb": 0, "pitchVariance": 0.04 },
    "vehicle.engine": { "kind": "loop", "clips": ["idle","mid","high"],
                        "param": "vehicle.rpmNormalized",
                        "blendCurve": [[0,0],[0.5,1],[1,2]], "pitchCurve": [[0,0.8],[1,1.6]] },
    "impact.body":    { "clips": ["clank_1"] }
  },
  "clipMeta": { "shot_1": { "license": "CC0", "source": "freesound:412331" } } }
```

- **Event names are hierarchical tags, not callbacks.** The game fires `weapon.fire`; the profile answers "with what sound." Unfired events never touch their clips — the safe-ignore contract. Nothing in the asset says *when* — the stats/behavior boundary holds for audio too.
- **Loops are parameter-driven via named params + data curves** (multi-sample engine banks as crossfade/pitch curves over `vehicle.rpmNormalized`). No expressions, per the ruled no.
- **Composes with physics:** `surfaceType` keys the *receiving game's* footstep/impact banks; a model shipping its own impact voice adds `impact.*` events. Scopes work for free: door-creak on a `contactRig`, per-wheel skid on `semanticInstance`.
- **Clip-level license/provenance** in `clipMeta` (the `cart/composer` lesson — `sources/license.ts`; samples are the most-ripped asset class).
- **Threat model (user-ratified, req_4757):** a WAV is inert — no VM, no script; the only real vector is a **buggy decoder** (the Stagefright class: lying chunk sizes → out-of-bounds write). We control the one decoder (`decodeWavToMonoF32`, `framework/audio/api.zig:459`). **Load-bearing: builds are ReleaseFast, so Zig's automatic safety checks are OFF — the decoder must validate explicitly** (clamp chunk sizes against file length, PCM-only, cap rate/channels/duration/total decoded bytes). **WAV-only stays the rule** — MP3/OGG/FLAC each import a large third-party parser; adopting one later is a deliberate vetted decision, never a casual format addition. A master limiter caps the worst-audio-possible angle.
- **Framework gap (the real Stage 4/5 work):** `framework/audio/` has the DSP graph, sampler voices, per-track gain/pan — but **no world-space emitter**. Build the capability "attach loop/one-shot to a world entity; distance gain + pan follow the listener" (audio ↔ world_loader join). V30 already rules that the VIS lump serves audio occlusion — emitters v1 (distance/pan) now, occlusion plugs into VIS later.
- **Prior art on disk/history:** `cart/app/daw/page.tsx` (live), `cart/drums5.tsx`, `cart/pocket_operator.tsx`; the standalone EarSketch-idiom cart was `cart/composer` (deleted in the DEMOLITION ORDER `d4c4b5030`, 2026-06-10; recoverable) — its sidecar-WAV-with-id-bindings and license layer are the direct precedents.

### Consumption contract (host/game side)

- Per-game **adapter registrations** live in each game's compiled cart; the framework/runtime provide only the mechanism. Template: `cart/hmsc-int/game/stats/bridges.ts` ("keep stats separable, bridge with thin maps").
- Consumed values **seed** the game's own base/current + aggregator pipeline; the asset is never the live value.
- **Application report** everywhere a blueprint is consumed: `adopted / normalized / ignored-by-policy / unknown-preserved / defaulted`, queryable (console verb + seat). Authored-but-unconsumed is this repo's known disease (`PlacedPiece.overrides` was removed for exactly this; `STATS_CONFIG` is decoded then only logged at `framework/world_loader/runtime_lifecycle.zig:145-149`) — the report is the structural cure and is **non-negotiable**.

### Game target files (the modding SDK)

A game exports its consumed-profile declaration — profile ids + versions, field ranges, rubric text — as a data file (proposed home: `userdata/`, one per game). Uses:
1. Studio stats panel "target: <game>" renders exactly that game's authoring form (modder never sees JSON).
2. Agent stat-author lanes take the same file as rubric + schema input.
3. Export-time validation proves an asset consumable by that game's adapters.

---

## 2. Where it lands in the code (survey results, 2026-08-25)

### Storage: the trailing semantic JSON — no format bump

- `contactRig` / `interactionProfiles` are the exact precedent: additive keys inside the RJMD trailing semantic JSON (`cart/editor/model/meshSemantics.ts:55-57`; Zig validator `framework/gpu/contact_rig.zig:329-347`, invoked at encode `meshdoc_format.zig:476` and decode `:692`). A `blueprint` key beside them round-trips disk → TS → host → re-encode → disk **today**: both decoders ignore unknown keys, both re-stringifiers preserve them, TS table type has `[key: string]: unknown` (`meshSemantics.ts:58`).
- **Trap:** trailing *binary* bytes hard-fail the Zig decoder (exact-length, `meshdoc_format.zig:686`) while the TS decoder tolerates them — never append binary; semantic JSON is the only additive path short of RJMD v6.
- **Budget:** `MAX_SEMANTIC_TABLE_BYTES = 1 MiB` (`meshdoc_format.zig:130`), shared with region names. Plenty for stats; keep vendor extensions honest.
- The doc is written only by Zig (`__model_meshdoc_write`, `framework/v8_bindings_core.zig:3516`); the encoder reads the **host's** resident table — a TS-side-only table edit is silently dropped at save. Live writes must go through the `setSemanticTableJson` family (`framework/gpu/model_source.zig:350`).
- Current doc shape: `PackageMeshDoc` (`cart/editor/data/meshDoc.ts:51-83`), RJMD v5, header 48B, magic `RJMD` (`meshdoc_format.zig:128-129`).

### Preservation guard: extend the existing family

`meshDoc.ts` already refuses semantic erasure (req_3898, `:156-165`), part shrinkage without capability (req_3405, `:224-245`), treats unreadable docs as hard stops (req_3740, `:268-275`), and restores the prior blob when a post-write readback shows dropped semantics (`:451-463`). Blueprint preservation = one more guard in this family: **refuse a save that drops an existing blueprint table unless explicitly authorized**, plus readback coverage. Authorization mints in `cart/editor/shell/AppFrame.tsx:784-790` / `model/modelSaveAuthority.ts`.

Do **not** put the block in `manifest.json`: `packageToManifest` (`modelPackage.ts:147-174`) rebuilds and silently drops unknown keys (four rescue sites needed vs. zero for the semantic-JSON route).

### Seat doors

- **Read:** new `blueprint` operation on the existing claim-exempt `package` door (impl block `AppFrame.tsx:9192-9398`; routing `seatApi.ts:2851-2876`; read exemption list `:2379-2403`).
- **Write:** a *separate* `blueprint` action so `seatAdmission` (`seatApi.ts:2418-2427`) gates it on the model claim — a write op must NOT ride `package` (it would inherit the no-claim exemption). Lands JSON in the host table, persisted by ordinary save. `tools/seat action <name> '<json>'` already reaches any door — no CLI change.

### Game runtime facts the racing cart builds on

- `/play` is a route in the editor cart; the game itself is **one native host node**: `WorldLoader` (`cart/editor/play/CriminalCareersPlay.tsx:51-57`). `PlaytestSurface.tsx` + `world/livePush.ts` is the working "play the authored world, no bake" template.
- **The map is nearly free for a second cart:** the host map engine is process-global; import `runtime/game/map.ts`, call `mapLoadFile('userdata/editor/maps/<stem>/painting.rmap')` and the editor-painted terrain/roads/flora come with it.
- **Capability triggers are source-driven** (`sdk/dependency-registry.json` + `cli/registry/resolve.ts`) but `has-compiled-world` / `has-game-physics` / `has-game-camera` currently trigger on **cart-private files**. A new cart adds trigger entries for its own files — never cross-imports editor internals (req_2178 lesson).
- **Vehicle physics does not exist in the framework.** `cart/hmsc-int/game/driving/` is the complete, tested kinematic-bicycle handling model (V10 ruled vehicle_lab/driving as the source; the file header says it lives cart-side until it graduates into the host sim). `CarTuning` (`driving/index.ts:22-60`) is the port target and the natural adapter sink for `rj.profile.vehicle`.
- Vehicle prop rigging already exists: `carRigBones()` (`runtime/skeleton/rigs.ts:236-259`) — hinged hood/trunk/doors, spin-X wheels, driver/passenger seats — consumed via the INTERACTABLES lump (`framework/world_loader/runtime_interaction.zig`). The `vehicles/` package category is declared (`modelPackage.ts:103-110`) with no directory on disk yet.
- **Checkpoints have no substrate but ARE ruled:** V24 semantic overlays — the `WorldMarker` union with `trigger {bounds, event}` — is the authored shape; `cart/editor/design.ts:39-56` already names `marker`/`spawn`/`save`/`vehicleSpawn`/`parking` tile kinds with zero consumers. Implementation: new `WorldSave` slice beside `objects`/`zones` (`worldStore.ts:39-66`), new `WorldOutlinerSectionKey` + target variant (`world/worldOutliner.ts:38-63`).
- **Track measurement primitive exists:** `transport.samplePath` (`framework/game/map/transport.zig:651`) — arc-length sampling along a committed path; `mapPathSnapshot()` (`runtime/game/map.ts:642`) exposes committed centerlines to TS.

---

## 3. Build plan

### Stage 0 — Rulings on paper (small, first)
Amend `DECISIONS.md` + `docs/game/_index/decisions.ts` in one commit: the V28 clarification and the new blueprint-layer verdict (§0 drafts, user signs off on wording).

### Stage 1 — BLUP block in RJMD (~1 agent-day)
- `cart/editor/model/blueprintTable.ts`: types + `parseBlueprintTable`, modeled on `contactRig.ts`. Envelope + profiles + scoped stats + opaque extensions.
- Zig structural validator beside `contact_rig.validateSemanticTableExtensions` — shape only, no interpretation.
- Preservation guard + post-write readback coverage in `meshDoc.ts`.
- Profiles v1 (typed parsers are the schema; spec text in this doc): `rj.physics.rigidBody`, `rj.physics.material`, `rj.core.item`, `rj.profile.vehicle`, `rj.core.audio` (event→clip map; the `audio/` package subdir + WAV decoder hardening land with it — playback/emitters come later, Stage 4/5).
- Scopes v1: `document` + `object`.

### Stage 2 — Authoring surfaces (~1–2 agent-days)
- Seat read (`package blueprint`) + seat write (separate claimed `blueprint` action through the host table).
- Studio STATS panel in the model inspector: preset picker (Generic Prop / Physical Prop / Vehicle / Custom), common fields, custom add. Untouched panel = no blueprint.
- Game target file format + "target: <game>" panel mode.

### Stage 3 — Consumption mechanism (~1 agent-day)
- Adapter registry mechanism in `runtime/game/` (mappings live per-game, in each cart) — `bridges.ts` pattern.
- Application report (console verb + seat-readable) wherever blueprints are consumed.
- Wire the existing `StatsConfig` logged-and-dropped gap while in there (same disease, one-step fix).

### Stage 4 — Fart Racer, the cart + its compiled sim (~2–3 agent-days; can start parallel to 2–3)
- New sibling cart `cart/fart-racer/` mounting `WorldLoader`, loading the editor map via `runtime/game/map.ts`.
- **Per-game compiled code home (user-approved, req_4753):** `framework/games/custom/fart-racer/` — the game's own Zig sim (gas tank, digestion, bowel pressure, collision damage model). This is the first instance of the V28-clarified shape: pre-compiled per-game logic, cleanly separated from shared framework capabilities.
- Graduate `cart/hmsc-int/game/driving/` → `framework/game/driving.zig` (with its tests) — the **shared** vehicle capability every future driving game reuses; host door shaped like `CarTuning`; Fart Racer's adapter feeds it from `rj.profile.vehicle` — **the cart compiles mapping rules, never numbers**.
- `sdk/dependency-registry.json` trigger entries for the fart-racer cart's own files.
- Junk Tripo cars land under `models/vehicles/`, statted through the Stage 2 door. Game-specific stats go in `com.captnocap.fartracer.*` — the editor preserves-and-ignores them (see §5).

### Stage 5 — Checkpoints, track, agent lanes, acceptance (~2 agent-days)
- Checkpoints as V24 WorldMarkers: `WorldSave` slice + outliner section + `race.checkpoint` tags with order. Consumed JS-side in the racer first; a loader lump later if it earns it.
- Track = the road tool as-is; `samplePath` auto-places checkpoints along the committed centerline and measures lap distance.
- Agent lanes, sequenced: track agent (road tool) → checkpoint agent (markers; validated geometrically: ordered closed loop, volumes intersect road) → stat-author agents in parallel (blueprint door + target file + **distribution-constrained brief** — batch-bias flattening is the known failure mode when one agent stats six cars).
- Acceptance harness: run the driver bot N laps per car; assert lap-time ordering matches authored ratings. Plus the pin-the-contract test: edit a car doc's torque, reload, assert derived accel changed **with no rebuild**.

### Resolved calls (req_4753, 2026-08-25)
1. **Name: Fart Racer** — cart `cart/fart-racer/`, compiled sim `framework/games/custom/fart-racer/`, target file identity `fart-racer`.
2. v1 scope depth: `document` + `object`; deeper scopes land with their first real consumer.
3. Game target file home: `userdata/`, one file per game.

---

## 4. Fart Racer — game design (USER ASK req_4753)

The user's design, verbatim intent: cars are powered by natural gas the player produces — farting fills the tank. Refueling is eating: fast-food drive-thrus on the track provide an intermediary fill-up. Cars carry several related stats and take damage from collisions. **The racer has to make it home before he shits his pants.**

### The loop (fuel and failure share a source)

```
throttle burns gas  →  tank empties  →  pass a drive-thru, eat
       ↑                                        │
  gas becomes                            digestion converts
  thrust                                 food → gas over time
       │                                        │
       └──────── tank refills ←─────────────────┤
                                                ▼
                                  bowel pressure RISES with every meal
                                                ▼
                        pressure maxed before home = shit pants = LOSE
                        cross home line with pants intact = WIN
```

Eating is the only fuel source and the only thing that advances the lose-timer — every fill-up is a bet on making it home. Collision damage compounds it: a wrecked tank leaks, forcing more meals.

### Stat vocabulary (the blueprint/simulation split, taught by example)

**Car documents** (models under `models/vehicles/`, statted via the seat door):
- `rj.profile.vehicle` — mass, top-speed rating, accel rating, grip, handling (feeds the shared driving model).
- `rj.core.item.durability.capacity` — collision hit points.
- `com.captnocap.fartracer.*` — `tankCapacityL`, `burnRatePerSec` (at full throttle), `fillEfficiency` (how well digested gas reaches this tank), `leakRatePerDamage` (junkers leak when dinged).

**Food documents** (drive-thru menu items are model packages too — the ecosystem point in miniature):
- `com.captnocap.fartracer.*` — `gasYieldL`, `digestSeconds` (delay before yield becomes usable gas), `bowelLoad` (pressure added). A bean burrito: high yield, high load. A salad: near-zero both.

**Track entities** (world data, not model docs): checkpoints + the **home** finish as V24 WorldMarkers; drive-thrus as placed props whose interaction the fart-racer sim consumes (window-side pass-through trigger).

**Simulation state (never in any document):** tank level, bowel pressure, damage-now, digestion queue, race position, lap time. The whole game is the proof that the split holds: every tunable is a doc edit, every runtime value is the game's own.

**Audio (via `rj.core.audio`):** car docs ship engine idle/rev loops (pitch off `vehicle.rpmNormalized`), skid, crash-clank, and the tank-fill sound; food docs ship their eat sound; the drive-thru prop ships its speaker squawk. All authored by dropping WAVs in the package and filling the event map — the world-space emitter capability (Stage 4/5 framework work) is what plays them in the race.

### Acceptance (extends Stage 5's harness)

- Lap-time ordering matches authored vehicle ratings.
- Edit a car doc's `tankCapacityL`, reload, assert range-before-empty changed — no rebuild.
- Bot run with no drive-thru stops runs dry before home; bot that overeats shits its pants before home. Both ends of the loop provable headless.

---

## 5. Tripwires
- Vendors shipping load-bearing data in extensions that core profiles should cover → extend the core catalog.
- Validation-failure warnings spiking → tighten Studio export; never loosen parsers.
- Anyone proposing an expression grammar "just for derived stats" → the answer is the ruled no (req_4746); curves and ratios as data.
- A consumer reading blueprint values without emitting an application report → reject in review; silent adoption is how `overrides` died.
