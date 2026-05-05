// ProjectGlossary — curated vocabulary that maps project-canonical
// terms to their authoritative implementations and auto-attach
// behavior. The lookup table the interpreter consults to expand a
// 3-word prompt into a properly-loaded prompt.
//
// ── Why this is not just semantic-memory ───────────────────────
// `semantic-memory.kind:'domain_term'` *describes* what a term means.
// Glossary entries *bind* terms to canonical files / functions /
// shapes, with auto-attach behavior. Different concern: one is
// knowledge, the other is action.
//
// ── Disambiguation ─────────────────────────────────────────────
// Many real terms are ambiguous — "tooltip" might refer to the
// framework primitive OR an app-code variant. Multiple entries can
// share the same `term`. When a prompt matches more than one,
// runtime invokes a cheap disambiguation model (see model-route.ts
// purpose='disambiguation') that picks the most relevant entry given
// the surrounding prompt context. The pick is recorded as an
// Interpretation.outputs[] entry with reasoning for audit.
//
// ── Seeding ────────────────────────────────────────────────────
// Entries can be authoredBy='user' (manual curation), 'agent'
// (auto-discovered from a code-scan job), or 'system' (built-in
// framework terms shipped with the runtime). A one-shot Job
// (`action.kind: 'embed-batch'` + classifier pass) over the
// codebase proposes draft entries; the user keeps what's right.

import type { GalleryDataReference, JsonObject } from '../../types';

export type GlossaryReferenceKind =
  | 'file'
  | 'function'
  | 'shape'
  | 'pattern'
  | 'doc'
  | 'usage-example';

export type GlossaryCanonicalReference = {
  kind: GlossaryReferenceKind;
  ref: string; // path / symbol / shape-id / doc-id
  relevance: number; // 0–1
  caption?: string;
};

export type GlossaryAutoAttachItem = {
  kind: 'file-content' | 'function-signature' | 'usage-example' | 'doc-link';
  ref: string;
  maxTokens?: number;
};

export type GlossaryAutoAttach = {
  enabled: boolean;
  contextItems: GlossaryAutoAttachItem[];
  /** Confidence threshold for auto-attach without disambiguation. */
  triggerThreshold: number;
};

export type GlossaryScope = 'framework' | 'app' | 'cart' | 'project-wide';

export type GlossaryDisambiguationHints = {
  /** Surrounding terms that boost relevance when present. */
  boostingContext: string[];
  /** Surrounding terms that disqualify this entry. */
  excludingContext: string[];
  /** Path prefixes that boost when the user is active in them. */
  pathBoosts: string[];
};

export type GlossaryEntry = {
  id: string;
  projectId: string;
  term: string;
  aliases: string[];
  definition: string;
  scope: GlossaryScope;
  scopeRefs: string[]; // path prefixes this entry's references live under
  canonicalReferences: GlossaryCanonicalReference[];
  autoAttach: GlossaryAutoAttach;
  disambiguationHints?: GlossaryDisambiguationHints;
  authoredBy: 'user' | 'agent' | 'system';
  createdAt: string;
  updatedAt: string;
};

