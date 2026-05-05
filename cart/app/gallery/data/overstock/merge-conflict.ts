// MergeConflict — a single unresolved disagreement between two or
// more parallel workstreams' outputs. Lives as its own row so:
//   - a MergeProposal can be approved-with-conflicts
//   - resolution attempts can be tracked over time
//   - the cockpit UI can render conflicts as a queue
//
// Kinds we track:
//   text-region        — same file, overlapping line ranges
//   semantic-decision  — both branches finished, but they made
//                        incompatible choices (e.g. two different
//                        adapter shapes for Kimi)
//   data-row-conflict  — same logical row updated on both branches
//                        with different field values
//   schema-drift       — one branch modified a schema in a way the
//                        other branch's data no longer fits
//
// Resolution stores who decided, which side won (or whether a
// hand-merged third option won), and a short rationale for replay.

import type { GalleryDataReference, JsonObject } from '../../types';

export type MergeConflictKind =
  | 'text-region'
  | 'semantic-decision'
  | 'data-row-conflict'
  | 'schema-drift';

export type MergeConflictStatus = 'open' | 'resolved' | 'deferred' | 'abandoned';

export type MergeConflictSide = {
  workstreamId: string;
  artifactRef: string;
  contentExcerpt?: string;
};

export type MergeConflictResolution = {
  resolvedAt: string;
  resolvedByActor: 'supervisor' | 'human' | 'auto';
  winningSideWorkstreamId?: string; // null when a hand-merged third option won
  manualResultRef?: string; // points at the third-option artifact, if any
  rationale: string;
};

export type MergeConflict = {
  id: string;
  proposalId: string;
  kind: MergeConflictKind;
  subject: string; // file path / row id / decision name
  sides: MergeConflictSide[];
  status: MergeConflictStatus;
  resolution?: MergeConflictResolution;
  detectedAt: string;
  note?: string;
};

export const mergeConflictMockData: MergeConflict[] = [
  {
    id: 'conflict_kimi_adapter_choice',
    proposalId: 'merge_kimi_speculation_pending',
    kind: 'semantic-decision',
    subject: 'Kimi adapter shape — separate file vs extend codex',
    sides: [
      {
        workstreamId: 'ws_speculate_kimi_adapter_a',
        artifactRef: 'cart/app/gallery/data/kimi-raw-event.ts',
        contentExcerpt: 'New file mirroring codex-raw-event.ts — clean, larger surface area.',
      },
      {
        workstreamId: 'ws_speculate_kimi_adapter_b',
        artifactRef: 'cart/app/gallery/data/codex-raw-event.ts (patch)',
        contentExcerpt: 'Extends codex-raw-event with provider-tagged frame variant blocks.',
      },
    ],
    status: 'open',
    detectedAt: '2026-04-25T09:35:00Z',
    note: 'Both sides functional; choice is shape-philosophy, not correctness.',
  },
  {
    id: 'conflict_resolved_example',
    proposalId: 'merge_phase2_memory_tiers_imaginary',
    kind: 'text-region',
    subject: 'cart/app/gallery/data/agent-memory.ts:references',
    sides: [
      {
        workstreamId: 'ws_consolidate_memory',
        artifactRef: 'cart/app/gallery/data/agent-memory.ts:120-145',
        contentExcerpt: 'Added a "Alternative shape — semantic-memory" reference block.',
      },
      {
        workstreamId: 'ws_doc_pass',
        artifactRef: 'cart/app/gallery/data/agent-memory.ts:120-145',
        contentExcerpt: 'Rewrote the same reference block with a different summary line.',
      },
    ],
    status: 'resolved',
    resolution: {
      resolvedAt: '2026-04-24T09:25:30Z',
      resolvedByActor: 'supervisor',
      winningSideWorkstreamId: 'ws_consolidate_memory',
      rationale:
        'consolidate_memory landed first and the doc_pass version added no new information; kept the consolidate version.',
    },
    detectedAt: '2026-04-24T09:24:00Z',
  },
];

export const mergeConflictSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'MergeConflict',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'proposalId', 'kind', 'subject', 'sides', 'status', 'detectedAt'],
    properties: {
      id: { type: 'string' },
      proposalId: { type: 'string' },
      kind: {
        type: 'string',
        enum: ['text-region', 'semantic-decision', 'data-row-conflict', 'schema-drift'],
      },
      subject: { type: 'string' },
      status: { type: 'string', enum: ['open', 'resolved', 'deferred', 'abandoned'] },
      detectedAt: { type: 'string' },
      note: { type: 'string' },
      sides: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['workstreamId', 'artifactRef'],
          properties: {
            workstreamId: { type: 'string' },
            artifactRef: { type: 'string' },
            contentExcerpt: { type: 'string' },
          },
        },
      },
      resolution: {
        type: 'object',
        additionalProperties: false,
        required: ['resolvedAt', 'resolvedByActor', 'rationale'],
        properties: {
          resolvedAt: { type: 'string' },
          resolvedByActor: { type: 'string', enum: ['supervisor', 'human', 'auto'] },
          winningSideWorkstreamId: { type: 'string' },
          manualResultRef: { type: 'string' },
          rationale: { type: 'string' },
        },
      },
    },
  },
};

export const mergeConflictReferences: GalleryDataReference[] = [
  {
    kind: 'belongs-to',
    label: 'Merge proposal',
    targetSource: 'cart/app/gallery/data/merge-proposal.ts',
    sourceField: 'proposalId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Conflict sides — workstreams',
    targetSource: 'cart/app/gallery/data/workstream.ts',
    sourceField: 'sides[].workstreamId',
    targetField: 'id',
  },
  {
    kind: 'references',
    label: 'Winning side',
    targetSource: 'cart/app/gallery/data/workstream.ts',
    sourceField: 'resolution.winningSideWorkstreamId',
    targetField: 'id',
    summary: 'Null when a hand-merged third option won — see resolution.manualResultRef.',
  },
];
