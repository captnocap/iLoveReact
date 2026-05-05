// ModelRoute — declarative model dispatch rule. One row per
// (settings, purpose [, difficulty]). Generalizes
// `settings.defaultModelId` and friends into a per-purpose lookup
// with ordered fallback chains.
//
// ── Why this exists ────────────────────────────────────────────
// One model is rarely the right answer. Disambiguation deserves a
// cheap classifier; planning deserves a thinking-capable big model;
// review can run on a mid-tier; execution scales by difficulty. And
// every purpose deserves a fallback chain — when the primary fails
// (timeout, refusal, capability mismatch, budget block), the runtime
// walks the chain instead of crashing the whole turn.
//
// ── How callers use it ─────────────────────────────────────────
// Caller asks the dispatcher for a model with a purpose (and
// optionally a difficulty + scope context). Dispatcher finds the
// most-specific matching ModelRoute, tries its primary, walks its
// fallbacks on failure. Each attempt is an Event row — the audit
// trail shows exactly which model handled what.
//
// ── Specificity rule ──────────────────────────────────────────
// When multiple routes match, the most-specific wins:
//   1. workspaceId / projectId scope match (most specific)
//   2. difficultyTier match
//   3. purpose match (least specific)
// Default routes (no scope, no difficulty) are the fallback for
// anything more specific that does not exist.

import type { GalleryDataReference, JsonObject } from '../../types';

export type ModelRoutingPurpose =
  | 'default' // catch-all
  | 'disambiguation' // glossary/skill/etc cheap picks
  | 'planning' // goal → plan
  | 'execution' // doing the actual work
  | 'review' // reviewing diffs/output
  | 'classification' // category/triage
  | 'summarization' // compressing context
  | 'fallback'; // global last-resort

export type DifficultyTier = 'trivial' | 'easy' | 'medium' | 'hard' | 'expert';

export type ModelRouteScope = {
  workspaceId?: string;
  projectId?: string;
  minTokenEstimate?: number;
  maxTokenEstimate?: number;
};

export type ModelRoute = {
  id: string;
  settingsId: string;
  purpose: ModelRoutingPurpose;
  primaryModelId: string;
  fallbackChain: string[]; // ordered modelIds, walked on failure
  difficultyTier?: DifficultyTier;
  appliesIf?: ModelRouteScope;
  perInvocationCostCapUsd?: number;
  reasoning?: string; // why this route is shaped this way
  authoredBy: 'user' | 'agent' | 'system';
  createdAt: string;
  updatedAt: string;
};

