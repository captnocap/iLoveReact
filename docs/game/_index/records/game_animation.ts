import type { DocIndex } from '../types';

export const game_animation: DocIndex = {
  name: 'game_animation',
  file: 'hmsc-int.md',
  cart: 'cart/hmsc-int/game/animation/index.ts',
  purpose: ['animation', 'scripting', 'format'],
  summary:
    'V6 fresh capture of the animation action layer: parsed animation timelines, target aliases, open action verbs, loop detection, and sinusoidal sampling behind the GAME_ANIMATION door.',
  interfaces: [
    {
      name: 'GAME_ANIMATION',
      purpose: ['animation', 'scripting'],
      kind: 'module',
      sourceFile: 'cart/hmsc-int/game/animation/index.ts',
      description:
        'The P3 door for the V6 animation action layer. Carries parse/sample helpers, target alias data, DSL tuning data, looping detection, and the sinusoidal weight function.',
      status: 'live',
    },
    {
      name: 'ANIMATION_DSL_TUNING',
      purpose: ['animation', 'format'],
      kind: 'registry',
      sourceFile: 'cart/hmsc-int/game/animation/index.ts',
      description:
        'P2 data for the captured DSL semantics: separators, bracket-group regex, normalization rule, loop suffix/exact names, non-loop end clamp epsilon, and the single sine weight curve label.',
      status: 'live',
    },
    {
      name: 'ANIMATION_TARGET_ALIASES',
      purpose: ['animation', 'format'],
      kind: 'registry',
      sourceFile: 'cart/hmsc-int/game/animation/index.ts',
      description:
        'The captured alias table for body, face, and vehicle targets. Unknown targets normalize and pass through unchanged.',
      status: 'live',
    },
    {
      name: 'parseAnimationDsl',
      purpose: ['animation', 'scripting'],
      kind: 'dsl',
      sourceFile: 'cart/hmsc-int/game/animation/index.ts',
      description:
        'Parses the reference bracket/pipe DSL semantics into AnimationTimeline data: bracket groups or pipe chunks as sequential steps, semicolon parallel actions, comma fields, duration validation, max-duration step sizing, total duration, and no-action error reporting.',
      status: 'live',
    },
    {
      name: 'sampleAnimationTimeline',
      purpose: ['animation'],
      kind: 'utility',
      sourceFile: 'cart/hmsc-int/game/animation/index.ts',
      description:
        'Samples a timeline into current-step SampledAction rows. Non-looping timelines clamp to total minus epsilon; looping timelines modulo time; each action returns phase and sin(phase*pi) weight with no cross-step interpolation.',
      dependsOn: ['isAnimationTimelineLooping'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'parsed action timeline as the semantic target',
      purpose: ['animation', 'format'],
      description:
        'The bracket string is an import format only. Consumers depend on parsed timeline/action rows so the later RLE/relational storage can preserve semantics without preserving the quick string syntax.',
      examples: ['animationDsl', 'hmsc_int'],
      status: 'resolved',
    },
  ],
  hazards: [
    {
      name: 'open animation verbs are not a missing enum',
      purpose: ['animation'],
      description:
        'The reference accepts any action token after normalization. Narrowing verbs to a fixed enum would be a semantic regression; interpretation belongs to consumers.',
      evidence: ['cart/hmsc-int/game/animation/CAPTURE.md'],
      severity: 'medium',
    },
    {
      name: 'bracket DSL is compatibility, not the future storage format',
      purpose: ['animation', 'format'],
      description:
        'V6 rules the DSL semantics live but the string format retires as the primary representation. New systems should target parsed action data and leave room for RLE/relational storage.',
      evidence: ['docs/game/DECISIONS.md:317-320', 'cart/hmsc-int/game/animation/CAPTURE.md'],
      severity: 'medium',
    },
  ],
};
