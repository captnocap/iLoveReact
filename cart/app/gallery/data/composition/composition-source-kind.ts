// CompositionSourceKind — registry of source kinds the composer
// understands. Open string look-up. New shape types declare themselves
// here at boot (built-in) or at install time (extension), and become
// immediately slottable into compositions without changing the
// composer internals.
//
// ── Why this is a data shape, not just an enum ────────────────
// Because the user wants the composer "ready for an orchestra" —
// new shapes/ideas inside or outside the current app context. A
// hardcoded enum locks the composer to a fixed set; a registry row
// per kind lets extensions add capability with one INSERT.
//
// Each row declares:
//   - which composition kinds it is valid in (a glossary-attach
//     belongs in 'execution' / 'prompt' / 'context'; a memory-snapshot
//     belongs in 'who'; a budget-state belongs in 'what-when' / 'execution')
//   - an optional resolver script (qjs-eval / framework-method) that
//     turns a Composition source row's `ref` into actual content. Built-in
//     kinds have null resolvers (the composer dispatches by hand);
//     extensions ship their own.

import type { GalleryDataReference, JsonObject } from '../../types';

export type CompositionKind =
  | 'who'
  | 'what-when'
  | 'execution'
  | 'prompt'
  | 'context'
  | 'custom';

export type CompositionSourceKind = {
  id: string;
  label: string;
  description: string;
  applicableToCompositionKinds: CompositionKind[];
  resolverScript?: {
    kind: 'qjs-eval' | 'framework-method';
    body?: string;
    methodNamespace?: string;
    methodName?: string;
  };
  /** Hint for UI: what kind of input does the source `ref` field expect? */
  refKind?: 'row-id' | 'inline-text' | 'computed' | 'composition-id' | 'none';
  authoredBy: 'system' | 'user' | 'extension';
  extensionId?: string;
  createdAt: string;
  updatedAt: string;
};

