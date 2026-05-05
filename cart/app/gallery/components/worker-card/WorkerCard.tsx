// WorkerCard — gallery component bound to the `Worker` data shape.
//
// Source of truth: cart/app/gallery/data/worker.ts
//
// Top-level fields on `Worker`:
//   id: string
//   supervisorId: string
//   crewSlotId?: string
//   crewMode: WorkerCrewMode
//   userId: string
//   workspaceId: string
//   projectId?: string
//   environmentId?: string
//   settingsId: string
//   sessionId?: string
//   label: string
//   kind: WorkerKind
//   lifecycle: WorkerLifecycle
//   roleId?: string
//   connectionId: string
//   modelId: string
//   parentWorkerId?: string
//   childWorkerIds?: string[]
//   maxConcurrentRequests: number
//   spawnedAt: string
//   lastActivityAt?: string
//   terminatedAt?: string
//
// Available exports from the shape file:
//   workerMockData: Worker[]    — seeded mock rows for stories
//   workerSchema: JsonObject    — JSON schema
//   workerReferences: GalleryDataReference[]    — cross-shape links
//
// Rules for filling out this component:
//   - DO NOT invent fields. Only consume `Worker` keys
//     listed above. If a field you want is missing, extend the shape
//     file first — never fake it locally.
//   - The story imports `workerMockData`
//     and renders against real seeded rows. Do not hand-roll mock
//     props inside the story.
//   - If this component renders a *list* of rows, change the `row`
//     prop to `rows: Worker[]` and update the variant
//     accordingly.

import { Col, Text } from '@reactjit/runtime/primitives';
import type { Worker } from '../../data/core/worker';

export type WorkerCardProps = {
  row: Worker;
};

export function WorkerCard({ row }: WorkerCardProps) {
  return (
    <Col style={{ alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'theme:bg2' }}>Worker Card</Text>
      <Text style={{ fontSize: 12, color: 'theme:paperInkDim' }}>Worker: {String((row as { id?: unknown }).id ?? '—')}</Text>
    </Col>
  );
}
