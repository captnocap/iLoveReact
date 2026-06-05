# Capture note — game/perception.ts (V12, capture wave 2026-06-04)

The detective loop, rewritten fresh per V12: **combat_lab's perception ladder
PRODUCES; scape's consequence layer (WitnessMemory, the Case) CONSUMES** —
plus the display warp (`perceivedChance`), the other half of the ground-truth
law whose truth side landed in the chance capture. References untouched.

## Sources (read, never moved/copied/imported)

| piece | old file | what it contained |
|---|---|---|
| the ladder | `cart/combat_lab/index.tsx` (inline sim loop) | FoV-cone vision gated by exposure, suspicion fill = exposure×proximity/reactionSeconds, omnidirectional tile-noise hearing (run 16m / walk 8m / crouch 3.5m × tile npc.noise; gunshot 40m, salience 1), thresholds 0.33/0.66/1.0, dwell timers 1.4/2.5/8s, decay 0.12/s, stimulus vs lastKnown (confirmed-only), terminal by kind (hostile/panic), notify hand-off, lost-trail → alert@0.6, gang-shout 14m |
| the consequences | `cart/scape/design.ts` (types) + `cart/scape/state/player.ts` (`computeNotoriety`) | EvidenceAxis/Suspicion (5 axes 0..100), VisualSignature, WitnessMemory, the Case, notoriety = weighted blend (visual 1.5 / fund 0.8 / others 1.0, normalised 0..100) |
| the warp | `cart/scape/systems/perception.ts` | `perceivedChance` (dampen + quadratic manic optimism past h=60 + sin-flicker), `optimismBias`, `FLICKER_OMEGA = 16` |

## Verification

- `game/perception.test.ts`: **22/22** P4 meaning-tests green under v8cli.
- **Fidelity sweep (the accepted bar): 14,412 cases identical** to the
  references for everything importable — `perceivedChance` over a
  pTrue×high×time grid (incl. the sober gate and the tweaking line),
  `optimismBias` at 0.5-steps, `computeNotoriety` over 5-axis vectors.
- **The ladder has NO importable reference** — it is interleaved with
  rendering/movement inside combat_lab's React component and is not exported.
  Honest substitute: every constant was carried line-verified against the
  source (thresholds, dwells, decay, proximity curve, exposure gate, noise
  radii/salience/cadence, lost-trail, shout/notify radii), and the meaning
  tests pin the transitions the lab demonstrates (single-step cascade,
  confirmed-only lastKnown, fighters-triangulate-shots, report hand-off).
- `rjit game verify`: **VERDICT GREEN — 20/20 suites, 2/2 scripts.**

## Shape decisions

- **The ladder is a PURE step**: `perceptionStep(state, input, ctx) → {state,
  events}`. The lab's perceive→escalate ordering is preserved exactly,
  including the sequential threshold cascade (one overwhelming stimulus runs
  calm→spooked→alert→hostile in one step). Movement/steering (the ACT layer —
  investigate pathing, notify travel, tend) stays with the NPC/AI capture;
  the notify arrives HERE as the `report` input, the shout/deliver radii are
  tuning data for that layer.
- **Consequence hooks are INERT-BY-EXPLICIT-DESIGN**: every rung returns a
  `PerceptionEvent` (`spooked/alerted/hostile/panicked/sightingConfirmed/
  lostTrail/calmed`); nothing dispatches them until story/missions land. A
  pure return cannot silently half-fire — that is the stated judgment call
  over fail-loud (there is no side effect to fail).
- **Chance item 3 CLOSED**: `awarenessForChance(mode)` maps the ladder onto
  the chance surface's target-awareness input (calm→unaware, spooked/alert/
  hostile→alert, panic/notify→fleeing) as a tuning-table record. Perception
  imports nothing from chance and chance imports nothing from perception —
  the seam is a string.
- **Profile type reused** from `./kinds` (`NpcPerceptionProfile`) — one
  definition, no duplication.
- Positions are hmsc world meters `{x,z}` (scape's 2D `Tile {x,y}` adapted).

## Deliberately NOT carried

- **The ACT layer** (patrol, investigate walk, hostile advance/hold,
  notify pathing, paramedic `tend`, ragdoll/`down`) — NPC behavior, not
  perception. `down`/`tend` are therefore not AwarenessModes.
- **scape's NPC body** (`Npc` with souls, wallets, schedules, ActivationTier)
  — V21 population/promotion territory.
- **`HighState`** — the high SIGNAL belongs to the player-state system; the
  warp consumes a plain 0..100 intensity number.
- **`MurderEvent`** — the event vocabulary belongs to story/missions; the
  Case references events by id.
- **`Suspicion`-axis decay / laundering / zone detection pressure** — design
  vocabulary with no reference behavior; not invented.

## Conflicts / ambiguities surfaced (NOT silently picked)

1. **FIRST-CUT curves (unruled, flagged in tuning + code):**
   `witnessCertainty` (exposure × (1 − 0.6·rangeFraction)) — scape designs
   "certainty from distance / fov / lighting" with NO implementation;
   `matchSignature` weights (0.4/0.35/0.25); `visualHeatPerReport` (12 points
   per certainty-1.0 report). The V12 "more internal tooling" lab owns these.
2. **awareness mapping judgment**: hostile→'alert' (a hostile faces you — it
   is not fleeing); spooked→'alert' (frozen-but-aware). Defensible, not
   ruled; the mapping is a P2 table entry, one edit to re-rule.
3. **Report to a non-fighter**: the lab only ever notifies officers
   (fighters). The capture lets a report reach an unarmed perceiver → panic
   (consistent with shot-heard); flagged because the lab never exercises it.
4. **scape `NpcState` vocabulary** (`idle/routine/alert/fleeing/witness/dead`)
   does NOT map 1:1 onto the ladder modes; the ladder (the producer ruling)
   wins, and `witness` becomes a fact (holding a WitnessMemory), not a mode.
5. **One-token edit outside my files**: `'GAME_PERCEPTION'` added to
   `game/index.test.ts`'s `live` list (the established registration
   precedent). `game/index.ts` untouched.
