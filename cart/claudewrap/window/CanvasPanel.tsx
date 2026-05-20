// CanvasPanel — Phase 11 (optional). Slip-in of sweatshop's
// FlowEditor against the shared recipe-store.ts. Either embeds the
// component or shows a deeplink list; until that decision is made
// this is a stub.

import * as React from 'react';
import { Col, Text } from '../../../runtime/primitives';
import { palette } from '../ui/palette';

export function CanvasPanel() {
  return (
    <Col style={{ flexGrow: 1, gap: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>canvas</Text>
      <Text style={{ color: palette.dim }}>sweatshop FlowEditor slip-in (optional, phase 11)</Text>
    </Col>
  );
}
