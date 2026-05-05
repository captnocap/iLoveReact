// Supervisor — the fixed task-local orchestrator.
//
// The Supervisor is not the Assistant and does not carry Character. It
// knows the active task/spec and recent task context more deeply than
// anyone else should. Its only job is to keep workers aligned to the
// spec and acceptance criteria.
//
// The crew shape below supports the experiment where a Supervisor owns a
// fixed worker roster. Workers remain distinct runtime actors; fixed
// slots do not let workers become the Supervisor.

import type { GalleryDataReference, JsonObject } from '../../types';

export type SupervisorStatus = 'active' | 'paused' | 'archived';
export type SupervisorCrewSlotStatus = 'fixed' | 'vacant' | 'disabled';

export type SupervisorAuthority = {
  canOrchestrateWorkers: true;
  canReviseWorkerAssignments: true;
  canRejectWorkerOutput: true;
  canAskUserForClarification: true;
  canOverrideAssistant: false;
  canBecomeAssistant: false;
  canBecomeWorker: false;
  workersKnowSupervisorIdentity: false;
};

export type SupervisorContextPolicy = {
  focusWindowMinutes: { min: number; max: number };
  retain: string[];
  discard: string[];
  assistantBriefingOnly: true;
};

export type SupervisorCrewSlot = {
  id: string;
  label: string;
  workerId?: string;
  defaultRoleId?: string;
  defaultModelId?: string;
  status: SupervisorCrewSlotStatus;
  purpose: string;
};

export type Supervisor = {
  id: string;
  assistantId: string;
  userId: string;
  settingsId: string;
  label: string;
  status: SupervisorStatus;
  invariant: string;
  authority: SupervisorAuthority;
  contextPolicy: SupervisorContextPolicy;
  fixedCrew: SupervisorCrewSlot[];
  createdAt: string;
  updatedAt: string;
};

export const supervisorMockData: Supervisor[] = [
  {
    id: 'supervisor_default',
    assistantId: 'assistant_default',
    userId: 'user_local',
    settingsId: 'settings_default',
    label: 'Supervisor',
    status: 'active',
    invariant: 'Ensure workers follow the active task spec and acceptance criteria exactly.',
    authority: {
      canOrchestrateWorkers: true,
      canReviseWorkerAssignments: true,
      canRejectWorkerOutput: true,
      canAskUserForClarification: true,
      canOverrideAssistant: false,
      canBecomeAssistant: false,
      canBecomeWorker: false,
      workersKnowSupervisorIdentity: false,
    },
    contextPolicy: {
      focusWindowMinutes: { min: 15, max: 30 },
      retain: ['active spec', 'acceptance criteria', 'recent decisions', 'worker state', 'open questions'],
      discard: ['long-term user memory unless Assistant briefed it', 'assistant character/personality', 'unrelated project history'],
      assistantBriefingOnly: true,
    },
    fixedCrew: [
      {
        id: 'crew_doc',
        label: 'Documentarian',
        workerId: 'w1',
        defaultRoleId: 'role_documentarian',
        defaultModelId: 'claude-sonnet-4-6',
        status: 'fixed',
        purpose: 'Write and maintain task-local docs without broad user context.',
      },
      {
        id: 'crew_review',
        label: 'Reviewer',
        workerId: 'worker_sub_02',
        defaultRoleId: 'role_reviewer',
        defaultModelId: 'kimi-k2',
        status: 'fixed',
        purpose: 'Check outputs against the spec and flag deviations.',
      },
      {
        id: 'crew_strict',
        label: 'Strict reviewer',
        workerId: 'worker_strict_reviewer',
        defaultRoleId: 'role_reviewer_strict',
        defaultModelId: 'claude-sonnet-4-6',
        status: 'fixed',
        purpose: 'Run strict/profile-sensitive verification when the task requires it.',
      },
    ],
    createdAt: '2026-05-05T00:00:00Z',
    updatedAt: '2026-05-05T00:00:00Z',
  },
];

export const supervisorSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Supervisor',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'assistantId',
      'userId',
      'settingsId',
      'label',
      'status',
      'invariant',
      'authority',
      'contextPolicy',
      'fixedCrew',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      assistantId: { type: 'string' },
      userId: { type: 'string' },
      settingsId: { type: 'string' },
      label: { type: 'string' },
      status: { type: 'string', enum: ['active', 'paused', 'archived'] },
      invariant: { type: 'string' },
      authority: {
        type: 'object',
        additionalProperties: false,
        required: [
          'canOrchestrateWorkers',
          'canReviseWorkerAssignments',
          'canRejectWorkerOutput',
          'canAskUserForClarification',
          'canOverrideAssistant',
          'canBecomeAssistant',
          'canBecomeWorker',
          'workersKnowSupervisorIdentity',
        ],
        properties: {
          canOrchestrateWorkers: { const: true },
          canReviseWorkerAssignments: { const: true },
          canRejectWorkerOutput: { const: true },
          canAskUserForClarification: { const: true },
          canOverrideAssistant: { const: false },
          canBecomeAssistant: { const: false },
          canBecomeWorker: { const: false },
          workersKnowSupervisorIdentity: { const: false },
        },
      },
      contextPolicy: {
        type: 'object',
        additionalProperties: false,
        required: ['focusWindowMinutes', 'retain', 'discard', 'assistantBriefingOnly'],
        properties: {
          focusWindowMinutes: {
            type: 'object',
            additionalProperties: false,
            required: ['min', 'max'],
            properties: {
              min: { type: 'number' },
              max: { type: 'number' },
            },
          },
          retain: { type: 'array', items: { type: 'string' } },
          discard: { type: 'array', items: { type: 'string' } },
          assistantBriefingOnly: { const: true },
        },
      },
      fixedCrew: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'label', 'status', 'purpose'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            workerId: { type: 'string' },
            defaultRoleId: { type: 'string' },
            defaultModelId: { type: 'string' },
            status: { type: 'string', enum: ['fixed', 'vacant', 'disabled'] },
            purpose: { type: 'string' },
          },
        },
      },
      createdAt: { type: 'string' },
      updatedAt: { type: 'string' },
    },
  },
};

export const supervisorReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Assistant',
    targetSource: 'cart/app/gallery/data/assistant.ts',
    sourceField: 'assistantId',
    targetField: 'id',
    summary: 'Supervisor receives task-relevant briefings from Assistant but never becomes Assistant.',
  },
  {
    kind: 'belongs-to',
    label: 'User',
    targetSource: 'cart/app/gallery/data/user.ts',
    sourceField: 'userId',
    targetField: 'id',
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
    label: 'Fixed crew workers',
    targetSource: 'cart/app/gallery/data/worker.ts',
    sourceField: 'fixedCrew[].workerId',
    targetField: 'id',
    summary: 'Fixed roster slots. Workers remain runtime actors and do not know the Supervisor identity.',
  },
  {
    kind: 'references',
    label: 'Crew default roles',
    targetSource: 'cart/app/gallery/data/role.ts',
    sourceField: 'fixedCrew[].defaultRoleId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Crew default models',
    targetSource: 'cart/app/gallery/data/model.ts',
    sourceField: 'fixedCrew[].defaultModelId',
    targetField: 'id',
  },
];
