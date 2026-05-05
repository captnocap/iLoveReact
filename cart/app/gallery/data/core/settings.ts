// Settings — per-user configuration profile. Owns connections, presets,
// budgets, and a Privacy policy. One user may own multiple Settings rows
// (work / personal profiles) and point at an active one via
// User.activeSettingsId.
//
// Settings is the pivot between identity (user.ts) and the configuration
// world. Collapsing it into User would make profile switching a rewrite
// rather than a pointer flip, and would prevent per-profile Privacy
// policies.

import type { GalleryDataReference, JsonObject } from '../../types';

export type Settings = {
  id: string;
  userId: string;
  label: string;
  privacyId: string; // has-one active privacy row
  defaultConnectionId?: string;
  defaultModelId?: string;
  defaultPresetId?: string;
  /**
   * The master Composition that orchestrates a turn for this profile.
   * When set, the assembler walks this composition (which slots `who`
   * + `what-when` + `execution` sub-compositions). When unset, the
   * assembler falls back to the legacy default-only behavior.
   */
  masterCompositionId?: string;
  createdAt: string;
  updatedAt: string;
  summary?: string;
};

export const settingsMockData: Settings[] = [
  {
    id: 'settings_default',
    userId: 'user_local',
    label: 'Default',
    privacyId: 'privacy_default',
    defaultConnectionId: 'conn_claude_cli',
    defaultModelId: 'claude-opus-4-7',
    defaultPresetId: 'preset_precise',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-04-24T00:00:00Z',
    summary: 'Active profile — subscription CLI, Opus 4.7, precise preset.',
  },
  {
    id: 'settings_work_strict',
    userId: 'user_local',
    label: 'Work (strict)',
    privacyId: 'privacy_strict',
    defaultConnectionId: 'conn_anthropic_api',
    defaultModelId: 'claude-sonnet-4-6',
    defaultPresetId: 'preset_precise',
    createdAt: '2026-04-12T00:00:00Z',
    updatedAt: '2026-04-12T00:00:00Z',
    summary:
      'Strict privacy, Console API key (billed to work org), Sonnet default for cost. Switch here for client-project work.',
  },
];

export const settingsSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Settings',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'userId', 'label', 'privacyId', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      label: { type: 'string' },
      privacyId: { type: 'string' },
      defaultConnectionId: { type: 'string' },
      defaultModelId: { type: 'string' },
      defaultPresetId: { type: 'string' },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
      summary: { type: 'string' },
    },
  },
};

export const settingsReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'User',
    targetSource: 'cart/app/gallery/data/user.ts',
    sourceField: 'userId',
    targetField: 'id',
    summary:
      'Settings belong to a user. One user may own multiple Settings rows; User.activeSettingsId picks the active profile.',
  },
  {
    kind: 'belongs-to',
    label: 'Privacy (active)',
    targetSource: 'cart/app/gallery/data/privacy.ts',
    sourceField: 'privacyId',
    targetField: 'id',
    summary:
      'Each settings profile points at one Privacy row. Swapping profiles swaps the active privacy policy.',
  },
  {
    kind: 'has-many',
    label: 'Connections',
    targetSource: 'cart/app/gallery/data/connection.ts',
    sourceField: 'id',
    targetField: 'settingsId',
    summary:
      'Connections are owned by a settings profile, not the user directly — so profile switching can swap the entire credential set in one pointer flip.',
  },
  {
    kind: 'has-many',
    label: 'Inference presets',
    targetSource: 'cart/app/gallery/data/inference-preset.ts',
    sourceField: 'id',
    targetField: 'settingsId',
    summary: 'Presets live per-profile too — a work profile can have stricter presets than a personal one.',
  },
  {
    kind: 'has-many',
    label: 'Budgets',
    targetSource: 'cart/app/gallery/data/budget.ts',
    sourceField: 'id',
    targetField: 'settingsId',
    summary:
      'Budgets (spending / token caps) attach to a settings profile. Global, per-provider, per-connection, and per-model scopes are all stored as Budget rows with different scope fields.',
  },
  {
    kind: 'references',
    label: 'Default connection',
    targetSource: 'cart/app/gallery/data/connection.ts',
    sourceField: 'defaultConnectionId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Default model',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'defaultModelId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Default preset',
    targetSource: 'cart/app/gallery/data/inference-preset.ts',
    sourceField: 'defaultPresetId',
    targetField: 'id',
  },
];
