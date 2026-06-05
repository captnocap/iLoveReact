# Capture note — game/story/ (V12/V16/V20/V22, capture wave 2026-06-04)

Narrative arcs, dialog, flags — the "more internal tooling for story/mission/
dialog" V12 orders, rewritten fresh. Consumes perception's consequence events
and feeds the cutscene clock STRICTLY through their doors. References
untouched.

## Sources (read, never moved/copied/imported)

| piece | old file | what it contained |
|---|---|---|
| flags | `cart/hmsc/design.ts` (`StoryState`) + `cart/hmsc/events/useHmscEventRules.ts` (`setStoryFlag`) + `cart/hmsc/state/gameState.ts` (revive merge) | `{flags, counters}` JSON state, same-ref no-op writes, defensive revive |
| the event log | `cart/hmsc/events/gameEvents.ts` + `design.ts` (`HmscGameEvent`/`GameEventLogState`) | id/serial assignment (`hmsc_evt_%06d`), 240-ring, safePayload deep-copy, channel fan-out (root/type/actor/subject/tag), importance constants, parentId provenance |
| rules | `cart/hmsc/events/useHmscEventRules.ts` | the two story rules: `lab.entered` → `lab.<id>.visited`, `world.trigger.entered` (labeled) → `trigger.<id>.seen`, each emitting `story.flag.set` with provenance |
| the murder record | `cart/scape/design.ts` (`MurderEvent`) | victim/murderKey/position/zone/perpetratorSignature/witnesses — THE DEFERRED ITEM from perception.CAPTURE.md ("the event vocabulary belongs to story/missions; the Case references events by id") |
| arcs | NO reference implementation — V22 "The opening" is the ruled content | seven beats: sky-ramp dream → wake broke/high → fired → job hunt → delivery gig → tweaker scare → CaaS |
| dialog | NO reference implementation — V16 (cutscene dialog cues) + V22 (event-sourced gating) are the rulings | selection only; presentation is cutscene's |

## Verification

- `game/story/story.test.ts`: **28/28** P4 meaning-tests green under v8cli.
- `rjit game verify`: **VERDICT GREEN — 1/1 oracle, 28/28 suites, 2/2 scripts.**
- Cross-door seams proven in tests, not claimed: `murder.committed` →
  `makeWitnessMemory(event.id)` → `reportToCase` files the id on the Case
  (GAME_PERCEPTION); `selectDialog` → `asCutsceneCue` → `GAME_CUTSCENE.create`
  → `sample(t)` shows the line (GAME_CUTSCENE).

## Shape decisions

- **Everything is a pure step with inert returns** (the perception precedent):
  `applyRules`/`advanceArc` return `{state, effects}` where effects are
  `StoryEventInput`s to record; `recordEvent` appends and returns. Nothing
  dispatches — `channelsFor(event)` names the bus channels as data and the
  shell/loop owns busEmit, exactly as it owns perception dispatch.
- **V22 made mechanical**: no backstory tables exist. Facts are flags rules
  derived from logged events; arcs gate on those facts or a live event;
  dialog gates on state ONLY (`createDialogSet` rejects event gates — gate on
  the flag a rule sets). What the world didn't witness, the story cannot know.
- **Conditions are data** (P2): flag / counter / event records, never
  closures. The one function-in-data is a rule's `derive` (key built from
  event fields — the hmsc `lab.${name}.visited` derivation; cutscene's
  params-as-pure-function is the precedent).
- **Arc cascade semantics** (judgment call, perception's single-step-cascade
  precedent): one `advanceArc` call walks every consecutive STATE-gated stage
  that already holds, but a live event is consumed by AT MOST ONE stage —
  two beats can't both claim the same gunshot. Pinned by test.
- **Murder discovery**: scape's mutable `discovered: boolean` became "record a
  later event with parentId provenance" — the log is append-only (V20);
  records never mutate.
- **Once-dialog latch is a plain flag** (`said.<id>`) — persists, revives, and
  gates like any other fact; no parallel said-set to keep in sync.

## Deliberately NOT carried

- **narrative_hooks (text, world_delta)** — V22 places them in the CaaS
  mission ROW schema → the missions capture. Shared need surfaced: missions
  records its hooks through THIS event log (the world_delta's provenance).
- **Relationship accumulation / character intros as unlocks** — the NPC body
  is V21 population territory (perception left it out too). The log is the
  ruled substrate (witnessed in-log events by id); the accumulator lands with
  population/missions.
- **The V20 stream/snapshot storage** — story state is kept JSON-pure so the
  story stream carries it; the stream machinery itself is the data/ layer's
  capture, not a game module's.
- **Dialog trees / portraits / voice / typewriter pacing** — no ruling, no
  reference; a lab earns the verdict first (P5).

## Conflicts / ambiguities surfaced (NOT silently picked)

1. **Flags are reference-ruled, not verdict-ruled**: oracle "flags" returns NO
   ruling — hmsc's `StoryState` semantics carried verbatim as the authority.
   One edit to re-rule if a verdict lands.
2. **occurredAt is an INPUT** (divergence from hmsc's internal
   `new Date().toISOString()`): the log is a pure function of what it is told
   (V20 determinism, P4 testability). Derived events (flag-set / arc-advanced)
   inherit the trigger's stamp instead of stamping their own now.
3. **OPENING_ARC gate names are FIRST-CUT** (`opening.dream.done`, ...): the
   seven beats are verdict text; the advance flags are not. They're all
   state-gated so any system (mission, command, cutscene) can play a beat.
   The one ruled constraint is encoded in stage 5's gate:
   `opening.unfair-rating.cost-paid` — the beat MUST cost visible money
   before the pivot.
4. **Channel prefix stays `hmsc`** (`hmsc:event`, `hmsc:tag:<t>`) — faithful
   to the live bus consumers; it's a P2 knob (`STORY_TUNING.channelPrefix`).
5. **One-token edit outside my files**: `'GAME_STORY'` added to
   `game/index.test.ts`'s `live` list (the established registration
   precedent). `game/index.ts` untouched (the door line already existed).
