// Shim — composition.ts was renamed to prompt-composition.ts on 2026-05-05
// to free the name "Composition" for the spec's stage-orchestrator entity
// (a multi-stage work definition, distinct from the prompt-assembly composer
// this file used to model). Old TS export names are aliased here.
//
// Remove this shim after one cycle once consumers move to prompt-composition.

export {
  promptCompositionMockData as compositionMockData,
  promptCompositionSchema as compositionSchema,
  promptCompositionReferences as compositionReferences,
  type PromptComposition as Composition,
} from './prompt-composition';
