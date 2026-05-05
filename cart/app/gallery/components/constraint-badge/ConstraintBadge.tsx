// ConstraintBadge — gallery component bound to the `Constraint` data shape.
//
// Source of truth: cart/app/gallery/data/constraint.ts
//
// Top-level fields on `Constraint`:
//   id: string
//   scopeKind: ConstraintScopeKind
//   scopeTargetId: string
//   kind: ConstraintKind
//   statement: string
//   rationale?: string
//   severity: ConstraintSeverity
//   violationResponse: ConstraintViolationResponse
//   appliesDuring: ConstraintPhase[]
//   derivedFromSemanticMemoryId?: string
//   createdAt: string
//   createdBy: 'user' | 'agent' | 'system'
//
// Available exports from the shape file:
//   constraintMockData: Constraint[]    — seeded mock rows for stories
//   constraintSchema: JsonObject    — JSON schema
//   constraintReferences: GalleryDataReference[]    — cross-shape links
//
// Rules for filling out this component:
//   - DO NOT invent fields. Only consume `Constraint` keys
//     listed above. If a field you want is missing, extend the shape
//     file first — never fake it locally.
//   - The story imports `constraintMockData`
//     and renders against real seeded rows. Do not hand-roll mock
//     props inside the story.
//   - If this component renders a *list* of rows, change the `row`
//     prop to `rows: Constraint[]` and update the variant
//     accordingly.

import { Col, Text } from '@reactjit/runtime/primitives';
import type { Constraint } from '../../data/core/constraint';

export type ConstraintBadgeProps = {
  row: Constraint;
};

export function ConstraintBadge({ row }: ConstraintBadgeProps) {
  return (
    <Col style={{ alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'theme:bg2' }}>Constraint Badge</Text>
      <Text style={{ fontSize: 12, color: 'theme:paperInkDim' }}>Constraint: {String((row as { id?: unknown }).id ?? '—')}</Text>
    </Col>
  );
}