export const projectGlossaryMockData: GlossaryEntry[] = [
  // The "tooltip" ambiguity case — two entries share the same term.
  {
    id: 'gloss_tooltip_framework',
    projectId: 'proj_reactjit_runtime',
    term: 'tooltip',
    aliases: ['tooltips', 'hover-info'],
    definition:
      'The framework primitive — a low-level component for hover/click annotations rendered by the Zig host.',
    scope: 'framework',
    scopeRefs: ['runtime/'],
    canonicalReferences: [
      { kind: 'file', ref: 'runtime/tooltip.tsx', relevance: 1.0 },
      { kind: 'function', ref: 'useTooltip', relevance: 0.9 },
      { kind: 'shape', ref: 'TooltipProps', relevance: 0.85 },
    ],
    autoAttach: {
      enabled: true,
      contextItems: [
        { kind: 'file-content', ref: 'runtime/tooltip.tsx', maxTokens: 800 },
        { kind: 'function-signature', ref: 'useTooltip', maxTokens: 100 },
      ],
      triggerThreshold: 0.85,
    },
    disambiguationHints: {
      boostingContext: ['primitive', 'framework', 'low-level', 'runtime', 'host'],
      excludingContext: ['cart', 'cockpit', 'app', 'screen'],
      pathBoosts: ['runtime/', 'framework/'],
    },
    authoredBy: 'user',
    createdAt: '2026-04-25T12:00:00Z',
    updatedAt: '2026-04-25T12:00:00Z',
  },
  {
    id: 'gloss_tooltip_cockpit',
    projectId: 'proj_reactjit_carts',
    term: 'tooltip',
    aliases: ['tooltips'],
    definition:
      'The cockpit cart\'s app-level tooltip extension — wraps the framework primitive with chat-card-specific behavior.',
    scope: 'cart',
    scopeRefs: ['cart/cockpit/'],
    canonicalReferences: [
      { kind: 'file', ref: 'cart/cockpit/Tooltip.tsx', relevance: 1.0 },
      { kind: 'usage-example', ref: 'cart/cockpit/ChatCard.tsx#L142', relevance: 0.7 },
    ],
    autoAttach: {
      enabled: true,
      contextItems: [
        { kind: 'file-content', ref: 'cart/cockpit/Tooltip.tsx', maxTokens: 800 },
      ],
      triggerThreshold: 0.85,
    },
    disambiguationHints: {
      boostingContext: ['cockpit', 'chat', 'cart', 'app', 'card'],
      excludingContext: ['primitive', 'framework', 'host'],
      pathBoosts: ['cart/cockpit/'],
    },
    authoredBy: 'user',
    createdAt: '2026-04-25T12:00:00Z',
    updatedAt: '2026-04-25T12:00:00Z',
  },

  // An unambiguous framework term — single entry, no disambiguation needed.
  {
    id: 'gloss_cart',
    projectId: 'proj_reactjit_carts',
    term: 'cart',
    aliases: ['carts', '.tsx app'],
    definition:
      'A self-contained .tsx application that ships via ./scripts/ship as a self-extracting binary. Lives under cart/<name>/.',
    scope: 'project-wide',
    scopeRefs: ['cart/'],
    canonicalReferences: [
      { kind: 'doc', ref: 'CLAUDE.md#cart-runtime', relevance: 0.9 },
      { kind: 'pattern', ref: 'scripts/ship', relevance: 0.95 },
    ],
    autoAttach: {
      enabled: true,
      contextItems: [{ kind: 'doc-link', ref: 'CLAUDE.md#cart-runtime' }],
      triggerThreshold: 0.7,
    },
    authoredBy: 'system',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
  },

  // An auto-discovered candidate — agent-authored, lower confidence.
  {
    id: 'gloss_useHotState_candidate',
    projectId: 'proj_reactjit_runtime',
    term: 'useHotState',
    aliases: ['hot state', 'persistent hook'],
    definition:
      '(auto-discovered) A hook that should preserve state across hot reloads. Currently does NOT — see ep_hotstate_regression.',
    scope: 'framework',
    scopeRefs: ['runtime/hooks/'],
    canonicalReferences: [
      { kind: 'file', ref: 'runtime/hooks/useHotState.ts', relevance: 1.0 },
      { kind: 'file', ref: 'framework/hotstate.zig', relevance: 0.8 },
    ],
    autoAttach: {
      enabled: false, // disabled until user reviews
      contextItems: [
        { kind: 'file-content', ref: 'runtime/hooks/useHotState.ts', maxTokens: 600 },
      ],
      triggerThreshold: 0.85,
    },
    authoredBy: 'agent',
    createdAt: '2026-04-25T08:00:00Z',
    updatedAt: '2026-04-25T08:00:00Z',
  },

  // A pattern term that points at a procedural-memory playbook.
  {
    id: 'gloss_data_shape',
    projectId: 'proj_reactjit_carts',
    term: 'data shape',
    aliases: ['shape', 'data shapes', 'shape file'],
    definition:
      'A data shape is a TS type + JSON schema + mock rows + GalleryDataReference[] in cart/app/gallery/data/. Add via the gallery-component script.',
    scope: 'cart',
    scopeRefs: ['cart/app/gallery/data/'],
    canonicalReferences: [
      { kind: 'pattern', ref: 'scripts/gallery-component', relevance: 1.0 },
      { kind: 'file', ref: 'cart/app/gallery/types.ts', relevance: 0.85 },
      { kind: 'usage-example', ref: 'cart/app/gallery/data/goal.ts', relevance: 0.7 },
    ],
    autoAttach: {
      enabled: true,
      contextItems: [
        { kind: 'file-content', ref: 'cart/app/gallery/types.ts', maxTokens: 1200 },
        { kind: 'doc-link', ref: 'cart/app/gallery/README.md' },
      ],
      triggerThreshold: 0.8,
    },
    authoredBy: 'user',
    createdAt: '2026-04-25T12:00:00Z',
    updatedAt: '2026-04-25T12:00:00Z',
  },
];

