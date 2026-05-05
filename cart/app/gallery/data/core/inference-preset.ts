// InferencePreset — a named, reusable bundle of per-request knobs
// owned by a user. The user picks a preset when spawning a worker
// (or overrides it ad-hoc); the preset resolves down into concrete
// request parameters against the active connection + model.
//
// A preset may also carry a system-message body and / or point at a
// prompt template. Those two fields are the forward hooks into
// system-message.ts and prompt-template.ts — not yet written, but
// the preset owns the linkage because it is the entity the user
// "picks" from the worker UI.
//
// Scoping:
//   - `scopedKinds` restricts the preset to a subset of ConnectionKinds
//     (useful for presets that depend on provider-specific params like
//     reasoning_effort or thinking).
//   - `scopedModelIds` further narrows to specific models.
//   - Both optional — an unscoped preset is portable.

import type { GalleryDataReference, JsonObject } from '../../types';
import { CONNECTION_KINDS, type ConnectionKind } from './connection';

export type InferencePresetValue = {
  parameter: string; // FK → inference-parameter.name
  value: string | number | boolean | string[] | Record<string, unknown>;
};

export type InferencePreset = {
  id: string;
  settingsId: string;
  name: string;
  description?: string;
  values: InferencePresetValue[];

  // Linkage into the prompting layer. Both optional — a preset can be
  // pure-parameters. When both are present, systemMessage takes
  // precedence over systemMessageId on resolve (inline wins).
  systemMessage?: string;
  systemMessageId?: string; // FK → system-message.ts
  promptTemplateId?: string; // FK → prompt-template.ts
  /**
   * Opt-in: when set, the assembler builds the preset's system-side
   * via this Composition instead of walking the systemMessage* /
   * promptTemplateId fields. Net-additive.
   */
  compositionId?: string;

  // Scoping — both optional; unset means the preset is portable.
  scopedKinds?: ConnectionKind[];
  scopedModelIds?: string[];

  createdAt: string;
  updatedAt: string;
};

// ── Mock — a handful of presets owned by user_local ────────────────────

export const inferencePresetMockData: InferencePreset[] = [
  {
    id: 'preset_precise',
    settingsId: 'settings_default',
    name: 'Precise',
    description: 'Low-variance sampling for refactors, migrations, and typed-code edits.',
    values: [
      { parameter: 'temperature', value: 0.2 },
      { parameter: 'top_p', value: 0.95 },
      { parameter: 'max_tokens', value: 8192 },
    ],
    systemMessage:
      'You are a precise engineer. Prefer minimal diffs. Do not speculate; when you do not know, say so.',
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'preset_creative',
    settingsId: 'settings_default',
    name: 'Creative',
    description: 'Higher variance for ideation, naming, UI copy, and exploratory drafts.',
    values: [
      { parameter: 'temperature', value: 1.1 },
      { parameter: 'top_p', value: 0.98 },
      { parameter: 'max_tokens', value: 16_000 },
    ],
    createdAt: '2026-04-10T00:00:00Z',
    updatedAt: '2026-04-10T00:00:00Z',
  },
  {
    id: 'preset_claude_thinking',
    settingsId: 'settings_default',
    name: 'Claude — Extended Thinking',
    description:
      'Opus-tier reasoning with a generous thinking budget. Requires an Anthropic API-key connection; the CLI path cannot honor this.',
    values: [
      { parameter: 'temperature', value: 0.7 },
      { parameter: 'thinking.type', value: 'enabled' },
      { parameter: 'thinking.budget_tokens', value: 32_000 },
      { parameter: 'max_tokens', value: 32_000 },
    ],
    systemMessage: 'Think step by step. Surface load-bearing assumptions before concluding.',
    scopedKinds: ['anthropic-api-key'],
    scopedModelIds: ['claude-opus-4-7', 'claude-sonnet-4-6'],
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
  },
  {
    id: 'preset_codex_reasoning_high',
    settingsId: 'settings_default',
    name: 'Codex — High Reasoning',
    description: 'GPT-5 reasoning_effort=high. Slower, higher quality, OpenAI-path only.',
    values: [
      { parameter: 'reasoning_effort', value: 'high' },
      { parameter: 'max_output_tokens', value: 16_000 },
    ],
    scopedKinds: ['openai-api-key'],
    scopedModelIds: ['gpt-5'],
    createdAt: '2026-04-13T00:00:00Z',
    updatedAt: '2026-04-13T00:00:00Z',
  },
  {
    id: 'preset_local_fast',
    settingsId: 'settings_default',
    name: 'Local — Fast',
    description: 'Tight sampler for on-device runs. Mirostat + repeat penalty keep outputs terse.',
    values: [
      { parameter: 'temperature', value: 0.6 },
      { parameter: 'top_k', value: 40 },
      { parameter: 'mirostat_tau', value: 4.0 },
      { parameter: 'repeat_penalty', value: 1.15 },
      { parameter: 'seed', value: 42 },
      { parameter: 'max_tokens', value: 2048 },
    ],
    scopedKinds: ['local-runtime'],
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-20T00:00:00Z',
  },
];

