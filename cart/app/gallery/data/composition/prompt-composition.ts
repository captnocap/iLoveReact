// Composition — the universal composer. Same row shape, six faces:
//
//   who        — assembles user identity context (bio + accommodations
//                + role + memory snapshots + active settings)
//   what-when  — assembles the work plan (goal + plan + phase +
//                tasks + budgets + scheduled jobs + active constraints)
//   execution  — assembles the execution context (connection + model +
//                prompt-composition + tools + privacy snapshot + worker
//                + glossary + retrieval results)
//   prompt     — assembles the actual prompt body (system / user /
//                context / rubric / constraints / examples / closing)
//   context    — generic context bundle, slottable into others
//   custom     — extension-defined kind
//
// ── Why one shape ──────────────────────────────────────────────
// Slots × sources × composer-rule × inheritance × scripts is a
// universal pattern. The lifecycle of a turn is composition all the
// way down: the master composition slots a `who` + `what-when` +
// `execution`; the `execution` slots a `prompt`; the `prompt` slots
// fragments / glossary attachments / retrievals. Fractal assembly
// from one row type.
//
// ── Open extensibility ────────────────────────────────────────
// `slot.sources[].kind` is an open string looked up in
// composition-source-kind.ts. New shape kinds register one row in
// that catalog and become immediately slottable. The composer
// internals never change.
//
// ── Inheritance ──────────────────────────────────────────────
// `inheritsFromCompositionId` lets a composition extend another and
// override individual slots. A worker-action composition can extend
// the role's composition and only override the system slot.
//
// ── Scripts ──────────────────────────────────────────────────
// Three layering points:
//   - per-source: source.transformScriptId runs on the resolved value
//   - per-slot: slot.composer with optional customComposerScriptId
//   - whole-assembly: postAssemblyScript runs on the assembled output
//                     (purposes: redact / compress / inject-watermark
//                     / budget-trim / custom)
//
// ── Node-graph readiness ────────────────────────────────────
// The shape is intentionally renderable as a node-graph (Node-RED
// style). Each Composition is a NODE with:
//   - INPUT PORTS:  `variables[]` — typed inputs the caller supplies
//                   or that resolve from framework/qjs/template-vars
//   - OUTPUT PORTS: `outputs[]` — typed outputs the composition emits
//                   (default: a single 'result' output of format text)
//   - INTERNAL FLOW: `slots[]` ordered by `slot.order`, each slot's
//                   `sources[]` ordered by `source.order`
//   - WIRES: a source with kind=src_composition and ref=<id> is a
//            wire to another node; an `outputPort` on the source
//            picks which port of the upstream node to read
//   - BRANCHES: `includeIf` on sources are conditional gates;
//               `inheritsFromCompositionId` is composition extension
// Entry = supplying the variables. Exit = reading the outputs. Every
// path through is deterministic: variables in → ordered slots resolve
// in order → sources in each slot resolve in order → composer rule
// merges → postAssemblyScript runs → outputs emit. Multi-file chains
// are just src_composition wires.

import type { GalleryDataReference, JsonObject } from '../../types';
import type { CompositionKind } from './composition-source-kind';

export type CompositionScope =
  | 'default'
  | 'role'
  | 'skill'
  | 'goal-handling'
  | 'worker-action'
  | 'one-off'
  | 'system-phase';

export type CompositionComposerRule =
  | 'concat'
  | 'wrap'
  | 'best-of'
  | 'first-match'
  | 'merge-deduped'
  | 'custom';

export type CompositionScript = {
  kind: 'qjs-eval' | 'framework-method';
  body?: string;
  methodNamespace?: string;
  methodName?: string;
  /** When in the assembly to run. */
  trigger?: 'pre-assembly' | 'post-assembly' | 'before-send';
  /** Optional purpose tag for UI grouping / safe-mode filtering. */
  purpose?: 'redact' | 'compress' | 'inject-watermark' | 'budget-trim' | 'transform' | 'custom';
};

export type CompositionSource = {
  id: string;
  /** Stable within-slot ordering. Required so the assembly path is deterministic and the node-graph UI can lay out wires consistently. */
  order: number;
  /** Open string — looked up in composition-source-kind.ts. */
  kind: string;
  ref?: string; // when source kind has refKind='row-id' or 'composition-id'
  /**
   * When `kind=src_composition` and the upstream composition declares
   * multiple outputs, this picks which output port to read. Defaults
   * to 'result' (the single-output case).
   */
  outputPort?: string;
  inlineValue?: string; // when refKind='inline-text'
  computeScript?: CompositionScript; // when refKind='computed'
  includeIf?: {
    workspaceId?: string;
    projectId?: string;
    minTokenEstimate?: number;
    requiresCapability?: string;
  };
  transformScriptId?: string; // optional pre-emit transform on resolved value
  weight?: number; // composer hint for 'best-of' / 'merge-deduped'
};

