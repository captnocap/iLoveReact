// GoalCard — gallery component bound to the `Goal` data shape.
//
// Source of truth: cart/app/gallery/data/goal.ts
//
// Top-level fields on `Goal`:
//   id: string
//   workspaceId: string
//   projectId?: string
//   originActor: GoalOriginActor
//   userTurnText?: string
//   statement: string
//   scopeDuration?: GoalScopeDuration
//   referenceArtifacts?: ReferenceArtifact[]
//   outcomeRubricId?: string
//   successDescription?: string
//   parentGoalId?: string
//   childGoalIds?: string[]
//   status: GoalStatus
//   achievedByPlanId?: string
//   achievedAt?: string
//   reframedToGoalId?: string
//   abandonReason?: string
//   createdAt: string
//   updatedAt: string
//   tags?: string[]
//
// Available exports from the shape file:
//   goalMockData: Goal[]    — seeded mock rows for stories
//   goalSchema: JsonObject    — JSON schema
//   goalReferences: GalleryDataReference[]    — cross-shape links
//
// Rules for filling out this component:
//   - DO NOT invent fields. Only consume `Goal` keys
//     listed above. If a field you want is missing, extend the shape
//     file first — never fake it locally.
//   - The story imports `goalMockData`
//     and renders against real seeded rows. Do not hand-roll mock
//     props inside the story.
//   - If this component renders a *list* of rows, change the `row`
//     prop to `rows: Goal[]` and update the variant
//     accordingly.

import { Col, Text } from '@reactjit/runtime/primitives';
import type { Goal } from '../../data/core/goal';

export type GoalCardProps = {
  row: Goal;
};

export function GoalCard({ row }: GoalCardProps) {
  return (
    <Col style={{ alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'theme:bg2' }}>Goal Card</Text>
      <Text style={{ fontSize: 12, color: 'theme:paperInkDim' }}>Goal: {String((row as { id?: unknown }).id ?? '—')}</Text>
    </Col>
  );
}
