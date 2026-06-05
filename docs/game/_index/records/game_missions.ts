import type { DocIndex } from '../types';

export const game_missions: DocIndex = {
  name: 'game_missions',
  file: 'hmsc-int.md',
  cart: 'cart/hmsc-int/game/missions/index.ts',
  purpose: ['scripting', 'game_loop', 'agent_llm'],
  summary:
    'V22/V8/V16/V20 capture of scripted objectives — built on the cutscene clock, pathing, and the state tick’s forced events. CaaS dailies are LLM-generated mission ROWS over a CLOSED schema: the validator proves every slot against the queryable future (methods_hinted are affordances guaranteed), the LLM never touches numbers (tuning prices the gig), narrative hooks are (text, world_delta) pairs recorded through GAME_STORY’s log, contracts bind PERSON (voids on unrelated death) or POSITION (re-arms against the replacement). A pure deterministic engine sequences staged objectives per state tick by world-query-as-data; completion pays exactly what the table says; failure degrades never ends (voided is the one impossible-predicate fail screen). The V20 missions stream tallies completion/rating per verb — tomorrow’s generation weights’ input.',
  interfaces: [
    {
      name: 'GAME_MISSIONS',
      purpose: ['scripting', 'game_loop'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/missions/index.ts',
      description:
        'The P3 door: the predicate vocabulary (evaluateObjective/objectiveMarker/TARGET_KINDS), the tables (DEFINITIONS/get) + the defineMission authoring boundary, the CaaS row pipeline (validateRow/missionFromRow/isDuplicateRow), the engine (accept/step/restart/rearm/payoutCash), expiryDurationMs (the one tick→ms conversion via GAME_LOOP), the seams (asStoryEventInput → GAME_STORY’s log; briefingCutscene → the V16 clock), and the V20 stream def. Missions are the SCRIPTED counterpart of activities — that engine completes on reported signals, this one by world query.',
      dependsOn: ['GAME_LOOP', 'GAME_ACTIVITIES', 'GAME_CUTSCENE', 'GAME_STORY', 'GAME_PATHING'],
      status: 'live',
    },
    {
      name: 'evaluateObjective',
      purpose: ['scripting'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/missions/objectives.ts',
      description:
        'The completion predicate as a pure read: scape design.ts’s Objective vocabulary (kill/reach/earn/acquire/talk/evade/use_site, explicit target union, amount = $ goal or notoriety ceiling, marker = the pathing blip) evaluated against MissionFacts — the queryable world as a plain JSON snapshot the caller supplies each tick. An absent fact is never true. Target kind ‘position’ added per V22’s Hitman identity model (resolves to its occupant via facts.occupants).',
      status: 'live',
    },
    {
      name: 'validateRow',
      purpose: ['scripting', 'agent_llm'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/missions/rows.ts',
      description:
        'Proves an LLM-generated mission row against the queryable future (MissionAffordances): every binding/target/item slot must exist, every methods_hinted entry must be GUARANTEED, every hook must carry a non-empty world_delta, and ANY numeric slot anywhere in the row body fails the numbers law (the fingerprint is exempt provenance). COLLECTS all problems (the generation pipeline feeds them back); missionFromRow throws on any and prices the validated row from MISSION_TUNING into a runnable single-stage MissionDef.',
      status: 'live',
    },
    {
      name: 'stepMission',
      purpose: ['scripting', 'game_loop'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/missions/run.ts',
      description:
        'ONE call = ONE state tick (V8; a player action’s forced tick is the same call now with fresh facts). Fixed order: collateral docks the rating per the table’s policy → objectives latch from the facts snapshot, stages cascade, completion fires complete-hooks and pays EXACTLY the table’s reward (the rating is the record, never a pay scaler) → a person-bound run whose person died an unrelated death VOIDS (the one impossible-predicate fail screen) → the tick counts and the listing expires at the table’s tick. Pure + deterministic (R6); events inert; parked runs same-reference. restartMission revives failed listings; rearmMission re-lists a position-bound contract against the replacement (diegetic replay).',
      status: 'live',
    },
    {
      name: 'MISSION_DEFINITIONS',
      purpose: ['scripting'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/game/missions/defs.ts',
      description:
        'The shipped authored tables. delivery-gig is V22’s RULED opening tutorial (the job costume): pickup → dropoff, and the complete-hook’s world_delta IS the ruled constraint — the unfair rating costs visible money (cashDelta −45) and names the OPENING_ARC stage-5 gate the story capture pinned (opening.unfair-rating.cost-paid). defineMission validates loud at table-build time (empty world_delta rejected: a hook without a delta is the world calling the app a liar).',
      status: 'live',
    },
    {
      name: 'missionsStream',
      purpose: ['persistence', 'scripting'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/game/missions/stream.ts',
      description:
        'The V20 missions concern in ONE registration: folds per-VERB outcome tallies (completed/failed/voided + ratingSum — V22’s “completion/rating data feeds tomorrow’s generation weights” made storable), cash paid, collateral docks; unknown future event kinds pass through untouched (schema evolution by addition).',
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'World-query as data (the queryable future reaches the engine as a facts snapshot)',
      purpose: ['scripting', 'game_loop'],
      description:
        'The engine never queries the world — the caller answers the predicates’ questions in a plain JSON MissionFacts snapshot per tick, and the validator proves rows against the same vocabulary as MissionAffordances. Purity, determinism, and headless verify fall out; new objective kinds arrive as field additions.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
    {
      name: 'The numbers law (LLM writes slots, tuning writes numbers)',
      purpose: ['agent_llm', 'scripting'],
      description:
        'A generated row carries only ids/keys/names/text — validateRow rejects numeric slots anywhere in the row body; missionFromRow prices reward/expiry/collateral from MISSION_TUNING. The generator can never mis-price a gig or smuggle a balance change; every number stays a P2 table edit.',
      examples: ['hmsc-int'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'mission pipeline values are ruling-derived, not reference behavior',
      purpose: ['scripting'],
      description:
        'No corpus reference implements the row pipeline, bindings, collateral, dedup, or pricing — scape’s Quest layer is contract-first types with no consumer. Pricing-by-verb, daily=2700 ticks, rating 5..0, dedup 0.92/32, reach 2m are FIRST-CUT P2 starting points; tune in editors/tuning, don’t treat as captured fidelity.',
      evidence: ['cart/hmsc-int/game/missions/tuning.ts', 'cart/hmsc-int/game/missions/CAPTURE.md (judgment calls 1–6)'],
      severity: 'medium',
    },
    {
      name: 'rows cannot carry earn/evade objectives or coordinates',
      purpose: ['scripting', 'agent_llm'],
      description:
        'The numbers law makes amount-shaped objectives (earn/evade) and point targets authored-table-only — a generated daily targeting “earn $500” is unexpressible by design. If a verdict wants LLM-placed amounts/locations, add a named-slot vocabulary (locations/amount tiers as tuning keys); do not weaken validateRow’s numeric rejection.',
      evidence: ['cart/hmsc-int/game/missions/rows.ts (RowObjective, findNumericSlots)'],
      severity: 'low',
    },
  ],
};