export type CompositionOutputFormat =
  | 'text'
  | 'structured'
  | 'binary'
  | 'composition-result';

export type CompositionOutput = {
  /** Port name. Default compositions emit a single 'result' port. */
  name: string;
  description?: string;
  /**
   * Which slot(s) feed this output. 'all' means the full assembled
   * output (every slot concatenated by the composer). Specific slot
   * names let a composition expose multiple ports — e.g. one output
   * for the assembled prompt body, another for derived metadata.
   */
  fromSlots: string[] | 'all';
  format: CompositionOutputFormat;
};

export type CompositionSlot = {
  name: string; // free string — the composition `kind` determines valid names
  order: number;
  sources: CompositionSource[];
  composer: CompositionComposerRule;
  customComposerScriptId?: string;
  /** Optional ceiling on combined token count for this slot. */
  maxTokens?: number;
  /** What to do when nothing matches. */
  emptyBehavior: 'omit' | 'placeholder' | 'fail';
};

export type CompositionVariableSource =
  | 'caller-supplies'
  | 'framework-method'
  | 'qjs-eval'
  | 'template-variable';

export type CompositionVariable = {
  name: string;
  source: CompositionVariableSource;
  required: boolean;
  description?: string;
  defaultValue?: string;
};

export type PromptComposition = {
  id: string;
  settingsId: string;
  kind: CompositionKind;
  customKindLabel?: string; // when kind='custom'
  scope: CompositionScope;
  scopeTargetId?: string;
  label: string;
  description?: string;
  slots: CompositionSlot[];
  /** Input ports for the node-graph view — caller-supplied or auto-resolved values. */
  variables: CompositionVariable[];
  /**
   * Output ports. A composition emits at least one output (the
   * assembled body). Multiple outputs let a composition expose
   * derived/structured signals alongside the main assembly.
   */
  outputs: CompositionOutput[];
  inheritsFromCompositionId?: string;
  preAssemblyScript?: CompositionScript;
  postAssemblyScript?: CompositionScript;
  authoredBy: 'user' | 'agent' | 'system';
  createdAt: string;
  updatedAt: string;
};

