# Capture note — game/missions/ (V22/V8/V16/V20, capture wave 2026-06-04)

Scripted objectives — built on the cutscene clock, pathing, and the state
tick's forced events (STRUCTURE's words) — REWRITTEN fresh. The binding
ruling is **V22-CaaS**: dailies are LLM-generated mission ROWS over a closed
schema, the validator proves every slot against the queryable future, the
LLM never touches numbers, narrative hooks are (text, world_delta) pairs,
contracts bind PERSON or POSITION, failure degrades never ends. This is the
LAST system capture; every dependency is consumed strictly through its door.

## Sources (read, never moved/copied/imported)

| piece | reference | what it gave |
|---|---|---|
| objectives | `cart/scape/design.ts` (`Objective`/`ObjectiveTarget`/`QuestStage`/`Quest`, lines 411–440) | the kinds (kill/reach/earn/acquire/talk/evade/use_site), the explicit target union ("so npc-by-Id and zone-by-Key can't be silently confused" — scape's own words), amount ("$ goal, or notoriety ceiling for 'evade'"), itemKey, marker ("the world blip you path to in order to engage"), stage shape {id, brief, objectives} |
| the reward row | `cart/scape/design.ts` (`Quest.reward`) | `{cash?, itemKey?, repDelta?}` — imported as `ActivityReward` from the activities door (already carried verbatim there; no second declaration) |
| the row schema | NO reference implementation — V22's verdict text is the ruled content | client, binding PERSON/POSITION, completion predicate, methods_hinted as affordances guaranteed, narrative_hooks (text, world_delta), expiry semantics, collateral policy, seed + embedding fingerprint, the numbers law |
| the cadence | `game/loop.ts` (V8, already captured) | durations in STATE TICKS; forced tick = the same step call now |
| the clock | `game/cutscene/` (V16, already captured) | its CAPTURE.md names the seam: "story/ and missions/ consume: the clock ops + frame.done" |
| purity/event precedent | `game/perception.ts` + `game/activities/` captures | pure step, inert-by-explicit-design events, parked-run same-reference |

scape's Quest layer is the oracle-flagged contract-first hazard (types, no
consumer); the engine in `run.ts` is built exactly to the ruling and these
tables. **The ruling describes more than the references implement** — the
row pipeline, bindings, collateral, dedup, and hooks have NO corpus
implementation anywhere; built exactly what is ruled, no more.

## Shape