export const projectGlossarySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ProjectGlossary',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'projectId',
      'term',
      'aliases',
      'definition',
      'scope',
      'scopeRefs',
      'canonicalReferences',
      'autoAttach',
      'authoredBy',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      projectId: { type: 'string' },
      term: { type: 'string' },
      aliases: { type: 'array', items: { type: 'string' } },
      definition: { type: 'string' },
      scope: { type: 'string', enum: ['framework', 'app', 'cart', 'project-wide'] },
      scopeRefs: { type: 'array', items: { type: 'string' } },
      canonicalReferences: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'ref', 'relevance'],
          properties: {
            kind: {
              type: 'string',
              enum: ['file', 'function', 'shape', 'pattern', 'doc', 'usage-example'],
            },
            ref: { type: 'string' },
            relevance: { type: 'number' },
            caption: { type: 'string' },
          },
        },
      },
      autoAttach: {
        type: 'object',
        additionalProperties: false,
        required: ['enabled', 'contextItems', 'triggerThreshold'],
        properties: {
          enabled: { type: 'boolean' },
          triggerThreshold: { type: 'number' },
          contextItems: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'ref'],
              properties: {
                kind: {
                  type: 'string',
                  enum: ['file-content', 'function-signature', 'usage-example', 'doc-link'],
                },
                ref: { type: 'string' },
                maxTokens: { type: 'number' },
              },
            },
          },
        },
      },
      disambiguationHints: {
        type: 'object',
        additionalProperties: false,
        required: ['boostingContext', 'excludingContext', 'pathBoosts'],
        properties: {
          boostingContext: { type: 'array', items: { type: 'string' } },
          excludingContext: { type: 'array', items: { type: 'string' } },
          pathBoosts: { type: 'array', items: { type: 'string' } },
        },
      },
      authoredBy: { type: 'string', enum: ['user', 'agent', 'system'] },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const projectGlossaryReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Project',
    targetSource: 'cart/app/gallery/data/project.ts',
    sourceField: 'projectId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Interpretations (consume entries)',
    targetSource: 'cart/app/gallery/data/interpretation.ts',
    sourceField: 'id',
    targetField: 'outputs[].value (when targetEntityKind=reference-artifact, source=glossary-pick)',
    summary:
      'When the interpreter resolves a glossary match, it records the pick as an Interpretation output for audit.',
  },
  {
    kind: 'references',
    label: 'Disambiguation model',
    targetSource: 'cart/app/gallery/data/model-route.ts',
    sourceField: '(none — routed via purpose=disambiguation)',
    targetField: 'purpose',
    summary:
      'When multiple entries match a term, the runtime invokes the model bound to purpose=disambiguation to pick one.',
  },
  {
    kind: 'references',
    label: 'Auto-attach feeds Goal.referenceArtifacts',
    targetSource: 'cart/app/gallery/data/goal.ts',
    sourceField: 'autoAttach.contextItems',
    targetField: 'referenceArtifacts[]',
    summary:
      'Resolved auto-attach items become Goal.referenceArtifacts entries with the same downstream pipeline as user-attached screenshots.',
  },
];
