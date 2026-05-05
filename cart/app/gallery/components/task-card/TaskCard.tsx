// TaskCard — gallery component bound to the `Task` data shape.
//
// Source of truth: cart/app/gallery/data/task.ts
//
// Top-level fields on `Task`:
//   id: string
//   taskGraphId: string
//   goalId?: string
//   label: string
//   description?: string
//   kind: TaskKind
//   status: TaskStatus
//   assignedWorkerId?: string
//   approachNote?: string
//   approachDecidedAt?: string
//   executionStartedAt?: string
//   executionAdjustments?: Array<{ id: string; observedAt: string; observation: string; adjustment: string; reason?: string; status: 'proposed' | 'applied' | 'rejected' | 'reverted' | 'modified'; proposedAt: string; appliedAt?: string; rejectedAt?: string; revertedAt?: string; approvalRequired?: boolean; riskNotes?: string; resolvedByInterventionId?: string; }>
//   artifactRefs?: string[]
//   researchId?: string
//   blockedReason?: string
//   startedAt?: string
//   endedAt?: string
//   createdAt: string
//   updatedAt: string
//
// Available exports from the shape file:
//   taskMockData: Task[]    — seeded mock rows for stories
//   taskSchema: JsonObject    — JSON schema
//   taskReferences: GalleryDataReference[]    — cross-shape links
//
// Rules for filling out this component:
//   - DO NOT invent fields. Only consume `Task` keys
//     listed above. If a field you want is missing, extend the shape
//     file first — never fake it locally.
//   - The story imports `taskMockData`
//     and renders against real seeded rows. Do not hand-roll mock
//     props inside the story.
//   - If this component renders a *list* of rows, change the `row`
//     prop to `rows: Task[]` and update the variant
//     accordingly.

import { Col, Text } from '@reactjit/runtime/primitives';
import type { Task } from '../../data/overstock/task';

export type TaskCardProps = {
  row: Task;
};

export function TaskCard({ row }: TaskCardProps) {
  return (
    <Col style={{ alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'theme:bg2' }}>Task Card</Text>
      <Text style={{ fontSize: 12, color: 'theme:paperInkDim' }}>Task: {String((row as { id?: unknown }).id ?? '—')}</Text>
    </Col>
  );
}
