import type { GalleryDataReference, JsonObject } from '../../types';

function objectSchema(properties: Record<string, JsonObject>, required: string[] = Object.keys(properties)): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

function arraySchema(items: JsonObject): JsonObject {
  return {
    type: 'array',
    items,
  };
}

const stringSchema: JsonObject = { type: 'string' };
const numberSchema: JsonObject = { type: 'number' };

export type WorkerSession = {
  id: string;
  provider: 'claude' | 'kimi' | 'local';
  model: string;
  status: 'complete' | 'running' | 'failed';
  startedAt: string;
  endedAt?: string;
  eventCount: number;
};

const workerSessionRowSchema = objectSchema({
  id: stringSchema,
  provider: { type: 'string', enum: ['claude', 'kimi', 'local'] },
  model: stringSchema,
  status: { type: 'string', enum: ['complete', 'running', 'failed'] },
  startedAt: stringSchema,
  endedAt: stringSchema,
  eventCount: numberSchema,
}, ['id', 'provider', 'model', 'status', 'startedAt', 'eventCount']);

export const workerSessionSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'WorkerSession',
  type: 'array',
  items: workerSessionRowSchema,
};

export const workerSessionMockData: WorkerSession[] = [
  {
    id: 'sess_claude_01',
    provider: 'claude',
    model: 'claude-opus-4-7',
    status: 'complete',
    startedAt: '2026-04-24T09:00:00Z',
    endedAt: '2026-04-24T09:02:14Z',
    eventCount: 4,
  },
  {
    id: 'sess_kimi_01',
    provider: 'kimi',
    model: 'kimi-k2',
    status: 'complete',
    startedAt: '2026-04-24T09:05:00Z',
    endedAt: '2026-04-24T09:06:03Z',
    eventCount: 7,
  },
  {
    id: 'sess_local_01',
    provider: 'local',
    model: 'gpt-5.4-mini',
    status: 'running',
    startedAt: '2026-04-24T09:10:00Z',
    eventCount: 5,
  },
];

export const workerSessionReferences: GalleryDataReference[] = [
  {
    kind: 'has-many',
    label: 'Worker Events',
    targetSource: 'cart/app/gallery/data/worker-event.ts',
    sourceField: 'id',
    targetField: 'session_id',
    summary:
      'The normalized session header owns the event stream. This lets transcript playback, provider accounting, and retry state live in related tables instead of one merged blob.',
  },
];
