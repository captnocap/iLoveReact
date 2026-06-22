# The Skybox & The Void — playbook

> **STATUS: SEAM 1 BUILT (req_1653); seams 2-5 are design intent, banked.** This
> is the master record for the procedural-shell / "void" doctrine spilled across
> one design session (USER ASKS req_1095 → req_1105). It exists so workers
> invoking the oracle find ONE coherent doctrine instead of ten scattered ledger
> entries, and so the **seams get built at the right times** (USER, req_1105:
> "keep this as the master record that gets referenced when workers invoke the
> oracle so we can build the seams at the right times").
>
> **Seam 1 (the proving slice) is live** in the editor play renderer: the
> `escape_depth` scalar, the continuous `voidDistortion()` fan-out, the
> hash-deterministic procedural shell streaming around the player as the outer
> ring, and the first distortion consumer — **sky-drift**. Files:
> `cart/hmsc-int/game/void/{distance,distortion,shell}.ts`,
> `cart/hmsc-int/render3d/{VoidShell.tsx,skyDrift.ts}`, wired in
> `render3d/GameWorld3D.tsx`; math proven in `game/void/void.test.ts` (9/9).
> `escape_depth` reads REAL player distance for now — the treadmill (seam 2)
> swaps the source. Everything below seam 1 in **Seam build order** is still
> unbuilt; each remains DESIGN-GATED — confirm its shape with the user first.
>
> **DESIGN GATE — do not ad-hoc the seams.** Like the Studio playbook, every
> system below has its *intent* and *data shape* sketched but is NOT ruled into
> the constitution yet. When a slice is next, STOP and confirm its shape with
> the user before building. Two forks are still explicitly the user's call (see
> **Open forks**). Nothing here is a DECISIONS verdict until the user rules it.
>
> **THE LAW (USER, req_1104):**
> > **Outward travel stretches space. Inward travel folds it.**

---

## What it is, in one sentence

The authored city is wrapped in a **procedural shell** — an endless hash-generated
city that costs nothing to store — and that shell is not scenery: it's a second
axis of play (a roguelite "void run"), a forbidden challenge (the coast), a
psychological spatial trap (the treadmill), and a free Vice-City-scale canvas for
modders, all discovered diegetically by a player who simply refuses to stop driving.

## The thesis

> "it makes a game for free and idk anyone who does this" — USER, req_1101.

The engine's biggest *limitation* — procedural repetition — becomes its most
original *feature* by reframing it as **lore**: the world decays because the
player exceeded the believable bounds of the simulation. Technical limit →
cosmic horror.

---

## The narrative spine — why the void IS the game (req_1107)

This is the *why* that should set the tone for every seam built below. The
protagonist's whole drive is **"looking to get away from this shitty place"** —
and the world is built so escape always *looks* in reach and **both ends are a
dead one**:

- **The coast** dangles another city right across the water — and kills you for
  reaching for it. *The system won't let you rise.*
- **The road** promises open highway out — and folds you back two blocks from
  where you started. *There's nowhere else; it's all the same place.*

The geography is the metaphor: the world refuses to let you leave the same way
the **life** refuses to let you leave (the opening arc — broke, high, fired,
trapped in the gig-crime CaaS loop, req_0375). The escape fantasy is the carrot
that powers the whole loop; the dead-end is the truth the player discovers
diegetically. It's PROTECT-THE-ZERO (V22) expressed as level design: no chosen
one, no triumphant exit — the platform harvests, the city keeps you. The void
isn't a boundary system bolted onto the game; **it's the central metaphor the
rest of the game is the setup for.** Build the seams bleak.

## One generator, four jobs