export const modelRouteMockData: ModelRoute[] = [
  // ── Defaults ────────────────────────────────────────────────────
  {
    id: 'route_default',
    settingsId: 'settings_default',
    purpose: 'default',
    primaryModelId: 'claude-opus-4-7',
    fallbackChain: ['claude-sonnet-4-6', 'kimi-k2'],
    reasoning: 'Opus is the right default for serious work; Sonnet first fallback, Kimi as a vendor-diversity backup.',
    authoredBy: 'user',
    createdAt: '2026-04-25T12:00:00Z',
    updatedAt: '2026-04-25T12:00:00Z',
  },
  {
    id: 'route_fallback_global',
    settingsId: 'settings_default',
    purpose: 'fallback',
    primaryModelId: 'kimi-k2',
    fallbackChain: ['gpt-5.4-mini'],
    reasoning:
      'Bottom of every chain. When everything else has failed, prefer something that is still online — even if quality is lower.',
    authoredBy: 'user',
    createdAt: '2026-04-25T12:00:00Z',
    updatedAt: '2026-04-25T12:00:00Z',
  },

  // ── Cheap classification ─────────────────────────────────────────
  {
    id: 'route_disambiguation',
    settingsId: 'settings_default',
    purpose: 'disambiguation',
    primaryModelId: 'claude-haiku-4-5',
    fallbackChain: ['gpt-5.4-mini', 'kimi-k2'],
    reasoning:
      'Cheap, fast, deterministic. Used for glossary picks, skill-match disambiguation, anywhere multiple candidates need a quick winner.',
    perInvocationCostCapUsd: 0.005,
    authoredBy: 'user',
    createdAt: '2026-04-25T12:00:00Z',
    updatedAt: '2026-04-25T12:00:00Z',
  },
  {
    id: 'route_classification',
    settingsId: 'settings_default',
    purpose: 'classification',
    primaryModelId: 'claude-haiku-4-5',
    fallbackChain: ['gpt-5.4-mini'],
    reasoning: 'Triage / kind-detection / yes-or-no. Same shape as disambiguation but separate purpose so they can drift later.',
    authoredBy: 'user',
    createdAt: '2026-04-25T12:00:00Z',
    updatedAt: '2026-04-25T12:00:00Z',
  },

  // ── Difficulty-tiered execution ─────────────────────────────────
  {
    id: 'route_execution_trivial',
    settingsId: 'settings_default',
    purpose: 'execution',
    primaryModelId: 'claude-haiku-4-5',
    fallbackChain: ['kimi-k2'],
    difficultyTier: 'trivial',
    reasoning:
      'For tasks the difficulty-classifier scores as trivial (one-line edits, single-file moves). Haiku is more than enough.',
    authoredBy: 'user',
    createdAt: '2026-04-25T12:00:00Z',
    updatedAt: '2026-04-25T12:00:00Z',
  },
  {
    id: 'route_execution_medium',
    settingsId: 'settings_default',
    purpose: 'execution',
    primaryModelId: 'claude-sonnet-4-6',
    fallbackChain: ['claude-opus-4-7', 'kimi-k2'],
    difficultyTier: 'medium',
    reasoning: 'Mid-tier work. Sonnet primary; Opus available if Sonnet falters.',
    authoredBy: 'user',
    createdAt: '2026-04-25T12:00:00Z',
    updatedAt: '2026-04-25T12:00:00Z',
  },
  {
    id: 'route_execution_hard',
    settingsId: 'settings_default',
    purpose: 'execution',
    primaryModelId: 'claude-opus-4-7',
    fallbackChain: ['gpt-5'],
    difficultyTier: 'hard',
    reasoning:
      'Hard work needs thinking-capable models. Cross-vendor fallback to GPT-5 in case of Anthropic outage — both have thinking.',
    authoredBy: 'user',
    createdAt: '2026-04-25T12:00:00Z',
    updatedAt: '2026-04-25T12:00:00Z',
  },

  // ── Planning ────────────────────────────────────────────────────
  {
    id: 'route_planning',
    settingsId: 'settings_default',
    purpose: 'planning',
    primaryModelId: 'claude-opus-4-7',
    fallbackChain: ['gpt-5'],
    reasoning:
      'Planning rewards extended thinking. Opus primary, GPT-5 high reasoning fallback.',
    authoredBy: 'user',
    createdAt: '2026-04-25T12:00:00Z',
    updatedAt: '2026-04-25T12:00:00Z',
  },

  // ── Strict workspace override ───────────────────────────────────
  {
    id: 'route_strict_default',
    settingsId: 'settings_work_strict',
    purpose: 'default',
    primaryModelId: 'claude-sonnet-4-6',
    fallbackChain: ['kimi-k2'],
    appliesIf: { workspaceId: 'ws_client_project' },
    reasoning:
      'Client engagements use Sonnet by default for cost; Opus only when explicitly requested. No GPT-5 — confidentiality.',
    authoredBy: 'user',
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
];

export const modelRouteSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ModelRoute',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'settingsId', 'purpose', 'primaryModelId', 'fallbackChain', 'authoredBy', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      purpose: {
        type: 'string',
        enum: [
          'default',
          'disambiguation',
          'planning',
          'execution',
          'review',
          'classification',
          'summarization',
          'fallback',
        ],
      },
      primaryModelId: { type: 'string' },
      fallbackChain: { type: 'array', items: { type: 'string' } },
      difficultyTier: {
        type: 'string',
        enum: ['trivial', 'easy', 'medium', 'hard', 'expert'],
      },
      appliesIf: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workspaceId: { type: 'string' },
          projectId: { type: 'string' },
          minTokenEstimate: { type: 'number' },
          maxTokenEstimate: { type: 'number' },
        },
      },
      perInvocationCostCapUsd: { type: 'number' },
      reasoning: { type: 'string' },
      authoredBy: { type: 'string', enum: ['user', 'agent', 'system'] },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const modelRouteReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary:
      'Routes are profile-scoped. Generalizes settings.defaultModelId — a route with purpose=default IS the default model for the profile.',
  },
  {
    kind: 'references',
    label: 'Primary model',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'primaryModelId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Fallback models',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'fallbackChain[]',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Workspace / project scope',
    targetSource: 'cart/app/gallery/data/workspace.ts',
    sourceField: 'appliesIf.workspaceId',
    targetField: 'id',
  },
  {
    kind: 'has-many',
    label: 'Inference requests (the route used)',
    targetSource: 'cart/app/gallery/data/inference-request.ts',
    sourceField: 'id',
    targetField: 'modelRouteId (to wire)',
    summary:
      'InferenceRequest could carry a modelRouteId to record which route resolved its model. Audit trail for "why did this turn use Sonnet instead of Opus" → because route X dispatched it.',
  },
];
