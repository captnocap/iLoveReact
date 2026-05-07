// Composition — the static spec of a sweatshop canvas.
//
// One row per persisted canvas. Holds the FlowEditor graph (nodes +
// edges) plus identifying metadata. The runtime form is
// `composition-run` (already exists) — Composition is the snapshot
// that produced it.
//
// The nodes/edges are stored as opaque objects (additionalProperties:
// true) so this entity stays decoupled from the FlowEditor type
// surface. Sweatshop owns the reading + writing; the canonical types
// live in `cart/app/gallery/components/flow-editor/types.ts`.

import type { GalleryDataReference, JsonObject } from '../../types';

function objectSchema(properties: Record<string, JsonObject>, required: string[] = Object.keys(properties)): JsonObject {
  return { type: 'object', additionalProperties: false, required, properties };
}

function arraySchema(items: JsonObject): JsonObject {
  return { type: 'array', items };
}

const stringSchema: JsonObject = { type: 'string' };
const opaqueObject: JsonObject = { type: 'object', additionalProperties: true };

export type CompositionNode = Record<string, unknown>;   // FlowNode
export type CompositionEdge = Record<string, unknown>;   // FlowEdge

export type Composition = {
  id: string;
  /** Free-form label users see in the canvas chrome. */
  name: string;
  /** Optional description / motivation. */
  description?: string;
  /** Owner. */
  userId?: string;
  workspaceId?: string;
  /** Serialized FlowEditor graph. */
  nodes: CompositionNode[];
  edges: CompositionEdge[];
  createdAt: string;
  updatedAt: string;
};

const compositionRowSchema = objectSchema({
  id: stringSchema,
  name: stringSchema,
  description: stringSchema,
  userId: stringSchema,
  workspaceId: stringSchema,
  nodes: arraySchema(opaqueObject),
  edges: arraySchema(opaqueObject),
  createdAt: stringSchema,
  updatedAt: stringSchema,
}, ['id', 'name', 'nodes', 'edges', 'createdAt', 'updatedAt']);

export const compositionSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Composition',
  type: 'array',
  items: compositionRowSchema,
};

export const compositionMockData: Composition[] = [
  {
    id: 'composition_default_user_local',
    name: 'Default canvas',
    description: 'Seed scene: Goal node + event:goal.reframed → notify-user.',
    userId: 'user_local',
    workspaceId: 'ws_local',
    nodes: [],
    edges: [],
    createdAt: '2026-05-07T00:00:00Z',
    updatedAt: '2026-05-07T00:00:00Z',
  },
];

export const compositionReferences: GalleryDataReference[] = [
  {
    kind: 'references',
    label: 'User',
    targetSource: 'cart/app/gallery/data/core/user.ts',
    sourceField: 'userId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Workspace',
    targetSource: 'cart/app/gallery/data/overstock/workspace.ts',
    sourceField: 'workspaceId',
    targetField: 'id',
  },
];