export const promptCompositionMockData: PromptComposition[] = [
  // ── Master composition (the orchestra) ──────────────────────────
  {
    id: 'comp_master_default',
    settingsId: 'settings_default',
    kind: 'custom',
    customKindLabel: 'master-turn',
    scope: 'default',
    label: 'Default master — orchestrates a turn',
    description:
      'The top-level composition for a normal worker turn. Slots a `who` + `what-when` + `execution` composition.',
    slots: [
      {
        name: 'who',
        order: 1,
        sources: [
          {
            id: 'src_master_who',
            order: 1,
            kind: 'src_composition',
            ref: 'comp_who_default',
          },
        ],
        composer: 'concat',
        emptyBehavior: 'fail',
      },
      {
        name: 'what-when',
        order: 2,
        sources: [
          {
            id: 'src_master_what',
            order: 1,
            kind: 'src_composition',
            ref: 'comp_what_when_default',
          },
        ],
        composer: 'concat',
        emptyBehavior: 'fail',
      },
      {
        name: 'execution',
        order: 3,
        sources: [
          {
            id: 'src_master_exec',
            order: 1,
            kind: 'src_composition',
            ref: 'comp_execution_default',
          },
        ],
        composer: 'concat',
        emptyBehavior: 'fail',
      },
    ],
    variables: [],
    outputs: [
      {
        name: 'turn',
        description: 'Fully-assembled turn — concatenated who + what-when + execution.',
        fromSlots: 'all',
        format: 'text',
      },
    ],
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },

  // ── 'who' composition ───────────────────────────────────────────
  {
    id: 'comp_who_default',
    settingsId: 'settings_default',
    kind: 'who',
    scope: 'default',
    label: 'Default — who is acting',
    description: 'Bio + accommodations + role base + memory snapshot.',
    slots: [
      {
        name: 'identity',
        order: 1,
        sources: [
          {
            id: 'src_who_bio',
            order: 1,
            kind: 'src_user-bio',
          },
        ],
        composer: 'concat',
        emptyBehavior: 'omit',
      },
      {
        name: 'role',
        order: 2,
        sources: [
          {
            id: 'src_who_role',
            order: 1,
            kind: 'src_role-base',
            includeIf: {},
          },
        ],
        composer: 'concat',
        emptyBehavior: 'omit',
      },
      {
        name: 'memory',
        order: 3,
        sources: [
          {
            id: 'src_who_semantic',
            order: 1,
            kind: 'src_memory-tier-snapshot',
            computeScript: {
              kind: 'framework-method',
              methodNamespace: 'memory',
              methodName: 'topRelevant',
              body: 'tier=semantic, k=5',
            },
            weight: 0.7,
          },
          {
            id: 'src_who_episodic',
            order: 2,
            kind: 'src_memory-tier-snapshot',
            computeScript: {
              kind: 'framework-method',
              methodNamespace: 'memory',
              methodName: 'topRelevant',
              body: 'tier=episodic, k=3',
            },
            weight: 0.5,
          },
        ],
        composer: 'merge-deduped',
        maxTokens: 2000,
        emptyBehavior: 'omit',
      },
    ],
    variables: [],
    outputs: [
      {
        name: 'result',
        description: 'Identity preamble + role base + memory snapshot.',
        fromSlots: 'all',
        format: 'text',
      },
    ],
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },

  // ── 'what-when' composition ─────────────────────────────────────
  {
    id: 'comp_what_when_default',
    settingsId: 'settings_default',
    kind: 'what-when',
    scope: 'default',
    label: 'Default — what we are doing',
    description: 'Active goal + plan-phase + outcome rubric + active constraints.',
    slots: [
      {
        name: 'goal',
        order: 1,
        sources: [{ id: 'src_what_goal', order: 1, kind: 'src_active-goal' }],
        composer: 'concat',
        emptyBehavior: 'fail',
      },
      {
        name: 'plan',
        order: 2,
        sources: [{ id: 'src_what_phase', order: 1, kind: 'src_active-plan-phase' }],
        composer: 'concat',
        emptyBehavior: 'omit',
      },
      {
        name: 'rubric',
        order: 3,
        sources: [{ id: 'src_what_rubric', order: 1, kind: 'src_outcome-rubric' }],
        composer: 'concat',
        emptyBehavior: 'omit',
      },
      {
        name: 'constraints',
        order: 4,
        sources: [{ id: 'src_what_constraints', order: 1, kind: 'src_active-constraints' }],
        composer: 'concat',
        emptyBehavior: 'omit',
      },
    ],
    variables: [],
    outputs: [
      {
        name: 'result',
        description: 'Goal + plan-phase + rubric + constraints, in that order.',
        fromSlots: 'all',
        format: 'text',
      },
      {
        name: 'rubric-hint',
        description: 'Just the rubric slot — useful for self-check passes that only need the success criteria.',
        fromSlots: ['rubric'],
        format: 'text',
      },
    ],
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },

  // ── 'execution' composition ─────────────────────────────────────
  {
    id: 'comp_execution_default',
    settingsId: 'settings_default',
    kind: 'execution',
    scope: 'default',
    label: 'Default — execution context',
    description:
      'Connection / privacy snapshot / glossary / retrieval / template variables / nested prompt composition.',
    slots: [
      {
        name: 'connection',
        order: 1,
        sources: [{ id: 'src_exec_connection', order: 1, kind: 'src_connection-info' }],
        composer: 'concat',
        emptyBehavior: 'fail',
      },
      {
        name: 'privacy',
        order: 2,
        sources: [{ id: 'src_exec_privacy', order: 1, kind: 'src_privacy-snapshot' }],
        composer: 'concat',
        emptyBehavior: 'fail',
      },
      {
        name: 'glossary',
        order: 3,
        sources: [{ id: 'src_exec_glossary', order: 1, kind: 'src_glossary-attach' }],
        composer: 'concat',
        emptyBehavior: 'omit',
      },
      {
        name: 'retrieval',
        order: 4,
        sources: [
          {
            id: 'src_exec_retrieval',
            order: 1,
            kind: 'src_retrieval-result',
            ref: 'retr_default', // a RetrievalStrategy id
          },
        ],
        composer: 'concat',
        maxTokens: 4000,
        emptyBehavior: 'omit',
      },
      {
        name: 'prompt',
        order: 5,
        sources: [
          {
            id: 'src_exec_prompt',
            order: 1,
            kind: 'src_composition',
            ref: 'comp_prompt_default',
            outputPort: 'result',
          },
        ],
        composer: 'concat',
        emptyBehavior: 'fail',
      },
    ],
    variables: [
      {
        name: 'cwd',
        source: 'template-variable',
        required: false,
        defaultValue: '/',
      },
    ],
    outputs: [
      {
        name: 'request-context',
        description: 'Full execution-context bundle ready to attach to an InferenceRequest.',
        fromSlots: 'all',
        format: 'text',
      },
      {
        name: 'privacy-snapshot',
        description: 'Just the privacy slot — frozen as InferenceRequest.privacySnapshot.',
        fromSlots: ['privacy'],
        format: 'structured',
      },
    ],
    postAssemblyScript: {
      kind: 'framework-method',
      methodNamespace: 'safety',
      methodName: 'redactSecrets',
      trigger: 'before-send',
      purpose: 'redact',
    },
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },

  // ── 'prompt' composition (consumed by execution) ────────────────
  {
    id: 'comp_prompt_default',
    settingsId: 'settings_default',
    kind: 'prompt',
    scope: 'default',
    label: 'Default — assembled prompt body',
    description:
      'System / user-instruction / context / rubric / examples / closing slots. Fragments + legacy system-message + inline text mix freely.',
    slots: [
      {
        name: 'system',
        order: 1,
        sources: [
          { id: 'src_prompt_terse', order: 1, kind: 'src_prompt-fragment', ref: 'frag_terse_default' },
          { id: 'src_prompt_no_emoji', order: 2, kind: 'src_prompt-fragment', ref: 'frag_no_emoji' },
        ],
        composer: 'concat',
        emptyBehavior: 'omit',
      },
      {
        name: 'user-instruction',
        order: 2,
        sources: [{ id: 'src_prompt_user_turn', order: 1, kind: 'src_inline-text', inlineValue: '{{user_turn}}' }],
        composer: 'concat',
        emptyBehavior: 'fail',
      },
      {
        name: 'closing',
        order: 3,
        sources: [
          { id: 'src_prompt_close', order: 1, kind: 'src_prompt-fragment', ref: 'frag_default_closing' },
        ],
        composer: 'concat',
        emptyBehavior: 'omit',
      },
    ],
    variables: [
      { name: 'user_turn', source: 'caller-supplies', required: true },
    ],
    outputs: [
      {
        name: 'result',
        description: 'Assembled prompt body (system + user-instruction + closing).',
        fromSlots: 'all',
        format: 'text',
      },
    ],
    authoredBy: 'system',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },

  // ── A worker-action override composition (Dismantle button) ─────
  {
    id: 'comp_dismantle_action',
    settingsId: 'settings_default',
    kind: 'prompt',
    scope: 'worker-action',
    scopeTargetId: 'action_dismantle',
    inheritsFromCompositionId: 'comp_prompt_default',
    label: 'Dismantle — adversarial critique override',
    description:
      'Extends the default prompt composition. Overrides the system slot with an adversarial critic persona; adds an "examples" slot showing what load-bearing objections look like.',
    slots: [
      {
        name: 'system',
        order: 1,
        sources: [
          {
            id: 'src_dismantle_system',
            order: 1,
            kind: 'src_prompt-fragment',
            ref: 'frag_dismantle_critic',
          },
        ],
        composer: 'concat',
        emptyBehavior: 'fail',
      },
      {
        name: 'examples',
        order: 2,
        sources: [
          {
            id: 'src_dismantle_examples',
            order: 1,
            kind: 'src_inline-text',
            inlineValue:
              'Load-bearing: "this fails when N > 1000 because the index is not unique"\nNitpick: "this variable could be renamed for clarity"',
          },
        ],
        composer: 'concat',
        emptyBehavior: 'omit',
      },
    ],
    variables: [
      { name: 'prior_response', source: 'caller-supplies', required: true },
    ],
    outputs: [
      {
        name: 'result',
        description: 'Adversarial-critique prompt with the user-supplied prior_response interpolated.',
        fromSlots: 'all',
        format: 'text',
      },
      {
        name: 'objections',
        description: 'Structured objection set extracted from the response (post-assembly script-derived).',
        fromSlots: ['system'],
        format: 'structured',
      },
    ],
    authoredBy: 'user',
    createdAt: '2026-04-26T00:00:00Z',
    updatedAt: '2026-04-26T00:00:00Z',
  },
];