The same hash-deterministic city generator (the archived `hmsc_massive_map_lab`
pattern — pure function of coordinates, zero storage, one-batch instanced draw,
Miami-scale streaming; regenerate-don't-port per repo rule) does all of this. It
wraps the authored core as the **outer ring of the SAME citywide map** — NOT a
separate changelevel map (V30: one citywide map, never subdivided), streamed by
the existing radius-bubble + LOD machinery.

| Job | What it is | Framing |
|---|---|---|
| **Coast** | Another city across a water gap; boatable | Overt punishment + a trophy |
| **Road infinity** | Roads seam into endless procedural sprawl | Covert horror, silent |
| **Living nowhere** | NPCs path the void; same one recurs | The doppelganger tell |
| **Mod canvas** | Huge bolted-on authorable space | The modder's gift |

---

## 1 — The two halves (req_1099)

Both fed by the one generator; **opposite emotional beats**, differentiated only
by geography + trigger overlay.

- **Coast (overt).** A tempting other-city across water. Notoriety climbs as you
  cross; you get blasted (a V30 ENGAGED apache hunter, pinned online). **No
  invisible wall — the heat IS the boundary.** Survive to the far shore →
  `setFlag(...)` → achievement. What's actually there can be more procedural
  nothing; the grass-is-greener city is empty too, and that's the point.
- **Road (covert).** Authored roads seam *contiguously* into procedural chunks.
  **No notoriety, no trigger, no warning.** The player emergently discovers
  they're "driving nowhere." Punishment vs silence = the two teaching signals.

**HARD CONSTRAINT:** the coast stays **Euclidean and honest** — it's a real
crossing with a real achievement, so it can NEVER fold (see §4). The dream-logic
is road-only.

---

## 2 — Void Distance: believability decay (req_1101)

One registered scalar drives everything:

```
escape_depth = max(0, distance_from_core - safe_radius)
```

- **ONE continuous distortion curve.** The named tier-bands (10/25/50/75/100/150
  km) are milestones for achievement toasts, **not** six step-functions.
- **`voidDistortion(escape_depth)`** = a pure function → a weight struct
  `{ trafficFlip, npcOrientCorrupt, controlInvert, skyDrift, dialogCorrupt,
  spawnWeird, roadRepeat, awarenessGlitch, instrumentLie }`. Every consumer
  multiplies its behavior by *its* weight. **No consumer hardcodes a km check.**
- **The tiers, as authored** (USER, req_1101): 10km repeated buildings/shop
  names/face variants → 25km roads loop, signs to nowhere, radio repeats →
  50km wrong traffic, cars too slow, peds path into fields, doors don't open →
  75km sky glitches, NPCs stare, same motel every few blocks, nonsense street
  names → 100km **Truman tax** (cars reverse, people float, controls invert,
  gravity pulses, police radios say your name) → 150km the world turns openly
  hostile, the sim trying to eject you.
- **The reframe is load-bearing.** Early decay must read as the world *thinning*,
  not punishment. "the procedural layer is decaying because the player exceeded
  the believable bounds" (USER, req_1101).

Grounding: sky/fog glitch is already `sceneEnv` data (`haze`/`cloud`/`night`
floats) — drift, not new rendering. Dialogue/radio rides `game/story/`.

---

## 3 — The Void Run roguelite (req_1102)

A second axis of play with **no mode menu** — discovered by refusing to stop.

| Layer | Role |
|---|---|
| Authored city | the campaign |
| Procedural shell | the void run |
| Coast city | the forbidden challenge (boss gauntlet) |
| Road infinity | the roguelite descent |

Run loop: prep vehicle / supplies / weapons / gas → **choose escape vector**
(road · coast · rail · boat — an OPEN set) → leave authored city → wrongness
escalates with `escape_depth` → resources degrade → **death/return mints a story**
(a V22 narrative hook `(text, world_delta)` from the run record).

**NO HAND-OUTS (USER, req_1102, correcting an earlier auto-heal proposal):**
environmental wrongness is *positional* (`f(escape_depth)`, so it eases as you
drive back — that's where you are, not a refund), but **player damage/resources
do NOT refund** — healing is by consuming prepped food/items only. This makes
**resource exhaustion the natural governor**: the return trip is the real boss;
over-commit and you can't get back. No hard distance wall needed.

**Void Distance leaderboard** — V20 store run records: furthest depth, time
survived beyond safe radius, vehicle, seed/route direction, mods enabled,
wrongness tier reached, and cause of failure (crash · apache · starvation ·
void ejection · car folded · player gave up). The cursed-speedrun energy is that
the optimal strategy is *stupid* — fuel routing, food, repair, dodging backwards
traffic, surviving control inversions. It reuses the existing survival stack
(`game/vehicle/`, `game/stats.ts` energy/stamina), no new mode.

---

## 4 — The Treadmill / Recursion Field (req_1103 → req_1104)

The road-void is **psychological distance, not physical** — a treadmill with
procedural scenery. The player drives 40 minutes into endless road, panics, turns
around… and the skyline is **right there**. They were never 100km out. They were
two blocks out. *"That makes the player distrust the map itself"* (USER, req_1104).

Mechanically (a procedural displacement layer):

1. Player crosses the road boundary; the world generates "outward" chunks ahead.
2. **True position relative to the authored core is clamped/folded** — the player
   never actually drifts infinitely across coordinates (huge perf + control win:
   bounded simulation regardless of perceived distance).
3. The **instruments lie independently** — odometer, GPS, minimap, distance meter
   each render a *reported* value through their own corruption (`instrumentLie`).
   "GPS says 87km, skyline visible over the fence." They lie; **they never decide.**
4. Turn around → the route collapses back to a nearby seam.

**Make it inconsistent (USER, req_1104)** — sometimes the turn-around works
immediately, sometimes three turns, sometimes the same gas station appears behind
you. The **recycle seam IS the doppelganger tell** — lean into it, don't hide it.
Inconsistency must be a **seeded function of (position, run-seed)**, never
`Math.random` (fair/reproducible leaderboard + V30 `f(seed,t,log)`).

This *dissolved* an earlier "always-on vs depth-gated fold" fork: resources stay
**real** while distance goes **fake** — you can die of starvation "100km out"
while being two blocks from safety, and the post-mortem reveal is the gut-punch.

---

## 5 — The living nowhere (req_1100)

NPCs path the endless city to make it feel alive — and it's **free** under V30's
frozen-world activation predicate: out there NPCs are frozen state rows (no
behavior/pathing) until you enter the local bubble, then they hydrate to full
behavior. Because spawns are **hash-deterministic, the SAME NPC recurs** on the
SAME corner blocks apart — same face, same walk, same parked car. The doppelganger
is the intentional glitch-in-the-matrix **tell**, the horror payload, not a flaw
to hide.

## 6 — The mod canvas (req_1100)

The bolted-on Vice-City-scale shell is the V28 platform/mod affordance: procedural
fill is the **default**, and a modder **overrides chunks with authored content**
per V29 (reference-not-embed). Out of the box a modder gets a huge contiguous
canvas already wired into streaming/collision/pathing, zero authoring cost for the
parts they don't touch.

---

## 7 — The Night Assassin / a hit on your own head (req_1102)

Replaces a Schedule-1-style "go inside at night" curfew with a threat you can
fight, flee, or outsmart. Because the core loop is crime-for-hire from an app,
**the player is a POSITION in someone else's contract** (`game/missions/defs.ts`
already has `client` + a typed `target`).

- At night, an assassin **spawns far across the map and pathes toward you** (a V30
  ENGAGED hunter, pinned online so it can cross the frozen map — one moving state
  row with an ETA, hydrating in-bubble).
- Kill them → open **the same app** to find a posting for your own head with rival
  bidders you can never outbid (validator rule: `target != self`). The cruelty is
  the *same UI you use to ruin others' nights, pointed at you.*
- **Self-balancing:** bid size / lethality / bidder count scale with your CaaS
  activity + notoriety — your success IS the difficulty curve. Cross-links the
  coast notoriety axis into the bounty market.
- The losing bidders are an **emergent recurring rogues' gallery** — named enemies
  from pure data. On-doctrine with V22 PROTECT THE ZERO: you're a harvestable
  node, never a chosen one.

---

## 8 — The Endless Passenger (req_1108)

The narrative payload of the void — the *reason* to drive into the dead-end.
Reference: the end of **Spun** — an 18-hour meth-fueled drive to drop someone off
a city away, then show up at an ex who's living a better life, arriving with
literally no reason to be there. The journey is the whole thing; there is no
arrival.

The mechanic:

- An NPC event — walk by, they carry a mission marker, you interact. **They ask
  for a ride into the void.**
- **The mission never ends.** It's a *treadmill mission*: the stated destination
  (a drop-off, a sister, an ex two towns over) is always "ahead," and the fold
  (§4) guarantees you never arrive. The recursion field is what makes "never
  arriving" diegetic instead of a scripted softlock — the void is the reason the
  road never delivers them.
- **The passenger talks, forever.** As you drive and drive, their monologue keeps
  going. A finite authored script can't fill an infinite drive — so it's
  **generative**: `useAssistant` (`runtime/hooks/useAssistant.ts` — streams; the
  `local_ai` .gguf backend can run offline) is the inexhaustible voice. Toggled
  on as **"game enrichment"** (USER, req_1108) — opt-in.
- **Decay rides the depth.** Prompt the model with the current wrongness so the
  passenger's coherence tracks `voidDistortion.dialogCorrupt` — lucid near the
  city, drifting / looping / unhinged the deeper you go. The Spun meth-monologue
  texture intensifies with `escape_depth`.

**THE GUARDRAIL (V22 P2 — non-negotiable):** the LLM **never touches numbers**.
The passenger's output is TEXT ONLY — pure ambiance. It cannot set flags, complete
the mission, spend money, change state, or steer any mechanic except through a
validated **(text, world_delta)** narrative hook. Free model text drives nothing
but the player's ears.

**Enrichment is optional, never required.** With the toggle off (or no model
available), the passenger falls back to a canned/looping line pool — the mechanic
exists without an LLM; the model only makes the voice infinite. Game ships and
plays offline.

## Design disciplines (must not break)

These are the invariants a worker is most likely to get wrong:

1. **Believability-decay is a SEPARATE axis from notoriety.** Coast = overt social
   heat you earned. Road void = covert environmental decay you never agreed to.
   Never conflate. (At extreme depth the void *corrupts* the awareness system —
   that's the void acting on notoriety, not notoriety causing the void.)
2. **One source of truth.** ONE true `escape_depth`; the instruments are lying
   *views* over it. They lie; they never decide. `voidDistortion()` is the one
   fan-out function; no system hardcodes a distance threshold.
3. **Seeded, never random.** All distortion + the treadmill's inconsistency are
   pure seeded functions of (depth, seed, position, time). Required for a fair
   leaderboard and V30 `f(seed,t,log)`.
4. **No hand-outs.** Wrongness is positional; damage/resources heal only via
   consumables. Resource exhaustion is the governor, not an invisible wall.
5. **The coast stays Euclidean.** The treadmill/fold is road-void only.
6. **The repetition is the feature.** The recycle seam and the recurring NPC are
   the horror tell, leaned into — not bugs to paper over.

---

## Open forks (the user's call)

1. **Treadmill inconsistency shape** — the user chose "make it inconsistent";
   the exact band between "always folds home" and "sometimes strands you" is the
   difficulty knob, still to be tuned with the resource model.
2. **The 150km terminal** — diegetic "the simulation ejects you" (flavor only,
   since resources are the real cap) vs uncapped for masochists (leaderboard runs
   forever). Leaning: flavor-only; supplies govern.

---

## Seam build order (when the day comes)

Nothing is built. When the user says go, the proving-slice order:

1. ✅ **BUILT (req_1653) — Procedural shell + `escape_depth` scalar +
   `voidDistortion()` skeleton.** The shell streams around the authored core
   (`game/void/shell.ts` + `render3d/VoidShell.tsx`, one instanced batch, skips
   core chunks); `escape_depth` reads real distance for now
   (`game/void/distance.ts`); `voidDistortion()` is the continuous fan-out
   (`game/void/distortion.ts`). First visible distortion = **sky-drift**
   (`render3d/skyDrift.ts`, warps the existing `HmscSky` floats), wired in
   `GameWorld3D`. Drive past the authored edge in `rjit dev hmsc-int` to see it.
   Tests: `game/void/void.test.ts`.
2. **The treadmill** — swap `escape_depth` from real-distance to the virtual
   accumulator; clamp true position; recycle the fold-region. This is the genuine
   technical mechanic — the **seam must feel seamless**, so it warrants a tiny
   proof-of-concept before integration.
3. **Instruments-lie layer** — Hud (`render/Hud.tsx`, `EmbodiedHud.tsx`) reads
   reported distance through `instrumentLie`.
4. **Resource governor + Void Distance leaderboard** — wire the survival stack
   (`game/vehicle/`, `game/stats.ts`) to the run; record to V20 store.
5. **Night Assassin** — a `client→target=self` contract spawned at night; the
   bounty board view; the self-scaling difficulty.

Each step is DESIGN-GATED: confirm the data shape with the user first.

---

## What it rides (reuse, don't reinvent)

- **Procedural city** — the `hmsc_massive_map_lab` hash pattern (`docs/game/_archive/hmsc_massive_map_lab.md`).
- **One citywide map / outer ring / frozen activation** — V30.
- **Sky/fog as data** — `cart/hmsc-int/compile/sceneEnv.ts`.
- **Notoriety / ENGAGED hunters** — `cart/hmsc-int/game/perception.ts`.
- **Contracts (client/target)** — `cart/hmsc-int/game/missions/defs.ts`.
- **Survival / vehicle** — `cart/hmsc-int/game/stats/stats.ts`, `cart/hmsc-int/game/vehicle/`.
- **Achievements / dialogue** — `cart/hmsc-int/game/story/` flags.
- **Run records / persistence** — V20 store (`docs/game/_index` `game_world` worldStream family).
- **Instruments** — `cart/hmsc-int/render/Hud.tsx`, `cart/hmsc-int/EmbodiedHud.tsx`.

---

## Provenance

USER ASKS this playbook consolidates: req_1095 (skybox legendary + coast
gauntlet), req_1096 (massive-map lab as the shell), req_1099 (two halves),
req_1100 (living nowhere + mod canvas), req_1101 (Void Distance decay),
req_1102 (roguelite framing + no-hand-outs + Night Assassin), req_1103 (The
Fold), req_1104 (The Treadmill / recursion field + the law), req_1105 (write
the playbook). Indexed for the oracle via `docs/game/_index/records/skybox_void.ts`.
