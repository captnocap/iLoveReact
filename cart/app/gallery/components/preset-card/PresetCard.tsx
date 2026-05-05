// PresetCard — gallery component bound to the `InferencePreset` data shape.
//
// Source of truth: cart/app/gallery/data/inference-preset.ts
//
// Top-level fields on `InferencePreset`:
//   id: string
//   settingsId: string
//   name: string
//   description?: string
//   values: InferencePresetValue[]
//   systemMessage?: string
//   systemMessageId?: string
//   promptTemplateId?: string
//   scopedKinds?: ConnectionKind[]
//   scopedModelIds?: string[]
//   createdAt: string
//   updatedAt: string
//
// Available exports from the shape file:
//   inferencePresetMockData: InferencePreset[]    — seeded mock rows for stories
//   inferencePresetSchema: JsonObject    — JSON schema
//   inferencePresetReferences: GalleryDataReference[]    — cross-shape links
//
// Rules for filling out this component:
//   - DO NOT invent fields. Only consume `InferencePreset` keys
//     listed above. If a field you want is missing, extend the shape
//     file first — never fake it locally.
//   - The story imports `inferencePresetMockData`
//     and renders against real seeded rows. Do not hand-roll mock
//     props inside the story.
//   - If this component renders a *list* of rows, change the `row`
//     prop to `rows: InferencePreset[]` and update the variant
//     accordingly.

import { Col, Text } from '@reactjit/runtime/primitives';
import type { InferencePreset } from '../../data/core/inference-preset';

export type PresetCardProps = {
  row: InferencePreset;
};

export function PresetCard({ row }: PresetCardProps) {
  return (
    <Col style={{ alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'theme:bg2' }}>Preset Card</Text>
      <Text style={{ fontSize: 12, color: 'theme:paperInkDim' }}>InferencePreset: {String((row as { id?: unknown }).id ?? '—')}</Text>
    </Col>
  );
}
