// ClaudePage — Phase 1 stub. Phase 2 lifts the live <Terminal> +
// PiP style switch from tui/examples/claudewrap.tsx.

import * as React from 'react';
import { Col, Text } from '../../../runtime/primitives';
import { palette } from '../ui/palette';

export function ClaudePage() {
  return (
    <Col style={{ flexGrow: 1, padding: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>claude</Text>
      <Text style={{ color: palette.dim }}>terminal lifts here in phase 2</Text>
    </Col>
  );
}
