import type { DocIndex } from '../types';

export const game_cutscene: DocIndex = {
  name: 'game_cutscene',
  file: 'hmsc-int.md',
  cart: 'cart/hmsc-int/game/cutscene/index.ts',
  purpose: ['scripting', 'format', 'game_loop'],
  summary:
    'V16 capture of the live scene format: a cutscene is a simple TypeScript file — camera cues, dialog lines, actor tracks (motion plans + animation DSL) — evaluated by ONE pure clock so scrubbing/pause/skip fall out free. Format ruling with no prior reference implementation; every sampled value is the delegated system’s own pure answer at the same t.',
  interfaces: [
    {
      name: 'GAME_CUTSCENE',
      purpose: ['scripting', 'format', 'game_loop'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/cutscene/index.ts',
      description:
        'The P3 door for the V16 live scene format. Carries createCutscene/sampleCutscene (the format) and the one-clock ops (createClock/advance/scrub/setPlaying/setRate/skip/done). story/ and missions/ consume the clock + frame.done later.',
      dependsOn: ['GAME_CAMERA', 'GAME_PATHING', 'GAME_ANIMATION'],
      status: 'live',
    },
    {
      name: 'createCutscene',
      purpose: ['format', 'scripting'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/cutscene/index.ts',
      description:
        'Validate + compile the authored CutsceneDef: sorts cues, resolves CAMERA_RIGS names, parses every animation DSL cue once. Fails loud at build time — unknown rig, cue outside the clock, unparseable DSL, duplicate actor track, non-positive durations are authoring bugs, never mid-scene surprises.',
      status: 'live',
    },
    {
      name: 'sampleCutscene',
      purpose: ['game_loop', 'scripting'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/cutscene/index.ts',
      description:
        'THE ONE CLOCK applied: the only evaluation entry, pure in (scene, t). Camera = GAME_CAMERA.solve of the active cue (params may be a pure function of cue-local seconds — moving shots); actor motion = GAME_PATHING.sampleMotion of the active plan; actions = GAME_ANIMATION.sample at cue-local t; dialog = all lines active over [at, at+duration). Scrubbing backward/forward to T yields the identical frame.',
      status: 'live',
    },
    {
      name: 'CutsceneClock',
      purpose: ['game_loop'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/game/cutscene/index.ts',
      description:
        'The one clock as a pure value {duration, t, rate, playing}. advance/scrub/pause/rate/skip are data-in/data-out (same reference when nothing changes); t is always clamped to [0, duration]. Pause/skip/scrub fall out of purity — there is no transport machinery.',
      status: 'live',
    },
    {
      name: 'CutsceneDef',
      purpose: ['format'],
      kind: 'data_model',
      sourceFile: 'cart/hmsc-int/game/cutscene/index.ts',
      description:
        'The authored format — what the simple TypeScript file declares: duration, camera cues (required: a cutscene IS what tile-space the camera occupies at what time), dialog lines {at, duration, speaker, text}, actor tracks {actor, motions: MotionPlan[], animations: {at, dsl}[]}. Actors are live instance ids only (V2-amended baked figures driven live) — the scene owns no geometry, so the player’s current state shows.',
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'One pure clock drives every track',
      purpose: ['game_loop', 'scripting'],
      description:
        'No track owns a clock or keeps state; sparse cues (last at ≤ t holds) select, the delegated system answers at exactly the same t. The 804-case fidelity sweep asserts byte-identity with GAME_CAMERA.solve / GAME_PATHING.sampleMotion / GAME_ANIMATION.sample over the whole clock.',
      appearsIn: ['hmsc-int'],
      frequency: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'camera cues are hard cuts — blends would be NEW format',
      purpose: ['camera', 'format'],
      description:
        'Camera cue changes are hard CUTS — V16 names cues-at-times only; a blend/ease vocabulary between cues would be NEW format requiring a verdict, not an addition to sneak in. Moving shots belong inside one cue via params-as-pure-function of cue-local seconds.',
      evidence: ['cart/hmsc-int/game/cutscene/index.ts (camera track selection: last cue at ≤ t holds)'],
      severity: 'low',
    },
  ],
};
