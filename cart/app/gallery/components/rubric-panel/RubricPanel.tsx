// RubricPanel — gallery component bound to the `OutcomeRubric` data shape.
//
// Source of truth: cart/app/gallery/data/outcome-rubric.ts
//
// Top-level fields on `OutcomeRubric`:
//   id: string
//   scopeKind: RubricScopeKind
//   scopeTargetId: string
//   label: string
//   gestaltInvariant: GestaltInvariant
//   dimensions: RubricDimension[]
//   knownDisasters: string[]
//   authoredBy: 'user' | 'agent' | 'system'
//   derivedFromInterpretationId?: string
//   createdAt: string
//   updatedAt: string
//
// Available exports from the shape file:
//   outcomeRubricMockData: OutcomeRubric[]    — seeded mock rows for stories
//   outcomeRubricSchema: JsonObject    — JSON schema
//   outcomeRubricReferences: GalleryDataReference[]    — cross-shape links
//
// Rules for filling out this component:
//   - DO NOT invent fields. Only consume `OutcomeRubric` keys
//     listed above. If a field you want is missing, extend the shape
//     file first — never fake it locally.
//   - The story imports `outcomeRubricMockData`
//     and renders against real seeded rows. Do not hand-roll mock
//     props inside the story.
//   - If this component renders a *list* of rows, change the `row`
//     prop to `rows: OutcomeRubric[]` and update the variant
//     accordingly.

import { Col, Text } from '@reactjit/runtime/primitives';
import type { OutcomeRubric } from '../../data/composition/outcome-rubric';

export type RubricPanelProps = {
  row: OutcomeRubric;
};

export function RubricPanel({ row }: RubricPanelProps) {
  return (
    <Col style={{ alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'theme:bg2' }}>Rubric Panel</Text>
      <Text style={{ fontSize: 12, color: 'theme:paperInkDim' }}>OutcomeRubric: {String((row as { id?: unknown }).id ?? '—')}</Text>
    </Col>
  );
}