export const promptCompositionSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'PromptComposition',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'settingsId',
      'kind',
      'scope',
      'label',
      'slots',
      'variables',
      'outputs',
      'authoredBy',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      kind: {
        type: 'string',
        enum: ['who', 'what-when', 'execution', 'prompt', 'context', 'custom'],
      },
      customKindLabel: { type: 'string' },
      scope: {
        type: 'string',
        enum: ['default', 'role', 'skill', 'goal-handling', 'worker-action', 'one-off', 'system-phase'],
      },
      scopeTargetId: { type: 'string' },
      label: { type: 'string' },
      description: { type: 'string' },
      inheritsFromCompositionId: { type: 'string' },
      preAssemblyScript: { type: 'object', additionalProperties: true },
      postAssemblyScript: { type: 'object', additionalProperties: true },
      authoredBy: { type: 'string', enum: ['user', 'agent', 'system'] },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      slots: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'order', 'sources', 'composer', 'emptyBehavior'],
          properties: {
            name: { type: 'string' },
            order: { type: 'number' },
            composer: {
              type: 'string',
              enum: ['concat', 'wrap', 'best-of', 'first-match', 'merge-deduped', 'custom'],
            },
            customComposerScriptId: { type: 'string' },
            maxTokens: { type: 'number' },
            emptyBehavior: { type: 'string', enum: ['omit', 'placeholder', 'fail'] },
            sources: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'order', 'kind'],
                properties: {
                  id: { type: 'string' },
                  order: { type: 'number' },
                  kind: { type: 'string' },
                  ref: { type: 'string' },
                  outputPort: { type: 'string' },
                  inlineValue: { type: 'string' },
                  computeScript: { type: 'object', additionalProperties: true },
                  includeIf: { type: 'object', additionalProperties: true },
                  transformScriptId: { type: 'string' },
                  weight: { type: 'number' },
                },
              },
            },
          },
        },
      },
      variables: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'source', 'required'],
          properties: {
            name: { type: 'string' },
            source: {
              type: 'string',
              enum: ['caller-supplies', 'framework-method', 'qjs-eval', 'template-variable'],
            },
            required: { type: 'boolean' },
            description: { type: 'string' },
            defaultValue: { type: 'string' },
          },
        },
      },
      outputs: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'fromSlots', 'format'],
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            fromSlots: {
              oneOf: [
                { type: 'string', enum: ['all'] },
                { type: 'array', items: { type: 'string' } },
              ],
            },
            format: {
              type: 'string',
              enum: ['text', 'structured', 'binary', 'composition-result'],
            },
          },
        },
      },
    },
  },
};

