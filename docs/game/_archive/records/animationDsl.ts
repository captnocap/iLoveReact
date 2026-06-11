import type { DocIndex } from '../types';

export const animationDsl: DocIndex = {
  name: 'animationDsl',
  file: 'animationDsl.md',
  purpose: ['animation', 'scripting', 'format'],
  summary:
    'A self-contained string-based animation timeline DSL parser and sampler that turns human-readable descriptions like "2, arm, raise; 1, head, nod | 3, wheels, spin_loop" into a structured timeline sampleable at arbitrary time to produce weighted SampledAction commands for the primitive-cluster character and vehicle systems.',
  interfaces: [
    {
      name: 'TimelineAction',
      purpose: ['animation', 'format'],
      kind: 'data_model',
      sourceFile: 'cart/animationDsl.ts',
      description:
        'A single action within a timeline step: { duration (seconds), target (canonical name), action (canonical name), args (normalized strings) }.',
      status: 'live',
    },
    {
      name: 'TimelineStep',
      purpose: ['animation', 'format'],
      kind: 'data_model',
      sourceFile: 'cart/animationDsl.ts',
      description:
        'A parallel group of actions: { duration, actions }. All actions in a step start together; the step duration is the longest action duration in the group.',
      status: 'live',
    },
    {
      name: 'AnimationTimeline',
      purpose: ['animation', 'format'],
      kind: 'data_model',
      sourceFile: 'cart/animationDsl.ts',
      description:
        'The parsed product: { steps, total (sum of step durations = non-looping playback length), error? (set if parsing yields no valid steps) }.',
      status: 'live',
    },
    {
      name: 'SampledAction',
      purpose: ['animation'],
      kind: 'data_model',
      sourceFile: 'cart/animationDsl.ts',
      description:
        'The runtime sample product: { target, action, phase (0..1 progress), weight (sin(phase*pi) ease-in-out), args }. Consumers read phase and weight to interpolate transforms.',
      consumers: ['cart/vehicle_lab/index.tsx', 'cart/pathing_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'parseAnimationDsl',
      purpose: ['animation', 'scripting'],
      kind: 'dsl',
      sourceFile: 'cart/animationDsl.ts',
      codeRef: 'cart/animationDsl.ts:99-121',
      description:
        'Parses a DSL string into an AnimationTimeline. Extracts bracket groups [...] (parallel actions in one step) or, if none, splits on | (sequential steps); within a chunk splits on ;, parses each segment with parseAction (splits on , requires >=3 parts, validates duration finite and > 0), builds a TimelineStep with duration = max action duration, sums into total. No steps -> error.',
      consumers: ['cart/vehicle_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'sampleAnimationTimeline',
      purpose: ['animation'],
      kind: 'utility',
      sourceFile: 'cart/animationDsl.ts',
      codeRef: 'cart/animationDsl.ts:123-148',
      description:
        'Samples the timeline at a given time. total <= 0 -> []. Looping (via isAnimationTimelineLooping) -> t = seconds % total, else clamp to [0, total). Walks steps subtracting durations, then per action: phase = clamp01(t / duration), weight = sin(phase*pi). No interpolation between steps.',
      dependsOn: ['isAnimationTimelineLooping'],
      consumers: ['cart/vehicle_lab/index.tsx'],
      status: 'live',
    },
    {
      name: 'isAnimationTimelineLooping',
      purpose: ['animation'],
      kind: 'utility',
      sourceFile: 'cart/animationDsl.ts',
      description:
        'Returns true if any action name ends in _loop or is exactly shake_in_air. This flag changes sampling from clamp to modulo time.',
      status: 'live',
    },
    {
      name: 'canonicalTarget',
      purpose: ['animation', 'format'],
      kind: 'utility',
      sourceFile: 'cart/animationDsl.ts',
      codeRef: 'cart/animationDsl.ts:29-79',
      description:
        'Normalizes input (trim().toLowerCase().replace(/[\\s-]+/g, "_")) then looks up TARGET_ALIASES (arm->both_arms, l_arm->left_arm, tire/tires/wheel->wheels, steering->front_wheels, shocks->suspension, car/auto->vehicle, etc). Unknown targets pass through unchanged after normalization.',
      dependsOn: ['TARGET_ALIASES'],
      status: 'live',
    },
    {
      name: 'TARGET_ALIASES',
      purpose: ['animation', 'format'],
      kind: 'registry',
      sourceFile: 'cart/animationDsl.ts',
      codeRef: 'cart/animationDsl.ts:29-79',
      description:
        'The alias->canonical target table covering arms/hands/wrists/fists/fingers/legs/feet (left/right/both), face targets, and vehicle parts (wheels/front_wheels/rear_wheels/suspension/vehicle).',
      status: 'live',
    },
    {
      name: 'parseAction',
      purpose: ['animation', 'scripting'],
      kind: 'utility',
      sourceFile: 'cart/animationDsl.ts',
      description:
        'Parses one action segment: splits on , trims, requires >=3 parts, validates duration finite and > 0, normalizes target via canonicalTarget and action/args to lowercase underscores.',
      dependsOn: ['canonicalTarget'],
      status: 'live',
    },
    {
      name: 'head_lab/animDsl.ts (re-export shim)',
      purpose: ['animation'],
      kind: 'import',
      sourceFile: 'cart/head_lab/animDsl.ts',
      description: "Re-export shim: export * from '../animationDsl';",
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'sinusoidal ease weight',
      purpose: ['animation', 'math'],
      description:
        'weight = Math.sin(phase * pi)  rises to 1 at midpoint, falls to 0 at end. The only built-in easing curve; consumers may apply additional curves.',
      examples: ['animationDsl', 'vehicle_lab', 'pathing_lab'],
      status: 'recurring',
    },
    {
      name: 'bypass-the-parser hand-built SampledAction[]',
      purpose: ['animation'],
      description:
        'pathing_lab constructs SampledAction objects directly (skipping parseAnimationDsl) for procedural animation driven by simulation state (odometer -> spin_loop phase, steering angle -> steer_loop phase). The SampledAction shape is a consumer contract independent of the DSL.',
      examples: ['pathing_lab'],
      status: 'recurring',
    },
    {
      name: 'pose-DSL registry feeding parse -> sample -> build',
      purpose: ['animation', 'vehicle'],
      description:
        'vehicle_lab stores pose DSL strings in a VEHICLE_POSES registry; useMemo chain parseAnimationDsl -> sampleAnimationTimeline -> buildVehicle translates spin_loop/steer_loop/bounce_loop into wheel/steer/suspension transforms.',
      examples: ['vehicle_lab'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'no cross-step interpolation',
      purpose: ['animation'],
      description:
        'Sampling returns only the current step actions; there is no cross-fade from the previous step. Transitions between steps are instant.',
      evidence: ['animationDsl.md:242'],
      severity: 'low',
    },
    {
      name: 'looping is name-pattern magic (_loop / shake_in_air)',
      purpose: ['animation'],
      description:
        'Whether the whole timeline loops (modulo) vs clamps is decided by whether ANY action name ends in _loop or is exactly shake_in_air  a hidden string-suffix convention, not an explicit flag. An action named without the suffix silently clamps instead of looping.',
      evidence: ['animationDsl.md:187-191, glossary Looping detection'],
      severity: 'medium',
    },
    {
      name: 'weight is always sinusoidal',
      purpose: ['animation'],
      description:
        'weight is always sin(phase * pi); there is no other easing curve in the module. Consumers needing a different curve must apply it themselves.',
      evidence: ['animationDsl.md:241'],
      severity: 'low',
    },
    {
      name: 'unknown targets pass through unchanged',
      purpose: ['animation', 'format'],
      description:
        'A target not in TARGET_ALIASES is not rejected  it is normalized and passed through verbatim, so a typo silently becomes an unrecognized target rather than an error.',
      evidence: ['animationDsl.md:150'],
      severity: 'low',
    },
  ],
};
