// Assistant — the durable long-term identity.
//
// The Assistant is not a task runner. It owns the user's long-term
// relationship, manifest, goals, memory posture, and selectable
// Characters. It may brief the Supervisor on task-relevant context, but
// it does not supervise workers and it does not become the Supervisor.
//
// Boundary:
//   Assistant -> Character[]     (characters are masks for Assistant)
//   Assistant -> Supervisor      (fixed task-local orchestrator)
//   Supervisor -> Worker[]       (fixed or spawned crew)

import type { GalleryDataReference, JsonObject } from '../../types';

export type AssistantStatus = 'active' | 'paused' | 'archived';

export type AssistantAuthority = {
  ownsLongTermUserContext: true;
  canBriefSupervisor: true;
  supervisesWorkers: false;
  canBecomeSupervisor: false;
  canBecomeWorker: false;
};

export type AssistantMemoryPolicy = {
  manifestId?: string;
  longTermGoalIds: string[];
  recurringThemeIds?: string[];
  notes?: string;
};

export type Assistant = {
  id: string;
  userId: string;
  settingsId: string;
  label: string;
  status: AssistantStatus;
  activeCharacterId?: string;
  defaultSupervisorId?: string;
  memoryPolicy: AssistantMemoryPolicy;
  authority: AssistantAuthority;
  createdAt: string;
  updatedAt: string;
};

export const assistantMockData: Assistant[] = [
  {
    id: 'assistant_default',
    userId: 'user_local',
    settingsId: 'settings_default',
    label: '01 Assistant',
    status: 'active',
    activeCharacterId: 'char_default',
    defaultSupervisorId: 'supervisor_default',
    memoryPolicy: {
      manifestId: 'manifest_local',
      longTermGoalIds: ['goal_reactjit_cart_app'],
      notes:
        'Long-term user context, preferences, and goals live here. Task-local execution details belong to Supervisor sessions.',
    },
    authority: {
      ownsLongTermUserContext: true,
      canBriefSupervisor: true,
      supervisesWorkers: false,
      canBecomeSupervisor: false,
      canBecomeWorker: false,
    },
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
];

export const assistantSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Assistant',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'userId', 'settingsId', 'label', 'status', 'memoryPolicy', 'authority', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      userId: { type: 'string' },
      settingsId: { type: 'string' },
      label: { type: 'string' },
      status: { type: 'string', enum: ['active', 'paused', 'archived'] },
      activeCharacterId: { type: 'string' },
      defaultSupervisorId: { type: 'string' },
      memoryPolicy: {
        type: 'object',
        additionalProperties: false,
        required: ['longTermGoalIds'],
        properties: {
          manifestId: { type: 'string' },
          longTermGoalIds: { type: 'array', items: { type: 'string' } },
          recurringThemeIds: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
      },
      authority: {
        type: 'object',
        additionalProperties: false,
        required: [
          'ownsLongTermUserContext',
          'canBriefSupervisor',
          'supervisesWorkers',
          'canBecomeSupervisor',
          'canBecomeWorker',
        ],
        properties: {
          ownsLongTermUserContext: { const: true },
          canBriefSupervisor: { const: true },
          supervisesWorkers: { const: false },
          canBecomeSupervisor: { const: false },
          canBecomeWorker: { const: false },
        },
      },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const assistantReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'User',
    targetSource: 'cart/app/gallery/data/user.ts',
    sourceField: 'userId',
    targetField: 'id',
    summary: 'Assistant owns long-term user understanding for this user.',
  },
  {
    kind: 'belongs-to',
    label: 'Settings',
    targetSource: 'cart/app/gallery/data/settings.ts',
    sourceField: 'settingsId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Active character',
    targetSource: 'cart/app/gallery/data/character.ts',
    sourceField: 'activeCharacterId',
    targetField: 'id',
    summary: 'Character is an Assistant-only mask. It never applies to Supervisor or Worker.',
  },
  {
    kind: 'references',
    label: 'Default supervisor',
    targetSource: 'cart/app/gallery/data/supervisor.ts',
    sourceField: 'defaultSupervisorId',
    targetField: 'id',
    summary: 'The fixed task-local orchestrator used when the Assistant needs supervised work.',
  },
  {
    kind: 'references',
    label: 'User manifest',
    targetSource: 'cart/app/gallery/data/user-manifest.ts',
    sourceField: 'memoryPolicy.manifestId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Long-term goals',
    targetSource: 'cart/app/gallery/data/goal.ts',
    sourceField: 'memoryPolicy.longTermGoalIds[]',
    targetField: 'id',
  },
];
