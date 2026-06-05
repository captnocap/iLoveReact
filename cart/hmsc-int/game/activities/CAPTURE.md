# Capture note — game/activities/ (V22/V8/V20, capture wave 2026-06-04)

Repeatable side loops — the non-mission gameplay verbs — REWRITTEN fresh to
the constitution. The binding ruling is **V22-MODES**: "Game modes are
distribution presets. SAMP/VCMP's 15 years A/B-tested the verb space: role,
rob, chase, evade, race, jump, accumulate. Each is a conditioning preset of
the V21 machine, not a new system." Missions (CaaS rows) and story are
SEPARATE later captures; this module is the loop layer only.

## Sources (read, never moved/copied/imported)

| piece | reference | what it gave |
|---|---|---|
| the reward row | `cart/scape/design.ts` (`Quest.reward`) | `{cash?, itemKey?, repDelta?}` carried verbatim |
| the dealing loop | `cart/scape/design.ts` (`Order`, the dealing doctrine) + `cart/scape/ROADMAP.md` Phase 7 | "order → cook(QTE) → deliver(risk) → cash"; "accept → cook → deliver → paid, and a sloppy hand-off raises heat"; "fussy buyers pay more, demand better" (minQuality) |
| the cadence | `game/loop.ts` (V8/V8-CLARIFIED, already captured) | durations in STATE TICKS; ~45/min reconciliation; player actions force immediate ticks |
| the stream shape | `cart/hmsc-int/data/index.ts` (V20 layer, already captured) | `StreamDef` — log + materializer in ONE registration |
| purity/event precedent | `game/perception.ts` capture | pure step, inert-by-explicit-design events |

**The ruling describes more than the references implement** — and the oracle
itself flags scape's dealing/quests as contract-first types with NO consumers
(MEDIUM hazard, scape record). There is no verb-preset implementation
anywhere in the corpus. Built exactly what's ruled:

## Shape

- `verbs.ts` — the seven ruled verbs as data, each a `DistributionPreset`
  whose field vocabulary is V21's own ruling text ("cops up, civilians to
  zero, convergence bias, promotion budget", temperature knob). **The V21
  machine OWNS interpretation** — these records only name what a mode dials.
- `defs.ts` — `ActivityDefinition`: stages (each `ticks` / `signal` /
  `signalWithin`), a reward row, a repeat policy (`auto`/`manual`), an
  optional quality policy. `defineActivity` validates LOUD at table-build
  time (the createCutscene discipline) and is exported so labs author their
  own. Tables shipped: `dealing` (reference-designed), `street-race`
  (ruling-derived; proves the format is table-general).
- `run.ts` — the pure engine: `startRun` / `stepRun` (ONE call = ONE state
  tick; signals first, then the tick counts) / `restartRun`. Deterministic
  (R6): no randomness, no clock reads — same schedule, byte-identical runs
  and events. Events are inert pure returns; `heatRaised` is the V12 hook
  surfaced, not built. Failure degrades, never ends (V22): failed runs
  always revive via `restartRun`; sloppy play still pays (scaled).
- `stream.ts` — the V20 `activities` concern: the engine's event vocabulary
  is the stream's event shape; materializer folds life totals + heat,
  tolerates future event kinds (schema evolution by addition).
- `index.ts` — the P3 door; `stageDurationMs` is the one tick→wall-ms
  conversion, consuming GAME_LOOP's ruled cadence.

## Verification

- `activities.test.ts`: **25/25** P4 meaning-tests green under v8cli — the
  loop advances on the tick (and not before its table says), completes,
  repeats (auto and manual), pays exactly what its table says, fails on
  missed windows, revives, scales payout by quality, raises heat on sloppy
  hand-offs, streams to V20 totals, and is deterministic + non-mutating.
- `rjit game verify`: **VERDICT GREEN — 1/1 oracle, 28/28 suites, 2/2 scripts.**

## Judgment calls + ambiguities (for the supervisor)

1. **Preset VALUES are invented P2 starting points** — no reference anywhere
   implements verb conditioning. Field names come from V21's ruling text;
   numbers are conservative neutrals-with-a-lean, meant for editors/tuning.
   The V21 lane should feel free to rename/reshape `DistributionPreset` when
   the machine lands — the seam is data, version-safe.
2. **`street-race` is ruling-derived content** (V22 names the verb; SAMP race
   = checkpoints against the clock). Exists to prove table-generality; not a
   reference behavior.
3. **One quality channel** — scape designs cook-quality (minQuality) and
   hand-off-sloppiness as separate moments; collapsed to "any signal may
   carry quality ∈ [0,1], the run keeps the minimum" so one mechanism carries
   both ("demand better" + "sloppy hand-off raises heat"). A second channel
   is an ADDITION if a verdict wants it.
4. **No loop integration** — R3 keeps the loop API minimal until the
   loop-shapes lab rules; the engine is therefore caller-cadenced (one
   stepRun call = one state tick; a player action's forced tick = the same
   call now with signals). Nothing here owns a timer.
5. **V21 overlap surfaced**: presets (above) and nothing else. Population,
   token pathing, promotion are NOT touched.
6. **Cutscene/story/missions hooks surfaced, not built**: events are pure
   returns; `heatRaised` is V12's input when consequences wire up; missions
   will compose activities' signals, not the other way around.

## Deliberately NOT carried

- scape's `Order` marketplace fields (customerId, sting honeypots, qty) —
  dead-internet/market machinery, a scape-side system, not the loop layer.
- scape's `Objective`/`ObjectiveTarget` world predicates (kill/reach/zone…)
  — completion-by-world-query belongs to missions (the CaaS validator's
  "queryable future"), not to the side-loop engine; activities complete on
  reported signals + tick counts.
- shitcoin's MiningRig / voxel_stack's mine-build — their own economies;
  noted as 'accumulate'-shaped idioms only.