export const promptCompositionReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary:
      'Compositions are profile-scoped. Settings.masterCompositionId picks the orchestrator for a settings profile.',
  },
  {
    kind: 'references',
    label: 'Source kind registry',
    targetSource: 'cart/app/gallery/data/composition-source-kind.ts',
    sourceField: 'slots[].sources[].kind',
    targetField: 'id',
    summary:
      'Open lookup. Composer dispatches by kind via this registry — extension shapes register one row and become slottable.',
  },
  {
    kind: 'references',
    label: 'Inheritance parent',
    targetSource: 'cart/app/gallery/data/composition/prompt-composition.ts',
    sourceField: 'inheritsFromCompositionId',
    targetField: 'id',
    summary:
      'Composition extension chain. A child overrides individual slots; non-overridden slots inherit.',
  },
  {
    kind: 'references',
    label: 'Recursive — composition slot',
    targetSource: 'cart/app/gallery/data/composition/prompt-composition.ts',
    sourceField: 'slots[].sources[].ref (when kind=src_composition)',
    targetField: 'id',
    summary:
      'Compositions slot other compositions. Master → who + what-when + execution → prompt → fragments + glossary + retrieval. Fractal assembly.',
  },
  {
    kind: 'has-many',
    label: 'Roles / skills / worker-actions / presets (opt-in)',
    targetSource: 'cart/app/gallery/data/(role | skill | worker-action | inference-preset).ts',
    sourceField: 'id',
    targetField: 'compositionId',
    summary:
      'Each consuming shape opts in by setting compositionId. When unset, the resolver falls back to its existing systemMessageId / promptTemplateId fields. Net-additive.',
  },
];