export const compositionSourceKindMockData: CompositionSourceKind[] = [
  // ── Built-in (system) source kinds ──────────────────────────────
  {
    id: 'src_prompt-fragment',
    label: 'Prompt fragment',
    description: 'Atomic reusable prompt body. Composer concatenates by default.',
    applicableToCompositionKinds: ['prompt', 'context'],
    refKind: 'row-id',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_system-message',
    label: 'System message (legacy shape)',
    description: 'Existing SystemMessage row. Resolver reads body + interpolates variables.',
    applicableToCompositionKinds: ['prompt'],
    refKind: 'row-id',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_prompt-template',
    label: 'Prompt template (legacy shape)',
    description: 'Existing PromptTemplate row. Variables supplied by caller.',
    applicableToCompositionKinds: ['prompt'],
    refKind: 'row-id',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_glossary-attach',
    label: 'Glossary auto-attach',
    description:
      'Resolver scans the assembling prompt body for ProjectGlossary terms and attaches matching entries\' canonicalReferences as context.',
    applicableToCompositionKinds: ['execution', 'prompt', 'context'],
    refKind: 'none',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_retrieval-result',
    label: 'Retrieval result',
    description:
      'Runs a RetrievalQuery against the embedding store with the assembling prompt as the query text. Includes top-k results in context.',
    applicableToCompositionKinds: ['execution', 'context'],
    refKind: 'row-id',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_inline-text',
    label: 'Inline text',
    description: 'Verbatim string supplied in the source row\'s inlineValue. No row reference.',
    applicableToCompositionKinds: ['who', 'what-when', 'execution', 'prompt', 'context', 'custom'],
    refKind: 'inline-text',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_computed',
    label: 'Computed (script-evaluated)',
    description:
      'Runs the source\'s computeScript at assembly time (qjs-eval or framework-method) and uses the return value.',
    applicableToCompositionKinds: ['who', 'what-when', 'execution', 'prompt', 'context', 'custom'],
    refKind: 'computed',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_composition',
    label: 'Composition (recursive)',
    description:
      'The source resolves to the rendered output of another Composition. Enables fractal assembly — execution composition slots a prompt composition, etc.',
    applicableToCompositionKinds: ['who', 'what-when', 'execution', 'prompt', 'context', 'custom'],
    refKind: 'composition-id',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  // ── 'who' phase sources ──────────────────────────────────────────
  {
    id: 'src_user-bio',
    label: 'User bio',
    description:
      'Resolves to the active user\'s `bio` field plus accommodations[] formatted as a "things to know about me" preamble.',
    applicableToCompositionKinds: ['who'],
    refKind: 'none',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_role-base',
    label: 'Role base system message',
    description: 'Resolves to the assigned Role\'s baseSystemMessageId content.',
    applicableToCompositionKinds: ['who'],
    refKind: 'row-id',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_memory-tier-snapshot',
    label: 'Memory tier snapshot',
    description:
      'Pulls the top-N relevant entries from one of the memory tiers (working / episodic / semantic / procedural) for the current worker / goal.',
    applicableToCompositionKinds: ['who', 'context'],
    refKind: 'computed',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  // ── 'what-when' phase sources ────────────────────────────────────
  {
    id: 'src_active-goal',
    label: 'Active goal',
    description:
      'Resolves to the current Goal\'s userTurnText + statement + scopeDuration + outcomeRubricId reference.',
    applicableToCompositionKinds: ['what-when', 'execution', 'prompt'],
    refKind: 'row-id',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_active-plan-phase',
    label: 'Active plan phase',
    description: 'Resolves to the current PlanningPhase + its TaskGraph summary.',
    applicableToCompositionKinds: ['what-when', 'execution'],
    refKind: 'row-id',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_active-constraints',
    label: 'Active constraints',
    description:
      'Computed: aggregates Constraint rows whose scope matches the current Settings / Goal / Plan / Task and whose appliesDuring matches the current phase.',
    applicableToCompositionKinds: ['what-when', 'execution', 'prompt'],
    refKind: 'computed',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_outcome-rubric',
    label: 'Outcome rubric',
    description:
      'Pulls the Goal\'s OutcomeRubric, formatting the gestalt-invariant + dimensions as a "what good looks like" hint.',
    applicableToCompositionKinds: ['what-when', 'execution', 'prompt'],
    refKind: 'row-id',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  // ── 'execution' phase sources ────────────────────────────────────
  {
    id: 'src_connection-info',
    label: 'Connection info',
    description: 'Resolves to the active Connection\'s kind + capabilities + status.',
    applicableToCompositionKinds: ['execution'],
    refKind: 'row-id',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_privacy-snapshot',
    label: 'Privacy snapshot',
    description:
      'Resolves to the active Privacy policy frozen as a snapshot — used both as guardrail context and as the privacySnapshot field on InferenceRequest.',
    applicableToCompositionKinds: ['execution'],
    refKind: 'row-id',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  {
    id: 'src_template-variable',
    label: 'Template variable',
    description:
      'A single TemplateVariable resolved at assembly time (framework-method / qjs-eval / static).',
    applicableToCompositionKinds: ['execution', 'prompt', 'context'],
    refKind: 'row-id',
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
  // ── Character / manifest / quiz sources ──────────────────────────
  {
    id: 'src_character-snapshot',
    label: 'Character snapshot',
    description:
      'Resolves the active Character\'s archetype + dial-derived fragments + quirk fragments + relationship-stance / initiative / correction fragments + boundary-rule constraints into a single voice preamble.',
    applicableToCompositionKinds: ['who', 'prompt'],
    refKind: 'computed',
    authoredBy: 'system',
    createdAt: '2026-05-02T00:00:00Z',
    updatedAt: '2026-05-02T00:00:00Z',
  },
  {
    id: 'src_user-manifest-snapshot',
    label: 'User manifest snapshot',
    description:
      'Resolves the top-N highest-confidence ManifestDimension entries for the active user into a "things I\'ve inferred about you" preamble. Confidence threshold and N are computeScript params.',
    applicableToCompositionKinds: ['who', 'context'],
    refKind: 'computed',
    authoredBy: 'system',
    createdAt: '2026-05-02T00:00:00Z',
    updatedAt: '2026-05-02T00:00:00Z',
  },
  {
    id: 'src_quiz-prior-context',
    label: 'Quiz prior context',
    description:
      'Resolves to the last K QuizSessions for this user-manifest formatted as Q/A pairs (no inferences). Used by the quiz-author turn to build on prior answers per the spiral-design pattern.',
    applicableToCompositionKinds: ['prompt', 'context'],
    refKind: 'computed',
    authoredBy: 'system',
    createdAt: '2026-05-02T00:00:00Z',
    updatedAt: '2026-05-02T00:00:00Z',
  },
  // ── Custom-kind exemplar (extension-shipped) ─────────────────────
  {
    id: 'src_external_pr_summary',
    label: '(extension) External PR summary',
    description:
      'Example extension-shipped source. Calls a framework method that hits the GitHub API and summarizes the active PR; output is cached per-turn.',
    applicableToCompositionKinds: ['custom', 'context'],
    refKind: 'computed',
    resolverScript: {
      kind: 'framework-method',
      methodNamespace: 'github-extension',
      methodName: 'summarizeActivePR',
    },
    authoredBy: 'extension',
    extensionId: 'ext_github_001',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
];

export const compositionSourceKindSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CompositionSourceKind',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'label',
      'description',
      'applicableToCompositionKinds',
      'authoredBy',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      description: { type: 'string' },
      applicableToCompositionKinds: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['who', 'what-when', 'execution', 'prompt', 'context', 'custom'],
        },
      },
      resolverScript: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: ['qjs-eval', 'framework-method'] },
          body: { type: 'string' },
          methodNamespace: { type: 'string' },
          methodName: { type: 'string' },
        },
      },
      refKind: {
        type: 'string',
        enum: ['row-id', 'inline-text', 'computed', 'composition-id', 'none'],
      },
      authoredBy: { type: 'string', enum: ['system', 'user', 'extension'] },
      extensionId: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const compositionSourceKindReferences: GalleryDataReference[] = [
  {
    kind: 'has-many',
    label: 'Compositions (consume registered kinds)',
    targetSource: 'cart/app/gallery/data/composition.ts',
    sourceField: 'id',
    targetField: 'slots[].sources[].kind',
    summary:
      'Composer dispatches a source by looking its `kind` up here. Open registry — new kinds register one row, become immediately slottable.',
  },
];
