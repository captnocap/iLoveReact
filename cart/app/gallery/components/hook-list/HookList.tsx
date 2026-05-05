// HookList — gallery component bound to the `EventHook` data shape.
//
// Source of truth: cart/app/gallery/data/event-hook.ts
//
// Top-level fields on `EventHook`:
//   id: string
//   settingsId: string
//   label: string
//   summary?: string
//   enabled: boolean
//   match: EventHookMatchSelector
//   action: EventHookAction
//   maxFires?: number
//   fireCount: number
//   cooldownMs?: number
//   lastFiredAt?: string
//   createdAt: string
//   updatedAt: string
//
// Available exports from the shape file:
//   eventHookMockData: EventHook[]    — seeded mock rows for stories
//   eventHookSchema: JsonObject    — JSON schema
//   eventHookReferences: GalleryDataReference[]    — cross-shape links
//
// Rules for filling out this component:
//   - DO NOT invent fields. Only consume `EventHook` keys
//     listed above. If a field you want is missing, extend the shape
//     file first — never fake it locally.
//   - The story imports `eventHookMockData`
//     and renders against real seeded rows. Do not hand-roll mock
//     props inside the story.
//   - If this component renders a *list* of rows, change the `row`
//     prop to `rows: EventHook[]` and update the variant
//     accordingly.

import { Col, Text } from '@reactjit/runtime/primitives';
import type { EventHook } from '../../data/core/event-hook';

export type HookListProps = {
  row: EventHook;
};

export function HookList({ row }: HookListProps) {
  return (
    <Col style={{ alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'theme:bg2' }}>Hook List</Text>
      <Text style={{ fontSize: 12, color: 'theme:paperInkDim' }}>EventHook: {String((row as { id?: unknown }).id ?? '—')}</Text>
    </Col>
  );
}
