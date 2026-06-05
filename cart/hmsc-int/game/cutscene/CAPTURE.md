# Capture note — game/cutscene/ (V16, capture wave 2026-06-04)

The live scene format: ONE clock, tracks, scrubbing. REWRITTEN per V16 —
**V16 is a FORMAT RULING with NO prior reference implementation.** The oracle
names zero cutscene carts; `grep -rn cutscene cart/` confirms only door files
mention the word. Per the capture protocol this module is exactly what the
ruling describes and nothing more.

## Sources (behavior contracts, consumed through their own doors)

| ruling ingredient | live system delegated to | what the format takes |
|---|---|---|
| "camera solves are pure" | `game/camera.ts` (`GAME_CAMERA.solve`, `CAMERA_RIGS`) | the full V3 rig breadth (V16: retained for cinematic PoVs) |
| "motion plans are closed-form in t" | `game/pathing.ts` (`GAME_PATHING.planMotion/sampleMotion`) | `MotionPlan` values anchored at their own `t0` |
| "DSL timelines sample at t" | `game/animation/` (`GAME_ANIMATION.parse/sample`) | V6 DSL source, parsed ONCE at `createCutscene` |
| "dialog (head_lab talking faces)" | `GAME_FIGURE` (consumer-side) | the format carries `{at, duration, speaker, text}`; faces render off the frame |

## Verification

- `cutscene.test.ts`: **22/22** P4 meaning-tests green under v8cli — clock (9),
  tracks (9), scrubbing/determinism (4).
- **Fidelity sweep: 804 cases** — over a 201-point grid of the whole clock,
  every sampled track is asserted **identical** (JSON) to the delegated
  system's own pure answer at the same t (`GAME_CAMERA.solve`,
  `GAME_PATHING.sampleMotion`, `GAME_ANIMATION.sample`) against an
  independently re-derived cue-selection spec. The format adds ZERO behavior
  beyond cue selection — that IS the fidelity claim, and the sweep is its
  evidence.
- Scrub determinism pinned: forward, backward, and jump-around sweeps yield
  byte-identical frames; played-to-T and scrubbed-to-T agree; sampling holds
  no state and never mutates the scene.

## Shape decisions

- **THE ONE CLOCK is a pure value** `{duration, t, rate, playing}`; advance/
  scrub/pause/rate/skip are data-in/data-out (same-reference when nothing
  changes). Pause/skip/scrub "fall out free" exactly as the ruling says —
  there is no transport machinery, only purity.
- **`sampleCutscene(scene, t)` is the only evaluation entry** and reads
  nothing but its arguments. No track owns a clock; no track keeps state.
- **Cues are sparse keyed events** (last `at ≤ t` holds); nothing interpolates
  in the format itself. Moving shots are camera `params` as a PURE function of
  cue-local seconds (a declarative TS file can carry pure functions — the
  ruling's "simple TypeScript file" + "camera solves are pure functions of t").
- **Fail loud at build**: `createCutscene` throws on unknown rig, cue outside
  the clock, unparseable DSL, duplicate actor track, non-positive durations.
  An authoring bug surfaces at compile of the scene, never mid-scene.
- **Dialog returns ALL active lines** (overlapping chatter stays overlapping);
  the interval is half-open `[at, at+duration)`.
- **Never baked, scene vs actors**: the format references actors by live
  instance id only (V2-amended baked figures, driven live) — it owns no
  geometry, no figure state, so the player's current clothes/model show.

## Hooks surfaced, not built (scope fence)

- **story/ and missions/** consume cutscenes later: their surface is the clock
  ops + `frame.done` (GAME_MISSIONS' own door note: "built on the cutscene
  clock"). No event bus / completion callback invented — not ruled.
- **Perception**: V16/V12 do NOT wire perception↔cutscene; nothing consumed.
  The inert `PerceptionEvent` hooks stay where the V12 capture left them.

## Ambiguities (surfaced, not guessed)

1. **No reference implementation** — fidelity evidence is delegation-identity
   (above), not a port diff. If a richer scene format was demonstrated
   somewhere outside the repo's docs, it was not findable from the oracle.
2. **Dialog overlap policy** — ruling silent; all active lines returned.
   A one-face-at-a-time rule would be a new verdict.
3. **Camera before the first cue's `at`** — ruling silent; the first cue holds
   (a scene always has a camera). Cue-local time clamps at 0 until the cue starts.
4. **Track interpolation between camera cues** (cut vs blend) — ruling names
   cues-at-times only, so cue changes are hard CUTS; a blend/ease vocabulary
   would be new format, deliberately not invented.
5. **`CUTSCENE_TUNING` is thin** (`defaultRate` only) — honest: V16 rules no
   other timing constants; inventing some to look P2-complete would be fake.