- `tuning.ts` — every knob (P2) + THE GIG PRICER: rows carry zero numbers;
  `missionFromRow` prices reward/expiry/collateral from these tables ("the
  platform diegetically reprices the client's offer").
- `objectives.ts` — the predicate vocabulary, evaluated against the
  QUERYABLE WORLD AS DATA (`MissionFacts`, a plain JSON snapshot per tick).
  An absent fact is never true. Target kind `position` ADDED per V22's
  Hitman identity model (resolves to its occupant via `facts.occupants`).
  `objectiveMarker` is the GAME_PATHING seam (returns the blip; never paths).
- `defs.ts` — `MissionDef` tables: staged objectives + reward + expiry +
  collateral + hooks; `defineMission` fails loud (the createCutscene
  discipline; an empty world_delta is rejected — "a hook without a delta is
  the world calling the app a liar"). Ships `delivery-gig`, V22's ruled
  opening tutorial: the complete-hook's delta is the unfair rating costing
  VISIBLE MONEY (`cashDelta: -45`) and names the arc gate the story capture
  pinned (`opening.unfair-rating.cost-paid`).
- `rows.ts` — the CLOSED row schema + `validateRow` (collect-all problems
  against `MissionAffordances` — the queryable future; methods_hinted must
  be GUARANTEED; any numeric slot anywhere in the row body fails the numbers
  law, fingerprint exempt as generation provenance) + the dedup window
  (same seed, or fingerprint cosine ≥ threshold within the last N rows) +
  `missionFromRow` (validated row → priced, single-stage MissionDef).
- `run.ts` — the pure engine: `acceptMission` (arms position bindings
  against the current occupant) / `stepMission` (ONE call = ONE state tick;
  fixed order: collateral docks rating → objectives latch from facts, stages
  cascade, completion pays EXACTLY what the table says → person-binding
  void check → the tick counts, expiry fails) / `restartMission` (failed
  only) / `rearmMission` (position-bound re-lists against the replacement).
  Deterministic (R6), inert events, parked runs same-reference.
- `stream.ts` — the V20 `missions` concern: per-VERB outcome tallies +
  rating sums (V22's "completion/rating data feeds tomorrow's generation
  weights" made storable), cash, collateral; unknown kinds pass through.
- `index.ts` — the P3 door; `expiryDurationMs` (the one tick→ms conversion
  via GAME_LOOP), `asStoryEventInput` (the GAME_STORY seam), and
  `briefingCutscene` (the V16 seam) live here.

## Verification

- `missions.test.ts`: **30/30** P4 meaning-tests green under v8cli.
- `rjit game verify`: **VERDICT GREEN — 1/1 oracle, 29/29 suites, 2/2 scripts.**
- Cross-door seams proven in tests, not claimed:
  - **story** (deferred item CLOSED): `hookFired` → `asStoryEventInput` →
    `GAME_STORY.recordEvent` — the world_delta rides the payload and gains
    the log's provenance; `channelsFor` fans it out on `:tag:mission`.
  - **cutscene**: `briefingCutscene` → `GAME_CUTSCENE.create` → `sample(t)`
    shows the client's accept-hook line; scrub-back yields the byte-identical
    frame (V16's one clock).
  - **pathing**: `objectiveMarker` → `GAME_PATHING.planMotion` →
    `sampleMotion(end)` arrives at the blip.
  - **loop**: `expiryDurationMs` = ticks × `stateTickIntervalMs()`.
  - **THE OPENING CHAIN**: playing `delivery-gig` to completion on forced
    ticks fires the unfair-rating hook; applying its delta's flag advances
    `OPENING_ARC` past stage 5 (proven against GAME_STORY's `advanceArc`).

## Deferred-item closures

- story/CAPTURE.md: "narrative_hooks … → the missions capture" — CLOSED
  (hooks in the row schema + defs; recorded through the story log).
- activities/CAPTURE.md: "completion-by-world-query belongs to missions" —
  CLOSED (`MissionFacts` + `evaluateObjective`).
- perception.CAPTURE.md's missions-shaped deferral (the event vocabulary)
  was already closed by the story capture; missions consumes event ids
  through GAME_STORY's door and adds none of its own.

## Judgment calls + ambiguities (for the supervisor)

1. **The facts snapshot is the queryable world's engine-side shape** — no
   ruling names the query surface; `MissionFacts` (positions, cash,
   notoriety, inventory, downs, talks, sites, zones, occupants) is a
   FIRST-CUT field set sized to the reference objective kinds. New objective
   kinds arrive as field ADDITIONS.
2. **The numbers law applied strictly**: row objectives are the
   target-shaped kinds only (kill/reach-zone/acquire/talk/use_site);
   amount-shaped objectives (earn/evade) and point coordinates are
   authored-table territory because a row may not carry a number. If a
   verdict wants LLM-placed coordinates-by-name, that's a slot-vocabulary
   ADDITION (e.g. named locations), not a law change.
3. **"Unrelated death" made mechanical**: a person-bound contract voids when
   the bound npc is down UNLESS some stage's kill objective resolves to him
   (then his death is the mission's own business). Cause attribution beyond
   that needs the V21 NPC body; not invented.
4. **Re-arm is caller-driven** (`rearmMission(run, def, replacementId)`):
   vacancy/refill curves are V22 world-state (P2, the population lane);
   the engine exposes the re-arm, the world decides when the post refills.
5. **Rating never scales pay** — the dispatch's "rewards pay what the table
   says" taken literally; the rating is the RECORD feeding generation
   weights. The delivery gig's visible-money cost is therefore a HOOK DELTA
   (scripted beat), not an engine law. One edit to re-rule.
6. **First-cut P2 numbers**: pricing-by-verb, 'daily' = 2700 ticks (no ruled
   day length), collateral policy deltas, rating base 5 / min 0, reach
   radius 2m, dedup threshold 0.92 / window 32, briefing rig 'Cinematic' /
   3s lines. All flagged in tuning.ts for editors/tuning.
7. **Relationship accumulation / character intros as unlocks** — story's
   deferral says "lands with population/missions"; NOT built here because
   the accumulator needs the V21 NPC body (the same fence story and
   perception drew). The mission outcome events in the story log are the
   ruled substrate it will fold over.
8. **One-token edit outside my files**: `'GAME_MISSIONS'` added to
   `game/index.test.ts`'s `live` list (the established registration
   precedent). `game/index.ts` untouched (the door line already existed).