// ── Schema ─────────────────────────────────────────────────────────────

const presetValueSchema: JsonObject = {
  type: 'object',
  additionalProperties: false,
  required: ['parameter', 'value'],
  properties: {
    parameter: { type: 'string' },
    value: {},
  },
};

export const inferencePresetSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'InferencePreset',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'settingsId', 'name', 'values', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      settingsId: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      values: { type: 'array', items: presetValueSchema },
      systemMessage: { type: 'string' },
      systemMessageId: { type: 'string' },
      promptTemplateId: { type: 'string' },
      scopedKinds: {
        type: 'array',
        items: { type: 'string', enum: CONNECTION_KINDS },
      },
      scopedModelIds: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

// ── References ─────────────────────────────────────────────────────────

export const inferencePresetReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
    summary:
      'Presets live per-profile so a strict work profile can carry different defaults than a personal one. Settings.defaultPresetId picks the default.',
  },
  {
    kind: 'references',
    label: 'Inference parameters',
    targetSource: 'cart/app/gallery/data/inference-parameter.ts',
    sourceField: 'values[].parameter',
    targetField: 'name',
    summary:
      'Each preset value references a parameter from the catalog. The preset editor uses the catalog\'s applicability fields to validate: a value for `reasoning_effort` in an unscoped preset should warn, because that param only applies on `openai-api-key`.',
  },
  {
    kind: 'references',
    label: 'Connection kinds (scoping)',
    targetSource: 'cart/app/gallery/data/connection.ts',
    sourceField: 'scopedKinds[]',
    targetField: 'kind',
    summary: 'Optional scoping — restricts the preset to specific auth/wire paths.',
  },
  {
    kind: 'references',
    label: 'Models (scoping)',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'scopedModelIds[]',
    targetField: 'id',
    summary: 'Optional scoping — restricts the preset to specific models (e.g. a GPT-5-only reasoning preset).',
  },
  {
    kind: 'references',
    label: 'System message (forward)',
    targetSource: 'cart/app/gallery/data/system-message.ts',
    sourceField: 'systemMessageId',
    targetField: 'id',
    summary:
      'Forward link — system-message.ts is not written yet. A preset can carry a systemMessage inline (simple case) or point at a reusable SystemMessage row (shared across presets).',
  },
  {
    kind: 'references',
    label: 'Prompt template (forward)',
    targetSource: 'cart/app/gallery/data/prompt-template.ts',
    sourceField: 'promptTemplateId',
    targetField: 'id',
    summary:
      'Forward link — prompt-template.ts is not written yet. A preset may bind a reusable prompt scaffold (e.g. "code review checklist", "migration planner") to the sampling + system-message bundle.',
  },
];
