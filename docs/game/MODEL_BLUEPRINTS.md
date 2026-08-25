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
  "namespaces": ["rj.core", "rj.physics", "rj.profile.vehicle", "com.captnocap.racing"],
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
- Profiles v1 (typed parsers are the schema; spec text in this doc): `rj.physics.rigidBody`, `rj.physics.material`, `rj.core.item`, `rj.profile.vehicle`.
- Scopes v1: `document` + `object`.

### Stage 2 — Authoring surfaces (~1–2 agent-days)
- Seat read (`package blueprint`) + seat write (separate claimed `blueprint` action through the host table).
- Studio STATS panel in the model inspector: preset picker (Generic Prop / Physical Prop / Vehicle / Custom), common fields, custom add. Untouched panel = no blueprint.
- Game target file format + "target: <game>" panel mode.

### Stage 3 — Consumption mechanism (~1 agent-day)
- Adapter registry mechanism in `runtime/game/` (mappings live per-game, in each cart) — `bridges.ts` pattern.
- Application report (console verb + seat-readable) wherever blueprints are consumed.
- Wire the existing `StatsConfig` logged-and-dropped gap while in there (same disease, one-step fix).

### Stage 4 — The racing cart (~2–3 agent-days; can start parallel to 2–3)
- New sibling cart (name TBD) mounting `WorldLoader`, loading the editor map via `runtime/game/map.ts`.
- `sdk/dependency-registry.json` trigger entries for the racer's own files.
- Graduate `cart/hmsc-int/game/driving/` → `framework/game/driving.zig` (with its tests); host door shaped like `CarTuning`; the racer's adapter feeds it from `rj.profile.vehicle` — **the cart compiles mapping rules, never numbers**.
- Junk Tripo cars land under `models/vehicles/`, statted through the Stage 2 door. Racer-only stats (gear ratios, tire wear) go in `com.captnocap.racing.*` — the editor preserves-and-ignores them.

### Stage 5 — Checkpoints, track, agent lanes, acceptance (~2 agent-days)
- Checkpoints as V24 WorldMarkers: `WorldSave` slice + outliner section + `race.checkpoint` tags with order. Consumed JS-side in the racer first; a loader lump later if it earns it.
- Track = the road tool as-is; `samplePath` auto-places checkpoints along the committed centerline and measures lap distance.
- Agent lanes, sequenced: track agent (road tool) → checkpoint agent (markers; validated geometrically: ordered closed loop, volumes intersect road) → stat-author agents in parallel (blueprint door + target file + **distribution-constrained brief** — batch-bias flattening is the known failure mode when one agent stats six cars).
- Acceptance harness: run the driver bot N laps per car; assert lap-time ordering matches authored ratings. Plus the pin-the-contract test: edit a car doc's torque, reload, assert derived accel changed **with no rebuild**.

### Open calls (user)
1. Racing cart name (directory, binary, target-file identity).
2. Confirm v1 scope depth (document + object; deeper scopes with first real consumer).
3. Confirm game target file home (`userdata/`, one file per game).

---

## 4. Tripwires
- Vendors shipping load-bearing data in extensions that core profiles should cover → extend the core catalog.
- Validation-failure warnings spiking → tighten Studio export; never loosen parsers.
- Anyone proposing an expression grammar "just for derived stats" → the answer is the ruled no (req_4746); curves and ratios as data.
- A consumer reading blueprint values without emitting an application report → reject in review; silent adoption is how `overrides` died.
